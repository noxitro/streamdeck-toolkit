import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import streamDeck from "@elgato/streamdeck";

import { type ClaudeUsage, hasUsage, type ModelWindow, normalizeUsage, type RawUsage } from "./claude-data";
import { FetchError } from "./poller";

// Plan usage via the installed Claude Code CLI. The plugin never reads, stores or sends a token: the CLI
// uses (and refreshes, under its own locks) its own login, exactly as when the user runs it.
//
// Primary: `claude -p --input-format stream-json` + control_request `get_usage` (no model call, ~2 s).
// Fallback: `claude -p /usage` text (no model call), for CLIs without get_usage (it is experimental).

/** Give up waiting for output after this long (the process may still be finishing a token refresh). */
const REPLY_TIMEOUT_MS = Number(process.env.USAGE_DECK_CLI_TIMEOUT_MS) || 45_000;
/** Hard stop. Generous so a token refresh in progress is not cut off mid-write. */
const KILL_AFTER_MS = Number(process.env.USAGE_DECK_CLI_KILL_MS) || 120_000;
/**
 * For every spawn: user settings only (never project/local settings from the cwd — `-p` skips the
 * workspace-trust check), no hooks (they'd run on every poll), no MCP servers, no session file.
 */
const CLI_FLAGS = [
	"--setting-sources",
	"user",
	"--settings",
	JSON.stringify({ disableAllHooks: true }),
	"--strict-mcp-config",
	"--no-session-persistence"
];

type Command = { file: string; prefix: string[] };

export async function fetchViaCli(configuredPath: string | undefined): Promise<ClaudeUsage> {
	const cmd = await resolveCli(configuredPath);
	const reply = await getUsage(cmd);
	switch (reply.kind) {
		case "usage":
			return normalizeUsage(reply.raw);
		case "login":
			throw new FetchError("err.cliLogin", "Claude Code CLI has no claude.ai subscription login (run claude, then /login)");
		case "unavailable":
			// Signed in, but the CLI's own usage request failed (offline, 429, 5xx). Back off; don't blame the login.
			throw new FetchError("err.cliUnavailable", "claude get_usage: signed in, but plan usage is unavailable right now", true);
		case "unsupported":
			streamDeck.logger.info(`claude get_usage unavailable (${reply.detail}); falling back to -p /usage`);
			return usageFromText(await runUsageText(cmd));
	}
}

// --- locating the CLI ---------------------------------------------------------------------------

let resolved: { key: string; cmd: Command } | undefined;

async function resolveCli(configuredPath: string | undefined): Promise<Command> {
	// Test seam: run a JS stand-in for the CLI with this Node. Only the plugin's own environment can set it.
	const fake = process.env.USAGE_DECK_CLAUDE_CLI;
	if (fake) return { file: process.execPath, prefix: [fake] };

	const key = configuredPath ?? "";
	if (resolved?.key === key) return resolved.cmd;
	const candidates = configuredPath ? explicitCandidates(configuredPath) : autoCandidates();
	for (const file of candidates) {
		if (await isFile(file)) {
			resolved = { key, cmd: { file, prefix: [] } };
			return resolved.cmd;
		}
	}
	throw new FetchError("err.cliMissing", `claude CLI not found (tried: ${candidates.join(", ") || configuredPath})`);
}

/** npm's shims (claude.cmd/.ps1/sh) exec this file, relative to the npm prefix they live in. */
const NPM_EXE = path.join("node_modules", "@anthropic-ai", "claude-code", "bin", process.platform === "win32" ? "claude.exe" : "claude");

/**
 * A path typed or pasted into the settings: quotes stripped, %VARS% and ~ expanded. A directory or an npm
 * shim is mapped to the real executable (shims can't be spawned without a shell). Relative and network
 * (UNC) paths are refused: the plugin would run whatever they point at, every few minutes.
 */
