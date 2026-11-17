/** "Watch" beside a game's live numbers: starts or stops its ongoing notification (live watch). Hidden without the module. */
import { useState } from "react";

import { Button, notify } from "@/components/ui";

import { liveAvailable, setWatching, useWatching } from "./watch";

export function WatchButton({ backendId }: { backendId: string }) {
	const watching = useWatching().includes(backendId);
	const [busy, setBusy] = useState(false);
	if (!liveAvailable()) return null;
	return (
		<Button
			title={watching ? "Watching" : "Watch"}
			small
			variant={watching ? "brand" : "ghost"}
			icon={watching ? "eye" : "eye-outline"}
			loading={busy}
			onPress={() => {
				setBusy(true);
				setWatching(backendId, !watching)
					.then(() => {
						if (!watching) notify("Watching", "Live numbers are in your notifications until you tap Stop there (or here).");
					})
					.catch((error: unknown) => notify("Couldn't start the watch", error instanceof Error ? error.message : String(error)))
					.finally(() => setBusy(false));
			}}
		/>
	);
}
