/**
 * Shortcut helpers shared by every Yee Stack feature.
 *
 * A configured shortcut is a lowercase Pi key id such as "ctrl+alt+w", or
 * `null` when the feature has no shortcut.
 */

import { getKeybindings } from "@earendil-works/pi-tui";

const SHORTCUT_SHAPE = /^(?:(?:ctrl|alt|super|shift)\+)*(?:[a-z0-9]|f(?:[1-9]|1[0-2]))$/;

/**
 * Whether `value` is a shortcut we are willing to register.
 *
 * Accepts modifiers (`ctrl`/`alt`/`super`/`shift`) followed by a letter, digit
 * or F1-F12. A bare letter would swallow normal typing, so a real modifier
 * (not just `shift`) or an F-key is required.
 */
export function isShortcutShapeValid(value: string): boolean {
	const key = value.trim().toLowerCase();
	if (!SHORTCUT_SHAPE.test(key)) return false;
	return /(?:^|\+)(?:ctrl|alt|super)\+/.test(key) || /(?:^|\+)f(?:[1-9]|1[0-2])$/.test(key);
}

/** Lowercase + trim `value` when it is a valid shortcut, otherwise `undefined`. */
export function normalizeShortcut(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return isShortcutShapeValid(value) ? value.trim().toLowerCase() : undefined;
}

/** "ctrl+alt+w" → "Ctrl+Alt+W" */
export function displayShortcut(key: string): string {
	return key
		.split("+")
		.map((part) => (part.length <= 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
		.join("+");
}

/** Display text for a possibly-unset shortcut. */
export function shortcutLabel(key: string | null): string {
	return key ? displayShortcut(key) : "未设置";
}

/** Name of the Pi built-in action already bound to `key`, if any. */
export function findBuiltinShortcutConflict(key: string): string | undefined {
	try {
		const resolved = getKeybindings().getResolvedBindings() as Record<string, string | string[] | undefined>;
		for (const [action, bindings] of Object.entries(resolved)) {
			const keys = Array.isArray(bindings) ? bindings : bindings ? [bindings] : [];
			if (keys.some((binding) => binding.toLowerCase() === key.toLowerCase())) {
				return action;
			}
		}
	} catch {
		// Keybindings are only available in interactive mode.
	}
	return undefined;
}
