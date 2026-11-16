/** Ordered data stores (leaderboards): entries by value, highest first. */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, ErrorState, Field, List, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { ToolScreen } from "@/features/project/tool";
import { fmtInt } from "@/lib/format";

export default function OrderedScreen() {
	return <ToolScreen title="Ordered data stores" scopes={["universe.ordered-data-store.scope.entry:read"]}>{({ universeId, cloud }) => <Ordered universeId={universeId} cloud={cloud} />}</ToolScreen>;
}

function Ordered({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const [store, setStore] = useState("");
	const [scope, setScope] = useState("global");
	const [desc, setDesc] = useState(true);
	const [open, setOpen] = useState<{ store: string; scope: string } | null>(null);
	const q = useInfiniteQuery({
		queryKey: ["oc", "ordered", universeId, open?.store, open?.scope, desc],
		enabled: !!open,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => cloud.listOrdered(universeId, open!.store, open!.scope, { desc, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const entries = q.data?.pages.flatMap((p) => p.orderedDataStoreEntries ?? []) ?? [];
	return (
		<>
			<Card style={{ gap: 8 }}>
				<Txt variant="muted">Roblox has no list of ordered data stores; enter the name your game uses.</Txt>
				<Field label="Ordered data store" value={store} onChangeText={setStore} placeholder="Leaderboard_Coins" />
				<Field label="Scope" value={scope} onChangeText={setScope} placeholder="global" />
				<Button title="Show entries" variant="brand" small disabled={!store.trim()} onPress={() => setOpen({ store: store.trim(), scope: scope.trim() || "global" })} style={{ alignSelf: "flex-start" }} />
			</Card>
			{open ? (
				<>
					<Segmented options={[{ value: 1, label: "Highest first" }, { value: 0, label: "Lowest first" }]} value={desc ? 1 : 0} onChange={(v) => setDesc(v === 1)} />
					{q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
					{q.isLoading ? <SkeletonList rows={8} /> : null}
					{q.data ? (
						<Section title={`${open.store} · ${open.scope}`}>
							{entries.length ? (
								<List>
									{entries.map((e, i) => (
										<Row key={e.path} left={<View style={{ width: 28 }}><Txt variant="small">#{i + 1}</Txt></View>} title={e.id} right={<Txt style={{ fontWeight: "600" }}>{fmtInt(e.value)}</Txt>} />
									))}
								</List>
							) : (
								<Txt variant="muted">No entries.</Txt>
							)}
							{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						</Section>
					) : null}
				</>
			) : null}
		</>
	);
}
