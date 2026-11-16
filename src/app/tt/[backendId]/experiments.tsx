/**
 * Experiments: per-variant numbers and how sure each difference is (query `experiment`), the sample ratio check (a loud
 * alert on a mismatch), every experiment with its state and weights (GET /v1/experiments), the players in an experiment
 * or variant (GET /v1/experiments/<e>/players), and for owners the controls (Start / Stop / Clear / Change split /
 * Settle: POST /v1/experiments/<e>/change answers the signed CLI command to run in the game's folder).
 */
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { View } from "react-native";

import type { AssignmentCheck, Comparison, ExperimentChangeRequest, ExperimentOverride, ExperimentOverrides, ExperimentPlayer, ExperimentResult, PreparedExperimentChange } from "@/api/tt/types";
import { Badge, Button, Chips, Field, Segmented, Txt } from "@/components/ui";
import { Callout } from "@/features/typetorch/analytics-bits";
import { CopyButton, Note, openPlayer, Panel, QueryState, ShareBar } from "@/features/typetorch/bits";
import { useBackend } from "@/store/accounts";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { playerColumns } from "@/features/typetorch/cards";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam, usePageParams } from "@/features/typetorch/view-link";
import { fmtAgo, fmtInt, fmtNum, fmtPct, plural } from "@/lib/format";
import { radius, space, useTheme, type Tone } from "@/theme";

type Results = Extract<ExperimentResult, { variants: unknown }>;
type Variant = Results["variants"][number];
type ListItem = Extract<ExperimentResult, { experiment: null }>["experiments"][number];

const METRICS: Record<string, string> = {
	returned: "came back (2+ days)",
	payers: "paid",
	playtime: "playtime per player",
	robux: "Robux per player",
	sessions: "sessions per player",
};

/** What newer servers add to a comparison (web lib/types.ts Comparison): p-values, the detectable effect, days to tell. */
type ComparisonRow = Comparison & { pValue?: number; pAdjusted?: number; mde?: number | null; mdeLift?: number | null; days?: number | null };

/** "±12% (±0.4 min)": the minimum detectable effect, relative when the control's value isn't 0. */
function mdeText(c: ComparisonRow): string {
	if (c.mde === undefined) return "–";
	if (c.mde === null || !Number.isFinite(c.mde)) return "no players";
	const absolute = `±${fmtMetric(c.metric, c.mde)}`;
	return c.mdeLift === null || c.mdeLift === undefined ? absolute : `±${fmtPct(c.mdeLift, 0)} (${absolute})`;
}

/** "now", "~3 days", "over a year" or "–". */
function daysText(days: number | null | undefined): string {
	if (days === null || days === undefined) return "–";
	if (days === 0) return "now";
	if (days > 365) return "over a year";
	return days < 1 ? "under a day" : `~${fmtInt(Math.ceil(days))} days`;
}

const liftText = (c: ComparisonRow) => (c.lift === null ? "–" : `${c.lift > 0 ? "+" : ""}${fmtPct(c.lift)}`);

/** The web's COMPARISON_COLUMNS (DataTable `experiment-comparisons`). */
function comparisonColumns(p: ReturnType<typeof useTheme>): DataColumn<ComparisonRow>[] {
	return [
		{ id: "words", header: "In words", width: 200, accessor: (c) => c.words, cell: (c) => <Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>{c.words}</Txt> },
		{ id: "metric", header: "Metric", type: "enum", width: 110, accessor: (c) => c.metric, format: (v) => METRICS[v as string] ?? String(v) },
		{ id: "control", header: "Control", type: "number", width: 80, accessor: (c) => c.control, format: (_v, c) => fmtMetric(c.metric, c.control) },
		{ id: "value", header: "Variant", type: "number", width: 80, accessor: (c) => c.value, format: (_v, c) => fmtMetric(c.metric, c.value) },
		{ id: "lift", header: "Lift", type: "number", width: 70, accessor: (c) => c.lift, format: (_v, c) => liftText(c) },
		{
			id: "sure",
			header: "Sure",
			type: "number",
			width: 90,
			accessor: (c) => c.sure,
			format: (_v, c) => fmtPct(c.sure, 0),
			cell: (c) => (
				<View style={{ gap: 2 }}>
					<Txt variant="small" color={p.foreground}>
						{fmtPct(c.sure, 0)}
					</Txt>
					<ShareBar share={c.sure} tone={c.sure >= 0.95 ? "good" : c.sure >= 0.8 ? "warning" : "muted"} width={70} />
				</View>
			),
		},
		{ id: "mde", header: "Can detect", title: "The smallest true difference these group sizes find 80% of the time (5%, corrected over the variants)", type: "number", width: 110, accessor: (c) => c.mdeLift ?? null, format: (_v, c) => mdeText(c) },
		{ id: "days", header: "Time to tell", title: "At the range's traffic: days more until the observed difference would be sure (or now)", type: "number", width: 90, accessor: (c) => c.days ?? null, format: (_v, c) => daysText(c.days) },
		{
			id: "method",
			header: "Test",
			width: 160,
			accessor: (c) => `${c.method}${c.pValue !== undefined && c.pAdjusted !== undefined && c.pAdjusted !== c.pValue ? `; p ${fmtNum(c.pValue, 4)}, corrected ${fmtNum(c.pAdjusted, 4)}` : ""}`,
			defaultHidden: true,
		},
	];
}

