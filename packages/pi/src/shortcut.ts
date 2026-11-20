/**
 * Pi-specific shortcut helper.
 *
 * Validation and display live in `@yee-stack/core`; only the "is this key
 * already bound to a Pi built-in action" lookup needs pi-tui.
 */

import { getKeybindings } from "@earendil-works/pi-tui";

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
