/**
 * Data stores of a universe (cloud/v2 data-stores, scope universe-datastores.control:list), or open one by name. Also:
 * stores scheduled for deletion (showDeleted) with undelete, and the once-a-day snapshot (a guaranteed 30-day backup
 * of every key before a risky update). Deleting a store lives on the store's own screen.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, EmptyState, Field, Icon, List, notify, Row, SearchBar, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { listDataStores, snapshotDataStores, undeleteDataStore } from "@/features/project/api/data";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtDate, fmtTime } from "@/lib/format";

export default function DataStoresScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Data stores" scopes={["universe-datastores.objects:list"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "datastores"], type: "active" })}>
			{({ universeId, cloud, can }) => (
				<Stores
					universeId={universeId}
					cloud={cloud}
					canList={can("universe-datastores.control:list")}
					canSnapshot={can("universe-datastores.control:snapshot")}
					canUndelete={can("universe-datastores.control:delete")}
				/>
			)}
		</ToolScreen>
	);
}

function open(universeId: number, store: string) {
	router.push(`/project/${universeId}/datastore?store=${encodeURIComponent(store)}`);
}

function Stores({ universeId, cloud, canList, canSnapshot, canUndelete }: { universeId: number; cloud: OpenCloud; canList: boolean; canSnapshot: boolean; canUndelete: boolean }) {
	const queryClient = useQueryClient();
	const [prefix, setPrefix] = useState("");
	const [applied, setApplied] = useState("");
	const [name, setName] = useState("");
	const [showDeleted, setShowDeleted] = useState(false);
	const [lastSnapshot, setLastSnapshot] = useState<string | null>(null);
	const q = useInfiniteQuery({
		queryKey: ["oc", "datastores", universeId, applied, showDeleted],
		enabled: canList,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listDataStores(cloud, universeId, { prefix: applied || undefined, showDeleted, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const stores = q.data?.pages.flatMap((p) => p.dataStores ?? []) ?? [];

	const snapshot = useMutation({
		mutationFn: () => snapshotDataStores(cloud, universeId),
		onSuccess: (r) => {
			setLastSnapshot(r?.latestSnapshotTime ?? null);
			notify(r?.newSnapshotTaken ? "Snapshot taken" : "Already snapshotted today", r?.newSnapshotTaken ? "The next write to every key keeps the current value as a revision for at least 30 days." : `Roblox allows one snapshot per UTC day. Latest: ${fmtTime(r?.latestSnapshotTime)} UTC.`);
		},
		onError: (e) => notify("Snapshot failed", cloudErrorText(e)),
	});
	const undelete = useMutation({
		mutationFn: (store: string) => undeleteDataStore(cloud, universeId, store),
		onSuccess: (_r, store) => {
			notify("Restored", `${store} is active again.`);
			queryClient.invalidateQueries({ queryKey: ["oc", "datastores", universeId] });
		},
		onError: (e) => notify("Undelete failed", cloudErrorText(e)),
	});

	async function onSnapshot() {
		if (await confirm("Take a snapshot?", "Every key's current value is kept as a revision for at least 30 days, from its next write on. One snapshot per experience per UTC day.", "Snapshot", false)) snapshot.mutate();
	}

	return (
		<>
			<Card style={{ gap: 8 }}>
				<Field label="Open a data store by name" value={name} onChangeText={setName} placeholder="PlayerData" onSubmitEditing={() => name.trim() && open(universeId, name.trim())} hint="A store that doesn't exist yet is made by the first entry you create in it." />
				<Button title="Open" small disabled={!name.trim()} onPress={() => open(universeId, name.trim())} style={{ alignSelf: "flex-start" }} />
			</Card>
			{canSnapshot ? (
				<Card style={{ gap: 8 }}>
					<Txt variant="h3">Snapshot</Txt>
					<Txt variant="small">Before a risky update: guarantees every key's current value stays restorable for 30 days.{lastSnapshot ? ` Latest snapshot: ${fmtTime(lastSnapshot)} UTC.` : ""}</Txt>
					<Button title="Take snapshot" icon="camera-outline" small loading={snapshot.isPending} onPress={onSnapshot} style={{ alignSelf: "flex-start" }} />
				</Card>
			) : null}
			{canList ? (
				<>
					<SearchBar value={prefix} onChangeText={(t) => { setPrefix(t); if (!t) setApplied(""); }} onSubmit={() => setApplied(prefix.trim())} placeholder="Filter by name prefix" />
					<Segmented options={[{ value: 0, label: "Active" }, { value: 1, label: "Include deleted" }]} value={showDeleted ? 1 : 0} onChange={(v) => setShowDeleted(v === 1)} />
					{q.error ? <CloudError error={q.error} what="Data stores" onRetry={() => q.refetch()} /> : null}
					{q.isLoading ? <SkeletonList rows={6} /> : null}
					{q.data && !stores.length && !q.hasNextPage ? <EmptyState icon="server-outline" title="No data stores" body={applied ? `None start with “${applied}”.` : "This experience hasn't saved anything yet."} /> : null}
					{stores.length || q.hasNextPage ? (
						<Section title={`${stores.length}${q.hasNextPage ? "+" : ""} data stores`}>
							{stores.length ? (
								<List>
									{stores.map((s) => {
										const deleted = s.state === "DELETED";
										return (
											<Row
												key={s.id}
												chevron={!deleted}
												onPress={deleted ? undefined : () => open(universeId, s.id)}
												left={<Icon name="server-outline" size={16} />}
												title={s.id}
												subtitle={deleted ? `deleted · gone for good ${fmtDate(s.expireTime)}` : s.createTime ? `created ${fmtDate(s.createTime)}` : undefined}
												right={
													deleted ? (
														canUndelete ? (
															<Button
																title="Undelete"
																small
																loading={undelete.isPending && undelete.variables === s.id}
																onPress={async () => {
																	if (await confirm(`Undelete ${s.id}?`, "Cancels the scheduled permanent deletion; the store and its keys come back.", "Undelete", false)) undelete.mutate(s.id);
																}}
															/>
														) : (
															<Badge label="deleted" tone="critical" />
														)
													) : undefined
												}
											/>
										);
									})}
								</List>
							) : (
								<Txt variant="small">Roblox checked a batch without finding a store{showDeleted ? "" : " (deleted ones are hidden)"}; load more to keep looking.</Txt>
							)}
							{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						</Section>
					) : null}
					{showDeleted && !canUndelete ? <Txt variant="small">Add universe-datastores.control:delete to undelete stores.</Txt> : null}
				</>
			) : (
				<View>
					<Txt variant="small">Listing data stores needs universe-datastores.control:list; open one by name instead.</Txt>
				</View>
			)}
		</>
	);
}
