/**
 * One custom-dashboard tile drawn on the phone: its metric(s) through the Analytics Query API (inside analyticsSlot,
 * so the app stays under Roblox's 30 queries a minute), a line chart over time, or totals per breakdown value for bar /
 * pie / table / summary tiles. Only the first tiles of a dashboard load by themselves; the rest wait for a tap.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { AnalyticsQuery, AnalyticsSeries, Granularity, OpenCloud } from "@/api/opencloud";
import { Legend, LineChart, ShareBars, shortNumber, type ChartSeries } from "@/charts/LineChart";
import { Badge, Button, Card, Skeleton, Txt } from "@/components/ui";
import { analyticsSlot, timeRange, type RangeDays } from "@/features/project/analytics";
import { CloudError } from "@/features/project/CloudError";
import { compact } from "@/lib/format";
import { useTheme } from "@/theme";

import type { DashboardMetricReference, TileFilter } from "../api/analytics-tools";
import { evaluateFormula, isTotalsChart, type DashTile } from "./dashboard-model";

const MAX_LINES = 6;
const MAX_ROWS = 15;
const MAX_SOURCES = 4;

type TileData = { kind: "lines"; series: ChartSeries[] } | { kind: "totals"; rows: { label: string; value: number }[] };

function toFilter(filters: TileFilter[]): AnalyticsQuery["filter"] {
	const f = filters.filter((x) => x.dimensionKey && x.values?.length).map((x) => ({ dimension: x.dimensionKey!, values: x.values!, operation: "In" }));
	return f.length ? f : undefined;
}

function breakdownLabel(s: AnalyticsSeries): string {
	return s.breakdowns.map((b) => b.displayValue || b.value).join(" · ");
}

/** One metric reference -> series keyed by breakdown label, each a map time -> value. */
async function queryReference(
	cloud: OpenCloud,
	universeId: number,
	ref: DashboardMetricReference,
	base: { granularity: Granularity; startTime: string; endTime: string; breakdown: string[]; filters: TileFilter[] },
): Promise<Map<string, Map<number, number | null>>> {
	const run = (metric: string, filters: TileFilter[]) =>
		analyticsSlot(() =>
			cloud.queryMetric(universeId, {
				metric,
				granularity: base.granularity,
				startTime: base.startTime,
				endTime: base.endTime,
				...(base.breakdown.length ? { breakdown: base.breakdown } : {}),
				...(toFilter(filters) ? { filter: toFilter(filters) } : {}),
			}),
		);
	const asMap = (series: AnalyticsSeries[]) => {
		const out = new Map<string, Map<number, number | null>>();
		for (const s of series) out.set(breakdownLabel(s), new Map(s.dataPoints.map((p) => [Date.parse(p.time), p.value])));
		return out;
	};
	if (ref.metricKey) return asMap(await run(ref.metricKey, base.filters));
	const computed = ref.computedMetric;
	if (!computed?.formula) throw new Error("This tile has no metric the app can query.");
	const sources = (computed.sources ?? []).filter((s) => s.sourceKey);
	if (!sources.length) throw new Error("The computed metric has no sources.");
	if (sources.length > MAX_SOURCES) throw new Error(`The computed metric has ${sources.length} sources; the app draws at most ${MAX_SOURCES} to stay under Roblox's query limit.`);
	const results: [string, Map<string, Map<number, number | null>>][] = [];
	for (const s of sources) {
		const key = s.metricKey || s.metric?.metricKey;
		if (!key) throw new Error(`Source ${s.sourceKey} has no metric.`);
		results.push([s.sourceKey!, asMap(await run(key, [...base.filters, ...(s.filters ?? [])]))]);
	}
	const labels = new Set<string>();
	const times = new Set<number>();
	for (const [, m] of results)
		for (const [label, points] of m) {
			labels.add(label);
			for (const t of points.keys()) times.add(t);
		}
	const out = new Map<string, Map<number, number | null>>();
	for (const label of labels) {
		const points = new Map<number, number | null>();
		for (const t of times) {
			const vars: Record<string, number | null> = {};
			for (const [key, m] of results) vars[key] = m.get(label)?.get(t) ?? m.get("")?.get(t) ?? null;
			points.set(t, evaluateFormula(computed.formula, vars));
		}
		out.set(label, points);
	}
	return out;
}

