/** Memory stores, read only: a sorted map's items, or a peek at a queue (invisibilityWindow 0s: nothing is hidden). */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, ErrorState, Field, List, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { ToolScreen } from "@/features/project/tool";
import { compactJson, fmtTime } from "@/lib/format";

export default function MemoryScreen() {
	return <ToolScreen title="Memory stores" scopes={[]}>{({ universeId, cloud, can }) => <Memory universeId={universeId} cloud={cloud} canMap={can("memory-store.sorted-map:read")} canQueue={can("memory-store.queue:dequeue")} />}</ToolScreen>;
}

function Memory({ universeId, cloud, canMap, canQueue }: { universeId: number; cloud: OpenCloud; canMap: boolean; canQueue: boolean }) {
	const [kind, setKind] = useState<"map" | "queue">(canMap || !canQueue ? "map" : "queue");
	const [name, setName] = useState("");
	const [open, setOpen] = useState<string | null>(null);
	const map = useInfiniteQuery({
		queryKey: ["oc", "memory", "map", universeId, open],
		enabled: kind === "map" && !!open && canMap,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => cloud.listSortedMap(universeId, open!, { pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const queue = useQuery({ queryKey: ["oc", "memory", "queue", universeId, open], enabled: kind === "queue" && !!open && canQueue, queryFn: () => cloud.peekQueue(universeId, open!, 100), retry: false });
	const allowed = kind === "map" ? canMap : canQueue;
	const items = map.data?.pages.flatMap((p) => p.memoryStoreSortedMapItems ?? p.items ?? []) ?? [];
	return (
		<>
			<Segmented options={[{ value: "map", label: "Sorted map" }, { value: "queue", label: "Queue" }]} value={kind} onChange={(v) => { setKind(v); setOpen(null); }} />
			{!allowed ? (
				<Txt variant="muted">Needs {kind === "map" ? "memory-store.sorted-map:read" : "memory-store.queue:dequeue"} on the key.</Txt>
			) : (
				<Card style={{ gap: 8 }}>
					<Field label={kind === "map" ? "Sorted map name" : "Queue name"} value={name} onChangeText={setName} placeholder={kind === "map" ? "Matchmaking" : "JobQueue"} />
					{kind === "queue" ? <Txt variant="small">A peek (invisibility window 0 s): game servers still see every item.</Txt> : null}
					<Button title="Read" variant="brand" small disabled={!name.trim()} onPress={() => setOpen(name.trim())} style={{ alignSelf: "flex-start" }} />
				</Card>
			)}
			{kind === "map" && open ? (
				<>
					{map.error ? <ErrorState error={map.error} onRetry={() => map.refetch()} /> : null}
					{map.isLoading ? <SkeletonList rows={6} /> : null}
					{map.data ? (
						<Section title={`${items.length}${map.hasNextPage ? "+" : ""} items`}>
							<List>
								{items.map((it) => (
									<Row key={it.path} title={it.id} subtitle={`${compactJson(it.value, 140)}${it.expireTime ? ` · expires ${fmtTime(it.expireTime)}` : ""}`} numberOfLines={1} right={it.numericSortKey !== undefined ? <Txt variant="small">{it.numericSortKey}</Txt> : it.stringSortKey ? <Txt variant="small">{it.stringSortKey}</Txt> : undefined} />
								))}
							</List>
							{map.hasNextPage ? <Button title="Load more" small loading={map.isFetchingNextPage} onPress={() => map.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						</Section>
					) : null}
				</>
			) : null}
			{kind === "queue" && open ? (
				<>
					{queue.error ? <ErrorState error={queue.error} onRetry={() => queue.refetch()} /> : null}
					{queue.isLoading ? <SkeletonList rows={6} /> : null}
					{queue.data ? (
						<Section title={`${queue.data.queueItems?.length ?? 0} items`}>
							<List>
								{(queue.data.queueItems ?? []).map((it, i) => (
									<Row key={i} title={compactJson(it.data, 200)} subtitle={`${it.priority !== undefined ? `priority ${it.priority}` : ""}${it.expireTime ? ` · expires ${fmtTime(it.expireTime)}` : ""}`} numberOfLines={3} />
								))}
							</List>
						</Section>
					) : null}
				</>
			) : null}
		</>
	);
}
