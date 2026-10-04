// Property inspector translations. `__MSG_key__` in labels/placeholders/option text is replaced with
// the string for the UI language (falls back to English); blocks marked data-lang="xx" are kept only
// for the matching language.
(() => {
	const LOCALES = {
		en: {
			metric: "Metric",
			warnAt: "Warn at %",
			critAt: "Critical at %",
			pace: "Pace marker",
			paceLabel: "Show elapsed time on the bar",
			claudePath: "claude path",
			claudePathPlaceholder: "auto-detect",
			howTo: "How to connect",
			"claude_five_hour": "5-hour session",
			"claude_seven_day": "Weekly (all models)",
			"claude_seven_day_model": "Weekly, by model",
			model: "Model",
			modelPlaceholder: "Weekly limits are per model",
			loading: "Loading…",
			"claude_extra_usage": "Extra usage credits",
			"gh_copilot": "Copilot AI units",
			"gh_actions": "Actions minutes",
			runner: "Runner",
			"runner_all": "All (Actions only)",
			budget: "Monthly budget",
			budgetPlaceholder: "e.g. 2000 (optional)",
			amount: "Amount",
			"amount_gross": "Gross (before included usage)",
			"amount_net": "Net (billed)",
			token: "Token",
			tokenPlaceholder: "blank = use gh CLI",
			githubOrg: "Organization",
			githubOrgPlaceholder: "blank = your own account (admins only)"
		},
		ja: {
			metric: "表示項目",
			warnAt: "警告 (%)",
			critAt: "危険 (%)",
			pace: "ペース表示",
			paceLabel: "経過時間の目盛りをバーに表示",
			claudePath: "claude のパス",
			claudePathPlaceholder: "自動検出",
			howTo: "接続方法",
			"claude_five_hour": "5時間枠",
			"claude_seven_day": "週間(全モデル)",
			"claude_seven_day_model": "週間(モデル別)",
			model: "モデル",
			modelPlaceholder: "週間制限はモデルごとです",
			loading: "読み込み中…",
			"claude_extra_usage": "追加利用クレジット",
			"gh_copilot": "Copilot AI units",
			"gh_actions": "Actions 使用時間(分)",
			runner: "ランナー",
			"runner_all": "すべて(Actions のみ)",
			budget: "月の上限",
			budgetPlaceholder: "例: 2000(任意)",
			amount: "金額",
			"amount_gross": "総額(無料枠を含む)",
			"amount_net": "請求額",
			token: "トークン",
			tokenPlaceholder: "空欄なら gh CLI を使用",
			githubOrg: "組織名",
			githubOrgPlaceholder: "空欄なら自分のアカウント(管理者のみ)"
		}
	};

	// `?lang=ja` overrides detection (for previewing the page in a browser).
	const nav = (new URLSearchParams(location.search).get("lang") || navigator.language || "en").split("-")[0];
	const lang = nav in LOCALES ? nav : "en";
	const msg = (key) => LOCALES[lang][key] ?? LOCALES.en[key] ?? key;
	const replace = (s) => s.replace(/__MSG_([\w.]+)__/g, (_, key) => msg(key));

	// sdpi-components resolves __MSG_ in its own attributes from this table.
	window.SDPIComponents.i18n.locales = LOCALES;
	window.SDPIComponents.i18n.language = lang;

	const localize = (root) => {
		for (const el of root.querySelectorAll("[data-lang]")) if (el.dataset.lang !== lang) el.remove();
		for (const el of root.querySelectorAll("*")) {
			for (const { name, value } of [...el.attributes]) {
				if (value.includes("__MSG_")) el.setAttribute(name, replace(value));
			}
		}
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.includes("__MSG_")) n.nodeValue = replace(n.nodeValue);
	};
	document.documentElement.lang = lang;
	document.addEventListener("DOMContentLoaded", () => localize(document.body));
})();
