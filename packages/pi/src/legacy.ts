/**
 * Detect the package Yee Stack replaces.
 *
 * pi-wish-specializer registered `/wish` and its shortcut too. Loaded next to
 * Yee Stack it makes Pi rename the duplicates (`/wish:1`, `/wish:2`) and report
 * a shortcut conflict, so tell the user once what to remove.
 */

/** The slice of Pi's `SlashCommandInfo` we look at. */
export interface CommandLike {
	name: string;
	source: string;
	sourceInfo: { path: string };
}

/**
 * Entry paths of other extensions that register `/wish`.
 *
 * "Ours" is whichever extension registered `yee-config`, so no path guessing.
 * Pi renames duplicate commands to `name:N`, hence the optional suffix.
 */
export function findOtherWishExtensions(commands: readonly CommandLike[]): string[] {
	const extensionCommands = commands.filter((command) => command.source === "extension");
	const ours = extensionCommands.find((command) => /^yee-config(?::\d+)?$/.test(command.name))?.sourceInfo.path;
	if (!ours) return [];

	const others = extensionCommands
		.filter((command) => /^wish(?::\d+)?$/.test(command.name) && command.sourceInfo.path !== ours)
		.map((command) => command.sourceInfo.path);
	return [...new Set(others)];
}