function fmtMetric(metric: string, value: number): string {
	if (metric === "returned" || metric === "payers") return fmtPct(value);
	if (metric === "playtime") return `${fmtNum(value, 1)} min`;
	return fmtNum(value);
}

type ExperimentState = "running" | "settled" | "stopped";
interface WeightView {
	state: ExperimentState;
	settledOn?: string;
	shares: { label: string; share: number }[];
	note: string;
}

/** The web's weightView: the split of one experiment from its override, the variant count and the names seen. */
function weightView(override: ExperimentOverride | undefined, source: ExperimentOverrides["source"] | undefined, variantCount: number | null, names: string[]): WeightView {
	const count = variantCount ?? (names.length || null);
	const positional = (i: number) => `variant ${i + 1}${i === 0 ? " (control)" : ""}`;
	const even = (why: string): WeightView => {
		if (!count) return { state: "running", shares: [], note: `${why} The backend doesn't know this experiment's variants, so it can't show the split.` };
		const labels = names.length === count ? [...names].sort() : Array.from({ length: count }, (_, i) => positional(i));
		return { state: "running", shares: labels.map((label) => ({ label, share: 1 / count })), note: `${why} The game splits players evenly over its ${count} variants.` };
	};
	if (!override) return even(source === "unreadable" ? "The server's settings file can't be read, so overrides are unknown." : "No override on this server: the game's default weights apply.");
	if (override.active === false) return { state: "stopped", shares: [{ label: "variant 1 (control)", share: 1 }], note: "Stopped: everyone gets the first variant (the control), and events are not stamped." };
	if (override.variant) return { state: "settled", settledOn: override.variant, shares: [{ label: override.variant, share: 1 }], note: `Settled: everyone gets ${override.variant}.` };
	const weights = override.weights;
	if (weights && weights.length) {
		const total = weights.reduce((s, w) => s + w, 0);
		if (count !== null && weights.length !== count) return even(`The override's ${weights.length} weights don't fit the ${count} variants, so the game ignores them.`);
		if (total > 0) return { state: "running", shares: weights.map((w, i) => ({ label: positional(i), share: w / total })), note: "Weights from the override, in the game's variant order." };
	}
	return even("The override sets no weights.");
}

interface ExperimentRow {
	experiment: string;
	variants: string[];
	players: number;
	forced: number;
	variantCount: number | null;
	weights: WeightView;
}

function experimentRows(list: ListItem[], overrides?: ExperimentOverrides): ExperimentRow[] {
	const by = new Map<string, Omit<ExperimentRow, "weights">>();
	for (const e of list) {
		const row = by.get(e.experiment) ?? { experiment: e.experiment, variants: [], players: 0, forced: 0, variantCount: null };
		if (e.variant && !row.variants.includes(e.variant)) row.variants.push(e.variant);
		row.players += e.players;
		row.forced += e.forced ?? 0;
		if (typeof e.variantCount === "number") row.variantCount = Math.max(row.variantCount ?? 0, e.variantCount);
		by.set(e.experiment, row);
	}
	return [...by.values()].map((r) => ({ ...r, weights: weightView(overrides?.experiments[r.experiment], overrides?.source, r.variantCount, r.variants) }));
}

