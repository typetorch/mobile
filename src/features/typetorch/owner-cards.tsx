/**
 * The server's own state on the analytics pages, for owners (the backend refuses them to a viewer, so a read-only
 * session doesn't ask):
 *   - HistoryImportingBanner: history-banner.tsx (inside the filter bar, so on every analytics page).
 *   - IngestBusyNote (web components/IngestBusyNote.tsx): on the Overview while the backend answered busy (503) to game
 *     servers in the last minute (GET /v1/admin/stats?window=1m, every 30 s).
 *   - StorageCard (web components/StorageCard.tsx): what the server keeps on disk (GET /v1/storage, every 30 s).
 */
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { change } from "@/api/tt/benchmarks";
import { recentlyBusy } from "@/api/tt/migrate";
import type { DiskStatus, StoragePart, StorageReport } from "@/api/tt/types";
import { Txt } from "@/components/ui";
import { fmtAgo, fmtBytes, fmtInt, fmtPct } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme, type Palette } from "@/theme";

import { Callout } from "./analytics-bits";
import { ChangeChip, Panel, QueryState } from "./bits";
import { useTTQuery } from "./hooks";
import { DataTable, type DataColumn } from "./table";

function useOwner(backendId: string): boolean {
	return useBackend(backendId).account?.role === "admin";
}

export const BUSY_STATS_KEY = ["backend-stats-busy"] as const;

export function IngestBusyNote({ backendId }: { backendId: string }) {
	const p = useTheme();
	const owner = useOwner(backendId);
	const q = useTTQuery(backendId, BUSY_STATS_KEY, (api, signal) => api.backendStats("1m", signal), { enabled: owner, refetchInterval: 30_000, staleTime: 15_000, retry: false });
	if (!owner || !q.data || !recentlyBusy(q.data.ingest, q.data.now)) return null;
	return (
		<Callout tone="warning">
			<Pressable onPress={() => router.push(`/tt/${backendId}/backend-stats`)}>
				<Txt variant="small" color={p.foreground}>
					The backend answered busy (503) to game servers in the last minute: they keep the batches and retry; see <Txt variant="small" color={p.brand}>Backend stats</Txt>.
				</Txt>
			</Pressable>
		</Callout>
	);
}

/** Each part keeps its color (fixed categorical order). */
function partColor(p: Palette, key: string): string {
	const order = ["live", "events", "recordings", "rawArchive", "rawIncoming", "rollups", "fleet", "sql"];
	const i = order.indexOf(key);
	return i >= 0 ? (p.chart[i % p.chart.length] as string) : p.mutedForeground;
}

function diskWarningText(d: DiskStatus): string {
	const threshold = d.level === "critical" ? d.criticalFreePercent : d.warnFreePercent;
	return `${fmtBytes(d.freeBytes)} of ${fmtBytes(d.totalBytes)} free (${fmtPct(d.freePercent / 100)}, under ${threshold}%). Make a backup, then free space: shorter retention on the Settings page, or a bigger volume.`;
}

