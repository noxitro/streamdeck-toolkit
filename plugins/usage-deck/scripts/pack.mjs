// Builds, validates and packages the plugin into dist/com.noxitro.usagedeck.streamDeckPlugin.
// The file name stays the plugin UUID (what Stream Deck expects); the version is in the manifest and the release tag.
// Tools are run as `node <entry>` (no shell), which works the same on Windows and Linux.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const PLUGIN = "com.noxitro.usagedeck.sdPlugin";
const node = (script, ...args) => execFileSync(process.execPath, [script, ...args], { stdio: "inherit" });
const STREAMDECK = "node_modules/@elgato/cli/bin/streamdeck.mjs";
const ROLLUP = "node_modules/rollup/dist/bin/rollup";

node("scripts/sync-version.mjs", "--check");
// Packaged as-is, so no logs from local runs may be inside the plugin folder.
rmSync(`${PLUGIN}/logs`, { recursive: true, force: true });
node(ROLLUP, "-c");
node(STREAMDECK, "validate", PLUGIN, "--no-update-check");
node(STREAMDECK, "pack", PLUGIN, "--output", "dist", "--force", "--no-update-check");

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
console.log(`\npackaged v${version}: dist/com.noxitro.usagedeck.streamDeckPlugin`);
