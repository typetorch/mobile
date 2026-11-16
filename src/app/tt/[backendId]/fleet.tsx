/**
 * Fleet (web pages/Fleet.tsx): live game servers, the latest deploy and alerts, from the fleet API, updated over its
 * event stream (GET /v1/fleet/stream?branch, features/typetorch/live-feeds.ts) with a log of its events; servers are
 * also re-read every 30 s (5 s while the stream is down).
 *
 * The branch filter is `branch` in the route (a link carries it): servers, the latest deploy, the gone servers and the
 * stream all ask for it. Tables: `fleet-servers` (health with its reasons on a tap, TPS / memory with warning dots,
 * country, owners' IP, budget pressure, the game's own columns from GET /v1/fleet/columns hidden until picked in
 * Columns), `fleet-countries`, `fleet-results`, `fleet-deploy-errors`, `fleet-reports`, `fleet-alerts` (90 days; a row
 * opens the alert: its bundle, the build's errors, its server, and owners acknowledge it there) and `fleet-gone`.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { alertBundle } from "@/api/tt/server-history";
import type { FleetAlert, FleetReportResult, FleetReports, FleetServer, FleetServers, GameColumn, GoneServer, ServerBudget } from "@/api/tt/types";
import { ShareBars } from "@/charts/LineChart";
import { Badge, Button, Card, Dot, ErrorState, Field, KV, List, Row, Section, Skeleton, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { CountryCode, countryCounts, GeoCredit, HealthBadge, LocationLabel, locationText, networkText, placeText, type CountryCount } from "@/features/typetorch/fleet-bits";
import { useTTQuery } from "@/features/typetorch/hooks";
import { streamLabel, useFleetStream } from "@/features/typetorch/live-feeds";
import { isOwner, isReadOnly } from "@/features/typetorch/roles";
import { TTScreen } from "@/features/typetorch/screen";
import { Sheet, SheetItem } from "@/features/typetorch/sheet";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam } from "@/features/typetorch/view-link";
import { fmtAgo, fmtDuration, fmtInt, fmtNum, fmtTime, shortId } from "@/lib/format";
import { useBackend, type BackendAccount } from "@/store/accounts";
import { space, useTheme, type Tone } from "@/theme";

const LEVEL_TONE: Record<string, Tone> = { critical: "critical", warning: "warning", info: "muted" };

function Status({ tone, children }: { tone: Tone; children: string }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
			<Dot tone={tone} />
			<Txt variant="small">{children}</Txt>
		</View>
	);
}

/** Kernel 0.4.0 heartbeat `bu`, one short line: DataStore reads and HTTP requests a minute against the limits. */
export function budgetText(b: ServerBudget | null | undefined): string {
	if (!b) return "–";
	const parts: string[] = [];
	if (b.ds) parts.push(`DS ${b.ds.r ?? 0}/${b.ds.lr ?? "?"}`);
	if (b.h) parts.push(`HTTP ${b.h.r ?? 0}/${b.h.l ?? "?"}`);
	return parts.length ? parts.join(" · ") : "–";
}

const CALLERS: Record<string, string> = { k: "kernel", d: "devtools", a: "analytics", g: "game", f: "framework" };

/** The full budget summary (the web's tooltip; here a tap on the cell). */
export function budgetTitle(b: ServerBudget | null | undefined): string | undefined {
	if (!b) return undefined;
	const lines = [
		`DataStore a minute: read ${b.ds?.r ?? 0}/${b.ds?.lr ?? "?"}, write ${b.ds?.w ?? 0}/${b.ds?.lw ?? "?"}${b.ds?.br !== undefined ? `, budget left ${b.ds.br} read / ${b.ds.bw ?? "?"} write` : ""}`,
		`MemoryStore units ${b.ms?.u ?? 0}/${b.ms?.l ?? "?"}, HTTP ${b.h?.r ?? 0}/${b.h?.l ?? "?"}, publishes ${b.mg?.p ?? 0}/${b.mg?.lp ?? "?"}`,
		`by ${
			Object.entries(b.by ?? {})
				.map(([k, v]) => `${CALLERS[k] ?? k} ${v}`)
				.join(", ") || "-"
		}`,
	];
	if (b.mem) lines.push(`memory ${b.mem.t ?? "?"} MB, LuaHeap ${b.mem.h ?? "?"} MB`);
	return lines.join("\n");
}

