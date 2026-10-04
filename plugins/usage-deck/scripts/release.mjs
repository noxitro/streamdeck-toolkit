// Bumps this plugin's version, syncs the manifest, commits, and tags <plugin>-vX.Y.Z.
//   npm run release -- patch|minor|major|X.Y.Z
// Then `git push --follow-tags` starts the Release workflow.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const bump = process.argv[2];
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump ?? "")) {
	console.error("usage: npm run release -- patch|minor|major|X.Y.Z");
	process.exit(1);
}
const plugin = path.basename(process.cwd()); // run from plugins/<plugin> (npm run sets the cwd)
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const node = (...args) => execFileSync(process.execPath, args, { stdio: "inherit" });

if (git("status", "--porcelain", "--", ".")) {
	console.error(`plugins/${plugin} has uncommitted changes; commit or stash them first`);
	process.exit(1);
}

// npm_execpath is npm's own JS entry when run via `npm run`, so no shell is needed on Windows.
node(process.env.npm_execpath, "version", bump, "--no-git-tag-version");
node("scripts/sync-version.mjs");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `${plugin}-v${version}`;

git("add", "package.json", "package-lock.json", "com.noxitro.usagedeck.sdPlugin/manifest.json");
git("commit", "-m", `${plugin} v${version}`);
git("tag", "-a", tag, "-m", `${plugin} v${version}`);
console.log(`\ncommitted and tagged ${tag}; publish with: git push --follow-tags`);
