/**
 * Memory stores: a sorted map's items (browse, look up, add, edit with etag, delete), a queue (peek with invisibility
 * 0 s, add, dequeue = read with an invisibility window then discard exactly those items), and flushing the whole
 * memory store (LIVE or TEST), polled a bounded number of times. Every destructive write confirms first.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud, SortedMapItem } from "@/api/opencloud";
import { Button, Card, confirm, Field, List, notify, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import {
	addQueueItem,
	createSortedMapItem,
	deleteSortedMapItem,
	discardQueueItems,
	flushMemoryStore,
	getSortedMapItem,
	listSortedMap,
	MEMORY_MAX_TTL,
	parseJson,
	parseTtl,
	readQueue,
	SORTED_MAP_ID_MAX,
	updateSortedMapItem,
	type FlushScope,
	type QueueItem,
	type SortedMapWrite,
} from "@/features/project/api/data";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { compactJson, fmtTime, prettyJson } from "@/lib/format";
import { useTheme } from "@/theme";

export default function MemoryScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Memory stores" scopes={[]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "memory"], type: "active" })}>
			{({ universeId, cloud, can }) => (
				<Memory
					universeId={universeId}
					cloud={cloud}
					can={{
						mapRead: can("memory-store.sorted-map:read"),
						mapWrite: can("memory-store.sorted-map:write"),
						dequeue: can("memory-store.queue:dequeue"),
						add: can("memory-store.queue:add"),
						discard: can("memory-store.queue:discard"),
						flush: can("memory-store:flush"),
						flushStatus: can("memory-store:get"),
					}}
				/>
			)}
		</ToolScreen>
	);
}

interface Can {
	mapRead: boolean;
	mapWrite: boolean;
	dequeue: boolean;
	add: boolean;
	discard: boolean;
	flush: boolean;
	flushStatus: boolean;
}

function Memory({ universeId, cloud, can }: { universeId: number; cloud: OpenCloud; can: Can }) {
	const [kind, setKind] = useState<"map" | "queue">(can.mapRead || can.mapWrite || !(can.dequeue || can.add) ? "map" : "queue");
	const [name, setName] = useState("");
	const [open, setOpen] = useState<string | null>(null);
	const allowed = kind === "map" ? can.mapRead || can.mapWrite : can.dequeue || can.add;
	return (
		<>
			<Segmented options={[{ value: "map", label: "Sorted map" }, { value: "queue", label: "Queue" }]} value={kind} onChange={(v) => { setKind(v); setOpen(null); }} />
			{!allowed ? (
				<Txt variant="muted">Needs {kind === "map" ? "memory-store.sorted-map:read" : "memory-store.queue:dequeue or memory-store.queue:add"} on the key.</Txt>
			) : (
				<Card style={{ gap: 8 }}>
					<Txt variant="small">Roblox has no list of maps or queues; enter the name your game uses.</Txt>
					<Field label={kind === "map" ? "Sorted map name" : "Queue name"} value={name} onChangeText={setName} placeholder={kind === "map" ? "Matchmaking" : "JobQueue"} onSubmitEditing={() => name.trim() && setOpen(name.trim())} />
					<Button title="Open" variant="brand" small disabled={!name.trim()} onPress={() => setOpen(name.trim())} style={{ alignSelf: "flex-start" }} />
				</Card>
			)}
			{kind === "map" && open && allowed ? <SortedMap key={open} universeId={universeId} cloud={cloud} map={open} can={can} /> : null}
			{kind === "queue" && open && allowed ? <Queue key={open} universeId={universeId} cloud={cloud} queue={open} can={can} /> : null}
			{can.flush ? <Flush universeId={universeId} cloud={cloud} canStatus={can.flushStatus} /> : null}
		</>
	);
}

// Sorted maps ------------------------------------------------------------------------------------------------------------

function SortedMap({ universeId, cloud, map, can }: { universeId: number; cloud: OpenCloud; map: string; can: Can }) {
	const queryClient = useQueryClient();
	const [desc, setDesc] = useState(false);
	const [lookupId, setLookupId] = useState("");
	const [editing, setEditing] = useState<SortedMapItem | "new" | null>(null);
	const list = useInfiniteQuery({
		queryKey: ["oc", "memory", "map", universeId, map, desc],
		enabled: can.mapRead,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listSortedMap(cloud, universeId, map, { desc, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
	});
	const items = list.data?.pages.flatMap((p) => p.memoryStoreSortedMapItems ?? p.items ?? []) ?? [];
	const lookup = useMutation({
		mutationFn: (id: string) => getSortedMapItem(cloud, universeId, map, id),
		onSuccess: (it) => setEditing(it),
		onError: (e) => notify("Lookup failed", cloudErrorText(e)),
	});
	const changed = () => {
		setEditing(null);
		queryClient.invalidateQueries({ queryKey: ["oc", "memory", "map", universeId, map] });
	};
	return (
		<>
			{can.mapRead ? (
				<Card style={{ gap: 8 }}>
					<Field label="Look up an item" value={lookupId} onChangeText={setLookupId} placeholder="item id" onSubmitEditing={() => lookupId.trim() && lookup.mutate(lookupId.trim())} />
					<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
						<Button title="Look up" small icon="search" disabled={!lookupId.trim()} loading={lookup.isPending} onPress={() => lookup.mutate(lookupId.trim())} />
						{can.mapWrite && editing !== "new" ? <Button title="New item" small icon="add" onPress={() => setEditing("new")} /> : null}
					</View>
				</Card>
			) : can.mapWrite && editing !== "new" ? (
				<Button title="New item" small icon="add" onPress={() => setEditing("new")} style={{ alignSelf: "flex-start" }} />
			) : null}
			{editing ? <MapItemEditor key={editing === "new" ? "new" : editing.path} universeId={universeId} cloud={cloud} map={map} item={editing === "new" ? null : editing} canWrite={can.mapWrite} onDone={changed} onClose={() => setEditing(null)} /> : null}
			{can.mapRead ? (
				<>
					<Segmented options={[{ value: 0, label: "Ascending" }, { value: 1, label: "Descending" }]} value={desc ? 1 : 0} onChange={(v) => setDesc(v === 1)} />
					{list.error ? <CloudError error={list.error} what="Sorted map" onRetry={() => list.refetch()} /> : null}
					{list.isLoading ? <SkeletonList rows={6} /> : null}
					{list.data ? (
						<Section title={`${items.length}${list.hasNextPage ? "+" : ""} items`}>
							{items.length ? (
								<List>
									{items.map((it) => (
										<Row
											key={it.path}
											onPress={() => setEditing(it)}
											title={it.id}
											subtitle={`${compactJson(it.value, 140)}${it.expireTime ? ` · expires ${fmtTime(it.expireTime)}` : ""}`}
											numberOfLines={1}
											right={it.numericSortKey !== undefined ? <Txt variant="small">{it.numericSortKey}</Txt> : it.stringSortKey ? <Txt variant="small">{it.stringSortKey}</Txt> : undefined}
										/>
									))}
								</List>
							) : (
								<Txt variant="muted">The map is empty.</Txt>
							)}
							{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						</Section>
					) : null}
				</>
			) : (
				<Txt variant="small">Add memory-store.sorted-map:read to browse this map.</Txt>
			)}
		</>
	);
}

function remainingTtl(expireTime: string | undefined): string {
	const t = expireTime ? Date.parse(expireTime) : Number.NaN;
	if (Number.isNaN(t)) return "3600";
	return String(Math.min(MEMORY_MAX_TTL, Math.max(1, Math.ceil((t - Date.now()) / 1000))));
}

type SortKind = "none" | "string" | "number";

function MapItemEditor({ universeId, cloud, map, item, canWrite, onDone, onClose }: { universeId: number; cloud: OpenCloud; map: string; item: SortedMapItem | null; canWrite: boolean; onDone: () => void; onClose: () => void }) {
	const p = useTheme();
	const [id, setId] = useState(item?.id ?? "");
	const [value, setValue] = useState(item ? prettyJson(item.value) : "");
	const [ttl, setTtl] = useState(remainingTtl(item?.expireTime));
	const [sortKind, setSortKind] = useState<SortKind>(item?.numericSortKey !== undefined ? "number" : item?.stringSortKey !== undefined ? "string" : "none");
	const [sortKey, setSortKey] = useState(item?.numericSortKey !== undefined ? String(item.numericSortKey) : (item?.stringSortKey ?? ""));
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (write: SortedMapWrite & { id: string }) => (item ? updateSortedMapItem(cloud, universeId, map, item.id, write) : createSortedMapItem(cloud, universeId, map, write.id, write)),
		onSuccess: onDone,
		onError: (e) => notify("Save failed", `${cloudErrorText(e)}${item?.etag ? "\n\nIf a game server changed the item since you opened it, reopen it and try again." : ""}`),
	});
	const remove = useMutation({
		mutationFn: () => deleteSortedMapItem(cloud, universeId, map, item!.id),
		onSuccess: onDone,
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});

	function build(): SortedMapWrite & { id: string } {
		const itemId = id.trim();
		if (!itemId || itemId.length > SORTED_MAP_ID_MAX) throw new Error(`An item ID is 1-${SORTED_MAP_ID_MAX} characters.`);
		const write: SortedMapWrite & { id: string } = { id: itemId, value: parseJson(value), ttl: parseTtl(ttl) };
		if (sortKind === "string") write.stringSortKey = sortKey;
		if (sortKind === "number") {
			const n = Number(sortKey.trim());
			if (!sortKey.trim() || !Number.isFinite(n)) throw new Error("The numeric sort key must be a number.");
			write.numericSortKey = n;
		}
		if (item?.etag) write.etag = item.etag;
		return write;
	}

	async function onSave() {
		setError(null);
		let write: SortedMapWrite & { id: string };
		try {
			write = build();
		} catch (e) {
			setError((e as Error).message);
			return;
		}
		const message = item ? `Replaces ${write.id}'s value, TTL (${write.ttl}) and sort key in ${map}. Game servers see the change at once.` : `Adds ${write.id} to ${map} for ${write.ttl}. Fails if the ID exists.`;
		if (await confirm(item ? "Overwrite this item?" : "Add this item?", message, item ? "Overwrite" : "Add", !!item)) save.mutate(write);
	}

	async function onDelete() {
		if (item && (await confirm(`Delete ${item.id}?`, `Removes it from ${map} at once (game servers stop seeing it). Handy for a stuck lock or matchmaking entry.`, "Delete"))) remove.mutate();
	}

	return (
		<Card style={{ gap: 8 }}>
			<View style={{ flexDirection: "row", alignItems: "center" }}>
				<Txt variant="h3" style={{ flex: 1 }}>
					{item ? item.id : "New item"}
				</Txt>
				<Button title="Close" small variant="ghost" onPress={onClose} />
			</View>
			{item ? <Txt variant="small">Expires {fmtTime(item.expireTime)}{item.etag ? " · etag kept, so a newer server write isn't overwritten" : ""}</Txt> : <Field label={`Item ID (1-${SORTED_MAP_ID_MAX})`} value={id} onChangeText={setId} maxLength={SORTED_MAP_ID_MAX} />}
			<Field label="Value (JSON)" value={value} onChangeText={setValue} multiline editable={canWrite} style={{ minHeight: 120 }} />
			{canWrite ? (
				<>
					<Field label={`TTL in seconds (1-${MEMORY_MAX_TTL})`} value={ttl} onChangeText={setTtl} keyboardType="number-pad" />
					<Segmented options={[{ value: "none", label: "No sort key" }, { value: "string", label: "String key" }, { value: "number", label: "Number key" }]} value={sortKind} onChange={setSortKind} />
					{sortKind !== "none" ? <Field value={sortKey} onChangeText={setSortKey} placeholder={sortKind === "number" ? "42" : "abc"} keyboardType={sortKind === "number" ? "numbers-and-punctuation" : "default"} /> : null}
					{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
					<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
						<Button title={item ? "Save" : "Add"} variant="brand" icon="save-outline" small loading={save.isPending} onPress={onSave} />
						{item ? <Button title="Delete" variant="destructive" icon="trash-outline" small loading={remove.isPending} onPress={onDelete} /> : null}
					</View>
				</>
			) : (
				<Txt variant="small">Read only: add memory-store.sorted-map:write to edit.</Txt>
			)}
		</Card>
	);
}

// Queues -----------------------------------------------------------------------------------------------------------------

function Queue({ universeId, cloud, queue, can }: { universeId: number; cloud: OpenCloud; queue: string; can: Can }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [data, setData] = useState("");
	const [ttl, setTtl] = useState("");
	const [priority, setPriority] = useState("");
	const [count, setCount] = useState("10");
	const [hideFor, setHideFor] = useState("30");
	const [formError, setFormError] = useState<string | null>(null);
	const [read, setRead] = useState<{ items: QueueItem[]; id?: string; until: number } | null>(null);

	const peek = useQuery({
		queryKey: ["oc", "memory", "queue", universeId, queue],
		enabled: can.dequeue,
		queryFn: () => readQueue(cloud, universeId, queue, 100, 0),
		retry: false,
	});
	const add = useMutation({
		mutationFn: (item: { data: unknown; ttl?: string; priority?: number }) => addQueueItem(cloud, universeId, queue, item),
		onSuccess: () => {
			setData("");
			queryClient.invalidateQueries({ queryKey: ["oc", "memory", "queue", universeId, queue] });
		},
		onError: (e) => notify("Add failed", cloudErrorText(e)),
	});
	const dequeue = useMutation({
		mutationFn: (args: { count: number; seconds: number }) => readQueue(cloud, universeId, queue, args.count, args.seconds),
		onSuccess: (r, args) => {
			setRead({ items: r?.queueItems ?? [], id: r?.id, until: Date.now() + args.seconds * 1000 });
			// The items are now hidden from other reads, so the peek list changed.
			queryClient.invalidateQueries({ queryKey: ["oc", "memory", "queue", universeId, queue] });
		},
		onError: (e) => notify("Read failed", cloudErrorText(e)),
	});
	const discard = useMutation({
		mutationFn: (readId: string) => discardQueueItems(cloud, universeId, queue, readId),
		onSuccess: () => {
			setRead(null);
			queryClient.invalidateQueries({ queryKey: ["oc", "memory", "queue", universeId, queue] });
			notify("Discarded", "Those items are removed from the queue.");
		},
		onError: (e) => notify("Discard failed", cloudErrorText(e)),
	});
	// A 404 from :read means the queue is empty.
	const empty = (peek.error as { status?: number } | null)?.status === 404;

	async function onAdd() {
		setFormError(null);
		let item: { data: unknown; ttl?: string; priority?: number };
		try {
			item = { data: parseJson(data, "Data") };
			if (ttl.trim()) item.ttl = parseTtl(ttl);
			if (priority.trim()) {
				const n = Number(priority.trim());
				if (!Number.isFinite(n)) throw new Error("Priority must be a number.");
				item.priority = n;
			}
		} catch (e) {
			setFormError((e as Error).message);
			return;
		}
		if (await confirm("Add to the queue?", `Game servers reading ${queue} will get this item${item.priority !== undefined ? ` (priority ${item.priority})` : ""}.`, "Add", false)) add.mutate(item);
	}

	async function onDequeue() {
		setFormError(null);
		const c = Number(count.trim());
		const s = Number(hideFor.trim());
		if (!Number.isInteger(c) || c < 1 || c > 100) return setFormError("Count must be 1-100.");
		if (!Number.isInteger(s) || s < 1 || s > 3600) return setFormError("The invisibility window must be 1-3600 seconds.");
		if (await confirm(`Take ${c} items?`, `They are hidden from game servers for ${s} s while you decide; discard them to remove them for good, or let the window run out and they come back.`, "Read", false)) dequeue.mutate({ count: c, seconds: s });
	}

	async function onDiscard() {
		if (!read?.id) return;
		if (Date.now() > read.until) {
			notify("Window passed", "The invisibility window ran out, so these items are back in the queue; read them again.");
			setRead(null);
			return;
		}
		if (await confirm(`Discard ${read.items.length} items?`, "They are removed from the queue for good.", "Discard")) discard.mutate(read.id);
	}

	return (
		<>
			{can.add ? (
				<Card style={{ gap: 8 }}>
					<Txt variant="h3">Add an item</Txt>
					<Field label="Data (JSON)" value={data} onChangeText={setData} placeholder={'{"job": "reward", "userId": 1}'} multiline />
					<View style={{ flexDirection: "row", gap: 8 }}>
						<View style={{ flex: 1 }}>
							<Field label="TTL s (optional)" value={ttl} onChangeText={setTtl} keyboardType="number-pad" placeholder="45 days" />
						</View>
						<View style={{ flex: 1 }}>
							<Field label="Priority (optional)" value={priority} onChangeText={setPriority} keyboardType="numbers-and-punctuation" placeholder="0" />
						</View>
					</View>
					<Button title="Add" small icon="add" disabled={!data.trim()} loading={add.isPending} onPress={onAdd} style={{ alignSelf: "flex-start" }} />
				</Card>
			) : null}
			{can.dequeue && can.discard ? (
				<Card style={{ gap: 8 }}>
					<Txt variant="h3">Dequeue</Txt>
					<View style={{ flexDirection: "row", gap: 8 }}>
						<View style={{ flex: 1 }}>
							<Field label="Count (1-100)" value={count} onChangeText={setCount} keyboardType="number-pad" />
						</View>
						<View style={{ flex: 1 }}>
							<Field label="Hide for (s)" value={hideFor} onChangeText={setHideFor} keyboardType="number-pad" />
						</View>
					</View>
					<Button title="Read and hide" small loading={dequeue.isPending} onPress={onDequeue} style={{ alignSelf: "flex-start" }} />
					{read ? (
						<>
							<Txt variant="small">{read.items.length} items hidden until {fmtTime(read.until)}.</Txt>
							{read.items.map((it, i) => (
								<Txt key={i} variant="mono" numberOfLines={3}>
									{compactJson(it.data, 200)}
								</Txt>
							))}
							{read.items.length && read.id ? <Button title={`Discard ${read.items.length}`} variant="destructive" icon="trash-outline" small loading={discard.isPending} onPress={onDiscard} style={{ alignSelf: "flex-start" }} /> : null}
						</>
					) : null}
				</Card>
			) : can.dequeue ? (
				<Txt variant="small">Add memory-store.queue:discard to remove items.</Txt>
			) : null}
			{formError ? <Txt variant="small" color={p.destructive}>{formError}</Txt> : null}
			{can.dequeue ? (
				<>
					<Txt variant="small">A peek (invisibility window 0 s): game servers still see every item.</Txt>
					{peek.error && !empty ? <CloudError error={peek.error} what="Queue" onRetry={() => peek.refetch()} /> : null}
					{peek.isLoading ? <SkeletonList rows={6} /> : null}
					{empty ? <Txt variant="muted">The queue is empty.</Txt> : null}
					{peek.data ? (
						<Section title={`${peek.data.queueItems?.length ?? 0} items`}>
							<List>
								{(peek.data.queueItems ?? []).map((it, i) => (
									<Row key={i} title={compactJson(it.data, 200)} subtitle={`${it.priority !== undefined ? `priority ${it.priority}` : ""}${it.expireTime ? ` · expires ${fmtTime(it.expireTime)}` : ""}`} numberOfLines={3} />
								))}
							</List>
						</Section>
					) : null}
				</>
			) : (
				<Txt variant="small">Add memory-store.queue:dequeue to see the items.</Txt>
			)}
		</>
	);
}

// Flush ------------------------------------------------------------------------------------------------------------------

function Flush({ universeId, cloud, canStatus }: { universeId: number; cloud: OpenCloud; canStatus: boolean }) {
	const [scope, setScope] = useState<FlushScope>("LIVE");
	const [status, setStatus] = useState<string | null>(null);
	const flush = useMutation({
		mutationFn: (s: FlushScope) => flushMemoryStore(cloud, universeId, s, { maxPolls: canStatus ? 15 : 0, onPoll: (n) => setStatus(`Flushing… (check ${n} of 15)`) }),
		onMutate: () => setStatus("Starting the flush…"),
		onSuccess: (r, s) => setStatus(r.done ? `The ${s} memory store is flushed.` : canStatus ? `The ${s} flush is still running; it finishes on Roblox's side.` : `The ${s} flush started (add memory-store:get to follow it).`),
		onError: (e) => {
			setStatus(null);
			notify("Flush failed", cloudErrorText(e));
		},
	});

	async function onFlush() {
		if (!(await confirm(`Flush the ${scope} memory store?`, `Deletes every sorted map and queue of this experience${scope === "LIVE" ? " in live servers" : " in Studio tests"}. Matchmaking, locks and caches in memory stores are gone at once.`, "Continue"))) return;
		if (await confirm("Are you sure?", `This can't be undone: all ${scope} memory store data is erased.`, "Flush")) flush.mutate(scope);
	}

	return (
		<Section title="Flush">
			<Card style={{ gap: 8 }}>
				<Txt variant="small">Erase all memory store data of this experience (every sorted map and queue).</Txt>
				<Segmented options={[{ value: "LIVE", label: "Live" }, { value: "TEST", label: "Test (Studio)" }]} value={scope} onChange={setScope} />
				<Button title={`Flush ${scope.toLowerCase()}`} variant="destructive" icon="flash-off-outline" small loading={flush.isPending} onPress={onFlush} style={{ alignSelf: "flex-start" }} />
				{status ? <Txt variant="small">{status}</Txt> : null}
			</Card>
		</Section>
	);
}
