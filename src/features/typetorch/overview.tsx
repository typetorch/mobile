/**
 * The Overview page's analytics (web pages/Overview.tsx): the filter bar, the 8 tiles with "vs previous period" change
 * chips (`vs=prev`) and their "Why?" (the Explain panel, `explain=<metric>`), the 4 bar charts per day or per step with
 * the previous period dashed and deploy marks, the saved queries pinned to the Overview (POST /v1/sql each), and for
 * owners the ingest-busy note and the Storage card.
 */
import { useMemo } from "react";
import { Switch, View } from "react-native";

import { change } from "@/api/tt/benchmarks";
import { previousPeriod } from "@/api/tt/compare";
import { bucketText } from "@/api/tt/perf";
import type { ExplainMetric, OverviewResult } from "@/api/tt/types";
import { BarChart, type ChartMark } from "@/charts/LineChart";
import { Card, ErrorState, Skeleton, StatGrid, Txt } from "@/components/ui";
import { compact, fmtInt, fmtMinutes, fmtNum } from "@/lib/format";
import { useTheme } from "@/theme";

import { InfoStat } from "./analytics-bits";
import { ExplainButton, ExplainPanel } from "./explain";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "./filters";
import { chartMarks, DeployMarksToggle, useDeployMarks, useMarkCard } from "./marks";
import { IngestBusyNote, StorageCard } from "./owner-cards";
import { PinnedQueries } from "./sql-result";

const CHARTS: { key: "players" | "newPlayers" | "sessions" | "playtimeHours"; label: string; format?: (v: number) => string }[] = [
	{ key: "players", label: "Players" },
	{ key: "newPlayers", label: "New players" },
	{ key: "sessions", label: "Sessions" },
	{ key: "playtimeHours", label: "Playtime (hours)", format: (v) => fmtNum(v, 1) },
];

/** The stat tiles: label, value, the number the change chip compares, and the `explain` metric behind its "Why?". */
const TILES: { label: string; value(d: OverviewResult): number; text(d: OverviewResult): string; explain?: ExplainMetric }[] = [
	{ label: "Players", value: (d) => d.players, text: (d) => fmtInt(d.players), explain: "players" },
	{ label: "New players", value: (d) => d.newPlayers, text: (d) => fmtInt(d.newPlayers), explain: "newPlayers" },
	{ label: "Returning", value: (d) => d.returningPlayers, text: (d) => fmtInt(d.returningPlayers), explain: "returningPlayers" },
	{ label: "Sessions", value: (d) => d.sessions, text: (d) => fmtInt(d.sessions), explain: "sessions" },
	{ label: "Events", value: (d) => d.events, text: (d) => fmtInt(d.events) },
	{ label: "Playtime", value: (d) => d.playtimeHours, text: (d) => `${fmtNum(d.playtimeHours, 1)} h`, explain: "playtime" },
	{ label: "Avg session", value: (d) => d.avgSessionMinutes, text: (d) => fmtMinutes(d.avgSessionMinutes), explain: "avgSession" },
	{ label: "Playtime per player", value: (d) => d.playtimePerPlayerMinutes, text: (d) => fmtMinutes(d.playtimePerPlayerMinutes), explain: "playtimePerPlayer" },
];

const DAY_MS = 86_400_000;

/** One chart's bars: per step for windows of a day or less (the backend's buckets), else per day; empty days / steps as 0 (the web's fillDays / fillSteps). */
export function overviewBars(data: OverviewResult, key: (typeof CHARTS)[number]["key"]): { points: { t: number; v: number }[]; per: string; byStep: boolean } {
	const step = data.bucketMs;
	const fromMs = Date.parse(data.from);
	const toMs = Date.parse(data.to);
	if (step && step < DAY_MS && data.buckets) {
		const byT = new Map(data.buckets.map((b) => [b.t, b[key]]));
		let points = data.buckets.map((b) => ({ t: b.t, v: b[key] }));
		if (step > 0 && Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs && (toMs - fromMs) / step <= 400) {
			points = [];
			for (let t = Math.floor(fromMs / step) * step; t < toMs; t += step) points.push({ t, v: byT.get(t) ?? 0 });
		}
		return { points, per: `per ${bucketText(step)} (UTC), by the time a session started`, byStep: true };
	}
	const byDate = new Map(data.days.map((d) => [d.date, d[key]]));
	let points = data.days.map((d) => ({ t: Date.parse(`${d.date}T00:00:00Z`), v: d[key] }));
	const start = Date.parse(`${data.from.slice(0, 10)}T00:00:00Z`);
	const end = Date.parse(`${data.to.slice(0, 10)}T00:00:00Z`);
	if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 400 * DAY_MS) {
		points = [];
		for (let t = start; t <= end; t += DAY_MS) points.push({ t, v: byDate.get(new Date(t).toISOString().slice(0, 10)) ?? 0 });
	}
	return { points, per: "per day (UTC), by the day a session started", byStep: false };
}