async function loadTile(cloud: OpenCloud, universeId: number, tile: DashTile, days: RangeDays): Promise<TileData> {
	const totals = isTotalsChart(tile);
	const granularity: Granularity = totals ? "None" : tile.granularity;
	const { startTime, endTime } = timeRange({ kind: "preset", days }, {}, granularity);
	const many = tile.series.length > 1;
	const lines: ChartSeries[] = [];
	const rows: { label: string; value: number }[] = [];
	for (const s of tile.series) {
		const result = await queryReference(cloud, universeId, s.metric, { granularity, startTime, endTime, breakdown: tile.breakdown, filters: [...tile.filters, ...s.filters] });
		for (const [label, points] of result) {
			const name = many ? [s.label, label].filter(Boolean).join(" · ") : label || s.label;
			if (totals) {
				const values = [...points.values()].filter((v): v is number => v !== null);
				if (values.length) rows.push({ label: name, value: values.reduce((a, b) => a + b, 0) });
			} else {
				lines.push({ label: name, points: [...points.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v })) });
			}
		}
	}
	if (totals) return { kind: "totals", rows: rows.sort((a, b) => b.value - a.value).slice(0, MAX_ROWS) };
	const sum = (s: ChartSeries) => s.points.reduce((a, p) => a + (p.v ?? 0), 0);
	return { kind: "lines", series: lines.sort((a, b) => sum(b) - sum(a)).slice(0, MAX_LINES) };
}

function timeLabel(granularity: Granularity) {
	return (t: number) => {
		const d = new Date(t);
		const day = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
		if (granularity === "OneMinute" || granularity === "HalfHour" || granularity === "OneHour") return `${day} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
		return day;
	};
}

export function DashboardTile({
	tile,
	universeId,
	cloud,
	days,
	autoLoad,
	dashboardId,
	onRemove,
}: {
	tile: DashTile;
	universeId: number;
	cloud: OpenCloud;
	days: RangeDays;
	autoLoad: boolean;
	dashboardId: string;
	onRemove?: () => void;
}) {
	const p = useTheme();
	const [wanted, setWanted] = useState(false);
	const q = useQuery({
		queryKey: ["oc", "dashboard", universeId, dashboardId, "tile", tile.key, days, JSON.stringify({ s: tile.series, g: tile.granularity, b: tile.breakdown, f: tile.filters, c: tile.chartType })],
		enabled: (autoLoad || wanted) && tile.series.length > 0,
		staleTime: 3600_000,
		retry: false,
		queryFn: () => loadTile(cloud, universeId, tile, days),
	});
	const summaryValue = tile.kind === "summary" && q.data?.kind === "totals" ? q.data.rows.reduce((a, r) => a + r.value, 0) : null;
	return (
		<Card style={{ gap: 8 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<View style={{ flex: 1, gap: 2 }}>
					<Txt style={{ fontWeight: "600" }} numberOfLines={2}>
						{tile.title}
					</Txt>
					<Txt variant="small" numberOfLines={2}>
						{[tile.section, tile.series.map((s) => s.label).join(", "), tile.breakdown.length ? `by ${tile.breakdown.join(", ")}` : "", tile.filters.length ? `${tile.filters.length} filter${tile.filters.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")}
					</Txt>
				</View>
				<Badge label={tile.kind === "summary" ? "card" : tile.kind} />
				{onRemove ? <Button title="" icon="trash-outline" small variant="ghost" onPress={onRemove} /> : null}
			</View>
			{!tile.series.length ? (
				<Txt variant="small">This tile has no metric the app can draw.</Txt>
			) : !autoLoad && !wanted ? (
				<Button title="Load" icon="download-outline" small onPress={() => setWanted(true)} style={{ alignSelf: "flex-start" }} />
			) : q.error ? (
				<CloudError error={q.error} what="This tile" onRetry={() => q.refetch()} />
			) : !q.data ? (
				<Skeleton height={tile.kind === "summary" ? 32 : 140} />
			) : tile.kind === "summary" ? (
				<Txt variant="title">{summaryValue === null ? "–" : compact(summaryValue)}</Txt>
			) : q.data.kind === "totals" ? (
				q.data.rows.length ? (
					<ShareBars exportTitle={tile.title} rows={q.data.rows} />
				) : (
					<Txt variant="small">No data for this range.</Txt>
				)
			) : q.data.series.some((s) => s.points.length) ? (
				<>
					<LineChart exportTitle={tile.title} series={q.data.series.map((s, i) => ({ ...s, color: p.chart[i % p.chart.length] }))} format={shortNumber} timeLabel={timeLabel(tile.granularity)} area={q.data.series.length === 1} />
					{q.data.series.length > 1 ? <Legend items={q.data.series.map((s, i) => ({ label: s.label || "all", color: p.chart[i % p.chart.length]! }))} /> : null}
				</>
			) : (
				<Txt variant="small">No data for this range.</Txt>
			)}
		</Card>
	);
}
