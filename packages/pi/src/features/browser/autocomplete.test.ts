import assert from "node:assert/strict";
import { type AutocompleteProvider, type AutocompleteSuggestions, CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { createTabAutocompleteProvider } from "./autocomplete.ts";
import type { PageInfo } from "yee-stack-browser";

const PAGES: PageInfo[] = [
	{ id: 3, title: "抖音创作者中心", url: "https://creator.douyin.com/", selected: true },
	{ id: 5, title: "文档", url: "https://example.com/docs", selected: false },
];

const SIGNAL = new AbortController().signal;

/** Stand-in for Pi's slash-command / file provider. */
function baseProvider(): {
	provider: AutocompleteProvider;
	applied: number;
	suggestions: number;
} {
	const state = { applied: 0, suggestions: 0 };
	const provider: AutocompleteProvider = {
		async getSuggestions(): Promise<AutocompleteSuggestions> {
			state.suggestions++;
			return { items: [{ value: "browser", label: "browser" }], prefix: "/brow" };
		},
		applyCompletion(lines, cursorLine, cursorCol, item) {
			state.applied++;
			// Pi's slash-command completion: replace the command token.
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - "/brow".length);
			const next = [...lines];
			next[cursorLine] = `${before}/${item.value} ${line.slice(cursorCol)}`;
			return { lines: next, cursorLine, cursorCol: before.length + item.value.length + 2 };
		},
		shouldTriggerFileCompletion: () => true,
	};
	return { provider, get applied() { return state.applied; }, get suggestions() { return state.suggestions; } };
}

function wrap(base: AutocompleteProvider, listening = true) {
	return createTabAutocompleteProvider(base, { pages: () => PAGES, listening: () => listening });
}

// ── the regression: /brow + Tab must stay a slash command ───────────────
{
	const base = baseProvider();
	const provider = wrap(base.provider);
	const suggestions = await provider.getSuggestions(["/brow"], 0, 5, { signal: SIGNAL });
	assert.deepEqual(suggestions, { items: [{ value: "browser", label: "browser" }], prefix: "/brow" });
	assert.equal(base.suggestions, 1, "non-$ input is delegated");

	const applied = provider.applyCompletion(["/brow"], 0, 5, suggestions!.items[0]!, suggestions!.prefix);
	assert.deepEqual(applied.lines, ["/browser "], "the wrapped provider applies the completion");
	assert.equal(base.applied, 1);
}

// ── the real Pi provider: /brow still completes to /browser ─────────────
{
	const base = new CombinedAutocompleteProvider([{ name: "browser", description: "browser" }], process.cwd(), null);
	const provider = wrap(base);
	const suggestions = await provider.getSuggestions(["/brow"], 0, 5, { signal: SIGNAL });
	assert.equal(suggestions?.items[0]?.value, "browser");
	const applied = provider.applyCompletion(["/brow"], 0, 5, suggestions!.items[0]!, suggestions!.prefix);
	assert.deepEqual(applied.lines, ["/browser "]);
}

// ── not listening: everything is delegated ──────────────────────────────
{
	const base = baseProvider();
	const provider = wrap(base.provider, false);
	const suggestions = await provider.getSuggestions(["$"], 0, 1, { signal: SIGNAL });
	assert.deepEqual(suggestions, { items: [{ value: "browser", label: "browser" }], prefix: "/brow" });
	const applied = provider.applyCompletion(["/brow"], 0, 5, suggestions!.items[0]!, suggestions!.prefix);
	assert.deepEqual(applied.lines, ["/browser "]);
	assert.equal(base.applied, 1);
}

// ── $ lists tabs and inserts $tN ────────────────────────────────────────
{
	const base = baseProvider();
	const provider = wrap(base.provider);
	assert.deepEqual(provider.triggerCharacters, ["$"]);

	const all = await provider.getSuggestions(["$"], 0, 1, { signal: SIGNAL });
	assert.deepEqual(all?.items.map((item) => item.value), ["$t3", "$t5"]);
	assert.equal(all?.items[0]?.label, "抖音创作者中心", "the list shows the title, not the page id");
	assert.equal(all?.items[0]?.description, "$t3 · https://creator.douyin.com/");
	assert.equal(all?.prefix, "$");
	const applied = provider.applyCompletion(["看看 $"], 0, 4, all!.items[0]!, all!.prefix);
	assert.deepEqual(applied.lines, ["看看 $t3 "]);
	assert.equal(applied.cursorCol, 7);
	assert.equal(base.applied, 0, "our own completion is not delegated");

	const filtered = await provider.getSuggestions(["$文"], 0, 2, { signal: SIGNAL });
	assert.deepEqual(filtered?.items.map((item) => item.value), ["$t5"]);

	// $5 / $1 are shell or template syntax even when page 5 exists.
	const numeric = await provider.getSuggestions(["echo $5"], 0, 7, { signal: SIGNAL });
	assert.deepEqual(numeric, { items: [{ value: "browser", label: "browser" }], prefix: "/brow" });
}

// ── no matching tab: fall back to the wrapped provider ──────────────────
{
	const base = baseProvider();
	const provider = wrap(base.provider);
	const fallback = await provider.getSuggestions(["echo $HOME"], 0, 10, { signal: SIGNAL });
	assert.deepEqual(fallback, { items: [{ value: "browser", label: "browser" }], prefix: "/brow" });
	assert.equal(base.suggestions, 1);

	// A base suggestion that is not a $tN item is applied by the base provider.
	const applied = provider.applyCompletion(["echo $HOME"], 0, 10, fallback!.items[0]!, fallback!.prefix);
	assert.equal(base.applied, 1);
	assert.deepEqual(applied.lines, ["echo /browser "]);
}

console.log("yee-stack browser autocomplete tests passed");
