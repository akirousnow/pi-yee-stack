import assert from "node:assert/strict";
import { formatSnapshotDiff, parseSnapshotText, SnapshotCache } from "./snapshot.ts";

const SNAP_A = `uid=1_0 RootWebArea "Form" url="https://example.com/form"
  uid=1_1 heading "登录" level="1"
  uid=1_2 textbox "用户名"
  uid=1_3 button "登录"`;

const SNAP_B = `uid=1_0 RootWebArea "Form" url="https://example.com/form"
  uid=1_1 heading "登录" level="1"
  uid=1_2 textbox "用户名"
  uid=1_3 button "登录"
  uid=2_0 "登录成功"
  uid=2_1 button "下一步"`;

// ── parsing ──────────────────────────────────────────────────────────────
{
	const parsed = parseSnapshotText(SNAP_A);
	assert.equal(parsed.elements.size, 4);
	assert.deepEqual(parsed.elements.get("1_2"), { role: "textbox", name: "用户名", line: 'uid=1_2 textbox "用户名"' });
	assert.equal(parsed.url, "https://example.com/form");
	assert.equal(parseSnapshotText("no uids").elements.size, 0);
	assert.equal(parseSnapshotText("no uids").url, undefined);
	// elements without a role still get their name
	assert.deepEqual(parseSnapshotText('uid=2_0 "纯文本"').elements.get("2_0")?.name, "纯文本");
}

// ── first snapshot is full ───────────────────────────────────────────────
const cache = new SnapshotCache();
{
	const diff = cache.update(3, SNAP_A);
	assert.equal(diff.full, true, "nothing to compare against");
	assert.equal(diff.total, 4);
	assert.equal(diff.url, "https://example.com/form");
	assert.equal(diff.urlChanged, false);
	assert.equal(cache.element(3, "1_2")?.name, "用户名");
}

// ── an action that adds elements: a diff, not the whole page ─────────────
{
	const diff = cache.update(3, SNAP_B);
	assert.equal(diff.full, false);
	assert.deepEqual(diff.added, ['uid=2_0 "登录成功"', 'uid=2_1 button "下一步"']);
	assert.deepEqual(diff.changed, []);
	assert.equal(diff.removed, 0);
	assert.equal(diff.total, 6);

	const text = formatSnapshotDiff(diff, 3);
	assert.match(text, /^\$t3 · 6 个元素/);
	assert.match(text, /\+ uid=2_1 button "下一步"/);
}

// ── changed names, removed elements, URL changes ─────────────────────────
{
	const renamed = SNAP_B.replace('button "下一步"', 'button "完成"').replace('uid=1_1 heading "登录" level="1"\n', "");
	const diff = cache.update(3, renamed);
	assert.equal(diff.changed.length, 1);
	assert.match(diff.changed[0]!, /uid=2_1 button "完成"/);
	assert.equal(diff.removed, 1, "the heading disappeared");
}

{
	const navigated = `uid=1_0 RootWebArea "Other" url="https://example.com/other"\n  uid=1_1 link "首页"`;
	const diff = cache.update(3, navigated);
	assert.equal(diff.urlChanged, true);
	assert.equal(diff.url, "https://example.com/other");
	assert.equal(diff.full, true, "most elements are new after a navigation");
	assert.match(formatSnapshotDiff(diff, 3), /URL → https:\/\/example.com\/other/);
}

// ── forceFull for browser_snapshot ───────────────────────────────────────
{
	const diff = cache.update(3, SNAP_B, { forceFull: true });
	assert.equal(diff.full, true);
}

// ── form state changes on the same uid are reported ──────────────────────
{
	const FORM_BEFORE = `uid=1_0 RootWebArea "Settings" url="https://example.com/settings"
  uid=1_1 textbox "用户名"
  uid=1_2 checkbox "记住我"
  uid=1_3 combobox "语言" value="中文"
  uid=1_4 button "高级" expandable`;
	const FORM_CHECKED = `uid=1_0 RootWebArea "Settings" url="https://example.com/settings"
  uid=1_1 textbox "用户名"
  uid=1_2 checkbox "记住我" checked
  uid=1_3 combobox "语言" value="中文"
  uid=1_4 button "高级" expandable`;
	const FORM_FILLED = `uid=1_0 RootWebArea "Settings" url="https://example.com/settings"
  uid=1_1 textbox "用户名" value="akiro"
  uid=1_2 checkbox "记住我"
  uid=1_3 combobox "语言" value="English"
  uid=1_4 button "高级" expandable expanded`;

	const formCache = new SnapshotCache();
	assert.equal(formCache.update(7, FORM_BEFORE).full, true);

	const checkedDiff = formCache.update(7, FORM_CHECKED);
	assert.equal(checkedDiff.full, false);
	assert.deepEqual(checkedDiff.changed, ['uid=1_2 checkbox "记住我" checked']);
	const checkedText = formatSnapshotDiff(checkedDiff, 7);
	assert.notEqual(checkedText, "（页面没有可见变化）");
	assert.match(checkedText, /~ uid=1_2 checkbox "记住我" checked/);

	const filledDiff = formCache.update(7, FORM_FILLED);
	assert.equal(filledDiff.full, false);
	assert.deepEqual(filledDiff.changed, [
		'uid=1_1 textbox "用户名" value="akiro"',
		'uid=1_2 checkbox "记住我"',
		'uid=1_3 combobox "语言" value="English"',
		'uid=1_4 button "高级" expandable expanded',
	]);
}

// ── no change ────────────────────────────────────────────────────────────
{
	cache.update(3, SNAP_B);
	const diff = cache.update(3, SNAP_B);
	assert.equal(diff.full, false);
	assert.deepEqual(diff.added, []);
	assert.deepEqual(diff.changed, []);
	assert.equal(formatSnapshotDiff(diff, 3), "（页面没有可见变化）");
}

// ── per-page caches and clear ────────────────────────────────────────────
{
	const other = cache.update(5, SNAP_A);
	assert.equal(other.full, true, "page 5 has its own cache");
	assert.equal(cache.element(3, "1_1")?.role, "heading");
	cache.clear(3);
	assert.equal(cache.element(3, "1_1"), undefined);
	cache.clear();
	assert.equal(cache.element(5, "1_1"), undefined);
}

console.log("yee-stack browser snapshot tests passed");
