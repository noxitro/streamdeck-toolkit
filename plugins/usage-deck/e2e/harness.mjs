// E2E: a fake Stream Deck host that speaks the SDK WebSocket protocol to the built plugin (bin/plugin.js).
// Run with `npm run e2e`.
//   Phase A: plugin basics; GitHub through e2e/mock-github.mjs (E2E_REAL_GITHUB=1: the real API via `gh`, needs the user scope).
//   Phase B: Claude through e2e/fake-claude.mjs (success, fallback, errors); GitHub organization billing and log hygiene.
//   Phase C: Stream Deck language = ja.
//   Phase R (only with E2E_REAL_CLAUDE=1): the real, auto-detected Claude Code CLI with the user's own login.
// Unless Phase R is enabled, the real Claude Code CLI and the user's Claude login are never used.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PLUGIN_DIR = fileURLToPath(new URL("../com.noxitro.usagedeck.sdPlugin/", import.meta.url));
const FAKE_CLI = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const MOCK_GITHUB = new URL("./mock-github.mjs", import.meta.url);
const REAL_GITHUB = process.env.E2E_REAL_GITHUB === "1";
/** GitHub via the stub (a token so `gh` is never asked), or the real API when E2E_REAL_GITHUB=1. */
const github = (globals = {}) => (REAL_GITHUB ? { globals } : { preload: MOCK_GITHUB, globals: { githubToken: "ghp_e2e_mock", ...globals } });
const PLUGIN_LOG = path.join(fileURLToPath(new URL("../com.noxitro.usagedeck.sdPlugin/logs/", import.meta.url)), "com.noxitro.usagedeck.0.log");
const pluginLog = () => { try { return readFileSync(PLUGIN_LOG, "utf8"); } catch { return ""; } };
const OUT = new URL("./out/", import.meta.url);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Scratch dir: a stand-in CLAUDE_CONFIG_DIR (must pass through to the CLI) and the fake CLI's invocation log.
const TMP = mkdtempSync(path.join(os.tmpdir(), "usagedeck-e2e-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));
const DEVICE = "DEV1";
const results = [];

function check(name, ok, detail = "") {
	results.push({ name, ok });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

let hostCount = 0;
/**
 * Starts the plugin against a fake Stream Deck.
 * @param cli fake CLI mode ("ok" | "login" | "unsupported" | "text-login" | "hang" | "crash"), or null for no fake CLI.
 */
async function startHost({ globals = {}, env = {}, preload, language = "en", cli = "ok" } = {}) {
	const wss = new WebSocketServer({ port: 0 });
	const port = wss.address().port;
	const log = [];
	let socket;
	const state = { globals };
	const keySettings = new Map();
	const connected = new Promise((resolve) => {
		wss.on("connection", (ws) => {
			socket = ws;
			ws.on("message", (raw) => {
				const msg = JSON.parse(String(raw));
				log.push({ t: Date.now(), msg });
				if (msg.event === "getGlobalSettings") {
					ws.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: state.globals } }));
				}
				if (msg.event === "setSettings") keySettings.set(msg.context, msg.payload);
				if (msg.event === "getSettings") {
					const k = keySettings.get(msg.context) ?? {};
					ws.send(JSON.stringify({ event: "didReceiveSettings", action: k.action ?? CLAUDE, context: msg.context, device: DEVICE,
						payload: { controller: "Keypad", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings: k.settings ?? k, state: 0 } }));
				}
				if (msg.event === "registerPlugin") resolve();
			});
		});
	});

	const cliLog = path.join(TMP, `cli-${++hostCount}.jsonl`);
	const cliEnv = cli
		? { USAGE_DECK_CLAUDE_CLI: FAKE_CLI, FAKE_CLAUDE_MODE: cli, FAKE_CLAUDE_LOG: cliLog, USAGE_DECK_CLI_TIMEOUT_MS: "1500" }
		: {};
	const info = {
		application: { font: "", language, platform: "windows", platformVersion: "10.0.26200", version: "7.1.0.0" },
		plugin: { uuid: "com.noxitro.usagedeck", version: "0.1.0.0" },
		devicePixelRatio: 2,
		colors: {},
		devices: [{ id: DEVICE, name: "Fake Deck", size: { columns: 5, rows: 3 }, type: 0 }]
	};
	const nodeArgs = [...(preload ? ["--import", String(preload)] : []), "bin/plugin.js",
		"-port", String(port), "-pluginUUID", "com.noxitro.usagedeck", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)];
	const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("USAGE_DECK_") && !k.startsWith("FAKE_CLAUDE_")));
	const proc = spawn(process.execPath, nodeArgs, {
		cwd: PLUGIN_DIR,
		// Credentials the plugin must NOT pass on to the CLI, and a config dir it must pass on.
		env: { ...baseEnv, ANTHROPIC_API_KEY: "sk-e2e-must-be-stripped", anthropic_auth_token: "e2e-must-be-stripped", CLAUDE_CODE_OAUTH_TOKEN: "e2e-must-be-stripped", CLAUDE_CONFIG_DIR: TMP, ...cliEnv, ...env },
		stdio: ["ignore", "pipe", "pipe"]
	});
	const stderr = [];
	proc.stderr.on("data", (d) => stderr.push(String(d)));
	proc.stdout.on("data", () => {});

	await Promise.race([connected, sleep(10_000).then(() => { throw new Error("plugin did not register: " + stderr.join("")); })]);

	const send = (event, context, action, payload) => {
		if (payload?.settings) keySettings.set(context, { action, settings: payload.settings });
		socket.send(JSON.stringify({ event, context, action, device: DEVICE, payload }));
	};
	const keyPayload = (settings, column) => ({ controller: "Keypad", coordinates: { column, row: 0 }, isInMultiAction: false, settings, state: 0 });

	return {
		log, stderr, state,
		/** Invocations of the fake CLI so far. */
		cliCalls: () => { try { return readFileSync(cliLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } },
		appear: (ctx, action, settings, col) => send("willAppear", ctx, action, keyPayload(settings, col)),
		disappear: (ctx, action, settings, col) => send("willDisappear", ctx, action, keyPayload(settings, col)),
		settings: (ctx, action, settings, col) => send("didReceiveSettings", ctx, action, keyPayload(settings, col)),
		keyDown: (ctx, action, settings, col) => send("keyDown", ctx, action, keyPayload(settings, col)),
		keyUp: (ctx, action, settings, col) => send("keyUp", ctx, action, keyPayload(settings, col)),
		piAppear: (ctx, action) => send("propertyInspectorDidAppear", ctx, action, undefined),
		sendToPlugin: (ctx, action, payload) => socket.send(JSON.stringify({ event: "sendToPlugin", context: ctx, action, payload })),
		setGlobals: (g) => { state.globals = g; socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: g } })); },
		/** Waits for a message matching pred that arrives after `since`. */
		waitFor: async (pred, { since = 0, timeout = 20_000 } = {}) => {
			const end = Date.now() + timeout;
			while (Date.now() < end) {
				const hit = log.find((e) => e.t >= since && pred(e.msg));
				if (hit) return hit.msg;
				await sleep(50);
			}
			return undefined;
		},
		/** Asks for the model dropdown's items the way the property inspector does. */
		models: async (ctx) => {
			send("propertyInspectorDidAppear", ctx, CLAUDE, undefined);
			await sleep(200);
			const t = Date.now();
			socket.send(JSON.stringify({ event: "sendToPlugin", context: ctx, action: CLAUDE, payload: { event: "models" } }));
			return (await waitForIn(log, (m) => m.event === "sendToPropertyInspector", t, 10_000))?.payload?.items;
		},
		stop: () => { proc.kill(); wss.close(); }
	};
}

