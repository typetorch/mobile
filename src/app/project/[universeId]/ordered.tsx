/**
 * Ordered data stores (leaderboards): entries by value (highest or lowest first, optionally within a value range),
 * look up one key, add an entry, and for a picked entry set its value, increment it or delete it (each confirms;
 * writes need universe.ordered-data-store.scope.entry:write). Ordered entries keep no revisions: a delete is final.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, confirm, Field, List, notify, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { createOrdered, deleteOrdered, getOrdered, incrementOrdered, listOrdered, ORDERED_ID_MAX, parseInteger, setOrdered, type OrderedEntry } from "@/features/project/api/data";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtInt } from "@/lib/format";
import { useTheme } from "@/theme";

export default function OrderedScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Ordered data stores" scopes={["universe.ordered-data-store.scope.entry:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "ordered"], type: "active" })}>
			{({ universeId, cloud, can }) => <Ordered universeId={universeId} cloud={cloud} canWrite={can("universe.ordered-data-store.scope.entry:write")} />}
		</ToolScreen>
	);
}

function Ordered({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [store, setStore] = useState("");
	const [scope, setScope] = useState("global");
	const [desc, setDesc] = useState(true);
	const [minText, setMinText] = useState("");
	const [maxText, setMaxText] = useState("");
	const [open, setOpen] = useState<{ store: string; scope: string; min?: number; max?: number } | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [picked, setPicked] = useState<OrderedEntry | null>(null);
	const [lookupKey, setLookupKey] = useState("");
	const [newKey, setNewKey] = useState("");
	const [newValue, setNewValue] = useState("");

	const q = useInfiniteQuery({
		queryKey: ["oc", "ordered", universeId, open, desc],
		enabled: !!open,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listOrdered(cloud, universeId, open!.store, open!.scope, { desc, min: open!.min, max: open!.max, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const entries = q.data?.pages.flatMap((pg) => pg.orderedDataStoreEntries ?? []) ?? [];
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["oc", "ordered", universeId] });

	const lookup = useMutation({
		mutationFn: (key: string) => getOrdered(cloud, universeId, open!.store, open!.scope, key),
		onSuccess: (e) => setPicked(e),
		onError: (e) => notify("Lookup failed", cloudErrorText(e)),
	});
	const create = useMutation({
		mutationFn: (args: { key: string; value: number }) => createOrdered(cloud, universeId, open!.store, open!.scope, args.key, args.value),
		onSuccess: (e) => {
			setNewKey("");
			setNewValue("");
			setPicked(e);
			invalidate();
		},
		onError: (e) => notify("Create failed", cloudErrorText(e)),
	});

	function show() {
		setFormError(null);
		try {
			const min = minText.trim() ? parseInteger(minText, "Min") : undefined;
			const max = maxText.trim() ? parseInteger(maxText, "Max") : undefined;
			if (min !== undefined && max !== undefined && min > max) throw new Error("Min is above max.");
			setPicked(null);
			setOpen({ store: store.trim(), scope: scope.trim() || "global", min, max });
		} catch (e) {
			setFormError((e as Error).message);
		}
	}

	async function onCreate() {
		let value: number;
		const key = newKey.trim();
		try {
			if (!key || key.length > ORDERED_ID_MAX) throw new Error(`A key is 1-${ORDERED_ID_MAX} characters.`);
			value = parseInteger(newValue, "The value");
		} catch (e) {
			notify("Check the entry", (e as Error).message);
			return;
		}
		if (await confirm(`Add ${key}?`, `${key} = ${fmtInt(value)} in ${open!.store} · ${open!.scope}. Fails if the key already exists.`, "Add", false)) create.mutate({ key, value });
	}

	return (
		<>
			<Card style={{ gap: 8 }}>
				<Txt variant="muted">Roblox has no list of ordered data stores; enter the name your game uses.</Txt>
				<Field label="Ordered data store" value={store} onChangeText={setStore} placeholder="Leaderboard_Coins" />
				<Field label="Scope" value={scope} onChangeText={setScope} placeholder="global" />
				<View style={{ flexDirection: "row", gap: 8 }}>
					<View style={{ flex: 1 }}>
						<Field label="Min value (optional)" value={minText} onChangeText={setMinText} keyboardType="numbers-and-punctuation" placeholder="10" />
					</View>
					<View style={{ flex: 1 }}>
						<Field label="Max value (optional)" value={maxText} onChangeText={setMaxText} keyboardType="numbers-and-punctuation" placeholder="50" />
					</View>
				</View>
				{formError ? <Txt variant="small" color={p.destructive}>{formError}</Txt> : null}
				<Button title="Show entries" variant="brand" small disabled={!store.trim()} onPress={show} style={{ alignSelf: "flex-start" }} />
			</Card>
			{open ? (
				<>
					<Card style={{ gap: 8 }}>
						<Field label="Look up a key" value={lookupKey} onChangeText={setLookupKey} placeholder="player_123" onSubmitEditing={() => lookupKey.trim() && lookup.mutate(lookupKey.trim())} />
						<Button title="Look up" small icon="search" disabled={!lookupKey.trim()} loading={lookup.isPending} onPress={() => lookup.mutate(lookupKey.trim())} style={{ alignSelf: "flex-start" }} />
					</Card>
					{picked ? <Picked key={picked.path} universeId={universeId} cloud={cloud} store={open.store} scope={open.scope} entry={picked} canWrite={canWrite} onChanged={(e) => { setPicked(e); invalidate(); }} onClose={() => setPicked(null)} /> : null}
					{canWrite ? (
						<Card style={{ gap: 8 }}>
							<Txt variant="h3">Add an entry</Txt>
							<View style={{ flexDirection: "row", gap: 8 }}>
								<View style={{ flex: 2 }}>
									<Field value={newKey} onChangeText={setNewKey} placeholder={`Key (1-${ORDERED_ID_MAX})`} maxLength={ORDERED_ID_MAX} />
								</View>
								<View style={{ flex: 1 }}>
									<Field value={newValue} onChangeText={setNewValue} placeholder="Value" keyboardType="numbers-and-punctuation" />
								</View>
							</View>
							<Button title="Add" small icon="add" disabled={!newKey.trim() || !newValue.trim()} loading={create.isPending} onPress={onCreate} style={{ alignSelf: "flex-start" }} />
						</Card>
					) : (
						<Txt variant="small">Read only: add universe.ordered-data-store.scope.entry:write to add, edit and delete entries.</Txt>
					)}
					<Segmented options={[{ value: 1, label: "Highest first" }, { value: 0, label: "Lowest first" }]} value={desc ? 1 : 0} onChange={(v) => setDesc(v === 1)} />
					{q.error ? <CloudError error={q.error} what="Ordered data store" onRetry={() => q.refetch()} /> : null}
					{q.isLoading ? <SkeletonList rows={8} /> : null}
					{q.data ? (
						<Section title={`${open.store} · ${open.scope}${open.min !== undefined || open.max !== undefined ? ` · ${open.min ?? "…"} to ${open.max ?? "…"}` : ""}`}>
							{entries.length ? (
								<List>
									{entries.map((e, i) => (
										<Row
											key={e.path}
											onPress={() => setPicked(e)}
											left={<View style={{ width: 28 }}><Txt variant="small">#{i + 1}</Txt></View>}
											title={e.id}
											right={<Txt style={{ fontWeight: "600" }}>{fmtInt(e.value)}</Txt>}
										/>
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

/** The picked entry: set, increment, delete. */
function Picked({
	universeId,
	cloud,
	store,
	scope,
	entry,
	canWrite,
	onChanged,
	onClose,
}: {
	universeId: number;
	cloud: OpenCloud;
	store: string;
	scope: string;
	entry: OrderedEntry;
	canWrite: boolean;
	onChanged: (e: OrderedEntry | null) => void;
	onClose: () => void;
}) {
	const [value, setValue] = useState(String(entry.value ?? 0));
	const [amount, setAmount] = useState("1");
	const set = useMutation({
		mutationFn: (v: number) => setOrdered(cloud, universeId, store, scope, entry.id, v),
		onSuccess: (e) => onChanged(e),
		onError: (e) => notify("Update failed", cloudErrorText(e)),
	});
	const inc = useMutation({
		mutationFn: (n: number) => incrementOrdered(cloud, universeId, store, scope, entry.id, n),
		onSuccess: (e) => onChanged(e),
		onError: (e) => notify("Increment failed", cloudErrorText(e)),
	});
	const del = useMutation({
		mutationFn: () => deleteOrdered(cloud, universeId, store, scope, entry.id),
		onSuccess: () => onChanged(null),
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});

	async function onSet() {
		let v: number;
		try {
			v = parseInteger(value, "The value");
		} catch (e) {
			notify("Check the value", (e as Error).message);
			return;
		}
		if (await confirm(`Set ${entry.id} to ${fmtInt(v)}?`, `It is ${fmtInt(entry.value)} now. Ordered data stores keep no history, so the old value is gone.`, "Set")) set.mutate(v);
	}

	async function onIncrement() {
		let n: number;
		try {
			n = parseInteger(amount, "The amount");
		} catch (e) {
			notify("Check the amount", (e as Error).message);
			return;
		}
		if (await confirm(`Add ${fmtInt(n)} to ${entry.id}?`, `${fmtInt(entry.value)} becomes ${fmtInt(entry.value + n)}.`, "Increment", false)) inc.mutate(n);
	}

	async function onDelete() {
		if (await confirm(`Delete ${entry.id}?`, `Removes it from ${store} · ${scope} for good (ordered data stores keep no revisions).`, "Delete")) del.mutate();
	}

	return (
		<Card style={{ gap: 8 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Txt variant="h3" style={{ flex: 1 }} numberOfLines={1}>
					{entry.id}
				</Txt>
				<Txt style={{ fontWeight: "700" }}>{fmtInt(entry.value)}</Txt>
				<Button title="Close" small variant="ghost" onPress={onClose} />
			</View>
			{canWrite ? (
				<>
					<View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
						<View style={{ flex: 1 }}>
							<Field label="Set value" value={value} onChangeText={setValue} keyboardType="numbers-and-punctuation" />
						</View>
						<Button title="Set" small loading={set.isPending} onPress={onSet} />
					</View>
					<View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
						<View style={{ flex: 1 }}>
							<Field label="Increment by" value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" />
						</View>
						<Button title="Add" small icon="add" loading={inc.isPending} onPress={onIncrement} />
					</View>
					<Button title="Delete entry" small variant="destructive" icon="trash-outline" loading={del.isPending} onPress={onDelete} style={{ alignSelf: "flex-start" }} />
				</>
			) : null}
		</Card>
	);
}