export function OverviewAnalytics({ backendId, compare }: { backendId: string; compare: { on: boolean; set(on: boolean): void } }) {
	const p = useTheme();
	const { state, apiFilters } = useTTFilters(backendId);
	const period = useMemo(() => previousPeriod(state), [state]);
	const q = useTTAnalytics(backendId, "overview", {}, { keepPrevious: true });
	const vsPrev = compare.on && period !== undefined;
	const prev = useTTAnalytics(backendId, "overview", {}, { enabled: vsPrev, ...(period ? { filters: period.filters } : {}) });
	const previous = vsPrev ? prev.data : undefined;
	const branch = typeof apiFilters.branch === "string" ? apiFilters.branch : undefined;
	const data = q.data;
	const markRange = useMemo(() => (data ? { from: Date.parse(data.from), to: Date.parse(data.to) } : null), [data]);
	const deploys = useDeployMarks(backendId, markRange, branch, { enabled: !!data });
	const card = useMarkCard(backendId);
	const marks: ChartMark[] = chartMarks(p, deploys.marks);
	return (
		<View style={{ gap: 12 }}>
			<FilterBar backendId={backendId} />
			<Txt variant="small">Players, sessions and playtime, {describeRange(state)}. Session length = first to last event.</Txt>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Switch value={compare.on} onValueChange={compare.set} disabled={!period} />
				<Txt variant="small" style={{ flex: 1 }}>
					{period ? "vs previous period: change chips on the tiles (Why? explains one), the period before dashed on the charts" : "Pick a start date to compare with the period before"}
				</Txt>
			</View>
			<IngestBusyNote backendId={backendId} />
			{q.error && !data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
			{!data && !q.error ? <Skeleton height={160} /> : null}
			{vsPrev && prev.error ? <Txt variant="small">Couldn't load the previous period: {prev.error.message}</Txt> : null}
			{data ? (
				<>
					<StatGrid>
						{TILES.map((t) => (
							<InfoStat
								key={t.label}
								label={t.label}
								value={t.text(data)}
								{...(previous
									? {
											change: change(t.value(data), t.value(previous)),
											...(t.explain ? { action: <ExplainButton metric={t.explain} label={t.label} /> } : {}),
										}
									: {})}
							/>
						))}
					</StatGrid>
					{deploys.all.length ? <DeployMarksToggle {...deploys} /> : null}
					{CHARTS.map((c) => {
						const { points, per, byStep } = overviewBars(data, c.key);
						const before = previous ? overviewBars(previous, c.key).points.map((x) => x.v) : undefined;
						return (
							<Card key={c.key} style={{ gap: 6 }}>
								<Txt variant="label">{c.label}</Txt>
								<Txt variant="small">{before ? `${per}; dashed: the previous period` : per}</Txt>
								<BarChart
									points={points}
									format={c.format ?? compact}
									marks={marks}
									onMarkPress={card.open}
									{...(byStep ? { timeLabel: (t: number) => new Date(t).toISOString().slice(11, 16) } : {})}
									{...(before ? { previous: before } : {})}
								/>
							</Card>
						);
					})}
				</>
			) : null}
			<PinnedQueries backendId={backendId} />
			<StorageCard backendId={backendId} />
			{card.sheet}
			<ExplainPanel backendId={backendId} />
		</View>
	);
}
