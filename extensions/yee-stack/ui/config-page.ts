/**
 * The tabbed /yee-config page.
 *
 * One floating panel hosts every feature's settings as a tab. A tab is a short
 * list of rows; activating a row either changes a value in place or opens a
 * full-body view (model picker, key capture, checklist) that replaces the rows
 * until it closes. Changes are saved the moment they are made.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { fitToWidth, panelPadding, panelRow, popupOptions } from "./panel.ts";

export type NoticeKind = "info" | "success" | "warning" | "error";

/** A full-body view that temporarily replaces a tab's rows. */
export interface ConfigView extends Component {
	/** Set by the page so views containing an `Input` keep the IME cursor right. */
	focused?: boolean;
	/** One-line key hints shown at the bottom while the view is open. */
	hint: string;
}

/** What a row or view can do to the page that hosts it. */
export interface ConfigHost {
	readonly ctx: ExtensionContext;
	readonly theme: Theme;
	readonly keybindings: KeybindingsManager;
	/** How many list rows a picker view can show without overflowing the panel. */
	readonly listRows: number;
	openView(view: ConfigView): void;
	closeView(): void;
	/** Show a one-line message in the footer until the next key press. */
	notify(text: string, kind?: NoticeKind): void;
	/** The saved change only takes effect after a Pi reload (shortcuts). */
	requestReload(): void;
	requestRender(): void;
}

export interface ConfigRow {
	id: string;
	label: string;
	/** Current value, evaluated on every render. */
	value(): string;
	/** Explains the row while it is selected. */
	description?: string;
	/** Enter / Space. Change something in place or open a view. */
	activate(host: ConfigHost): void;
}

export interface ConfigTab {
	id: string;
	/** Tab label, e.g. "许愿 Wish". */
	title: string;
	/** Evaluated on every render so values stay live. */
	rows(): ConfigRow[];
}

/** Builds a tab for the context the page was opened from. */
export type ConfigTabFactory = (ctx: ExtensionContext) => ConfigTab;

export interface ConfigPageResult {
	/** True when a saved change needs `ctx.reload()` to take effect. */
	reload: boolean;
}

export interface ConfigPageOptions {
	tui: TUI;
	theme: Theme;
	keybindings: KeybindingsManager;
	ctx: ExtensionContext;
	tabs: ConfigTab[];
	initialTab?: string;
	done: (result: ConfigPageResult) => void;
}

const DEFAULT_HINT = "←/→ 切换标签 · ↑/↓ 选择 · Enter 修改 · Esc 关闭";
const MAX_DESCRIPTION_LINES = 6;

export class ConfigPage implements Component, Focusable {
	private activeTab: number;
	private readonly cursors: number[];
	private view: ConfigView | undefined;
	private notice: { text: string; kind: NoticeKind } | undefined;
	private reloadNeeded = false;
	private focusedValue = false;
	private closed = false;
	private readonly host: ConfigHost;

	constructor(private readonly options: ConfigPageOptions) {
		const start = options.tabs.findIndex((tab) => tab.id === options.initialTab);
		this.activeTab = start >= 0 ? start : 0;
		this.cursors = options.tabs.map(() => 0);

		const page = this;
		this.host = {
			ctx: options.ctx,
			theme: options.theme,
			keybindings: options.keybindings,
			get listRows() {
				return page.listRows();
			},
			openView: (view) => this.openView(view),
			closeView: () => this.closeView(),
			notify: (text, kind = "info") => {
				this.notice = { text, kind };
				options.tui.requestRender();
			},
			requestReload: () => {
				this.reloadNeeded = true;
			},
			requestRender: () => options.tui.requestRender(),
		};
	}

	get focused(): boolean {
		return this.focusedValue;
	}

	set focused(value: boolean) {
		this.focusedValue = value;
		if (this.view) this.view.focused = value;
	}

	// ── state ──────────────────────────────────────────────────────────────

	private currentTab(): ConfigTab {
		return this.options.tabs[this.activeTab]!;
	}

	private currentRows(): ConfigRow[] {
		return this.currentTab().rows();
	}

	private openView(view: ConfigView): void {
		this.view = view;
		view.focused = this.focusedValue;
		this.notice = undefined;
		this.options.tui.requestRender();
	}

	private closeView(): void {
		this.view = undefined;
		this.options.tui.requestRender();
	}

	private close(): void {
		if (this.closed) return;
		this.closed = true;
		this.options.done({ reload: this.reloadNeeded });
	}

	private switchTab(direction: -1 | 1): void {
		const count = this.options.tabs.length;
		this.activeTab = (this.activeTab + direction + count) % count;
	}

	/** Rows a picker may use: what is left of 85% of the terminal after chrome. */
	private listRows(): number {
		const terminalRows = this.options.tui.terminal?.rows ?? process.stdout.rows ?? 30;
		const budget = Math.floor(terminalRows * 0.85) - 9 - 7;
		return Math.max(3, Math.min(12, budget));
	}

	// ── input ──────────────────────────────────────────────────────────────