function Figure({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
	const p = useTheme();
	return (
		<View style={{ minWidth: "45%", flexGrow: 1, gap: 1 }}>
			<Txt variant="small">{label}</Txt>
			<Txt variant="h2" {...(danger ? { color: p.destructive } : {})}>
				{value}
			</Txt>
			{sub ? <Txt variant="small">{sub}</Txt> : null}
		</View>
	);
}

function StorageBody({ r }: { r: StorageReport }) {
	const p = useTheme();
	const part = (key: string) => r.parts.find((x) => x.key === key);
	const live = part("live");
	const events = part("events");
	const recordings = part("recordings");
	const history = (events?.bytes ?? 0) + (recordings?.bytes ?? 0);
	const g = r.growth;
	const shown = useMemo(() => r.parts.filter((x) => x.bytes > 0).sort((a, b) => b.bytes - a.bytes), [r.parts]);
	const total = r.totalBytes;
	const columns = useMemo<DataColumn<StoragePart>[]>(
		() => [
			{
				id: "part",
				header: "Part",
				width: 150,
				accessor: (x) => x.label,
				cell: (x) => (
					<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
						<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: partColor(p, x.key) }} />
						<Txt variant="small" color={p.foreground}>
							{x.label}
						</Txt>
					</View>
				),
			},
			{ id: "bytes", header: "Size", type: "number", width: 84, accessor: (x) => x.bytes, format: (_v, x) => fmtBytes(x.bytes), filter: false },
			{ id: "share", header: "Share", type: "number", width: 64, accessor: (x) => (total ? x.bytes / total : 0), format: (v) => fmtPct(v as number), filter: false },
			{ id: "files", header: "Files", type: "number", width: 70, accessor: (x) => x.files, format: (_v, x) => fmtInt(x.files) },
			{ id: "days", header: "Days", type: "number", width: 56, accessor: (x) => x.days ?? null, defaultHidden: true },
			{ id: "oldest", header: "Oldest", type: "date", width: 96, accessor: (x) => x.oldest ?? null, defaultHidden: true },
			{ id: "newest", header: "Newest", type: "date", width: 96, accessor: (x) => x.newest ?? null, defaultHidden: true },
		],
		[p, total],
	);
	return (
		<View style={{ gap: space.md }}>
			{r.disk && r.disk.level !== "ok" ? (
				<Callout tone="critical" title={r.disk.level === "critical" ? "The data disk is almost full" : "The data disk is filling up"}>
					{diskWarningText(r.disk)}
				</Callout>
			) : null}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
				<Figure label="On disk" value={fmtBytes(r.totalBytes)} />
				<Figure label="DuckDB live (today)" value={fmtBytes(live?.bytes)} />
				<Figure label="Parquet history" value={fmtBytes(history)} sub={events?.days ? `${fmtInt(events.days)} day${events.days === 1 ? "" : "s"}, ${events.oldest} to ${events.newest}. One file per finished UTC day, written each night.` : "no finished day yet"} />
				{r.disk ? <Figure label="Disk free" value={fmtBytes(r.disk.freeBytes)} sub={`of ${fmtBytes(r.disk.totalBytes)} (${fmtPct(r.disk.freePercent / 100)})`} danger={r.disk.level !== "ok"} /> : null}
				{r.disk && r.disk.totalBytes > 0 ? <Figure label="Disk used" value={fmtBytes(r.disk.totalBytes - r.disk.freeBytes)} sub={`${fmtPct((r.disk.totalBytes - r.disk.freeBytes) / r.disk.totalBytes)} of the disk (everything on it, not only TypeTorch)`} /> : null}
			</View>
			{total ? (
				<>
					<View style={{ flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", backgroundColor: p.muted, gap: 1 }}>
						{shown.map((x) => (
							<View key={x.key} style={{ width: `${(x.bytes / total) * 100}%`, backgroundColor: partColor(p, x.key) }} />
						))}
					</View>
					<DataTable id="storage-parts" label="Disk use by part" columns={columns} data={shown} rowId={(x) => x.key} density="compact" />
				</>
			) : null}
			{r.rows ? (
				<Txt variant="small">
					live rows {fmtInt(r.rows.liveEvents + r.rows.liveRecordings)} · Parquet events {fmtInt(r.rows.parquetEvents)} · Parquet recording chunks {fmtInt(r.rows.parquetRecordings)}
				</Txt>
			) : null}
			{g ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
					<Txt variant="small">today's raw batches</Txt>
					<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
						{fmtBytes(g.todayBytes)}
					</Txt>
					<Txt variant="small">{g.avgPerDayBytes === null ? "(no earlier day yet)" : `vs ${fmtBytes(g.avgPerDayBytes)} a day before`}</Txt>
					{g.avgPerDayBytes !== null ? <ChangeChip change={change(g.todayBytes, g.avgPerDayBytes, true)} /> : null}
				</View>
			) : null}
			{g ? <Txt variant="small">The gzip NDJSON archive of accepted batches per UTC day: today so far against the average of up to 7 days before (today isn't over).</Txt> : null}
			<Txt variant="small" style={{ fontSize: 11 }}>
				Measured {fmtAgo(r.at)}; the server measures at most every {r.cacheSeconds} s.
			</Txt>
		</View>
	);
}

export function StorageCard({ backendId }: { backendId: string }) {
	const owner = useOwner(backendId);
	const q = useTTQuery(backendId, ["storage"], (api, signal) => api.storage(signal), { enabled: owner, refetchInterval: 30_000 });
	if (!owner) return null;
	return (
		<Panel title="Storage" note="What the analytics server keeps on disk. Not filtered.">
			<QueryState q={q} rows={3}>
				{(r) => <StorageBody r={r} />}
			</QueryState>
		</Panel>
	);
}
