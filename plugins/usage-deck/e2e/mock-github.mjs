// Preloaded into the plugin process: fakes api.github.com so the GitHub checks need no account or network.
// MOCK_GITHUB: ok (default) | no-access (403/404 like a token without the user scope) | rate-limit
// Requests are echoed to stderr as "[github] <path>" for the harness to assert on.
const real = globalThis.fetch;
const mode = process.env.MOCK_GITHUB ?? "ok";

const summary = (account, extra) => ({
	timePeriod: { year: 2026, month: 10 },
	...extra,
	usageItems: [
		// Made-up figures (shape copied from a real reply).
		{ product: "Actions", sku: "actions_linux", unitType: "minutes", grossQuantity: 400, grossAmount: 2.4, netQuantity: 0, netAmount: 0 },
		{ product: "Actions", sku: "actions_windows", unitType: "minutes", grossQuantity: 1200, grossAmount: 12, netQuantity: 0, netAmount: 0 },
		{ product: "Actions", sku: "actions_storage", unitType: "gigabyte-hours", grossQuantity: 50, grossAmount: 0.02, netQuantity: 0, netAmount: 0 },
		{ product: "Copilot", sku: "copilot_ai_unit", unitType: "ai-units", grossQuantity: account === "acme" ? 9000 : 500, grossAmount: account === "acme" ? 90 : 5, netQuantity: 0, netAmount: 0 },
		{ product: "Copilot", sku: "coding_agent_ai_unit", unitType: "ai-units", grossQuantity: 25, grossAmount: 0.25, netQuantity: 0, netAmount: 0 }
	]
});

globalThis.fetch = async (url, init) => {
	const u = new URL(String(url));
	if (u.hostname !== "api.github.com") return real(url, init);
	process.stderr.write(`[github] ${u.pathname}\n`);
	if (mode === "rate-limit") return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
	if (u.pathname === "/user") return Response.json({ login: "e2e-user" });
	if (mode === "no-access") return new Response('{"message":"Not Found","secret_detail":"e2e-body-must-not-be-logged"}', { status: 404 });
	if (u.pathname === "/users/e2e-user/settings/billing/usage/summary") return Response.json(summary("e2e-user", { user: "e2e-user" }));
	if (u.pathname === "/organizations/acme/settings/billing/usage/summary") return Response.json(summary("acme", { organization: "acme" }));
	return new Response('{"message":"Not Found"}', { status: 404 });
};
