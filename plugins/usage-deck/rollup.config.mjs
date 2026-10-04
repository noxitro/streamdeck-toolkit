import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.noxitro.usagedeck.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	plugins: [
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			},
		},
		typescript({
			mapRoot: isWatching ? "./" : undefined
		}),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching && terser(),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		},
		{
			// Minification drops the license comments of bundled packages; ship their notices next to the bundle.
			name: "third-party-notices",
			generateBundle(_, bundle) {
				const used = new Set();
				for (const chunk of Object.values(bundle)) {
					if (chunk.type !== "chunk") continue;
					for (const id of Object.keys(chunk.modules)) {
						const dir = packageDirOf(id);
						if (dir) used.add(dir);
					}
				}
				const notices = [...used].sort().map(noticeFor);
				this.emitFile({
					type: "asset",
					fileName: "THIRD_PARTY_NOTICES.txt",
					source: `Third-party software bundled in plugin.js\n\n${notices.join("\n\n" + "-".repeat(72) + "\n\n")}\n`
				});
			}
		}
	]
};

/** The node_modules package directory a module belongs to (scoped packages included), or undefined for own code. */
function packageDirOf(id) {
	const parts = id.replace(/^\0/, "").split(/[\\/]/);
	const i = parts.lastIndexOf("node_modules");
	if (i < 0) return undefined;
	const name = parts[i + 1]?.startsWith("@") ? parts.slice(i + 1, i + 3) : parts.slice(i + 1, i + 2);
	return [...parts.slice(0, i + 1), ...name].join("/");
}

function noticeFor(dir) {
	const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
	const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
	if (!file) throw new Error(`no license file in ${pkg.name}; add its notice by hand before distributing`);
	return `${pkg.name}@${pkg.version} (${pkg.license})\n\n${fs.readFileSync(path.join(dir, file), "utf8").trim()}`;
}

export default config;
