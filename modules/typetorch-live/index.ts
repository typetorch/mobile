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
