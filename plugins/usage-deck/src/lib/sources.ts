import streamDeck from "@elgato/streamdeck";

import { type ClaudeSettings, fetchClaudeUsage } from "./claude";
import { fetchGitHubUsage, type GitHubAuth } from "./github";
import { Poller } from "./poller";

/** Plugin-wide settings, edited from any key's property inspector. Stored locally by Stream Deck. */
export type GlobalSettings = ClaudeSettings & GitHubAuth;

/** Settings written by earlier versions that are no longer used; removed from storage on startup. */
const RETIRED_KEYS = ["claudeSource", "claudeSessionKey"];

let globals: GlobalSettings = {};
let markReady!: () => void;
// Keys can appear before global settings arrive; hold the first fetch until they do.
const ready = new Promise<void>((resolve) => (markReady = resolve));

// Each poll starts the Claude Code CLI (~2 s, ~400 MB briefly) and the usage endpoint is rate limited,
// so poll every 5 minutes and allow a manual refresh at most once a minute.
export const claudePoller = new Poller("claude", () => ready.then(() => fetchClaudeUsage(globals)), 5 * 60_000, 60_000);
// GitHub billing data is only updated a few times an hour.
export const githubPoller = new Poller("github", () => ready.then(() => fetchGitHubUsage(globals)), 15 * 60_000);

export async function initSources(): Promise<void> {
	streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => apply(ev.settings));
	const stored = (await streamDeck.settings.getGlobalSettings<GlobalSettings>()) ?? {};
	// Don't keep a claude.ai session key from the removed cookie source lying around in plain text.
	if (RETIRED_KEYS.some((k) => k in stored)) {
		const cleaned = Object.fromEntries(Object.entries(stored).filter(([k]) => !RETIRED_KEYS.includes(k))) as GlobalSettings;
		await streamDeck.settings.setGlobalSettings(cleaned);
		globals = cleaned;
	} else {
		globals = stored;
	}
	markReady();
}

function apply(next: GlobalSettings): void {
	const prev = globals;
	globals = next ?? {};
	if ((prev.claudePath ?? "") !== (globals.claudePath ?? "")) claudePoller.reset();
	const githubKey = (g: GlobalSettings) => JSON.stringify([g.githubToken ?? "", g.githubOrg ?? ""]);
	if (githubKey(prev) !== githubKey(globals)) githubPoller.reset();
}
