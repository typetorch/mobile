/**
 * Benchmarks (Creator Hub's Overview comparison): the experience's own daily metric against Roblox's percentiles for
 * same-genre, similar or top experiences, from the Analytics Benchmark API (EXPERIMENTAL; endTime inclusive, at most
 * 400 days). The own line is the Analytics Query API's daily series over the same days (its endTime is exclusive).
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { LineChart, Legend } from "@/charts/LineChart";
import { Badge, Card, Chips, Segmented, Skeleton, Txt } from "@/components/ui";
import { CloudError } from "@/features/project/CloudError";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

import { ALL_METRICS, benchmarkSlot, DAY, normalizeRates, timeRange, type MetricDef, type RangeSpec } from "../analytics";
import { queryBenchmarks, type BenchmarkQuery, type BenchmarkType } from "../api/analytics-query";
import { CACHE, fmtValue, useMetric } from "./shared";

/** Metrics Creator Hub benchmarks (the API answers no points for one without benchmark data). */
const BENCHMARKED = [
	"ForwardD1Retention",
	"ForwardD7Retention",
	"ForwardD30Retention",
	"AveragePlayTimeMinutesPerDAU",
	"AverageSessionLengthMinutes",
	"DauMauStickiness",
	"PayingUsersCVR",
	"AverageRevenuePerUser",
	"AverageRevenuePerPayingUser",
	"QualifiedEndToEndCVR",
	"DailyActiveUsers",
	"MonthlyActiveUsers",
	"DailyRevenue",
	"PayingUsers",
	"TotalPlayTimeHours",
	"Visits",
	"UniqueAbuseReportSubmittersPer1000PlaytimeHours",
];
/** The metrics Roblox benchmarks only against the top experiences. */
const TOP_ONLY = new Set(["DailyActiveUsers", "DailyRevenue", "MonthlyActiveUsers", "PayingUsers", "TotalPlayTimeHours", "UniqueAbuseReportSubmittersPer1000PlaytimeHours", "Visits"]);
const SAFETY: MetricDef = { id: "UniqueAbuseReportSubmittersPer1000PlaytimeHours", title: "Reporters per 1,000 hours", help: "", format: "decimal", granularities: ["OneDay"], breakdowns: [], aggregate: "mean" };
const METRICS: MetricDef[] = BENCHMARKED.map((id) => ALL_METRICS.find((m) => m.id === id) ?? (id === SAFETY.id ? SAFETY : null)).filter((m): m is MetricDef => !!m);

const TYPES: { value: "" | BenchmarkType; label: string }[] = [
	{ value: "", label: "Default" },
	{ value: "BENCHMARK_TYPE_GENRE", label: "Genre" },
	{ value: "BENCHMARK_TYPE_SIMILARITY", label: "Similar" },
	{ value: "BENCHMARK_TYPE_TOP_EXPERIENCES", label: "Top" },
];
const TYPE_LABEL: Record<string, string> = { BENCHMARK_TYPE_GENRE: "genre", BENCHMARK_TYPE_SIMILARITY: "similar experiences", BENCHMARK_TYPE_TOP_EXPERIENCES: "top experiences" };
const PERCENTILES = [10, 50, 90];

/** A 7-day trailing mean (the l7_average variant's own line). */
function rolling7(points: { t: number; v: number | null }[]): { t: number; v: number | null }[] {
	return points.map((pt, i) => {
		const w = points.slice(Math.max(0, i - 6), i + 1).map((x) => x.v).filter((v): v is number => v !== null);
		return { t: pt.t, v: i >= 6 && w.length ? w.reduce((a, b) => a + b, 0) / w.length : null };
	});
}

