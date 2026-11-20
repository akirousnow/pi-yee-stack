import assert from "node:assert/strict";
import { findBuiltinShortcutConflict } from "./shortcut.ts";

// Built-in conflict detection uses pi-tui's default bindings outside Pi.
assert.ok(findBuiltinShortcutConflict("ctrl+a"), "ctrl+a is cursorLineStart");
assert.ok(findBuiltinShortcutConflict("CTRL+A"), "case-insensitive");
assert.equal(findBuiltinShortcutConflict("ctrl+alt+w"), undefined);
assert.equal(findBuiltinShortcutConflict("ctrl+alt+a"), undefined);

console.log("yee-stack pi shortcut tests passed");
