/**
 * Experiments: per-variant numbers and how sure each difference is (query `experiment`), every experiment with its state
 * and weights (read-only, GET /v1/experiments), and the players in an experiment or variant (GET /v1/experiments/<e>/players).
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { ExperimentOverride, ExperimentOverrides, ExperimentPlayer, ExperimentResult } from "@/api/tt/types";
import { Badge, Button, Chips, List, Segmented, Txt } from "@/components/ui";
import { NamedPlayerRow, Note, Panel, QueryState, ShareBar } from "@/features/typetorch/bits";
import { DataTable } from "@/features/typetorch/table";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtInt, fmtNum, fmtPct, plural } from "@/lib/format";
import { space, useTheme, type Tone } from "@/theme";

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
	const [scope, setScope] = useState<"player" | "server">("player");
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
	const [picked, setPicked] = useState("");
	const [assigned, setAssigned] = useState<{ experiment: string; variant: string } | null>(null);
	const names = list.data && list.data.experiment === null ? [...new Set(list.data.experiments.map((e) => e.experiment))] : [];
	const name = picked || names[0] || "";
	const results = useTTAnalytics(backendId, "experiment", { experiment: name, scope: "player" }, { enabled: Boolean(name) });
	const rows = useMemo(() => (list.data && list.data.experiment === null ? experimentRows(list.data.experiments, overrides.data) : []), [list.data, overrides.data]);
	return (
		<QueryState q={list} isEmpty={(d) => d.experiment === null && d.experiments.length === 0} empty="No experiment rows in this range.">
			{() => (
				<>
					<Txt variant="label">Experiment</Txt>
					<Chips options={names.map((n) => ({ value: n, label: n }))} value={name} onChange={setPicked} />
					<QueryState q={results}>
						{(data) =>
							data.experiment === null ? null : (
								<ResultsView
									data={data}
									selectedVariant={assigned?.experiment === data.experiment ? assigned.variant : undefined}
									onOpenVariant={(v) => setAssigned({ experiment: data.experiment as string, variant: v })}
								/>
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
						<List>
							{rows.map((e) => (
								<ExperimentItem key={e.experiment} row={e} selected={assigned?.experiment === e.experiment} onPress={() => setAssigned(assigned?.experiment === e.experiment && !assigned.variant ? null : { experiment: e.experiment, variant: "" })} />
							))}
						</List>
					</Panel>
				</>
			)}
		</QueryState>
	);
}

function ExperimentItem({ row, selected, onPress }: { row: ExperimentRow; selected: boolean; onPress(): void }) {
	const p = useTheme();
	const w = row.weights;
	return (
		<Pressable onPress={onPress} android_ripple={{ color: p.accent }} style={{ padding: space.md, gap: 6, backgroundColor: selected ? p.muted : undefined }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
				<Txt style={{ fontWeight: "600", flex: 1 }} numberOfLines={1}>
					{row.experiment}
				</Txt>
				<Badge label={w.state === "settled" ? `settled on ${w.settledOn}` : w.state} tone={STATE_TONE[w.state]} />
			</View>
			<Txt variant="small">
				{fmtInt(row.players)} assigned · {fmtInt(row.forced)} forced · seen: {row.variants.join(", ") || "–"}
			</Txt>
			{w.shares.length ? (
				w.shares.map((s) => (
					<View key={s.label} style={{ gap: 2 }}>
						<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
							<Txt variant="small" color={p.foreground} numberOfLines={1} style={{ flex: 1 }}>
								{s.label}
							</Txt>
							<Txt variant="small">{fmtPct(s.share, 0)}</Txt>
						</View>
						<ShareBar share={s.share} tone="brand" />
					</View>
				))
			) : (
				<Txt variant="small">Weights unknown</Txt>
			)}
			<Txt variant="small" style={{ fontSize: 11 }}>
				{w.note}
			</Txt>
		</Pressable>
	);
}

function ResultsView({ data, onOpenVariant, selectedVariant }: { data: Results; onOpenVariant?: (variant: string) => void; selectedVariant?: string | undefined }) {
	const p = useTheme();
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
			<Panel title="How sure" note="Each variant against the control: two-proportion test for shares, bootstrap (or Welch) for averages.">
				{data.comparisons.length ? (
					<List>
						{data.comparisons.map((c) => (
							<View key={`${c.variant}-${c.metric}`} style={{ paddingVertical: 8, paddingHorizontal: space.md, gap: 3 }}>
								<Txt style={{ fontWeight: "600" }}>{c.words}</Txt>
								<Txt variant="small">
									{METRICS[c.metric] ?? c.metric}: {fmtMetric(c.metric, c.control)} → {fmtMetric(c.metric, c.value)}
									{c.lift === null ? "" : ` · lift ${c.lift > 0 ? "+" : ""}${fmtPct(c.lift)}`}
								</Txt>
								<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
									<View style={{ flex: 1 }}>
										<ShareBar share={c.sure} tone={c.sure >= 0.95 ? "good" : c.sure >= 0.8 ? "warning" : "muted"} />
									</View>
									<Txt variant="small">{fmtPct(c.sure, 0)} sure</Txt>
								</View>
								<Txt variant="small" style={{ fontSize: 11 }}>
									{c.method}
								</Txt>
							</View>
						))}
					</List>
				) : (
					<Txt variant="muted">Nothing to compare yet: it needs a control and at least one other variant with players.</Txt>
				)}
			</Panel>
		</>
	);
}

const HOW: Record<ExperimentPlayer["how"], string> = { random: "random", forced: "forced", unknown: "before range" };

function AssignedPlayers({ backendId, experiment, variant, onVariant, onClose }: { backendId: string; experiment: string; variant: string; onVariant(v: string): void; onClose(): void }) {
	const { state, apiFilters } = useTTFilters(backendId);
	const q = useTTQuery(backendId, ["experiment-players", experiment, apiFilters, variant], (api, s) => api.experimentPlayers(experiment, apiFilters, variant ? { variant } : {}, s));
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
								<List>
									{[...d.players]
										.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
										.map((x) => (
											<NamedPlayerRow
												key={`${x.pid}:${x.variant}`}
												backendId={backendId}
												row={x}
												detail={`${x.variant}${x.mixed ? " (mixed)" : ""} · ${HOW[x.how]} · ${x.assignedAt ? `assigned ${fmtAgo(x.assignedAt)}` : `seen ${fmtAgo(x.firstAt)}`} · last ${fmtAgo(x.lastAt)} · ${plural(x.events, "event")}`}
											/>
										))}
								</List>
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
