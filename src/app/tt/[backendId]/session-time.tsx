/**
 * Session time (web pages/SessionTime.tsx): Creator Hub's Performance > Session time "Explore" view from our own events
 * (query `session-time`). Follows the filter bar's range; per step the average length of the sessions that ended in it
 * (or started), in total and per device, playtime, playtime per player and sessions; the summary vs the period before, a
 * length histogram and the per-step table. Smoothing is a centered rolling average done here. The web's URL parameters
 * (`metric`, `split`, `total`, `bucket`, `smooth`, `by`, `merge`) live in the route.
 */
import { useMemo } from "react";
import { View } from "react-native";

import { change } from "@/api/tt/benchmarks";
import { groupLabel } from "@/api/tt/perf";
import type { Filters, SessionTimeBucket, SessionTimeResult, SessionTimeSummary } from "@/api/tt/types";
import { StatGrid, Txt } from "@/components/ui";
import { BarChart, Legend, LineChart, type ChartSeries } from "@/charts/LineChart";
import { InfoStat, Picker } from "@/features/typetorch/analytics-bits";
import { Note, Panel, QueryState } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam } from "@/features/typetorch/view-link";
import { fmtInt, fmtMinutes, fmtNum } from "@/lib/format";
import { useTheme } from "@/theme";

// Helpers (the web's, as they are) ------------------------------------------------------------------------------------

/** A centered rolling average over `window` points; empty points stay null and are left out of their neighbours'. */
export function rollingAverage(values: readonly (number | null)[], window: number): (number | null)[] {
	if (window <= 1) return values.slice();
	const half = Math.floor(window / 2);
	return values.map((v, i) => {
		if (v === null) return null;
		let sum = 0;
		let n = 0;
		for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
			const x = values[j];
			if (x !== null && x !== undefined) {
				sum += x;
				n += 1;
			}
		}
		return Math.round((sum / n) * 100) / 100;
	});
}

export type SessionMetric = "session" | "playtime" | "perPlayer" | "sessions";

export const METRICS: { key: SessionMetric; label: string; format(v: number): string; byDevice: boolean }[] = [
	{ key: "session", label: "Session time", format: (v) => fmtMinutes(v), byDevice: true },
	{ key: "playtime", label: "Playtime", format: (v) => fmtMinutes(v), byDevice: true },
	{ key: "perPlayer", label: "Playtime per player", format: (v) => fmtMinutes(v), byDevice: false },
	{ key: "sessions", label: "Sessions", format: (v) => fmtInt(v), byDevice: true },
];

/** One bucket's value for a metric: the total (weighted or Roblox-style for session time) or one device's. */
export function bucketValue(b: SessionTimeBucket, metric: SessionMetric, total: "weighted" | "roblox", dev?: string): number | null {
	if (dev !== undefined) {
		const d = b.byDevice[dev];
		if (metric === "session") return d?.avgMinutes ?? null;
		if (metric === "playtime") return b.sessions ? (d?.playtimeMinutes ?? 0) : null;
		if (metric === "sessions") return b.sessions ? (d?.sessions ?? 0) : null;
		return null;
	}
	if (metric === "session") return total === "roblox" ? b.robloxTotal : b.avgMinutes;
	if (metric === "playtime") return b.sessions ? b.playtimeMinutes : null;
	if (metric === "perPlayer") return b.playtimePerPlayer;
	return b.sessions ? b.sessions : null;
}

