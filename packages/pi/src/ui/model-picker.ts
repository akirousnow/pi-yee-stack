/**
 * Searchable model picker view: type to fuzzy-filter, ↑/↓ to move, Enter to
 * choose. The first choice ("follow the current Pi model") is only listed while
 * the search box is empty.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-tui";
import { fuzzyFilter, Input } from "@earendil-works/pi-tui";
import type { ModelRef } from "@yee-stack/core";
import type { ConfigView } from "./config-page.ts";
import { ListCursor, renderListRow, scrollInfo } from "./list.ts";

export interface ModelChoice {
	/** `null` = follow the current Pi model. */
	ref: ModelRef | null;
	label: string;
	/** The model's display name when it differs from its id. */
	name?: string;
	description?: string;
}

export interface ModelPickerOptions {
	theme: Theme;
	keybindings: KeybindingsManager;
	title: string;
	subtitle: string;
	choices: ModelChoice[];
	/** Preselected model (`null` preselects the "follow" choice). */
	selected: ModelRef | null;
	listRows: number;
	onSelect: (choice: ModelChoice) => void;
	onCancel: () => void;
}

export function sameModel(a: ModelRef | null, b: ModelRef | null): boolean {
	if (a === null || b === null) return a === b;
	return a.provider === b.provider && a.id === b.id;
}

export class ModelPickerView implements ConfigView {
	readonly hint = "输入文字过滤 · ↑/↓ 选择 · Enter 确认 · Esc 返回";
	private readonly input: Input;
	private readonly cursor: ListCursor;
	private visible: ModelChoice[];
	private lastQuery = "";

	constructor(private readonly options: ModelPickerOptions) {
		this.input = new Input({
			prompt: "搜索 ",
			placeholder: "输入 provider / 模型名过滤",
			placeholderStyle: (text) => options.theme.fg("dim", text),
		});
		this.cursor = new ListCursor(options.listRows);
		this.visible = options.choices;
		const preselected = options.choices.findIndex((choice) => sameModel(choice.ref, options.selected));
		if (preselected >= 0) this.cursor.index = preselected;
	}

	get focused(): boolean {
		return this.input.focused;
	}

	set focused(value: boolean) {
		this.input.focused = value;
	}

	private applyFilter(): void {
		const query = this.input.getValue().trim();
		if (query === this.lastQuery) return;
		this.lastQuery = query;
		this.visible = query
			? fuzzyFilter(
					this.options.choices.filter((choice) => choice.ref !== null),
					query,
					(choice) => `${choice.label} ${choice.description ?? ""}`,
				)
			: this.options.choices;
		this.cursor.index = 0;
	}

	handleInput(data: string): void {
		const kb = this.options.keybindings;
		if (kb.matches(data, "tui.select.cancel")) {
			this.options.onCancel();
		} else if (kb.matches(data, "tui.select.confirm")) {
			const choice = this.visible[this.cursor.index];
			if (choice) this.options.onSelect(choice);
		} else if (kb.matches(data, "tui.select.up")) {
			this.cursor.move(-1, this.visible.length);
		} else if (kb.matches(data, "tui.select.down")) {
			this.cursor.move(1, this.visible.length);
		} else if (kb.matches(data, "tui.select.pageUp")) {
			this.cursor.page(-1, this.visible.length);
		} else if (kb.matches(data, "tui.select.pageDown")) {
			this.cursor.page(1, this.visible.length);
		} else {
			this.input.handleInput(data);
			this.applyFilter();
		}
	}

	render(width: number): string[] {
		const th = this.options.theme;
		const lines = [
			th.fg("accent", th.bold(this.options.title)),
			th.fg("muted", this.options.subtitle),
			"",
			...this.input.render(width),
		];

		if (this.visible.length === 0) {
			lines.push("", th.fg("warning", "没有匹配的模型"));
			return lines;
		}

		this.cursor.clamp(this.visible.length);
		const { start, end } = this.cursor.range(this.visible.length);
		lines.push("");
		for (let index = start; index < end; index++) {
			const choice = this.visible[index]!;
			lines.push(
				renderListRow({
					theme: th,
					width,
					selected: index === this.cursor.index,
					primary: choice.label,
					secondary: choice.description,
				}),
			);
		}

		const info = scrollInfo(th, this.cursor, this.visible.length);
		if (info) lines.push(`  ${info}`);
		return lines;
	}

	invalidate(): void {
		this.input.invalidate();
	}
}
