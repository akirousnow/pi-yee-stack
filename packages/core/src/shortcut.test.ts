import assert from "node:assert/strict";
import { displayShortcut, isShortcutShapeValid, normalizeShortcut, shortcutLabel } from "./shortcut.ts";

// Valid: a real modifier plus letter/digit, or an F-key.
for (const ok of ["ctrl+alt+w", "ctrl+a", "alt+1", "super+k", "ctrl+shift+p", "f5", "shift+f12", "CTRL+ALT+W", "  ctrl+alt+a  "]) {
	assert.equal(isShortcutShapeValid(ok), true, ok);
}

// Invalid: bare keys (would swallow typing), shift-only, unknown keys, junk.
for (const bad of ["w", "a", "1", "shift+a", "enter", "ctrl+enter", "ctrl+alt", "ctrl+", "f13", "f0", "ctrl+alt+ww", "", "ctrl+alt+w+x"]) {
	assert.equal(isShortcutShapeValid(bad), false, JSON.stringify(bad));
}

assert.equal(normalizeShortcut("  CTRL+ALT+W "), "ctrl+alt+w");
assert.equal(normalizeShortcut("w"), undefined);
assert.equal(normalizeShortcut(null), undefined);
assert.equal(normalizeShortcut(42), undefined);

assert.equal(displayShortcut("ctrl+alt+w"), "Ctrl+Alt+W");
assert.equal(displayShortcut("f5"), "F5");
assert.equal(displayShortcut("ctrl+shift+f12"), "Ctrl+Shift+F12");
assert.equal(shortcutLabel(null), "未设置");
assert.equal(shortcutLabel("ctrl+alt+a"), "Ctrl+Alt+A");

console.log("yee-stack core shortcut tests passed");
