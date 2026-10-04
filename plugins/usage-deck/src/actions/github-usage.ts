import { action } from "@elgato/streamdeck";

import type { GitHubUsage, UsageItem } from "../lib/github";
import type { Snapshot } from "../lib/poller";
import { t } from "../lib/i18n";
import { formatCompact, type KeyFace, levelFor } from "../lib/render";
import { githubPoller } from "../lib/sources";
import { UsageAction } from "./usage-action";

type Settings = {
	metric?: "copilot" | "actions";
	/** Actions only: which runner OS to count. */
	runner?: "all" | "linux" | "windows" | "macos";
	/** Optional monthly allowance; enables the bar and threshold colors. */
	budget?: number | string;
	/** Which amount to show under the quantity when no budget is set. */
	money?: "gross" | "net";
	warnAt?: number | string;
	critAt?: number | string;
};

@action({ UUID: "com.noxitro.usagedeck.github" })
export class GitHubUsageAction extends UsageAction<GitHubUsage, Settings> {
	protected readonly poller = githubPoller;
	protected readonly usageUrl = "https://github.com/settings/billing/usage";

	protected face({ data, error }: Snapshot<GitHubUsage>, s: Settings): KeyFace {
		const metric = s.metric ?? "copilot";
		const runner = s.runner ?? "all";
		const label = t(metric === "copilot" ? "label.copilot" : `label.actions.${runner}`);
		if (!data) return error ? { label, value: t(error.short, error.vars), level: "error" } : { label, value: "…", level: "neutral" };

		const items = metric === "copilot" ? copilotItems(data.items) : actionsItems(data.items, runner);
		const qty = sum(items, "grossQuantity");
		const amount = sum(items, s.money === "net" ? "netAmount" : "grossAmount");
		const budget = Number(s.budget) || 0;
		const stale = !!error;

		if (budget <= 0) {
			return { label, value: formatCompact(qty), sub: `$${amount.toFixed(2)}`, level: "neutral", stale };
		}
		const pct = (100 * qty) / budget;
		return {
			label,
			value: formatCompact(qty),
			sub: t("sub.budget", { pct: Math.round(pct), budget: formatCompact(budget) }),
			percent: pct,
			marker: monthElapsedPercent(data.year, data.month),
			level: levelFor(pct, Number(s.warnAt ?? 70), Number(s.critAt ?? 90)),
			stale
		};
	}
}

function actionsItems(items: UsageItem[], runner: NonNullable<Settings["runner"]>): UsageItem[] {
	return items.filter(
		(i) => i.product === "Actions" && i.unitType === "minutes" && (runner === "all" || i.sku.includes(runner))
	);
}

/** Copilot items in one unit (AI units when present), so different units are never added together. */
function copilotItems(items: UsageItem[]): UsageItem[] {
	const copilot = items.filter((i) => i.product === "Copilot");
	const unit = copilot.some((i) => i.unitType === "ai-units") ? "ai-units" : copilot[0]?.unitType;
	return copilot.filter((i) => i.unitType === unit);
}

function sum(items: UsageItem[], key: "grossQuantity" | "grossAmount" | "netAmount"): number {
	return items.reduce((n, i) => n + (i[key] ?? 0), 0);
}

/** Billing months are UTC calendar months. */
function monthElapsedPercent(year: number, month: number): number {
	const start = Date.UTC(year, month - 1, 1);
	const end = Date.UTC(year, month, 1);
	return (100 * (Date.now() - start)) / (end - start);
}
