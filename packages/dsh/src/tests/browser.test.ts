import assert from "node:assert/strict";
import { type PageInfo, SnapshotCache } from "@yee-stack/browser";
import type { McpToolResult } from "../mcp.ts";
import { BROWSER_UPSTREAM_TOOLS, createBrowserTools, resolvePageId, type BrowserToolDeps } from "../tools.ts";

const PAGES: PageInfo[] = [
	{ id: 1, title: "about:blank", url: "about:blank", selected: false },
	{ id: 3, title: "登录页", url: "https://example.com/login", selected: true },
];

const SNAP_A = `## Page state
uid=1_0 RootWebArea "登录" url="https://example.com/login"
  uid=1_2 textbox "用户名"
  uid=1_3 button "登录"`;

const SNAP_B = `## Page state
uid=1_0 RootWebArea "登录" url="https://example.com/login"
  uid=1_2 textbox "用户名"
  uid=1_3 button "登录"
  uid=2_0 "登录成功"`;

const SNAP_C = `## Page state
uid=1_0 RootWebArea "登录" url="https://example.com/login"
  uid=1_2 textbox "用户名"
  uid=1_3 button "登录"
  uid=2_0 "登录成功"
  uid=2_1 button "下一步"`;

function createDeps(call: (name: string, args: Record<string, unknown>) => McpToolResult): BrowserToolDeps & {
	calls: Array<{ name: string; args: Record<string, unknown> }>;
} {
	const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
	let pages = PAGES;
	let current: number | undefined = 3;
	return {
		calls,
		call: async (name, args) => {
			calls.push({ name, args });
			return call(name, args);
		},
		pages: () => pages,
		setPages: (next) => {
			pages = [...next];
		},
		current: () => current,
		setCurrent: (pageId) => {
			current = pageId;
		},
		snapshots: new SnapshotCache(),
	};
}

// ── the curated surface ──────────────────────────────────────────────────
assert.equal(BROWSER_UPSTREAM_TOOLS.length, 15);
assert.deepEqual(BROWSER_UPSTREAM_TOOLS.slice(0, 3), ["list_pages", "take_snapshot", "take_screenshot"]);

// ── page resolution ──────────────────────────────────────────────────────
assert.equal(resolvePageId({ pages: () => PAGES, current: () => 3 }, undefined), 3, "defaults to the current tab");
assert.equal(resolvePageId({ pages: () => PAGES, current: () => undefined }, "$t1"), 1, "an explicit reference wins");
assert.equal(
	resolvePageId({ pages: () => [PAGES[0]!], current: () => undefined }, undefined),
	1,
	"a single tab needs no selection",
);
assert.equal(resolvePageId({ pages: () => PAGES, current: () => undefined }, undefined), undefined);

// ── browser_tabs ─────────────────────────────────────────────────────────
{
	const deps = createDeps(() => ({ content: [{ type: "text", text: "## Pages\n1: about:blank\n3: 登录页 (https://example.com/login) [selected]" }] }));
	const tools = new Map(createBrowserTools(deps).map((tool) => [tool.name, tool]));
	const value = (await tools.get("browser_tabs")!.execute({}, { signal: undefined } as never)) as {
		blocks: Array<{ text: string }>;
	};
	assert.match(value.blocks[0]!.text, /\$t3 {2}登录页/);
	assert.match(value.blocks[0]!.text, /← 当前/);
	assert.deepEqual(deps.calls[0], { name: "list_pages", args: {} });
}

// ── browser_click: snapshot diff after an action ─────────────────────────
{
	const responses = [SNAP_B, SNAP_C];
	let step = 0;
	const deps = createDeps(() => ({
		content: [{ type: "text", text: responses[Math.min(step++, responses.length - 1)]! }],
	}));
	const tools = new Map(createBrowserTools(deps).map((tool) => [tool.name, tool]));
	const click = tools.get("browser_click")!;

	const first = (await click.execute({ uid: "1_3" }, { signal: undefined } as never)) as { blocks: Array<{ text: string }> };
	assert.match(first.blocks[0]!.text, /uid=2_0 "登录成功"/, "a cold cache returns the whole snapshot");
	assert.deepEqual(deps.calls[0]!.args, { uid: "1_3", pageId: 3, includeSnapshot: true });

	const second = (await click.execute({ uid: "1_3" }, { signal: undefined } as never)) as { blocks: Array<{ text: string }> };
	assert.match(second.blocks[0]!.text, /\$t3 · 5 个元素/);
	assert.match(second.blocks[0]!.text, /\+ uid=2_1 button "下一步"/);
	assert.doesNotMatch(second.blocks[0]!.text, /uid=1_2/, "unchanged elements are not resent");
}

// ── errors ───────────────────────────────────────────────────────────────
{
	const deps = createDeps(() => ({ content: [{ type: "text", text: "Element not found" }], isError: true }));
	const tools = new Map(createBrowserTools(deps).map((tool) => [tool.name, tool]));
	await assert.rejects(() => tools.get("browser_fill")!.execute({ uid: "9_9", value: "x" }, { signal: undefined } as never), /Element not found/);
}

// ── several tabs without a current one: the error names them ─────────────
{
	const deps = createDeps(() => ({ content: [{ type: "text", text: "ok" }] }));
	deps.current = () => undefined;
	const tools = new Map(createBrowserTools(deps).map((tool) => [tool.name, tool]));
	await assert.rejects(
		() => tools.get("browser_snapshot")!.execute({}, { signal: undefined } as never),
		/有多个 tab，请用 page 参数指定/,
	);
}

// ── new tab becomes current ──────────────────────────────────────────────
{
	const deps = createDeps(() => ({
		content: [{ type: "text", text: "## Pages\n1: about:blank\n4: 新标签页 (https://example.com/new) [selected]" }],
	}));
	const tools = new Map(createBrowserTools(deps).map((tool) => [tool.name, tool]));
	const value = (await tools.get("browser_new_tab")!.execute({ url: "https://example.com/new" }, { signal: undefined } as never)) as {
		blocks: Array<{ text: string }>;
	};
	assert.match(value.blocks[0]!.text, /已新建 \$t4/);
	assert.equal(deps.current(), 4);
}

console.log("yee-stack dsh browser tests passed");
