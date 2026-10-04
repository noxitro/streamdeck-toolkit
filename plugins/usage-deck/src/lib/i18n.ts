import streamDeck from "@elgato/streamdeck";

/**
 * Translates `key` from the `Localization` section of `<language>.json` (falls back to en.json),
 * substituting `{name}` placeholders from `vars`.
 */
export function t(key: string, vars: Record<string, string | number> = {}): string {
	return streamDeck.i18n.t(key).replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** "2d 4h" / "2日4時間", "3h 12m" / "3時間12分", "8m" / "8分". */
export function formatDuration(ms: number): string {
	if (ms <= 0) return t("dur.now");
	const total = Math.floor(ms / 60_000);
	const d = Math.floor(total / 1440);
	const h = Math.floor((total % 1440) / 60);
	const m = total % 60;
	if (d > 0) return t("dur.dh", { d, h });
	if (h > 0) return t("dur.hm", { h, m });
	return t("dur.m", { m: Math.max(m, 1) });
}
