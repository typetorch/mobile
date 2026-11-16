/**
 * Creator Hub's analytics for any universe the key has `universe.analytics:read` on: one card per metric, each its
 * own Analytics Query API query (cached for an hour), with a range and an optional breakdown.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { ANALYTICS_READ_SCOPE, hasScope } from "@/api/opencloud";
import { LineChart, Legend } from "@/charts/LineChart";
import { Card, Chips, ErrorState, ScopeNotice, Segmented, Skeleton, Txt } from "@/components/ui";
import { fmtMetric } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

import {
	aggregate,
	analyticsSlot,
	DIMENSION_LABELS,
	METRIC_GROUPS,
	normalizeRates,
	rangeFor,
	RANGES,
	seriesLabel,
	topSeries,
	type MetricDef,
	type RangeDays,
} from "./analytics";

const DAY = 86_400_000;

function MetricCard({ universeId, metric, days }: { universeId: number; metric: MetricDef; days: RangeDays }) {
	const p = useTheme();
	const { cloud } = useAccounts();
	const [breakdown, setBreakdown] = useState<string>("");
	const range = rangeFor(days, metric);
	const q = useQuery({
		queryKey: ["oc", "analytics", universeId, metric.id, days, breakdown, range.endTime],
		enabled: !!cloud,
		staleTime: 3600_000,
		gcTime: 3600_000,
		retry: false,
		queryFn: ({ signal }) =>
			analyticsSlot(() =>
				cloud!.queryMetric(
					universeId,
					{ metric: metric.id, granularity: metric.granularity, ...range, ...(breakdown ? { breakdown: [breakdown] } : {}) },
					{ signal },
				),
			),
	});
	const series = q.data ? topSeries(normalizeRates(q.data, metric.format), breakdown ? 6 : 1) : [];
	const total = series.length === 1 ? aggregate(series[0]!.dataPoints.map((d) => d.value), metric.aggregate) : null;
	// Previous-half comparison is left out: the API answers only the asked range.
	const chart = series.map((s) => ({ label: seriesLabel(s), points: s.dataPoints.map((d) => ({ t: Date.parse(d.time), v: d.value })) }));
	return (
		<Card style={{ gap: 8 }}>
			<View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
				<View style={{ flex: 1, gap: 2 }}>
					<Txt style={{ fontWeight: "600" }}>{metric.title}</Txt>
					<Txt variant="small">
						{metric.help}
						{metric.retentionDays && days > metric.retentionDays ? ` Roblox keeps ${metric.retentionDays} days.` : ""}
					</Txt>
				</View>
				{total !== null ? (
					<Txt variant="h3" style={{ fontWeight: "700" }}>
						{fmtMetric(metric.format, total)}
					</Txt>
				) : null}
			</View>
			<Chips options={[{ value: "", label: "Total" }, ...metric.breakdowns.map((d) => ({ value: d, label: DIMENSION_LABELS[d] ?? d }))]} value={breakdown} onChange={setBreakdown} />
			{q.isLoading ? <Skeleton height={140} /> : null}
			{q.error ? <ErrorState title="Roblox didn't answer this chart" error={q.error} onRetry={() => q.refetch()} /> : null}
			{q.data && !chart.some((s) => s.points.length) ? <Txt variant="muted">No data in this range.</Txt> : null}
			{chart.some((s) => s.points.length) ? (
				<LineChart
					series={chart}
					height={150}
					format={(v) => fmtMetric(metric.format, v)}
					timeLabel={(t) => {
						const d = new Date(t);
						return days > 28 ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
					}}
				/>
			) : null}
			{breakdown && q.data && q.data.length > series.length ? <Txt variant="small">The {series.length} biggest of {q.data.length}.</Txt> : null}
			{!breakdown && chart.length > 1 ? <Legend items={chart.map((c, i) => ({ label: c.label, color: p.chart[i % p.chart.length]! }))} /> : null}
		</Card>
	);
}

export function AnalyticsTab({ universeId }: { universeId: number }) {
	const { keyInfo, hasKey } = useAccounts();
	const [days, setDays] = useState<RangeDays>(28);
	const [group, setGroup] = useState(METRIC_GROUPS[0]!.title);
	if (!hasKey || !hasScope(keyInfo, ANALYTICS_READ_SCOPE, universeId)) return <ScopeNotice what="Analytics" scopes={[ANALYTICS_READ_SCOPE]} />;
	const metrics = METRIC_GROUPS.find((g) => g.title === group)?.metrics ?? [];
	return (
		<View style={{ gap: 12 }}>
			<Segmented options={RANGES.map((d) => ({ value: d, label: `${d} days` }))} value={days} onChange={setDays} />
			<Chips options={METRIC_GROUPS.map((g) => ({ value: g.title, label: g.title }))} value={group} onChange={setGroup} />
			{metrics.map((m) => (
				<MetricCard key={m.id} universeId={universeId} metric={m} days={days} />
			))}
			<Txt variant="small" style={{ textAlign: "center" }}>
				Full UTC days up to {new Date(Math.floor(Date.now() / DAY) * DAY).toISOString().slice(0, 10)} · Roblox Analytics Query API · cached for an hour
			</Txt>
		</View>
	);
}
