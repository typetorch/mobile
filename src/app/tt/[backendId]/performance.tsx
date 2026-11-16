/**
 * Performance: how the game runs on players' devices (frame rate, memory, ping; query `perf-client`) and on the servers
 * (TPS, physics FPS, memory, players; `perf-server`), over time, by device class / input / screen / branch / build, at
 * p10 / p50 / p90 / p99 (p90 and p99 on the bad side). Deploy marks on every chart (a tap on one in the list filters to its
 * build or compares before vs after), "vs previous period", live servers with their history, and builds compared side by
 * side (`perf-compare`). Possible problems are orange or red (src/api/tt/perf-thresholds.ts).
 */
import { useMemo, useState } from "react";
import { Pressable, Switch, View } from "react-native";

import { ApiError } from "@/api/backend";
import { change } from "@/api/tt/benchmarks";
import { previousPeriod, withPrevious, type PreviousPeriod } from "@/api/tt/compare";
import {
	AROUND_HOURS,
	bucketText,
	CLIENT_GROUPS,
	CLIENT_METRIC_KEYS,
	fmtMetric,
	GROUP_BY_LABELS,
	groupLabel,
	MARK_KINDS,
	MARK_STYLE,
	markDetails,
	markTitle,
	METRICS,
	PERCENTILE_HELP,
	PERCENTILES,
	percentileName,
	pivot,
	rangeMs,
	SERVER_GROUPS,
	SERVER_METRIC_KEYS,
	seriesOf,
	type ChartRow,
	type DeployMark,
	type Percentile,
	type PerfGroupBy,
	type PerfSeriesResult,
	type PerfServer,
} from "@/api/tt/perf";
import { absoluteFlag, thresholdText } from "@/api/tt/perf-thresholds";
import type { Filters } from "@/api/tt/types";
import { LineChart, type ChartSeries as LineSeries } from "@/charts/LineChart";
import { Button, Card, Chips, Dot, EmptyState, ErrorState, List, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { ChangeChip, MiniTable, Note, Panel, QueryState, type Column } from "@/features/typetorch/bits";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { CompareTable, flagColor, metricLabel } from "@/features/typetorch/perf-compare";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtInt, shortId } from "@/lib/format";
import { space, useTheme, type Palette } from "@/theme";

const STEP_MINUTES = [1, 5, 15, 60, 360, 1440];
const stepChoices = (spanMs: number) => STEP_MINUTES.filter((m) => m * 60_000 * 2 <= spanMs && spanMs / (m * 60_000) <= 400);
const windowBucketMs = (span: number) => (span <= 65 * 60_000 ? 60_000 : span <= 6.5 * 3_600_000 ? 300_000 : span <= 26 * 3_600_000 ? 3_600_000 : 86_400_000);
const seriesOptions = (by: PerfGroupBy, stepMinutes: number | undefined) => ({ by, maxGroups: 8, ...(stepMinutes ? { bucketMinutes: stepMinutes } : {}) });

/** A mark kind's color on the phone palette (the web's MARK_STYLE uses CSS variables). */
function markColor(p: Palette, kind: DeployMark["kind"]): string {
	switch (kind) {
		case "rollback":
			return p.destructive;
		case "kernel":
			return p.chart[3] ?? p.warning;
		case "backup":
			return p.chart[2] ?? p.warning;
		case "resign":
			return p.mutedForeground;
		case "promote":
			return p.chart[6] ?? p.warning;
		default:
			return p.chart[0] ?? p.warning;
	}
}

export default function PerformanceScreen() {
	return <TTScreen title="Performance">{({ backendId }) => <Performance backendId={backendId} />}</TTScreen>;
}

interface MarkProps {
	marks: DeployMark[];
}

