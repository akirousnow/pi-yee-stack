/**
 * Small list helpers shared by the picker views: a wrap-around cursor with a
 * scrolling window, and a two-column row renderer that measures CJK text by
 * terminal columns.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export class ListCursor {
	index = 0;

	constructor(public maxVisible: number) {}

	/** Move by `delta`, wrapping around at both ends. */
	move(delta: number, count: number): void {
		if (count <= 0) {
			this.index = 0;
			return;
		}
		this.index = (((this.index + delta) % count) + count) % count;
	}

	/** Move by whole pages without wrapping. */
	page(direction: -1 | 1, count: number): void {
		if (count <= 0) {
			this.index = 0;
			return;
		}
		const step = Math.max(1, this.maxVisible - 1);
		this.index = Math.max(0, Math.min(count - 1, this.index + direction * step));
	}

	/** Keep the index valid after the list shrank. */
	clamp(count: number): void {
		this.index = count <= 0 ? 0 : Math.max(0, Math.min(count - 1, this.index));
	}

	/** The visible slice, centered on the selection. */
	range(count: number): { start: number; end: number } {
		const visible = Math.max(1, this.maxVisible);
		const start = Math.max(0, Math.min(this.index - Math.floor(visible / 2), count - visible));
		return { start, end: Math.min(start + visible, count) };
	}
}

export interface ListRowOptions {
	theme: Theme;
	width: number;
	selected: boolean;
	/** Text shown right after the cursor, e.g. a checkbox. */
	marker?: string;
	primary: string;
	secondary?: string;
	/** Widest the primary column may grow. */
	maxPrimaryWidth?: number;
}

/** `→ primary    secondary`, truncated to `width` columns. */
export function renderListRow(options: ListRowOptions): string {
	const { theme, width, selected, primary, secondary } = options;
	const cursor = selected ? theme.fg("accent", "→ ") : "  ";
	const marker = options.marker ? `${options.marker} ` : "";
	const head = visibleWidth(cursor) + visibleWidth(marker);
	const available = Math.max(1, width - head);

	const maxPrimary = Math.min(options.maxPrimaryWidth ?? 44, available);
	const primaryText = truncateToWidth(primary, maxPrimary, "…");
	const gap = secondary ? 2 : 0;
	const secondaryWidth = Math.max(0, available - visibleWidth(primaryText) - gap);

	const paint = (text: string, role: "primary" | "secondary") => {
		if (selected) return theme.fg("accent", text);
		return role === "primary" ? text : theme.fg("muted", text);
	};

	let line = cursor + marker + paint(primaryText, "primary");
	if (secondary && secondaryWidth >= 4) {
		line += " ".repeat(gap) + paint(truncateToWidth(secondary, secondaryWidth, "…"), "secondary");
	}
	return truncateToWidth(line, width, "");
}

/** `(3/21)` scroll indicator, or `undefined` when everything fits. */
export function scrollInfo(theme: Theme, cursor: ListCursor, count: number): string | undefined {
	const { start, end } = cursor.range(count);
	if (start === 0 && end >= count) return undefined;
	return theme.fg("dim", `(${cursor.index + 1}/${count})`);
}
