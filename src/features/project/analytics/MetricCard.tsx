/**
 * One metric card: a time series (line chart) or a period total (bars per breakdown value), with the metric's
 * variants (percentiles), one or two breakdown dimensions, filters, top N, and the data points' status (projected /
 * not significant). Cards past the first few of a group wait for a tap, so opening a group doesn't spend the minute's
 * 30 queries at once.
 */
import { useState } from "react";
import { View } from "react-native";

import { LineChart, Legend, ShareBars } from "@/charts/LineChart";
import { Badge, Button, Card, Chips, Field, Skeleton, Txt } from "@/components/ui";
import { CloudError } from "@/features/project/CloudError";
import { useTheme } from "@/theme";

import {
	aggregate,
	dimLabel,
	effectiveSpanDays,
	GRANULARITY_LABEL,
	naturalCompare,
	normalizeRates,
	resolveGranularity,
	seriesLabel,
	timeRange,
	topSeries,
	type GranularityChoice,
	type MetricDef,
	type RangeSpec,
} from "../analytics";
import type { Granularity } from "@/api/opencloud";
import type { MetricSeries, QueryFilter } from "../api/analytics-query";
import { describeFilter, FilterEditor } from "./options";
import { fmtValue, useMetric } from "./shared";

const STATUS_LABEL: Record<string, string> = { Projected: "projected", NotStatisticallySignificant: "not significant", InsufficientSampleSize: "small sample" };
const MAX_LINES = 6;
const MAX_BARS = 25;