async function waitForIn(log, pred, since, timeout) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const hit = log.find((e) => e.t >= since && pred(e.msg));
		if (hit) return hit.msg;
		await sleep(50);
	}
	return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const svgOf = (msg) => decodeURIComponent(msg.payload.image.split(",")[1]);
const textsOf = (msg) => [...svgOf(msg).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)));
const imageFor = (ctx) => (m) => m.event === "setImage" && m.context === ctx;
const settled = (ctx) => (m) => imageFor(ctx)(m) && !textsOf(m).includes("…");
let shot = 0;
const save = (name, msg) => msg && writeFileSync(new URL(`${String(++shot).padStart(2, "0")}-${name}.svg`, OUT), svgOf(msg));
const faceText = (msg) => (msg ? textsOf(msg).join(" | ") : "no image");

const CLAUDE = "com.noxitro.usagedeck.claude";
const GITHUB = "com.noxitro.usagedeck.github";

// ---------------------------------------------------------------- Phase A: plugin basics + GitHub
console.log(`\n=== Phase A: plugin basics; GitHub ${REAL_GITHUB ? "over the real network" : "via the API stub"}; Claude via a signed-out stand-in CLI ===`);
{
	// Settings left behind by the removed cookie source must be wiped, and must not switch the source.
	const legacy = { claudeSource: "cookie", claudeSessionKey: "sk-ant-sid01-legacy-e2e" };
	const gh = github(legacy);
	const h = await startHost({ ...gh, cli: "login" });
	check("A1 plugin registers over WebSocket", true);
	check("A2 plugin asks for global settings", !!(await h.waitFor((m) => m.event === "getGlobalSettings", { timeout: 5000 })));
	const wiped = await h.waitFor((m) => m.event === "setGlobalSettings", { timeout: 5000 });
	check("A2b a stored claude.ai session key from the removed cookie source is deleted from settings",
		!!wiped && !("claudeSessionKey" in wiped.payload) && !("claudeSource" in wiped.payload) && (REAL_GITHUB || wiped.payload.githubToken === "ghp_e2e_mock"),
		JSON.stringify(Object.keys(wiped?.payload ?? {})));

	const t0 = Date.now();
	h.appear("c1", CLAUDE, { metric: "five_hour" }, 0);
	h.appear("g1", GITHUB, { metric: "copilot" }, 1);
	h.appear("g2", GITHUB, { metric: "actions", budget: "2000" }, 2);

	const c1 = await h.waitFor(settled("c1"), { since: t0 });
	save("claude-cli-signed-out", c1);
	check("A3 Claude key with a signed-out CLI shows 'Run /login' (the legacy cookie setting is ignored)", !!c1 && textsOf(c1)[1] === "Run /login" && h.cliCalls().length >= 1, faceText(c1));

	const g1 = await h.waitFor(settled("g1"), { since: t0 });
	save("github-copilot", g1);
	check("A4 GitHub Copilot key shows AI units + $", !!g1 && textsOf(g1)[0] === "Copilot" && /^\$\d+\.\d\d$/.test(textsOf(g1)[2] ?? "")
		&& (REAL_GITHUB || (textsOf(g1)[1] === "525" && textsOf(g1)[2] === "$5.25")), faceText(g1));

	const g2 = await h.waitFor(settled("g2"), { since: t0 });
	save("github-actions-budget", g2);
	check("A5 Actions key with budget shows '% of 2,000' and a bar", !!g2 && /% of 2,000$/.test(textsOf(g2)[2] ?? "") && svgOf(g2).includes('y="98"')
		&& (REAL_GITHUB || textsOf(g2)[1] === "1,600"), faceText(g2));

	const ghRenders = h.log.filter((e) => imageFor("g1")(e.msg)).length;
	check("A6 one shared GitHub fetch feeds both GitHub keys", ghRenders <= 3, `g1 setImage count=${ghRenders}`);

	let t = Date.now();
	h.settings("g1", GITHUB, { metric: "actions", runner: "windows", money: "net" }, 1);
	const g1b = await h.waitFor(imageFor("g1"), { since: t, timeout: 3000 });
	save("github-actions-win-net", g1b);
	check("A7 settings change re-renders immediately (Actions Win, net $)", !!g1b && textsOf(g1b)[0] === "Actions Win", `${Date.now() - t}ms  ${faceText(g1b)}`);

	t = Date.now();
	h.keyDown("g1", GITHUB, {}, 1);
	await sleep(100);
	h.keyUp("g1", GITHUB, { metric: "actions", runner: "windows" }, 1);
	const g1c = await h.waitFor(imageFor("g1"), { since: t, timeout: 5000 });
	const alert1 = await h.waitFor((m) => m.event === "showAlert" && m.context === "g1", { since: t, timeout: 1000 });
	check("A8 short press refreshes (image re-sent, no alert)", !!g1c && !alert1);

	t = Date.now();
	h.keyDown("c1", CLAUDE, {}, 0);
	await sleep(750);
	h.keyUp("c1", CLAUDE, { metric: "five_hour" }, 0);
	const url = await h.waitFor((m) => m.event === "openUrl", { since: t, timeout: 3000 });
	check("A9 long press opens claude.ai usage page", url?.payload?.url === "https://claude.ai/settings/usage", url?.payload?.url);

	t = Date.now();
	h.keyDown("c1", CLAUDE, {}, 0);
	h.keyUp("c1", CLAUDE, { metric: "five_hour" }, 0);
	check("A10 short press on failing Claude key shows alert", !!(await h.waitFor((m) => m.event === "showAlert" && m.context === "c1", { since: t, timeout: 5000 })));
	check("A11 the legacy session key never reaches the plugin's log or stderr",
		!pluginLog().includes("sk-ant-sid01-legacy-e2e") && !h.stderr.join("").includes("sk-ant-sid01-legacy-e2e"));
	h.stop();
}
{
	// Property inspectors must not load remote scripts (offline/proxy use, and nothing foreign next to the token field).
	const ui = fileURLToPath(new URL("../com.noxitro.usagedeck.sdPlugin/ui/", import.meta.url));
	const remote = ["claude.html", "github.html"].flatMap((f) =>
		[...readFileSync(path.join(ui, f), "utf8").matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((src) => /^[a-z]+:|^\/\//i.test(src)).map((src) => `${f}: ${src}`)
	);
	check("A12 property inspectors load only bundled scripts", remote.length === 0, remote.join(", "));
}

// ---------------------------------------------------------------- Phase B: Claude via the CLI (stand-in)
console.log("\n=== Phase B: Claude Code CLI delegation (stand-in CLI) ===");
{
	const h = await startHost({ cli: "ok" });
	const t0 = Date.now();
	const keys = [
		["five_hour", { metric: "five_hour" }],
		["seven_day", { metric: "seven_day" }],
		["model-Fable", { metric: "seven_day_model", model: "Fable" }],
		["model-default", { metric: "seven_day_model" }],
		["model-legacy-lowercase", { metric: "seven_day_model", model: "fable" }],
		["model-Sonnet", { metric: "seven_day_model", model: "Sonnet" }],
		["model-Opus-missing", { metric: "seven_day_model", model: "Opus" }],
		["extra", { metric: "extra_usage" }]
	];
	keys.forEach(([, settings], i) => h.appear(`m${i}`, CLAUDE, settings, i));
	const faces = {};
	for (let i = 0; i < keys.length; i++) {
		const m = await h.waitFor(settled(`m${i}`), { since: t0 });
		save(`claude-${keys[i][0]}`, m);
		faces[keys[i][0]] = m ? textsOf(m) : [];
	}
	console.log("      faces:", JSON.stringify(faces));
	const f = faces;
	check("B1 5h from limits[session]: 37% with reset countdown", f.five_hour[1] === "37%" && /^↻ 2h (10|11|12)m$/.test(f.five_hour[2] ?? ""), f.five_hour.join(" | "));
	check("B2 weekly from limits[weekly_all]: 81%", f.seven_day[1] === "81%" && /^↻ 1d (5|6)h$/.test(f.seven_day[2] ?? ""), f.seven_day.join(" | "));
	check("B3 model from limits[weekly_scoped] (Fable): 98%", f["model-Fable"][0] === "Fable wk" && f["model-Fable"][1] === "98%", f["model-Fable"].join(" | "));
	check("B4 no model chosen → first reported model (Fable)", f["model-default"].join() === f["model-Fable"].join());
	check("B5 old saved value 'fable' still matches Fable", f["model-legacy-lowercase"].join() === f["model-Fable"].join(), f["model-legacy-lowercase"].join(" | "));
	check("B6 legacy top-level window (seven_day_sonnet) still offered", f["model-Sonnet"][0] === "Sonnet wk" && f["model-Sonnet"][1] === "95%", f["model-Sonnet"].join(" | "));
	check("B7 model the plan doesn't report → 'not found'", f["model-Opus-missing"][1] === "—" && f["model-Opus-missing"][2] === "not found", f["model-Opus-missing"].join(" | "));
	check("B8 extra usage from spend: 24%/25%, $12.30/$50.00", /^2[45]%$/.test(f.extra[1] ?? "") && f.extra[2] === "$12.30/$50.00", f.extra.join(" | "));

	const items = await h.models("m0");
	check("B9 model dropdown = models from limits[] + legacy windows, no internal keys (nimbus_quill etc.)",
		JSON.stringify(items) === JSON.stringify([{ label: "Fable", value: "Fable" }, { label: "Sonnet", value: "Sonnet" }]), JSON.stringify(items));

	const calls = h.cliCalls();
	const c = calls[0] ?? { args: [] };
	check("B10 one CLI run serves all keys", calls.length === 1, `calls=${calls.length}`);
	const argAfter = (flag) => c.args[c.args.indexOf(flag) + 1];
	check("B11 CLI run: -p stream-json in/out + --verbose, user settings only, hooks off, no MCP, no session file",
		c.args[0] === "-p" && argAfter("--input-format") === "stream-json" && argAfter("--output-format") === "stream-json" && c.args.includes("--verbose")
			&& argAfter("--setting-sources") === "user" && argAfter("--settings") === JSON.stringify({ disableAllHooks: true })
			&& c.args.includes("--strict-mcp-config") && c.args.includes("--no-session-persistence"), JSON.stringify(c.args));
	await sleep(300);
	let cwdGone = false;
	try { readFileSync(c.cwd ?? ""); } catch (e) { cwdGone = e.code === "ENOENT"; }
	check("B12 CLI runs in a fresh private temp dir (usage-deck-*), removed afterwards", path.basename(c.cwd ?? "").startsWith("usage-deck-") && cwdGone, c.cwd);
	check("B13 API key / auth token (any case) / injected OAuth token are stripped; CLAUDE_CONFIG_DIR passes through",
		c.hasApiKey === false && c.hasAuthToken === false && c.hasOauthToken === false && c.configDir === TMP,
		JSON.stringify({ hasApiKey: c.hasApiKey, hasAuthToken: c.hasAuthToken, hasOauthToken: c.hasOauthToken, configDir: c.configDir }));

	// Manual refresh is limited to once a minute for the CLI source.
	const t = Date.now();
	h.keyDown("m0", CLAUDE, {}, 0);
	h.keyUp("m0", CLAUDE, { metric: "five_hour" }, 0);
	await h.waitFor(imageFor("m0"), { since: t, timeout: 3000 });
	check("B14 press within a minute reuses the last result (no new CLI run)", h.cliCalls().length === 1, `calls=${h.cliCalls().length}`);
	h.stop();
}
{
	const h = await startHost({ cli: "unsupported" });
	const t0 = Date.now();
	h.appear("f0", CLAUDE, { metric: "five_hour" }, 0);
	h.appear("f1", CLAUDE, { metric: "seven_day_model" }, 1);
	const f0 = await h.waitFor(settled("f0"), { since: t0 });
	const f1 = await h.waitFor(settled("f1"), { since: t0 });
	save("claude-text-fallback-5h", f0);
	save("claude-text-fallback-model", f1);
	check("B15 CLI without get_usage → falls back to '-p /usage' text (26%, Fable 80%)",
		f0 && textsOf(f0)[1] === "26%" && f1 && textsOf(f1)[0] === "Fable wk" && textsOf(f1)[1] === "80%", `${faceText(f0)} / ${faceText(f1)}`);
	check("B16 fallback ran '-p /usage' after the stream-json attempt", h.cliCalls().map((x) => (x.args.includes("/usage") ? "text" : "json")).join(",") === "json,text");
	h.stop();
}
for (const [mode, expected, label] of [
	["text-login", "Unavailable", "B17 no get_usage and no usage lines → 'Unavailable' (text can't tell signed-out from a failed fetch)"],
	["unavailable", "Unavailable", "B17b signed in but the CLI's usage fetch failed → 'Unavailable', not 'Run /login'"],
	["hang", "CLI timeout", "B18 CLI that never replies → 'CLI timeout'"],
	["text-hang", "CLI timeout", "B18b text fallback that never finishes → 'CLI timeout'"],
	["crash", "CLI error", "B19 CLI that crashes → 'CLI error'"]
]) {
	const h = await startHost({ cli: mode });
	const t0 = Date.now();
	h.appear("e0", CLAUDE, { metric: "five_hour" }, 0);
	const e0 = await h.waitFor(settled("e0"), { since: t0 });
	save(`claude-${mode}`, e0);
	check(label, !!e0 && textsOf(e0)[1] === expected, faceText(e0));
	h.stop();
}
{
	const h = await startHost({ cli: null, globals: { claudePath: path.join(TMP, "no-such-claude.exe") } });
	const t0 = Date.now();
	h.appear("x0", CLAUDE, { metric: "five_hour" }, 0);
	const x0 = await h.waitFor(settled("x0"), { since: t0 });
	save("claude-cli-missing", x0);
	check("B20 claude path that doesn't exist → 'No claude CLI'", !!x0 && textsOf(x0)[1] === "No claude CLI", faceText(x0));
	h.stop();
}
{
	const h = await startHost({ cli: "login" });
	h.appear("d0", CLAUDE, { metric: "seven_day_model" }, 0);
	const items = await h.models("d0");
	check("B21 no data → dropdown shows the error instead of loading forever",
		JSON.stringify(items) === JSON.stringify([{ label: "Run /login", value: "", disabled: true }]), JSON.stringify(items));
	h.stop();
}
for (const [variant, name, expect] of [
	["uncapped", "B25 extra usage with no limit → amount only, no % and no bar", (t, svg) => t[1] === "$12.30" && !svg.includes('y="98"')],
	["blocked", "B26 extra usage cap reached (disabled + out_of_credits) → 100%, critical colour", (t, svg) => t[1] === "100%" && svg.includes("#f87171") && t[2] === "$50.00/$50.00"]
]) {
	const h = await startHost({ cli: "ok", env: { FAKE_CLAUDE_VARIANT: variant } });
	const t0 = Date.now();
	h.appear("v0", CLAUDE, { metric: "extra_usage" }, 0);
	const v0 = await h.waitFor(settled("v0"), { since: t0 });
	save(`claude-extra-${variant}`, v0);
	check(name, !!v0 && expect(textsOf(v0), svgOf(v0)), faceText(v0));
	h.stop();
}
{
	const h = await startHost({ cli: "ok", env: { FAKE_CLAUDE_VARIANT: "stale" } });
	const t0 = Date.now();
	h.appear("s0", CLAUDE, { metric: "five_hour" }, 0);
	h.appear("s1", CLAUDE, { metric: "seven_day" }, 1);
	const s0 = await h.waitFor(settled("s0"), { since: t0 });
	const s1 = await h.waitFor(settled("s1"), { since: t0 });
	save("claude-stale-expired-window", s0);
	save("claude-stale-cached", s1);
	const dot = (m) => !!m && svgOf(m).includes('cx="130"');
	check("B27 CLI answered from its old cache (as_of 2 h ago) → value kept, stale dot shown", !!s1 && textsOf(s1)[1] === "81%" && dot(s1), faceText(s1));
	check("B28 window already past its reset → '—' instead of the old %, stale dot", !!s0 && textsOf(s0)[1] === "—" && dot(s0), faceText(s0));
	h.stop();
}
{
	const h = await startHost({ cli: "ok", env: { FAKE_CLAUDE_DELAY_MS: "1200" } });
	const t0 = Date.now();
	h.appear("i0", CLAUDE, { metric: "five_hour" }, 0);
	await sleep(400);
	h.setGlobals({ claudePath: "C:/changed/while/fetching/claude.exe" });
	const i0 = await h.waitFor(settled("i0"), { since: t0, timeout: 15000 });
	await sleep(300);
	check("B29 settings changed during a fetch → that result is dropped and a new fetch runs", !!i0 && h.cliCalls().length === 2, `calls=${h.cliCalls().length} ${faceText(i0)}`);
	h.stop();
}
{
	const h = await startHost({ cli: "ok" });
	h.appear("l0", CLAUDE, { metric: "seven_day_model", model: "fable" }, 0);
	const t = Date.now();
	await h.models("l0");
	const saved = await h.waitFor((m) => m.event === "setSettings" && m.context === "l0", { since: t, timeout: 5000 });
	check("B30 an old saved model name ('fable') is rewritten to the server's name when the settings open",
		saved?.payload?.model === "Fable" && saved?.payload?.metric === "seven_day_model", JSON.stringify(saved?.payload));
	h.stop();
}
if (!REAL_GITHUB) {
	const h = await startHost({ preload: MOCK_GITHUB, globals: { githubToken: "ghp_e2e_mock", githubOrg: "acme" } });
	const t0 = Date.now();
	h.appear("o0", GITHUB, { metric: "copilot" }, 0);
	const o0 = await h.waitFor(settled("o0"), { since: t0 });
	save("github-org-copilot", o0);
	check("B22 githubOrg → organization billing endpoint (Copilot billed to the org)",
		!!o0 && textsOf(o0)[1] === "9,025" && h.stderr.join("").includes("[github] /organizations/acme/settings/billing/usage/summary") && !h.stderr.join("").includes("[github] /user\n"),
		faceText(o0));
	h.stop();
}
if (!REAL_GITHUB) {
	const h = await startHost({ preload: MOCK_GITHUB, globals: { githubToken: "ghp_e2e_mock", githubOrg: "acme/../../user" } });
	const t0 = Date.now();
	h.appear("o1", GITHUB, { metric: "copilot" }, 0);
	const o1 = await h.waitFor(settled("o1"), { since: t0 });
	check("B23 an organization name that isn't one is refused before any request", !!o1 && textsOf(o1)[1] === "Bad org name" && !h.stderr.join("").includes("/organizations/"), faceText(o1));
	h.stop();
}
for (const [mode, expected, name] of REAL_GITHUB ? [] : [
	["no-access", "No access", "B24 no billing access (e.g. gh token without the user scope) → 'No access'; response body not logged"],
	["rate-limit", "Rate limit", "B25b 403 with x-ratelimit-remaining: 0 → 'Rate limit', not 'No access'"]
]) {
	const h = await startHost({ preload: MOCK_GITHUB, env: { MOCK_GITHUB: mode }, globals: { githubToken: "ghp_e2e_mock" } });
	const t0 = Date.now();
	h.appear("n0", GITHUB, { metric: "copilot" }, 0);
	const n0 = await h.waitFor(settled("n0"), { since: t0 });
	await sleep(300);
	const leaked = pluginLog().includes("e2e-body-must-not-be-logged") || h.stderr.join("").includes("e2e-body-must-not-be-logged");
	check(name, !!n0 && textsOf(n0)[1] === expected && !leaked, `${faceText(n0)}${leaked ? " (body leaked into the log)" : ""}`);
	h.stop();
}

// ---------------------------------------------------------------- Phase C: Japanese UI
console.log("\n=== Phase C: Stream Deck language = ja ===");
{
	const h = await startHost({ ...github(), language: "ja", cli: "login" });
	const t0 = Date.now();
	h.appear("jc", CLAUDE, { metric: "five_hour" }, 0);
	h.appear("jg", GITHUB, { metric: "actions", runner: "windows", budget: "2000" }, 1);
	const jc = await h.waitFor(settled("jc"), { since: t0 });
	save("ja-claude-signed-out", jc);
	check("C1 ja: label and CLI error are Japanese", !!jc && textsOf(jc)[0] === "Claude 5時間" && textsOf(jc)[1] === "要ログイン", faceText(jc));
	const size = jc && Number(svgOf(jc).match(/font-size="(\d+)"[^>]*>要ログイン/)?.[1]);
	check("C1b ja: full-width text is shrunk to fit the key (5 chars ≤ 25px)", !!size && size <= 25, `font-size=${size}`);
	const jg = await h.waitFor(settled("jg"), { since: t0 });
	save("ja-github-actions-budget", jg);
	check("C2 ja: budget line is Japanese", !!jg && /^上限2,000の\d+%$/.test(textsOf(jg)[2] ?? ""), faceText(jg));
	h.stop();
}
{
	const h = await startHost({ language: "ja", cli: "ok" });
	const t0 = Date.now();
	h.appear("j0", CLAUDE, { metric: "five_hour" }, 0);
	h.appear("j1", CLAUDE, { metric: "seven_day_model", model: "Opus" }, 1);
	h.appear("j2", CLAUDE, { metric: "seven_day" }, 2);
	h.appear("j3", CLAUDE, { metric: "seven_day_model" }, 3);
	const [j0, j1, j2, j3] = await Promise.all(["j0", "j1", "j2", "j3"].map((c) => h.waitFor(settled(c), { since: t0 })));
	[j0, j1, j2, j3].forEach((m, i) => save(`ja-claude-${i}`, m));
	check("C3 ja: reset countdown in 時間/分", !!j0 && /^↻ 2時間(10|11|12)分$/.test(textsOf(j0)[2] ?? ""), faceText(j0));
	check("C4 ja: days countdown in 日/時間", !!j2 && /^↻ 1日(5|6)時間$/.test(textsOf(j2)[2] ?? ""), faceText(j2));
	check("C5 ja: model label from the server name (Fable 週間)", !!j3 && textsOf(j3)[0] === "Fable 週間" && textsOf(j3)[1] === "98%", faceText(j3));
	check("C6 ja: unreported model → 未検出", !!j1 && textsOf(j1)[0] === "Opus 週間" && textsOf(j1)[2] === "未検出", faceText(j1));
	h.stop();
}

// ---------------------------------------------------------------- Phase R: the real CLI (opt-in)
if (process.env.E2E_REAL_CLAUDE === "1") {
	console.log("\n=== Phase R: real Claude Code CLI (auto-detected, your login) ===");
	// The user's real config dir (undefined → not set), not the scratch one the other phases use.
	const h = await startHost({ cli: null, env: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } });
	const t0 = Date.now();
	h.appear("R0", CLAUDE, { metric: "five_hour" }, 0);
	h.appear("R1", CLAUDE, { metric: "seven_day" }, 1);
	h.appear("R2", CLAUDE, { metric: "seven_day_model" }, 2);
	const [r0, r1, r2] = await Promise.all(["R0", "R1", "R2"].map((c) => h.waitFor(settled(c), { since: t0, timeout: 60000 })));
	[r0, r1, r2].forEach((m, i) => save(`real-claude-${i}`, m));
	const pct = (m) => !!m && /^\d+%$/.test(textsOf(m)[1] ?? "");
	check("R1 real CLI: 5h, weekly and a per-model week all show a percentage", pct(r0) && pct(r1) && pct(r2), `${faceText(r0)} / ${faceText(r1)} / ${faceText(r2)}`);
	console.log(`      took ${Date.now() - t0} ms`);
	h.stop();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
