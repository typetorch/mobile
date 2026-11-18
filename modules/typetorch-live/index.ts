/**
 * typetorch-live: the Android live watch (ongoing notifications) and home-screen widgets.
 * See docs/PUSH_WATCH_WIDGETS.md, section 3. Android only; every function is a safe no-op where the native module
 * is missing (Expo Go, iOS, web) and none of them throws.
 */
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export type LiveBackend = {
	/** Stable id of the backend (the app's account id). */
	id: string;
	/** Shown when the backend has not answered yet. */
	name: string;
	/** Base URL, e.g. "https://typetorch.example.com" (the module calls `${url}/v1/mobile/live`). */
	url: string;
	/** Mobile token (`ttm_…`); kept in the app's private SharedPreferences only. */
	token: string;
	/** Deep link opened by a tap on the notification or widget (e.g. "typetorch://…"); "" opens the app. */
	link: string;
};

type NativeTypeTorchLive = {
	setBackends(list: LiveBackend[]): void;
	startWatch(id: string): void;
	stopWatch(id: string): void;
	watching(): string[];
	refreshWidgets(): void;
	setWidgetSpec(json: string): void;
	// Added with the widget stats (docs/WIDGET_STATS.md); missing in older builds of the module.
	widgetsJson?(): string;
	setWidgetConfig?(id: number, config: { backendId?: string; slots?: string[] }): boolean;
	defaultSlotsJson?(): string;
	setDefaultSlots?(slots: string[]): void;
};

/** The stat slots new widgets get until the app sets others (the same as Store.BUILT_IN_SLOTS natively). */
export const BUILT_IN_SLOTS: readonly string[] = ["session:1h", "dau", "d1", "revenue:72h"];

/** The backend id of an all-games widget (docs/WIDGET_SPEC.md, All games; docs/WIDGET_RELEASES.md, section 3). */
export const ALL_GAMES = "*";

/** The slots of the Releases style (slot 1 empty is its marker); an all-games widget gets them by default. */
export const RELEASES_SLOTS: readonly string[] = ["", "", "", "releases"];

/** A home-screen widget as the native side keeps it (docs/WIDGET_STATS.md). */
export type LiveWidget = {
	/** The launcher's widget id. */
	id: number;
	/** The backend (account id) it shows; "" until a game is picked; ALL_GAMES ("*") for all games. */
	backendId: string;
	/** Metric ids of its stat slots (up to 4; "" = empty), e.g. ["session:1h", "dau", "d1", "revenue:72h"]. */
	slots: string[];
	/** An all-games widget's picked game (a backend id, tapped on the widget); "" = all games (or an older build). */
	filter: string;
};

const native: NativeTypeTorchLive | null =
	Platform.OS === "android" ? requireOptionalNativeModule<NativeTypeTorchLive>("TypeTorchLive") : null;

