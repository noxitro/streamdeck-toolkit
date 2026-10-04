import { fetchViaCli } from "./claude-cli";
import type { ClaudeUsage } from "./claude-data";

export type { ClaudeUsage, ModelWindow, UsageWindow } from "./claude-data";

export type ClaudeSettings = {
	/** Path to the claude executable; auto-detected when empty. */
	claudePath?: string;
};

/**
 * Plan usage from the installed Claude Code CLI. There is deliberately no other source: a pasted claude.ai
 * session key expires unpredictably, and Anthropic's terms don't allow third-party tools to collect one.
 */
export function fetchClaudeUsage(settings: ClaudeSettings): Promise<ClaudeUsage> {
	return fetchViaCli(settings.claudePath?.trim() || undefined);
}
