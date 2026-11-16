/**
 * One data store's keys (cloud/v2 entries list), by scope and key prefix, optionally with deleted keys (still in their
 * 30-day revision retention). Also: create a key (value, user IDs, attributes) and schedule the whole store for
 * deletion (double confirm; undelete from the store list within 30 days).
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, confirm, EmptyState, Field, List, notify, Row, SearchBar, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { checkId, createEntry, deleteDataStore, ENTRY_ID_MAX, listEntries, parseAttributes, parseJson, parseUsers } from "@/features/project/api/data";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtDate } from "@/lib/format";
import { useTheme } from "@/theme";

export default function DataStoreScreen() {
	const { store } = useLocalSearchParams<{ store: string }>();
	const queryClient = useQueryClient();
	const name = String(store ?? "");
	return (
		<ToolScreen title={name || "Data store"} scopes={["universe-datastores.objects:list"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "entries"], type: "active" })}>
			{({ universeId, cloud, can }) => (
				<Entries universeId={universeId} cloud={cloud} store={name} canCreate={can("universe-datastores.objects:create")} canDeleteStore={can("universe-datastores.control:delete")} />
			)}
		</ToolScreen>
	);
}

/**
 * The scope and key of a row listed with the "-" (all scopes) wildcard. The doc says `id` is only the path's last
 * segment, so both come from `path` (".../scopes/<scope>/entries/<key>"); a path without a scopes segment falls back
 * to an id of "<scope>/<key>", then to the default scope "global".
 */
function entryScopeKey(e: { id: string; path: string }): { scope: string; key: string } {
	const dec = (x: string) => {
		try {
			return decodeURIComponent(x);
		} catch {
			return x;
		}
	};
	const m = /\/scopes\/([^/]+)\/entries\/(.+)$/.exec(e.path ?? "");
	if (m) return { scope: dec(m[1]), key: dec(m[2]) };
	const slash = e.id.indexOf("/");
	if (slash > 0) return { scope: e.id.slice(0, slash), key: e.id.slice(slash + 1) };
	return { scope: "global", key: e.id };
}

function entryHref(universeId: number, store: string, scope: string, key: string) {
	return `/project/${universeId}/entry?store=${encodeURIComponent(store)}&scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}`;
}

