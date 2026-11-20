/**
 * Tab lists from chrome-devtools-mcp.
 *
 * `list_pages` returns structured pages when the server runs with
 * `--experimentalStructuredContent` and a text list otherwise:
 *
 *   ## Pages
 *   1: about:blank [selected]
 *   2: Title (https://example.com/)
 *
 * Both shapes are parsed here. The parsed list is also what `$` completion
 * and the footer read, so parsing never throws.
 */

import type { CallToolResult } from "@earendil-works/pi-mcp";
import { tabRef } from "./refs.ts";

export interface PageInfo {
	/** chrome-devtools-mcp page id: `$t3` is `id: 3`. */
	id: number;
	title: string;
	url: string;
	/** The page chrome-devtools-mcp currently considers selected. */
	selected: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pages carried by a tool result's `structuredContent`, when present. */
export function parseStructuredPages(result: Pick<CallToolResult, "structuredContent">): PageInfo[] | undefined {
	const structured = result.structuredContent;
	if (!isRecord(structured) || !Array.isArray(structured.pages)) return undefined;
	const pages: PageInfo[] = [];
	for (const item of structured.pages) {
		if (!isRecord(item)) continue;
		const id = typeof item.id === "number" ? item.id : Number(item.id);
		if (!Number.isInteger(id) || id <= 0) continue;
		pages.push({
			id,
			title: typeof item.title === "string" ? item.title : "",
			url: typeof item.url === "string" ? item.url : "",
			selected: item.selected === true,
		});
	}
	return pages;
}

/** Parse the `## Pages` text list. */
export function parsePagesText(text: string): PageInfo[] {
	const pages: PageInfo[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const match = /^(\d+):\s*(.*)$/.exec(line);
		if (!match) continue;
		const id = Number(match[1]);
		if (!Number.isInteger(id) || id <= 0) continue;

		let rest = match[2]!.trim();
		const selected = /\s*\[selected\]\s*$/i.test(rest);
		if (selected) rest = rest.replace(/\s*\[selected\]\s*$/i, "");

		let title = rest;
		let url = "";
		const open = rest.lastIndexOf(" (");
		if (open > 0 && rest.endsWith(")")) {
			const candidate = rest.slice(open + 2, -1).trim();
			if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(candidate)) {
				title = rest.slice(0, open).trim();
				url = candidate;
			}
		}
		pages.push({ id, title, url, selected });
	}
	return pages;
}

/** Pages from a tool result: structured first, then the text content. */
export function parsePages(result: CallToolResult): PageInfo[] | undefined {
	const structured = parseStructuredPages(result);
	if (structured && structured.length > 0) return structured;
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	if (!/##\s*Pages/.test(text)) return undefined;
	const pages = parsePagesText(text);
	return pages.length > 0 ? pages : undefined;
}

/** `$t3  标题 — https://example.com/  ← 当前` */
export function formatTabLine(page: PageInfo, currentId?: number): string {
	const title = page.title.trim() || page.url.trim() || "(无标题)";
	const url = page.url.trim();
	const suffix = currentId === page.id ? "  ← 当前" : "";
	const tail = url && url !== title ? ` — ${truncate(url, 96)}` : "";
	return `${tabRef(page.id)}  ${truncate(title, 60)}${tail}${suffix}`;
}

/** All tabs, one per line. */
export function formatTabList(pages: readonly PageInfo[], currentId?: number): string {
	if (pages.length === 0) return "（没有打开的 tab）";
	return pages.map((page) => formatTabLine(page, currentId)).join("\n");
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** True when two page lists differ in anything a user can see. */
export function pagesChanged(a: readonly PageInfo[], b: readonly PageInfo[]): boolean {
	if (a.length !== b.length) return true;
	for (let index = 0; index < a.length; index++) {
		const left = a[index]!;
		const right = b[index]!;
		if (left.id !== right.id || left.title !== right.title || left.url !== right.url || left.selected !== right.selected) {
			return true;
		}
	}
	return false;
}
