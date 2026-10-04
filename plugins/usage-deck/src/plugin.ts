import streamDeck from "@elgato/streamdeck";

import { ClaudeUsageAction } from "./actions/claude-usage";
import { GitHubUsageAction } from "./actions/github-usage";
import { initSources } from "./lib/sources";

// Not "trace": that level logs every message, including the session key / token in global settings.
streamDeck.logger.setLevel("info");

const claude = new ClaudeUsageAction();
const github = new GitHubUsageAction();
streamDeck.actions.registerAction(claude);
streamDeck.actions.registerAction(github);

await streamDeck.connect();
await initSources();

// Reset countdowns and pace markers move without new data.
setInterval(() => {
	claude.rerenderAll();
	github.rerenderAll();
}, 60_000);
