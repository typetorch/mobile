/**
 * Over-the-air updates (EAS Update): the build checks on every start and applies a new update on the next one; this
 * section checks now, downloads and restarts on demand. Expo Go and the dev build's dev server don't use updates.
 */
import * as Updates from "expo-updates";
import { useState } from "react";

import { Button, Card, KV, Txt } from "@/components/ui";
import { fmtDate } from "@/lib/format";

type State = { kind: "idle" } | { kind: "busy"; what: string } | { kind: "none" } | { kind: "ready" } | { kind: "error"; message: string };

export function AppUpdatesCard() {
	const [state, setState] = useState<State>({ kind: "idle" });
	if (!Updates.isEnabled) {
		return (
			<Card>
				<Txt variant="muted">Updates are off here (Expo Go or a dev server): code comes from the dev server instead.</Txt>
			</Card>
		);
	}
	async function check() {
		try {
			setState({ kind: "busy", what: "Checking…" });
			const found = await Updates.checkForUpdateAsync();
			if (!found.isAvailable) return setState({ kind: "none" });
			setState({ kind: "busy", what: "Downloading…" });
			await Updates.fetchUpdateAsync();
			setState({ kind: "ready" });
		} catch (e) {
			setState({ kind: "error", message: (e as Error).message });
		}
	}
	return (
		<Card style={{ gap: 6 }}>
			<KV label="Channel" value={Updates.channel ?? "–"} />
			<KV label="Runtime" value={Updates.runtimeVersion ?? "–"} mono />
			<KV label="Running" value={Updates.isEmbeddedLaunch ? "the build's own code" : `update ${Updates.updateId?.slice(0, 8) ?? ""}`} />
			{Updates.createdAt ? <KV label="Published" value={fmtDate(Updates.createdAt.getTime())} /> : null}
			{state.kind === "none" ? <Txt variant="small">You're on the latest update.</Txt> : null}
			{state.kind === "error" ? <Txt variant="small">{state.message}</Txt> : null}
			{state.kind === "ready" ? (
				<Button title="Restart to update" variant="brand" icon="refresh-outline" onPress={() => Updates.reloadAsync()} />
			) : (
				<Button title={state.kind === "busy" ? state.what : "Check for updates"} variant="ghost" icon="cloud-download-outline" loading={state.kind === "busy"} onPress={check} />
			)}
		</Card>
	);
}
