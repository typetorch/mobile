/**
 * A read-only SQL answer (POST /v1/sql) drawn like the web's components/SavedQueryView.tsx: its chart (bar or line over
 * the first column), its columns for a DataTable, and a pinned saved query's tile on the Overview (SavedQueryTile:
 * its own range, at most TILE_ROWS rows, "Open" goes to the Query page with the query picked).
 */
import { router } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import type { SavedQuery, SqlResult } from "@/api/tt/types";
import { LineChart, ShareBars } from "@/charts/LineChart";
import { Button, ErrorState, SkeletonList, Txt } from "@/components/ui";
import { fmtInt } from "@/lib/format";

import { Note, Panel } from "./bits";
import { useTTQuery } from "./hooks";
import { DataTable, typeFromSql, type DataColumn } from "./table";

export const TILE_ROWS = 200;

const cellText = (value: unknown): string => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
const NUMERIC = /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?\d*|FLOAT\d*|DOUBLE|REAL|DECIMAL.*|NUMERIC.*)$/;

/** The chart's x column (the first) and up to four number columns after it, as the web's chartShape. */
export function chartShape(result: SqlResult): { x: number; series: number[] } | undefined {
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

/** The DataTable columns of a SQL answer (types from the SQL types; text columns get a contains filter). */
export function sqlColumns(columns: SqlResult["columns"]): DataColumn<unknown[]>[] {
	return columns.map(
		(c, i): DataColumn<unknown[]> => ({
			id: `${c.name}-${i}`,
			header: c.name,
			hint: c.type.toLowerCase(),
			width: NUMERIC.test(c.type.toUpperCase()) ? 96 : 150,
			...(typeFromSql(c.type) ? { type: typeFromSql(c.type) } : {}),
			mono: true,
			accessor: (row) => row[i],
			format: (v) => cellText(v),
			filter: typeFromSql(c.type) ? undefined : "text",
		}),
	);
}

/** One pinned saved query on the Overview: its answer as its chart (or a table), and a link to it on the Query page. */
export function SavedQueryTile({ backendId, query }: { backendId: string; query: SavedQuery }) {
	const run = useTTQuery(backendId, ["saved-query-run", query.id, query.sql], (api, signal) => api.sql(query.sql, TILE_ROWS, signal), { staleTime: 60_000, retry: false });
	const chart = query.chart && query.chart !== "table" ? query.chart : undefined;
	const columns = useMemo(() => (run.data ? sqlColumns(run.data.columns) : []), [run.data]);
	return (
		<Panel
			title={query.name}
			note={run.data ? `${fmtInt(run.data.rows.length)} row${run.data.rows.length === 1 ? "" : "s"}${run.data.truncated ? " (more exist)" : ""}, its own range (not the filter bar's)` : "Saved query"}
			right={<Button title="Open" small variant="ghost" icon="open-outline" onPress={() => router.push(`/tt/${backendId}/query?tab=sql&saved=${query.id}` as never)} />}
		>
			{run.data === undefined && !run.error ? (
				<SkeletonList rows={3} />
			) : run.error ? (
				<ErrorState error={run.error} title="This query failed" onRetry={() => run.refetch()} />
			) : run.data ? (
				chart ? (
					<ResultChart result={run.data} chart={chart} />
				) : (
					<DataTable id={`saved-tile-${query.id}`} label={query.name} columns={columns} data={run.data.rows} pageSize={25} urlSync={false} rowJson={(row) => Object.fromEntries((run.data?.columns ?? []).map((c, i) => [c.name, row[i]]))} />
				)
			) : null}
		</Panel>
	);
}

/** The saved queries pinned to the Overview (Query page); nothing when none are, or the backend has no saved queries. */
export function PinnedQueries({ backendId }: { backendId: string }) {
	const list = useTTQuery(backendId, ["saved-queries"], (api, signal) => api.savedQueries(signal), { retry: false, staleTime: 30_000 });
	const pinned = (list.data ?? []).filter((q) => q.pinned);
	if (!pinned.length) return null;
	return (
		<View style={{ gap: 12 }}>
			{pinned.map((q) => (
				<SavedQueryTile key={q.id} backendId={backendId} query={q} />
			))}
		</View>
	);
}
