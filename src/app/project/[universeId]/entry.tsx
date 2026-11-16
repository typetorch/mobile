/**
 * One data store entry: its value as JSON, metadata, revisions (and a past revision's value, or the value as of a
 * time), edit value / user IDs / attributes, increment, restore a revision and delete (each behind a confirm and only
 * with the scope).
 *
 * Roblox's PATCH is a full replace ("if attributes or users are not provided when updating the value, they will be
 * cleared"), so every write resends value + users + attributes, plus the etag of the read so a game server's newer
 * write is never silently clobbered.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { HttpError } from "@/api/http";
import type { CloudEntry, OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, Field, KV, List, notify, Row, Section, Skeleton, Txt } from "@/components/ui";
import { checkRfc3339, getEntryAsOf, incrementEntry, listRevisions, parseAttributes, parseInteger, parseJson, parseUsers, writeEntry } from "@/features/project/api/data";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtTime, prettyJson } from "@/lib/format";
import { useTheme } from "@/theme";

export default function EntryScreen() {
	const { store, scope, key } = useLocalSearchParams<{ store: string; scope?: string; key: string }>();
	const queryClient = useQueryClient();
	return (
		<ToolScreen title={String(key ?? "Entry")} scopes={["universe-datastores.objects:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "entry"], type: "active" })}>
			{({ universeId, cloud, can }) => (
				<Entry
					universeId={universeId}
					cloud={cloud}
					store={String(store ?? "")}
					scope={String(scope ?? "global")}
					entryKey={String(key ?? "")}
					canUpdate={can("universe-datastores.objects:update")}
					canIncrement={can("universe-datastores.objects:update") && can("universe-datastores.objects:create")}
					canDelete={can("universe-datastores.objects:delete")}
					canVersions={can("universe-datastores.versions:list")}
					canReadVersion={can("universe-datastores.versions:read")}
				/>
			)}
		</ToolScreen>
	);
}

/** What the value card shows: the latest value, one revision, or the value current at a time. */
type View_ = { kind: "latest" } | { kind: "revision"; id: string } | { kind: "asOf"; time: string };

