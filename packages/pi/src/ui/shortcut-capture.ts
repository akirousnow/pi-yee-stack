/**
 * "Press the new shortcut" view for /yee-config.
 *
 * Rejects keys that would swallow normal typing, collide with a Pi built-in,
 * or are already used by another Yee Stack feature. Backspace clears the
 * shortcut; Esc keeps the current one.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-tui";
import { matchesKey, parseKey } from "@earendil-works/pi-tui";
import { isShortcutShapeValid, shortcutLabel } from "@yee-stack/core";
import { findBuiltinShortcutConflict } from "../shortcut.ts";
import type { ConfigView } from "./config-page.ts";

/** A shortcut another feature already owns. */
export interface ReservedShortcut {
	key: string | null;
	owner: string;
}

export interface ShortcutCaptureOptions {
	theme: Theme;
	keybindings: KeybindingsManager;
	/** e.g. "Wish 快捷键" */
	title: string;
	current: string | null;
	reserved: ReservedShortcut[];
	/** `null` means "clear the shortcut". */
	onDone: (key: string | null) => void;
	onCancel: () => void;
	requestRender: () => void;
}

export class ShortcutCaptureView implements ConfigView {
	readonly hint = "按下新的快捷键 · Backspace 清除 · Esc 取消";
	private warning: string | undefined;

	constructor(private readonly options: ShortcutCaptureOptions) {}

	render(_width: number): string[] {
		const th = this.options.theme;
		return [
			th.fg("accent", th.bold(`设置 ${this.options.title}`)),
			th.fg("text", `当前：${shortcutLabel(this.options.current)}`),
			"",
			th.fg("dim", "按下新的快捷键。Backspace 清除（不设置快捷键），Esc 取消"),
			th.fg("dim", "支持 Ctrl/Alt/Super+字母/数字，或 F1-F12"),
			"",
			this.warning
				? th.fg("warning", this.warning)
				: th.fg("dim", "建议使用 Ctrl/Alt 组合键，避免影响正常输入"),
		];
	}

	handleInput(data: string): void {
		if (this.options.keybindings.matches(data, "tui.select.cancel")) {
			this.options.onCancel();
			return;
		}

		if (matchesKey(data, "backspace") || matchesKey(data, "delete")) {
			this.options.onDone(null);
			return;
		}

		const parsed = parseKey(data);
		if (!parsed) {
			this.reject("无法识别这个按键，请重试");
			return;
		}

		const key = parsed.toLowerCase();
		if (!isShortcutShapeValid(key)) {
			this.reject("需要 Ctrl/Alt/Super+字母/数字，或 F1-F12");
			return;
		}

		const taken = this.options.reserved.find((entry) => entry.key === key);
		if (taken) {
			this.reject(`已被 ${taken.owner} 使用，请换一个`);
			return;
		}

		const conflict = findBuiltinShortcutConflict(key);
		if (conflict) {
			this.reject(`与 Pi 内置快捷键冲突：${conflict}`);
			return;
		}

		this.options.onDone(key);
	}

	private reject(message: string): void {
		this.warning = message;
		this.options.requestRender();
	}

	invalidate(): void {}
}