function explicitCandidates(raw: string): string[] {
	let p = raw.trim().replace(/^"(.*)"$/, "$1").trim();
	p = p.replace(/%([^%]+)%/g, (m, name: string) => envValue(name) ?? m);
	p = p.replace(/^~(?=$|[\\/])/, os.homedir());
	p = path.normalize(p);
	if (!path.isAbsolute(p) || /^[\\/]{2}/.test(p)) return [];

	const base = path.basename(p).toLowerCase();
	const dir = path.dirname(p);
	if (/^claude(\.cmd|\.ps1|\.bat)?$/.test(base) && process.platform === "win32") return [path.join(dir, NPM_EXE)];
	if (/\.(cmd|bat|ps1)$/.test(base)) return [];
	// The file itself, or — if it's a directory — the executable inside it or its npm layout.
	const exe = process.platform === "win32" ? "claude.exe" : "claude";
	return [p, path.join(p, exe), path.join(p, NPM_EXE), ...(base === "claude" ? [path.join(dir, NPM_EXE)] : [])];
}

function autoCandidates(): string[] {
	const home = os.homedir();
	const onPath = (process.env.PATH ?? "").split(path.delimiter).filter((d) => d && path.isAbsolute(d));
	if (process.platform === "win32") {
		const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
		return [
			// Native installer, then any npm prefix on PATH (default %APPDATA%\npm, nvm-windows, custom prefixes).
			...onPath.flatMap((dir) => [path.join(dir, "claude.exe"), path.join(dir, NPM_EXE)]),
			path.join(home, ".local", "bin", "claude.exe"),
			path.join(appData, "npm", NPM_EXE)
		];
	}
	return [
		...onPath.map((dir) => path.join(dir, "claude")),
		path.join(home, ".local", "bin", "claude"),
		path.join(home, ".claude", "local", "claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude"
	];
}

/** Windows env names are case-insensitive; process.env only is when read by exact key. */
function envValue(name: string): string | undefined {
	if (process.env[name] !== undefined) return process.env[name];
	const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
	return key === undefined ? undefined : process.env[key];
}

async function isFile(file: string): Promise<boolean> {
	return stat(file).then(
		(s) => s.isFile(),
		() => false
	);
}

// --- running it ---------------------------------------------------------------------------------

const REQUEST_ID = "usage-deck";

type Reply = { kind: "usage"; raw: RawUsage } | { kind: "login" } | { kind: "unavailable" } | { kind: "unsupported"; detail: string };

type GetUsageResponse = { rate_limits_available?: boolean; rate_limits?: RawUsage | null };

async function getUsage(cmd: Command): Promise<Reply> {
	const child = await start(cmd, ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", ...CLI_FLAGS], true);
	const reply = new Promise<Reply>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.stdin?.end();
			reject(new FetchError("err.cliTimeout", `claude get_usage: no reply in ${REPLY_TIMEOUT_MS} ms`));
		}, REPLY_TIMEOUT_MS);

		readLines(child, (line) => {
			let msg: { type?: string; response?: { subtype?: string; request_id?: string; error?: string; response?: GetUsageResponse } };
			try {
				msg = JSON.parse(line);
			} catch {
				return;
			}
			if (msg.type !== "control_response" || msg.response?.request_id !== REQUEST_ID) return;
			clearTimeout(timer);
			// Closing stdin lets the CLI exit on its own (it may still be writing a refreshed token).
			child.stdin?.end();
			const r = msg.response;
			if (r.subtype !== "success") return resolve({ kind: "unsupported", detail: r.error ?? "error reply" });
			const body = r.response;
			// rate_limits_available is the CLI's "signed in to a claude.ai subscription" check, made before it fetches;
			// rate_limits is null when that fetch failed.
			if (body?.rate_limits_available !== true) return resolve({ kind: "login" });
			if (!hasUsage(body.rate_limits)) return resolve({ kind: "unavailable" });
			resolve({ kind: "usage", raw: body.rate_limits });
		});
		// 'close' (not 'exit'): stdout is fully read by then, so a reply printed just before exiting isn't missed.
		child.once("close", (code) => {
			clearTimeout(timer);
			resolve({ kind: "unsupported", detail: `exited ${code} without a get_usage reply` });
		});
	});
	child.stdin?.write(JSON.stringify({ type: "control_request", request_id: REQUEST_ID, request: { subtype: "get_usage" } }) + "\n");
	return reply;
}