function Performance({ backendId }: { backendId: string }) {
	const p = useTheme();
	const { state, apiFilters, set } = useTTFilters(backendId);
	const [by, setBy] = useState<PerfGroupBy>("none");
	const [pct, setPct] = useState<Percentile>("p50");
	const [step, setStep] = useState(0);
	const [showMarks, setShowMarks] = useState(true);
	const [markId, setMarkId] = useState("");
	const [compareOn, setCompareOn] = useState(false);
	const [cmp, setCmp] = useState<{ mode: "builds" | "around"; arts: string[]; around: string; hours: number }>({ mode: "builds", arts: [], around: "", hours: 24 });
	const range = useMemo(() => {
		const now = Math.ceil(Date.now() / 60_000) * 60_000;
		return rangeMs({ ...(apiFilters.from ? { from: apiFilters.from } : {}), ...(apiFilters.to ? { to: apiFilters.to } : {}) }, now);
	}, [apiFilters.from, apiFilters.to]);
	const span = range.to - range.from;
	const steps = stepChoices(span);
	const stepMinutes = steps.includes(step) ? step : undefined;
	const branch = typeof apiFilters.branch === "string" ? apiFilters.branch : undefined;
	const marksQ = useTTQuery(backendId, ["fleet", "marks", range.from, range.to, branch ?? ""], (api, s) => api.fleetMarks({ since: range.from, until: range.to, ...(branch ? { branch } : {}), limit: 1000 }, s), { retry: false });
	const allMarks = marksQ.data ?? [];
	const marks = showMarks ? allMarks : [];
	const selected = allMarks.find((m) => m.id === markId);
	const seqOf = useMemo(() => new Map(allMarks.filter((m) => m.artifact && m.seq !== null && m.kind !== "backup").map((m) => [m.artifact as string, m.seq as number])), [allMarks]);
	const before = useMemo(() => previousPeriod(state), [state]);
	const period = compareOn ? before : undefined;
	const markProps: MarkProps = { marks };
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>
				Frame rate, memory and ping on players' devices, and TPS and memory on the servers, {describeRange(state)}. p90 and p99 are on the bad side (p99 is the worst case); p10 is the low end.
			</Note>
			<View style={{ gap: space.sm }}>
				<Txt variant="label">Group by</Txt>
				<Chips options={CLIENT_GROUPS.map((g) => ({ value: g, label: g === "none" ? "Everything" : GROUP_BY_LABELS[g] }))} value={by} onChange={setBy} />
				<Txt variant="label">Percentile</Txt>
				<Segmented options={PERCENTILES.map((x) => ({ value: x, label: x }))} value={pct} onChange={setPct} />
				<Note>{PERCENTILE_HELP[pct]}</Note>
				<Txt variant="label">Chart step</Txt>
				<Chips options={[{ value: 0, label: `auto (${bucketText(windowBucketMs(span))})` }, ...steps.map((m) => ({ value: m, label: bucketText(m * 60_000) }))]} value={stepMinutes ?? 0} onChange={setStep} />
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
					<Switch value={compareOn} onValueChange={setCompareOn} disabled={!before} />
					<Txt variant="small" style={{ flex: 1 }}>
						vs previous period: change chips per metric and, without a grouping, the previous period as a dashed line
					</Txt>
				</View>
			</View>
			<MarkLegend marks={allMarks} error={marksQ.error} shown={showMarks} onToggle={() => setShowMarks((s) => !s)} selected={markId} onPick={(m) => setMarkId(m.id === markId ? "" : m.id)} />
			{selected ? (
				<Card style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: markColor(p, selected.kind) }}>
					<Txt style={{ fontWeight: "600" }}>{markTitle(selected)}</Txt>
					<Txt variant="small">{markDetails(selected).join(" · ")}</Txt>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
						{selected.artifact ? (
							<Button title={apiFilters.art === selected.artifact ? "Filtered to this build" : "Filter to this build"} small variant="brand" disabled={apiFilters.art === selected.artifact} onPress={() => set({ art: selected.artifact as string })} />
						) : null}
						<Button title="Before vs after" small onPress={() => setCmp((c) => ({ ...c, mode: "around", around: selected.id }))} />
						<Button
							title="Clear"
							small
							variant="ghost"
							onPress={() => {
								if (apiFilters.art === selected.artifact) set({ art: undefined });
								setMarkId("");
							}}
						/>
					</View>
				</Card>
			) : null}
			<ClientSection backendId={backendId} by={by} pct={pct} filters={apiFilters} stepMinutes={stepMinutes} period={period} {...markProps} />
			<ServerSection backendId={backendId} by={by} pct={pct} filters={apiFilters} stepMinutes={stepMinutes} period={period} {...markProps} />
			<LiveServers backendId={backendId} branch={branch} since={range.from} {...markProps} />
			<CompareSection backendId={backendId} filters={apiFilters} marks={allMarks} seqOf={seqOf} cmp={cmp} setCmp={setCmp} />
		</>
	);
}

