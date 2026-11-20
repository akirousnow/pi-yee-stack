/**
 * Single-line text input view for /yee-config.
 *
 * Used for values that are typed rather than picked: an endpoint, a Chrome
 * path, a profile directory. Enter saves, Esc cancels, and `validate` may
 * reject a value without closing the view.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-tui";
import { Input } from "@earendil-works/pi-tui";
import type { ConfigView } from "./config-page.ts";

export interface TextInputOptions {
	theme: Theme;
	keybindings: KeybindingsManager;
	title: string;
	subtitle?: string;
	current: string | null;
	placeholder: string;
	/** Return an error message to keep the view open, or undefined to accept. */
	validate?: (value: string) => string | undefined;
	/** `null` when the field was cleared. */
	onDone: (value: string | null) => void;
	onCancel: () => void;
	requestRender: () => void;
}

export class TextInputView implements ConfigView {
	readonly hint = "Enter 保存 · Esc 取消";
	private readonly input: Input;
	private error: string | undefined;

	constructor(private readonly options: TextInputOptions) {
		this.input = new Input({
			prompt: "› ",
			placeholder: options.placeholder,
			placeholderStyle: (text) => options.theme.fg("dim", text),
		});
		// Paste the current value so the cursor ends up after it; setValue leaves
		// the cursor at the start, which makes editing an endpoint awkward.
		if (options.current) this.input.handleInput(`\x1b[200~${options.current}\x1b[201~`);
	}

	get focused(): boolean {
		return this.input.focused;
	}

	set focused(value: boolean) {
		this.input.focused = value;
	}

	render(width: number): string[] {
		const th = this.options.theme;
		const lines = [th.fg("accent", th.bold(this.options.title))];
		if (this.options.subtitle) lines.push(th.fg("muted", this.options.subtitle));
		lines.push("", ...this.input.render(width), "");
		lines.push(this.error ? th.fg("warning", this.error) : th.fg("dim", "Enter 保存 · Esc 取消 · 留空表示未设置"));
		return lines;
	}

	handleInput(data: string): void {
		if (this.options.keybindings.matches(data, "tui.select.cancel")) {
			this.options.onCancel();
			return;
		}
		if (this.options.keybindings.matches(data, "tui.select.confirm")) {
			const value = this.input.getValue().trim();
			const error = this.options.validate?.(value);
			if (error) {
				this.error = error;
				this.options.requestRender();
				return;
			}
			this.options.onDone(value ? value : null);
			return;
		}
		this.error = undefined;
		this.input.handleInput(data);
	}

	invalidate(): void {
		this.input.invalidate();
	}
}
