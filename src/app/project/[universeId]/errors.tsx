/**
 * Error report (EXPERIMENTAL APIs): find errors by keyword or message hash (Roblox has no public list of the grouped
 * errors, so discovery is a search), and the grouping rules that merge or hide error messages (regexes: list by status,
 * create, edit, ignore, move, delete; writes need universe.analytics:write).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, Chips, confirm, EmptyState, Field, List, notify, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import {
	createRegex,
	deleteRegex,
	ERRORS_READ,
	ERRORS_WRITE,
	ignoreRegex,
	listRegexes,
	logDetails,
	reorderRegex,
	updateRegex,
	type ErrorLogDetail,
	type LogDetailsQuery,
	type RegexOperation,
	type RegexStatus,
	type UniverseRegex,
} from "@/features/project/api/analytics-tools";
import { splitList } from "@/features/project/analytics-tools/dashboard-model";
import { logSeverityTone } from "@/features/project/analytics-tools/errors-model";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo } from "@/lib/format";
import { useTheme } from "@/theme";

export default function ErrorsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Error report" scopes={[ERRORS_READ]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "errors"], type: "active" })}>
			{({ universeId, cloud, can }) => <Errors universeId={universeId} cloud={cloud} canWrite={can(ERRORS_WRITE)} />}
		</ToolScreen>
	);
}

function Errors({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const [view, setView] = useState<"find" | "rules">("find");
	return (
		<>
			<Segmented options={[{ value: "find", label: "Find errors" }, { value: "rules", label: "Grouping rules" }]} value={view} onChange={setView} />
			{view === "find" ? <FindErrors universeId={universeId} cloud={cloud} /> : <Rules universeId={universeId} cloud={cloud} canWrite={canWrite} />}
		</>
	);
}

const DAY = 86_400_000;

function FindErrors({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const [keyword, setKeyword] = useState("");
	const [hashes, setHashes] = useState("");
	const [placeId, setPlaceId] = useState("");
	const [versions, setVersions] = useState("");
	const [firstSeen, setFirstSeen] = useState("");
	const [days, setDays] = useState(7);
	const [search, setSearch] = useState<LogDetailsQuery | null>(null);
	const [error, setError] = useState<string | null>(null);

	const q = useQuery({
		queryKey: ["oc", "errors", universeId, "find", search],
		enabled: !!search,
		staleTime: 300_000,
		queryFn: () => logDetails(cloud, universeId, search!),
	});

	function run() {
		const ids = splitList(hashes);
		const vs = splitList(versions);
		if (!keyword.trim() && !ids.length) return setError("Type a keyword from the error message, or paste message hash IDs.");
		if (placeId.trim() && !/^\d+$/.test(placeId.trim())) return setError("The place ID is a number.");
		if (vs.some((v) => !/^\d+$/.test(v))) return setError("Place versions are whole numbers, comma separated.");
		if (vs.length > 50 || ids.length > 100) return setError("That's too many values at once.");
		if (firstSeen.trim() && !/^\d+$/.test(firstSeen.trim())) return setError("“First seen from version” is a whole number.");
		if ((vs.length || firstSeen.trim()) && !placeId.trim()) return setError("Place versions need a place ID.");
		setError(null);
		const end = Date.now();
		setSearch({
			keyword: keyword.trim() || undefined,
			messageHashIds: ids.length ? ids : undefined,
			placeId: placeId.trim() ? Number(placeId.trim()) : undefined,
			placeVersions: vs.length ? vs.map(Number) : undefined,
			firstSeenPlaceVersion: firstSeen.trim() ? Number(firstSeen.trim()) : undefined,
			startTime: new Date(end - days * DAY).toISOString(),
			endTime: new Date(end).toISOString(),
		});
	}

	const values: ErrorLogDetail[] = q.data?.values ?? [];
	const groups = new Map<string, ErrorLogDetail[]>();
	for (const v of values) {
		const k = v.id ?? v.message ?? "?";
		groups.set(k, [...(groups.get(k) ?? []), v]);
	}

	return (
		<>
			<Card style={{ gap: 8 }}>
				<Field value={keyword} onChangeText={setKeyword} placeholder="Keyword (e.g. attempt to index nil)" returnKeyType="search" onSubmitEditing={run} />
				<Field value={hashes} onChangeText={setHashes} placeholder="Message hash IDs (optional, comma separated)" />
				<View style={{ flexDirection: "row", gap: 8 }}>
					<View style={{ flex: 1 }}>
						<Field value={placeId} onChangeText={setPlaceId} placeholder="Place ID" keyboardType="number-pad" />
					</View>
					<View style={{ flex: 1 }}>
						<Field value={versions} onChangeText={setVersions} placeholder="Versions" keyboardType="numbers-and-punctuation" />
					</View>
				</View>
				{placeId.trim() ? <Field value={firstSeen} onChangeText={setFirstSeen} placeholder="First seen from version (optional)" keyboardType="number-pad" /> : null}
				<Segmented options={[{ value: 1, label: "24 h" }, { value: 7, label: "7 days" }, { value: 28, label: "28 days" }]} value={days} onChange={setDays} />
				<Button title="Search" variant="primary" icon="search" small loading={q.isFetching} onPress={run} style={{ alignSelf: "flex-start" }} />
				{error ? (
					<Txt variant="small" color={p.destructive}>
						{error}
					</Txt>
				) : null}
			</Card>
			{!search ? (
				<Txt variant="small">Roblox's API looks errors up by keyword or message hash; the grouped error list with counts is only on Creator Hub (Analytics &gt; Error report).</Txt>
			) : q.error ? (
				<CloudError error={q.error} what="Error report" onRetry={() => q.refetch()} />
			) : !q.data ? (
				<SkeletonList rows={4} />
			) : groups.size ? (
				<Section title={`${groups.size} error${groups.size > 1 ? "s" : ""}`}>
					<List>
						{[...groups.entries()].map(([id, rows]) => {
							const first = rows[0]!;
							const where = Array.from(new Set(rows.map((r) => [r.platform, r.os].filter(Boolean).join(" / ")).filter(Boolean))).slice(0, 3).join(", ");
							return (
								<Row
									key={id}
									left={<Badge label={first.logSeverity || "log"} tone={logSeverityTone(first.logSeverity)} />}
									title={(first.message ?? "").split("\n")[0] || "(no message)"}
									subtitle={[first.logSource, where, first.firstSeenUtc ? `first seen ${fmtAgo(first.firstSeenUtc)}` : "", first.firstSeenPlaceVersion ? `since v${first.firstSeenPlaceVersion}` : ""].filter(Boolean).join(" · ")}
									numberOfLines={3}
									onPress={() =>
										first.id &&
										router.push(`/project/${universeId}/error?id=${encodeURIComponent(first.id)}${search.placeId ? `&placeId=${search.placeId}` : ""}&days=${days}`)
									}
									chevron={!!first.id}
								/>
							);
						})}
					</List>
				</Section>
			) : (
				<EmptyState icon="checkmark-circle-outline" title="No matching errors" body="Try another keyword or a longer range." />
			)}
		</>
	);
}

const STATUS_OPTIONS: { value: "all" | RegexStatus; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "CreatorCreated", label: "Yours" },
	{ value: "AutoGenerated", label: "Automatic" },
	{ value: "CreatorIgnored", label: "Ignored" },
];

/** Basic check of a pattern before sending (Roblox's own engine has the final say). */
function patternError(pattern: string): string | null {
	if (!pattern.trim()) return "The pattern can't be empty.";
	if (pattern.length > 1000) return "The pattern is at most 1000 characters.";
	try {
		new RegExp(pattern);
	} catch (e) {
		return `Not a valid regex: ${(e as Error).message}`;
	}
	return null;
}