function MarkLegend({ marks, error, shown, onToggle, selected, onPick }: { marks: DeployMark[]; error: unknown; shown: boolean; onToggle(): void; selected: string; onPick(m: DeployMark): void }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	const counts = MARK_KINDS.map((kind) => ({ kind, n: marks.filter((m) => m.kind === kind).length })).filter((c) => c.n > 0);
	return (
		<Panel title="Marks" right={marks.length ? <Button title={shown ? "Hide on charts" : "Show on charts"} small variant="ghost" onPress={onToggle} /> : undefined}>
			{error ? (
				<Note>{error instanceof ApiError && error.notFound ? "Not on this backend (the fleet part is off, or it is older)." : "Couldn't load the marks."}</Note>
			) : counts.length ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
					{counts.map((c) => (
						<View key={c.kind} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
							<View style={{ width: 3, height: 12, backgroundColor: markColor(p, c.kind) }} />
							<Txt variant="small">
								{c.n} {MARK_STYLE[c.kind].label.toLowerCase()}
								{c.n === 1 ? "" : "s"}
							</Txt>
						</View>
					))}
				</View>
			) : (
				<Note>None in this range.</Note>
			)}
			{marks.length ? (
				<>
					<Button title={open ? "Hide the list" : `Pick a mark (${marks.length})`} small variant="ghost" onPress={() => setOpen((o) => !o)} style={{ alignSelf: "flex-start" }} />
					{open ? (
						<List>
							{[...marks]
								.reverse()
								.slice(0, 60)
								.map((m) => (
									<Pressable key={m.id} onPress={() => onPick(m)} style={{ paddingVertical: 7, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: m.id === selected ? p.muted : undefined }}>
										<View style={{ width: 3, height: 26, backgroundColor: markColor(p, m.kind) }} />
										<View style={{ flex: 1 }}>
											<Txt numberOfLines={1}>{markTitle(m)}</Txt>
											<Txt variant="small" numberOfLines={1}>
												{m.time.slice(5, 16).replace("T", " ")} · {markDetails(m).join(" · ")}
											</Txt>
										</View>
									</Pressable>
								))}
						</List>
					) : null}
				</>
			) : null}
		</Panel>
	);
}

// Sections ------------------------------------------------------------------------------------------------------------------

interface SectionProps extends MarkProps {
	backendId: string;
	by: PerfGroupBy;
	pct: Percentile;
	filters: Filters;
	stepMinutes: number | undefined;
	period: PreviousPeriod | undefined;
}

interface PreviousSeries {
	result: PerfSeriesResult;
	shiftMs: number;
}

function usePrevious(backendId: string, name: "perf-client" | "perf-server", options: object, period: PreviousPeriod | undefined): PreviousSeries | undefined {
	const q = useTTAnalytics(backendId, name, options, { enabled: period !== undefined, ...(period ? { filters: period.filters } : {}) });
	return period && q.data ? { result: q.data, shiftMs: period.shiftMs } : undefined;
}

function PeriodTiles({ result, previous, metricKeys, pct }: { result: PerfSeriesResult; previous: PerfSeriesResult; metricKeys: readonly string[]; pct: Percentile }) {
	return (
		<StatGrid>
			{metricKeys.map((k) => {
				const now = result.overall.metrics[k]?.[pct] ?? null;
				const then = previous.overall.metrics[k]?.[pct] ?? null;
				return <Stat key={k} label={`${metricLabel(result.side, k)}, ${percentileName(pct)}`} value={fmtMetric(k, now)} sub={<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Txt variant="small">before: {fmtMetric(k, then)}</Txt><ChangeChip change={change(now, then, !(METRICS[k]?.higherIsBetter ?? true))} /></View>} />;
			})}
		</StatGrid>
	);
}

