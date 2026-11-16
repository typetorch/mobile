/**
 * Running game servers (server management, BETA): pick a place and a place version (from game-servers:filter-options),
 * filter by state, region, engine version or a CEL expression, sort, and page through the servers with their players,
 * FPS, memory, uptime and region. Tapping a server opens its details and logs. The Restart screen is one tap away.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { mapLimit } from "@/api/http";
import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, Chips, EmptyState, Field, List, Row, Section, Segmented, Skeleton, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { celString, filterValues, gameServerFilterOptions, listGameServers, uptimeSeconds, type GameServer } from "@/features/project/api/servers";
import { CloudError } from "@/features/project/CloudError";
import { Facts, ServerStatusBadge, usePlaces } from "@/features/project/servers/shared";
import { ToolScreen } from "@/features/project/tool";
import { compact, fmtBytes, fmtSeconds, shortId } from "@/lib/format";

export default function ServersScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Servers" scopes={["universe:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "servers"], type: "active" })}>
			{({ universeId, cloud, can }) => <Servers universeId={universeId} cloud={cloud} canRestart={can("universe:write")} />}
		</ToolScreen>
	);
}

type State = "live" | "ended" | "all";

const ORDERS = [
	{ value: "uptime desc", label: "Longest up" },
	{ value: "uptime", label: "Newest" },
	{ value: "occupancy desc", label: "Most players" },
	{ value: "frameRate", label: "Lowest FPS" },
	{ value: "memoryUsageBytes desc", label: "Most memory" },
];

const STATE_FILTER: Record<State, string | undefined> = { live: "shutDown == false", ended: "shutDown == true", all: undefined };

function buildFilter(state: State, region: string, engine: string, custom: string): string | undefined {
	const parts = [STATE_FILTER[state], region ? `serverRegion == ${celString(region)}` : undefined, engine ? `engineVersion == ${celString(engine)}` : undefined, custom.trim() ? `(${custom.trim()})` : undefined].filter(
		(p): p is string => !!p,
	);
	return parts.length ? parts.join(" && ") : undefined;
}

function Servers({ universeId, cloud, canRestart }: { universeId: number; cloud: OpenCloud; canRestart: boolean }) {
	const params = useLocalSearchParams<{ place?: string }>();
	const places = usePlaces(universeId);
	const [picked, setPicked] = useState<number | null>(params.place && /^\d+$/.test(params.place) ? Number(params.place) : null);
	const [manualPlace, setManualPlace] = useState("");
	const placeId = picked ?? places.data?.[0]?.id ?? null;

	const options = useQuery({
		queryKey: ["oc", "servers", universeId, "options", placeId],
		enabled: !!placeId,
		queryFn: () => gameServerFilterOptions(cloud, universeId, placeId!),
		retry: false,
		staleTime: 30_000,
	});
	const versions = filterValues(options.data, "PlaceVersion").sort((a, b) => Number(b) - Number(a));
	const regions = filterValues(options.data, "ServerRegion").sort();
	const engines = filterValues(options.data, "EngineVersion").sort().reverse();

	const [pickedVersion, setPickedVersion] = useState<string | null>(null);
	const [manualVersion, setManualVersion] = useState("");
	const version = pickedVersion && (versions.includes(pickedVersion) || /^\d+$/.test(pickedVersion)) ? pickedVersion : (versions[0] ?? null);

	const [state, setState] = useState<State>("live");
	const [region, setRegion] = useState("");
	const [engine, setEngine] = useState("");
	const [order, setOrder] = useState(ORDERS[0]!.value);
	const [customText, setCustomText] = useState("");
	const [custom, setCustom] = useState("");
	const filter = buildFilter(state, region, engine, custom);

	// Live servers per version (MaxPageSize 0 answers only totalCount); the newest 8 versions, 3 at a time.
	const counts = useQuery({
		queryKey: ["oc", "servers", universeId, "counts", placeId, versions.slice(0, 8).join(",")],
		enabled: !!placeId && versions.length > 0,
		retry: false,
		staleTime: 30_000,
		queryFn: async () => {
			const top = versions.slice(0, 8);
			const totals = await mapLimit(top, 3, (v) =>
				listGameServers(cloud, universeId, placeId!, v, { maxPageSize: 0, filter: STATE_FILTER.live })
					.then((r) => r.totalCount ?? null)
					.catch(() => null),
			);
			return Object.fromEntries(top.map((v, i) => [v, totals[i]])) as Record<string, number | null>;
		},
	});

	const list = useInfiniteQuery({
		queryKey: ["oc", "servers", universeId, "list", placeId, version, order, filter],
		enabled: !!placeId && !!version,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listGameServers(cloud, universeId, placeId!, version!, { maxPageSize: 50, pageToken: pageParam, orderBy: order, filter }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
		retry: false,
	});
	const servers: GameServer[] = list.data?.pages.flatMap((pg) => pg.gameServers ?? []) ?? [];
	const first = list.data?.pages[0];
	const players = servers.reduce((n, s) => n + (s.occupancy ?? 0), 0);
	const fpsValues = servers.map((s) => s.frameRate).filter((f): f is number => typeof f === "number");
	const avgFps = fpsValues.length ? fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length : null;

	return (
		<>
			<Section title="Place">
				{places.isLoading ? (
					<Skeleton height={30} />
				) : places.data?.length ? (
					<Chips options={places.data.map((p) => ({ value: p.id, label: p.name }))} value={placeId ?? 0} onChange={(id) => { setPicked(id); setPickedVersion(null); setRegion(""); setEngine(""); }} />
				) : (
					<Txt variant="small">The experience's places aren't listed publicly; type a place ID.</Txt>
				)}
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<View style={{ flex: 1 }}>
						<Field value={manualPlace} onChangeText={setManualPlace} placeholder="Other place ID" keyboardType="number-pad" />
					</View>
					<Button title="Use" small disabled={!/^\d{1,20}$/.test(manualPlace.trim())} onPress={() => { setPicked(Number(manualPlace.trim())); setPickedVersion(null); }} />
				</View>
			</Section>

			{!placeId ? null : options.error ? (
				<CloudError error={options.error} what="Servers" onRetry={() => options.refetch()} />
			) : (
				<Section title="Version">
					{options.isLoading ? (
						<Skeleton height={30} />
					) : versions.length ? (
						<Chips
							options={versions.map((v) => ({ value: v, label: `v${v}${counts.data?.[v] !== undefined && counts.data[v] !== null ? ` · ${counts.data[v]}` : ""}` }))}
							value={version ?? ""}
							onChange={setPickedVersion}
						/>
					) : (
						<Txt variant="small">No place versions with servers right now.</Txt>
					)}
					<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<View style={{ flex: 1 }}>
							<Field value={manualVersion} onChangeText={setManualVersion} placeholder="Other version number" keyboardType="number-pad" />
						</View>
						<Button title="Use" small disabled={!/^\d{1,9}$/.test(manualVersion.trim())} onPress={() => setPickedVersion(manualVersion.trim())} />
					</View>
				</Section>
			)}

			{placeId && version ? (
				<Card style={{ gap: 8 }}>
					<Segmented options={[{ value: "live", label: "Live" }, { value: "ended", label: "Shut down" }, { value: "all", label: "All" }]} value={state} onChange={setState} />
					<Txt variant="label">Sort</Txt>
					<Chips options={ORDERS} value={order} onChange={setOrder} />
					{regions.length ? (
						<>
							<Txt variant="label">Region</Txt>
							<Chips options={[{ value: "", label: "Any" }, ...regions.map((r) => ({ value: r, label: r }))]} value={region} onChange={setRegion} />
						</>
					) : null}
					{engines.length > 1 ? (
						<>
							<Txt variant="label">Engine version</Txt>
							<Chips options={[{ value: "", label: "Any" }, ...engines.map((e) => ({ value: e, label: e }))]} value={engine} onChange={setEngine} />
						</>
					) : null}
					<View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
						<View style={{ flex: 1 }}>
							<Field label="CEL filter" value={customText} onChangeText={setCustomText} placeholder="occupancy >= 10 && frameRate < 40" maxLength={500} onSubmitEditing={() => setCustom(customText)} />
						</View>
						<Button title={custom === customText ? "Applied" : "Apply"} small disabled={custom === customText} onPress={() => setCustom(customText)} />
					</View>
				</Card>
			) : null}

			{placeId && version ? (
				list.error ? (
					<CloudError error={list.error} what="Servers" onRetry={() => list.refetch()} />
				) : !list.data ? (
					<SkeletonList rows={5} />
				) : (
					<>
						<StatGrid>
							<Stat label="Servers" value={compact(first?.totalCount ?? servers.length)} sub={first?.totalCount === undefined || first?.totalCount === null ? "loaded" : "matching"} />
							<Stat label="Players" value={compact(players)} sub={list.hasNextPage ? "on loaded pages" : undefined} />
							<Stat label="Average FPS" value={avgFps === null ? "–" : avgFps.toFixed(1)} />
						</StatGrid>
						{first?.activeServersFetchError || first?.shutdownServersFetchError ? (
							<Txt variant="small">Roblox couldn't fetch {first.activeServersFetchError ? "the live" : "the shut down"} servers this time; the list may be partial.</Txt>
						) : null}
						{servers.length ? (
							<Section>
								<List>
									{servers.map((s, i) => {
										const up = uptimeSeconds(s.uptime);
										return (
											<Row
												key={s.jobId ?? i}
												title={`${shortId(s.jobId ?? "?", 13)}  ${s.occupancy}/${s.maxOccupancy}`}
												subtitle={
													<Facts
														items={[
															s.frameRate !== null && s.frameRate !== undefined ? `${s.frameRate.toFixed(0)} FPS` : null,
															fmtBytes(s.memoryUsageBytes),
															up !== null ? `up ${fmtSeconds(up)}` : null,
															s.serverRegion,
															s.full ? "full" : null,
														]}
													/>
												}
												right={<ServerStatusBadge status={s.status} />}
												chevron
												onPress={() =>
													s.jobId &&
													router.push(`/project/${universeId}/server?place=${placeId}&version=${encodeURIComponent(s.placeVersion ?? version)}&job=${encodeURIComponent(s.jobId)}`)
												}
											/>
										);
									})}
								</List>
								{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
							</Section>
						) : (
							<EmptyState icon="hardware-chip-outline" title="No servers" body={state === "live" ? "No live servers run this version right now." : "No servers match these filters."} />
						)}
					</>
				)
			) : null}

			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				<Button title="Restart servers" icon="refresh-circle-outline" small onPress={() => router.push(`/project/${universeId}/restart${placeId ? `?place=${placeId}` : ""}`)} />
				{!canRestart ? <Badge label="restart needs universe:write" /> : null}
			</View>
		</>
	);
}