function Entries({ universeId, cloud, store, canCreate, canDeleteStore }: { universeId: number; cloud: OpenCloud; store: string; canCreate: boolean; canDeleteStore: boolean }) {
	const queryClient = useQueryClient();
	const [scopeText, setScopeText] = useState("global");
	const [scope, setScope] = useState("global");
	const [prefix, setPrefix] = useState("");
	const [applied, setApplied] = useState("");
	const [key, setKey] = useState("");
	const [showDeleted, setShowDeleted] = useState(false);
	const [creating, setCreating] = useState(false);
	const q = useInfiniteQuery({
		queryKey: ["oc", "entries", universeId, store, scope, applied, showDeleted],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listEntries(cloud, universeId, store, { scope, prefix: applied || undefined, showDeleted, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const entries = q.data?.pages.flatMap((p) => p.dataStoreEntries ?? []) ?? [];
	const openKey = (k: string, s = scope) => router.push(entryHref(universeId, store, s, k));

	const dropStore = useMutation({
		mutationFn: () => deleteDataStore(cloud, universeId, store),
		onSuccess: (r) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "datastores", universeId] });
			notify("Store scheduled for deletion", `${store} is unreadable now and is deleted for good ${r?.expireTime ? `on ${fmtDate(r.expireTime)}` : "in 30 days"}. Undelete it from the store list before then.`);
			router.back();
		},
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});

	async function onDeleteStore() {
		if (!(await confirm(`Delete the data store ${store}?`, "Every key in every scope becomes unreadable at once, and Roblox deletes them for good after 30 days. Game servers reading this store will fail.", "Continue"))) return;
		if (await confirm("Are you sure?", `This schedules “${store}” for permanent deletion. You can undelete it within 30 days.`, "Delete store")) dropStore.mutate();
	}

	return (
		<>
			<Card style={{ gap: 8 }}>
				<Field label="Scope" value={scopeText} onChangeText={setScopeText} onEndEditing={() => setScope(scopeText.trim() || "global")} placeholder="global" hint="“global” is the default; “-” lists every scope." />
				<Field label="Open a key" value={key} onChangeText={setKey} placeholder="Player_123" onSubmitEditing={() => key.trim() && openKey(key.trim())} />
				<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
					<Button title="Open key" small disabled={!key.trim()} onPress={() => openKey(key.trim())} />
					{canCreate && !creating ? <Button title="New entry" small icon="add" onPress={() => setCreating(true)} /> : null}
				</View>
			</Card>
			{creating ? (
				<NewEntry
					universeId={universeId}
					cloud={cloud}
					store={store}
					scope={scope === "-" ? "global" : scope}
					onDone={(created) => {
						setCreating(false);
						if (created) {
							queryClient.invalidateQueries({ queryKey: ["oc", "entries", universeId, store] });
							openKey(created.key, created.scope);
						}
					}}
				/>
			) : null}
			<SearchBar value={prefix} onChangeText={(t) => { setPrefix(t); if (!t) setApplied(""); }} onSubmit={() => setApplied(prefix.trim())} placeholder="Filter keys by prefix" />
			<Segmented options={[{ value: 0, label: "Live keys" }, { value: 1, label: "Include deleted" }]} value={showDeleted ? 1 : 0} onChange={(v) => setShowDeleted(v === 1)} />
			{q.error ? <CloudError error={q.error} what="Keys" onRetry={() => q.refetch()} /> : null}
			{q.isLoading ? <SkeletonList rows={8} /> : null}
			{q.data && !entries.length ? <EmptyState icon="key-outline" title="No keys" body={applied ? `No key starts with “${applied}” in scope ${scope}.` : `Nothing in scope ${scope}.`} /> : null}
			{entries.length ? (
				<Section title={`${entries.length}${q.hasNextPage ? "+" : ""} keys`}>
					<List>
						{entries.map((e) => {
							const { scope: s, key: k } = scope === "-" ? entryScopeKey(e) : { scope, key: e.id };
							return <Row key={e.path} chevron title={k} subtitle={[scope === "-" ? s : null, e.state === "DELETED" ? "deleted" : null].filter(Boolean).join(" · ") || undefined} onPress={() => openKey(k, s)} />;
						})}
					</List>
					{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : <Txt variant="small" style={{ textAlign: "center" }}>End of the list.</Txt>}
				</Section>
			) : null}
			{showDeleted ? <Txt variant="small">Deleted keys keep their revisions for 30 days; open one to restore a past value.</Txt> : null}
			{canDeleteStore ? (
				<Section title="Danger zone">
					<Card style={{ gap: 8 }}>
						<Txt variant="small">Schedules this whole store for permanent deletion in 30 days (undelete from the store list until then).</Txt>
						<Button title="Delete data store" variant="destructive" icon="trash-outline" small loading={dropStore.isPending} onPress={onDeleteStore} style={{ alignSelf: "flex-start" }} />
					</Card>
				</Section>
			) : null}
		</>
	);
}

function NewEntry({ universeId, cloud, store, scope, onDone }: { universeId: number; cloud: OpenCloud; store: string; scope: string; onDone: (created: { key: string; scope: string } | null) => void }) {
	const p = useTheme();
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const [users, setUsers] = useState("");
	const [attributes, setAttributes] = useState("");
	const [error, setError] = useState<string | null>(null);
	const create = useMutation({
		mutationFn: (args: { key: string; value: unknown; users: string[]; attributes?: Record<string, unknown> }) => createEntry(cloud, universeId, store, args.key, { value: args.value, users: args.users, attributes: args.attributes }, scope),
		onSuccess: (_r, args) => onDone({ key: args.key, scope }),
		onError: (e) => notify("Create failed", cloudErrorText(e)),
	});

	function onCreate() {
		setError(null);
		try {
			const k = checkId(key, ENTRY_ID_MAX);
			create.mutate({ key: k, value: parseJson(value), users: parseUsers(users), attributes: parseAttributes(attributes) });
		} catch (e) {
			setError((e as Error).message);
		}
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">New entry in {store} · {scope}</Txt>
			<Field label={`Key (1-${ENTRY_ID_MAX} characters)`} value={key} onChangeText={setKey} placeholder="Player_123" maxLength={ENTRY_ID_MAX} />
			<Field label="Value (JSON)" value={value} onChangeText={setValue} placeholder={'{"coins": 0}'} multiline style={{ minHeight: 120 }} />
			<Field label="User IDs (optional)" value={users} onChangeText={setUsers} placeholder="123456, 789012" hint="For GDPR erasure: the players whose data this is." />
			<Field label="Attributes (optional JSON object)" value={attributes} onChangeText={setAttributes} placeholder={'{"schema": 2}'} multiline />
			{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
			<View style={{ flexDirection: "row", gap: 8 }}>
				<Button title="Create" variant="brand" icon="add" small loading={create.isPending} onPress={onCreate} />
				<Button title="Cancel" variant="ghost" small onPress={() => onDone(null)} />
			</View>
		</Card>
	);
}
