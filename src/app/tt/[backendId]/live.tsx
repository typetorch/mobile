/**
 * Live map (web pages/Live.tsx, plans/34): every live server's players at once on the exported map, coloured per
 * server, with a list per server. The screen holds the fleet-wide live map watch (POST /v1/fleet/live-map/watch every
 * 20 s; it lapses a minute after the screen goes): while it holds, kernels 0.5.7+ post their positions every 3 s, and the
 * screen reads the latest of each server every 3 s, moving each dot between its last two frames.
 *
 * Positions and names stay in this screen's memory (never the query cache, storage or a link). Owners only: the
 * read-only role gets a note (the backend refuses it).
 */
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { Card, Txt } from "@/components/ui";
import { colorFor } from "@/features/maps/live-map";
import { liveDots, useLiveMap, useTicker } from "@/features/maps/live-streams";
import { LiveMap, type LiveGroup } from "@/features/maps/LiveMap";
import { TTScreen } from "@/features/typetorch/screen";
import { plural, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme } from "@/theme";

const LIVE_READ_ONLY_TEXT = "The live map shows players' names and positions: owners only.";

export default function LiveScreen() {
	return (
		<TTScreen title="Live map" scroll={false}>
			{({ backendId, account }) => (account.role === "admin" ? <Live backendId={backendId} /> : <ReadOnly />)}
		</TTScreen>
	);
}

function ReadOnly() {
	return (
		<Card style={{ gap: 4 }}>
			<Txt variant="h3">Owners only</Txt>
			<Txt variant="muted">{LIVE_READ_ONLY_TEXT}</Txt>
		</Card>
	);
}

function Live({ backendId }: { backendId: string }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const live = useLiveMap(api, true);
	const now = useTicker(live.servers.length > 0);
	const dots = useMemo(() => liveDots(live.servers, now), [live.servers, now]);
	const groups: LiveGroup[] = live.servers.map((s) => ({
		id: s.job,
		color: colorFor(s.job),
		label: (
			<Pressable onPress={() => router.push(`/tt/${backendId}/server/${encodeURIComponent(s.job)}`)} hitSlop={4} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
				<Txt variant="mono" color={p.brand}>
					{shortId(s.job, 6)}
				</Txt>
				<Txt variant="small">
					{s.branch ?? "–"} · {s.artifact ? shortId(s.artifact, 6) : "–"}
				</Txt>
			</Pressable>
		),
	}));
	const players = live.servers.reduce((n, s) => n + (s.frames[s.frames.length - 1]?.s.positions?.players.length ?? 0), 0);
	const header = (
		<View style={{ gap: space.xs }}>
			<Txt variant="small">
				Every live server's players on the exported map, coloured per server (a frame every 3 s per server, kernel 0.5.7+). {plural(live.servers.length, "server")},{" "}
				{plural(players, "player")}.
			</Txt>
			{live.watchError || live.error ? (
				<Txt variant="small" color={p.destructive}>
					{live.watchError ?? live.error}
				</Txt>
			) : null}
			{live.loaded && !live.servers.length ? <Txt variant="small">No positions yet: servers start posting within seconds of this screen opening (kernels before 0.5.7 never do).</Txt> : null}
		</View>
	);
	return <LiveMap backendId={backendId} dots={dots} groups={groups} label="Live map of every server" header={header} empty={live.loaded ? "No players with a character right now." : "Waiting for the servers..."} />;
}