/** How much of its tightest per-minute limit a server uses (0 to 1+): the Budget column sorts by this. */
export function budgetPressure(b: ServerBudget | null | undefined): number | null {
	if (!b) return null;
	const shares = [b.ds?.lr ? (b.ds.r ?? 0) / b.ds.lr : null, b.h?.l ? (b.h.r ?? 0) / b.h.l : null].filter((v): v is number => v !== null);
	return shares.length ? Math.max(...shares) : null;
}

export const LOW_TPS = 50;
export const HIGH_MEMORY_MB = 3000;
const known = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
export const tpsLow = (v: number | null | undefined) => known(v) && v < LOW_TPS;
export const memoryHigh = (v: number | null | undefined) => known(v) && v > HIGH_MEMORY_MB;
const tpsFixed = (v: number | null | undefined) => (known(v) ? v.toFixed(1) : "–");

export function tpsText(s: FleetServer): string {
	if (!known(s.tps)) return "–";
	return known(s.tpsMin) ? `${tpsFixed(s.tps)} / ${tpsFixed(s.tpsMin)}` : tpsFixed(s.tps);
}

/** A number with a warning dot when it is out of range (colour never carries the meaning alone). */
function Reading({ warn, children }: { warn: boolean; children: ReactNode }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
			{warn ? <Dot tone="warning" /> : null}
			<Txt style={warn ? { fontWeight: "600" } : undefined}>{children}</Txt>
		</View>
	);
}

