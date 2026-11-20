import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { CallToolResult } from "@earendil-works/pi-mcp";
import { FakeBrowserEngine } from "../../test-support/fake-browser-engine.ts";
import type { PageInfo } from "./tabs.ts";
import { BROWSER_UPSTREAM_TOOLS, type BrowserToolDeps, createBrowserTools } from "./tools.ts";

const PAGES: PageInfo[] = [
	{ id: 3, title: "抖音创作者中心", url: "https://creator.douyin.com/", selected: true },
	{ id: 5, title: "文档", url: "https://example.com/docs", selected: false },
];

function setup() {
	const engine = new FakeBrowserEngine();
	engine.connect([...PAGES]);
	let current: number | undefined = 3;
	const deps: BrowserToolDeps = {
		engine: () => engine,
		currentPage: () => current,
		currentMeta: () => undefined,
		setCurrentPage: (pageId) => {
			current = pageId;
		},
		clearCurrentPage: () => {
			current = undefined;
		},
	};
	const tools = createBrowserTools(deps);
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	async function run(name: string, params: Record<string, unknown> = {}) {
		const tool = byName.get(name);
		assert.ok(tool, `${name} is registered`);
		return (await tool.execute("t1", params as never, undefined, undefined, {} as never)) as {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details: Record<string, unknown>;
			isError?: boolean;
		};
	}
	return {
		engine,
		tools,
		byName,
		run,
		current: () => current,
	};
}

// ── registration ─────────────────────────────────────────────────────────
{
	const { tools, byName } = setup();
	assert.equal(tools.length, 15);
	for (const tool of tools) {
		assert.ok(BROWSER_UPSTREAM_TOOLS.includes(tool.upstream), `${tool.name} forwards a known upstream tool`);
		assert.equal(tool.defaultActive, false, `${tool.name} starts inactive`);
	}
	for (const name of ["browser_tabs", "browser_snapshot", "browser_screenshot", "browser_wait"]) {
		assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, `${name} is read-only`);
	}
	for (const name of ["browser_click", "browser_fill", "browser_navigate", "browser_dialog"]) {
		assert.notEqual(byName.get(name)?.annotations?.readOnlyHint, true, `${name} is not read-only`);
	}
	assert.equal(byName.get("browser_snapshot")?.executionMode, "sequential");
	assert.match(
		byName.get("browser_screenshot")?.promptGuidelines?.[0] ?? "",
		/codemode/,
		"the screenshot tool explains the codemode fallback",
	);
}

// ── default page and argument rewriting ──────────────────────────────────
{
	const { engine, run, current } = setup();
	await run("browser_click", { uid: "1_2" });
	assert.deepEqual(engine.calls.at(-1), {
		name: "click",
		args: { pageId: 3, uid: "1_2", includeSnapshot: true },
	});
	assert.equal(current(), 3, "the default page does not change the current tab");

	await run("browser_fill", { uid: "1_2", value: "akiro", includeSnapshot: false });
	assert.deepEqual(engine.calls.at(-1), {
		name: "fill",
		args: { pageId: 3, uid: "1_2", value: "akiro", includeSnapshot: false },
	});

	await run("browser_navigate", { url: "https://example.com" });
	assert.deepEqual(engine.calls.at(-1), {
		name: "navigate_page",
		args: { pageId: 3, type: "url", url: "https://example.com" },
	});

	await run("browser_click", { page: "$t5", uid: "2_1", dblClick: true });
	assert.deepEqual(engine.calls.at(-1), {
		name: "click",
		args: { pageId: 5, uid: "2_1", dblClick: true, includeSnapshot: true },
	});
	assert.equal(current(), 3, "an explicit page is a one-off");

	await run("browser_click", { page: 5, uid: "2_1" });
	assert.equal(engine.calls.at(-1)?.args.pageId, 5);

	await assert.rejects(() => run("browser_click", { page: "$t9", uid: "1_1" }), /没有 \$t9/);
	await assert.rejects(() => run("browser_click", { page: "nope", uid: "1_1" }), /无法识别的 tab/);
	await assert.rejects(() => run("browser_click", {}), /缺少参数 uid/);
}

// ── multi-tab without a current tab ──────────────────────────────────────
{
	const engine = new FakeBrowserEngine();
	engine.connect([...PAGES]);
	const deps: BrowserToolDeps = {
		engine: () => engine,
		currentPage: () => undefined,
		currentMeta: () => undefined,
		setCurrentPage: () => {},
		clearCurrentPage: () => {},
	};
	const click = createBrowserTools(deps).find((tool) => tool.name === "browser_click")!;
	await assert.rejects(
		() => click.execute("t", { uid: "1_1" } as never, undefined, undefined, {} as never),
		/有多个 tab/,
	);

	const single = new FakeBrowserEngine();
	single.connect([PAGES[0]!]);
	const singleDeps = { ...deps, engine: () => single };
	const singleClick = createBrowserTools(singleDeps).find((tool) => tool.name === "browser_click")!;
	await singleClick.execute("t", { uid: "1_1" } as never, undefined, undefined, {} as never);
	assert.equal(single.calls.at(-1)?.args.pageId, 3, "one tab is unambiguous");
}

