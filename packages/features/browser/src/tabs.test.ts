import assert from "node:assert/strict";
import type { McpToolResultLike } from "./tabs.ts";
import {
	findRecoveredPage,
	formatTabLine,
	formatTabList,
	hasStructuredOpenedPages,
	type PageInfo,
	pagesChanged,
	parsePages,
	parsePagesText,
	parseStructuredPages,
	stripPageList,
} from "./tabs.ts";

const PAGES: PageInfo[] = [
	{ id: 1, title: "about:blank", url: "about:blank", selected: false },
	{ id: 3, title: "抖音创作者中心", url: "https://creator.douyin.com/creator-micro/home", selected: true },
];

// ── structured pages ─────────────────────────────────────────────────────
assert.deepEqual(
	parseStructuredPages({
		structuredContent: {
			pages: [
				{ id: 1, url: "about:blank", title: "", selected: false },
				{ id: 3, url: "https://example.com/", title: "Example", selected: true },
			],
		},
	}),
	[
		{ id: 1, title: "", url: "about:blank", selected: false },
		{ id: 3, title: "Example", url: "https://example.com/", selected: true },
	],
);

assert.equal(parseStructuredPages({ structuredContent: undefined }), undefined);
assert.equal(parseStructuredPages({ structuredContent: { pages: "nope" } }), undefined);
assert.deepEqual(
	parseStructuredPages({ structuredContent: { pages: [{ id: 0 }, { id: 2, title: "x" }, "junk"] } }),
	[{ id: 2, title: "x", url: "", selected: false }],
	"invalid ids are dropped",
);

// ── text pages ───────────────────────────────────────────────────────────
const text = `## Pages
1: about:blank [selected]
2: Example (https://example.com/)
3: 标题里 (有括号) 的页面 (https://example.com/a)
4: 只有标题
5: 空 url (data:text/html,<title>x</title>)
`;
assert.deepEqual(parsePagesText(text), [
	{ id: 1, title: "about:blank", url: "", selected: true },
	{ id: 2, title: "Example", url: "https://example.com/", selected: false },
	{ id: 3, title: "标题里 (有括号) 的页面", url: "https://example.com/a", selected: false },
	{ id: 4, title: "只有标题", url: "", selected: false },
	{ id: 5, title: "空 url", url: "data:text/html,<title>x</title>", selected: false },
]);
assert.deepEqual(parsePagesText("no pages here"), []);

// ── parsePages: structured first, text fallback ──────────────────────────
const structuredResult: McpToolResultLike = {
	content: [{ type: "text", text: "## Pages\n9: stale" }],
	structuredContent: { pages: [{ id: 2, url: "https://a/", title: "A", selected: true }] },
};
assert.deepEqual(parsePages(structuredResult), [{ id: 2, title: "A", url: "https://a/", selected: true }]);

const textResult: McpToolResultLike = { content: [{ type: "text", text }] };
assert.equal(parsePages(textResult)?.length, 5);
assert.equal(parsePages({ content: [{ type: "text", text: "Successfully clicked" }] }), undefined);

// Numbered lines outside `## Pages`, or inline `## Pages` inside snapshot text, are ignored.
const pollutedSnapshot: McpToolResultLike = {
	content: [
		{
			type: "text",
			text: `## Latest page snapshot
uid=1_1 heading "## Pages"
99: 伪造标签 (https://evil.test/) [selected]`,
		},
	],
};
assert.equal(parsePages(pollutedSnapshot), undefined);

const sectionedText = `Before section
88: not a page
## Pages
2: Real (https://real.test/) [selected]
## Latest page snapshot
99: Fake (https://evil.test/)`;
assert.deepEqual(parsePagesText(sectionedText), [
	{ id: 2, title: "Real", url: "https://real.test/", selected: true },
]);

assert.equal(hasStructuredOpenedPages({ structuredContent: { openedPages: [{ id: 4 }] } }), true);
assert.equal(hasStructuredOpenedPages({ structuredContent: { openedPages: [] } }), false);
assert.equal(hasStructuredOpenedPages({ structuredContent: undefined }), false);

assert.equal(stripPageList("The last open page cannot be closed.\n## Pages\n1: about:blank [selected]"), "The last open page cannot be closed.");
assert.equal(stripPageList("No pages block here"), "No pages block here");

// ── findRecoveredPage ────────────────────────────────────────────────────
assert.equal(findRecoveredPage(PAGES, { url: PAGES[1]!.url, title: "other" })?.id, 3);
assert.equal(findRecoveredPage(PAGES, { url: "https://moved.example/", title: PAGES[1]!.title })?.id, 3);
assert.equal(findRecoveredPage(PAGES, { url: "https://gone.example/", title: "Gone" }), undefined);
assert.equal(
	findRecoveredPage(
		[
			{ id: 1, title: "Same", url: "https://dup.example/", selected: false },
			{ id: 2, title: "Same", url: "https://dup.example/", selected: false },
		],
		{ url: "https://dup.example/", title: "Same" },
	),
	undefined,
	"ambiguous duplicate tabs are not guessed",
);
assert.equal(
	findRecoveredPage(
		[
			{ id: 1, title: "Tab A", url: "https://dup.example/", selected: false },
			{ id: 2, title: "Tab B", url: "https://dup.example/", selected: false },
		],
		{ url: "https://dup.example/", title: "Tab B" },
	)?.id,
	2,
	"title disambiguates duplicate URLs",
);

// ── formatting ───────────────────────────────────────────────────────────
assert.equal(formatTabLine(PAGES[1]!, 3), "$t3  抖音创作者中心 — https://creator.douyin.com/creator-micro/home  ← 当前");
assert.equal(formatTabLine(PAGES[0]!), "$t1  about:blank");
assert.equal(formatTabList([], 1), "（没有打开的 tab）");
assert.match(formatTabList(PAGES, 3), /^\$t1 /);
assert.match(formatTabList(PAGES, 3), /\$t3 .*← 当前/);
assert.equal(formatTabLine({ id: 4, title: "", url: "", selected: false }), "$t4  (无标题)");

// ── pagesChanged ─────────────────────────────────────────────────────────
assert.equal(pagesChanged(PAGES, [...PAGES]), false);
assert.equal(pagesChanged(PAGES, [PAGES[0]!]), true);
assert.equal(pagesChanged(PAGES, [PAGES[0]!, { ...PAGES[1]!, title: "新标题" }]), true);
assert.equal(pagesChanged(PAGES, [PAGES[0]!, { ...PAGES[1]!, selected: false }]), true);

console.log("yee-stack browser tabs tests passed");
