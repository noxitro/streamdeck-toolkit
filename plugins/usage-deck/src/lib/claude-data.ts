// Plan usage in the plugin's own shape, plus normalization from the raw `/api/oauth/usage` body.
// That body is unofficial and changes often, so it is parsed defensively.

export type UsageWindow = {
	/** Percent used, 0–100. */
	percent: number;
	resetsAt?: string;
};

export type ModelWindow = UsageWindow & {
	/** Display name from the server, e.g. "Fable". */
	name: string;
};

export type ExtraUsage = {
	enabled: boolean;
	/** Enabled but unusable because the credits or the spend cap ran out. */
	blocked?: boolean;
	/** Only set when there is a limit to measure against (uncapped credits have no percentage). */
	percent?: number;
	/** Amounts in major units (e.g. dollars), already scaled by the currency's exponent. */
	used?: number;
	limit?: number;
	currency: string;
};

/** Plan usage, independent of where it came from. */
export type ClaudeUsage = {
	/** 5-hour session window. */
	session?: UsageWindow;
	/** Weekly window across all models. */
	weekly?: UsageWindow;
	/** Weekly windows scoped to one model. */
	models: ModelWindow[];
	extra?: ExtraUsage;
	/** When the server produced this data; the CLI can return a cached body up to an hour old. */
	asOf?: string;
};

type RawWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined;
type RawLimit = {
	kind?: string;
	percent?: number | null;
	resets_at?: string | null;
	scope?: { model?: { display_name?: string | null } | null } | null;
};
type RawMoney = { amount_minor?: number | null; currency?: string | null; exponent?: number | null } | null | undefined;

/** Raw `/api/oauth/usage` body (also what the CLI's get_usage returns as `rate_limits`). */
export type RawUsage = {
	five_hour?: RawWindow;
	seven_day?: RawWindow;
	seven_day_opus?: RawWindow;
	seven_day_sonnet?: RawWindow;
	limits?: RawLimit[] | null;
	model_scoped?: { display_name?: string | null; utilization?: number | null; resets_at?: string | null }[] | null;
	extra_usage?: {
		is_enabled?: boolean;
		monthly_limit?: number | null;
		used_credits?: number | null;
		utilization?: number | null;
		currency?: string | null;
		decimal_places?: number | null;
		disabled_reason?: string | null;
		spend_limit_reached?: boolean | null;
	} | null;
	spend?: { enabled?: boolean; percent?: number | null; used?: RawMoney; limit?: RawMoney; disabled_reason?: string | null } | null;
	seven_day_breakdown?: { as_of?: string | null } | null;
};

/** True when the body carries any usage at all (a 200 with none of these is an in-band error). */
export function hasUsage(raw: RawUsage | null | undefined): raw is RawUsage {
	return !!raw && (raw.five_hour != null || raw.seven_day != null || Array.isArray(raw.limits) || raw.extra_usage != null);
}

export function normalizeUsage(raw: RawUsage): ClaudeUsage {
	const limits = Array.isArray(raw.limits) ? raw.limits : [];
	const fromLimit = (kind: string) => limitWindow(limits.find((l) => l.kind === kind));

	const models: ModelWindow[] = [];
	const addModel = (name: string | null | undefined, w: UsageWindow | undefined) => {
		if (!name || !w || models.some((m) => m.name.toLowerCase() === name.toLowerCase())) return;
		models.push({ name, ...w });
	};
	// Per-model weekly limits live in limits[] (kind "weekly_scoped"); model_scoped is the CLI's filtered copy.
	for (const l of limits) if (l.kind === "weekly_scoped") addModel(l.scope?.model?.display_name, limitWindow(l));
	for (const m of raw.model_scoped ?? []) addModel(m.display_name, window({ utilization: m.utilization, resets_at: m.resets_at }));
	// Older plans report these as top-level windows. Other top-level keys are internal and never scanned.
	addModel("Sonnet", window(raw.seven_day_sonnet));
	addModel("Opus", window(raw.seven_day_opus));

	return {
		session: fromLimit("session") ?? window(raw.five_hour),
		weekly: fromLimit("weekly_all") ?? window(raw.seven_day),
		models,
		extra: extraOf(raw),
		asOf: raw.seven_day_breakdown?.as_of ?? undefined
	};
}

function window(w: RawWindow): UsageWindow | undefined {
	if (!w || typeof w.utilization !== "number") return undefined;
	return { percent: w.utilization, resetsAt: w.resets_at ?? undefined };
}

function limitWindow(l: RawLimit | undefined): UsageWindow | undefined {
	if (!l || typeof l.percent !== "number") return undefined;
	return { percent: l.percent, resetsAt: l.resets_at ?? undefined };
}

/** Currencies whose minor unit is the major unit. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND"]);

function extraOf(raw: RawUsage): ExtraUsage | undefined {
	const spend = raw.spend;
	const e = raw.extra_usage;
	// A spent cap is reported as disabled-with-a-reason rather than 100% (the CLI's own check reads it the same way).
	const reason = spend?.disabled_reason ?? e?.disabled_reason ?? undefined;
	const blocked =
		reason === "out_of_credits" ||
		reason === "org_spend_cap_reached" ||
		(reason === "org_level_disabled_until" && e?.spend_limit_reached !== false);
	const result = (enabled: boolean, currency: string, used: number | undefined, limit: number | undefined, reported: number | null | undefined): ExtraUsage => {
		// The server sends percent 0 even when there is no limit; a percentage only means something against a limit.
		let percent = limit === undefined ? undefined : typeof reported === "number" ? reported : ratio(used, limit);
		if (blocked) percent = Math.max(percent ?? 0, 100);
		return { enabled: enabled || blocked, blocked: blocked || undefined, currency, used, limit, percent };
	};

	if (spend && spend.used) {
		return result(spend.enabled === true, spend.used.currency ?? "USD", money(spend.used), money(spend.limit), spend.percent);
	}
	if (!e) return undefined;
	const currency = e.currency ?? "USD";
	const exponent = typeof e.decimal_places === "number" ? e.decimal_places : ZERO_DECIMAL.has(currency) ? 0 : 2;
	const scale = (v: number | null | undefined) => (typeof v === "number" ? v / 10 ** exponent : undefined);
	return result(e.is_enabled === true, currency, scale(e.used_credits), scale(e.monthly_limit), e.utilization);
}

function money(m: RawMoney): number | undefined {
	if (!m || typeof m.amount_minor !== "number") return undefined;
	const exponent = typeof m.exponent === "number" ? m.exponent : ZERO_DECIMAL.has(m.currency ?? "USD") ? 0 : 2;
	return m.amount_minor / 10 ** exponent;
}

function ratio(used: number | undefined, limit: number | undefined): number | undefined {
	return used !== undefined && limit ? (100 * used) / limit : undefined;
}
