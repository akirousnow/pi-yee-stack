/**
 * Yee Stack core: the pieces every feature and both hosts share.
 *
 *  - `config-schema` — the shared `yee-stack.json` shape, defaults and validation
 *  - `shortcut`      — shortcut validation and display
 *
 * Feature-specific logic lives in its own package (`@yee-stack/wish`,
 * `@yee-stack/ask`, `@yee-stack/browser`); the hosts (`pi-yee-stack`,
 * `@yee-stack/dsh`) are thin adapters over core + features.
 */

export * from "./config-schema.ts";
export * from "./shortcut.ts";
