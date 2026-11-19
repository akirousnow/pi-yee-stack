/**
 * Shared look of Yee Stack's floating panels: a centered overlay whose every
 * row is filled with the theme's `customMessageBg` so it stays legible on top
 * of the transcript.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, OverlayOptions } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function popupWidth(columns: number = process.stdout.columns ?? 100): number {
	return Math.max(36, Math.min(110, Math.floor(columns * 0.8)));
}

export function popupOptions(): OverlayOptions {
	return {
		anchor: "center",
		width: popupWidth(),
		maxHeight: "85%",
		margin: 1,
	};
}

export function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text) => theme.fg("border", text),
		selectList: {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		},
	};
}

/** Pad `content` with spaces to `width` columns and paint the panel background. */
export function panelRow(theme: Theme, width: number, content: string): string {
	const padding = " ".repeat(Math.max(0, width - visibleWidth(content)));
	return theme.bg("customMessageBg", content + padding);
}

/** Pad to exactly `width` visible columns (truncating when too long). CJK-aware. */
export function fitToWidth(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(0, width), "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Horizontal padding for a panel of `width` columns. */
export function panelPadding(width: number): number {
	return width >= 40 ? 3 : 1;
}