function warn(what: string, error: unknown): void {
	// Never log arguments here: setBackends carries tokens.
	console.warn(`[typetorch-live] ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
}

/** True when the native module is in this build (an Android dev/preview/production build, not Expo Go or web). */
export function isAvailable(): boolean {
	return native != null;
}

/**
 * Replaces the saved backends (the service and widgets read them without JS). Call at start, after sign-in, sign-out
 * and every token refresh. Watches of backends no longer in the list end; a new token resumes a signed-out watch.
 */
export function setBackends(list: LiveBackend[]): void {
	if (!native) return;
	try {
		native.setBackends(
			list.map((b) => ({
				id: String(b.id),
				name: String(b.name ?? ""),
				url: String(b.url ?? ""),
				token: String(b.token ?? ""),
				link: String(b.link ?? ""),
			})),
		);
	} catch (e) {
		warn("setBackends", e);
	}
}

/**
 * Starts the live watch of a backend (one ongoing notification). Asks nothing: request POST_NOTIFICATIONS first
 * (without it the watch runs but its notification is hidden). Call it while the app is in the foreground.
 * Returns false when it could not start (unknown id: call setBackends first; or Android refused the service).
 */
export function startWatch(id: string): boolean {
	if (!native) return false;
	try {
		native.startWatch(id);
		return true;
	} catch (e) {
		warn("startWatch", e);
		return false;
	}
}

/** Stops the live watch of a backend (same as its notification's Stop). */
export function stopWatch(id: string): void {
	if (!native) return;
	try {
		native.stopWatch(id);
	} catch (e) {
		warn("stopWatch", e);
	}
}

/** Ids of the watched backends (saved; a watch also ends from its notification's Stop, so re-read on app foreground). */
export function watching(): string[] {
	if (!native) return [];
	try {
		const ids = native.watching();
		return Array.isArray(ids) ? ids : [];
	} catch (e) {
		warn("watching", e);
		return [];
	}
}

/** Redraws every widget now and refreshes their numbers in the background (after setBackends, on app foreground). */
export function refreshWidgets(): void {
	if (!native) return;
	try {
		native.refreshWidgets();
	} catch (e) {
		warn("refreshWidgets", e);
	}
}

/**
 * Sets the home-screen widget's look: a widget spec as JSON (docs/WIDGET_SPEC.md, typed in
 * src/features/live/widget-spec.ts). Saved natively (the widgets draw it without JS); "" goes back to the built-in
 * default. A spec the native renderer can't parse is rejected (false, a warning with the reason) and the saved one
 * stays. Draws nothing by itself: call refreshWidgets() after.
 */
export function setWidgetSpec(json: string): boolean {
	if (!native) return false;
	try {
		native.setWidgetSpec(String(json ?? ""));
		return true;
	} catch (e) {
		warn("setWidgetSpec", e);
		return false;
	}
}

/** The home-screen widgets placed now, with their game and stat slots ([] without the native module). */
export function widgets(): LiveWidget[] {
	if (!native?.widgetsJson) return [];
	try {
		const parsed: unknown = JSON.parse(native.widgetsJson());
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((w): LiveWidget[] => {
			if (!w || typeof w !== "object") return [];
			const o = w as { id?: unknown; backendId?: unknown; slots?: unknown; filter?: unknown };
			if (typeof o.id !== "number") return [];
			return [
				{
					id: o.id,
					backendId: typeof o.backendId === "string" ? o.backendId : "",
					slots: Array.isArray(o.slots) ? o.slots.map((x) => (typeof x === "string" ? x : "")) : [],
					filter: typeof o.filter === "string" ? o.filter : "",
				},
			];
		});
	} catch (e) {
		warn("widgets", e);
		return [];
	}
}

/**
 * Changes a placed widget: its game (a backend id from setBackends, or ALL_GAMES "*": the releases of every signed-in
 * backend, merged) and/or its stat slots (metric ids, up to 4; an invalid id becomes an empty slot; ALL_GAMES without
 * slots gets RELEASES_SLOTS). False for an unknown widget or backend, or without the native module (an APK older than
 * the all-games build also answers false for "*"). Draws nothing: call refreshWidgets() after (it fetches the new
 * metrics).
 */
export function setWidgetConfig(id: number, config: { backendId?: string; slots?: string[] }): boolean {
	if (!native?.setWidgetConfig) return false;
	try {
		const arg: { backendId?: string; slots?: string[] } = {};
		if (config.backendId) arg.backendId = String(config.backendId);
		if (config.slots) arg.slots = config.slots.slice(0, 4).map((x) => String(x ?? ""));
		return native.setWidgetConfig(Math.trunc(id), arg) === true;
	} catch (e) {
		warn("setWidgetConfig", e);
		return false;
	}
}

/** The stat slots a newly placed widget gets (BUILT_IN_SLOTS until setDefaultSlots, or without the native module). */
export function defaultSlots(): string[] {
	if (!native?.defaultSlotsJson) return [...BUILT_IN_SLOTS];
	try {
		const parsed: unknown = JSON.parse(native.defaultSlotsJson());
		return Array.isArray(parsed) ? parsed.map((x) => (typeof x === "string" ? x : "")) : [...BUILT_IN_SLOTS];
	} catch (e) {
		warn("defaultSlots", e);
		return [...BUILT_IN_SLOTS];
	}
}

/** The stat slots a newly placed widget gets (saved natively; the built-in default until set). */
export function setDefaultSlots(slots: string[]): void {
	if (!native?.setDefaultSlots) return;
	try {
		native.setDefaultSlots(slots.slice(0, 4).map((x) => String(x ?? "")));
	} catch (e) {
		warn("setDefaultSlots", e);
	}
}
