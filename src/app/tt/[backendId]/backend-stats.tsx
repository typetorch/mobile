/**
 * Backend stats (owners only, GET /v1/admin/stats): what the backend process itself is doing. Requests, DuckDB queries,
 * rows in and loaded, SQLite statements per second; latency p50 / p90 / p99; memory, CPU and event loop lag; over the last
 * 2 minutes (per second) or the last hour (per minute), with deploys as dashed lines; and a table per route group. Polls
 * every 2 s while Live is on.
 */
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { View } from "react-native";

import type { BackendStats, RouteGroup, StatsBucket, StatsWindow } from "@/api/tt/types";
import { LineChart, type ChartSeries } from "@/charts/LineChart";
import { Button, Card, EmptyState, ErrorState, KV, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { Note, Panel } from "@/features/typetorch/bits";
import { DataTable } from "@/features/typetorch/table";
import { useTTQuery } from "@/features/typetorch/hooks";
import { MarkList, useDeployMarks } from "@/features/typetorch/marks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtBytes, fmtDuration, fmtInt, fmtNum, fmtTime } from "@/lib/format";
import { useTheme } from "@/theme";

const WINDOWS: { value: StatsWindow; label: string }[] = [
	{ value: "1m", label: "1 min" },
	{ value: "5m", label: "5 min" },
	{ value: "15m", label: "15 min" },
	{ value: "1h", label: "1 hour" },
];

type History = "seconds" | "minutes";
const HISTORIES: { value: History; label: string }[] = [
	{ value: "seconds", label: "Last 2 min" },
	{ value: "minutes", label: "Last 60 min" },
];

const ROUTE_LABELS: Record<RouteGroup, string> = {
	ingest: "Ingest (events, identities)",
	"errors-in": "Error logs in",
	"fleet-in": "Fleet posts (heartbeats, reports)",
	"long-poll": "Remote debug long-poll",
	stream: "Event streams (SSE)",
	query: "Queries",
	sql: "SQL sandbox",
	rollups: "Rollups",
	errors: "Errors, experiments, players",
	fleet: "Fleet reads",
	roblox: "Roblox lookups, identity",
	auth: "Sign-in",
	admin: "Admin (settings, storage, stats)",
	health: "Health check",
	explorer: "Explorer files",
	other: "Other",
};

const ms = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : `${fmtNum(v, v < 10 ? 2 : v < 100 ? 1 : 0)} ms`);
const perSecond = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : fmtNum(v, v < 10 ? 2 : v < 100 ? 1 : 0));
const mb = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : `${fmtNum(v, v < 1000 ? 1 : 0)} MB`);

interface StatsRow {
	t: number;
	[series: string]: number | null;
}

/** The web's timeline(): every second or minute, oldest first, counters per second; a missing bucket is a quiet one. */
function timeline(stats: Pick<BackendStats, "now" | "seconds" | "minutes">, history: History): StatsRow[] {
	const span = history === "seconds" ? 1000 : 60_000;
	const count = history === "seconds" ? 120 : 60;
	const buckets = new Map((history === "seconds" ? stats.seconds : stats.minutes).map((b) => [b.at, b]));
	const end = history === "seconds" ? Math.floor(stats.now / span) * span - span : Math.floor(stats.now / span) * span;
	const rows: StatsRow[] = [];
	for (let i = count - 1; i >= 0; i--) {
		const at = end - i * span;
		const b: StatsBucket | undefined = buckets.get(at);
		const rate = (n: number) => Math.round((n / (span / 1000)) * 100) / 100;
		rows.push({
			t: at,
			requests: rate(b?.requests ?? 0),
			errors: rate(b?.status["5xx"] ?? 0),
			duckQueries: rate(b?.duckdb.queries ?? 0),
			rowsIn: rate(b?.ingest.rows ?? 0),
			rowsLoaded: rate(b?.duckdb.rowsLoaded ?? 0),
			sqliteReads: rate(b?.sqlite.reads ?? 0),
			sqliteWrites: rate(b?.sqlite.writes ?? 0),
			p50: b?.latency.p50 ?? null,
			p90: b?.latency.p90 ?? null,
			p99: b?.latency.p99 ?? null,
			duckP50: b?.duckdb.latency.p50 ?? null,
			duckP99: b?.duckdb.latency.p99 ?? null,
			rss: b?.memory?.rssMb ?? null,
			heap: b?.memory?.heapMb ?? null,
			external: b?.memory?.externalMb ?? null,
			cpu: b?.cpuPercent ?? null,
			lag: b?.loopLagMs ?? null,
		});
	}
	return rows;
}