export function Benchmarks({ universeId, range }: { universeId: number; range: RangeSpec }) {
	const p = useTheme();
	const { cloud } = useAccounts();
	const [metricId, setMetricId] = useState(METRICS[0]!.id);
	const [type, setType] = useState<"" | BenchmarkType>("");
	const [percentiles, setPercentiles] = useState<number[]>([]);
	const [l7, setL7] = useState(false);
	const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0]!;
	const topOnly = TOP_ONLY.has(metric.id);
	const kind: "" | BenchmarkType = topOnly ? "" : type;

	// Whole days; the benchmark end is inclusive and at most 400 days after the start.
	const tr = timeRange(range, { retentionDays: 400 }, "OneDay");
	const lastDay = new Date(Date.parse(tr.endTime) - DAY).toISOString();
	const own = useMetric(universeId, { metric: metric.id, granularity: "OneDay", startTime: tr.startTime, endTime: tr.endTime });
	const body: BenchmarkQuery = {
		metric: metric.id,
		startTime: tr.startTime,
		endTime: lastDay,
		...(kind ? { benchmarkType: kind } : {}),
		...(percentiles.length && kind !== "BENCHMARK_TYPE_TOP_EXPERIENCES" && !topOnly ? { percentiles } : {}),
		...(l7 ? { benchmarkVariantId: "l7_average" as const } : {}),
	};
	const bench = useQuery({
		queryKey: ["oc", "analytics", universeId, "benchmark", body],
		enabled: !!cloud,
		...CACHE,
		queryFn: ({ signal }) => benchmarkSlot(() => queryBenchmarks(cloud!, universeId, body, signal)),
	});

	const ownSeries = own.data ? normalizeRates(own.data, metric.format) : [];
	const ownPoints = (ownSeries[0]?.dataPoints ?? []).map((d) => ({ t: Date.parse(d.time), v: d.value }));
	const benchValues = bench.data?.values ?? [];
	// Benchmarks come in the metric's units; rates follow the own series' scale (fractions).
	const percent = metric.format === "rate" && benchValues.some((s) => s.dataPoints.some((d) => (d.value ?? 0) > 1));
	const chart = [
		{ label: l7 ? "You (7-day average)" : "You", points: l7 ? rolling7(ownPoints) : ownPoints, color: p.chart[0] },
		...benchValues.map((s, i) => {
			const pctl = s.breakdownValue.find((b) => b.dimension === "Percentile")?.value;
			const rest = s.breakdownValue.filter((b) => b.dimension !== "Percentile").map((b) => b.displayValue || b.value);
			return {
				label: [pctl ? `P${pctl}` : "Benchmark", ...rest].join(" · "),
				points: s.dataPoints.map((d) => ({ t: Date.parse(d.time), v: d.value === null ? null : percent ? d.value / 100 : d.value })),
				color: p.chart[(i + 1) % p.chart.length],
				dashed: true,
			};
		}),
	];
	const meta = benchValues.flatMap((s) => s.dataPoints.map((d) => d.metadata)).find((m) => m?.benchmarkType);
	const objective = bench.data?.objective;
	const fmt = (v: number) => fmtValue(metric.format, v);
	const latest = (pts: { v: number | null }[]) => [...pts].reverse().find((x) => x.v !== null)?.v ?? null;

	return (
		<Card style={{ gap: 10 }}>
			<Txt style={{ fontWeight: "600" }}>Benchmarks</Txt>
			<Txt variant="small">Your daily {metric.title.toLowerCase()} next to the percentiles of comparable experiences (Roblox's Benchmark API, experimental).</Txt>
			<Chips options={METRICS.map((m) => ({ value: m.id, label: m.title }))} value={metricId} onChange={setMetricId} />
			{tr.capped ? <Txt variant="small">Benchmarks cover at most 400 days; shown from {tr.startTime.slice(0, 10)}.</Txt> : null}
			{topOnly ? (
				<Txt variant="small">Roblox compares this metric only with the top experiences.</Txt>
			) : (
				<Segmented options={TYPES} value={type} onChange={setType} />
			)}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
				{kind !== "BENCHMARK_TYPE_TOP_EXPERIENCES" && !topOnly
					? PERCENTILES.map((n) => {
							const on = percentiles.includes(n);
							return (
								<Pressable key={n} onPress={() => setPercentiles(on ? percentiles.filter((x) => x !== n) : [...percentiles, n].sort((a, b) => a - b))}>
									<Badge label={`P${n}`} tone={on ? "brand" : "muted"} icon={on ? "checkmark" : undefined} />
								</Pressable>
							);
						})
					: null}
				<Pressable onPress={() => setL7(!l7)}>
					<Badge label="7-day average" tone={l7 ? "brand" : "muted"} icon={l7 ? "checkmark" : undefined} />
				</Pressable>
			</View>
			{!percentiles.length && kind !== "BENCHMARK_TYPE_TOP_EXPERIENCES" && !topOnly ? <Txt variant="small">No percentile picked: Roblox's default (P50 and P90, or P10 and P50 when lower is better).</Txt> : null}

			{own.isLoading || bench.isLoading ? <Skeleton height={160} /> : null}
			{bench.error ? <CloudError error={bench.error} what="Benchmarks" onRetry={() => bench.refetch()} /> : null}
			{own.error ? <CloudError error={own.error} what={metric.title} onRetry={() => own.refetch()} /> : null}

			{bench.data && !benchValues.length ? (
				<View style={{ gap: 6 }}>
					<Txt variant="muted">No benchmark of this kind for this metric and range.</Txt>
					{bench.data.availableTypes.length ? (
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
							<Txt variant="small">Available:</Txt>
							{bench.data.availableTypes.map((t) => (
								<Pressable key={t} onPress={() => setType(t as BenchmarkType)}>
									<Badge label={TYPE_LABEL[t] ?? t} tone="brand" />
								</Pressable>
							))}
						</View>
					) : null}
				</View>
			) : null}

			{chart.some((s) => s.points.length) && !(own.isLoading || bench.isLoading) ? (
				<>
					<LineChart series={chart} height={170} format={fmt} area={false} />
					<Legend items={chart.map((c) => ({ label: c.label, color: c.color ?? p.brand }))} />
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
						{meta?.benchmarkType ? <Badge label={`vs ${TYPE_LABEL[meta.benchmarkType] ?? meta.benchmarkType}${meta.genre ? ` (${meta.genre === "general" ? "all experiences" : meta.genre})` : ""}`} /> : null}
						{objective === "BENCHMARK_OBJECTIVE_MINIMIZE" ? <Badge label="lower is better" /> : objective === "BENCHMARK_OBJECTIVE_MAXIMIZE" ? <Badge label="higher is better" /> : null}
					</View>
					<View style={{ gap: 2 }}>
						{chart.map((c) => (
							<Txt key={c.label} variant="small">
								{c.label}, latest: {fmt(latest(c.points) ?? Number.NaN)}
							</Txt>
						))}
					</View>
				</>
			) : null}
		</Card>
	);
}
