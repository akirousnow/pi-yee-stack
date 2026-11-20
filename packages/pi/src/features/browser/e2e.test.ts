/**
 * End-to-end test against a real chrome-devtools-mcp and Chrome.
 *
 * Run with `npm run test:e2e`. It launches a headless Chrome with a temporary
 * profile, drives a local test page, and checks the tools Yee Stack forwards.
 * Skips (exit 0) when no Chrome executable is installed.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@yee-stack/core";
import { BrowserEngine } from "./mcp.ts";
import { createBrowserTools } from "./tools.ts";

const CANDIDATES = [
	process.env.CHROME_PATH,
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter((path): path is string => typeof path === "string" && path.length > 0);

const chrome = CANDIDATES.find((path) => existsSync(path));
if (!chrome) {
	console.log("yee-stack browser e2e skipped: no Chrome executable found");
	process.exit(0);
}

const server = createServer((_request, response) => {
	response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	response.end(`<!doctype html><title>Yee E2E</title>
<h1>登录</h1>
<input id="u" placeholder="用户名">
<button onclick="document.title='clicked:'+document.getElementById('u').value;document.body.insertAdjacentHTML('beforeend','<p id=\\'ok\\'>登录成功</p>')">登录</button>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const url = `http://127.0.0.1:${port}/`;

const profile = mkdtempSync(join(tmpdir(), "yee-browser-e2e-"));
const engine = new BrowserEngine();
let current: number | undefined;

const tools = createBrowserTools({
	engine: () => engine,
	currentPage: () => current,
	currentMeta: () => undefined,
	setCurrentPage: (pageId) => {
		current = pageId;
	},
	clearCurrentPage: () => {
		current = undefined;
	},
});
const byName = new Map(tools.map((tool) => [tool.name, tool]));

async function run(name: string, params: Record<string, unknown> = {}) {
	const tool = byName.get(name);
	assert.ok(tool, `${name} is registered`);
	const result = await tool.execute("e2e", params as never, undefined, undefined, {} as never);
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return { text, result };
}

try {
	await engine.start(
		{
			...defaultConfig().browser,
			connect: "launch",
			headless: "on",
			executable: chrome,
			profileDir: profile,
		},
		[process.cwd()],
	);
	assert.equal(engine.state, "connected");
	assert.ok(engine.serverVersion, "the MCP server reported a version");
	console.log(`yee-stack browser e2e: chrome-devtools-mcp ${engine.serverVersion}, ${chrome}`);

	const opened = await run("browser_new_tab", { url });
	const openedId = opened.text.match(/已打开 \$t(\d+)/)?.[1];
	assert.ok(openedId, "the new tab is reported");
	assert.equal(current, Number(openedId), "the new tab became current in Pi");
	assert.equal(engine.pages().find((page) => page.id === current)?.url, url, "new tabs open in the background by default");

	const snapshot = await run("browser_snapshot");
	const uid = (pattern: RegExp) =>
		snapshot.text
			.split("\n")
			.find((line) => pattern.test(line))
			?.match(/uid=(\S+)/)?.[1];
	const textbox = uid(/textbox "用户名"/);
	const button = uid(/button "登录"/);
	assert.ok(textbox, "the textbox is in the snapshot");
	assert.ok(button, "the button is in the snapshot");

	await run("browser_fill", { uid: textbox, value: "akiro" });
	const clicked = await run("browser_click", { uid: button });
	assert.match(clicked.text, /Successfully clicked/);
	assert.match(clicked.text, /登录成功/, "the diff shows the element that appeared");

	const shot = await run("browser_screenshot");
	assert.ok(
		shot.result.content.some((block) => block.type === "image"),
		"the screenshot came back as an image",
	);
	const screenshotPath = shot.text.match(/\[截图文件：(.+?)\]/)?.[1];
	assert.ok(screenshotPath, "the text reports the screenshot file");
	assert.ok(existsSync(screenshotPath));
	assert.ok(statSync(screenshotPath).size > 0);
	rmSync(screenshotPath, { force: true });

	const tabs = await run("browser_tabs");
	assert.match(tabs.text, /clicked:akiro/);
	assert.match(tabs.text, /← 当前/);

	console.log("yee-stack browser e2e passed");
} finally {
	await engine.stop();
	assert.equal(engine.state, "idle");
	server.close();
	rmSync(profile, { recursive: true, force: true });
}
