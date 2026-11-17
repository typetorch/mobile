/**
 * Milestone pushes (docs/PUSH_WATCH_WIDGETS.md): the backend's `ccuMilestone` alert sends "Reached 160 CCU" through
 * Expo's push service to every phone registered for it. Here: the Android channel, the permission, this phone's Expo
 * push token, and one registration per backend.
 *
 * A registration belongs to the backend's mobile token, and a token refresh revokes the old one with it, so the app
 * remembers which token it registered with and registers again when that changed (`syncPushRegistrations`).
 *
 * The push token needs Firebase in the build (google-services.json, docs/FIREBASE_SETUP.md); without it
 * `pushToken()` fails with a "not set up" error and the switches stay off.
 */
import * as Notifications from "expo-notifications";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

import type { Api } from "@/api/backend";
import type { BackendAccount } from "@/store/accounts";
import { storedValue } from "@/features/typetorch/persist";

export const MILESTONE_CHANNEL = "milestones";

/** Per backend: milestones wanted, and the mobile token id the registration was made with. */
type PushPrefs = Record<string, { on: boolean; tokenId?: string }>;
const prefs = storedValue<PushPrefs>(
	"push.prefs.v1",
	{},
	(text) => {
		try {
			const v = JSON.parse(text) as unknown;
			return v && typeof v === "object" ? (v as PushPrefs) : undefined;
		} catch {
			return undefined;
		}
	},
	(v) => JSON.stringify(v),
);
export function usePushPrefs(): PushPrefs {
	return useSyncExternalStore(prefs.subscribe, prefs.get);
}

/** The milestone channel (Android 13+ shows the permission prompt only once a channel exists). */
export async function ensureChannels(): Promise<void> {
	if (Platform.OS !== "android") return;
	await Notifications.setNotificationChannelAsync(MILESTONE_CHANNEL, {
		name: "CCU milestones",
		description: "Reached 10, 20, 40, 80… players",
		importance: Notifications.AndroidImportance.HIGH,
		sound: "default",
		vibrationPattern: [0, 200, 120, 200],
		lightColor: "#fb7a32",
	}).catch(() => undefined);
}

/** Pushes that arrive while the app is open show as a banner too. */
export function installForegroundHandler(): void {
	Notifications.setNotificationHandler({
		handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
	});
}

export class PushNotSetUp extends Error {}

/** Asks for the permission when needed; false when the person said no. */
export async function askPermission(): Promise<boolean> {
	await ensureChannels();
	const now = await Notifications.getPermissionsAsync();
	if (now.granted) return true;
	if (!now.canAskAgain) return false;
	return (await Notifications.requestPermissionsAsync()).granted;
}

let cached: string | null = null;

/** This phone's Expo push token (cached). Throws PushNotSetUp when the build has no Firebase. */
export async function pushToken(): Promise<string> {
	if (cached) return cached;
	try {
		const t = await Notifications.getExpoPushTokenAsync();
		cached = t.data;
		return t.data;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (/firebase|FirebaseApp|google-services|FCM|fcm/i.test(msg)) throw new PushNotSetUp("Push isn't set up in this build yet (Firebase, docs/FIREBASE_SETUP.md).");
		throw error;
	}
}

export async function setMilestones(account: BackendAccount, api: Api, on: boolean): Promise<void> {
	await prefs.load();
	if (on) {
		if (!(await askPermission())) throw new Error("Notifications are off for TypeTorch: allow them in the phone's settings.");
		await api.pushRegister(await pushToken(), true);
		prefs.set({ ...prefs.get(), [account.id]: { on: true, tokenId: account.tokenId } });
	} else {
		await api.pushUnregister().catch(() => undefined);
		prefs.set({ ...prefs.get(), [account.id]: { on: false } });
	}
}

/** Registers again where the mobile token changed since (a refresh or a new sign-in); quietly, errors kept for later. */
export async function syncPushRegistrations(backends: BackendAccount[], apiOf: (id: string) => Api | null): Promise<void> {
	await prefs.load();
	const all = prefs.get();
	for (const b of backends) {
		const p = all[b.id];
		if (!p?.on || b.signedOut || p.tokenId === b.tokenId) continue;
		const api = apiOf(b.id);
		if (!api) continue;
		try {
			await api.pushRegister(await pushToken(), true);
			prefs.set({ ...prefs.get(), [b.id]: { on: true, tokenId: b.tokenId } });
		} catch {
			// the next start tries again
		}
	}
}

/** What a tapped push wants opened: the backend it came from (by URL) and its kind. */
export function pushTarget(response: Notifications.NotificationResponse | null | undefined): { backendUrl: string; kind: string } | null {
	const data = response?.notification.request.content.data as { backendUrl?: unknown; kind?: unknown } | undefined;
	return data && typeof data.backendUrl === "string" ? { backendUrl: data.backendUrl, kind: typeof data.kind === "string" ? data.kind : "" } : null;
}