	handleInput(data: string): void {
		if (this.view) {
			this.view.handleInput?.(data);
			this.options.tui.requestRender();
			return;
		}

		this.notice = undefined;
		const kb = this.options.keybindings;
		const rows = this.currentRows();
		const cursor = this.cursors[this.activeTab]!;

		if (kb.matches(data, "tui.select.cancel")) {
			this.close();
			return;
		}

		if (matchesKey(data, "tab") || matchesKey(data, "right")) {
			this.switchTab(1);
		} else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
			this.switchTab(-1);
		} else if (kb.matches(data, "tui.select.up")) {
			if (rows.length > 0) this.cursors[this.activeTab] = (cursor - 1 + rows.length) % rows.length;
		} else if (kb.matches(data, "tui.select.down")) {
			if (rows.length > 0) this.cursors[this.activeTab] = (cursor + 1) % rows.length;
		} else if (kb.matches(data, "tui.select.confirm") || data === " ") {
			const row = rows[Math.min(cursor, rows.length - 1)];
			if (row) this.activateRow(row);
		} else {
			return;
		}

		this.options.tui.requestRender();
	}

	private activateRow(row: ConfigRow): void {
		try {
			row.activate(this.host);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.host.notify(`操作失败：${message}`, "error");
		}
	}

	// ── rendering ──────────────────────────────────────────────────────────

	render(width: number): string[] {
		const w = Math.max(20, width);
		const padX = panelPadding(w);
		const pad = " ".repeat(padX);
		const inner = Math.max(1, w - padX * 2);
		const th = this.options.theme;
		const out: string[] = [];

		const blank = () => out.push(panelRow(th, w, ""));
		const text = (content: string) => out.push(panelRow(th, w, pad + truncateToWidth(content, inner, "…")));

		blank();
		text(th.fg("accent", th.bold("Yee Stack 设置")));
		blank();
		text(this.renderTabBar());
		text(th.fg("borderMuted", "─".repeat(inner)));
		blank();

		if (this.view) {
			for (const line of this.view.render(inner)) text(line);
		} else {
			this.renderRows(text, blank, inner);
		}

		blank();
		text(this.renderFooter());
		blank();
		return out;
	}

	private renderTabBar(): string {
		const th = this.options.theme;
		return this.options.tabs
			.map((tab, index) =>
				index === this.activeTab
					? th.fg("accent", th.bold(`[ ${tab.title} ]`))
					: th.fg("muted", `  ${tab.title}  `),
			)
			.join(" ");
	}

	private renderRows(text: (content: string) => void, blank: () => void, inner: number): void {
		const th = this.options.theme;
		const rows = this.currentRows();
		if (rows.length === 0) {
			text(th.fg("muted", "（这个标签没有可配置项）"));
			return;
		}

		const cursor = Math.min(this.cursors[this.activeTab]!, rows.length - 1);
		const labelWidth = Math.min(18, Math.max(...rows.map((row) => visibleWidth(row.label))));
		const valueWidth = Math.max(4, inner - 2 - labelWidth - 2);

		rows.forEach((row, index) => {
			const selected = index === cursor;
			const prefix = selected ? th.fg("accent", "→ ") : "  ";
			const label = fitToWidth(row.label, labelWidth);
			const value = truncateToWidth(row.value(), valueWidth, "…");
			text(
				prefix +
					(selected ? th.fg("accent", label) : label) +
					"  " +
					(selected ? th.fg("accent", value) : th.fg("muted", value)),
			);
		});

		const description = rows[cursor]?.description;
		if (description) {
			blank();
			const wrapped = wrapTextWithAnsi(description, Math.max(1, inner - 2));
			for (const line of wrapped.slice(0, MAX_DESCRIPTION_LINES)) {
				text(th.fg("dim", `  ${line}`));
			}
		}
	}

	private renderFooter(): string {
		const th = this.options.theme;
		if (this.notice) {
			const color = { info: "muted", success: "success", warning: "warning", error: "error" } as const;
			return th.fg(color[this.notice.kind], this.notice.text);
		}
		return th.fg("dim", this.view ? this.view.hint : DEFAULT_HINT);
	}

	invalidate(): void {
		this.view?.invalidate();
	}
}

/**
 * Open the config page as a floating panel and resolve once it closes.
 * Resolves `{ reload: false }` outside the TUI.
 */
export async function openConfigPage(
	ctx: ExtensionContext,
	factories: ConfigTabFactory[],
	initialTab?: string,
): Promise<ConfigPageResult> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/yee-config 需要 TUI 交互模式", "error");
		return { reload: false };
	}

	const tabs = factories.map((factory) => factory(ctx));
	const result = await ctx.ui.custom<ConfigPageResult>(
		(tui, theme, keybindings, done) =>
			new ConfigPage({ tui, theme, keybindings, ctx, tabs, initialTab, done }),
		{
			overlay: true,
			overlayOptions: () => popupOptions(),
			onHandle: (handle) => handle.focus(),
		},
	);
	return result ?? { reload: false };
}
