/**
 * Checklist view: ↑/↓ to move, Space/Enter to toggle. Every toggle is reported
 * immediately so the caller can persist it.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-tui";
import type { ConfigView } from "./config-page.ts";
import { ListCursor, renderListRow, scrollInfo } from "./list.ts";

export interface ChecklistItem {
	id: string;
	label: string;
	description?: string;
	checked: boolean;
}

export interface ChecklistOptions {
	theme: Theme;
	keybindings: KeybindingsManager;
	title: string;
	subtitle?: string;
	items: ChecklistItem[];
	listRows: number;
	emptyText: string;
	onToggle: (item: ChecklistItem) => void;
	onClose: () => void;
}

export class ChecklistView implements ConfigView {
	readonly hint = "↑/↓ 选择 · Space/Enter 勾选 · Esc 返回";
	private readonly cursor: ListCursor;

	constructor(private readonly options: ChecklistOptions) {
		this.cursor = new ListCursor(options.listRows);
	}

	handleInput(data: string): void {
		const kb = this.options.keybindings;
		const { items } = this.options;
		if (kb.matches(data, "tui.select.cancel")) {
			this.options.onClose();
		} else if (kb.matches(data, "tui.select.up")) {
			this.cursor.move(-1, items.length);
		} else if (kb.matches(data, "tui.select.down")) {
			this.cursor.move(1, items.length);
		} else if (kb.matches(data, "tui.select.pageUp")) {
			this.cursor.page(-1, items.length);
		} else if (kb.matches(data, "tui.select.pageDown")) {
			this.cursor.page(1, items.length);
		} else if (kb.matches(data, "tui.select.confirm") || data === " ") {
			const item = items[this.cursor.index];
			if (!item) return;
			item.checked = !item.checked;
			this.options.onToggle(item);
		}
	}

	render(width: number): string[] {
		const th = this.options.theme;
		const { items } = this.options;
		const lines = [th.fg("accent", th.bold(this.options.title))];
		if (this.options.subtitle) lines.push(th.fg("muted", this.options.subtitle));
		lines.push("");

		if (items.length === 0) {
			lines.push(th.fg("muted", this.options.emptyText));
			return lines;
		}

		this.cursor.clamp(items.length);
		const { start, end } = this.cursor.range(items.length);
		for (let index = start; index < end; index++) {
			const item = items[index]!;
			lines.push(
				renderListRow({
					theme: th,
					width,
					selected: index === this.cursor.index,
					marker: item.checked ? th.fg("success", "[x]") : th.fg("dim", "[ ]"),
					primary: item.label,
					secondary: item.description,
				}),
			);
		}

		const info = scrollInfo(th, this.cursor, items.length);
		if (info) lines.push(`  ${info}`);
		return lines;
	}

	invalidate(): void {}
}
