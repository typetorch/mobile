/**
 * One experiment (?id=) or a new one (?new=1): its state, variants and goal, the sample ratio check, and the lifecycle
 * actions Roblox allows in each state: start now or schedule (a draft), edit (a draft), complete with a winner rolled
 * out or without (a running one), discard. Each confirms first; Roblox applies them in the background, so the app
 * waits for the operation (bounded) before refreshing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, Chips, confirm, Field, KV, notify, Section, Skeleton, Txt } from "@/components/ui";
import {
	completeExperiment,
	CONFIG_READ,
	CONFIG_WRITE,
	createExperiment,
	discardExperiment,
	EXPERIMENT_METRICS,
	experimentStats,
	getExperiment,
	scheduleExperiment,
	startExperiment,
	updateExperiment,
	type ExperimentInput,
	type ProductExperiment,
} from "@/features/project/api/analytics-tools";
import { ExperimentForm } from "@/features/project/analytics-tools/ExperimentForm";
import { operationalLabel, stateLabel, stateTone } from "@/features/project/analytics-tools/experiments-model";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtTime, prettyJson } from "@/lib/format";
import { useTheme } from "@/theme";

export default function ExperimentScreen() {
	const { id } = useLocalSearchParams<{ id?: string; new?: string }>();
	const queryClient = useQueryClient();
	const experimentId = id ? String(id) : "";
	return (
		<ToolScreen title={experimentId ? "Experiment" : "New experiment"} scopes={experimentId ? [CONFIG_READ] : [CONFIG_WRITE]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "experiments"], type: "active" })}>
			{({ universeId, cloud, can }) =>
				experimentId ? <ExperimentView universeId={universeId} cloud={cloud} id={experimentId} canWrite={can(CONFIG_WRITE)} /> : <NewExperiment universeId={universeId} cloud={cloud} />
			}
		</ToolScreen>
	);
}

function NewExperiment({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const queryClient = useQueryClient();
	const create = useMutation({
		mutationFn: (input: ExperimentInput) => createExperiment(cloud, universeId, input),
		onSuccess: (op) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "experiments", universeId] });
			const id = op?.experiment?.id;
			if (id) router.replace(`/project/${universeId}/experiment?id=${encodeURIComponent(id)}`);
			else {
				notify("Experiment created", op?.done ? "It is in the list." : "Roblox is still creating it; it shows up in the list in a moment.");
				router.back();
			}
		},
		onError: (e) => notify("Couldn't create the experiment", cloudErrorText(e)),
	});
	return (
		<>
			<Txt variant="small">It is saved as a draft; start or schedule it from its page.</Txt>
			<ExperimentForm busy={create.isPending} submitTitle="Create draft" onSubmit={(input) => create.mutate(input)} />
		</>
	);
}

type Action = { kind: "start" } | { kind: "schedule"; time: string } | { kind: "complete"; variantId?: string } | { kind: "discard" } | { kind: "update"; input: ExperimentInput };

function ExperimentView({ universeId, cloud, id, canWrite }: { universeId: number; cloud: OpenCloud; id: string; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [scheduleAt, setScheduleAt] = useState("");
	const [winner, setWinner] = useState<string>("none");
	const [formError, setFormError] = useState<string | null>(null);
	const q = useQuery({ queryKey: ["oc", "experiments", universeId, "one", id], queryFn: () => getExperiment(cloud, universeId, id) });
	const e: ProductExperiment | null = q.data?.experiment ?? null;
	const running = e?.state === "EXPERIMENT_STATE_RUNNING";
	const stats = useQuery({
		queryKey: ["oc", "experiments", universeId, "stats", id],
		enabled: running || e?.state === "EXPERIMENT_STATE_COMPLETED",
		retry: false,
		queryFn: () => experimentStats(cloud, universeId, id),
	});

	const act = useMutation({
		mutationFn: (a: Action) => {
			if (a.kind === "start") return startExperiment(cloud, universeId, id);
			if (a.kind === "schedule") return scheduleExperiment(cloud, universeId, id, a.time);
			if (a.kind === "complete") return completeExperiment(cloud, universeId, id, a.variantId);
			if (a.kind === "update") return updateExperiment(cloud, universeId, id, a.input);
			return discardExperiment(cloud, universeId, id);
		},
		onSuccess: (op, a) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "experiments", universeId] });
			if (a.kind === "update") setEditing(false);
			if (op && !op.done) notify("Still applying", `Roblox is still ${operationalLabel(op.status) || "working on it"}; pull to refresh in a moment.`);
			if (a.kind === "discard") router.back();
		},
		onError: (err) => notify("The experiment didn't change", cloudErrorText(err)),
	});

	if (q.error) return <CloudError error={q.error} what="This experiment" onRetry={() => q.refetch()} />;
	if (!e) return <Skeleton height={200} />;

	const config = e.experimentConfiguration;
	const variants = [...(config?.inGameConfigExperimentConfiguration?.variants ?? []), ...(config?.matchmakingExperimentConfiguration?.variants ?? [])];
	const totalWeight = variants.reduce((n, v) => n + (v.variantMeta?.weight ?? 0), 0) || 1;
	const draft = e.state === "EXPERIMENT_STATE_DRAFT";
	const scheduled = e.state === "EXPERIMENT_STATE_SCHEDULED";
	const finished = e.state === "EXPERIMENT_STATE_COMPLETED" || e.state === "EXPERIMENT_STATE_CANCELLED" || e.state === "EXPERIMENT_STATE_DELETED";
	const busyOp = e.operationalStatus && e.operationalStatus !== "OPERATIONAL_STATUS_READY" ? operationalLabel(e.operationalStatus) : null;
	const goal = EXPERIMENT_METRICS.find((m) => m.value === e.universeMetricConfiguration?.goalMetric)?.label ?? e.universeMetricConfiguration?.goalMetric ?? "–";
	const ends = e.startedTime && e.durationSeconds ? Date.parse(e.startedTime) + e.durationSeconds * 1000 : null;

	async function schedule() {
		const t = Date.parse(scheduleAt.trim());
		if (!scheduleAt.trim() || !Number.isFinite(t)) return setFormError("Use a date and time like 2026-12-01T18:00Z (UTC).");
		if (t < Date.now() + 60_000) return setFormError("Pick a time in the future.");
		setFormError(null);
		const iso = new Date(t).toISOString();
		if (await confirm("Schedule the experiment?", `It starts by itself at ${fmtTime(iso)} and splits players between the variants.`, "Schedule", false)) act.mutate({ kind: "schedule", time: iso });
	}

	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
					<Txt variant="h2" style={{ flexShrink: 1 }}>
						{e.name || "Untitled"}
					</Txt>
					{e.state ? <Badge label={stateLabel(e.state)} tone={stateTone(e.state)} /> : null}
					{busyOp ? <Badge label={busyOp} tone="warning" /> : null}
				</View>
				{e.description ? <Txt variant="muted">{e.description}</Txt> : null}
				<Txt variant="small">
					{[
						`${e.exposurePercent ?? "?"}% of players`,
						e.durationSeconds ? `${Math.round(e.durationSeconds / 86_400)} days` : "",
						`goal: ${goal}`,
						e.startedTime ? `started ${fmtAgo(e.startedTime)}` : "",
						ends && running ? `ends ${fmtTime(ends)}` : "",
						e.scheduledTime && scheduled ? `starts ${fmtTime(e.scheduledTime)}` : "",
						e.stoppedTime ? `stopped ${fmtAgo(e.stoppedTime)}` : "",
					]
						.filter(Boolean)
						.join(" · ")}
				</Txt>
			</Card>

			{running || e.state === "EXPERIMENT_STATE_COMPLETED" ? (
				<Card style={{ gap: 4 }}>
					<Txt style={{ fontWeight: "600" }}>Health</Txt>
					{stats.error ? (
						<CloudError error={stats.error} what="Experiment stats" onRetry={() => stats.refetch()} />
					) : stats.isLoading ? (
						<Skeleton height={16} />
					) : stats.data?.isSrmDetected ? (
						<Txt color={p.destructive}>Sample ratio mismatch: players aren't split between variants as the weights say, so the results may be biased.</Txt>
					) : stats.data ? (
						<Txt variant="muted">The split between variants matches the weights (no sample ratio mismatch).</Txt>
					) : (
						<Txt variant="muted">No stats yet.</Txt>
					)}
					<Txt variant="small">The metric results per variant are on Creator Hub (the API has no results endpoint yet).</Txt>
				</Card>
			) : null}

			<Section title={`Variants (${variants.length})`}>
				<Card style={{ gap: 6 }}>
					{variants.map((v, i) => {
						const entry = "configEntry" in v ? v.configEntry : null;
						return (
							<View key={i} style={{ gap: 2, paddingVertical: 4 }}>
								<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
									<Txt style={{ fontWeight: "600", flexShrink: 1 }}>{v.variantMeta?.label || `Variant ${i + 1}`}</Txt>
									{v.variantMeta?.isBaseline ? <Badge label="baseline" /> : null}
									<Txt variant="small">{Math.round(((v.variantMeta?.weight ?? 0) / totalWeight) * 100)}%</Txt>
								</View>
								{entry ? (
									<Txt variant="mono" selectable numberOfLines={4}>
										{entry.key} = {prettyJson(entry.entryValue)}
									</Txt>
								) : "placeMatchmakingConfigs" in v && v.placeMatchmakingConfigs?.length ? (
									<Txt variant="small">{v.placeMatchmakingConfigs.map((c) => `place ${c.placeId}: ${c.usePlatformDefault ? "platform default" : c.matchmakingScoringConfigId}`).join(" · ")}</Txt>
								) : (
									<Txt variant="small">published value</Txt>
								)}
							</View>
						);
					})}
				</Card>
			</Section>

			{canWrite && !finished ? (
				<Section title="Actions">
					<Card style={{ gap: 8 }}>
						{draft || scheduled ? (
							<Button
								title="Start now"
								icon="play"
								variant="primary"
								small
								loading={act.isPending && act.variables?.kind === "start"}
								onPress={async () => {
									if (await confirm("Start the experiment now?", `${e.exposurePercent ?? "?"}% of players start getting the variants right away.`, "Start", false)) act.mutate({ kind: "start" });
								}}
								style={{ alignSelf: "flex-start" }}
							/>
						) : null}
						{draft ? (
							<>
								<Field label="Or schedule (UTC)" value={scheduleAt} onChangeText={setScheduleAt} placeholder="2026-12-01T18:00Z" />
								<Button title="Schedule" icon="calendar-outline" small loading={act.isPending && act.variables?.kind === "schedule"} onPress={schedule} style={{ alignSelf: "flex-start" }} />
							</>
						) : null}
						{running ? (
							<>
								<Txt variant="label">Complete: roll out</Txt>
								<Chips
									options={[{ value: "none", label: "No winner (stop)" }, ...variants.filter((v) => v.variantMeta?.variantId).map((v) => ({ value: v.variantMeta!.variantId!, label: v.variantMeta?.label || v.variantMeta!.variantId! }))]}
									value={winner}
									onChange={setWinner}
								/>
								<Button
									title="Complete experiment"
									icon="flag-outline"
									variant="primary"
									small
									loading={act.isPending && act.variables?.kind === "complete"}
									onPress={async () => {
										const label = variants.find((v) => v.variantMeta?.variantId === winner)?.variantMeta?.label;
										const msg = winner === "none" ? "It stops; every player gets the published value again." : `It stops and “${label ?? winner}” becomes the value for every player.`;
										if (await confirm("Complete the experiment?", msg, "Complete")) act.mutate({ kind: "complete", variantId: winner === "none" ? undefined : winner });
									}}
									style={{ alignSelf: "flex-start" }}
								/>
							</>
						) : null}
						{draft ? <Button title={editing ? "Cancel edit" : "Edit"} icon="create-outline" small onPress={() => setEditing(!editing)} style={{ alignSelf: "flex-start" }} /> : null}
						<Button
							title="Discard"
							icon="trash-outline"
							variant="destructive"
							small
							loading={act.isPending && act.variables?.kind === "discard"}
							onPress={async () => {
								if (await confirm("Discard the experiment?", running ? "It stops right away without a winner and is marked deleted." : "It is marked deleted.", "Discard")) act.mutate({ kind: "discard" });
							}}
							style={{ alignSelf: "flex-start" }}
						/>
						{act.isPending ? <Txt variant="small">Waiting for Roblox to apply it (up to 30 s)…</Txt> : null}
						{formError ? (
							<Txt variant="small" color={p.destructive}>
								{formError}
							</Txt>
						) : null}
					</Card>
				</Section>
			) : !canWrite ? (
				<Txt variant="small">Read only: add {CONFIG_WRITE} to start, stop or edit.</Txt>
			) : null}

			{editing && draft ? <ExperimentForm initial={e} busy={act.isPending && act.variables?.kind === "update"} submitTitle="Save changes" onSubmit={(input) => act.mutate({ kind: "update", input })} /> : null}

			<Section title="Details">
				<Card>
					<KV label="Experiment ID" value={e.id ?? id} mono />
					<KV label="Type" value={config?.productType === "EXPERIMENT_PRODUCT_TYPE_MATCHMAKING" ? "Matchmaking" : "In-experience config"} />
					<KV label="Targeting" value={e.targetingCriteria?.rule?.tokens?.length ? `${e.targetingCriteria.rule.tokens.length}-token rule` : "everyone eligible"} />
					<KV label="Learning metrics" value={(e.universeMetricConfiguration?.learningMetrics ?? []).map((m) => EXPERIMENT_METRICS.find((x) => x.value === m)?.label ?? m).join(", ") || "–"} />
					<KV label="Created" value={`${fmtTime(e.createdTime)}${e.createdBy ? ` by ${e.createdBy}` : ""}`} />
					<KV label="Updated" value={e.lastUpdatedTime ? fmtTime(e.lastUpdatedTime) : "–"} />
				</Card>
			</Section>
		</>
	);
}
