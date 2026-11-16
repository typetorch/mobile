/**
 * One data store entry: its value as JSON, metadata, revisions (and a past revision's value), edit and delete
 * (each behind a confirm and only with the scope).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, ErrorState, Field, KV, List, Row, Section, Skeleton, Txt } from "@/components/ui";
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
					canDelete={can("universe-datastores.objects:delete")}
					canVersions={can("universe-datastores.versions:list")}
				/>
			)}
		</ToolScreen>
	);
}

function Entry({
	universeId,
	cloud,
	store,
	scope,
	entryKey,
	canUpdate,
	canDelete,
	canVersions,
}: {
	universeId: number;
	cloud: OpenCloud;
	store: string;
	scope: string;
	entryKey: string;
	canUpdate: boolean;
	canDelete: boolean;
	canVersions: boolean;
}) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [revision, setRevision] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [draftError, setDraftError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const entry = useQuery({
		queryKey: ["oc", "entry", universeId, store, scope, entryKey, revision],
		queryFn: () => (revision ? cloud.getEntryRevision(universeId, store, entryKey, revision, scope) : cloud.getEntry(universeId, store, entryKey, scope)),
		retry: false,
	});
	const revisions = useQuery({
		queryKey: ["oc", "entry", universeId, store, scope, entryKey, "revisions"],
		queryFn: () => cloud.listRevisions(universeId, store, entryKey, { scope }),
		enabled: canVersions,
		retry: false,
	});
	const save = useMutation({
		mutationFn: (value: unknown) => cloud.updateEntry(universeId, store, entryKey, value, scope),
		onSuccess: () => {
			setEditing(false);
			queryClient.invalidateQueries({ queryKey: ["oc", "entry", universeId, store, scope, entryKey] });
		},
	});
	const remove = useMutation({
		mutationFn: () => cloud.deleteEntry(universeId, store, entryKey, scope),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "entries", universeId, store] });
			router.back();
		},
	});

	async function onSave() {
		setDraftError(null);
		let value: unknown;
		try {
			value = JSON.parse(draft);
		} catch (e) {
			setDraftError(`Not valid JSON: ${(e as Error).message}`);
			return;
		}
		if (await confirm("Save this value?", `${store} / ${entryKey} (scope ${scope}) is overwritten with your edit. Roblox keeps the old value as a revision.`, "Save", false)) save.mutate(value);
	}

	async function onDelete() {
		if (await confirm("Delete this entry?", `${store} / ${entryKey} (scope ${scope}) is deleted. Roblox keeps revisions for 30 days.`, "Delete")) remove.mutate();
	}

	if (entry.error) return <ErrorState error={entry.error} onRetry={() => entry.refetch()} />;
	if (!entry.data) return <Skeleton height={200} />;
	const e = entry.data;
	const json = prettyJson(e.value);

	return (
		<>
			{revision ? (
				<Card style={{ flexDirection: "row", alignItems: "center", gap: 8, borderColor: `${p.warning}88` }}>
					<Txt style={{ flex: 1 }} variant="small">
						Showing revision {revision}
					</Txt>
					<Button title="Latest" small onPress={() => setRevision(null)} />
				</Card>
			) : null}
			<Section title="Value">
				{editing ? (
					<Card style={{ gap: 8 }}>
						<Field value={draft} onChangeText={setDraft} multiline style={{ minHeight: 240 }} />
						{draftError ? <Txt variant="small" color={p.destructive}>{draftError}</Txt> : null}
						{save.error ? <Txt variant="small" color={p.destructive}>{(save.error as Error).message}</Txt> : null}
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button title="Save" variant="brand" icon="save-outline" small loading={save.isPending} onPress={onSave} />
							<Button title="Cancel" variant="ghost" small onPress={() => setEditing(false)} />
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
							{canUpdate && !revision ? (
								<Button
									title="Edit"
									small
									icon="create-outline"
									onPress={() => {
										setDraft(json);
										setEditing(true);
									}}
								/>
							) : null}
							{canDelete && !revision ? <Button title="Delete" small variant="destructive" icon="trash-outline" loading={remove.isPending} onPress={onDelete} /> : null}
						</View>
						{remove.error ? <Txt variant="small" color={p.destructive}>{(remove.error as Error).message}</Txt> : null}
					</Card>
				)}
			</Section>
			<Section title="Metadata">
				<Card>
					<KV label="Scope" value={scope} />
					<KV label="Revision" value={e.revisionId ?? "–"} mono />
					<KV label="Revised" value={fmtTime(e.revisionCreateTime)} />
					<KV label="Created" value={fmtTime(e.createTime)} />
					{e.state ? <KV label="State" value={<Badge label={e.state.toLowerCase()} tone={e.state === "ACTIVE" ? "good" : "warning"} />} /> : null}
					<KV label="User IDs" value={e.users?.length ? e.users.join(", ") : "–"} />
					{e.attributes && Object.keys(e.attributes).length ? <KV label="Attributes" value={prettyJson(e.attributes)} mono /> : null}
				</Card>
			</Section>
			{canVersions ? (
				<Section title="Revisions">
					{revisions.error ? (
						<Txt variant="small">{(revisions.error as Error).message}</Txt>
					) : !revisions.data ? (
						<Skeleton height={80} />
					) : (
						<List>
							{(revisions.data.dataStoreEntries ?? []).map((r) => (
								<Row
									key={r.revisionId ?? r.path}
									chevron
									onPress={() => r.revisionId && setRevision(r.revisionId)}
									title={fmtTime(r.revisionCreateTime)}
									subtitle={r.revisionId}
									right={r.revisionId === e.revisionId && !revision ? <Badge label="current" tone="brand" /> : r.state && r.state !== "ACTIVE" ? <Badge label={r.state.toLowerCase()} /> : undefined}
								/>
							))}
						</List>
					)}
				</Section>
			) : (
				<Txt variant="small">Add universe-datastores.versions:list to see revisions.</Txt>
			)}
		</>
	);
}