export function timeLabelFor(granularity: Granularity): (t: number) => string {
	return (t) => {
		const d = new Date(t);
		const day = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
		if (granularity === "OneMinute" || granularity === "HalfHour" || granularity === "OneHour") return `${day} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
		if (granularity === "OneMonth") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
		return day;
	};
}

const AGG_LABEL: Record<MetricDef["aggregate"], string> = { sum: "total", mean: "average", max: "peak", last: "latest" };

export function MetricCard({
	universeId,
	metric,
	range,
	granularity: wanted,
	groupFilter,
	autoLoad,
	waiting,
}: {
	universeId: number;
	metric: MetricDef;
	range: RangeSpec;
	granularity: GranularityChoice;
	/** The group's pick (a funnel, event, currency) applied to every card. */
	groupFilter?: QueryFilter | null;
	autoLoad: boolean;
	/** Why the card can't load yet (a required pick missing). */
	waiting?: string | null;
}) {
	const p = useTheme();
	const [variant, setVariant] = useState(metric.id);
	const [breakdown, setBreakdown] = useState<string[]>(metric.defaultBreakdown ?? []);
	const [filters, setFilters] = useState<QueryFilter[]>([]);
	const [limitText, setLimitText] = useState(metric.limit ? String(metric.limit) : "");
	const [options, setOptions] = useState(false);
	const [requested, setRequested] = useState(false);

	// The granularity is picked for the span the query really covers (after the metric's retention cap).
	const span = effectiveSpanDays(range, metric);
	const { granularity, note, maxDays } = resolveGranularity(metric, wanted, span);
	const tr = timeRange(range, metric, granularity, { maxDays });
	const limitN = Number(limitText);
	const limitOk = limitText === "" || (Number.isInteger(limitN) && limitN >= 1 && limitN <= 1000);
	const filter = [...(groupFilter ? [groupFilter] : []), ...filters];
	const query = {
		metric: variant,
		granularity,
		startTime: tr.startTime,
		endTime: tr.endTime,
		...(breakdown.length ? { breakdown } : {}),
		...(filter.length ? { filter } : {}),
		...(granularity === "None" && breakdown.length && limitOk && limitText ? { limit: limitN } : {}),
	};
	const enabled = !waiting && (autoLoad || requested);
	const q = useMetric(universeId, query, enabled);

	const all: MetricSeries[] = q.data ? normalizeRates(q.data, metric.format) : [];
	const fmt = (v: number) => fmtValue(metric.format, v);
	const asBars = granularity === "None" || (breakdown.length > 0 && all.every((s) => s.dataPoints.length <= 1));
	const strings = all.filter((s) => s.dataPoints.some((d) => d.stringValues?.length));
	const statuses = new Map<string, number>();
	for (const s of all) for (const d of s.dataPoints) if (d.status && d.status !== "Valid") statuses.set(d.status, (statuses.get(d.status) ?? 0) + 1);

	let headline: number | null = null;
	if (all.length === 1) {
		const pts = all[0]!.dataPoints.map((d) => d.value);
		headline = granularity === "None" ? (pts[0] ?? null) : aggregate(pts, metric.aggregate);
	}

	// Label order (funnel steps, session buckets, stages) only means something for the breakdown it was set for; any other
	// breakdown is ranked by value so the biggest bars come first.
	const byLabel = metric.order === "label" && breakdown.join() === (metric.defaultBreakdown ?? []).join();
	const bars = asBars
		? all
				.map((s) => ({ label: seriesLabel(s), value: aggregate(s.dataPoints.map((d) => d.value), metric.aggregate) ?? 0 }))
				.sort((a, b) => (byLabel ? naturalCompare(a.label, b.label) : b.value - a.value))
		: [];
	const lines = !asBars ? topSeries(all, breakdown.length ? MAX_LINES : 1) : [];
	const chart = lines.map((s) => ({ label: seriesLabel(s), points: s.dataPoints.map((d) => ({ t: Date.parse(d.time), v: d.value })) }));
	const dims = metric.breakdowns;

	return (
		<Card style={{ gap: 8 }}>
			<View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
				<View style={{ flex: 1, gap: 2 }}>
					<Txt style={{ fontWeight: "600" }}>{metric.title}</Txt>
					<Txt variant="small">{metric.help}</Txt>
				</View>
				{headline !== null && !breakdown.length ? (
					<View style={{ alignItems: "flex-end" }}>
						<Txt variant="h3" style={{ fontWeight: "700" }}>
							{fmt(headline)}
						</Txt>
						<Txt variant="small">{granularity === "None" ? "for the range" : AGG_LABEL[metric.aggregate]}</Txt>
					</View>
				) : null}
			</View>

			{metric.variants ? <Chips options={metric.variants.map((v) => ({ value: v.id, label: v.label }))} value={variant} onChange={setVariant} /> : null}
			{dims.length ? (
				<Chips
					options={[{ value: "", label: "Total" }, ...dims.map((d) => ({ value: d, label: dimLabel(d) }))]}
					value={breakdown[0] ?? ""}
					onChange={(d) => setBreakdown(d ? [d, ...breakdown.slice(1).filter((x) => x !== d)] : [])}
				/>
			) : null}

			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
				<Badge label={GRANULARITY_LABEL[granularity]} />
				{breakdown.length > 1 ? <Badge label={`by ${breakdown.map(dimLabel).join(" × ")}`} tone="brand" /> : null}
				{filters.map((f, i) => (
					<Badge key={i} label={describeFilter(f)} tone="brand" icon="funnel-outline" />
				))}
				{[...statuses].map(([s, n]) => (
					<Badge key={s} label={`${n} ${STATUS_LABEL[s] ?? s}`} tone="warning" />
				))}
				{dims.length ? <Button title={options ? "Done" : "Options"} icon="options-outline" small variant="ghost" onPress={() => setOptions(!options)} /> : null}
			</View>
			{note ? <Txt variant="small">{note}</Txt> : null}
			{tr.capped ? <Txt variant="small">Roblox keeps {metric.retentionDays ?? 1468} days of this metric; shown from {tr.startTime.slice(0, 10)}.</Txt> : null}

			{options ? (
				<View style={{ gap: 10, paddingTop: 4 }}>
					{breakdown.length && dims.length > 1 ? (
						<View style={{ gap: 6 }}>
							<Txt variant="label">Then by</Txt>
							<Chips
								options={[{ value: "", label: "Nothing" }, ...dims.filter((d) => d !== breakdown[0]).map((d) => ({ value: d, label: dimLabel(d) }))]}
								value={breakdown[1] ?? ""}
								onChange={(d) => setBreakdown(d ? [breakdown[0]!, d] : [breakdown[0]!])}
							/>
						</View>
					) : null}
					{granularity === "None" && breakdown.length ? (
						<Field label="Top N (empty: all)" value={limitText} onChangeText={setLimitText} keyboardType="number-pad" maxLength={4} hint={limitOk ? undefined : "A whole number from 1 to 1000."} />
					) : null}
					<Txt variant="label">Filters</Txt>
					<FilterEditor universeId={universeId} metric={variant} dimensions={dims} startTime={tr.startTime} endTime={tr.endTime} filters={filters} onApply={setFilters} />
				</View>
			) : null}

			{waiting ? <Txt variant="muted">{waiting}</Txt> : null}
			{!waiting && !enabled ? <Button title="Load chart" icon="stats-chart-outline" small onPress={() => setRequested(true)} style={{ alignSelf: "flex-start" }} /> : null}
			{enabled && q.isLoading ? <Skeleton height={asBars || breakdown.length ? 120 : 150} /> : null}
			{q.error ? <CloudError error={q.error} what={metric.title} onRetry={() => q.refetch()} /> : null}
			{q.data && !all.some((s) => s.dataPoints.length) ? <Txt variant="muted">No data in this range.</Txt> : null}

			{strings.length ? (
				<View style={{ gap: 6 }}>
					{strings.slice(0, MAX_BARS).map((s, i) => (
						<View key={i} style={{ gap: 2 }}>
							<Txt variant="small" color={p.foreground} numberOfLines={1}>
								{seriesLabel(s)}
							</Txt>
							<Txt variant="small" selectable>
								{Array.from(new Set(s.dataPoints.flatMap((d) => d.stringValues ?? []))).join(", ") || "–"}
							</Txt>
						</View>
					))}
				</View>
			) : null}

			{bars.length && !(strings.length && bars.every((b) => !b.value)) ? (
				<>
					{bars.length === 1 && !breakdown.length ? null : <ShareBars exportTitle={`${metric.title}: breakdown`} rows={bars.slice(0, MAX_BARS)} format={fmt} />}
					{bars.length > MAX_BARS ? <Txt variant="small">The first {MAX_BARS} of {bars.length}; set Top N or a filter to narrow it.</Txt> : null}
				</>
			) : null}

			{chart.some((s) => s.points.length) ? (
				<>
					<LineChart exportTitle={metric.title} series={chart} height={150} format={fmt} timeLabel={timeLabelFor(granularity)} />
					{chart.length > 1 ? <Legend items={chart.map((c, i) => ({ label: c.label, color: p.chart[i % p.chart.length]! }))} /> : null}
					{breakdown.length && all.length > lines.length ? <Txt variant="small">The {lines.length} biggest of {all.length}.</Txt> : null}
				</>
			) : null}
		</Card>
	);
}
