import assert from "node:assert/strict";
import { type CommandLike, findOtherWishExtensions } from "./legacy.ts";

const command = (name: string, path: string, source = "extension"): CommandLike => ({ name, source, sourceInfo: { path } });
const OURS = "/home/u/.pi/agent/git/github.com/akirousnow/pi-yee-stack/extensions/yee-stack/index.ts";
const OLD = "/home/u/.pi/agent/git/github.com/akirousnow/pi-wish-specializer/index.ts";

// Only Yee Stack loaded: nothing to report.
assert.deepEqual(
	findOtherWishExtensions([command("wish", OURS), command("yee-config", OURS), command("ask", OURS), command("wish-config", OURS)]),
	[],
);

// The old package next to ours: Pi renamed the duplicates to wish:1 / wish:2.
assert.deepEqual(
	findOtherWishExtensions([
		command("wish:1", OLD),
		command("wish-config:1", OLD),
		command("wish:2", OURS),
		command("wish-config:2", OURS),
		command("yee-config", OURS),
	]),
	[OLD],
);

// Same, before any renaming (defensive) and listed once even with several commands.
assert.deepEqual(findOtherWishExtensions([command("wish", OLD), command("wish", OURS), command("yee-config", OURS)]), [OLD]);

// Prompt templates and skills named "wish" are not extensions.
assert.deepEqual(
	findOtherWishExtensions([command("wish", "/x/wish.md", "prompt"), command("skill:wish", "/x/SKILL.md", "skill"), command("yee-config", OURS)]),
	[],
);

// Unrelated commands and lookalikes are ignored.
assert.deepEqual(
	findOtherWishExtensions([command("wishlist", OLD), command("make-wish", OLD), command("yee-config", OURS)]),
	[],
);

// If our own command is not visible we cannot tell who is who, so say nothing.
assert.deepEqual(findOtherWishExtensions([command("wish", OLD)]), []);
assert.deepEqual(findOtherWishExtensions([]), []);

// yee-config itself may carry a numeric suffix if another extension also claimed the name.
assert.deepEqual(findOtherWishExtensions([command("wish", OLD), command("yee-config:2", OURS)]), [OLD]);

console.log("yee-stack legacy detection tests passed");
