/**
 * Experience configs (BETA): per repository, the published values (with descriptions, conditional variants and when
 * each changed), the draft and what it changes, and the revision history. With universe:write: set or delete an entry
 * in the draft, discard one change, overwrite the whole draft as JSON, reset the draft, publish it (immediately or as a
 * gradual rollout) and stage a restore of an old revision. Every draft write sends the draft hash of the read, so a
 * change made on Creator Hub in between makes Roblox refuse instead of being overwritten.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, Chips, confirm, EmptyState, Field, KV, List, notify, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import {
	CONFIG_READ,
	CONFIG_REPOSITORIES,
	CONFIG_WRITE,
	getConfigDraft,
	getConfigFull,
	getConfigValues,
	listConfigRevisions,
	overwriteConfigDraft,
	patchConfigDraft,
	publishConfigDraft,
	resetConfigDraft,
	restoreConfigRevision,
	type ConditionalRulesPayload,
	type ConfigRepository,
	type DeploymentStrategy,
} from "@/features/project/api/analytics-tools";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { compactJson, fmtAgo, fmtTime, prettyJson } from "@/lib/format";
import { useTheme } from "@/theme";

export default function ConfigsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Configs" scopes={[CONFIG_READ]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "configs"], type: "active" })}>
			{({ universeId, cloud, can }) => <Configs universeId={universeId} cloud={cloud} canWrite={can(CONFIG_WRITE)} />}
		</ToolScreen>
	);
}

type Tab = "published" | "draft" | "history";

function Configs({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const [repo, setRepo] = useState<ConfigRepository>("InExperienceConfig");
	const [tab, setTab] = useState<Tab>("published");
	const [editKey, setEditKey] = useState<{ key: string; value: string } | null>(null);
	return (
		<>
			<Chips options={CONFIG_REPOSITORIES} value={repo} onChange={(r) => { setRepo(r); setEditKey(null); }} />
			<Segmented options={[{ value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "history", label: "History" }]} value={tab} onChange={setTab} />
			{!canWrite ? <Txt variant="small">Read only: add {CONFIG_WRITE} to edit and publish configs.</Txt> : null}
			{tab === "published" ? (
				<Published
					universeId={universeId}
					cloud={cloud}
					repo={repo}
					onEdit={
						canWrite
							? (key, value) => {
									setEditKey({ key, value: prettyJson(value) });
									setTab("draft");
								}
							: undefined
					}
				/>
			) : tab === "draft" ? (
				<Draft key={repo} universeId={universeId} cloud={cloud} repo={repo} canWrite={canWrite} prefill={editKey} onPrefillUsed={() => setEditKey(null)} />
			) : (
				<History universeId={universeId} cloud={cloud} repo={repo} canWrite={canWrite} onRestored={() => setTab("draft")} />
			)}
		</>
	);
}

function Published({ universeId, cloud, repo, onEdit }: { universeId: number; cloud: OpenCloud; repo: ConfigRepository; onEdit?: (key: string, value: unknown) => void }) {
	const [open, setOpen] = useState<string | null>(null);
	const q = useQuery({ queryKey: ["oc", "configs", universeId, repo, "full"], queryFn: () => getConfigFull(cloud, universeId, repo) });
	if (q.error) return <CloudError error={q.error} what="Configs" onRetry={() => q.refetch()} />;
	if (!q.data) return <SkeletonList rows={5} />;
	const entries = Object.entries(q.data.entries ?? {}).sort(([a], [b]) => a.localeCompare(b));
	const rules = q.data.conditionalRules?.rulesOrder ?? Object.keys(q.data.conditionalRules?.rules ?? {});
	return (
		<>
			<Txt variant="small">
				Version {q.data.metadata?.configVersion ?? "–"} · {entries.length} entr{entries.length === 1 ? "y" : "ies"}
				{rules.length ? ` · ${rules.length} conditional rule${rules.length > 1 ? "s" : ""}` : ""}
			</Txt>
			{entries.length ? (
				<Section>
					<List>
						{entries.map(([key, e]) => (
							<View key={key}>
								<Row
									title={key}
									subtitle={`${compactJson(e.value, 80)}${e.description ? ` · ${e.description}` : ""}`}
									numberOfLines={2}
									right={e.variants?.length ? <Badge label={`${e.variants.length} variant${e.variants.length > 1 ? "s" : ""}`} tone="brand" /> : undefined}
									onPress={() => setOpen(open === key ? null : key)}
									chevron
								/>
								{open === key ? (
									<View style={{ padding: 12, gap: 6 }}>
										<Txt variant="mono" selectable>
											{prettyJson(e.value)}
										</Txt>
										{(e.variants ?? []).map((v, i) => (
											<Txt key={i} variant="small" selectable>
												if {v.variantTypeId ?? v.type}: {compactJson(v.value, 120)}
											</Txt>
										))}
										<Txt variant="small">
											{e.lastModifiedTime ? `changed ${fmtAgo(e.lastModifiedTime)}` : ""}
											{e.lastAccessedTime ? ` · last read ${fmtAgo(e.lastAccessedTime)}` : ""}
										</Txt>
										{onEdit ? <Button title="Change in draft" icon="create-outline" small onPress={() => onEdit(key, e.value)} style={{ alignSelf: "flex-start" }} /> : null}
									</View>
								) : null}
							</View>
						))}
					</List>
				</Section>
			) : (
				<EmptyState icon="options-outline" title="Nothing published" body="Add entries in the Draft tab, then publish." />
			)}
		</>
	);
}

function parseJsonValue(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (e) {
		return { ok: false, error: `Not valid JSON (strings need "quotes"): ${(e as Error).message}` };
	}
}

function Draft({
	universeId,
	cloud,
	repo,
	canWrite,
	prefill,
	onPrefillUsed,
}: {
	universeId: number;
	cloud: OpenCloud;
	repo: ConfigRepository;
	canWrite: boolean;
	prefill: { key: string; value: string } | null;
	onPrefillUsed: () => void;
}) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const draft = useQuery({ queryKey: ["oc", "configs", universeId, repo, "draft"], queryFn: () => getConfigDraft(cloud, universeId, repo) });
	const published = useQuery({ queryKey: ["oc", "configs", universeId, repo, "values"], queryFn: () => getConfigValues(cloud, universeId, repo) });
	const [key, setKey] = useState(prefill?.key ?? "");
	const [value, setValue] = useState(prefill?.value ?? "");
	const [message, setMessage] = useState("");
	const [strategy, setStrategy] = useState<DeploymentStrategy>("Immediate");
	const [jsonOpen, setJsonOpen] = useState(false);
	const [json, setJson] = useState("");
	const [error, setError] = useState<string | null>(null);

	const hash = draft.data?.draftHash ?? null;
	const refresh = () => queryClient.invalidateQueries({ queryKey: ["oc", "configs", universeId, repo] });

	const patch = useMutation({
		mutationFn: (entries: Record<string, unknown>) => patchConfigDraft(cloud, universeId, repo, { draftHash: hash, entries }),
		onSuccess: () => {
			setKey("");
			setValue("");
			onPrefillUsed();
			refresh();
		},
		onError: (e) => notify("Couldn't change the draft", cloudErrorText(e)),
	});
	const overwrite = useMutation({
		mutationFn: (body: { entries: Record<string, unknown>; conditionalRules?: ConditionalRulesPayload | null }) => overwriteConfigDraft(cloud, universeId, repo, { draftHash: hash, ...body }),
		onSuccess: () => {
			setJsonOpen(false);
			refresh();
		},
		onError: (e) => notify("Couldn't overwrite the draft", cloudErrorText(e)),
	});
	const reset = useMutation({
		mutationFn: () => resetConfigDraft(cloud, universeId, repo, hash),
		onSuccess: refresh,
		onError: (e) => notify("Couldn't reset the draft", cloudErrorText(e)),
	});
	const publish = useMutation({
		mutationFn: () => publishConfigDraft(cloud, universeId, repo, { draftHash: hash ?? "", message: message.trim() || undefined, deploymentStrategy: strategy }),
		onSuccess: (r) => {
			setMessage("");
			refresh();
			notify("Published", `Version ${r?.configVersion ?? "?"} is live${strategy === "GradualRollout" ? " (rolling out gradually)" : ""}.`);
		},
		onError: (e) => notify("Couldn't publish", cloudErrorText(e)),
	});

	if (draft.error) return <CloudError error={draft.error} what="The draft" onRetry={() => draft.refetch()} />;
	// Discard, Delete entry and Overwrite as JSON all compare with the published values, so the tab waits for them:
	// treating "not loaded yet" as an empty repository would turn a discard into a delete and hide what an overwrite
	// removes.
	if (published.error) return <CloudError error={published.error} what="The published config" onRetry={() => published.refetch()} />;
	if (!draft.data || !published.data) return <SkeletonList rows={4} />;
	const base = published.data;
	const changes = Object.entries(draft.data.entries ?? {}).sort(([a], [b]) => a.localeCompare(b));
	const pub = base.entries ?? {};
	const ruleChanges = Object.keys(draft.data.conditionalRules?.rules ?? {}).length;
	const hasDraft = changes.length > 0 || ruleChanges > 0;

	function setEntry() {
		const k = key.trim();
		if (!k) return setError("Give the entry a key.");
		if (k.length > 256) return setError("The key is too long.");
		const parsed = parseJsonValue(value);
		if (!parsed.ok) return setError(parsed.error);
		setError(null);
		patch.mutate({ [k]: parsed.value });
	}

	return (
		<>
			{hasDraft ? (
				<Section title={`Draft changes (${changes.length})`}>
					<List>
						{changes.map(([k, e]) => {
							const deleted = e === null || e?.value === null;
							const isNew = !(k in pub);
							return (
								<Row
									key={k}
									left={<Badge label={deleted ? "delete" : isNew ? "new" : "change"} tone={deleted ? "critical" : isNew ? "good" : "warning"} />}
									title={k}
									subtitle={deleted ? `was ${compactJson(pub[k], 80)}` : `${isNew ? "" : `${compactJson(pub[k], 40)} → `}${compactJson(e?.value, 80)}${e?.description ? ` · ${e.description}` : ""}`}
									numberOfLines={3}
									right={
										canWrite ? (
											<Button
												title="Discard"
												small
												variant="ghost"
												onPress={async () => {
													if (await confirm(`Discard the change to “${k}”?`, isNew ? "The new entry is dropped from the draft." : "It goes back to its published value.", "Discard")) patch.mutate({ [k]: isNew ? null : pub[k] });
												}}
											/>
										) : undefined
									}
								/>
							);
						})}
					</List>
					{ruleChanges ? <Txt variant="small">The draft also changes {ruleChanges} conditional rule{ruleChanges > 1 ? "s" : ""} (edit those on Creator Hub).</Txt> : null}
				</Section>
			) : (
				<EmptyState icon="document-outline" title="No draft changes" body="The draft matches what is published." />
			)}

			{canWrite ? (
				<>
					<Card style={{ gap: 8 }}>
						<Txt variant="h3">Set an entry</Txt>
						<Field value={key} onChangeText={setKey} placeholder="Key" />
						<Field value={value} onChangeText={setValue} placeholder={'Value as JSON: 10, "text", true, {"a": 1}'} multiline style={{ minHeight: 70 }} />
						<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
							<Button title="Save to draft" variant="primary" small icon="save-outline" loading={patch.isPending} onPress={setEntry} />
							{key.trim() && key.trim() in pub ? (
								<Button
									title="Delete entry"
									small
									variant="destructive"
									icon="trash-outline"
									onPress={async () => {
										if (await confirm(`Delete “${key.trim()}”?`, "The draft removes it; it disappears for players when you publish.", "Delete")) patch.mutate({ [key.trim()]: null });
									}}
								/>
							) : null}
						</View>
						{error ? (
							<Txt variant="small" color={p.destructive}>
								{error}
							</Txt>
						) : null}
					</Card>

					<Card style={{ gap: 8 }}>
						<Txt variant="h3">Publish</Txt>
						<Field value={message} onChangeText={setMessage} placeholder="What changed (optional)" autoCapitalize="sentences" />
						<Segmented options={[{ value: "Immediate", label: "Immediately" }, { value: "GradualRollout", label: "Gradual rollout" }]} value={strategy} onChange={setStrategy} />
						<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
							<Button
								title="Publish draft"
								variant="primary"
								icon="cloud-upload-outline"
								small
								disabled={!hasDraft || !hash}
								loading={publish.isPending}
								onPress={async () => {
									if (await confirm("Publish the draft?", `${changes.length} change${changes.length === 1 ? "" : "s"} go live for players ${strategy === "Immediate" ? "right away" : "gradually"}.`, "Publish", false)) publish.mutate();
								}}
							/>
							<Button
								title="Reset draft"
								icon="refresh"
								small
								variant="destructive"
								disabled={!hasDraft}
								loading={reset.isPending}
								onPress={async () => {
									if (await confirm("Reset the draft?", "Every unpublished change is thrown away.", "Reset")) reset.mutate();
								}}
							/>
							<Button
								title={jsonOpen ? "Close JSON" : "Overwrite as JSON"}
								icon="code-slash-outline"
								small
								onPress={() => {
									if (!jsonOpen) {
										const merged: Record<string, unknown> = { ...(base.entries ?? {}) };
										for (const [k, e] of changes) {
											if (e === null || e?.value === null) delete merged[k];
											else merged[k] = e?.value;
										}
										setJson(prettyJson({ entries: merged, conditionalRules: base.conditionalRules ?? undefined }));
									}
									setJsonOpen(!jsonOpen);
								}}
							/>
						</View>
						{jsonOpen ? (
							<View style={{ gap: 8 }}>
								<Txt variant="small">The whole configuration after publish: keys left out are deleted, and conditional rules left out are removed.</Txt>
								<Field value={json} onChangeText={setJson} multiline style={{ minHeight: 200 }} />
								<Button
									title="Overwrite draft"
									variant="destructive"
									small
									loading={overwrite.isPending}
									onPress={async () => {
										const parsed = parseJsonValue(json);
										if (!parsed.ok) return setError(parsed.error);
										const body = parsed.value as { entries?: unknown; conditionalRules?: unknown };
										if (!body || typeof body !== "object" || !body.entries || typeof body.entries !== "object" || Array.isArray(body.entries)) return setError('Use {"entries": {…}, "conditionalRules": {…}}.');
										setError(null);
										const removed = Object.keys(pub).filter((k) => !(k in (body.entries as object)));
										if (
											await confirm(
												"Overwrite the draft?",
												`The draft becomes exactly this JSON${removed.length ? `; ${removed.length} published entr${removed.length === 1 ? "y is" : "ies are"} deleted (${removed.slice(0, 5).join(", ")})` : ""}${body.conditionalRules ? "" : "; all conditional rules are removed"}.`,
												"Overwrite",
											)
										)
											overwrite.mutate({ entries: body.entries as Record<string, unknown>, conditionalRules: (body.conditionalRules as ConditionalRulesPayload | undefined) ?? undefined });
									}}
									style={{ alignSelf: "flex-start" }}
								/>
							</View>
						) : null}
					</Card>
				</>
			) : null}
			{hash ? <Txt variant="small">Draft hash {hash.slice(0, 12)}</Txt> : null}
		</>
	);
}

const PAGE = 20;

function History({ universeId, cloud, repo, canWrite, onRestored }: { universeId: number; cloud: OpenCloud; repo: ConfigRepository; canWrite: boolean; onRestored: () => void }) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState<string | null>(null);
	const list = useInfiniteQuery({
		queryKey: ["oc", "configs", universeId, repo, "revisions"],
		initialPageParam: 0,
		queryFn: ({ pageParam }) => listConfigRevisions(cloud, universeId, repo, { MaxPageSize: PAGE, Skip: pageParam, SortOrder: "SORT_ORDER_DESCENDING", SortKey: "SORT_KEY_LAST_MODIFIED_TIME" }),
		getNextPageParam: (last, pages) => ((last.revisions?.length ?? 0) >= PAGE ? pages.reduce((n, pg) => n + (pg.revisions?.length ?? 0), 0) : undefined),
	});
	const restore = useMutation({
		mutationFn: (revisionId: string) => restoreConfigRevision(cloud, universeId, repo, revisionId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "configs", universeId, repo] });
			notify("Restore staged", "The draft now reverts to that revision. Publish it from the Draft tab to apply.");
			onRestored();
		},
		onError: (e) => notify("Couldn't restore", cloudErrorText(e)),
	});
	const rows = list.data?.pages.flatMap((pg) => pg.revisions ?? []) ?? [];
	if (list.error) return <CloudError error={list.error} what="Config history" onRetry={() => list.refetch()} />;
	if (!list.data) return <SkeletonList rows={5} />;
	if (!rows.length) return <EmptyState icon="time-outline" title="No revisions" body="Each publish adds one." />;
	return (
		<Section>
			<List>
				{rows.map((r, i) => {
					const id = r.revisionId ?? String(i);
					const changes = Object.entries(r.changes ?? {});
					return (
						<View key={id}>
							<Row
								title={`Version ${r.version ?? "?"}${r.message ? ` · ${r.message}` : ""}`}
								subtitle={[r.time ? fmtTime(r.time) : "", r.publishedBy ? `by ${r.publishedBy}` : "", `${changes.length} change${changes.length === 1 ? "" : "s"}`, r.deploymentResult ?? ""].filter(Boolean).join(" · ")}
								numberOfLines={2}
								onPress={() => setOpen(open === id ? null : id)}
								chevron
							/>
							{open === id ? (
								<View style={{ padding: 12, gap: 6 }}>
									{changes.map(([k, c]) => (
										<KV key={k} label={k} value={`${c.before === null || c.before === undefined ? "(new)" : compactJson(c.before, 40)} → ${c.after === null || c.after === undefined ? "(deleted)" : compactJson(c.after, 40)}`} />
									))}
									{r.conditionalRulesChanges ? <Txt variant="small">Conditional rules changed too.</Txt> : null}
									{r.autoRestoreToVersion !== undefined && r.autoRestoreToVersion >= 0 ? <Txt variant="small">Auto-restores to version {r.autoRestoreToVersion}.</Txt> : null}
									{canWrite && r.revisionId ? (
										<Button
											title="Restore this version"
											icon="arrow-undo-outline"
											small
											loading={restore.isPending && restore.variables === r.revisionId}
											onPress={async () => {
												if (await confirm(`Restore version ${r.version ?? ""}?`, "This throws away the current draft and stages a revert to this version. Nothing changes for players until you publish.", "Restore")) restore.mutate(r.revisionId!);
											}}
											style={{ alignSelf: "flex-start" }}
										/>
									) : null}
								</View>
							) : null}
						</View>
					);
				})}
			</List>
			{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
		</Section>
	);
}