// ── new tab becomes current, closed current tab is cleared ───────────────
{
	const { engine, run, current } = setup();
	const opened: PageInfo = { id: 9, title: "新页面", url: "https://example.com/new", selected: true };
	engine.result = {
		content: [{ type: "text", text: "## Pages\n3: old\n5: docs\n9: new [selected]" }],
		structuredContent: { pages: [...PAGES.map((page) => ({ ...page, selected: false })), opened] },
	};
	const result = await run("browser_new_tab", { url: "https://example.com/new" });
	assert.equal(current(), 9);
	assert.match(result.content[0]!.text!, /已打开 \$t9 新页面/);
	assert.equal(engine.calls.at(-1)?.name, "new_page");
	assert.equal(engine.calls.at(-1)?.args.background, true, "new tabs open in the background by default");

	await run("browser_new_tab", { url: "https://example.com/foreground", background: false });
	assert.equal(engine.calls.at(-1)?.args.background, false, "background can still be turned off");

	engine.result = {
		content: [{ type: "text", text: "## Pages\n5: docs" }],
		structuredContent: { pages: [PAGES[1]!] },
	};
	await run("browser_close_tab", { page: 9 });
	assert.equal(current(), undefined);
}

// ── errors are surfaced without throwing ─────────────────────────────────
{
	const { engine, run } = setup();
	engine.result = { content: [{ type: "text", text: "Navigation timeout of 4000 ms exceeded." }], isError: true };
	const result = await run("browser_navigate", { type: "url", url: "https://example.com" });
	assert.equal(result.isError, true);
	assert.match(result.content[0]!.text!, /^错误：Navigation timeout/);
	assert.equal(result.details.error, true);
}

// ── snapshots become diffs after the first one ───────────────────────────
{
	const { engine, run } = setup();
	const SNAP_A = `Successfully clicked on the element
## Latest page snapshot
uid=1_0 RootWebArea "Form" url="https://example.com/form"
  uid=1_1 heading "登录"
  uid=1_2 button "登录"`;
	const SNAP_B = `Successfully clicked on the element
## Latest page snapshot
uid=1_0 RootWebArea "Form" url="https://example.com/form"
  uid=1_1 heading "登录"
  uid=1_2 button "登录"
  uid=2_0 "登录成功"
  uid=2_1 button "下一步"`;

	engine.result = { content: [{ type: "text", text: SNAP_A }] };
	const first = await run("browser_click", { uid: "1_2" });
	assert.match(first.content[0]!.text!, /uid=1_2 button "登录"/, "the first snapshot is returned in full");

	engine.result = { content: [{ type: "text", text: SNAP_B }] };
	const second = await run("browser_click", { uid: "1_2" });
	const text = second.content[0]!.text!;
	assert.match(text, /^Successfully clicked on the element/);
	assert.match(text, /\+ uid=2_1 button "下一步"/);
	assert.doesNotMatch(text, /uid=1_1/, "unchanged elements are not repeated");

	// browser_snapshot always returns the whole page.
	const full = await run("browser_snapshot");
	assert.match(full.content[0]!.text!, /uid=1_1 heading/);
}

// ── tabs formatting and image passthrough ────────────────────────────────
{
	const { run, current } = setup();
	const result = await run("browser_tabs");
	assert.match(result.content[0]!.text!, /^\$t3  抖音创作者中心/);
	assert.match(result.content[0]!.text!, /\$t5  文档/);
	assert.match(result.content[0]!.text!, /← 当前/);
	assert.equal(current(), 3);

	const { engine, run: runShot } = setup();
	engine.result = {
		content: [
			{ type: "text", text: "Took a screenshot." },
			{ type: "image", data: "aGVsbG8=", mimeType: "image/jpeg" },
		],
	};
	const shot = await runShot("browser_screenshot", { fullPage: true });
	assert.equal(shot.content[1]?.type, "image");
	assert.equal(shot.content[1]?.mimeType, "image/jpeg");
	assert.deepEqual(engine.calls.at(-1)?.args, { pageId: 3, fullPage: true });

	// codemode drops image blocks, so the text must point at a real file.
	const screenshotPath = shot.content[0]!.text!.match(/\[截图文件：(.+?)\]/)?.[1];
	assert.ok(screenshotPath, "the screenshot path is in the text");
	assert.ok(existsSync(screenshotPath));
	assert.ok(readFileSync(screenshotPath).length > 0);
	rmSync(screenshotPath, { force: true });
}

// ── a disconnected engine is reported, not thrown ────────────────────────
{
	const engine = new FakeBrowserEngine();
	const deps: BrowserToolDeps = {
		engine: () => engine,
		currentPage: () => undefined,
		currentMeta: () => undefined,
		setCurrentPage: () => {},
		clearCurrentPage: () => {},
	};
	const tool = createBrowserTools(deps).find((candidate) => candidate.name === "browser_tabs")!;
	const result = (await tool.execute("t", {} as never, undefined, undefined, {} as never)) as CallToolResult & {
		isError?: boolean;
	};
	assert.equal(result.isError, true);
	assert.match(result.content[0]!.type === "text" ? result.content[0]!.text : "", /浏览器未连接/);
}

console.log("yee-stack browser tools tests passed");
