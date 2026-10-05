// Stand-in for the Claude Code CLI (run by the plugin via USAGE_DECK_CLAUDE_CLI).
// FAKE_CLAUDE_MODE: ok | login | unavailable | unsupported | text-login | text-hang | hang | crash
// FAKE_CLAUDE_VARIANT (with ok): uncapped | blocked | stale — changes the usage body.
// FAKE_CLAUDE_DELAY_MS: wait before replying to get_usage.
// Each invocation is appended to FAKE_CLAUDE_LOG as JSON (args, cwd, a few env facts) for the harness to assert on.
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const mode = process.env.FAKE_CLAUDE_MODE ?? "ok";
const variant = process.env.FAKE_CLAUDE_VARIANT;
const args = process.argv.slice(2);
const hasEnv = (name) => Object.keys(process.env).some((k) => k.toUpperCase() === name);
if (process.env.FAKE_CLAUDE_LOG) {
	appendFileSync(
		process.env.FAKE_CLAUDE_LOG,
		JSON.stringify({
			args,
			cwd: process.cwd(),
			// Compared case-insensitively on every OS, so a lowercase "anthropic_auth_token" counts as present
			// on Linux/macOS too (there `in process.env` is case-sensitive and would miss it).
			hasApiKey: hasEnv("ANTHROPIC_API_KEY"),
			hasAuthToken: hasEnv("ANTHROPIC_AUTH_TOKEN"),
			hasOauthToken: hasEnv("CLAUDE_CODE_OAUTH_TOKEN"),
			configDir: process.env.CLAUDE_CONFIG_DIR ?? null
		}) + "\n"
	);
}
if (mode === "crash") process.exit(3);

const h = (hours) => new Date(Date.now() + hours * 3600e3).toISOString();

// Shape copied from a real `get_usage` reply (CLI 2.1.251); values changed.
const RATE_LIMITS = {
	five_hour: { utilization: 37, resets_at: h(2.2), limit_dollars: null, used_dollars: null },
	seven_day: { utilization: 81, resets_at: h(30) },
	seven_day_oauth_apps: null,
	seven_day_opus: null,
	seven_day_sonnet: { utilization: 95, resets_at: h(30) },
	nimbus_quill: { utilization: 0, resets_at: null },
	iguana_necktie: { utilization: 0, resets_at: null, limit_dollars: null, used_dollars: null },
	extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1230, utilization: 24.6, currency: "USD", decimal_places: 2, disabled_reason: null },
	limits: [
		{ kind: "session", group: "session", percent: 37, severity: "normal", resets_at: h(2.2), scope: null, is_active: false },
		{ kind: "weekly_all", group: "weekly", percent: 81, severity: "normal", resets_at: h(30), scope: null, is_active: false },
		{ kind: "weekly_scoped", group: "weekly", percent: 98, severity: "warning", resets_at: h(30), scope: { model: { id: null, display_name: "Fable" }, surface: null }, is_active: true }
	],
	spend: {
		used: { amount_minor: 1230, currency: "USD", exponent: 2 },
		limit: { amount_minor: 5000, currency: "USD", exponent: 2 },
		percent: 24.6,
		severity: "normal",
		enabled: true,
		disabled_reason: null
	},
	model_scoped: [{ display_name: "Fable", utilization: 98, resets_at: h(30) }],
	seven_day_breakdown: { as_of: new Date().toISOString(), rows: [] }
};
if (variant === "uncapped") RATE_LIMITS.spend = { ...RATE_LIMITS.spend, limit: null, percent: 0 };
if (variant === "blocked") {
	RATE_LIMITS.spend = { ...RATE_LIMITS.spend, enabled: false, disabled_reason: "out_of_credits", percent: null, used: { amount_minor: 5000, currency: "USD", exponent: 2 } };
}
if (variant === "stale") {
	// What the CLI returns from its ~/.claude.json cache when the live fetch fails: an old body.
	RATE_LIMITS.seven_day_breakdown = { as_of: h(-2), rows: [] };
	RATE_LIMITS.limits[0] = { ...RATE_LIMITS.limits[0], resets_at: h(-0.5) };
}

const USAGE_TEXT = `You are currently using your subscription to power your Claude Code usage

Current session: 26% used · resets Jan 1, 9am (UTC)
Current week (all models): 70% used · resets Jan 5, 12am (UTC)
Current week (Fable): 80% used · resets Jan 5, 12am (UTC)

What's contributing to your limits usage?
Last 24h · 100 requests · 5 sessions`;

if (args.includes("/usage")) {
	if (mode === "text-hang") {
		setInterval(() => {}, 1 << 30);
	} else {
		const result = mode === "text-login" ? "You are currently using your subscription\n\nWhat's contributing to your limits usage?" : USAGE_TEXT;
		process.stdout.write(JSON.stringify({ type: "result", subtype: "success", num_turns: 0, total_cost_usd: 0, result }) + "\n");
		process.exit(0);
	}
} else if (args.includes("stream-json")) {
	const rl = readline.createInterface({ input: process.stdin });
	rl.on("line", (line) => {
		const msg = JSON.parse(line);
		if (msg.type !== "control_request" || msg.request?.subtype !== "get_usage") return;
		const reply = (response) => process.stdout.write(JSON.stringify({ type: "control_response", response }) + "\n");
		if (mode === "hang") return;
		if (mode === "unsupported" || mode === "text-login" || mode === "text-hang") {
			return reply({ subtype: "error", request_id: msg.request_id, error: "Unsupported control request subtype: get_usage" });
		}
		const response =
			mode === "login"
				? { subscription_type: null, rate_limits_available: false, rate_limits: null }
				: mode === "unavailable"
					? { subscription_type: "max", rate_limits_available: true, rate_limits: null }
					: { subscription_type: "max", rate_limits_available: true, rate_limits: RATE_LIMITS };
		setTimeout(() => reply({ subtype: "success", request_id: msg.request_id, response }), Number(process.env.FAKE_CLAUDE_DELAY_MS) || 0);
	});
	rl.on("close", () => setTimeout(() => process.exit(0), Number(process.env.FAKE_CLAUDE_DELAY_MS) || 0));
}
