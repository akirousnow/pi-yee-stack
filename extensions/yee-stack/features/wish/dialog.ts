/**
 * Wish Specializer dialogs: the cancellable "generating" loader and the
 * floating, editable result dialog (Enter confirms, Esc cancels).
 *
 * Moved from pi-wish-specializer unchanged apart from imports.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import type { Focusable, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { Editor, truncateToWidth } from "@earendil-works/pi-tui";
import type { Tier } from "../../config.ts";
import { editorTheme, panelRow, popupOptions, popupWidth } from "../../ui/panel.ts";
import { TIER_LABEL } from "./prompt.ts";

/**
 * Floating editable result dialog.
 *
 * Enter confirms, Esc cancels, Shift+Enter inserts a newline. The editor keeps
 * its own scrolling and cursor handling; this wrapper only owns the dialog
 * frame and the two actions.
 */
export class WishPromptDialog implements Focusable {
	private readonly editor: Editor;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly meta: string;
	private readonly done: (result: string | null) => void;
	private focusedValue = false;
	private warning: string | undefined;

	constructor(options: {
		tui: TUI;
		theme: Theme;
		keybindings: KeybindingsManager;
		text: string;
		meta: string;
		done: (result: string | null) => void;
	}) {
		this.tui = options.tui;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.meta = options.meta;
		this.done = options.done;
		this.editor = new Editor(options.tui, editorTheme(options.theme), { paddingX: 1 });
		this.editor.setText(options.text);
	}

	get focused(): boolean {
		return this.focusedValue;
	}

	set focused(value: boolean) {
		this.focusedValue = value;
		this.editor.focused = value;
	}

	handleInput(data: string): void {
		// Let the editor own its autocomplete menu first.
		if (this.editor.isShowingAutocomplete()) {
			this.editor.handleInput(data);
			this.tui.requestRender();
			return;
		}

		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done(null);
			return;
		}

		if (this.keybindings.matches(data, "tui.input.submit")) {
			const text = this.editor.getExpandedText().trim();
			if (!text) {
				this.warning = "内容为空：请先输入内容，再确认";
				this.tui.requestRender();
				return;
			}
			this.done(text);
			return;
		}

		this.warning = undefined;
		this.editor.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(20, width);
		const paddingX = safeWidth >= 40 ? 3 : 1;
		const innerWidth = Math.max(1, safeWidth - paddingX * 2);
		const pad = " ".repeat(paddingX);
		const th = this.theme;
		const lines: string[] = [];

		// Fill every line to the full width with a panel background so the
		// floating card stays legible over transcript text.
		const row = (content: string) => panelRow(th, safeWidth, content);

		lines.push(
			row(
				truncateToWidth(
					`${pad}${th.fg("accent", th.bold("许愿特化器"))}${th.fg("dim", `  ${this.meta}`)}`,
					safeWidth,
				),
			),
		);
		lines.push(row(""));

		for (const line of this.editor.render(innerWidth)) {
			lines.push(row(`${pad}${line}${pad}`));
		}
		lines.push(row(""));

		lines.push(
			row(
				truncateToWidth(
					`${pad}${th.fg("success", th.bold("[ 确认 · Enter ]"))}  ${th.fg("warning", th.bold("[ 取消 · Esc ]"))}`,
					safeWidth,
				),
			),
		);

		if (this.warning) {
			lines.push(row(truncateToWidth(`${pad}${th.fg("warning", this.warning)}`, safeWidth)));
		} else {
			lines.push(
				row(
					truncateToWidth(
						`${pad}${th.fg("dim", "PgUp/PgDn 滚动 · Shift+Enter 换行 · Tab 补全 · 确认后写回输入框")}`,
						safeWidth,
					),
				),
			);
		}

		return lines;
	}

	invalidate(): void {
		this.editor.invalidate();
	}
}

export async function showResultDialog(
	ctx: ExtensionContext,
	text: string,
	meta: string,
): Promise<string | null> {
	return ctx.ui.custom<string | null>(
		(tui, theme, keybindings, done) =>
			new WishPromptDialog({
				tui,
				theme,
				keybindings,
				text,
				meta,
				done,
			}),
		{
			overlay: true,
			overlayOptions: popupOptions(),
			onHandle: (handle) => handle.focus(),
		},
	);
}

export async function showGeneratingDialog(
	ctx: ExtensionContext,
	modelLabel: string,
	tier: Tier,
	controller: AbortController,
	work: () => Promise<string>,
	onFailure: (message: string) => void,
): Promise<string | null> {
	return ctx.ui.custom<string | null>(
		(tui, theme, _keybindings, done) => {
			const loader = new BorderedLoader(
				tui,
				theme,
				`许愿特化器 · ${TIER_LABEL[tier]} · ${modelLabel}  正在补全方向…`,
				{ cancellable: true },
			);

			loader.onAbort = () => {
				controller.abort();
				done(null);
			};

			work()
				.then((result) => {
					if (!controller.signal.aborted) done(result);
				})
				.catch((error) => {
					if (!controller.signal.aborted) {
						onFailure(error instanceof Error ? error.message : String(error));
						done(null);
					}
				});

			return loader;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: popupWidth(),
				margin: 1,
			},
		},
	);
}