const STATE_TONE: Record<ExperimentState, Tone> = { running: "muted", settled: "brand", stopped: "warning" };

export default function ExperimentsScreen() {
	return <TTScreen title="Experiments">{({ backendId }) => <Experiments backendId={backendId} />}</TTScreen>;
}

function Experiments({ backendId }: { backendId: string }) {
	// The web's URL parameters: scope, experiment, assigned + assignedVariant (the players sheet).
	const [scopeParam, setScope] = usePageParam("scope", "player");
	const scope: "player" | "server" = scopeParam === "server" ? "server" : "player";
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Per-variant numbers and how sure each difference is. Per player: the variant in each row's exp. Per server: kernel A/B pins.</Note>
			<Segmented
				options={[
					{ value: "player", label: "Per player" },
					{ value: "server", label: "Per server" },
				]}
				value={scope}
				onChange={setScope}
			/>
			{scope === "server" ? <ServerScope backendId={backendId} /> : <PlayerScope backendId={backendId} />}
		</>
	);
}

function ServerScope({ backendId }: { backendId: string }) {
	const results = useTTAnalytics(backendId, "experiment", { scope: "server" });
	return <QueryState q={results}>{(data) => (data.experiment === null ? null : <ResultsView data={data} />)}</QueryState>;
}

function PlayerScope({ backendId }: { backendId: string }) {
	const list = useTTAnalytics(backendId, "experiment", {});
	const overrides = useTTQuery(backendId, ["experiment-overrides"], (api, s) => api.experimentOverrides(s), { retry: false });
	const [params, setParams] = usePageParams();
	const picked = params.experiment ?? "";
	const setPicked = (v: string) => setParams({ experiment: v });
	const assigned: { experiment: string; variant: string } | null = params.assigned ? { experiment: params.assigned, variant: params.assignedVariant ?? "" } : null;
	const setAssigned = (a: { experiment: string; variant: string } | null) => setParams({ assigned: a?.experiment ?? null, assignedVariant: a?.variant || null });
	const names = list.data && list.data.experiment === null ? [...new Set(list.data.experiments.map((e) => e.experiment))] : [];
	const name = picked || names[0] || "";
	const override = overrides.data?.experiments[name];
	// The intended split for the sample ratio check: the override's weights while it runs on them.
	const weights = override && override.active !== false && !override.variant && override.weights?.length ? override.weights : undefined;
	const results = useTTAnalytics(backendId, "experiment", { experiment: name, scope: "player", ...(weights ? { weights } : {}) }, { enabled: Boolean(name) });
	const owner = useBackend(backendId).account?.role === "admin";
	const rows = useMemo(() => (list.data && list.data.experiment === null ? experimentRows(list.data.experiments, overrides.data) : []), [list.data, overrides.data]);
	const p = useTheme();
	const experimentColumns = useMemo(() => experimentListColumns(p), [p]);
	return (
		<QueryState q={list} isEmpty={(d) => d.experiment === null && d.experiments.length === 0} empty="No experiment rows in this range.">
			{() => (
				<>
					<Txt variant="label">Experiment</Txt>
					<Chips options={names.map((n) => ({ value: n, label: n }))} value={name} onChange={setPicked} />
					<QueryState q={results}>
						{(data) =>
							data.experiment === null ? null : (
								<>
									<ResultsView
										data={data}
										selectedVariant={assigned?.experiment === data.experiment ? assigned.variant : undefined}
										onOpenVariant={(v) => setAssigned({ experiment: data.experiment as string, variant: v })}
									/>
									{owner ? <ExperimentControl key={data.experiment} backendId={backendId} experiment={data.experiment} variants={gameVariants(data)} {...(override ? { override } : {})} /> : null}
								</>
							)
						}
					</QueryState>
					{assigned ? <AssignedPlayers backendId={backendId} experiment={assigned.experiment} variant={assigned.variant} onVariant={(v) => setAssigned({ ...assigned, variant: v })} onClose={() => setAssigned(null)} /> : null}
					<Panel
						title="Experiments"
						note={`Every experiment with assignment rows in this range, its state and weights. Tap one for the players in it. ${
							overrides.data?.source === "settings-file"
								? "States and weights come from this server's copy of the settings (data/settings.json)."
								: "This server holds no copy of the game's settings, so the overrides in the game's signed settings are not shown here."
						}`}
					>
						<DataTable
							id="experiments-list"
							label="Experiments"
							columns={experimentColumns}
							data={rows}
							rowId={(e) => e.experiment}
							isRowSelected={(e) => assigned?.experiment === e.experiment}
							onRowPress={(e) => setAssigned(assigned?.experiment === e.experiment && !assigned.variant ? null : { experiment: e.experiment, variant: "" })}
						/>
					</Panel>
				</>
			)}
		</QueryState>
	);
}

