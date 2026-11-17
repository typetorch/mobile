/**
 * Keeps what runs outside the app in step with the accounts (docs/PUSH_WATCH_WIDGETS.md):
 *  - the native module's backend list (the live watch and the widgets poll with these tokens; a token refresh revokes
 *    the old one at once, so every change of the accounts is handed over), and the widgets redrawn on start and return;
 *  - the widget's look (widgets/default.html.ts compiled to the widget spec, docs/WIDGET_HTML.md), handed over before
 *    every redraw from here;
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
import { useAccounts } from "@/store/accounts";
import * as Live from "@modules/typetorch-live";

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

installForegroundHandler();

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
			// The look first (a no-op natively when unchanged), so this redraw already uses it.
			if (WIDGET_SPEC_JSON) Live.setWidgetSpec(WIDGET_SPEC_JSON);
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