/** The budget cell: the short text; a tap shows the whole summary. */
function BudgetCell({ budget }: { budget: ServerBudget | null | undefined }) {
	const [open, setOpen] = useState(false);
	const title = budgetTitle(budget);
	return (
		<>
			<Pressable disabled={!title} onPress={() => setOpen(true)} hitSlop={4}>
				<Txt variant="mono" style={title ? { textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>
					{budgetText(budget)}
				</Txt>
			</Pressable>
			{title ? (
				<Sheet open={open} onClose={() => setOpen(false)} title="Budget">
					<Txt selectable>{title}</Txt>
				</Sheet>
			) : null}
		</>
	);
}

const seenAt = (s: FleetServer) => s.lastSeen ?? (s.ageSeconds !== undefined ? Date.now() - s.ageSeconds * 1000 : null);
const seenText = (s: FleetServer) => (s.ageSeconds !== undefined ? `${s.ageSeconds}s ago` : fmtAgo(s.lastSeen));

function ipText(s: FleetServer): string {
	const moved = !!s.firstIp && !!s.ip && s.firstIp !== s.ip;
	return `${s.ip ?? "–"}${moved ? ` (moved from ${s.firstIp}${s.ipChangedAt ? `, ${fmtAgo(s.ipChangedAt)}` : ""})` : ""}`;
}

export const SERVER_COLUMNS: DataColumn<FleetServer>[] = [
	{ id: "job", header: "Job", accessor: (s) => s.job, format: (_v, s) => shortId(s.job, 6), mono: true, width: 96 },
	{ id: "type", header: "Type", type: "enum", accessor: (s) => s.serverType },
	{ id: "branch", header: "Branch", type: "enum", accessor: (s) => s.branch },
	{ id: "channel", header: "Channel", type: "enum", accessor: (s) => s.channel ?? null, defaultHidden: true },
	{
		id: "artifact",
		header: "Artifact",
		type: "enum",
		accessor: (s) => s.artifact,
		cell: (s) => (
			<View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
				<Txt variant="mono">{s.artifact ?? "–"}</Txt>
				{s.experiment ? <Badge label="A/B pin" tone="brand" /> : null}
			</View>
		),
		width: 140,
	},
	{ id: "seq", header: "Seq", type: "number", accessor: (s) => s.appliedSeq, width: 60 },
	{ id: "players", header: "Players", type: "number", accessor: (s) => s.players, format: (_v, s) => `${fmtInt(s.players)} / ${fmtInt(s.maxPlayers)}` },
	{ id: "maxPlayers", header: "Max players", type: "number", accessor: (s) => s.maxPlayers, defaultHidden: true },
	{
		id: "health",
		header: "Health",
		type: "enum",
		order: ["ok", "unverified", "degraded", "failed", "failing"],
		options: ["ok", "unverified", "degraded", "failed"],
		firstSort: "desc",
		accessor: (s) => s.health ?? "unknown",
		cell: (s) => <HealthBadge server={s} />,
	},
	{
		id: "tps",
		header: "TPS",
		hint: "avg / min",
		type: "number",
		firstSort: "asc",
		accessor: (s) => (known(s.tps) ? s.tps : null),
		cell: (s) => <Reading warn={tpsLow(s.tps)}>{tpsText(s)}</Reading>,
		format: (_v, s) => tpsText(s),
		width: 110,
	},
	{ id: "tpsMin", header: "TPS min", hint: "slowest s", type: "number", firstSort: "asc", defaultHidden: true, accessor: (s) => (known(s.tpsMin) ? s.tpsMin : null), cell: (s) => <Reading warn={tpsLow(s.tpsMin)}>{tpsFixed(s.tpsMin)}</Reading> },
	{ id: "physFps", header: "Physics", hint: "FPS", type: "number", firstSort: "asc", defaultHidden: true, accessor: (s) => (known(s.physFps) ? s.physFps : null), format: (_v, s) => fmtNum(s.physFps, 0) },
	{ id: "memory", header: "Memory", hint: "MB", type: "number", accessor: (s) => (known(s.memMb) ? s.memMb : null), cell: (s) => <Reading warn={memoryHigh(s.memMb)}>{fmtNum(s.memMb, 0)}</Reading> },
	{ id: "luaHeap", header: "Lua heap", hint: "MB", type: "number", defaultHidden: true, accessor: (s) => (known(s.luaMb) ? s.luaMb : null), format: (_v, s) => fmtNum(s.luaMb, 1) },
	{ id: "kernel", header: "Kernel", type: "enum", accessor: (s) => s.kernel },
	{
		id: "country",
		header: "Country",
		type: "enum",
		accessor: (s) => s.location?.country ?? null,
		cell: (s) => <LocationLabel location={s.location} />,
		format: (_v, s) => locationText(s.location),
		searchText: (s) => [s.location?.countryName, placeText(s.location)].filter(Boolean).join(" "),
		exportValue: (s) => s.location?.country ?? null,
		width: 150,
	},
	{ id: "place", header: "City", type: "text", filter: "text", accessor: (s) => placeText(s.location), defaultHidden: true },
	{ id: "network", header: "Network", type: "text", filter: "text", accessor: (s) => networkText(s.location), defaultHidden: true },
	{ id: "ip", header: "IP", type: "text", filter: "text", accessor: (s) => s.ip ?? null, format: (_v, s) => ipText(s), mono: true, width: 150 },
	{
		id: "budget",
		header: "Budget",
		title: "Sorts by the share of the tightest per-minute limit in use",
		type: "number",
		accessor: (s) => budgetPressure(s.budget),
		cell: (s) => <BudgetCell budget={s.budget} />,
		format: (_v, s) => budgetText(s.budget),
		exportValue: (s) => budgetText(s.budget),
		filter: false,
		width: 150,
	},
	{ id: "startedAt", header: "Up since", type: "date", accessor: (s) => s.startedAt, format: (_v, s) => fmtAgo(s.startedAt) },
	{ id: "seen", header: "Seen", type: "date", accessor: seenAt, format: (_v, s) => seenText(s) },
	{ id: "placeId", header: "Place", type: "text", accessor: (s) => (s.placeId == null ? null : String(s.placeId)), defaultHidden: true },
	{ id: "generation", header: "Generation", accessor: (s) => s.generation, defaultHidden: true },
	{ id: "experiment", header: "A/B pin", type: "boolean", accessor: (s) => s.experiment ?? false, defaultHidden: true },
	{ id: "lastError", header: "Last error", accessor: (s) => s.lastError, defaultHidden: true, width: 220 },
];

/** Plans/34: a column id for a game-declared column (`cv.<name>`), so it never meets a built-in id. */
export const gameColumnId = (name: string) => `cv.${name}`;

/** The game's declared columns as table columns, hidden until turned on in Columns. */
export function gameColumns(columns: readonly GameColumn[]): DataColumn<FleetServer>[] {
	return columns.map((c): DataColumn<FleetServer> => {
		const value = (s: FleetServer) => {
			const v = s.cv?.[c.n];
			return v === undefined ? null : v;
		};
		const header = c.l ?? c.n;
		const title = `Game-defined column ${c.n} (the game's own value from each heartbeat)`;
		if (c.t === "bool")
			return { id: gameColumnId(c.n), header, title, type: "boolean", defaultHidden: true, accessor: (s) => (typeof value(s) === "boolean" ? value(s) : null), format: (v) => (v === true ? "yes" : v === false ? "no" : "–") };
		if (c.t === "number") return { id: gameColumnId(c.n), header, title, type: "number", align: "right", defaultHidden: true, accessor: (s) => (typeof value(s) === "number" ? value(s) : null) };
		return { id: gameColumnId(c.n), header, title, type: "enum", defaultHidden: true, accessor: (s) => (value(s) === null ? null : String(value(s))) };
	});
}

/** The live servers' columns for this session: the read-only role gets no addresses (no IP column); the game's own last. */
export function serverColumns(readOnly: boolean, game: readonly GameColumn[] = []): DataColumn<FleetServer>[] {
	const base = readOnly ? SERVER_COLUMNS.filter((c) => c.id !== "ip") : SERVER_COLUMNS;
	return game.length ? [...base, ...gameColumns(game)] : base;
}

const NO_GAME_COLUMNS: GameColumn[] = [];
const FAILED = new Set(["failed", "rolled_back"]);
const openServer = (backendId: string, job: string) => router.push(`/tt/${backendId}/server/${encodeURIComponent(job)}`);

const RESULT_COLUMNS: DataColumn<FleetReportResult>[] = [
	{ id: "result", header: "Result", type: "enum", accessor: (r) => r.result, cell: (r) => <Badge label={r.result} tone={FAILED.has(r.result) ? "critical" : "muted"} /> },
	{ id: "servers", header: "Servers", type: "number", accessor: (r) => r.servers },
	{ id: "players", header: "Players", type: "number", accessor: (r) => r.players },
	{ id: "median", header: "Median", hint: "s", type: "number", accessor: (r) => r.medianSeconds, format: (_v, r) => (r.medianSeconds === null ? "–" : fmtNum(r.medianSeconds, 1)) },
	{ id: "max", header: "Slowest", hint: "s", type: "number", accessor: (r) => r.maxSeconds, format: (_v, r) => (r.maxSeconds === null ? "–" : fmtNum(r.maxSeconds, 1)) },
];

type DeployError = FleetReports["errors"][number];
const DEPLOY_ERROR_COLUMNS: DataColumn<DeployError>[] = [
	{ id: "error", header: "Error", accessor: (e) => e.error, width: 260 },
	{ id: "servers", header: "Servers", type: "number", accessor: (e) => e.servers },
	{ id: "example", header: "Example", accessor: (e) => e.exampleJob, format: (_v, e) => shortId(e.exampleJob, 6), mono: true },
];

type ServerReport = NonNullable<FleetReports["reports"]>[number];
const REPORT_COLUMNS: DataColumn<ServerReport>[] = [
	{ id: "at", header: "When (UTC)", type: "date", accessor: (r) => r.at, format: (_v, r) => fmtTime(r.at) },
	{ id: "job", header: "Job", accessor: (r) => r.job, format: (_v, r) => shortId(r.job, 6), mono: true },
	{ id: "result", header: "Result", type: "enum", accessor: (r) => r.result, cell: (r) => <Badge label={r.result} tone={FAILED.has(r.result) ? "critical" : "muted"} /> },
	{ id: "seconds", header: "Took", hint: "s", type: "number", accessor: (r) => r.seconds, format: (_v, r) => (r.seconds === null ? "–" : fmtNum(r.seconds, 1)) },
	{ id: "kernel", header: "Kernel", type: "enum", accessor: (r) => r.kernel ?? null },
	{ id: "error", header: "Error", accessor: (r) => r.error, width: 220 },
	{ id: "seq", header: "Deploy", type: "number", accessor: (r) => r.seq, defaultHidden: true },
];

/** The latest deploy: its numbers, results, deploy errors, server reports, servers behind and stuck. */
function Report({ backendId, data }: { backendId: string; data: FleetReports }) {
	const p = useTheme();
	if (data.seq === null) return <Txt variant="muted">No deploy reported yet.</Txt>;
	return (
		<View style={{ gap: space.sm }}>
			<Card style={{ gap: 0 }}>
				<KV label="seq" value={`#${data.seq}`} />
				<KV label="branch" value={data.branch ?? "–"} />
				<KV label="artifact" value={data.artifact ?? "–"} mono />
				<KV label="started" value={fmtTime(data.startedAt)} />
				<KV label="servers reported" value={fmtInt(data.reported)} />
			</Card>
			{data.results.length ? <DataTable id="fleet-results" label="Deploy results" columns={RESULT_COLUMNS} data={data.results} rowId={(r) => r.result} /> : null}
			{data.errors.length ? <DataTable id="fleet-deploy-errors" label="Deploy errors" columns={DEPLOY_ERROR_COLUMNS} data={data.errors} rowId={(e) => e.error} onRowPress={(e) => openServer(backendId, e.exampleJob)} /> : null}
			{data.reports?.length ? (
				<DataTable
					id="fleet-reports"
					label="Server reports"
					columns={REPORT_COLUMNS}
					data={data.reports}
					rowId={(r) => `${r.seq}-${r.job}-${r.at}`}
					defaultSort={[{ id: "at", desc: true }]}
					onRowPress={(r) => openServer(backendId, r.job)}
				/>
			) : null}
			<Txt variant="small">{data.behind.length ? `${data.behind.length} live server(s) still below #${data.seq}.` : "Every live server on the branch has it."}</Txt>
			{data.stuck.length ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
					<Txt variant="small">Stuck (no report 3+ min after the deploy):</Txt>
					{data.stuck.map((j) => (
						<Pressable key={j} onPress={() => openServer(backendId, j)} hitSlop={4}>
							<Txt variant="mono" color={p.brand}>
								{shortId(j, 6)}
							</Txt>
						</Pressable>
					))}
				</View>
			) : null}
		</View>
	);
}

/** The Errors screen for an alert: its build (and branch) over a window that reaches back to the alert. */
export function alertErrorsHref(backendId: string, a: Pick<FleetAlert, "artifact" | "branch" | "at">, now = Date.now()): string | undefined {
	if (!a.artifact) return undefined;
	const age = now - a.at;
	const window = age < 86_400_000 ? "24h" : age < 7 * 86_400_000 ? "7d" : "30d";
	const params = new URLSearchParams({ build: a.artifact, ...(a.branch ? { branch: a.branch } : {}), ...(window !== "24h" ? { window } : {}) });
	return `/tt/${backendId}/errors?${params.toString()}`;
}

const ALERT_COLUMNS: DataColumn<FleetAlert>[] = [
	{ id: "at", header: "When (UTC)", type: "date", accessor: (a) => a.at, format: (_v, a) => fmtTime(a.at) },
	{
		id: "level",
		header: "Level",
		type: "enum",
		order: ["critical", "warning", "info"],
		options: ["critical", "warning", "info"],
		accessor: (a) => a.level,
		cell: (a) => <Status tone={LEVEL_TONE[a.level] ?? "muted"}>{a.level}</Status>,
	},
	{ id: "code", header: "Code", type: "enum", accessor: (a) => a.code, mono: true },
	{ id: "message", header: "Message", accessor: (a) => a.message, width: 260 },
	{ id: "where", header: "Where", accessor: (a) => [a.branch, a.artifact, a.seq ? `#${a.seq}` : null].filter(Boolean).join(" · ") },
	{ id: "job", header: "Job", accessor: (a) => a.job ?? null, format: (_v, a) => (a.job && a.job !== "cli" ? shortId(a.job, 6) : (a.job ?? "–")), mono: true },
	{ id: "bundle", header: "Bundle", type: "boolean", accessor: (a) => alertBundle(a.details) !== undefined, format: (_v, a) => (alertBundle(a.details) ? "bundle" : "") },
	{ id: "branch", header: "Branch", type: "enum", accessor: (a) => a.branch ?? null, defaultHidden: true },
	{ id: "source", header: "Source", type: "enum", accessor: (a) => a.source ?? null, defaultHidden: true },
	{ id: "acked", header: "Acked", type: "boolean", accessor: (a) => a.acked },
];

/** One alert: what it says, and where it leads (bundle, errors, server); owners acknowledge it here. */
function AlertSheet({ backendId, alert, owner, onClose }: { backendId: string; alert: FleetAlert | null; owner: boolean; onClose(): void }) {
	const { api } = useBackend(backendId);
	const queryClient = useQueryClient();
	const ack = useMutation({
		mutationFn: (id: number) => api!.ackAlert(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["tt", backendId, "alerts"] });
			void queryClient.invalidateQueries({ queryKey: ["tt", backendId, "deploy"] });
			onClose();
		},
	});
	if (!alert) return null;
	const bundle = alertBundle(alert.details);
	const errors = alertErrorsHref(backendId, alert);
	const server = alert.job && alert.job !== "cli" ? alert.job : null;
	const go = (href: string) => {
		onClose();
		router.push(href as never);
	};
	return (
		<Sheet open onClose={onClose} title={`${alert.level} alert ${alert.code}`} subtitle={`${fmtTime(alert.at)} UTC · ${alert.acked ? "acknowledged" : "not acknowledged"}`}>
			<Txt selectable>{alert.message}</Txt>
			<Txt variant="small">{[alert.branch, alert.artifact, alert.seq ? `#${alert.seq}` : null, alert.source].filter(Boolean).join(" · ")}</Txt>
			{server && bundle ? <SheetItem icon="archive-outline" label="Open bundle" onPress={() => go(`/tt/${backendId}/bundle/${bundle}`)} /> : null}
			{errors ? <SheetItem icon="bug-outline" label="Errors of this build" detail={alert.artifact ?? undefined} onPress={() => go(errors)} /> : null}
			{server ? <SheetItem icon="server-outline" label="Open its server" detail={shortId(server, 6)} onPress={() => go(`/tt/${backendId}/server/${encodeURIComponent(server)}`)} /> : null}
			{alert.seq ? <SheetItem icon="rocket-outline" label={`Open deploy #${alert.seq}`} onPress={() => go(`/tt/${backendId}/deploy/${alert.seq}`)} /> : null}
			{owner && !alert.acked ? <SheetItem icon="checkmark-done-outline" label={ack.isPending ? "Acknowledging..." : "Acknowledge"} disabled={ack.isPending} onPress={() => ack.mutate(alert.id)} /> : null}
			{ack.error ? <Txt variant="small">{ack.error.message}</Txt> : null}
		</Sheet>
	);
}