/** The web's EXPERIMENT_COLUMNS (DataTable `experiments-list`): state, weights with their note, variants seen, counts. */
function experimentListColumns(p: ReturnType<typeof useTheme>): DataColumn<ExperimentRow>[] {
	return [
		{ id: "experiment", header: "Experiment", width: 130, accessor: (e) => e.experiment, cell: (e) => <Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>{e.experiment}</Txt> },
		{
			id: "state",
			header: "State",
			type: "enum",
			width: 110,
			accessor: (e) => e.weights.state,
			cell: (e) => <Badge label={e.weights.state === "settled" ? `settled on ${e.weights.settledOn}` : e.weights.state} tone={STATE_TONE[e.weights.state]} />,
		},
		{
			id: "weights",
			header: "Weights",
			width: 200,
			searchable: false,
			accessor: (e) => e.weights.shares.map((x) => `${x.label} ${fmtPct(x.share, 0)}`).join(", "),
			cell: (e) => (
				<View style={{ gap: 4 }}>
					{e.weights.shares.length ? (
						e.weights.shares.map((x) => (
							<View key={x.label} style={{ gap: 2 }}>
								<View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6 }}>
									<Txt variant="small" color={p.foreground} numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
										{x.label}
									</Txt>
									<Txt variant="small" style={{ fontSize: 11 }}>
										{fmtPct(x.share, 0)}
									</Txt>
								</View>
								<ShareBar share={x.share} tone="brand" />
							</View>
						))
					) : (
						<Txt variant="small">Weights unknown</Txt>
					)}
					<Txt variant="small" style={{ fontSize: 10 }}>
						{e.weights.note}
					</Txt>
				</View>
			),
		},
		{ id: "variants", header: "Variants seen", width: 120, accessor: (e) => e.variants.join(", ") },
		{ id: "players", header: "Assigned", title: "Players with an assignment row in the range, per variant (a player in two variants counts twice)", type: "number", width: 76, accessor: (e) => e.players, cell: (e) => fmtInt(e.players) },
		{ id: "forced", header: "Forced", title: "Players whose variant the settings forced, in the range", type: "number", width: 66, accessor: (e) => e.forced, cell: (e) => fmtInt(e.forced) },
	];
}

