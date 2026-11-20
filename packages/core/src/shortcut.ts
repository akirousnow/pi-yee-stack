/**
 * Shortcut helpers shared by every Yee Stack feature and both hosts.
 *
 * A configured shortcut is a lowercase key id such as "ctrl+alt+w", or
 * `null` when the feature has no shortcut. The host-specific "does this clash
 * with a built-in binding" lookup stays in each host package.
 */

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