const ranFor = (s: GoneServer): number | null => {
	const start = s.startedAt ? new Date(s.startedAt).getTime() : Number.NaN;
	const end = new Date(s.closedAt ?? s.lostAt ?? s.lastSeen ?? "").getTime();
	return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
};
const goneAt = (s: GoneServer) => s.closedAt ?? s.lostAt ?? null;

const GONE_COLUMNS: DataColumn<GoneServer>[] = [
	{ id: "job", header: "Job", accessor: (s) => s.job, format: (_v, s) => shortId(s.job, 6), mono: true },
	{ id: "state", header: "Ended", type: "enum", options: ["closed", "lost"], accessor: (s) => s.state },
	{ id: "goneAt", header: "When (UTC)", type: "date", accessor: goneAt, format: (_v, s) => fmtTime(goneAt(s)) },
	{ id: "ranFor", header: "Ran for", type: "number", accessor: ranFor, format: (_v, s) => (ranFor(s) === null ? "–" : fmtDuration(ranFor(s) as number)) },
	{ id: "branch", header: "Branch", type: "enum", accessor: (s) => s.branch },
	{ id: "artifact", header: "Artifact", type: "enum", accessor: (s) => s.artifact, mono: true },
	{ id: "health", header: "Last health", type: "enum", accessor: (s) => s.health ?? "unknown" },
	{ id: "country", header: "Country", type: "enum", accessor: (s) => s.location?.country ?? null, cell: (s) => <LocationLabel location={s.location} />, format: (_v, s) => locationText(s.location), width: 150 },
	{ id: "players", header: "Players", type: "number", accessor: (s) => s.players, defaultHidden: true },
	{ id: "kernel", header: "Kernel", type: "enum", accessor: (s) => s.kernel },
	{ id: "lastError", header: "Last error", accessor: (s) => s.lastError, defaultHidden: true, width: 220 },
];