/** One metric over time: a line per group (or the one line, plus the previous period dashed). */
function MetricChart({ result, metric, pct, previous, marks, title, about }: { result: PerfSeriesResult; metric: string; pct: Percentile | "players"; previous?: PreviousSeries | undefined; marks: DeployMark[]; title: string; about: string }) {
	const p = useTheme();
	const series = seriesOf(result);
	let rows: ChartRow[] = pivot(result, metric, pct);
	const lines: LineSeries[] = series.map((s, i) => ({ label: s.label, points: rows.map((r) => ({ t: r.t, v: r[s.id] ?? null })), color: p.chart[i % p.chart.length] }));
	const before = previous ? seriesOf(previous.result) : [];
	if (previous && result.by === "none" && series.length === 1 && before.length === 1) {
		rows = withPrevious(rows, pivot(previous.result, metric, pct), previous.shiftMs, (before[0] as { id: string }).id, "prev") as ChartRow[];
		lines.push({ label: "Previous period", points: rows.map((r) => ({ t: r.t, v: r.prev ?? null })), color: p.mutedForeground, dashed: true });
	}
	const span = result.toMs - result.fromMs;
	return (
		<Card style={{ gap: 6 }}>
			<Txt style={{ fontWeight: "600" }}>{title}</Txt>
			<Note>{about}</Note>
			<LineChart
				series={lines}
				area={false}
				height={150}
				format={(v) => fmtMetric(metric === "" ? "players" : metric, v)}
				marks={marks.map((m) => ({ t: m.at, color: markColor(p, m.kind) }))}
				timeLabel={(t) => (span <= 26 * 3_600_000 ? new Date(t).toISOString().slice(11, 16) : new Date(t).toISOString().slice(5, 10))}
			/>
		</Card>
	);
}

function SeriesCharts({ result, metricKeys, pct, players, previous, marks }: { result: PerfSeriesResult; metricKeys: readonly string[]; pct: Percentile; players?: boolean; previous?: PreviousSeries | undefined; marks: DeployMark[] }) {
	return (
		<>
			{metricKeys.map((k) => (
				<MetricChart key={k} result={result} metric={k} pct={pct} previous={previous} marks={marks} title={`${METRICS[k]?.label ?? k}, ${percentileName(pct)}`} about={`${METRICS[k]?.about ?? ""} Line: ${PERCENTILE_HELP[pct]}.${previous && result.by === "none" ? " Dashed: the previous period." : ""}`} />
			))}
			{players ? <MetricChart result={result} metric="" pct="players" previous={previous} marks={marks} title="Players" about={METRICS.players?.about ?? ""} /> : null}
		</>
	);
}

type GroupRow = PerfSeriesResult["overall"] & { label: string };

function GroupTable({ result, metricKeys, pct }: { result: PerfSeriesResult; metricKeys: readonly string[]; pct: Percentile }) {
	const p = useTheme();
	const [all, setAll] = useState(false);
	const side = result.side;
	const pcts = all ? PERCENTILES : [pct];
	const columns: Column<GroupRow>[] = [
		{ key: "group", header: GROUP_BY_LABELS[result.by], width: 120, render: (g) => g.label },
		{ key: "samples", header: "Samples", width: 70, align: "right", render: (g) => fmtInt(g.samples) },
		...(side === "client"
			? [
					{ key: "sessions", header: "Sessions", width: 70, align: "right" as const, render: (g: GroupRow) => fmtInt(g.sessions) },
					{ key: "players", header: "Players", width: 64, align: "right" as const, render: (g: GroupRow) => fmtInt(g.players) },
				]
			: [{ key: "servers", header: "Servers", width: 64, align: "right" as const, render: (g: GroupRow) => fmtInt(g.servers) }]),
		...metricKeys.flatMap((k) =>
			pcts.map(
				(x): Column<GroupRow> => ({
					key: `${k}-${x}`,
					header: `${metricLabel(side, k)} ${percentileName(x)}`,
					width: 92,
					align: "right",
					render: (g) => {
						const v = g.metrics[k]?.[x];
						const f = absoluteFlag(side, k, x, v, g.metrics[k]?.n);
						return (
							<Txt variant="small" color={flagColor(p, f) ?? p.foreground} style={f ? { fontWeight: "700" } : undefined}>
								{fmtMetric(k, v)}
							</Txt>
						);
					},
				}),
			),
		),
	];
	const overall: GroupRow = { ...result.overall, label: "All" };
	const groups: GroupRow[] = result.groups.map((g) => ({ ...g, label: groupLabel(result.by, g.key, g.seq) }));
	const grouped = result.by !== "none";
	const lines = metricKeys.map((k) => thresholdText(side, k, pct)).filter(Boolean);
	return (
		<View style={{ gap: 6 }}>
			<MiniTable columns={columns} rows={grouped ? groups : [overall]} {...(grouped ? { pinned: [overall] } : {})} rowKey={(g) => g.key} />
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
				<Button title={all ? "Only the picked percentile" : "All percentiles"} small variant="ghost" onPress={() => setAll((a) => !a)} />
			</View>
			{lines.length ? <Note>Orange / red: {lines.join("; ")}.</Note> : null}
		</View>
	);
}

