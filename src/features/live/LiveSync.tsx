/**
 * Keeps what runs outside the app in step with the accounts (docs/PUSH_WATCH_WIDGETS.md):
 *  - the native module's backend list (the live watch and the widgets poll with these tokens; a token refresh revokes
 *    the old one at once, so every change of the accounts is handed over), and the widgets redrawn on start and return;
 *  - the widget's look (widgets/default-widget.ts compiled to the widget spec, docs/WIDGET_HTML.md) and then its logic
 *    (the widget program, docs/WIDGET_PROGRAM.md), handed over before every redraw from here;
 *  - milestone push registrations made again where the mobile token changed;
 *  - a tapped push opens its backend's Fleet page (found by the backend's URL; a cold start reads the last response).
 * Renders nothing; mounted once inside the accounts provider and the router.
 */
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { ensureChannels, installForegroundHandler, pushTarget, syncPushRegistrations } from "@/features/notifications/push";
import { WIDGET_SPEC_JSON } from "@/features/live/widgets";
import { WIDGET_PROGRAM } from "@/features/live/widgets/program.generated";
import { useAccounts } from "@/store/accounts";
import * as Live from "@modules/typetorch-live";

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

installForegroundHandler();

/**
 * The spec for the native path (no program: an older APK over OTA, or a phone without the JS engine): the game chips'
 * taps as `toggle:games.N`, which every APK knows, instead of the program's `action:toggle:{games.N.id}`.
 */
const NATIVE_PATH_SPEC_JSON =
	WIDGET_SPEC_JSON?.replace(/"tap":"action:toggle:\{games\.(\d{1,2})\.id\}"/g, '"tap":"toggle:games.$1"') ?? null;

/** Whether the native side ran the program the last time it was sent (null: not sent yet in this process). */
let programRuns: boolean | null = null;

/**
 * `setWidgetProgram` where the module has it (an older APK over OTA may not): true when the native side runs the
 * program, false when it can't (no function, no engine on this phone, an error).
 */
function sendWidgetProgram(source: string): boolean {
	const fn = (Live as unknown as { setWidgetProgram?: (source: string) => unknown }).setWidgetProgram;
	if (typeof fn !== "function") return false;
	try {
		return fn(source) === true;
	} catch {
		return false;
	}
}

/** The widget spec for where the program runs (or may run), else the native path's. */
const specFor = (runs: boolean | null) => (runs === false ? NATIVE_PATH_SPEC_JSON : WIDGET_SPEC_JSON);

export function LiveSync() {
	const { ready, backends, backendToken, backendApi } = useAccounts();
	const latest = useRef({ backends, backendApi });
	latest.current = { backends, backendApi };

	useEffect(() => {
		void ensureChannels();
	}, []);

	// The native list: every signed-in backend with its current token.
	useEffect(() => {
		if (!ready) return;
		const list = backends.flatMap((b) => {
			const token = backendToken(b.id);
			return token && !b.signedOut ? [{ id: b.id, name: b.name, url: b.url, token, link: `typetorch://tt/${b.id}/fleet` }] : [];
		});
		try {
			Live.setBackends(list);
			// The look first (a no-op natively when unchanged), so this redraw already uses it; then the program. Where the
			// program doesn't run, the look whose chips the native path knows.
			const first = specFor(programRuns);
			if (first) Live.setWidgetSpec(first);
			programRuns = sendWidgetProgram(WIDGET_PROGRAM);
			const spec = specFor(programRuns);
			if (spec && spec !== first) Live.setWidgetSpec(spec);
			Live.refreshWidgets();
		} catch {
			// no native module (Expo Go): nothing runs outside the app there
		}
		void syncPushRegistrations(backends, backendApi);
		// backendToken / backendApi follow `backends` (a token change rewrites the account)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ready, backends]);

	// Back in front: fresh numbers on the widgets.
	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") return;
			try {
				Live.refreshWidgets();
			} catch {
				// no native module
			}
		});
		return () => sub.remove();
	}, []);

	// A tapped push: its backend's Fleet page.
	useEffect(() => {
		if (!ready) return;
		const open = (response: Notifications.NotificationResponse | null | undefined) => {
			const target = pushTarget(response);
			if (!target) return;
			const b = latest.current.backends.find((x) => sameUrl(x.url, target.backendUrl));
			if (b) router.push(`/tt/${b.id}/fleet`);
		};
		const last = Notifications.getLastNotificationResponse();
		if (last) {
			// a cold start: let the navigator mount first
			setTimeout(() => open(last), 400);
			void Notifications.clearLastNotificationResponseAsync?.().catch(() => undefined);
		}
		const sub = Notifications.addNotificationResponseReceivedListener(open);
		return () => sub.remove();
	}, [ready]);

	return null;
}