export default function BackendStatsScreen() {
	return <TTScreen title="Backend stats">{({ backendId, account }) => (account.role === "admin" ? <Stats backendId={backendId} /> : <EmptyState icon="lock-closed-outline" title="Owners only" body="Backend stats are for the backend's owners (the admin role)." />)}</TTScreen>;
}

function Stats({ backendId }: { backendId: string }) {
	const p = useTheme();
	const [window, setWindow] = useState<StatsWindow>("5m");
	const [history, setHistory] = useState<History>("seconds");
	const [live, setLive] = useState(true);
	const stats = useTTQuery(backendId, ["backend-stats", window], (api, s) => api.backendStats(window, s), { refetchInterval: live ? 2000 : false, staleTime: 0, placeholderData: keepPreviousData });
	const data = stats.data;
	const rows = useMemo(() => (data ? timeline(data, history) : []), [data, history]);
	const span = history === "seconds" ? 2 * 60_000 : 60 * 60_000;
	const now = data?.now ?? Date.now();
	const deploys = useDeployMarks(backendId, now - span, now);
	const marks = (deploys.data ?? []).map((m) => ({ t: m.at, color: p.warning }));
	const chart = (title: string, note: string, series: [string, string][], format: (v: number) => string) => {
		const s: ChartSeries[] = series.map(([id, label]) => ({ label, points: rows.map((r) => ({ t: r.t, v: r[id] ?? null })) }));
		return (
			<Card style={{ gap: 6 }}>
				<Txt variant="label">{title}</Txt>
				<Note>{note}</Note>
				<LineChart series={s} format={format} area={false} height={140} marks={marks} timeLabel={(t) => new Date(t).toISOString().slice(11, history === "seconds" ? 19 : 16)} />
			</Card>
		);
	};
	const historyTitle = history === "seconds" ? "The last 2 minutes, per second" : "The last hour, per minute";
	return (
		<>
			<Note>What this backend process is doing: requests, queries and inserts per second, latency, memory and CPU.</Note>
			<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				<Segmented options={HISTORIES} value={history} onChange={setHistory} style={{ flex: 1 }} />
				<Button title={live ? "Live" : "Paused"} small icon={live ? "pause" : "play"} variant={live ? "brand" : "secondary"} onPress={() => setLive((v) => !v)} />
			</View>
			{stats.error && !data ? <ErrorState error={stats.error} onRetry={() => stats.refetch()} /> : null}
			{!data && !stats.error ? <SkeletonList rows={6} /> : null}
			{data ? (
				<>
					<StatGrid>
						<Stat label="Requests / s" value={perSecond(data.rates.requests)} sub={`${perSecond(data.rates.errors)} errors / s (5xx), last ${data.rates.seconds} s`} />
						<Stat label="Queries / s" value={perSecond(data.rates.duckQueries)} sub={`DuckDB p50 ${ms(data.duckdb.recent.p50)}, p99 ${ms(data.duckdb.recent.p99)} · SQLite reads ${perSecond(data.rates.sqliteReads)} / s`} />
						<Stat label="Inserts / s" value={perSecond(data.rates.rowsIn)} sub={`loaded ${perSecond(data.rates.rowsLoaded)} / s · SQLite writes ${perSecond(data.rates.sqliteWrites)} / s`} />
						<Stat label="Latency p50" value={ms(data.latency.recent.p50)} sub={`p90 ${ms(data.latency.recent.p90)} · p99 ${ms(data.latency.recent.p99)} · max ${ms(data.latency.recent.max)}`} />
						<Stat label="Memory" value={mb(data.sample?.rssMb)} sub={`heap ${mb(data.sample?.heapMb)} of ${mb(data.sample?.heapTotalMb)} · native ${mb(data.sample?.externalMb)}`} />
						<Stat label="CPU" value={data.sample ? `${fmtNum(data.sample.cpuPercent, 1)}%` : "–"} sub={`loop lag ${ms(data.sample?.loopLagMs)} · 100% = one core`} />
						<Stat label="Uptime" value={fmtDuration(data.uptimeSeconds * 1000)} sub={`${data.runtime} · v${data.version}${data.state === "ready" ? "" : ` · ${data.state}`}`} tone={data.state === "ready" ? undefined : "warning"} />
					</StatGrid>
					{chart("Requests per second", historyTitle, [["requests", "Requests / s"], ["errors", "5xx / s"]], perSecond)}
					{chart("Queries and inserts per second", historyTitle, [["duckQueries", "DuckDB queries / s"], ["rowsIn", "Rows in / s"], ["rowsLoaded", "Rows loaded / s"], ["sqliteReads", "SQLite reads / s"], ["sqliteWrites", "SQLite writes / s"]], perSecond)}
					{chart("Request latency", `${historyTitle}. Streams and long-polls are left out.`, [["p50", "p50"], ["p90", "p90"], ["p99", "p99"]], ms)}
					{chart("DuckDB statement latency", historyTitle, [["duckP50", "p50"], ["duckP99", "p99"]], ms)}
					{chart("Memory", `${historyTitle}. RSS is the whole process; the heap is JavaScript's.`, [["rss", "RSS"], ["heap", "Heap used"], ["external", "Native, buffers"]], mb)}
					{chart("CPU and event loop lag", `${historyTitle}. Lag: how late the once-a-second tick came (the worst in the bucket).`, [["cpu", "CPU %"], ["lag", "Loop lag ms"]], (v) => fmtNum(v, 1))}
					<MarkList backendId={backendId} marks={deploys.data} />
					<Panel
						title="By route group"
						note={`Requests and latency per kind of route over the last ${WINDOWS.find((w) => w.value === window)?.label ?? window}. Overall: p50 ${ms(data.latency.window.p50)}, p99 ${ms(data.latency.window.p99)} over ${fmtInt(data.latency.window.count)} requests.`}
					>
						<Segmented options={WINDOWS} value={window} onChange={setWindow} />
						{data.routes.length ? (
							<DataTable
								id="backend-routes"
								label="Requests by route group"
								search={false}
								pageSize={20}
								defaultSort={[{ id: "requests", desc: true }]}
								columns={[
									{ id: "group", header: "Route group", width: 150, accessor: (r) => ROUTE_LABELS[r.group] ?? r.group },
									{ id: "requests", header: "Requests", width: 80, accessor: (r) => r.requests, cell: (r) => fmtInt(r.requests) },
									{ id: "errors", header: "5xx", width: 56, accessor: (r) => r.errors, cell: (r) => (r.errors ? <Txt variant="small" color={p.destructive}>{fmtInt(r.errors)}</Txt> : "0") },
									{ id: "p50", header: "p50", width: 72, accessor: (r) => r.latency.p50, format: (v) => ms(v as number) },
									{ id: "p90", header: "p90", width: 72, accessor: (r) => r.latency.p90, format: (v) => ms(v as number) },
									{ id: "p99", header: "p99", width: 72, accessor: (r) => r.latency.p99, format: (v) => ms(v as number) },
									{ id: "max", header: "Max", width: 72, accessor: (r) => r.latency.max, format: (v) => ms(v as number) },
									{ id: "avg", header: "Avg", width: 72, accessor: (r) => r.latency.avg, format: (v) => ms(v as number) },
								]}
								data={data.routes}
								rowId={(r) => r.group}
							/>
						) : (
							<Txt variant="muted">No requests in this window yet.</Txt>
						)}
					</Panel>
					<Panel title="Since start" note={`Counting from ${fmtTime(data.totals.since)} UTC.`}>
						<KV label="Requests" value={fmtInt(data.totals.requests)} />
						<KV label="5xx" value={fmtInt(data.totals.errors)} />
						<KV label="DuckDB queries" value={fmtInt(data.totals.duckQueries)} />
						<KV label="Rows in" value={fmtInt(data.totals.rowsIn)} />
						<KV label="Bytes in" value={fmtBytes(data.totals.bytesIn)} />
						<KV label="Rows loaded" value={fmtInt(data.totals.rowsLoaded)} />
						<KV label="SQLite reads" value={fmtInt(data.totals.sqliteReads)} />
						<KV label="SQLite writes" value={fmtInt(data.totals.sqliteWrites)} />
					</Panel>
				</>
			) : null}
		</>
	);
}