function ClientSection({ backendId, by, pct, filters, stepMinutes, period, marks }: SectionProps) {
	const q = useTTAnalytics(backendId, "perf-client", seriesOptions(by, stepMinutes), { filters, keepPrevious: true });
	const previous = usePrevious(backendId, "perf-client", seriesOptions(by, stepMinutes), period);
	return (
		<Panel title="Players' devices" note={q.data ? `Frame rate, memory and ping from tech/client, per ${bucketText(q.data.bucketMs)}, by ${GROUP_BY_LABELS[by].toLowerCase()}.` : "Frame rate, memory and ping from tech/client."}>
			<QueryState q={q} rows={5} isEmpty={(r) => r.overall.samples === 0} empty="No client samples in this range. Clients send tech/client every techEvery seconds (60 by default) while the AnalyticsEngine runs.">
				{(r) => (
					<View style={{ gap: space.sm }}>
						{previous ? <PeriodTiles result={r} previous={previous.result} metricKeys={CLIENT_METRIC_KEYS} pct={pct} /> : null}
						<SeriesCharts result={r} metricKeys={CLIENT_METRIC_KEYS} pct={pct} previous={previous} marks={marks} />
						{r.groupsTotal > r.groups.length ? <Note>The {r.groups.length} busiest of {r.groupsTotal} groups are shown.</Note> : null}
						<GroupTable result={r} metricKeys={CLIENT_METRIC_KEYS} pct={pct} />
					</View>
				)}
			</QueryState>
		</Panel>
	);
}

function ServerSection({ backendId, by, pct, filters, stepMinutes, period, marks }: SectionProps) {
	const serverBy = SERVER_GROUPS.includes(by) ? by : "none";
	const q = useTTAnalytics(backendId, "perf-server", seriesOptions(serverBy, stepMinutes), { filters, keepPrevious: true });
	const previous = usePrevious(backendId, "perf-server", seriesOptions(serverBy, stepMinutes), period);
	const note = serverBy !== by ? ` Servers have no ${GROUP_BY_LABELS[by].toLowerCase()}: shown for everything.` : "";
	return (
		<Panel title="Servers" note={`TPS (the Heartbeat rate), physics FPS, memory and players from tech/server${q.data ? `, per ${bucketText(q.data.bucketMs)}` : ""}. Device, player and experiment filters don't apply to servers.${note}`}>
			<QueryState q={q} rows={5} isEmpty={(r) => r.overall.samples === 0} empty="No server samples in this range (tech/server, every techEvery seconds per server).">
				{(r) => (
					<View style={{ gap: space.sm }}>
						{previous ? <PeriodTiles result={r} previous={previous.result} metricKeys={SERVER_METRIC_KEYS} pct={pct} /> : null}
						<SeriesCharts result={r} metricKeys={["tps", "mem"]} pct={pct} players previous={previous} marks={marks} />
						<GroupTable result={r} metricKeys={SERVER_METRIC_KEYS} pct={pct} />
					</View>
				)}
			</QueryState>
		</Panel>
	);
}

// Live servers --------------------------------------------------------------------------------------------------------------

const toMs = (t: number) => (t < 1e11 ? t * 1000 : t);

