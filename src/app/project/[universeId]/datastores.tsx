/** Data stores of a universe (cloud/v2 data-stores, scope universe-datastores.control:list), or open one by name. */
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Button, Card, EmptyState, ErrorState, Field, Icon, List, Row, SearchBar, Section, SkeletonList, Txt } from "@/components/ui";
import { ToolScreen } from "@/features/project/tool";
import { fmtDate } from "@/lib/format";
import type { OpenCloud } from "@/api/opencloud";

export default function DataStoresScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Data stores" scopes={["universe-datastores.objects:list"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "datastores"], type: "active" })}>
			{({ universeId, cloud, can }) => <Stores universeId={universeId} cloud={cloud} canList={can("universe-datastores.control:list")} />}
		</ToolScreen>
	);
}

function open(universeId: number, store: string) {
	router.push(`/project/${universeId}/datastore?store=${encodeURIComponent(store)}`);
}

function Stores({ universeId, cloud, canList }: { universeId: number; cloud: OpenCloud; canList: boolean }) {
	const [prefix, setPrefix] = useState("");
	const [applied, setApplied] = useState("");
	const [name, setName] = useState("");
	const q = useInfiniteQuery({
		queryKey: ["oc", "datastores", universeId, applied],
		enabled: canList,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => cloud.listDataStores(universeId, { prefix: applied || undefined, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const stores = q.data?.pages.flatMap((p) => p.dataStores ?? []) ?? [];
	return (
		<>
			<Card style={{ gap: 8 }}>
				<Field label="Open a data store by name" value={name} onChangeText={setName} placeholder="PlayerData" onSubmitEditing={() => name.trim() && open(universeId, name.trim())} />
				<Button title="Open" small disabled={!name.trim()} onPress={() => open(universeId, name.trim())} style={{ alignSelf: "flex-start" }} />
			</Card>
			{canList ? (
				<>
					<SearchBar value={prefix} onChangeText={(t) => { setPrefix(t); if (!t) setApplied(""); }} onSubmit={() => setApplied(prefix.trim())} placeholder="Filter by name prefix" />
					{q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
					{q.isLoading ? <SkeletonList rows={6} /> : null}
					{q.data && !stores.length ? <EmptyState icon="server-outline" title="No data stores" body={applied ? `None start with “${applied}”.` : "This experience hasn't saved anything yet."} /> : null}
					{stores.length ? (
						<Section title={`${stores.length}${q.hasNextPage ? "+" : ""} data stores`}>
							<List>
								{stores.map((s) => (
									<Row
										key={s.id}
										chevron
										onPress={() => open(universeId, s.id)}
										left={<Icon name="server-outline" size={16} />}
										title={s.id}
										subtitle={`${s.createTime ? `created ${fmtDate(s.createTime)}` : ""}${s.state && s.state !== "ACTIVE" ? ` · ${s.state.toLowerCase()}` : ""}`}
									/>
								))}
							</List>
							{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						</Section>
					) : null}
				</>
			) : (
				<View>
					<Txt variant="small">Listing data stores needs universe-datastores.control:list; open one by name instead.</Txt>
				</View>
			)}
		</>
	);
}
