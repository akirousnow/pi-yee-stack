import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ConfigStore,
	DEFAULT_ASK_SHORTCUT,
	DEFAULT_WISH_SHORTCUT,
	defaultConfig,
	loadConfig,
	normalizeConfig,
	type ConfigPaths,
} from "./config.ts";

const dir = mkdtempSync(join(tmpdir(), "yee-config-test-"));
let counter = 0;
function freshPaths(): ConfigPaths {
	const sub = join(dir, `case-${counter++}`);
	mkdirSync(sub, { recursive: true });
	return { config: join(sub, "yee-stack.json"), legacyWish: join(sub, "wish-specializer.json") };
}

try {
	// ── defaults ──────────────────────────────────────────────────────────
	assert.deepEqual(normalizeConfig(undefined), defaultConfig());
	assert.deepEqual(normalizeConfig("nope"), defaultConfig());
	assert.deepEqual(normalizeConfig([]), defaultConfig());
	assert.deepEqual(loadConfig(freshPaths()), defaultConfig());
	assert.equal(defaultConfig().wish.shortcut, "ctrl+alt+w");
	assert.equal(defaultConfig().ask.shortcut, "ctrl+alt+a");

	// ── field validation ──────────────────────────────────────────────────
	const odd = normalizeConfig({
		wish: {
			model: { provider: "magpie", id: "auto/x" },
			tier: "heavy",
			shortcut: "  CTRL+ALT+K ",
		},
		ask: { shortcut: "f9", extraTools: [" web_search ", "web_search", 7, "", "fetch"] },
	});
	assert.deepEqual(odd.wish.model, { provider: "magpie", id: "auto/x" });
	assert.equal(odd.wish.tier, "heavy");
	assert.equal(odd.wish.shortcut, "ctrl+alt+k");
	assert.equal(odd.ask.shortcut, "f9");
	assert.deepEqual(odd.ask.extraTools, ["web_search", "fetch"]);

	const junk = normalizeConfig({
		wish: { model: { provider: "x" }, tier: "extreme", shortcut: "w" },
		ask: { shortcut: 42, extraTools: "bash" },
	});
	assert.equal(junk.wish.model, null, "model without id is dropped");
	assert.equal(junk.wish.tier, "standard");
	assert.equal(junk.wish.shortcut, DEFAULT_WISH_SHORTCUT, "bare letter is not a valid shortcut");
	assert.equal(junk.ask.shortcut, DEFAULT_ASK_SHORTCUT);
	assert.deepEqual(junk.ask.extraTools, []);

	// explicit null disables a shortcut; absence means "use the default"
	const disabled = normalizeConfig({ wish: { shortcut: null }, ask: { shortcut: null } });
	assert.equal(disabled.wish.shortcut, null);
	assert.equal(disabled.ask.shortcut, null);
	assert.equal(normalizeConfig({ wish: {}, ask: {} }).ask.shortcut, DEFAULT_ASK_SHORTCUT);

	// extraTools is capped
	const many = normalizeConfig({ ask: { extraTools: Array.from({ length: 200 }, (_, i) => `t${i}`) } });
	assert.equal(many.ask.extraTools.length, 64);

	// ── shortcut collision: Wish wins ─────────────────────────────────────
	{
		const paths = freshPaths();
		writeFileSync(paths.config, JSON.stringify({ wish: { shortcut: "ctrl+alt+a" } }));
		const store = new ConfigStore(paths);
		assert.equal(store.get().wish.shortcut, "ctrl+alt+a");
		assert.equal(store.get().ask.shortcut, null, "Ask yields to Wish");
		assert.equal(store.hadShortcutCollision, true);

		const clean = new ConfigStore(freshPaths());
		assert.equal(clean.hadShortcutCollision, false);

		const optOut = freshPaths();
		writeFileSync(optOut.config, JSON.stringify({ wish: { shortcut: "ctrl+alt+a" }, ask: { shortcut: null } }));
		assert.equal(new ConfigStore(optOut).hadShortcutCollision, false, "an explicit opt-out is not a collision");
	}

	// ── legacy wish-specializer.json import ───────────────────────────────
	{
		const paths = freshPaths();
		writeFileSync(
			paths.legacyWish,
			JSON.stringify({ model: { provider: "magpie", id: "m1" }, tier: "light", shortcut: "ctrl+alt+j" }),
		);
		const store = new ConfigStore(paths);
		assert.deepEqual(store.get().wish, {
			model: { provider: "magpie", id: "m1" },
			tier: "light",
			shortcut: "ctrl+alt+j",
		});
		assert.equal(store.get().ask.shortcut, DEFAULT_ASK_SHORTCUT);

		// First save writes yee-stack.json and keeps the legacy file untouched.
		store.update((draft) => {
			draft.ask.extraTools = ["web_search"];
		});
		const written = JSON.parse(readFileSync(paths.config, "utf8"));
		assert.equal(written.version, 1);
		assert.equal(written.wish.tier, "light", "legacy values survive the first save");
		assert.deepEqual(written.ask.extraTools, ["web_search"]);
		assert.equal(JSON.parse(readFileSync(paths.legacyWish, "utf8")).tier, "light");

		// Once yee-stack.json exists the legacy file is ignored.
		writeFileSync(paths.legacyWish, JSON.stringify({ tier: "heavy" }));
		assert.equal(loadConfig(paths).wish.tier, "light");
	}

	// ── a corrupt yee-stack.json means defaults, not the legacy file ───────
	{
		const paths = freshPaths();
		writeFileSync(paths.config, "{ not json");
		writeFileSync(paths.legacyWish, JSON.stringify({ tier: "heavy" }));
		assert.deepEqual(loadConfig(paths), defaultConfig());
	}

	// ── update(): persists, re-reads disk, validates ──────────────────────
	{
		const paths = freshPaths();
		const a = new ConfigStore(paths);
		const b = new ConfigStore(paths); // a second Pi process

		a.update((d) => {
			d.wish.tier = "heavy";
		});
		// b still holds stale in-memory state, but its update starts from disk.
		assert.equal(b.get().wish.tier, "standard");
		b.update((d) => {
			d.ask.shortcut = "f8";
		});
		const onDisk = loadConfig(paths);
		assert.equal(onDisk.wish.tier, "heavy", "b did not clobber a's change");
		assert.equal(onDisk.ask.shortcut, "f8");
		assert.equal(b.get().wish.tier, "heavy");

		// invalid mutations are normalized away rather than persisted
		a.update((d) => {
			(d.wish as { tier: string }).tier = "bogus";
			d.ask.shortcut = "q";
		});
		assert.equal(loadConfig(paths).wish.tier, "standard");
		assert.equal(loadConfig(paths).ask.shortcut, DEFAULT_ASK_SHORTCUT);

		// no temp files are left behind
		const leftovers = readdirSync(join(paths.config, "..")).filter((name) => name.endsWith(".tmp"));
		assert.deepEqual(leftovers, []);

		// refresh() picks up outside edits
		writeFileSync(paths.config, JSON.stringify({ wish: { tier: "light" } }));
		assert.equal(a.refresh().wish.tier, "light");
	}

	// ── a failed write leaves the in-memory config unchanged ──────────────
	{
		const paths = freshPaths();
		// Make the config path a directory so renaming over it fails.
		mkdirSync(paths.config, { recursive: true });
		const store = new ConfigStore(paths);
		assert.throws(() =>
			store.update((d) => {
				d.wish.tier = "heavy";
			}),
		);
		assert.equal(store.get().wish.tier, "standard");
	}

	console.log("yee-stack config tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
