/**
 * The "Ask" tab of /yee-config: shortcut and extra allowed tools.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConfigStore } from "../../config.ts";
import { shortcutLabel } from "../../shortcut.ts";
import { type ChecklistItem, ChecklistView } from "../../ui/checklist.ts";
import type { ConfigHost, ConfigRow, ConfigTab } from "../../ui/config-page.ts";
import { ShortcutCaptureView } from "../../ui/shortcut-capture.ts";
import { candidateExtraTools, type ToolLike } from "./policy.ts";

/** A registered tool, with the description shown beside its checkbox. */
export interface ListedTool extends ToolLike {
	description?: string;
}

export interface AskTabOptions {
	store: ConfigStore;
	ctx: ExtensionContext;
	listTools: () => ListedTool[];
}

function firstLine(text: string | undefined): string | undefined {
	return text?.split(/\r?\n/, 1)[0]?.trim() || undefined;
}

export function createAskTab({ store, listTools }: AskTabOptions): ConfigTab {
	const ask = () => store.get().ask;

	const save = (host: ConfigHost, mutate: Parameters<ConfigStore["update"]>[0]): boolean => {
		try {
			store.update(mutate);
			return true;
		} catch (error) {
			host.notify(`保存设置失败：${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	};

	const shortcutRow: ConfigRow = {
		id: "ask.shortcut",
		label: "快捷键",
		value: () => shortcutLabel(ask().shortcut),
		description: "随时按此键进入或退出 Ask 模式（等同 /ask）。修改后需要重载扩展才会生效，关闭此页时会自动重载。",
		activate: (host) => {
			host.openView(
				new ShortcutCaptureView({
					theme: host.theme,
					keybindings: host.keybindings,
					title: "Ask 快捷键",
					current: ask().shortcut,
					reserved: [{ key: store.get().wish.shortcut, owner: "Wish" }],
					requestRender: () => host.requestRender(),
					onCancel: () => host.closeView(),
					onDone: (key) => {
						host.closeView();
						if (key === ask().shortcut) return;
						if (!save(host, (draft) => void (draft.ask.shortcut = key))) return;

						host.requestReload();
						host.notify(
							key === null
								? "Ask 快捷键已清除（关闭此页后重载生效）"
								: `Ask 快捷键已设为 ${shortcutLabel(key)}（关闭此页后重载生效）`,
							"success",
						);
					},
				}),
			);
		},
	};

	const toolsRow: ConfigRow = {
		id: "ask.extraTools",
		label: "额外放行的工具",
		value: () => {
			const names = ask().extraTools;
			return names.length === 0 ? "无" : `${names.length} 个：${names.join(", ")}`;
		},
		description:
			"Ask 模式始终放行 read / grep / find / ls，以及声明了 readOnlyHint 的工具；bash / edit / write 永远不放行。这里可以再勾选其它你确认只读的工具。",
		activate: (host) => {
			const registered = candidateExtraTools(listTools());
			const known = new Set(registered.map((tool) => tool.name));
			const chosen = new Set(ask().extraTools);

			const items: ChecklistItem[] = registered.map((tool) => ({
				id: tool.name,
				label: tool.name,
				description: firstLine(tool.description),
				checked: chosen.has(tool.name),
			}));
			// Keep stale entries (e.g. an uninstalled extension's tool) so they can be unticked.
			for (const name of ask().extraTools) {
				if (!known.has(name)) items.push({ id: name, label: name, description: "（当前未注册）", checked: true });
			}

			host.openView(
				new ChecklistView({
					theme: host.theme,
					keybindings: host.keybindings,
					title: "额外放行的工具",
					subtitle: "read / grep / find / ls 与声明为只读的工具自动放行；bash / edit / write 永远不放行。",
					items,
					listRows: host.listRows,
					emptyText: "当前没有可勾选的其它工具。",
					onClose: () => host.closeView(),
					onToggle: (item) => {
						const saved = save(host, (draft) => {
							const next = new Set(draft.ask.extraTools);
							if (item.checked) next.add(item.id);
							else next.delete(item.id);
							draft.ask.extraTools = [...next];
						});
						if (!saved) {
							item.checked = !item.checked; // keep the checkbox truthful
							return;
						}
						host.notify(item.checked ? `Ask 模式将放行 ${item.id}` : `已取消放行 ${item.id}`, "success");
					},
				}),
			);
		},
	};

	return {
		id: "ask",
		title: "提问 Ask",
		rows: () => [shortcutRow, toolsRow],
	};
}