function Rules({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<"all" | RegexStatus>("all");
	const [openId, setOpenId] = useState<number | null>(null);
	const [creating, setCreating] = useState(false);
	const q = useQuery({ queryKey: ["oc", "errors", universeId, "rules", status], queryFn: () => listRegexes(cloud, universeId, status === "all" ? undefined : status) });
	const rules = (q.data?.universeRegexes ?? []).slice().sort((a, b) => a.order - b.order);
	const refresh = () => queryClient.invalidateQueries({ queryKey: ["oc", "errors", universeId, "rules"] });

	const create = useMutation({
		mutationFn: (body: { pattern: string; output: string; regexOperation: RegexOperation }) => createRegex(cloud, universeId, body),
		onSuccess: () => {
			setCreating(false);
			refresh();
		},
		onError: (e) => notify("Couldn't add the rule", cloudErrorText(e)),
	});
	const act = useMutation({
		mutationFn: async (a: { kind: "update"; rule: UniverseRegex; body: { pattern: string; output: string; regexOperation: RegexOperation } } | { kind: "ignore"; rule: UniverseRegex } | { kind: "delete"; rule: UniverseRegex } | { kind: "move"; rule: UniverseRegex; order: number }) => {
			if (a.kind === "update") return updateRegex(cloud, a.rule.id, a.body);
			if (a.kind === "ignore") return ignoreRegex(cloud, a.rule.id);
			if (a.kind === "delete") return deleteRegex(cloud, a.rule.id);
			return reorderRegex(cloud, a.rule.id, a.order);
		},
		onSuccess: (_r, a) => {
			if (a.kind !== "move") setOpenId(null);
			refresh();
		},
		onError: (e) => notify("Couldn't change the rule", cloudErrorText(e)),
	});

	return (
		<>
			<Txt variant="small">Rules run in order on every error message: “Group” rewrites matching messages to one output so they count as one error; “Ignore” hides them from the report.</Txt>
			{canWrite ? (
				creating ? (
					<RuleForm busy={create.isPending} submitTitle="Add rule" onCancel={() => setCreating(false)} onSubmit={(body) => create.mutate(body)} />
				) : (
					<Button title="New rule" icon="add" small onPress={() => setCreating(true)} style={{ alignSelf: "flex-start" }} />
				)
			) : (
				<Txt variant="small">Read only: add {ERRORS_WRITE} to add and edit rules.</Txt>
			)}
			<Chips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
			{q.error ? (
				<CloudError error={q.error} what="Grouping rules" onRetry={() => q.refetch()} />
			) : !q.data ? (
				<SkeletonList rows={4} />
			) : rules.length ? (
				<Section>
					<List>
						{rules.map((r, i) => (
							<View key={r.id}>
								<Row
									left={<Badge label={r.regexOperation === "Ignore" ? "ignore" : "group"} tone={r.regexOperation === "Ignore" ? "muted" : "brand"} />}
									title={r.pattern || "(empty)"}
									subtitle={[r.output ? `→ ${r.output}` : "", r.regexStatus === "AutoGenerated" ? "automatic" : r.regexStatus === "CreatorIgnored" ? "ignored" : "", r.matchedCount != null ? `${r.matchedCount} matched` : "", `#${r.order}`]
										.filter(Boolean)
										.join(" · ")}
									numberOfLines={2}
									onPress={() => setOpenId(openId === r.id ? null : r.id)}
									chevron
								/>
								{openId === r.id ? (
									<View style={{ padding: 12, gap: 8 }}>
										{r.sampleMessage ? (
											<Txt variant="mono" selectable>
												e.g. {r.sampleMessage}
											</Txt>
										) : null}
										<Txt variant="small">Updated {fmtAgo(r.updatedTime)} · created {fmtAgo(r.createdTime)}</Txt>
										{canWrite ? (
											<>
												<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
													<Button title="Up" icon="arrow-up" small disabled={i === 0} loading={act.isPending && act.variables?.kind === "move" && act.variables.rule.id === r.id} onPress={() => act.mutate({ kind: "move", rule: r, order: Math.max(0, rules[i - 1]?.order ?? r.order - 1) })} />
													<Button title="Down" icon="arrow-down" small disabled={i === rules.length - 1} onPress={() => act.mutate({ kind: "move", rule: r, order: rules[i + 1]?.order ?? r.order + 1 })} />
													{r.regexStatus !== "CreatorIgnored" ? (
														<Button
															title="Ignore"
															icon="eye-off-outline"
															small
															onPress={async () => {
																if (await confirm("Ignore this rule?", "Roblox stops applying it to new errors.", "Ignore")) act.mutate({ kind: "ignore", rule: r });
															}}
														/>
													) : null}
													<Button
														title="Delete"
														icon="trash-outline"
														small
														variant="destructive"
														onPress={async () => {
															if (await confirm("Delete this rule?", r.pattern ?? "", "Delete")) act.mutate({ kind: "delete", rule: r });
														}}
													/>
												</View>
												<RuleForm
													initial={r}
													busy={act.isPending && act.variables?.kind === "update"}
													submitTitle="Save rule"
													onSubmit={(body) => act.mutate({ kind: "update", rule: r, body })}
												/>
											</>
										) : null}
									</View>
								) : null}
							</View>
						))}
					</List>
				</Section>
			) : (
				<EmptyState icon="git-merge-outline" title="No grouping rules" body={status === "all" ? "Add one to merge error messages that differ only in names or numbers." : "None with this status."} />
			)}
			{act.isPending ? (
				<Txt variant="small" color={p.mutedForeground}>
					Saving…
				</Txt>
			) : null}
		</>
	);
}

function RuleForm({ initial, busy, submitTitle, onSubmit, onCancel }: { initial?: UniverseRegex; busy: boolean; submitTitle: string; onSubmit: (body: { pattern: string; output: string; regexOperation: RegexOperation }) => void; onCancel?: () => void }) {
	const p = useTheme();
	const [pattern, setPattern] = useState(initial?.pattern ?? "");
	const [output, setOutput] = useState(initial?.output ?? "");
	const [op, setOp] = useState<RegexOperation>(initial?.regexOperation === "Ignore" ? "Ignore" : "Group");
	const [error, setError] = useState<string | null>(null);
	return (
		<Card style={{ gap: 8 }}>
			<Field label="Pattern (regex)" value={pattern} onChangeText={setPattern} placeholder="Players\.\w+\.Backpack" maxLength={1000} />
			<Segmented options={[{ value: "Group", label: "Group as" }, { value: "Ignore", label: "Ignore" }]} value={op} onChange={setOp} />
			{op === "Group" ? <Field label="Output" value={output} onChangeText={setOutput} placeholder="Players.<name>.Backpack" maxLength={1000} hint="The message matching errors are grouped under." /> : null}
			<View style={{ flexDirection: "row", gap: 8 }}>
				<Button
					title={submitTitle}
					variant="primary"
					small
					loading={busy}
					onPress={() => {
						const e = patternError(pattern);
						if (e) return setError(e);
						if (op === "Group" && !output.trim()) return setError("A group rule needs an output.");
						setError(null);
						onSubmit({ pattern, output: op === "Group" ? output : "", regexOperation: op });
					}}
				/>
				{onCancel ? <Button title="Cancel" small onPress={onCancel} /> : null}
			</View>
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : null}
		</Card>
	);
}
