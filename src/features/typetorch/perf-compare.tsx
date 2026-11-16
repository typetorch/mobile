/**
 * The Performance page's compare table (`perf-compare`: builds side by side, or before vs after a deploy), shared with
 * the deploy page's "Before vs after" (web pages/Performance.tsx CompareTable): per metric and percentile each period's
 * value (orange / red past the absolute thresholds), the change, and the regression colour.
 */
import { useMemo } from "react";
import { View } from "react-native";

import { CLIENT_METRIC_KEYS, delta, fmtDelta, fmtMetric, groupLabel, METRICS, PERCENTILES, percentileName, SERVER_METRIC_KEYS, type ComparePeriod, type PerfCompareResult } from "@/api/tt/perf";
import { absoluteFlag, REGRESSION_PCT, regression, type Flag, type Regression } from "@/api/tt/perf-thresholds";
import { Txt } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import { useTheme, type Palette } from "@/theme";

import { Note } from "./bits";
import { DataTable, type DataColumn } from "./table";

export function flagColor(p: Palette, flag: Flag | null | undefined): string | undefined {
	return flag ? (flag.level === "critical" ? p.destructive : p.warning) : undefined;
}

export function metricLabel(side: "client" | "server", k: string) {
	return side === "server" && k === "mem" ? "Server memory" : (METRICS[k]?.label ?? k);
}


const COMPARE_ROWS: { side: "client" | "server"; key: string }[] = [...CLIENT_METRIC_KEYS.map((key) => ({ side: "client" as const, key })), ...SERVER_METRIC_KEYS.map((key) => ({ side: "server" as const, key }))];

function comparePeriodLabel(result: PerfCompareResult, x: ComparePeriod): string {
	if (result.mode === "around") {
		const hours = Math.round((result.windowMs ?? 0) / 3_600_000);
		return `${x.key === "before" ? "Before" : "After"} (${hours ? `${hours} h` : `${Math.round((result.windowMs ?? 0) / 60_000)} min`})`;
	}
	return groupLabel("art", x.key, x.seq);
}

interface CompareRow {
	id: string;
	label: string;
	key: string;
	values: (number | null)[];
	change: ReturnType<typeof delta>;
	flags: (Flag | null)[];
	regression: Regression | null;
}

function changeOrder(result: PerfCompareResult): [number, number] | null {
	const [a, b] = result.periods;
	if (!a || !b || result.periods.length !== 2) return null;
	if (result.mode === "around") return a.key === "after" ? [1, 0] : [0, 1];
	if (typeof a.seq === "number" && typeof b.seq === "number" && a.seq !== b.seq) return a.seq < b.seq ? [0, 1] : [1, 0];
	return [1, 0];
}

function compareRows(result: PerfCompareResult): { pinned: CompareRow[]; rows: CompareRow[] } {
	const periods = result.periods;
	const order = changeOrder(result);
	const info = (side: "client" | "server", key: string) => (side === "client" ? result.clientMetrics : result.serverMetrics).find((m) => m.key === key);
	const pinned: CompareRow[] = [
		{ id: "client-samples", label: "Client samples", key: "samples", values: periods.map((x) => x.client.samples), change: null, flags: [], regression: null },
		{ id: "server-samples", label: "Server samples", key: "samples", values: periods.map((x) => x.server.samples), change: null, flags: [], regression: null },
	];
	const rows = COMPARE_ROWS.flatMap(({ side, key }) =>
		PERCENTILES.map((pct): CompareRow => {
			const values = periods.map((x) => x[side].metrics[key]?.[pct] ?? null);
			const counts = periods.map((x) => x[side].metrics[key]?.n ?? 0);
			const higher = info(side, key)?.higherIsBetter ?? true;
			return {
				id: `${side}-${key}-${pct}`,
				label: `${metricLabel(side, key)} ${percentileName(pct)}`,
				key,
				values,
				change: order ? delta(values[order[0]], values[order[1]], higher) : null,
				flags: values.map((v, i) => absoluteFlag(side, key, pct, v, counts[i])),
				regression: order ? regression(values[order[0]], values[order[1]], higher, counts[order[0]] ?? 0, counts[order[1]] ?? 0) : null,
			};
		}),
	);
	return { pinned, rows };
}

export function CompareTable({ result }: { result: PerfCompareResult }) {
	const p = useTheme();
	const { pinned, rows } = useMemo(() => compareRows(result), [result]);
	const order = changeOrder(result);
	const fmt = (r: CompareRow, v: number | null | undefined) => (r.key === "samples" ? fmtInt(v) : fmtMetric(r.key, v));
	const columns: DataColumn<CompareRow>[] = [
		{ id: "metric", header: "Metric", width: 130, accessor: (r) => r.label },
		...result.periods.map(
			(x, i): DataColumn<CompareRow> => ({
				id: `p${i}`,
				header: comparePeriodLabel(result, x),
				width: 100,
				type: "number",
				accessor: (r) => r.values[i] ?? null,
				format: (_v, r) => fmt(r, r.values[i]),
				cell: (r) => (
					<Txt variant="small" color={flagColor(p, r.flags[i]) ?? p.foreground} style={r.flags[i] ? { fontWeight: "700" } : undefined}>
						{fmt(r, r.values[i])}
					</Txt>
				),
			}),
		),
		...(order
			? [
					{
						id: "change",
						header: result.mode === "around" ? "Change (after vs before)" : "Change (newer vs older)",
						width: 116,
						type: "number" as const,
						accessor: (r: CompareRow) => (r.key === "samples" || !r.change ? null : r.change.pct),
						format: (_v: unknown, r: CompareRow) => (r.key === "samples" ? "" : `${fmtDelta(r.change)}${r.change && r.change.better !== null ? ` ${r.change.better ? "better" : "worse"}` : ""}`),
						cell: (r: CompareRow) => {
							if (r.key === "samples") return "";
							const reg = r.regression;
							const text = `${fmtDelta(r.change)}${r.change && r.change.better !== null ? ` ${r.change.better ? "better" : "worse"}` : ""}`;
							if (reg?.kind === "few") return <Txt variant="small">{fmtDelta(r.change)} few samples</Txt>;
							const color = reg?.kind === "worse" && reg.level ? (reg.level === "critical" ? p.destructive : p.warning) : reg?.kind === "better" ? p.good : p.foreground;
							return (
								<Txt variant="small" color={color}>
									{text}
								</Txt>
							);
						},
					},
				]
			: []),
	];
	return (
		<View style={{ gap: 6 }}>
			<DataTable id={`perf-compare-${result.mode}`} label="Compare" columns={columns} data={rows} pinnedRows={pinned} rowId={(r) => r.id} />
			{order ? <Note>Orange is worse by over {REGRESSION_PCT.warning}%, red by over {REGRESSION_PCT.critical}%, green is better.</Note> : null}
		</View>
	);
}
