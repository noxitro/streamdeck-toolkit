import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { FetchError } from "./poller";

export type UsageItem = {
	product: string;
	sku: string;
	grossQuantity: number;
	grossAmount: number;
	netQuantity: number;
	netAmount: number;
	unitType: string;
};

export type GitHubUsage = {
	/** The user or organization the usage belongs to. */
	account: string;
	year: number;
	month: number;
	items: UsageItem[];
};

export type GitHubAuth = {
	/** Personal access token. When unset, `gh auth token` is used. */
	githubToken?: string;
	/**
	 * Organization whose billing to show instead of the user's own. Needed when Copilot is billed to an
	 * organization/enterprise: that usage never appears in the user-level endpoints. Requires an org admin.
	 */
	githubOrg?: string;
};

let cachedLogin: { token: string; login: string } | undefined;

/** GitHub account names: alphanumerics and single hyphens, ≤ 39 chars. Anything else never reaches the URL. */
const ACCOUNT_NAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * Current month's usage from the enhanced billing platform:
 * `GET /users/{user}/settings/billing/usage/summary` (personal account; a `gh` OAuth token needs the `user`
 * scope, a fine-grained PAT the "Plan" read permission), or with `githubOrg`
 * `GET /organizations/{org}/settings/billing/usage/summary` (organization administrators only).
 */
export async function fetchGitHubUsage(auth: GitHubAuth): Promise<GitHubUsage> {
	const token = auth.githubToken?.trim() || (await ghCliToken());
	if (!token) throw new FetchError("err.noToken", "No GitHub token: run `gh auth login` or set a token");

	const org = auth.githubOrg?.trim();
	let route: string;
	let account: string;
	if (org) {
		if (!ACCOUNT_NAME.test(org)) throw new FetchError("err.badOrg", `invalid organization name: ${JSON.stringify(org)}`);
		route = `/organizations/${org}/settings/billing/usage/summary`;
		account = org;
	} else {
		if (cachedLogin?.token !== token) {
			const user = await api<{ login: string }>("/user", token);
			cachedLogin = { token, login: user.login };
		}
		route = `/users/${cachedLogin.login}/settings/billing/usage/summary`;
		account = cachedLogin.login;
	}

	const summary = await api<{ timePeriod: { year: number; month: number }; usageItems: UsageItem[] }>(route, token);
	return { account, year: summary.timePeriod.year, month: summary.timePeriod.month, items: summary.usageItems ?? [] };
}

async function ghCliToken(): Promise<string | undefined> {
	try {
		const { stdout } = await promisify(execFile)("gh", ["auth", "token"], { windowsHide: true, timeout: 10_000 });
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function api<T>(route: string, token: string): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`https://api.github.com${route}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "usage-deck-streamdeck-plugin"
			},
			signal: AbortSignal.timeout(15_000)
		});
	} catch (e) {
		throw new FetchError("err.offline", `${route}: ${String(e)}`);
	}
	if (res.ok) return (await res.json()) as T;

	// Status and headers only: error bodies can echo account details into the plugin log.
	await res.body?.cancel();
	const rateLimited = res.status === 429 || res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after");
	if (rateLimited) throw new FetchError("err.rateLimit", `${res.status} ${route} (rate limited)`, true);
	if (res.status === 401) throw new FetchError("err.auth", `401 ${route}`);
	if (res.status === 403 || res.status === 404) {
		const hint = route.startsWith("/organizations/")
			? "needs an organization administrator token"
			: "a gh token needs the user scope (gh auth refresh -h github.com -s user); a fine-grained PAT needs Plan: read";
		throw new FetchError("err.noAccess", `${res.status} ${route}: ${hint}`);
	}
	throw new FetchError("err.http", `${res.status} ${route}`, res.status >= 500, { status: res.status });
}