const COUNTRY_COLUMNS: DataColumn<CountryCount>[] = [
	{
		id: "country",
		header: "Country",
		accessor: (c) => c.country,
		cell: (c) => (
			<View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
				<CountryCode code={c.country === "??" ? null : c.country} />
				<Txt variant="small" numberOfLines={1}>
					{c.countryName ?? c.country}
				</Txt>
			</View>
		),
		format: (_v, c) => c.countryName ?? c.country,
		width: 150,
	},
	{ id: "servers", header: "Servers", type: "number", accessor: (c) => c.servers },
	{ id: "players", header: "Players", type: "number", accessor: (c) => c.players },
	{ id: "places", header: "Where", accessor: (c) => c.places.slice(0, 5).join("; ") || null, width: 240 },
];

/** The Countries metric's line: "US (12), DE (3)". */
export function countriesText(servers: readonly FleetServer[]): string {
	const rows = countryCounts(servers).filter((c) => c.country !== "??");
	if (!rows.length) return "unknown";
	return rows
		.slice(0, 6)
		.map((c) => `${c.country} (${c.servers})`)
		.join(", ")
		.concat(rows.length > 6 ? ", ..." : "");
}

export default function FleetScreen() {
	return <TTScreen title="Fleet">{({ backendId, account }) => <Fleet backendId={backendId} account={account} />}</TTScreen>;
}