/** "10-05 14:00" for steps under a day, "10-05" for days (UTC); `long` adds the year (and UTC). */
function bucketLabel(iso: string, bucketMinutes: number, long = false): string {
	if (bucketMinutes >= 1440) return long ? iso.slice(0, 10) : iso.slice(5, 10);
	return long ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

/** "minute", "5 minutes", "hour", "day". */
export function stepLabel(minutes: number): string {
	if (minutes === 1) return "minute";
	if (minutes === 60) return "hour";
	if (minutes === 1440) return "day";
	return minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minutes`;
}

/** The filter range's length, ms (a date-only `to` is inclusive); null when it can't be told. */
export function rangeSpan(filters: Filters, now = Date.now()): number | null {
	const from = filters.from === undefined ? null : Date.parse(filters.from);
	if (from === null || !Number.isFinite(from)) return null;
	let to = now;
	if (filters.to !== undefined) to = Date.parse(filters.to) + (/^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? 86_400_000 : 0);
	return Number.isFinite(to) && to > from ? to - from : null;
}

const BUCKETS = [
	{ value: "auto", label: "Auto step", minutes: 0 },
	{ value: "1", label: "1 minute", minutes: 1 },
	{ value: "5", label: "5 minutes", minutes: 5 },
	{ value: "15", label: "15 minutes", minutes: 15 },
	{ value: "60", label: "1 hour", minutes: 60 },
	{ value: "1440", label: "1 day", minutes: 1440 },
];
const SMOOTHING = ["off", "3", "5", "15"];
const MERGE = ["0", "2", "5", "10"];

const INFO =
	"A session is one visit (first to last event; Studio play tests left out). It is over with a leave row or after 10 minutes without events, and only sessions that are over count. By end (Creator Hub's way) a session counts in the step where it ended, with its full length, even if it started earlier; by start, where it started. Total (weighted) = all sessions of the step together; Roblox-style = the mean of the device averages (unknown devices left out). Merge rejoins joins a player's sessions closer than that (rejoins, teleports). Roblox doesn't publish how its Total line or its smoothing is computed, so neither choice is guaranteed to match it; smoothing here is a centered rolling average that skips empty steps.";

// Page ---------------------------------------------------------------------------------------------------------------

export default function SessionTimeScreen() {
	return <TTScreen title="Session time">{({ backendId }) => <SessionTime backendId={backendId} />}</TTScreen>;
}

function SessionTime({ backendId }: { backendId: string }) {
	const { apiFilters } = useTTFilters(backendId);
	const [metricParam, setMetric] = usePageParam("metric", "session");
	const [splitParam, setSplit] = usePageParam("split", "total");
	const [totalParam, setTotal] = usePageParam("total", "weighted");
	const [bucket, setBucket] = usePageParam("bucket", "auto");
	const [smoothParam, setSmooth] = usePageParam("smooth", "off");
	const [byParam, setBy] = usePageParam("by", "end");
	const [mergeParam, setMerge] = usePageParam("merge", "0");
	const metric = (METRICS.some((m) => m.key === metricParam) ? metricParam : "session") as SessionMetric;
	const split = splitParam === "device";
	const total = totalParam === "roblox" ? "roblox" : "weighted";
	const by = byParam === "start" ? "start" : "end";
	const merge = MERGE.includes(mergeParam) ? Number(mergeParam) : 0;
	const smooth = SMOOTHING.includes(smoothParam) && smoothParam !== "off" ? Number(smoothParam) : 1;
	const span = rangeSpan(apiFilters);
	const bucketOptions = BUCKETS.map((b) => ({ value: b.value, label: b.label, disabled: b.minutes > 0 && span !== null && span / (b.minutes * 60_000) > 2000 }));
	const chosen = BUCKETS.find((b) => b.value === bucket && b.minutes > 0 && !bucketOptions.find((o) => o.value === b.value)?.disabled);
	const options = useMemo(() => ({ by, mergeGapMinutes: merge, ...(chosen ? { bucketMinutes: chosen.minutes } : {}) }), [by, merge, chosen]);
	const q = useTTAnalytics(backendId, "session-time", options, { keepPrevious: true });
	const spec = METRICS.find((m) => m.key === metric) ?? METRICS[0]!;
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Creator Hub's Session time Explore view, from our own events: how long sessions last, per time step, in total and by device. Follows the filter bar's range.</Note>
			<QueryState q={q} rows={4}>
				{(r) => <Tiles s={r.summary} p={r.previous} />}
			</QueryState>
			<Panel title={spec.label} note={`Per ${q.data ? stepLabel(q.data.bucketMinutes) : "step"}, sessions counted ${by === "end" ? "when they ended" : "when they started"}. ${INFO}`}>
				<Picker label="Metric" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.key, label: m.label }))} />
				<Picker
					label="Split"
					value={split ? "device" : "total"}
					onChange={setSplit}
					options={[
						{ value: "total", label: "Total only" },
						{ value: "device", label: "By device", disabled: !spec.byDevice },
					]}
				/>
				{metric === "session" ? (
					<Picker
						label="Total"
						value={total}
						onChange={setTotal}
						options={[
							{ value: "weighted", label: "Total: weighted" },
							{ value: "roblox", label: "Total: avg of devices" },
						]}
					/>
				) : null}
				<Picker label="Step" value={chosen ? chosen.value : "auto"} onChange={setBucket} options={bucketOptions} />
				<Picker label="Smoothing" value={smooth > 1 ? String(smooth) : "off"} onChange={setSmooth} options={SMOOTHING.map((s) => ({ value: s, label: s === "off" ? "No smoothing" : `Smooth: ${s} steps` }))} />
				<Picker
					label="Count by"
					value={by}
					onChange={setBy}
					options={[
						{ value: "end", label: "Count by end" },
						{ value: "start", label: "Count by start" },
					]}
				/>
				<Picker label="Merge rejoins" value={String(merge)} onChange={setMerge} options={MERGE.map((m) => ({ value: m, label: m === "0" ? "No merging" : `Merge rejoins < ${m} min` }))} />
				<QueryState q={q} isEmpty={(r) => r.summary.sessions === 0} empty="No sessions ended in this range.">
					{(r) => (
						<>
							<TrendChart r={r} metric={metric} total={total} split={split} smooth={smooth} />
							{r.truncated ? <Note>Too many sessions: the oldest part of the range may be missing. Pick a shorter range.</Note> : null}
						</>
					)}
				</QueryState>
			</Panel>
			<Panel title="Session lengths" note="Sessions counted in the range, by length.">
				<QueryState q={q} isEmpty={(r) => r.summary.sessions === 0} empty="No sessions ended in this range.">
					{(r) => <Histogram r={r} />}
				</QueryState>
			</Panel>
			<Panel title="Per step" note="Newest first: sessions, the weighted and Roblox-style averages, and each device's average (sessions).">
				<QueryState q={q}>{(r) => <BucketTable r={r} />}</QueryState>
			</Panel>
		</>
	);
}

function Tiles({ s, p }: { s: SessionTimeSummary; p: SessionTimeSummary }) {
	const min = (v: number | null) => (v === null ? "n/a" : fmtMinutes(v));
	return (
		<StatGrid>
			<InfoStat label="Avg session time" info="Total length of the counted sessions / their number (weighted: busy buckets weigh more)." value={min(s.avgMinutes)} change={change(s.avgMinutes, p.avgMinutes)} />
			<InfoStat
				label="Roblox-style headline"
				info="The mean over the non-empty buckets of the Total line, Total being the mean of the device averages: our best guess at Creator Hub's minute-by-minute average over the period (pick 1-minute buckets to match it)."
				value={min(s.robloxHeadline)}
				change={change(s.robloxHeadline, p.robloxHeadline)}
			/>
			<InfoStat label="Median session" info="Half the counted sessions are shorter than this." value={min(s.medianMinutes)} change={change(s.medianMinutes, p.medianMinutes)} />
			<InfoStat label="Playtime" info="Total length of the counted sessions." value={min(s.playtimeMinutes)} change={change(s.playtimeMinutes, p.playtimeMinutes)} />
			<InfoStat label="Playtime per player" info="Playtime / distinct players among the counted sessions." value={min(s.playtimePerPlayer)} change={change(s.playtimePerPlayer, p.playtimePerPlayer)} />
			<InfoStat label="Sessions" info={`Sessions that are over and counted in the range (${fmtInt(s.running)} still running are not).`} value={fmtInt(s.sessions)} change={change(s.sessions, p.sessions)} />
		</StatGrid>
	);
}

function TrendChart({ r, metric, total, split, smooth }: { r: SessionTimeResult; metric: SessionMetric; total: "weighted" | "roblox"; split: boolean; smooth: number }) {
	const p = useTheme();
	const spec = METRICS.find((m) => m.key === metric) ?? METRICS[0]!;
	const series = useMemo<ChartSeries[]>(() => {
		const devs = split && spec.byDevice ? r.devices : [];
		const line = (values: (number | null)[]) => rollingAverage(values, smooth).map((v, i) => ({ t: r.buckets[i]!.t, v }));
		return [
			{ label: metric === "session" ? (total === "roblox" ? "Total (avg of devices)" : "Total (weighted)") : "Total", color: p.foreground, points: line(r.buckets.map((b) => bucketValue(b, metric, total))) },
			...devs.map((d, i) => ({ label: groupLabel("dev", d), color: p.chart[i % p.chart.length], points: line(r.buckets.map((b) => bucketValue(b, metric, total, d))) })),
		];
	}, [r, metric, total, split, smooth, spec.byDevice, p]);
	return (
		<View style={{ gap: 6 }}>
			<LineChart series={series} height={200} area={false} format={spec.format} axisFormat={(v) => fmtNum(v, metric === "sessions" ? 0 : 1)} timeLabel={(t) => bucketLabel(new Date(t).toISOString(), r.bucketMinutes)} />
			{series.length > 1 ? <Legend items={series.map((s) => ({ label: s.label, color: s.color ?? p.brand }))} /> : null}
		</View>
	);
}

function Histogram({ r }: { r: SessionTimeResult }) {
	// BarChart is a time chart: index the bars and label them with the histogram's own labels.
	const points = r.histogram.map((h, i) => ({ t: i, v: h.count }));
	return (
		<View style={{ gap: 4 }}>
			<BarChart points={points} height={160} timeLabel={(i) => r.histogram[i]?.label ?? ""} format={(v) => fmtInt(v)} />
			<Txt variant="small">{r.histogram.map((h) => `${h.label}: ${fmtInt(h.count)}`).join(" · ")}</Txt>
		</View>
	);
}

function BucketTable({ r }: { r: SessionTimeResult }) {
	const rows = useMemo(() => r.buckets.filter((b) => b.sessions > 0).reverse(), [r.buckets]);
	const columns = useMemo<DataColumn<SessionTimeBucket>[]>(
		() => [
			{ id: "time", header: "Time", type: "date", width: 150, accessor: (b) => b.t, format: (_v, b) => bucketLabel(b.time, r.bucketMinutes, true) },
			{ id: "sessions", header: "Sessions", type: "number", width: 80, accessor: (b) => b.sessions, format: (_v, b) => fmtInt(b.sessions) },
			{ id: "avg", header: "Avg", type: "number", width: 80, accessor: (b) => b.avgMinutes, format: (_v, b) => (b.avgMinutes === null ? "–" : fmtMinutes(b.avgMinutes)) },
			{ id: "roblox", header: "Roblox-style", type: "number", width: 96, accessor: (b) => b.robloxTotal, format: (_v, b) => (b.robloxTotal === null ? "–" : fmtMinutes(b.robloxTotal)) },
			...r.devices.map(
				(d): DataColumn<SessionTimeBucket> => ({
					id: `dev-${d}`,
					header: groupLabel("dev", d),
					type: "number",
					width: 110,
					accessor: (b) => b.byDevice[d]?.avgMinutes ?? null,
					format: (_v, b) => {
						const v = b.byDevice[d];
						return v?.avgMinutes === null || v?.avgMinutes === undefined ? "–" : `${fmtMinutes(v.avgMinutes)} (${fmtInt(v.sessions)})`;
					},
				}),
			),
		],
		[r.devices, r.bucketMinutes],
	);
	return <DataTable id="session-time-steps" label="Session time per step" columns={columns} data={rows} rowId={(b) => String(b.t)} empty={<Txt variant="muted">No sessions ended in this range.</Txt>} />;
}