function ResultsView({ data, onOpenVariant, selectedVariant }: { data: Results; onOpenVariant?: (variant: string) => void; selectedVariant?: string | undefined }) {
	const p = useTheme();
	const comparisons = useMemo(() => comparisonColumns(p), [p]);
	if (!data.variants.length) return <Txt variant="muted">No player in this experiment in this range.</Txt>;
	const rate = (r: { rate: number; count: number }) => `${fmtPct(r.rate)} (${fmtInt(r.count)})`;
	return (
		<>
			<Panel
				title={data.scope === "server" ? "Per server: pinned artifacts vs unpinned servers" : `Variants of ${data.experiment}`}
				note={`${data.control ? `Compared with the control variant "${data.control}".` : "No control variant."}${data.mixedPlayers ? ` ${plural(data.mixedPlayers, "player")} seen in more than one variant are left out.` : ""}${onOpenVariant ? " Tap a variant for its players." : ""}`}
			>
				<DataTable<Variant>
					id="experiment-variants"
					label={`Variants of ${data.experiment}`}
					search={false}
					columns={[
						{
							id: "variant",
							header: "Variant",
							width: 120,
							accessor: (v) => v.variant,
							filter: false,
							cell: (v) => (
								<View style={{ gap: 2 }}>
									<Txt variant="small" color={selectedVariant === v.variant ? p.brand : p.foreground} style={{ fontWeight: "600" }}>
										{v.variant}
									</Txt>
									{v.variant === data.control ? <Badge label="control" /> : null}
								</View>
							),
						},
						{ id: "players", header: "Players", width: 74, accessor: (v) => v.players, cell: (v) => fmtInt(v.players) },
						{ id: "returned", header: "Came back", width: 104, accessor: (v) => v.returned.rate, cell: (v) => rate(v.returned) },
						{ id: "payers", header: "Paid", width: 94, accessor: (v) => v.payers.rate, cell: (v) => rate(v.payers) },
						{ id: "playtime", header: "Playtime / player", width: 94, accessor: (v) => v.playtimeMinutes, cell: (v) => `${fmtNum(v.playtimeMinutes, 1)} min` },
						{ id: "robux", header: "Robux / player", width: 84, accessor: (v) => v.robuxPerPlayer, cell: (v) => fmtNum(v.robuxPerPlayer) },
						{ id: "sessions", header: "Sessions / player", width: 84, accessor: (v) => v.sessionsPerPlayer, cell: (v) => fmtNum(v.sessionsPerPlayer) },
					]}
					data={data.variants}
					rowId={(v) => v.variant}
					{...(selectedVariant ? { isRowSelected: (v: Variant) => v.variant === selectedVariant } : {})}
					{...(onOpenVariant ? { onRowPress: (v: Variant) => onOpenVariant(v.variant) } : {})}
				/>
			</Panel>
			{data.assignment ? <SampleRatio check={data.assignment} /> : null}
			<Panel
				title="How sure"
				note={`Each variant against the control: two-proportion test for shares, bootstrap (or Welch) for averages.${data.variants.length > 2 ? ` With ${data.variants.length - 1} variants against the control, "sure" is Holm-corrected so more variants don't mean more lucky wins.` : ""}${data.forcedPlayers ? ` ${plural(data.forcedPlayers, "forced player")} left out (they didn't get a random variant).` : ""} Can detect and time to tell assume 80% power at the range's traffic.`}
			>
				{data.comparisons.length ? (
					<DataTable id="experiment-comparisons" label="Comparisons with the control" columns={comparisons} data={data.comparisons as ComparisonRow[]} rowId={(c) => `${c.variant}-${c.metric}`} density="compact" />
				) : (
					<Txt variant="muted">Nothing to compare yet: it needs a control and at least one other variant with players.</Txt>
				)}
			</Panel>
		</>
	);
}

/**
 * The sample ratio check: a loud warning when players didn't land where the split says (the numbers can't be trusted),
 * else one quiet line. Each variant's players against the share it should get.
 */
export function SampleRatio({ check }: { check: AssignmentCheck }) {
	const srm = check.srm;
	const total = check.variants.reduce((s, v) => s + v.players, 0);
	const weightTotal = (check.weights ?? []).reduce((s, w) => s + w, 0);
	const rows = check.variants.map((v, i) => `${v.variant} ${fmtInt(v.players)} (${fmtPct(total ? v.players / total : 0, 1)}${check.weights && weightTotal ? `, should be ${fmtPct((check.weights[i] ?? 0) / weightTotal, 1)}` : ""})`);
	const split = check.weightsFrom === "settings" ? "the settings' weights" : "an even split";
	if (srm?.mismatch) {
		return (
			<Callout tone="critical" title="Sample ratio mismatch: don't trust these numbers">
				<Txt variant="small">
					Players didn't land where {split} says: {rows.join(", ")}. Chi-square p = {srm.pValue < 0.0001 ? srm.pValue.toExponential(1) : fmtNum(srm.pValue, 4)} (a fair split gets this less than 1 time in 1000). Look for a variant that crashes or loses its events, a bug in when the game asks for the variant, bots, or a split changed in this range.
				</Txt>
				{check.note ? <Txt variant="small">{check.note}</Txt> : null}
			</Callout>
		);
	}
	return (
		<Note>
			{srm ? `Split check: ${srm.enough ? `players per variant fit ${split} (p = ${fmtNum(srm.pValue, 3)})` : "too few players to check the split yet"}. ${rows.join(", ")}.` : `Split check: ${check.note ?? "not run."}`}
			{srm && check.note ? ` ${check.note}` : ""}
		</Note>
	);
}

/**
 * The experiment's variants for the controls: in the game's order when the rows carry it (`known`), else by name (then
 * weights are labelled by position: only the game knows its order).
 */