/** Runs `claude -p /usage` and returns its text. */
async function runUsageText(cmd: Command): Promise<string> {
	const child = await start(cmd, ["-p", "/usage", "--output-format", "json", ...CLI_FLAGS], false);
	let out = "";
	child.stdout?.setEncoding("utf8").on("data", (d: string) => {
		out += d;
		if (out.length > 4 * 1024 * 1024) child.kill();
	});
	const code = await new Promise<number | null>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new FetchError("err.cliTimeout", `claude -p /usage: no result in ${REPLY_TIMEOUT_MS} ms`)),
			REPLY_TIMEOUT_MS
		);
		child.once("close", (c) => {
			clearTimeout(timer);
			resolve(c);
		});
	});
	try {
		const result = (JSON.parse(out) as { result?: unknown }).result;
		if (typeof result === "string") return result;
	} catch {
		// fall through
	}
	throw new FetchError("err.cliFailed", `claude -p /usage exited ${code} with unparseable output`);
}

async function start(cmd: Command, args: string[], stdin: boolean): Promise<ChildProcess> {
	// A fresh private cwd per run, removed afterwards (--setting-sources keeps project settings out regardless).
	const cwd = await mkdtemp(path.join(os.tmpdir(), "usage-deck-"));
	const cleanup = () => void rm(cwd, { recursive: true, force: true }).catch(() => {});
	let child: ChildProcess;
	try {
		child = spawn(cmd.file, [...cmd.prefix, ...args], {
			cwd,
			env: cliEnv(),
			stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
			windowsHide: true
		});
	} catch (e) {
		// Node throws synchronously for some files (e.g. EINVAL for .cmd/.bat, EFTYPE for .ps1).
		cleanup();
		throw new FetchError("err.cliFailed", `spawn ${cmd.file}: ${String(e)}`);
	}
	const killer = setTimeout(() => child.kill(), KILL_AFTER_MS);
	child.once("close", () => {
		clearTimeout(killer);
		cleanup();
	});
	child.stderr?.resume();
	child.stdin?.on("error", () => {}); // EPIPE if the CLI exits before reading
	return new Promise((resolve, reject) => {
		child.once("spawn", () => resolve(child));
		child.once("error", (e: NodeJS.ErrnoException) => {
			clearTimeout(killer);
			cleanup();
			if (e.code === "ENOENT") resolved = undefined;
			reject(new FetchError(e.code === "ENOENT" ? "err.cliMissing" : "err.cliFailed", `spawn ${cmd.file}: ${e.message}`));
		});
	});
}

/**
 * The plugin's environment minus anything that would make the CLI use another credential (API keys, an
 * injected OAuth token, another endpoint) or think it runs inside another Claude Code session. Matched
 * case-insensitively, as Windows treats env names. CLAUDE_CONFIG_DIR is kept so a custom config dir works.
 */
function cliEnv(): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_|CLAUDECODE$|USE_(LOCAL|STAGING)_OAUTH$)/i.test(k))
	);
}

function readLines(child: ChildProcess, onLine: (line: string) => void): void {
	let buf = "";
	child.stdout?.setEncoding("utf8").on("data", (d: string) => {
		buf += d;
		if (buf.length > 4 * 1024 * 1024) {
			child.kill();
			return;
		}
		for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			if (line) onLine(line);
		}
	});
}

// --- /usage text fallback -----------------------------------------------------------------------

/**
 * Parses lines like "Current session: 26% used · resets …", "Current week (all models): 70% used · …"
 * and "Current week (Fable): 80% used · …". Reset times are localized text, so they're not used.
 */
export function usageFromText(text: string): ClaudeUsage {
	const usage: ClaudeUsage = { models: [] };
	for (const line of text.split(/\r?\n/)) {
		const m = /^\s*(.+?):\s*(\d+(?:\.\d+)?)%\s+used\b/.exec(line);
		if (!m) continue;
		const title = m[1];
		const percent = Number(m[2]);
		if (/^Current session$/i.test(title)) usage.session = { percent };
		else if (/^Current week \(all models\)$/i.test(title)) usage.weekly = { percent };
		else {
			const scoped = /^Current week \((.+?)(?: only)?\)$/i.exec(title);
			if (scoped) usage.models.push({ name: scoped[1], percent } satisfies ModelWindow);
		}
	}
	if (!usage.session && !usage.weekly && usage.models.length === 0) {
		// The text looks the same signed out and when the CLI's usage request failed, so don't claim either.
		throw new FetchError("err.cliUnavailable", "claude -p /usage returned no usage lines (signed out, no subscription, or fetch failed)", true);
	}
	return usage;
}
