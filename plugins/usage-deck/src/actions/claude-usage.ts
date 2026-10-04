import streamDeck, { action, type SendToPluginEvent } from "@elgato/streamdeck";

import type { ClaudeUsage, ModelWindow, UsageWindow } from "../lib/claude";
import { formatDuration, t } from "../lib/i18n";
import type { Snapshot } from "../lib/poller";
import { type KeyFace, levelFor } from "../lib/render";
import { claudePoller } from "../lib/sources";
import { UsageAction } from "./usage-action";

type Metric = "five_hour" | "seven_day" | "seven_day_model" | "extra_usage";

type Settings = {
	metric?: Metric;
	/** For "seven_day_model": the model's display name, e.g. "Fable". */
	model?: string;
	warnAt?: number | string;
	critAt?: number | string;
	/** Show the even-pace marker on the bar. */
	pace?: boolean;
};

/** The CLI may answer from its own cache (up to 1 h old) when a fetch fails; older than this counts as stale. */
const STALE_AFTER_MS = 15 * 60_000;

const WINDOW_MS: Partial<Record<Metric, number>> = {
	five_hour: 5 * 3_600_000,
	seven_day: 7 * 86_400_000,
	seven_day_model: 7 * 86_400_000
};

@action({ UUID: "com.noxitro.usagedeck.claude" })
export class ClaudeUsageAction extends UsageAction<ClaudeUsage, Settings> {
	protected readonly poller = claudePoller;
	protected readonly usageUrl = "https://claude.ai/settings/usage";

	private lastItems = "";

	/** Fills the model dropdown in the property inspector with the models the plan actually reports. */
	override async onSendToPlugin(ev: SendToPluginEvent<{ event?: string }, Settings>): Promise<void> {
		if (ev.payload?.event !== "models") return;
		// The list comes from usage data, so fetch it if the dropdown is opened before the first poll.
		if (!this.poller.current.data) await this.poller.refresh();
		this.lastItems = "";
		await this.pushModels(this.poller.current);

		// Settings saved by earlier versions hold e.g. "fable"; store the server's name so the dropdown shows it.
		const settings = await ev.action.getSettings();
		const canonical = findModel(this.poller.current.data?.models ?? [], settings.model);
		if (settings.model && canonical && canonical.name !== settings.model) await ev.action.setSettings({ ...settings, model: canonical.name });
	}

	/** Keeps an open dropdown current (e.g. after fixing the source or path), via sdpi's hot-reload. */
	protected override snapshotChanged(snapshot: Snapshot<ClaudeUsage>): void {
		void this.pushModels(snapshot);
	}

	private async pushModels({ data, error }: Snapshot<ClaudeUsage>): Promise<void> {
		const models = data?.models ?? [];
		// Never leave the dropdown spinning: say why the list is empty instead.
		const items = models.length
			? models.map((m) => ({ label: m.name, value: m.name }))
			: [{ label: t(error ? error.short : data ? "value.na" : "value.loading", error?.vars), value: "", disabled: true }];
		const key = JSON.stringify(items);
		if (key === this.lastItems) return;
		this.lastItems = key;
		await streamDeck.ui.sendToPropertyInspector({ event: "models", items }).catch(() => {});
	}

	protected face({ data, error }: Snapshot<ClaudeUsage>, s: Settings): KeyFace {
		const metric = s.metric ?? "five_hour";
		const model = metric === "seven_day_model" ? findModel(data?.models ?? [], s.model) : undefined;
		const label =
			metric === "seven_day_model" ? t("label.seven_day_model", { model: model?.name ?? s.model ?? "?" }) : t(`label.${metric}`);
		if (!data) return error ? { label, value: t(error.short, error.vars), level: "error" } : { label, value: "…", level: "neutral" };

		// A cached answer from the CLI looks like a fresh one except for its server timestamp.
		const stale = !!error || (!!data.asOf && Date.now() - Date.parse(data.asOf) > STALE_AFTER_MS);
		const warnAt = Number(s.warnAt ?? 70);
		const critAt = Number(s.critAt ?? 90);

		if (metric === "extra_usage") {
			const extra = data.extra;
			if (!extra) return { label, value: "—", sub: t("value.na"), level: "neutral", stale };
			if (!extra.enabled) return { label, value: t("value.off"), level: "neutral", stale };
			const amounts = extra.used === undefined ? undefined : `${money(extra.used, extra.currency)}${extra.limit === undefined ? "" : `/${money(extra.limit, extra.currency)}`}`;
			// Without a percentage there is nothing to draw a bar against: show the amount itself.
			if (extra.percent === undefined) return { label, value: amounts ?? "—", level: "neutral", stale };
			return { label, value: `${Math.round(extra.percent)}%`, percent: extra.percent, sub: amounts, level: levelFor(extra.percent, warnAt, critAt), stale };
		}

		const w: UsageWindow | undefined = metric === "five_hour" ? data.session : metric === "seven_day" ? data.weekly : model;
		if (!w) {
			const missing = metric === "seven_day_model" && data.models.length > 0 ? "value.notFound" : "value.na";
			return { label, value: "—", sub: t(missing), level: "neutral", stale };
		}

		const resetsIn = w.resetsAt ? Date.parse(w.resetsAt) - Date.now() : Number.NaN;
		// Past its reset, the percentage belongs to the previous window: don't show it as current.
		if (resetsIn <= 0) return { label, value: "—", sub: `↻ ${formatDuration(0)}`, level: "neutral", stale: true };
		const windowMs = WINDOW_MS[metric];
		const elapsed = s.pace !== false && windowMs && !Number.isNaN(resetsIn) ? (100 * (windowMs - resetsIn)) / windowMs : undefined;

		return {
			label,
			value: `${Math.floor(w.percent)}%`,
			percent: w.percent,
			marker: elapsed,
			sub: Number.isNaN(resetsIn) ? undefined : `↻ ${formatDuration(resetsIn)}`,
			level: levelFor(w.percent, warnAt, critAt),
			stale
		};
	}
}

/**
 * The saved model name matched case-insensitively, then by prefix ("Fable" ↔ "Fable 5"), so a renamed
 * model keeps its key. No saved name → the first reported model.
 */
function findModel(models: ModelWindow[], wanted: string | undefined): ModelWindow | undefined {
	if (!wanted) return models[0];
	const w = wanted.trim().toLowerCase();
	return (
		models.find((m) => m.name.toLowerCase() === w) ??
		models.find((m) => m.name.toLowerCase().startsWith(w) || w.startsWith(m.name.toLowerCase()))
	);
}

function money(amount: number, currency: string): string {
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
			// Whole units once the amount is large, to fit the key; the minimum must drop too or Intl throws.
			...(amount >= 100 && { minimumFractionDigits: 0, maximumFractionDigits: 0 })
		}).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${currency}`;
	}
}