export function gameVariants(data: Results): { names: string[]; known: boolean } {
	const check = data.assignment;
	if (check && check.order === "game" && check.variants.every((v) => v.index !== null && !v.variant.startsWith("("))) return { names: check.variants.map((v) => v.variant), known: true };
	return { names: data.variants.map((v) => v.variant).sort(), known: false };
}

const ACTION_LABEL: Record<ExperimentChangeRequest["action"], string> = { start: "Start", stop: "Stop", split: "Change split", settle: "Settle", clear: "Clear" };

/** A command in a box with a copy button. */
function CommandBox({ label, command }: { label: string; command: string }) {
	const p = useTheme();
	return (
		<View style={{ gap: 4 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Txt variant="small" style={{ flex: 1 }}>
					{label}
				</Txt>
				<CopyButton text={command} />
			</View>
			<View style={{ borderWidth: 1, borderColor: p.border, backgroundColor: p.muted, borderRadius: radius.sm, padding: space.sm }}>
				<Txt variant="mono" selectable style={{ fontSize: 11 }}>
					{command}
				</Txt>
			</View>
		</View>
	);
}

/**
 * Owners: start, stop, re-split, settle or clear the experiment. The split is in the game's signed settings and the
 * signing keys stay on the owners' machines, so this prepares the change (checked and audited by the server) and hands
 * over the exact command that applies it.
 */
function ExperimentControl({ backendId, experiment, variants, override }: { backendId: string; experiment: string; variants: { names: string[]; known: boolean }; override?: ExperimentOverride }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const count = variants.names.length;
	const [weights, setWeights] = useState<string[]>(() => Array.from({ length: count }, (_, i) => String(override?.weights && override.weights.length === count ? override.weights[i] : 1)));
	const [settleOn, setSettleOn] = useState(variants.names[0] ?? "");
	const prepare = useMutation({
		mutationFn: (change: ExperimentChangeRequest) => {
			if (!api) throw new Error("This backend isn't connected.");
			return api.experimentChange(experiment, change);
		},
	});
	const label = (i: number) => (variants.known ? (variants.names[i] ?? `variant ${i + 1}`) : `variant ${i + 1}`) + (i === 0 ? " (control)" : "");
	const parsed = weights.map((w) => Number(w));
	const weightsOk = parsed.length > 0 && parsed.every((w) => Number.isFinite(w) && w >= 0) && parsed.some((w) => w > 0) && weights.every((w) => w.trim() !== "");
	const run = (change: ExperimentChangeRequest) => prepare.mutate(change);
	const listed = variants.known ? { variants: variants.names } : {};
	const prepared: PreparedExperimentChange | undefined = prepare.data;
	return (
		<Panel
			title="Run it"
			note="Start, stop, change the split or settle on a winner. The split lives in the game's signed settings and only your keys sign them (they never reach this server), so this gives you the command to run in the game's folder; servers apply it within seconds, no deploy."
		>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
				<Button title="Start" small onPress={() => run({ action: "start" })} disabled={prepare.isPending} />
				<Button title="Stop" small onPress={() => run({ action: "stop" })} disabled={prepare.isPending} />
				<Button title="Clear override" small onPress={() => run({ action: "clear" })} disabled={prepare.isPending} />
			</View>
			{count > 0 ? (
				<View style={{ gap: space.sm }}>
					<Txt style={{ fontWeight: "600" }}>Split</Txt>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
						{weights.map((w, i) => (
							<View key={i} style={{ width: 120 }}>
								<Field label={label(i)} keyboardType="decimal-pad" value={w} onChangeText={(t) => setWeights((list) => list.map((x, j) => (j === i ? t : x)))} />
							</View>
						))}
					</View>
					<Button title="Change split" small variant="primary" onPress={() => run({ action: "split", weights: parsed, ...listed })} disabled={!weightsOk || prepare.isPending} style={{ alignSelf: "flex-start" }} />
					{variants.known ? null : <Note>These rows don't carry the game's variant order (framework 0.7.1+ adds it): weights go in the order the game lists its variants.</Note>}
				</View>
			) : null}
			{count > 0 ? (
				<View style={{ gap: space.sm }}>
					<Txt variant="small">Everyone gets</Txt>
					<Chips options={variants.names.map((n) => ({ value: n, label: n }))} value={settleOn} onChange={setSettleOn} />
					<Button title="Settle" small onPress={() => run({ action: "settle", variant: settleOn, variants: variants.names })} disabled={!settleOn || prepare.isPending} style={{ alignSelf: "flex-start" }} />
				</View>
			) : null}
			{prepare.isError ? (
				<Txt variant="small" color={p.destructive}>
					{(prepare.error as Error).message}
				</Txt>
			) : null}
			{prepared ? (
				<View style={{ gap: space.sm, borderWidth: 1, borderColor: p.border, borderRadius: radius.md, padding: space.sm }}>
					<Txt style={{ fontWeight: "600" }}>
						{ACTION_LABEL[prepared.action]} {prepared.experiment}: {prepared.effect}
					</Txt>
					<CommandBox label="Run in the game's folder" command={prepared.command} />
					<CommandBox label="See the change first (writes nothing)" command={prepared.dryRun} />
					{prepared.notes.map((n) => (
						<Note key={n}>{n}</Note>
					))}
				</View>
			) : null}
		</Panel>
	);
}

const HOW: Record<ExperimentPlayer["how"], string> = { random: "random", forced: "forced", unknown: "before range" };

function AssignedPlayers({ backendId, experiment, variant, onVariant, onClose }: { backendId: string; experiment: string; variant: string; onVariant(v: string): void; onClose(): void }) {
	const { state, apiFilters } = useTTFilters(backendId);
	const q = useTTQuery(backendId, ["experiment-players", experiment, apiFilters, variant], (api, s) => api.experimentPlayers(experiment, apiFilters, variant ? { variant } : {}, s));
	const columns = useMemo<DataColumn<ExperimentPlayer>[]>(
		() => [
			...playerColumns<ExperimentPlayer>(backendId),
			{ id: "variant", header: "Variant", type: "enum", width: 100, accessor: (x) => x.variant, format: (_v, x) => `${x.variant}${x.mixed ? " (mixed)" : ""}` },
			{ id: "how", header: "How", type: "enum", width: 96, accessor: (x) => x.how, format: (v) => HOW[v as ExperimentPlayer["how"]] ?? String(v) },
			{ id: "assignedAt", header: "Assigned", type: "date", width: 110, accessor: (x) => x.assignedAt ?? x.firstAt, format: (_v, x) => (x.assignedAt ? fmtAgo(x.assignedAt) : `seen ${fmtAgo(x.firstAt)}`) },
			{ id: "lastAt", header: "Last seen", type: "date", width: 100, accessor: (x) => x.lastAt, format: (_v, x) => fmtAgo(x.lastAt) },
			{ id: "events", header: "Events", type: "number", width: 70, accessor: (x) => x.events, cell: (x) => fmtInt(x.events) },
		],
		[backendId],
	);
	return (
		<Panel title={`Players in ${experiment}`} note={`${describeRange(state)}, under the page's filters.`} right={<Button title="Close" small variant="ghost" onPress={onClose} />}>
			<QueryState q={q} rows={3}>
				{(d) => (
					<View style={{ gap: space.sm }}>
						{d.variants.length ? (
							<Chips
								options={[{ value: "", label: `all (${fmtInt(d.variants.reduce((s, v) => s + v.players, 0))})` }, ...d.variants.map((v) => ({ value: v.variant, label: `${v.variant} (${fmtInt(v.players)})` }))]}
								value={variant}
								onChange={onVariant}
							/>
						) : null}
						{d.players.length ? (
							<>
								<DataTable
									id="experiment-players"
									label={`Players in ${experiment}`}
									columns={columns}
									data={d.players}
									rowId={(x) => `${x.pid}:${x.variant}`}
									onRowPress={(x) => openPlayer(backendId, x.pid)}
									defaultSort={[{ id: "lastAt", desc: true }]}
									density="compact"
								/>
								<Note>
									{d.more ? `The ${fmtInt(d.players.length)} most recently seen, of ${fmtInt(d.total)}. ` : ""}
									How comes from the assignment rows in the range: random, forced by the settings, or before the range when only their stamped events are in it.
								</Note>
							</>
						) : (
							<Txt variant="muted">{variant ? `No player in variant ${variant} in this range.` : "No player in this experiment in this range."}</Txt>
						)}
					</View>
				)}
			</QueryState>
		</Panel>
	);
}
