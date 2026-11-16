/**
 * One server's live map (web pages/server/LiveMapTab.tsx, plans/34): the built-in positions stream (2 Hz) on the
 * exported map, each dot moved between frames (drawn a second behind the newest), a trail of the last 20 s, and the
 * game's `points` streams as markers. The screen holds the server watch (POST .../watch every 20 s, like the web's server
 * page) so the kernel posts its streams, and reads them about every second (GET .../streams?since). Owners only; a
 * server that isn't live has no positions. Its own screen (the server page links it) so drags move the map, not the page.
 */
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { Badge, Card, Txt } from "@/components/ui";
import { colorFor, isPlaced, latestValue, pointLayers, playersAt, renderTime, SERVER_DELAY_MS, trails, type LiveDot } from "@/features/maps/live-map";
import { useServerStreams, useServerWatch, useTicker, type StreamsState } from "@/features/maps/live-streams";
import { LiveMap } from "@/features/maps/LiveMap";
import type { MapLayer } from "@/features/maps/maps";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme } from "@/theme";

/** The dots and markers at the screen's clock `now` (web serverMapData). */
function serverMapData(streams: StreamsState, now: number): { dots: LiveDot[]; markers: MapLayer[] } {
	const frames = streams.frames;
	const newest = frames[frames.length - 1]?.t;
	if (newest === undefined) return { dots: [], markers: [] };
	const at = renderTime(newest, now - streams.arrivedAt, SERVER_DELAY_MS);
	const players = playersAt(frames, at);
	const paths = trails(frames, at, players);
	const dots: LiveDot[] = players.filter(isPlaced).map((p) => ({ key: String(p.u), name: p.n, x: p.x, y: p.y, z: p.z, color: colorFor(p.u), trail: paths.get(p.u) ?? [] }));
	const markers = (streams.declared?.streams ?? [])
		.filter((s) => s.k === "points")
		.flatMap((s) => pointLayers(`game.${s.n}`, s.l ?? s.n, latestValue(frames, `game.${s.n}`)?.value, colorFor(`stream:${s.n}`)));
	return { dots, markers };
}

export default function ServerMapScreen() {
	const { job } = useLocalSearchParams<{ job: string }>();
	const j = decodeURIComponent(String(job ?? ""));
	return (
		<TTScreen title={`Live map ${shortId(j, 4)}`} scroll={false}>
			{({ backendId, account }) =>
				account.role === "admin" ? (
					<ServerMap backendId={backendId} job={j} />
				) : (
					<Card style={{ gap: 4 }}>
						<Txt variant="h3">Owners only</Txt>
						<Txt variant="muted">The live map shows players' names and positions: owners only.</Txt>
					</Card>
				)
			}
		</TTScreen>
	);
}

function ServerMap({ backendId, job }: { backendId: string; job: string }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const detail = useTTQuery(backendId, ["server", job], (a, s) => a.fleetServer(job, s), { refetchInterval: 15_000 });
	const live = detail.data?.state === "live";
	const watch = useServerWatch(api, job, live);
	const streams = useServerStreams(api, job, live);
	const now = useTicker(live && streams.frames.length > 0);
	const { dots, markers } = useMemo(() => serverMapData(streams, now), [streams, now]);
	const header = (
		<View style={{ gap: space.xs }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
				<Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>
					{job}
				</Txt>
				<Badge label={!detail.data ? "…" : live ? (watch.watching ? "watching" : "connecting") : "not live"} tone={!detail.data ? "muted" : live ? (watch.watching ? "good" : "warning") : "muted"} />
			</View>
			{detail.data && !live ? <Txt variant="small">This server isn't live: a live map needs a running server.</Txt> : null}
			{watch.error ? (
				<Txt variant="small" color={p.destructive}>
					Watch refused: {watch.error}
				</Txt>
			) : null}
			{streams.error ? (
				<Txt variant="small" color={p.destructive}>
					{streams.error}
				</Txt>
			) : null}
			{live && !streams.loaded ? <Txt variant="small">Waiting for the first positions...</Txt> : null}
			{live && streams.loaded && !streams.frames.length ? <Txt variant="small">No positions yet: kernel 0.5.7+ posts them a second or two after this screen connects.</Txt> : null}
			{markers.length ? <Txt variant="small">Markers: {[...new Set(markers.map((m) => m.label))].join(", ")}</Txt> : null}
		</View>
	);
	return <LiveMap backendId={backendId} dots={dots} markers={markers} label="Live map of this server" header={header} />;
}
