/**
 * Read-only SQL results (POST /v1/sql) as a table with a chart, shared by the Query page and the saved queries pinned
 * to the Overview (the web's SavedQueryView: ResultChart, ResultTable, SavedQueryTile).
 */
import { router } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import type { SavedQuery, SavedQueryChart, SqlResult } from "@/api/tt/types";
import { LineChart, ShareBars } from "@/charts/LineChart";
import { Button, Card, Skeleton, Txt } from "@/components/ui";
import { fmtInt } from "@/lib/format";

import { CopyButton, MiniTable, Note, Panel } from "./bits";
import { useTTQuery } from "./hooks";

/** Rows a pinned tile asks for (the web's TILE_ROWS). */
export const TILE_ROWS = 200;

export const cellText = (value: unknown): string => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
const NUMERIC = /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?\d*|FLOAT\d*|DOUBLE|REAL|DECIMAL.*|NUMERIC.*)$/;

/** The chart's x column (the first) and up to four number columns after it, as the web's chartShape. */
function chartShape(result: SqlResult): { x: number; series: number[] } | undefined {
	if (result.columns.length < 2 || !result.rows.length) return undefined;
	const series: number[] = [];
	for (let i = 1; i < result.columns.length && series.length < 4; i++) {
		const numeric = NUMERIC.test((result.columns[i]?.type ?? "").toUpperCase()) || result.rows.every((r) => r[i] === null || typeof r[i] === "number" || (typeof r[i] === "string" && r[i] !== "" && Number.isFinite(Number(r[i]))));
		if (numeric) series.push(i);
	}
	return series.length ? { x: 0, series } : undefined;
}

export function ResultChart({ result, chart }: { result: SqlResult; chart: "bar" | "line" }) {
	const shape = useMemo(() => chartShape(result), [result]);
	if (!shape) return <Note>Nothing to chart: it needs a first column and at least one number column after it.</Note>;
	const num = (v: unknown) => {
		const n = v === null || v === undefined ? Number.NaN : Number(v);
		return Number.isFinite(n) ? n : null;
	};
	if (chart === "bar") {
		const s = shape.series[0] as number;
		return (
			<View style={{ gap: 6 }}>
				<Txt variant="label">{result.columns[s]?.name}</Txt>
				<ShareBars rows={result.rows.slice(0, 40).map((r) => ({ label: cellText(r[shape.x]), value: num(r[s]) ?? 0 }))} />
			</View>
		);
	}
	// A line over the x column: times when it parses as a date or unix ms, else the row order.
	const xs = result.rows.map((r, i) => {
		const v = r[shape.x];
		if (typeof v === "number" && v > 1e11) return v;
		const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
		return Number.isFinite(t) ? t : i;
	});
	const asTime = xs.every((x, i) => x !== i) || xs.some((x) => x > 1e11);
	return (
		<LineChart
			area={false}
			series={shape.series.map((s) => ({ label: result.columns[s]?.name ?? "", points: result.rows.map((r, i) => ({ t: xs[i] as number, v: num(r[s]) })) }))}
			{...(asTime ? {} : { timeLabel: (t: number) => cellText(result.rows[t]?.[shape.x]).slice(0, 10) })}
		/>
	);
}

export function SqlResultView({ data, chart }: { data: SqlResult; chart: SavedQueryChart | null }) {
	const columns = useMemo(
		() =>
			data.columns.map((c, i) => ({
				key: `${c.name}-${i}`,
				header: c.name,
				width: NUMERIC.test(c.type.toUpperCase()) ? 90 : 150,
				align: NUMERIC.test(c.type.toUpperCase()) ? ("right" as const) : ("left" as const),
				mono: true,
				render: (row: unknown[]) => cellText(row[i]),
			})),
		[data.columns],
	);
	const csv = useMemo(() => [data.columns.map((c) => c.name).join("\t"), ...data.rows.map((r) => r.map(cellText).join("\t"))].join("\n"), [data]);
	return (
		<Panel title={`${fmtInt(data.rows.length)} row${data.rows.length === 1 ? "" : "s"}${data.truncated ? " (more exist: raise the limit or narrow the query)" : ""}`} note={`${data.ms} ms on the server`}>
			{chart && chart !== "table" ? (
				<Card>
					<ResultChart result={data} chart={chart} />
				</Card>
			) : null}
			<MiniTable columns={columns} rows={data.rows} max={100} />
			<CopyButton text={csv} title="Copy as TSV" />
		</Panel>
	);
}

/** One saved query pinned to the Overview: run with its own SQL and range (not the filter bar's), as its chart or a table. */
export function SavedQueryTile({ backendId, query }: { backendId: string; query: SavedQuery }) {
	const run = useTTQuery(backendId, ["saved-query-run", query.id, query.sql], (api, s) => api.sql(query.sql, TILE_ROWS, s), { staleTime: 60_000, retry: false });
	const chart = query.chart && query.chart !== "table" ? query.chart : undefined;
	return (
		<Panel
			title={query.name}
			note={run.data ? `${fmtInt(run.data.rows.length)} row${run.data.rows.length === 1 ? "" : "s"}${run.data.truncated ? " (more exist)" : ""}, its own range (not the filter bar's)` : "Saved query"}
			right={<Button title="Open" small variant="ghost" onPress={() => router.push(`/tt/${backendId}/query`)} />}
		>
			{run.error ? (
				<Txt variant="small">This query failed: {run.error.message}</Txt>
			) : !run.data ? (
				<Skeleton height={100} />
			) : chart ? (
				<ResultChart result={run.data} chart={chart} />
			) : (
				<MiniTable
					columns={run.data.columns.map((c, i) => ({ key: `${c.name}-${i}`, header: c.name, width: NUMERIC.test(c.type.toUpperCase()) ? 90 : 150, align: NUMERIC.test(c.type.toUpperCase()) ? ("right" as const) : ("left" as const), mono: true, render: (row: unknown[]) => cellText(row[i]) }))}
					rows={run.data.rows}
					max={25}
				/>
			)}
		</Panel>
	);
}