function Servers({ backendId, data, readOnly }: { backendId: string; data: FleetServers; readOnly: boolean }) {
	// Plans/34: the game's columns (backends before it answer 404: none).
	const declared = useTTQuery(backendId, ["fleet", "columns"], (api, s) => api.fleetColumns(s), { retry: false, staleTime: 30_000, refetchInterval: 60_000 });
	const game = declared.data ?? NO_GAME_COLUMNS;
	const columns = useMemo(() => serverColumns(readOnly, game), [readOnly, game]);
	// Wait for the list once, so a remembered game column isn't read against a table without it.
	if (declared.isPending && !declared.error) return <SkeletonList rows={3} />;
	return (
		<DataTable
			id="fleet-servers"
			label="Live servers"
			columns={columns}
			data={data.servers}
			rowId={(s) => s.job}
			onRowPress={(s) => openServer(backendId, s.job)}
			defaultSort={[{ id: "players", desc: true }]}
			empty={<Txt variant="muted">No live servers (a server shows up within 30 s of its first heartbeat, and leaves 90 s after its last).</Txt>}
		/>
	);
}

function Fleet({ backendId, account }: { backendId: string; account: BackendAccount }) {
	const readOnly = isReadOnly(account);
	const [branch, setBranch] = usePageParam("branch", "");
	const [text, setText] = useState(branch);
	useEffect(() => setText(branch), [branch]);
	const [openAlert, setOpenAlert] = useState<FleetAlert | null>(null);
	const stream = useFleetStream(backendId, branch);
	const live = stream.status === "live";
	const servers = useTTQuery(backendId, ["fleet", "servers", branch], (api, s) => api.fleetServers(branch || undefined, s), { refetchInterval: live ? 30_000 : 5_000 });
	const report = useTTQuery(backendId, ["fleet", "report", branch], (api, s) => api.fleetReport(branch ? { branch } : {}, s));
	const alerts = useTTQuery(backendId, ["alerts", "fleet"], (api, s) => api.fleetAlerts({ limit: 100 }, s));
	const gone = useTTQuery(backendId, ["fleet", "gone", branch], (api, s) => api.fleetGoneServers(branch || undefined, s));
	const label = streamLabel(stream.status);
	const data = servers.data;
	return (
		<>
			<Txt variant="small">Live game servers, the latest deploy and alerts, from the fleet API (updates over its event stream).</Txt>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<View style={{ flex: 1 }}>
					<Field value={text} onChangeText={setText} placeholder="any branch" returnKeyType="search" onSubmitEditing={() => setBranch(text.trim())} onBlur={() => setBranch(text.trim())} />
				</View>
				<Status tone={label.tone}>{label.text}</Status>
			</View>

			{servers.error ? (
				<ErrorState error={servers.error} onRetry={() => servers.refetch()} />
			) : !data ? (
				<SkeletonList rows={6} />
			) : (
				<>
					<StatGrid>
						<Stat label="Live servers" value={fmtInt(data.servers.length)} />
						<Stat label="Players" value={fmtInt(data.players)} />
						<Stat label="Artifacts running" value={fmtInt(data.byArtifact.length)} sub={data.byArtifact.map((a) => `${a.artifact} (${a.servers})`).join(", ") || "none"} />
						<Stat
							label="Health"
							value={
								Object.entries(data.byHealth)
									.map(([h, n]) => `${n} ${h}`)
									.join(", ") || "–"
							}
						/>
						<Stat
							label="Countries"
							value={fmtInt(countryCounts(data.servers).filter((c) => c.country !== "??").length)}
							sub={data.geo?.state === "off" ? "locations are off" : data.geo?.state === "missing" ? "no IP database yet" : countriesText(data.servers)}
						/>
					</StatGrid>
					{data.byArtifact.length > 1 ? (
						<Section title="Players per version">
							<Card>
								<ShareBars rows={data.byArtifact.map((a) => ({ label: `${shortId(a.artifact, 6)} · ${a.servers} servers`, value: a.players }))} format={(v) => fmtInt(v)} />
							</Card>
						</Section>
					) : null}
					<Section title="Servers">
						<Servers backendId={backendId} data={data} readOnly={readOnly} />
						{data.servers.some((s) => s.location) ? <GeoCredit geo={data.geo} /> : null}
					</Section>
					{data.servers.some((s) => s.location) ? (
						<Section title="By country">
							<Txt variant="small">Live servers grouped by where their address is.</Txt>
							<DataTable id="fleet-countries" label="Servers by country" columns={COUNTRY_COLUMNS} data={countryCounts(data.servers)} rowId={(c) => c.country} defaultSort={[{ id: "servers", desc: true }]} />
							<GeoCredit geo={data.geo} />
						</Section>
					) : null}
				</>
			)}

			<Section title="Latest deploy" right={<Button title="All deploys" small variant="ghost" onPress={() => router.push(`/tt/${backendId}/deploys${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`)} />}>
				{report.error ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : !report.data ? <Skeleton height={100} /> : <Report backendId={backendId} data={report.data} />}
			</Section>

			<Section title="Live events">
				<Txt variant="small">Changes pushed by the server since this screen opened.</Txt>
				{stream.log.length ? (
					<List>
						{stream.log.map((e, i) => (
							<Row key={`${e.at}:${i}`} left={<Txt variant="mono">{fmtTime(e.at).slice(11)}</Txt>} title={e.text} numberOfLines={2} />
						))}
					</List>
				) : (
					<Txt variant="muted">Nothing yet. Server joins, leaves, deploy reports and alerts show up here as they happen.</Txt>
				)}
			</Section>

			<Section title="Alerts">
				<Txt variant="small">Newest first (kept 90 days). Tap an alert for its debug bundle, the build's errors and its server{isOwner(account) ? ", or to acknowledge it" : ""}.</Txt>
				{alerts.error ? (
					<ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
				) : !alerts.data ? (
					<SkeletonList rows={3} />
				) : (
					<DataTable id="fleet-alerts" label="Alerts" columns={ALERT_COLUMNS} data={alerts.data} rowId={(a) => String(a.id)} defaultSort={[{ id: "at", desc: true }]} onRowPress={setOpenAlert} empty={<Txt variant="muted">No alerts.</Txt>} />
				)}
			</Section>
			<AlertSheet backendId={backendId} alert={openAlert} owner={isOwner(account)} onClose={() => setOpenAlert(null)} />

			<Section title="Recently gone">
				<Txt variant="small">Servers that closed or stopped sending heartbeats, the most recent first (kept 30 days): their pages show what happened.</Txt>
				{gone.error ? (
					<ErrorState error={gone.error} onRetry={() => gone.refetch()} />
				) : !gone.data ? (
					<SkeletonList rows={3} />
				) : (
					<>
						<DataTable
							id="fleet-gone"
							label="Recently gone servers"
							columns={GONE_COLUMNS}
							data={gone.data}
							rowId={(s) => s.job}
							defaultSort={[{ id: "goneAt", desc: true }]}
							onRowPress={(s) => openServer(backendId, s.job)}
							empty={<Txt variant="muted">No server closed or was lost in the last 30 days.</Txt>}
						/>
						{gone.data.some((s) => s.location) ? <GeoCredit geo={servers.data?.geo} /> : null}
					</>
				)}
			</Section>
		</>
	);
}
