/**
 * The live watch (docs/PUSH_WATCH_WIDGETS.md): an ongoing notification per game, kept by the native service until Stop.
 * The list of watched backends lives in the native module; screens re-read it on focus and after a change.
 */
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { askPermission } from "@/features/notifications/push";
import * as Live from "@modules/typetorch-live";

export function liveAvailable(): boolean {
	return Live.isAvailable();
}

function read(): string[] {
	try {
		return Live.watching();
	} catch {
		return [];
	}
}

const listeners = new Set<() => void>();
const changed = () => {
	for (const l of listeners) l();
};

/** The watched backend ids, kept fresh (another screen's toggle, Stop tapped in the notification while away). */
export function useWatching(): string[] {
	const [ids, setIds] = useState(read);
	const update = useCallback(() => setIds(read()), []);
	useEffect(() => {
		listeners.add(update);
		const sub = AppState.addEventListener("change", (s) => {
			if (s === "active") update();
		});
		return () => {
			listeners.delete(update);
			sub.remove();
		};
	}, [update]);
	return ids;
}

/** Starts or stops a backend's watch; starting asks for the notification permission first. */
export async function setWatching(id: string, on: boolean): Promise<void> {
	if (on) {
		if (!(await askPermission())) throw new Error("Notifications are off for TypeTorch: allow them in the phone's settings, then try again.");
		if (!Live.startWatch(id)) throw new Error("Android didn't let the watch start: open TypeTorch's phone settings and allow it to run in the background.");
	} else Live.stopWatch(id);
	changed();
	// the service updates its list a moment later
	setTimeout(changed, 600);
}
