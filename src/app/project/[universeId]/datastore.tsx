/** One data store's keys (cloud/v2 entries list), by scope and key prefix. */
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, EmptyState, ErrorState, Field, List, Row, SearchBar, Section, SkeletonList, Txt } from "@/components/ui";
import { ToolScreen } from "@/features/project/tool";

export default function DataStoreScreen() {
	const { store } = useLocalSearchParams<{ store: string }>();
	const queryClient = useQueryClient();
	const name = String(store ?? "");
	return (
		<ToolScreen title={name || "Data store"} scopes={["universe-datastores.objects:list"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "entries"], type: "active" })}>
			{({ universeId, cloud }) => <Entries universeId={universeId} cloud={cloud} store={name} />}
		</ToolScreen>
	);
}

function Entries({ universeId, cloud, store }: { universeId: number; cloud: OpenCloud; store: string }) {
	const [scopeText, setScopeText] = useState("global");
	const [scope, setScope] = useState("global");
	const [prefix, setPrefix] = useState("");
	const [applied, setApplied] = useState("");
	const [key, setKey] = useState("");
	const q = useInfiniteQuery({
		queryKey: ["oc", "entries", universeId, store, scope, applied],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => cloud.listEntries(universeId, store, { scope, prefix: applied || undefined, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const entries = q.data?.pages.flatMap((p) => p.dataStoreEntries ?? []) ?? [];
	const openKey = (k: string) => router.push(`/project/${universeId}/entry?store=${encodeURIComponent(store)}&scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(k)}`);
	return (
		<>
			<Card style={{ gap: 8 }}>
				<Field label="Scope" value={scopeText} onChangeText={setScopeText} onEndEditing={() => setScope(scopeText.trim() || "global")} placeholder="global" hint="“global” is the default; “-” lists every scope." />
				<Field label="Open a key" value={key} onChangeText={setKey} placeholder="Player_123" onSubmitEditing={() => key.trim() && openKey(key.trim())} />
				<Button title="Open key" small disabled={!key.trim()} onPress={() => openKey(key.trim())} style={{ alignSelf: "flex-start" }} />
			</Card>
			<SearchBar value={prefix} onChangeText={(t) => { setPrefix(t); if (!t) setApplied(""); }} onSubmit={() => setApplied(prefix.trim())} placeholder="Filter keys by prefix" />
			{q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
			{q.isLoading ? <SkeletonList rows={8} /> : null}
			{q.data && !entries.length ? <EmptyState icon="key-outline" title="No keys" body={applied ? `No key starts with “${applied}” in scope ${scope}.` : `Nothing in scope ${scope}.`} /> : null}
			{entries.length ? (
				<Section title={`${entries.length}${q.hasNextPage ? "+" : ""} keys`}>
					<List>
						{entries.map((e) => {
							// With the "-" scope the id is "<scope>/<key>".
							const k = scope === "-" ? e.id.split("/").slice(1).join("/") || e.id : e.id;
							return <Row key={e.path} chevron title={e.id} onPress={() => (scope === "-" ? router.push(`/project/${universeId}/entry?store=${encodeURIComponent(store)}&scope=${encodeURIComponent(e.id.split("/")[0] ?? "global")}&key=${encodeURIComponent(k)}`) : openKey(k))} />;
						})}
					</List>
					{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : <Txt variant="small" style={{ textAlign: "center" }}>End of the list.</Txt>}
				</Section>
			) : null}
		</>
	);
}