function usersText(users: string[] | undefined): string {
	return (users ?? []).map((u) => u.replace(/^users\//, "")).join(", ");
}

function attributesText(attributes: Record<string, unknown> | undefined): string {
	return attributes && Object.keys(attributes).length ? prettyJson(attributes) : "";
}

function Entry({
	universeId,
	cloud,
	store,
	scope,
	entryKey,
	canUpdate,
	canIncrement,
	canDelete,
	canVersions,
	canReadVersion,
}: {
	universeId: number;
	cloud: OpenCloud;
	store: string;
	scope: string;
	entryKey: string;
	canUpdate: boolean;
	canIncrement: boolean;
	canDelete: boolean;
	canVersions: boolean;
	canReadVersion: boolean;
}) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [view, setView] = useState<View_>({ kind: "latest" });
	const [editing, setEditing] = useState<"value" | "meta" | null>(null);
	const [draft, setDraft] = useState("");
	const [draftUsers, setDraftUsers] = useState("");
	const [draftAttributes, setDraftAttributes] = useState("");
	const [draftError, setDraftError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [amount, setAmount] = useState("1");
	const [asOfText, setAsOfText] = useState("");
	const [fromText, setFromText] = useState("");
	const [toText, setToText] = useState("");
	const [range, setRange] = useState<{ from?: string; to?: string }>({});
	const [rangeError, setRangeError] = useState<string | null>(null);

	const latest = useQuery({
		queryKey: ["oc", "entry", universeId, store, scope, entryKey, "latest"],
		queryFn: () => cloud.getEntry(universeId, store, entryKey, scope),
		retry: false,
	});
	const past = useQuery({
		queryKey: ["oc", "entry", universeId, store, scope, entryKey, "past", view],
		enabled: view.kind !== "latest",
		queryFn: () => (view.kind === "revision" ? cloud.getEntryRevision(universeId, store, entryKey, view.id, scope) : getEntryAsOf(cloud, universeId, store, entryKey, view.kind === "asOf" ? view.time : "", scope)),
		retry: false,
	});
	const revisions = useInfiniteQuery({
		queryKey: ["oc", "entry", universeId, store, scope, entryKey, "revisions", range],
		enabled: canVersions,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listRevisions(cloud, universeId, store, entryKey, { scope, pageToken: pageParam, ...range }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
		retry: false,
	});

	const refresh = () => queryClient.invalidateQueries({ queryKey: ["oc", "entry", universeId, store, scope, entryKey] });
	const write = useMutation({
		mutationFn: (args: { value: unknown; users?: string[]; attributes?: Record<string, unknown>; etag?: string; allowMissing?: boolean }) =>
			writeEntry(cloud, universeId, store, entryKey, { value: args.value, users: args.users, attributes: args.attributes, etag: args.etag }, { scope, allowMissing: args.allowMissing }),
		onSuccess: (_r, args) => {
			setEditing(null);
			if (args.allowMissing) setView({ kind: "latest" });
			queryClient.invalidateQueries({ queryKey: ["oc", "entries", universeId, store] });
			refresh();
		},
		onError: (e) => notify("Save failed", `${cloudErrorText(e)}${e instanceof HttpError && (e.status === 409 || e.status === 412) ? "\n\nThe entry changed since you opened it: pull to refresh and try again." : ""}`),
	});
	const increment = useMutation({
		mutationFn: (args: { amount: number; keep: CloudEntry }) => incrementEntry(cloud, universeId, store, entryKey, args.amount, { users: args.keep.users, attributes: args.keep.attributes }, scope),
		onSuccess: () => refresh(),
		onError: (e) => notify("Increment failed", cloudErrorText(e)),
	});
	const remove = useMutation({
		mutationFn: () => cloud.deleteEntry(universeId, store, entryKey, scope),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "entries", universeId, store] });
			router.back();
		},
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});

	const missing = latest.error instanceof HttpError && latest.error.status === 404;
	const current = latest.data;
	const shown = view.kind === "latest" ? current : past.data;

	async function onSaveValue() {
		if (!current) return;
		setDraftError(null);
		let value: unknown;
		try {
			value = parseJson(draft);
		} catch (e) {
			setDraftError((e as Error).message);
			return;
		}
		if (await confirm("Save this value?", `${store} / ${entryKey} (scope ${scope}) is overwritten with your edit; its user IDs and attributes are kept. Roblox keeps the old value as a revision.`, "Save", false)) {
			write.mutate({ value, users: current.users, attributes: current.attributes, etag: current.etag });
		}
	}

	async function onSaveMeta() {
		if (!current) return;
		setDraftError(null);
		let users: string[];
		let attributes: Record<string, unknown> | undefined;
		try {
			users = parseUsers(draftUsers);
			attributes = parseAttributes(draftAttributes);
		} catch (e) {
			setDraftError((e as Error).message);
			return;
		}
		if (await confirm("Save user IDs and attributes?", `The value of ${entryKey} stays as it is; its user IDs become ${users.length ? usersText(users) : "none"} and its attributes ${attributes ? "your JSON" : "none"}.`, "Save", false)) {
			write.mutate({ value: current.value, users, attributes, etag: current.etag });
		}
	}

	async function onIncrement() {
		if (!current) return;
		let n: number;
		try {
			n = parseInteger(amount, "The amount");
		} catch (e) {
			notify("Can't increment", (e as Error).message);
			return;
		}
		if (await confirm(`Add ${n} to ${entryKey}?`, `${String(current.value)} becomes ${Number(current.value) + n}. User IDs and attributes are kept.`, "Increment", false)) increment.mutate({ amount: n, keep: current });
	}

	async function onRestore() {
		if (!shown) return;
		const label = view.kind === "revision" ? `revision ${view.id}` : view.kind === "asOf" ? `the value at ${view.time}` : "";
		if (await confirm("Restore this value?", `${store} / ${entryKey} (scope ${scope}) is set back to ${label}, with that revision's user IDs and attributes. ${missing ? "The deleted key is recreated." : "The current value stays as a revision."}`, "Restore")) {
			write.mutate({ value: shown.value, users: shown.users, attributes: shown.attributes, allowMissing: true });
		}
	}

	async function onDelete() {
		if (await confirm("Delete this entry?", `${store} / ${entryKey} (scope ${scope}) is deleted. Roblox keeps revisions for 30 days.`, "Delete")) remove.mutate();
	}

	function showAsOf() {
		try {
			setView({ kind: "asOf", time: checkRfc3339(asOfText) });
		} catch (e) {
			notify("Check the time", (e as Error).message);
		}
	}

	function applyRange() {
		setRangeError(null);
		try {
			setRange({ from: fromText.trim() ? checkRfc3339(fromText) : undefined, to: toText.trim() ? checkRfc3339(toText) : undefined });
		} catch (e) {
			setRangeError((e as Error).message);
		}
	}

	const json = shown ? prettyJson(shown.value) : "";
	const integer = typeof current?.value === "number" && Number.isInteger(current.value);
	const revisionRows = revisions.data?.pages.flatMap((pg) => pg.dataStoreEntries ?? []) ?? [];

	return (
		<>
			{latest.error && !missing ? <CloudError error={latest.error} what="This entry" onRetry={() => latest.refetch()} /> : null}
			{missing ? (
				<Card style={{ gap: 6, borderColor: `${p.warning}88` }}>
					<Txt variant="h3">No live value</Txt>
					<Txt variant="small">{canVersions ? "This key doesn't exist or was deleted. If it was deleted in the last 30 days, pick a revision below and restore it." : "This key doesn't exist or was deleted. Add universe-datastores.versions:list to see and restore its revisions."}</Txt>
				</Card>
			) : null}
			{view.kind !== "latest" ? (
				<Card style={{ flexDirection: "row", alignItems: "center", gap: 8, borderColor: `${p.warning}88` }}>
					<Txt style={{ flex: 1 }} variant="small">
						{view.kind === "revision" ? `Showing revision ${view.id}` : `Showing the value at ${view.time}`}
					</Txt>
					<Button title="Latest" small onPress={() => setView({ kind: "latest" })} />
				</Card>
			) : null}

			{view.kind !== "latest" && past.error ? <CloudError error={past.error} what="This revision" onRetry={() => past.refetch()} /> : null}
			{(view.kind === "latest" ? latest.isLoading : past.isLoading) ? <Skeleton height={200} /> : null}

			{shown ? (
				<Section title="Value">
					{editing === "value" ? (
						<Card style={{ gap: 8 }}>
							<Field value={draft} onChangeText={setDraft} multiline style={{ minHeight: 240 }} />
							{draftError ? <Txt variant="small" color={p.destructive}>{draftError}</Txt> : null}
							<View style={{ flexDirection: "row", gap: 8 }}>
								<Button title="Save" variant="brand" icon="save-outline" small loading={write.isPending} onPress={onSaveValue} />
								<Button title="Cancel" variant="ghost" small onPress={() => setEditing(null)} />
							</View>
						</Card>
					) : (
						<Card style={{ gap: 8 }}>
							<ScrollView horizontal style={{ maxHeight: 420 }} nestedScrollEnabled>
								<ScrollView nestedScrollEnabled>
									<Txt variant="mono" selectable>
										{json}
									</Txt>
								</ScrollView>
							</ScrollView>
							<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
								<Button
									title={copied ? "Copied" : "Copy"}
									small
									icon="copy-outline"
									onPress={async () => {
										await Clipboard.setStringAsync(json);
										setCopied(true);
									}}
								/>
								{canUpdate && view.kind === "latest" ? (
									<Button
										title="Edit"
										small
										icon="create-outline"
										onPress={() => {
											setDraftError(null);
											setDraft(json);
											setEditing("value");
										}}
									/>
								) : null}
								{canUpdate && view.kind !== "latest" ? <Button title="Restore this value" small variant="brand" icon="arrow-undo-outline" loading={write.isPending} onPress={onRestore} /> : null}
								{canDelete && view.kind === "latest" ? <Button title="Delete" small variant="destructive" icon="trash-outline" loading={remove.isPending} onPress={onDelete} /> : null}
							</View>
							{canIncrement && view.kind === "latest" && integer ? (
								<View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
									<View style={{ flex: 1 }}>
										<Field label="Increment by" value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" placeholder="1" />
									</View>
									<Button title="Add" small icon="add" loading={increment.isPending} onPress={onIncrement} />
								</View>
							) : null}
						</Card>
					)}
				</Section>
			) : null}

			{shown ? (
				<Section
					title="Metadata"
					right={
						canUpdate && view.kind === "latest" && editing !== "meta" ? (
							<Button
								title="Edit"
								small
								variant="ghost"
								icon="create-outline"
								onPress={() => {
									setDraftError(null);
									setDraftUsers(usersText(shown.users));
									setDraftAttributes(attributesText(shown.attributes));
									setEditing("meta");
								}}
							/>
						) : undefined
					}
				>
					{editing === "meta" ? (
						<Card style={{ gap: 8 }}>
							<Field label="User IDs" value={draftUsers} onChangeText={setDraftUsers} placeholder="123456, 789012" hint="The players whose data this is (for GDPR erasure). Empty = none." />
							<Field label="Attributes (JSON object)" value={draftAttributes} onChangeText={setDraftAttributes} placeholder={'{"schema": 2}'} multiline style={{ minHeight: 100 }} />
							{draftError ? <Txt variant="small" color={p.destructive}>{draftError}</Txt> : null}
							<View style={{ flexDirection: "row", gap: 8 }}>
								<Button title="Save" variant="brand" icon="save-outline" small loading={write.isPending} onPress={onSaveMeta} />
								<Button title="Cancel" variant="ghost" small onPress={() => setEditing(null)} />
							</View>
						</Card>
					) : (
						<Card>
							<KV label="Scope" value={scope} />
							<KV label="Revision" value={shown.revisionId ?? "–"} mono />
							<KV label="Revised" value={fmtTime(shown.revisionCreateTime)} />
							<KV label="Created" value={fmtTime(shown.createTime)} />
							{shown.state ? <KV label="State" value={<Badge label={shown.state.toLowerCase()} tone={shown.state === "ACTIVE" ? "good" : "warning"} />} /> : null}
							<KV label="User IDs" value={shown.users?.length ? usersText(shown.users) : "–"} />
							{shown.attributes && Object.keys(shown.attributes).length ? <KV label="Attributes" value={prettyJson(shown.attributes)} mono /> : null}
						</Card>
					)}
				</Section>
			) : null}

			{canReadVersion ? (
				<Section title="Value at a time">
					<Card style={{ gap: 8 }}>
						<Field value={asOfText} onChangeText={setAsOfText} placeholder="2026-01-02T03:04:05Z (UTC)" onSubmitEditing={showAsOf} />
						<Button title="Show value then" small icon="time-outline" disabled={!asOfText.trim()} onPress={showAsOf} style={{ alignSelf: "flex-start" }} />
					</Card>
				</Section>
			) : null}

			{canVersions ? (
				<Section title="Revisions">
					<Card style={{ gap: 8 }}>
						<View style={{ flexDirection: "row", gap: 8 }}>
							<View style={{ flex: 1 }}>
								<Field value={fromText} onChangeText={setFromText} placeholder="From (UTC)" />
							</View>
							<View style={{ flex: 1 }}>
								<Field value={toText} onChangeText={setToText} placeholder="To (UTC)" />
							</View>
						</View>
						<Button title={range.from || range.to ? "Apply range" : "Filter by time"} small onPress={applyRange} style={{ alignSelf: "flex-start" }} />
						{rangeError ? <Txt variant="small" color={p.destructive}>{rangeError}</Txt> : null}
					</Card>
					{revisions.error ? (
						<CloudError error={revisions.error} what="Revisions" onRetry={() => revisions.refetch()} />
					) : !revisions.data ? (
						<Skeleton height={80} />
					) : revisionRows.length ? (
						<>
							<List>
								{revisionRows.map((r) => (
									<Row
										key={r.revisionId ?? r.path}
										chevron={canReadVersion}
										onPress={canReadVersion && r.revisionId ? () => setView({ kind: "revision", id: r.revisionId! }) : undefined}
										title={fmtTime(r.revisionCreateTime)}
										subtitle={r.revisionId}
										right={r.revisionId === current?.revisionId ? <Badge label="current" tone="brand" /> : r.state && r.state !== "ACTIVE" ? <Badge label={r.state.toLowerCase()} /> : undefined}
									/>
								))}
							</List>
							{revisions.hasNextPage ? <Button title="Older revisions" small loading={revisions.isFetchingNextPage} onPress={() => revisions.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						</>
					) : (
						<Txt variant="muted">No revisions{range.from || range.to ? " in this range" : ""}.</Txt>
					)}
					{!canReadVersion ? <Txt variant="small">Add universe-datastores.versions:read to open and restore a revision.</Txt> : null}
				</Section>
			) : (
				<Txt variant="small">Add universe-datastores.versions:list to see revisions.</Txt>
			)}
		</>
	);
}
