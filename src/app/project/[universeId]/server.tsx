/**
 * One game server (server management, BETA): its details (found again by `jobId == …` on the version's list), the
 * players in it (each opens the player lookup or the ban check), its console output (game server logs) and, given a
 * play session id, that client's output (client session logs, EXPERIMENTAL; Roblox has no list of session ids).
 * There is no per-server shutdown with an API key: "Restart this version" opens the Restart screen with this place and
 * version picked.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { headshots, usersByIds } from "@/api/roblox-public";
import { Button, Card, ErrorState, Field, KV, List, Row, Section, Segmented, Skeleton, Txt } from "@/components/ui";
import { celString, clientSessionLogs, gameServerLogs, listGameServers, SESSION_ID, uptimeSeconds } from "@/features/project/api/servers";
import { CloudError } from "@/features/project/CloudError";
import { LogsPanel, ServerStatusBadge, usePlaces, placeName } from "@/features/project/servers/shared";
import { ToolScreen } from "@/features/project/tool";
import { fmtBytes, fmtSeconds, fmtTime } from "@/lib/format";
import { useTheme } from "@/theme";

export default function ServerScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Server" scopes={["universe:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "server"], type: "active" })}>
			{({ universeId, cloud }) => <Server universeId={universeId} cloud={cloud} />}
		</ToolScreen>
	);
}

function Server({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const params = useLocalSearchParams<{ place?: string; version?: string; job?: string }>();
	const placeId = /^\d+$/.test(params.place ?? "") ? Number(params.place) : null;
	const version = /^\d+$/.test(params.version ?? "") ? params.version! : null;
	const jobId = params.job ?? "";
	const places = usePlaces(universeId);
	const [tab, setTab] = useState<"server" | "client">("server");
	const [sessionText, setSessionText] = useState("");
	const [sessionId, setSessionId] = useState<string | null>(null);

	const detail = useQuery({
		queryKey: ["oc", "server", universeId, placeId, version, jobId],
		enabled: !!placeId && !!version && !!jobId,
		retry: false,
		queryFn: async () => (await listGameServers(cloud, universeId, placeId!, version!, { maxPageSize: 1, filter: `jobId == ${celString(jobId)}` })).gameServers?.[0] ?? null,
	});
	const s = detail.data;
	const ids = s?.playerIds ?? [];
	const people = useQuery({
		queryKey: ["users", "with-heads", ids.slice().sort().join(",")],
		enabled: ids.length > 0,
		staleTime: 3600_000,
		queryFn: async () => {
			const [users, heads] = await Promise.all([usersByIds(ids), headshots(ids).catch(() => ({}) as Record<number, string>)]);
			return { names: new Map(users.map((u) => [u.id, u])), heads };
		},
	});

	if (!placeId || !version || !jobId) return <ErrorState error={new Error("This link is missing the place, version or job id.")} />;
	const up = uptimeSeconds(s?.uptime);
	const sessionOk = SESSION_ID.test(sessionText.trim()) && !/^[0-]+$/.test(sessionText.trim());

	return (
		<>
			<Stack.Screen options={{ title: `Server ${jobId.slice(0, 8)}` }} />
			<Card style={{ gap: 2 }}>
				<KV label="Job ID" value={jobId} mono />
				<KV label="Place" value={`${placeName(places.data, placeId)} · v${version}`} />
				{detail.isLoading ? (
					<Skeleton height={80} />
				) : detail.error ? (
					<CloudError error={detail.error} what="Servers" onRetry={() => detail.refetch()} />
				) : s ? (
					<>
						<KV label="Status" value={<ServerStatusBadge status={s.status} />} />
						<KV label="Players" value={`${s.occupancy} / ${s.maxOccupancy}${s.full ? " (full)" : ""}`} />
						<KV label="Server FPS" value={s.frameRate !== null && s.frameRate !== undefined ? s.frameRate.toFixed(1) : "–"} />
						<KV label="Memory" value={fmtBytes(s.memoryUsageBytes)} />
						<KV label="Uptime" value={up !== null ? fmtSeconds(up) : s.uptime} />
						<KV label="Started" value={`${fmtTime(s.createTime)} UTC`} />
						{s.terminationTime ? <KV label="Ended" value={`${fmtTime(s.terminationTime)} UTC`} /> : null}
						<KV label="Region" value={s.serverRegion ?? "–"} />
						<KV label="Engine" value={s.engineVersion ?? "–"} mono />
						<KV label="Server type" value={String(s.type)} />
					</>
				) : (
					<Txt variant="small">Roblox no longer lists this server (it may have shut down a while ago). Its logs may still be here.</Txt>
				)}
			</Card>

			{ids.length ? (
				<Section title={`Players (${ids.length})`}>
					<List>
						{ids.map((id) => {
							const u = people.data?.names.get(id);
							const head = people.data?.heads[id];
							return (
								<Row
									key={id}
									left={head ? <Image source={{ uri: head }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : undefined}
									title={u ? `${u.displayName} (@${u.name})` : `User ${id}`}
									subtitle={String(id)}
									onPress={() => router.push(`/project/${universeId}/player?user=${id}`)}
									right={<Button title="Ban…" small onPress={() => router.push(`/project/${universeId}/bans?user=${id}`)} />}
								/>
							);
						})}
					</List>
				</Section>
			) : null}

			<Button
				title="Restart this version's servers"
				icon="refresh-circle-outline"
				small
				onPress={() => router.push(`/project/${universeId}/restart?place=${placeId}&version=${version}`)}
				style={{ alignSelf: "flex-start" }}
			/>
			<Txt variant="small">Roblox has no API-key call to shut down one server; a restart filtered to this place version is the closest.</Txt>

			<Segmented options={[{ value: "server", label: "Server logs" }, { value: "client", label: "Client session logs" }]} value={tab} onChange={setTab} />
			{tab === "server" ? (
				<LogsPanel
					queryKey={["oc", "server", universeId, "logs", placeId, version, jobId]}
					what="Server logs"
					fetchPage={async (q, token) => {
						const r = await gameServerLogs(cloud, universeId, placeId, version, jobId, q, token);
						return { entries: r.gameServerLogs ?? [], next: r.nextPageToken };
					}}
				/>
			) : (
				<View style={{ gap: 8 }}>
					<Txt variant="small">A client's output during one play session on this server (EXPERIMENTAL). Roblox doesn't list session ids; paste one (a UUID) from your own logging.</Txt>
					<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<View style={{ flex: 1 }}>
							<Field value={sessionText} onChangeText={setSessionText} placeholder="Session id (UUID)" maxLength={36} />
						</View>
						<Button title="Show" small disabled={!sessionOk} onPress={() => setSessionId(sessionText.trim().toLowerCase())} />
					</View>
					{sessionText.trim() && !sessionOk ? <Txt variant="small" color={p.destructive}>A session id is a non-zero UUID like 1b4e28ba-2fa1-11d2-883f-0016d3cca427.</Txt> : null}
					{sessionId ? (
						<LogsPanel
							queryKey={["oc", "server", universeId, "client-logs", placeId, jobId, sessionId]}
							what="Client session logs"
							fetchPage={async (q, token) => {
								const r = await clientSessionLogs(cloud, universeId, placeId, jobId, sessionId, q, token);
								return { entries: r.clientLogs ?? [], next: r.nextPageToken };
							}}
						/>
					) : null}
				</View>
			)}
		</>
	);
}
