#!/usr/bin/env node
/**
 * Bundle a host package's Node half into one file.
 *
 * Only the two host packages (`pi-yee-stack`, `yee-stack-dsh`) are published;
 * the four shared packages are `private` and inlined here. This script is the
 * one step that makes that true:
 *
 *   src/index.ts  ->  dist/index.js      (pi-yee-stack)
 *   src/index.ts  ->  lib/index.js       (yee-stack-dsh)
 *
 * Everything in `bundle.external` — harness packages, the MCP server, `zod`,
 * `node:*` — stays a real import, so the installed package still resolves them
 * from its own dependency tree.
 *
 * `import.meta.url` in the bundle is the bundle's own file, which is exactly
 * where the package's dependencies live: that is what lets
 * `createRequire(import.meta.url).resolve("chrome-devtools-mcp")` work after a
 * plain `npm install`.
 *
 *   node scripts/build-host.mjs [package-dir]
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(process.argv[2] ?? join(repoRoot, "packages", "pi"));
const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));

const bundle = pkg.bundle;
if (bundle === undefined) {
	console.log(`build-host: ${pkg.name} declares no "bundle" section; nothing to build`);
	process.exit(0);
}

// Runtime dependencies stay external unless the host inlines them on purpose.
// `packages: "bundle"` would externalize every bare import, which would leave
// the private shared packages as runtime imports — the opposite of the point.
const inline = new Set(bundle.inline ?? []);
const externals = [
	...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).filter((name) => !inline.has(name)),
	...Object.keys(pkg.devDependencies ?? {}).filter((name) => name.startsWith("@deepseek-ai/") && !inline.has(name)),
];

const result = await build({
	entryPoints: [join(packageDir, bundle.entry ?? "src/index.ts")],
	outfile: join(packageDir, bundle.outfile ?? "dist/index.js"),
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	target: "node22",
	charset: "utf8",
	legalComments: "none",
	sourcemap: false,
	external: [...new Set(externals)],
	// `node:` builtins are external by construction on platform "node".
	logLevel: "warning",
	banner: {
		js: `/* ${pkg.name} ${pkg.version} — bundled by scripts/build-host.mjs; do not edit. */`,
	},
});

const output = result.outputFiles[0];
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync(dirname(output.path), { recursive: true });
writeFileSync(output.path, output.text);
console.log(`build-host: wrote ${output.path} (${(output.text.length / 1024).toFixed(1)} KiB)`);