function ServerHistory({ backendId, job, since, marks }: { backendId: string; job: string; since: number } & MarkProps) {
	const p = useTheme();
	const q = useTTQuery(backendId, ["fleet", "server-metrics", job, since], (api, s) => api.serverMetrics(job, since, s), { retry: false });
	if (q.error) return q.error instanceof ApiError && q.error.notFound ? <Note>This backend keeps no per-server history yet (it came with kernel 0.4.2's heartbeat metrics).</Note> : <ErrorState error={q.error} />;
	if (!q.data) return <SkeletonList rows={2} />;
	if (!q.data.length) return <Note>No history for this server in this range.</Note>;
	const pts = [...q.data].map((x) => ({ ...x, t: toMs(x.t) })).sort((a, b) => a.t - b.t);
	const m = marks.map((x) => ({ t: x.at, color: markColor(p, x.kind) }));
	const time = (t: number) => new Date(t).toISOString().slice(5, 16).replace("T", " ");
	return (
		<View style={{ gap: space.sm }}>
			<Card style={{ gap: 6 }}>
				<Txt variant="label">TPS</Txt>
				<LineChart area={false} height={120} marks={m} timeLabel={time} series={[{ label: "TPS", points: pts.map((x) => ({ t: x.t, v: x.tps })) }, { label: "TPS (min)", points: pts.map((x) => ({ t: x.t, v: x.tpsMin })) }]} />
			</Card>
			<Card style={{ gap: 6 }}>
				<Txt variant="label">Memory (MB)</Txt>
				<LineChart area={false} height={120} marks={m} timeLabel={time} series={[{ label: "Memory", points: pts.map((x) => ({ t: x.t, v: x.memMb })) }, { label: "Lua heap", points: pts.map((x) => ({ t: x.t, v: x.luaMb })) }]} />
			</Card>
			<Card style={{ gap: 6 }}>
				<Txt variant="label">Players</Txt>
				<LineChart height={100} marks={m} timeLabel={time} series={[{ label: "Players", points: pts.map((x) => ({ t: x.t, v: x.players })) }]} />
			</Card>
		</View>
	);
}

function LiveServers({ backendId, branch, since, marks }: { backendId: string; branch: string | undefined; since: number } & MarkProps) {
	const p = useTheme();
	const [job, setJob] = useState("");
	const q = useTTQuery(backendId, ["fleet", "perf-servers", branch ?? ""], (api, s) => api.perfServers(branch, s), { refetchInterval: 30_000, retry: false });
	const val = (s: PerfServer, key: string, metric: "tps" | "physFps" | "mem", v: number | null | undefined) => {
		const f = metric === "tps" && key === "tpsMin" ? null : absoluteFlag("server", metric, null, v);
		return { text: fmtMetric(metric, v), color: flagColor(p, f) };
	};
	return (
		<Panel title="Live servers" note="Each server's latest TPS and memory from its heartbeat; tap one for its history.">
			<QueryState q={q} isEmpty={(d) => d.servers.length === 0} empty="No live servers right now." rows={3}>
				{(d) => (
					<View style={{ gap: space.sm }}>
						{!d.servers.some((s) => typeof s.tps === "number" || typeof s.memMb === "number") ? <Note>These heartbeats carry no TPS or memory yet (kernel 0.4.2 sends them).</Note> : null}
						<List>
							{d.servers.map((s) => {
								const tps = val(s, "tps", "tps", s.tps);
								const phys = val(s, "physFps", "physFps", s.physFps);
								const mem = val(s, "memMb", "mem", s.memMb);
								const bad = tps.color ?? phys.color ?? mem.color;
								return (
									<View key={s.job}>
										<Pressable onPress={() => setJob(job === s.job ? "" : s.job)} style={{ paddingVertical: 8, paddingHorizontal: space.md, gap: 3, backgroundColor: job === s.job ? p.muted : undefined }}>
											<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
												<Dot tone={bad ? (bad === p.destructive ? "critical" : "warning") : "good"} />
												<Txt variant="mono" style={{ flex: 1 }}>
													{shortId(s.job, 6)}
												</Txt>
												<Txt variant="small">
													{fmtInt(s.players)} players · {s.branch ?? "–"} · {s.artifact ?? "–"}
													{s.appliedSeq ? ` #${s.appliedSeq}` : ""}
												</Txt>
											</View>
											<Txt variant="small">
												TPS <Txt variant="small" color={tps.color ?? p.foreground}>{tps.text}</Txt> (min {fmtMetric("tps", s.tpsMin)}) · physics <Txt variant="small" color={phys.color ?? p.foreground}>{phys.text}</Txt> · memory{" "}
												<Txt variant="small" color={mem.color ?? p.foreground}>{mem.text}</Txt> · Lua {fmtMetric("mem", s.luaMb)}
											</Txt>
										</Pressable>
										{job === s.job ? (
											<View style={{ padding: space.sm }}>
												<ServerHistory backendId={backendId} job={s.job} since={since} marks={marks} />
											</View>
										) : null}
									</View>
								);
							})}
						</List>
					</View>
				)}
			</QueryState>
		</Panel>
	);
}

// Compare -------------------------------------------------------------------------------------------------------------------

type CompareState = { mode: "builds" | "around"; arts: string[]; around: string; hours: number };

function CompareSection({ backendId, filters, marks, seqOf, cmp, setCmp }: { backendId: string; filters: Filters; marks: DeployMark[]; seqOf: Map<string, number>; cmp: CompareState; setCmp(fn: (c: CompareState) => CompareState): void }) {
	const values = useTTAnalytics(backendId, "values", {}, { filters: { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) } });
	const now = Date.now();
	const candidates = [...marks].filter((m) => m.at < now - 5 * 60_000).reverse();
	const around = marks.find((m) => m.id === cmp.around) ?? (cmp.mode === "around" ? candidates[0] : undefined);
	const aroundFilters: Filters = { ...filters, ...(around?.branch && around.kind !== "kernel" && around.kind !== "backup" ? { branch: around.branch } : {}) };
	const q = useTTAnalytics(backendId, "perf-compare", cmp.mode === "around" ? { mode: "around", at: around?.at, hours: cmp.hours } : { mode: "builds", ...(cmp.arts.length ? { arts: cmp.arts } : {}) }, {
		filters: cmp.mode === "around" ? aroundFilters : filters,
		enabled: cmp.mode !== "around" || around !== undefined,
	});
	const seqs = new Map(seqOf);
	if (q.data?.mode === "builds") for (const x of q.data.periods) if (typeof x.seq === "number" && !seqs.has(x.key)) seqs.set(x.key, x.seq);
	const toggle = (art: string) => setCmp((c) => ({ ...c, arts: c.arts.includes(art) ? c.arts.filter((a) => a !== art) : [...c.arts, art].slice(-6) }));
	return (
		<Panel title="Compare" note="Builds side by side over the range, or before vs after a mark over two windows of the same length.">
			<Segmented
				options={[
					{ value: "builds", label: "Builds" },
					{ value: "around", label: "Before vs after" },
				]}
				value={cmp.mode}
				onChange={(m) => setCmp((c) => ({ ...c, mode: m }))}
			/>
			{cmp.mode === "around" ? (
				<View style={{ gap: space.sm }}>
					<Txt variant="label">Mark</Txt>
					<Chips options={candidates.slice(0, 60).map((m) => ({ value: m.id, label: `${markTitle(m)} · ${m.time.slice(5, 16).replace("T", " ")}` }))} value={around?.id ?? ""} onChange={(id) => setCmp((c) => ({ ...c, around: id }))} />
					<Txt variant="label">Window</Txt>
					<Chips options={AROUND_HOURS.map((h) => ({ value: h, label: h < 24 ? `${h} h each side` : `${h / 24} d each side` }))} value={cmp.hours} onChange={(h) => setCmp((c) => ({ ...c, hours: h }))} />
					{around?.branch && around.kind !== "kernel" && around.kind !== "backup" ? <Note>Branch {around.branch} only.</Note> : null}
				</View>
			) : (
				<View style={{ gap: space.sm }}>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
						{(values.data?.art ?? []).slice(0, 16).map((a) => (
							<Button key={a.value} title={groupLabel("art", a.value, seqs.get(a.value))} small variant={cmp.arts.includes(a.value) ? "brand" : "secondary"} onPress={() => toggle(a.value)} />
						))}
					</View>
					{cmp.arts.length ? <Button title="Busiest builds" small variant="ghost" onPress={() => setCmp((c) => ({ ...c, arts: [] }))} style={{ alignSelf: "flex-start" }} /> : <Note>Showing the busiest builds; pick up to 6.</Note>}
				</View>
			)}
			{cmp.mode === "around" && !around ? (
				<EmptyState title="No marks in this range to compare around." />
			) : (
				<QueryState q={q} rows={4} isEmpty={(r) => r.periods.every((x) => x.client.samples === 0 && x.server.samples === 0)} empty="No samples to compare.">
					{(r) => <CompareTable result={r} />}
				</QueryState>
			)}
		</Panel>
	);
}

