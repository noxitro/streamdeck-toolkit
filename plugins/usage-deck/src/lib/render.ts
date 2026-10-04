export type Level = "ok" | "warn" | "crit" | "neutral" | "error";

export type KeyFace = {
	label: string;
	value: string;
	sub?: string;
	/** Fill of the bar, 0–100. No bar when undefined. */
	percent?: number;
	/** Even-pace marker on the bar, 0–100 (how much of the window has elapsed). */
	marker?: number;
	level: Level;
	/** Data is from an earlier fetch because the latest one failed. */
	stale?: boolean;
};

const COLORS: Record<Level, string> = {
	ok: "#34d399",
	warn: "#fbbf24",
	crit: "#f87171",
	neutral: "#e5e7eb",
	error: "#fbbf24"
};

const FONT = "'Segoe UI', 'Yu Gothic UI', 'Hiragino Sans', 'Helvetica Neue', Arial, sans-serif";

/** Renders a 144×144 key image as an SVG data URL. */
export function renderKey(face: KeyFace): string {
	const color = COLORS[face.level];
	const parts: string[] = [
		`<rect width="144" height="144" fill="#101114"/>`,
		text(72, 30, face.label, fit(face.label, 20, 132), "#a1a1aa", 600),
		text(72, face.percent === undefined ? 88 : 82, face.value, fit(face.value, 46, 128), color, 700)
	];

	if (face.percent !== undefined) {
		const w = 116 * clamp(face.percent / 100);
		parts.push(
			`<rect x="14" y="98" width="116" height="10" rx="5" fill="#2a2b31"/>`,
			w > 0 ? `<rect x="14" y="98" width="${w.toFixed(1)}" height="10" rx="5" fill="${color}"/>` : ""
		);
		if (face.marker !== undefined) {
			const x = 14 + 116 * clamp(face.marker / 100);
			parts.push(`<rect x="${(x - 1.5).toFixed(1)}" y="94" width="3" height="18" rx="1.5" fill="#f4f4f5"/>`);
		}
	}
	if (face.sub) parts.push(text(72, 132, face.sub, fit(face.sub, 18, 136), "#d4d4d8", 500));
	if (face.stale) parts.push(`<circle cx="130" cy="14" r="6" fill="${COLORS.warn}"/>`);

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

export function levelFor(percent: number, warnAt: number, critAt: number): Level {
	return percent >= critAt ? "crit" : percent >= warnAt ? "warn" : "ok";
}

/** 1234 → "1,234", 12345 → "12.3k". */
export function formatCompact(n: number): string {
	if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
	return Math.round(n).toLocaleString("en-US");
}

/** Largest font size (≤ max) at which `s` fits in `width` px. CJK glyphs are full-width, Latin ≈ 0.58em. */
function fit(s: string, max: number, width: number): number {
	const ems = [...s].reduce((n, c) => n + ((c.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : 0.58), 0);
	return ems === 0 ? max : Math.min(max, Math.floor(width / ems));
}

function clamp(v: number): number {
	return Math.min(1, Math.max(0, v));
}

function text(x: number, y: number, s: string, size: number, fill: string, weight: number): string {
	return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(s)}</text>`;
}

function escapeXml(s: string): string {
	return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
