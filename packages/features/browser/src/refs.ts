/**
 * `$t3` tab references.
 *
 * A tab reference names the page id chrome-devtools-mcp assigns to a tab.
 * Messages may contain one (`$t3 把数据整理成表格`), tool calls may pass one
 * (`page: "$t5"`), and `/browser use t3` accepts the bare form.
 */

/** The canonical token for a page id. */
export function tabRef(id: number): string {
	return `$t${id}`;
}

/**
 * Parse a tab reference. Accepts `$t3`, `t3`, `3` (numbers too) and
 * surrounding whitespace. Returns `undefined` for anything else.
 */
export function parseTabRef(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : undefined;
	if (typeof value !== "string") return undefined;
	const text = value.trim().toLowerCase();
	const match = /^(?:\$?t?)(\d+)$/.exec(text);
	if (!match) return undefined;
	const id = Number(match[1]);
	return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** The first `$tN` in a message, if any. */
export function findTabRef(text: string): number | undefined {
	const match = /(?:^|[\s(（[【"'`])\$t(\d+)(?!\w)/i.exec(text);
	if (!match) return undefined;
	const id = Number(match[1]);
	return Number.isInteger(id) && id > 0 ? id : undefined;
}
