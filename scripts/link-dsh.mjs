#!/usr/bin/env node
/**
 * Link the DeepSeek Harness packages a plugin needs into this repo's
 * node_modules, so `tsc` can typecheck yee-stack-dsh against the harness
 * that is actually installed.
 *
 * The harness ships its component packages nested inside the dsh install.
 * A plugin declares them as peer dependencies (the harness resolves them at
 * runtime); for typechecking they have to be resolvable from this checkout.
 *
 *   node scripts/link-dsh.mjs [path-to-dsh-package]
 *
 * The default is the globally installed @deepseek-ai/dsh. Symlinks only —
 * nothing is copied, and existing entries are left alone.
 */

import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveDshRoot(explicit) {
	if (explicit) return resolve(explicit);
	const candidates = [];
	if (process.env.DSH_PACKAGE) candidates.push(process.env.DSH_PACKAGE);
	try {
		candidates.push(dirname(fileURLToPath(import.meta.resolve("@deepseek-ai/dsh/package.json"))));
	} catch {
		// Not resolvable from here; fall through to the global location.
	}
	const nodeRoot = dirname(dirname(process.execPath));
	candidates.push(join(nodeRoot, "lib", "node_modules", "@deepseek-ai", "dsh"));
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "package.json"))) return candidate;
	}
	throw new Error("cannot find the @deepseek-ai/dsh package; pass its path as the first argument");
}

let dshRoot;
try {
	dshRoot = resolveDshRoot(process.argv[2]);
} catch (error) {
	// A fresh clone on a machine without the harness still installs fine; only
	// yee-stack-dsh's typecheck/build needs the links.
	if (process.argv[2]) throw error;
	console.log("link-dsh: no @deepseek-ai/dsh install found; skipping (pass a path to link one)");
	process.exit(0);
}
const nested = join(dshRoot, "node_modules", "@deepseek-ai");
if (!existsSync(nested)) throw new Error(`${nested} does not exist — is that a dsh install?`);

const target = join(repoRoot, "node_modules", "@deepseek-ai");
mkdirSync(target, { recursive: true });

let linked = 0;
for (const name of readdirSync(nested)) {
	const source = join(nested, name);
	const destination = join(target, name);
	if (existsSync(destination)) continue;
	symlinkSync(source, destination, "dir");
	linked += 1;
}

// zod backs session projections; the harness installs it, not us.
const zodSource = join(dshRoot, "node_modules", "zod");
const zodTarget = join(repoRoot, "node_modules", "zod");
if (existsSync(zodSource) && !existsSync(zodTarget)) {
	symlinkSync(zodSource, zodTarget, "dir");
	linked += 1;
}

console.log(`linked ${linked} package(s) from ${dshRoot}`);
