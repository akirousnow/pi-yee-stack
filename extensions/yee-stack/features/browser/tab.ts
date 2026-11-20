/**
 * The "Browser" tab of /yee-config.
 *
 * Connection settings (auto / explicit endpoint / launch), launch options,
 * startup and focus behavior, JavaScript evaluation, and the shortcut.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ConfigStore, BrowserChannel, BrowserConnect, BrowserHeadless } from "../../config.ts";
import { shortcutLabel } from "../../shortcut.ts";
import type { ConfigHost, ConfigRow, ConfigTab } from "../../ui/config-page.ts";
import { ShortcutCaptureView } from "../../ui/shortcut-capture.ts";
import { TextInputView } from "../../ui/text-input.ts";
import { defaultProfileDir } from "./args.ts";

const CONNECTS: BrowserConnect[] = ["auto", "url", "launch"];
const CHANNELS: BrowserChannel[] = ["stable", "beta", "dev", "canary"];
const HEADLESS: BrowserHeadless[] = ["auto", "on", "off"];

const CONNECT_LABEL: Record<BrowserConnect, string> = {
	auto: "自动连接",
	url: "指定地址",
	launch: "自己启动 Chrome",
};

const CHANNEL_LABEL: Record<BrowserChannel, string> = {
	stable: "Chrome Stable",
	beta: "Chrome Beta",
	dev: "Chrome Dev",
	canary: "Chrome Canary",
};

const HEADLESS_LABEL: Record<BrowserHeadless, string> = {
	auto: "自动（没有显示器时无头）",
	on: "总是无头",
	off: "总是有界面",
};

export interface BrowserTabOptions {
	store: ConfigStore;
}

function cycle<T>(values: readonly T[], current: T): T {
	return values[(values.indexOf(current) + 1) % values.length]!;
}

function yesNo(value: boolean): string {
	return value ? "开启" : "关闭";
}

export function createBrowserTab({ store }: BrowserTabOptions): ConfigTab {
	const browser = () => store.get().browser;

	const save = (host: ConfigHost, mutate: Parameters<ConfigStore["update"]>[0]): boolean => {
		try {
			store.update(mutate);
			return true;
		} catch (error) {
			host.notify(`保存设置失败：${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	};

	const connectionChanged = (host: ConfigHost): void => {
		host.notify("连接设置已保存；正在监听时先 /browser off 再 /browser on 生效", "info");
	};

	const connectRow: ConfigRow = {
		id: "browser.connect",
		label: "连接方式",
		value: () => CONNECT_LABEL[browser().connect],
		description:
			"自动连接：连上已经打开远程调试的 Chrome（chrome://inspect/#remote-debugging，Chrome 144+），否则试 127.0.0.1:9222。指定地址：http://host:port 或 ws://…（远程机器、SSH 隧道）。自己启动：用独立 profile 启动一个 Chrome。",
		activate: (host) => {
			const next = cycle(CONNECTS, browser().connect);
			if (!save(host, (draft) => void (draft.browser.connect = next))) return;
			connectionChanged(host);
			host.requestRender();
		},
	};

	const endpointRow: ConfigRow = {
		id: "browser.endpoint",
		label: "地址",
		value: () => browser().endpoint ?? "未设置",
		description: "connect 为「指定地址」时使用。http://127.0.0.1:9222 走 --browserUrl，ws://… 走 --wsEndpoint。",
		activate: (host) => {
			host.openView(
				new TextInputView({
					theme: host.theme,
					keybindings: host.keybindings,
					title: "浏览器地址",
					subtitle: "http://host:port 或 ws://host:port/devtools/browser/…",
					current: browser().endpoint,
					placeholder: "http://127.0.0.1:9222",
					validate: (value) =>
						!value || /^(?:https?|wss?):\/\//i.test(value) ? undefined : "地址需要以 http:// 或 ws:// 开头",
					requestRender: () => host.requestRender(),
					onCancel: () => host.closeView(),
					onDone: (value) => {
						host.closeView();
						if (value === browser().endpoint) return;
						if (!save(host, (draft) => void (draft.browser.endpoint = value))) return;
						connectionChanged(host);
					},
				}),
			);
		},
	};

	const channelRow: ConfigRow = {
		id: "browser.channel",
		label: "Chrome 渠道",
		value: () => CHANNEL_LABEL[browser().channel],
		description: "自动连接和启动时使用的 Chrome 渠道。",
		activate: (host) => {
			const next = cycle(CHANNELS, browser().channel);
			if (!save(host, (draft) => void (draft.browser.channel = next))) return;
			connectionChanged(host);
		},
	};

	const executableRow: ConfigRow = {
		id: "browser.executable",
		label: "Chrome 程序",
		value: () => browser().executable ?? "自动查找",
		description: "「自己启动 Chrome」时使用的可执行文件。留空时让 chrome-devtools-mcp 自己找。",
		activate: (host) => {
			host.openView(
				new TextInputView({
					theme: host.theme,
					keybindings: host.keybindings,
					title: "Chrome 可执行文件",
					subtitle: "例如 /usr/bin/google-chrome 或 C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
					current: browser().executable,
					placeholder: "留空自动查找",
					requestRender: () => host.requestRender(),
					onCancel: () => host.closeView(),
					onDone: (value) => {
						host.closeView();
						if (value === browser().executable) return;
						if (!save(host, (draft) => void (draft.browser.executable = value))) return;
						connectionChanged(host);
					},
				}),
			);
		},
	};

	const headlessRow: ConfigRow = {
		id: "browser.headless",
		label: "无头模式",
		value: () => HEADLESS_LABEL[browser().headless],
		description: "「自己启动 Chrome」时是否无头。自动 = 没有 DISPLAY / WAYLAND_DISPLAY 时无头。",
		activate: (host) => {
			const next = cycle(HEADLESS, browser().headless);
			if (!save(host, (draft) => void (draft.browser.headless = next))) return;
			connectionChanged(host);
		},
	};

	const profileRow: ConfigRow = {
		id: "browser.profileDir",
		label: "profile 目录",
		value: () => browser().profileDir ?? defaultProfileDir(getAgentDir()),
		description: "「自己启动 Chrome」时使用的用户数据目录，登录状态保存在这里。",
		activate: (host) => {
			host.openView(
				new TextInputView({
					theme: host.theme,
					keybindings: host.keybindings,
					title: "Chrome profile 目录",
					subtitle: "留空使用 agent 目录下的 yee-browser/profile",
					current: browser().profileDir,
					placeholder: "留空使用默认目录",
					requestRender: () => host.requestRender(),
					onCancel: () => host.closeView(),
					onDone: (value) => {
						host.closeView();
						if (value === browser().profileDir) return;
						if (!save(host, (draft) => void (draft.browser.profileDir = value))) return;
						connectionChanged(host);
					},
				}),
			);
		},
	};

	const startupRow: ConfigRow = {
		id: "browser.listenOnStartup",
		label: "启动时监听",
		value: () => yesNo(browser().listenOnStartup),
		description: "Pi 启动时自动连接浏览器；也可以每次用 /browser on 或 --browser。",
		activate: (host) => {
			const next = !browser().listenOnStartup;
			if (!save(host, (draft) => void (draft.browser.listenOnStartup = next))) return;
			host.notify(next ? "Pi 启动时会自动连接浏览器" : "Pi 启动时不再自动连接浏览器", "success");
		},
	};

	const focusRow: ConfigRow = {
		id: "browser.focusTab",
		label: "选中后切到前台",
		value: () => yesNo(browser().focusTab),
		description: "发送带 $tN 的消息时，把那个 tab 切到 Chrome 前台。",
		activate: (host) => {
			const next = !browser().focusTab;
			if (!save(host, (draft) => void (draft.browser.focusTab = next))) return;
			host.notify(next ? "选中 tab 后会切到前台" : "选中 tab 时不再切到前台", "success");
		},
	};

	const evalRow: ConfigRow = {
		id: "browser.allowEval",
		label: "允许执行 JS",
		value: () => yesNo(browser().allowEval),
		description:
			"允许在页面里执行 JavaScript（evaluate_script 等）。关闭时 chrome-devtools-mcp 也会拒绝 data: / javascript: 地址。改动在重新连接后生效。",
		activate: (host) => {
			const next = !browser().allowEval;
			if (!save(host, (draft) => void (draft.browser.allowEval = next))) return;
			host.notify(
				next ? "已允许执行 JS（重新连接后生效）" : "已禁止执行 JS（重新连接后生效）",
				"success",
			);
		},
	};

	const shortcutRow: ConfigRow = {
		id: "browser.shortcut",
		label: "快捷键",
		value: () => shortcutLabel(browser().shortcut),
		description: "按下后打开 tab 选择框（等同 /browser）。修改后需要重载扩展才会生效，关闭此页时会自动重载。",
		activate: (host) => {
			const config = store.get();
			host.openView(
				new ShortcutCaptureView({
					theme: host.theme,
					keybindings: host.keybindings,
					title: "Browser 快捷键",
					current: browser().shortcut,
					reserved: [
						{ key: config.wish.shortcut, owner: "Wish" },
						{ key: config.ask.shortcut, owner: "Ask" },
					],
					requestRender: () => host.requestRender(),
					onCancel: () => host.closeView(),
					onDone: (key) => {
						host.closeView();
						if (key === browser().shortcut) return;
						if (!save(host, (draft) => void (draft.browser.shortcut = key))) return;

						host.requestReload();
						host.notify(
							key === null
								? "Browser 快捷键已清除（关闭此页后重载生效）"
								: `Browser 快捷键已设为 ${shortcutLabel(key)}（关闭此页后重载生效）`,
							"success",
						);
					},
				}),
			);
		},
	};

	return {
		id: "browser",
		title: "浏览器 Browser",
		rows: () => {
			const config = browser();
			const rows = [connectRow];
			if (config.connect === "url") rows.push(endpointRow);
			else rows.push(channelRow);
			if (config.connect === "launch") rows.push(executableRow, headlessRow, profileRow);
			rows.push(startupRow, focusRow, evalRow, shortcutRow);
			return rows;
		},
	};
}
