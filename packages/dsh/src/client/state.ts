/**
 * The Host half of the Yee Stack panel's state, as the Web page reads it.
 *
 * The panel is one `main` entry in the frame, so the browser half needs a
 * snapshot of everything the three features currently resolve to: the Wish
 * tiers, the Ask mode of the Session the panel is showing, the browser
 * connection with its tabs, and the MCP server the connection runs on.
 *
 * Two sources feed it, exactly as the Host plugin keeps them:
 *
 *   - config     the resolved plugin config (live through `volatile()` fields);
 *   - runtime    Ask mode per Session, the browser connection and its tabs.
 *
 * Ask mode and the connection change without a settings write, so the panel
 * needs to hear about them. That is what {@link panelEvents} is for: the
 * registry below holds one listener set per `yee-stack` plugin instance, and
 * the Host half pushes a fresh snapshot whenever its runtime state moves.
 *
 * Pure module: no cordis, no remote, no React. The Host half imports it for
 * the service; the browser half imports it for the types.
 */

/** Wish tier, the same union `yee-stack-core` uses. */
export type PanelTier = "light" | "standard" | "heavy";

/** How `/browser` reaches Chrome. */
export type PanelConnect = "auto" | "url" | "launch";

/** Chrome channel used by auto-connect and launch. */
export type PanelChannel = "stable" | "beta" | "dev" | "canary";

/** Headless policy for a launched Chrome. */
export type PanelHeadless = "auto" | "on" | "off";

/** Connection state of the browser, as `/browser status` reports it. */
export type PanelBrowserState = "idle" | "connecting" | "connected" | "error";

/** One tab chrome-devtools-mcp currently has open. */
export interface PanelTab {
	/** Page id; `$t3` is `id: 3`. */
	id: number;
	title: string;
	url: string;
}

/** Everything the browser section renders. */
export interface PanelBrowser {
	state: PanelBrowserState;
	/** Why the last connect failed; only meaningful in `error`. */
	error: string | null;
	/** Open tabs, in chrome-devtools-mcp's order. */
	tabs: PanelTab[];
	/** The tab the tools act on by default. */
	current: number | null;
	/** Whether the connection is to a remote Chrome rather than a launched one. */
	remote: boolean;
	/** `browser_*` tools the Host registered for this connection. */
	toolCount: number;
}

/** The browser settings as the panel's advanced section edits them. */
export interface PanelBrowserSettings {
	connect: PanelConnect;
	channel: PanelChannel;
	endpoint: string;
	executable: string;
	headless: PanelHeadless;
	profileDir: string;
	allowEval: boolean;
	allowRemoteUpload: boolean;
	listenOnStartup: boolean;
}

/** Wish settings plus the route `/wish` would use right now. */
export interface PanelWish {
	tier: PanelTier;
	maxTokens: number;
	/** Provider of the Session's current route, or null when it has none. */
	provider: string | null;
	model: string | null;
}

/** Ask mode plus the tool policy it is enforcing. */
export interface PanelAsk {
	/** Whether Ask mode is on for the Session the panel is showing. */
	active: boolean;
	/** Tools the read-only policy lets through right now. */
	allowed: string[];
	/** Tools it denies right now. */
	blocked: string[];
	extraTools: string[];
	/** The guidance injected while the mode is on. */
	section: string;
}

/** One MCP server the browser feature contributes to the manager. */
export interface PanelMcpServer {
	name: string;
	/** Manager status: `connected`, `connecting`, `reconnecting`, `failed`, … */
	state: string;
	/** Registered tools in the live generation, when connected. */
	toolCount: number | null;
	/** Last diagnostic the manager kept, when it has one. */
	error: string | null;
}

/** What one specialization produced, as the panel receives it. */
export interface PanelWishResult {
	/** The prompt to write into the composer: the wish plus the supplement. */
	prompt: string;
	/** The generated directional requirements; empty when the wish was specific enough. */
	supplement: string;
}

/** A panel action's answer: the new snapshot, or the reason the action failed. */
export interface PanelActionResult {
	ok: boolean;
	/** The fresh snapshot after a successful action. */
	snapshot?: PanelSnapshot;
	/** The Host's refusal or the transport's failure. */
	message?: string;
}

/** The full snapshot one `main` panel render reads. */
export interface PanelSnapshot {
	/** Which Session the snapshot describes; null when the panel is not bound. */
	sessionId: string | null;
	/** `dsh` version the panel is talking to, when the Host reports one. */
	dshVersion: string | null;
	wish: PanelWish;
	ask: PanelAsk;
	browser: PanelBrowser;
	/** The browser settings themselves, so the advanced form shows stored values. */
	browserSettings: PanelBrowserSettings;
	mcp: PanelMcpServer | null;
}

/** Names of the two Remote endpoints the panel calls. */
export const PANEL_NAMESPACE = "yeeStackPanel";
export const PANEL_SNAPSHOT_ENDPOINT = "yeeStackPanel/snapshot";
export const PANEL_RESTART_MCP_ENDPOINT = "yeeStackPanel/restartMcp";

/** A config field the panel can write. */
export type PanelConfigField =
	| "wish.tier"
	| "wish.maxTokens"
	| "ask.extraTools"
	| "ask.section"
	| "browser.connect"
	| "browser.channel"
	| "browser.endpoint"
	| "browser.executable"
	| "browser.headless"
	| "browser.profileDir"
	| "browser.allowEval"
	| "browser.allowRemoteUpload"
	| "browser.listenOnStartup";

/** The `yee-stack` Loader entry id a settings write addresses. */
export const PANEL_CONFIG_NS = "yee-stack";

/** One field edit the panel asks the settings document to apply. */
export type PanelConfigWrite =
	| { op: "set"; field: PanelConfigField; value: string | number | boolean | string[] }
	| { op: "unset"; field: PanelConfigField };

/** Path segments a {@link PanelConfigWrite} addresses, as `settings.mutate` expects them. */
export function configPath(field: PanelConfigField): string[] {
	return field.split(".");
}

/* ------------------------------------------------------------------ */
/* Change notification                                                 */
/* ------------------------------------------------------------------ */

/** Push one fresh snapshot to whoever is watching. */
export type PanelListener = () => void;

/** The listeners of one plugin instance. */
const registries = new Map<string, Set<PanelListener>>();

function bucket(owner: string): Set<PanelListener> {
	let set = registries.get(owner);
	if (!set) {
		set = new Set();
		registries.set(owner, set);
	}
	return set;
}

/**
 * The per-instance notifier the Host half holds.
 *
 * A plugin reload replaces the instance and therefore the `owner` id, so a
 * stale listener can never fire into a disposed plugin, and a disposed plugin
 * leaves no listener behind.
 */
export function panelEvents(owner: string) {
	return {
		/** Subscribe; returns the disposer. */
		subscribe(listener: PanelListener): () => void {
			const set = bucket(owner);
			set.add(listener);
			return () => {
				set.delete(listener);
			};
		},
		/** Tell every watcher that the runtime state moved. */
		emit(): void {
			for (const listener of [...bucket(owner)]) listener();
		},
		/** Drop the whole registry (plugin disposal). */
		dispose(): void {
			registries.delete(owner);
		},
	};
}

/** The registry one browser half watches, by the same owner id. */
export function watchPanel(owner: string): (listener: PanelListener) => () => void {
	return (listener) => {
		const set = bucket(owner);
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	};
}
