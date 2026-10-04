// package.json "version" (x.y.z) is the single source of truth; the manifest needs x.y.z.0.
//   node scripts/sync-version.mjs          write it into manifest.json (run by `npm run release`)
//   node scripts/sync-version.mjs --check  fail if they differ (CI, packaging)
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const manifestUrl = new URL("com.noxitro.usagedeck.sdPlugin/manifest.json", root);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
	console.error(`package.json version must be x.y.z (no pre-release tag), got ${JSON.stringify(version)}`);
	process.exit(1);
}

const expected = `${version}.0`;
const text = readFileSync(manifestUrl, "utf8");
const current = JSON.parse(text).Version;

if (process.argv.includes("--check")) {
	if (current !== expected) {
		console.error(`manifest Version ${current} != package.json ${version} (run: node scripts/sync-version.mjs)`);
		process.exit(1);
	}
	console.log(`version ${expected} ok`);
} else if (current !== expected) {
	// Replace just the value so the manifest's formatting and line endings stay as they are.
	writeFileSync(manifestUrl, text.replace(/("Version"\s*:\s*")[^"]*(")/, `$1${expected}$2`));
	console.log(`manifest Version ${current} -> ${expected}`);
}
