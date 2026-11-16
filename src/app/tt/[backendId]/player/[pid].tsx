/**
 * One player (the web's player detail under the Players list): Roblox headshot and names (GET /v1/identity/<pid>/profile),
 * the range's numbers, funnel progress, then Spending, Playtime, Sessions (query `player-stats`), Timeline (`timeline` +
 * `player-graph`) and Errors (GET /v1/players/<pid>/errors).
 */
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";

import type { Facet, PlayerErrorKind, PlayerStatsResult, TimelineEvent, TimelineResult } from "@/api/tt/types";
import { BarChart, type ChartPoint } from "@/charts/LineChart";
import { Badge, Button, Card, Chips, EmptyState, Icon, List, Segmented, Skeleton, Txt } from "@/components/ui";
import { openSessionReplay } from "@/features/recordings/links";
import { CopyButton, EventItem, FunnelBar, FunnelStepList, Note, Panel, ProductName, productKindLabel, QueryState } from "@/features/typetorch/bits";
import { ProductId, ProductKind } from "@/features/typetorch/cards";
import { EventTable } from "@/features/typetorch/event-table";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { GraphControls, GraphPanelBody, isFacet, MermaidButton, PathStrip, SparseNote } from "@/features/typetorch/graph";
import { useFlagParam, usePageParam } from "@/features/typetorch/view-link";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtInt, fmtMinutes, fmtNum, fmtTime, plural, shortId } from "@/lib/format";
import type { ErrorParams } from "@/api/backend";
import type { Filters } from "@/api/tt/types";
import { space, useTheme } from "@/theme";

type PlayerView = "spending" | "playtime" | "sessions" | "timeline" | "errors";
type Show = "chart" | "table";

const VIEWS: { value: PlayerView; label: string }[] = [
	{ value: "spending", label: "Spending" },
	{ value: "playtime", label: "Playtime" },
	{ value: "sessions", label: "Sessions" },
	{ value: "timeline", label: "Timeline" },
	{ value: "errors", label: "Errors" },
];

export default function PlayerScreen() {
	const { pid } = useLocalSearchParams<{ pid: string }>();
	const id = decodeURIComponent(String(pid ?? ""));
	return <TTScreen title="Player">{({ backendId }) => <Player backendId={backendId} pid={id} />}</TTScreen>;
}

function Player({ backendId, pid }: { backendId: string; pid: string }) {
	// The web's URL parameters (view, show, sid; facet and moments in the timeline).
	const [viewParam, setView] = usePageParam("view", "spending");
	const [showParam, setShow] = usePageParam("show", "chart");
	const [sid, setSid] = usePageParam("sid");
	const view: PlayerView = VIEWS.some((v) => v.value === viewParam) ? (viewParam as PlayerView) : "spending";
	const show: Show = showParam === "table" ? "table" : "chart";
	const stats = useTTAnalytics(backendId, "player-stats", { pid });
	return (
		<>
			<FilterBar backendId={backendId} />
			<ProfileCard backendId={backendId} pid={pid} stats={stats.data} />
			<Panel title="Funnels">
				<PlayerFunnels backendId={backendId} pid={pid} />
			</Panel>
			<Chips options={VIEWS} value={view} onChange={setView} />
			{stats.data?.window.clamped && view !== "timeline" && view !== "errors" ? <Note>The range is longer than 400 days: these numbers cover its last 400.</Note> : null}
			{view === "errors" ? (
				<ErrorsView backendId={backendId} pid={pid} />
			) : view === "timeline" ? (
				<TimelineView backendId={backendId} pid={pid} sid={sid} setSid={setSid} />
			) : (
				<QueryState q={stats} rows={4}>
					{(s) =>
						view === "spending" ? (
							<SpendingView backendId={backendId} stats={s} show={show} onShow={setShow} />
						) : view === "playtime" ? (
							<PlaytimeView stats={s} show={show} onShow={setShow} />
						) : (
							<SessionsView
								backendId={backendId}
								stats={s}
								show={show}
								onShow={setShow}
								onSession={(next) => {
									setSid(next);
									setView("timeline");
								}}
							/>
						)
					}
				</QueryState>
			)}
		</>
	);
}

// Profile ---------------------------------------------------------------------------------------------------------------

function ProfileCard({ backendId, pid, stats }: { backendId: string; pid: string; stats: PlayerStatsResult | undefined }) {
	const p = useTheme();
	const { state } = useTTFilters(backendId);
	const profile = useTTQuery(backendId, ["player-profile", pid], (api, s) => api.playerProfile(pid, s), { retry: false, staleTime: 5 * 60_000 });
	const d = profile.data;
	const uid = d?.linked ? d.uid : undefined;
	const title = d?.displayName ?? d?.name ?? (uid !== undefined ? `UserId ${uid}` : "Player");
	const t = stats?.totals;
	const note = profile.error ? "profile unavailable" : !d ? null : !d.linked ? "not linked" : d.roblox === "unavailable" ? "Roblox didn't answer" : d.roblox === "not-found" ? "not found on Roblox" : null;
	const field = (label: string, value: ReactNode) => (
		<View style={{ width: "48%", gap: 2 }}>
			<Txt variant="small">{label}</Txt>
			{typeof value === "string" ? <Txt style={{ fontWeight: "600" }}>{value}</Txt> : value}
		</View>
	);
	const v = (x: string) => (stats ? x : "…");
	return (
		<Card style={{ gap: space.md }}>
			<View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
				{d?.avatar ? (
					<Image source={{ uri: d.avatar }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: p.muted }} contentFit="cover" />
				) : (
					<View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
						<Icon name="person-outline" size={26} color={p.mutedForeground} />
					</View>
				)}
				<View style={{ flex: 1, gap: 2 }}>
					{profile.isPending ? <Skeleton width="60%" height={18} /> : <Txt variant="h3">{title}</Txt>}
					{d?.name ? <Txt variant="muted">@{d.name}</Txt> : null}
					{note ? <Badge label={note} /> : null}
					<Txt variant="small">Date range: {describeRange(state)}</Txt>
				</View>
			</View>
			<View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 10, justifyContent: "space-between" }}>
				{field(
					"UserId",
					uid !== undefined ? (
						<Pressable onPress={() => Linking.openURL(`https://www.roblox.com/users/${uid}/profile`)}>
							<Txt color={p.brand} style={{ fontWeight: "600" }}>
								{uid}
							</Txt>
						</Pressable>
					) : (
						<Txt variant="muted">{profile.isPending ? "…" : "not linked"}</Txt>
					),
				)}
				{field("Sessions", v(fmtInt(t?.sessions)))}
				{field("First seen", <Txt variant="mono">{v(fmtTime(t?.firstSeen))}</Txt>)}
				{field("Last seen", <Txt variant="mono">{v(fmtTime(t?.lastSeen))}</Txt>)}
				{field("Total spending", v(`${fmtInt(t?.robux)} Robux`))}
				{field("Avg playtime / day", v(fmtMinutes(t?.playtimePerDayMinutes)))}
			</View>
			<View style={{ gap: 4 }}>
				<Txt variant="small">pid</Txt>
				<Txt variant="mono" selectable>
					{pid}
				</Txt>
				<View style={{ flexDirection: "row", gap: space.sm }}>
					<CopyButton text={pid} title="Copy pid" />
					<Button title="Events" small icon="list-outline" onPress={() => router.push(`/tt/${backendId}/events?pid=${encodeURIComponent(pid)}`)} />
				</View>
			</View>
		</Card>
	);
}

function PlayerFunnels({ backendId, pid }: { backendId: string; pid: string }) {
	const q = useTTAnalytics(backendId, "funnel-progress", { pids: [pid] });
	const [open, setOpen] = useState<string | null>(null);
	if (q.error) return <Note>Couldn't load funnel progress: {q.error.message}</Note>;
	if (!q.data) return <Skeleton height={36} />;
	const rows = q.data.progress.filter((x) => x.pid === pid).sort((a, b) => a.funnel.localeCompare(b.funnel));
	if (!rows.length) return <Note>No funnel steps in this range.</Note>;
	const stepsOf = new Map(q.data.funnels.map((f) => [f.name, f.steps]));
	return (
		<View style={{ gap: space.md }}>
			{rows.map((x) => (
				<Pressable key={x.funnel} onPress={() => setOpen(open === x.funnel ? null : x.funnel)} style={{ gap: 4 }}>
					<View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
						<Txt style={{ fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>
							{x.funnel}
						</Txt>
						<Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
							step {x.reached} of {x.of}
							{x.label ? `: ${x.label}` : ""}
						</Txt>
					</View>
					<FunnelBar progress={x} />
					{open === x.funnel ? (
						<>
							<FunnelStepList steps={stepsOf.get(x.funnel)} progress={x} />
							{x.reachedAt ? <Note>Furthest step reached {fmtAgo(x.reachedAt)} ({fmtTime(x.reachedAt)})</Note> : null}
						</>
					) : null}
				</Pressable>
			))}
		</View>
	);
}

// Stats views -----------------------------------------------------------------------------------------------------------

function Numbers({ items }: { items: [string, string][] }) {
	const p = useTheme();
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
			{items.map(([label, value]) => (
				<View key={label} style={{ flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderColor: p.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
					<Txt variant="small">{label}</Txt>
					<Txt style={{ fontWeight: "700" }}>{value}</Txt>
				</View>
			))}
		</View>
	);
}

const bucketLabel = (start: string, bucket: PlayerStatsResult["window"]["bucket"]) => (bucket === "day" ? start.slice(0, 10) : `${start.slice(0, 10)} ${start.slice(11, 16)}`);

type MetricKey = "robux" | "minutes" | "sessions" | "purchases";
const TABLE_IDS: Record<MetricKey, string> = { robux: "player-spending", minutes: "player-playtime", sessions: "player-sessions-per", purchases: "player-purchases-per" };

/** A player's numbers per bucket: bars, or the same numbers as a table. */
function Series({ stats, metric, format, columns, show, onShow, title, empty }: { stats: PlayerStatsResult; metric: MetricKey; format(v: number): string; columns: { key: MetricKey; label: string; format(v: number): string }[]; show: Show; onShow(s: Show): void; title: string; empty: string }) {
	const bucket = stats.window.bucket;
	const points: ChartPoint[] = useMemo(() => stats.series.map((b) => ({ t: Date.parse(b.start), v: b[metric] })), [stats.series, metric]);
	const any = stats.series.some((b) => b[metric] > 0);
	return (
		<Panel title={title} right={<Segmented options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} value={show} onChange={onShow} style={{ width: 150 }} />}>
			{!any ? (
				<Txt variant="muted">{empty}</Txt>
			) : show === "chart" ? (
				<BarChart points={points} format={format} timeLabel={(t) => (bucket === "day" ? new Date(t).toISOString().slice(5, 10) : new Date(t).toISOString().slice(11, 16))} />
			) : (
				<DataTable
					id={TABLE_IDS[metric]}
					label={title}
					density="compact"
					defaultSort={[{ id: "start", desc: true }]}
					columns={[
						{ id: "start", header: bucket === "day" ? "Day (UTC)" : `${bucket} (UTC)`, width: 130, type: "date", accessor: (b) => b.start, format: (_v, b) => bucketLabel(b.start, bucket) },
						...columns.map((c) => ({ id: c.key, header: c.label, width: 90, type: "number" as const, accessor: (b: PlayerStatsResult["series"][number]) => b[c.key], format: (v: unknown) => c.format(Number(v)) })),
					]}
					data={stats.series}
					rowId={(b) => b.start}
				/>
			)}
		</Panel>
	);
}

const robux = (v: number) => `${fmtInt(v)} Robux`;
const ROBUX = { key: "robux" as const, label: "Robux", format: robux };
const PURCHASES = { key: "purchases" as const, label: "Purchases", format: (v: number) => fmtInt(v) };
const MINUTES = { key: "minutes" as const, label: "Minutes", format: (v: number) => fmtMinutes(v) };
const SESSIONS = { key: "sessions" as const, label: "Sessions", format: (v: number) => fmtInt(v) };

interface ViewProps {
	stats: PlayerStatsResult;
	show: Show;
	onShow(next: Show): void;
}

function SpendingView({ backendId, stats, show, onShow }: ViewProps & { backendId: string }) {
	const t = stats.totals;
	const purchaseColumns = useMemo<DataColumn<PlayerStatsResult["purchases"][number]>[]>(
		() => [
			{ id: "time", header: "Time (UTC)", type: "date", width: 130, mono: true, accessor: (x) => x.time, format: (_v, x) => fmtTime(x.time) },
			{ id: "product", header: "Product", width: 160, filter: "text", accessor: (x) => x.product, cell: (x) => (x.product === null || x.product === undefined ? "no id" : <ProductId backendId={backendId} id={x.product} kind={x.kind} showName filterColumn="product" />) },
			{ id: "kind", header: "Kind", type: "enum", width: 120, accessor: (x) => x.kind, format: (v) => productKindLabel(String(v)), cell: (x) => <ProductKind kind={x.kind} filterColumn="kind" /> },
			{ id: "robux", header: "Robux", type: "number", width: 70, accessor: (x) => x.robux, cell: (x) => (x.robux === null ? "–" : fmtInt(x.robux)) },
			{ id: "where", header: "Where", type: "enum", width: 100, accessor: (x) => x.where },
		],
		[backendId],
	);
	return (
		<>
			<Numbers
				items={[
					["Total spending", robux(t.robux)],
					["Purchases", fmtInt(t.purchases)],
					["Avg per purchase", t.purchases ? `${fmtNum(t.robux / t.purchases, 1)} Robux` : "–"],
					["Per day", `${fmtNum(t.robux / stats.window.days, 1)} Robux`],
				]}
			/>
			<Series stats={stats} metric="robux" format={(v) => fmtInt(v)} columns={[ROBUX, PURCHASES]} show={show} onShow={onShow} title={`Robux per ${stats.window.bucket}`} empty="No Robux spent in this range." />
			<Panel title="Purchases" note={stats.purchasesTruncated ? `Showing the newest ${fmtInt(stats.purchases.length)} purchases.` : undefined}>
				{stats.purchases.length ? (
					<DataTable id="player-purchases" label="Purchases" columns={purchaseColumns} data={stats.purchases} rowId={(x, i) => `${x.t}-${i}`} density="compact" defaultSort={[{ id: "time", desc: true }]} />
				) : (
					<Txt variant="muted">No purchases in this range.</Txt>
				)}
			</Panel>
		</>
	);
}

function PlaytimeView({ stats, show, onShow }: ViewProps) {
	const t = stats.totals;
	return (
		<>
			<Numbers
				items={[
					["Total playtime", fmtMinutes(t.playtimeMinutes)],
					["Avg per day", fmtMinutes(t.playtimePerDayMinutes)],
					["Per active day", t.activeDays ? fmtMinutes(t.playtimeMinutes / t.activeDays) : "–"],
					["Active days", `${fmtInt(t.activeDays)} of ${fmtInt(stats.window.days)}`],
				]}
			/>
			<Series stats={stats} metric="minutes" format={(v) => fmtNum(v, 0)} columns={[MINUTES, SESSIONS]} show={show} onShow={onShow} title={`Minutes played per ${stats.window.bucket}`} empty="No playtime in this range: widen the date range." />
		</>
	);
}

function SessionsView({ backendId, stats, show, onShow, onSession }: ViewProps & { backendId: string; onSession(sid: string): void }) {
	const p = useTheme();
	const t = stats.totals;
	const sessionColumns = useMemo<DataColumn<PlayerStatsResult["sessions"][number]>[]>(
		() => [
			{ id: "start", header: "Start (UTC)", type: "date", width: 130, mono: true, accessor: (x) => x.start, format: (_v, x) => fmtTime(x.start) },
			{ id: "minutes", header: "Length", type: "number", width: 76, accessor: (x) => x.minutes, format: (_v, x) => fmtMinutes(x.minutes) },
			{ id: "events", header: "Events", type: "number", width: 66, accessor: (x) => x.events, cell: (x) => fmtInt(x.events) },
			{ id: "first", header: "First", type: "boolean", width: 60, accessor: (x) => x.firstSession, cell: (x) => (x.firstSession ? <Badge label="first" tone="brand" /> : "") },
			{ id: "dev", header: "Device", type: "enum", width: 80, accessor: (x) => x.dev },
			{
				// web StatViews "Recording": opens the replay on Recordings (the row itself opens the session's timeline)
				id: "recording",
				header: "Recording",
				type: "boolean",
				width: 84,
				accessor: (x) => x.recorded === true,
				cell: (x) =>
					x.recorded ? (
						<Pressable onPress={() => openSessionReplay(backendId, x)} hitSlop={6} accessibilityRole="link" accessibilityLabel={`Replay session ${shortId(x.sid)}`}>
							<Txt variant="small" color={p.brand}>
								Replay
							</Txt>
						</Pressable>
					) : (
						""
					),
			},
			{ id: "art", header: "Artifact", type: "enum", width: 100, mono: true, accessor: (x) => x.art },
			{
				id: "job",
				header: "Server",
				width: 90,
				mono: true,
				accessor: (x) => x.job ?? null,
				format: (_v, x) => (x.job ? shortId(x.job, 6) : ""),
				cell: (x) =>
					x.job ? (
						<Pressable onPress={() => router.push(`/tt/${backendId}/server/${encodeURIComponent(x.job as string)}`)} hitSlop={6}>
							<Txt variant="small" color={p.brand}>
								{shortId(x.job, 6)}
							</Txt>
						</Pressable>
					) : (
						"–"
					),
			},
			{ id: "sid", header: "Session", width: 100, mono: true, accessor: (x) => x.sid, format: (_v, x) => shortId(x.sid, 10), defaultHidden: true },
		],
		[backendId, p.brand],
	);
	return (
		<>
			<Numbers
				items={[
					["Sessions", fmtInt(t.sessions)],
					["Avg length", fmtMinutes(t.avgSessionMinutes)],
					["Median length", fmtMinutes(t.medianSessionMinutes)],
					["Events", fmtInt(t.events)],
				]}
			/>
			<Series stats={stats} metric="sessions" format={(v) => fmtInt(v)} columns={[SESSIONS, MINUTES]} show={show} onShow={onShow} title={`Sessions per ${stats.window.bucket}`} empty="No sessions in this range: widen the date range." />
			<Panel title="Each session" note={`${stats.sessionsTruncated ? `Showing the newest ${fmtInt(stats.sessions.length)} sessions. ` : ""}Tap a session for its events and graph; Replay opens a recorded first session on Recordings (the filter bar's range becomes that session's days).`}>
				{stats.sessions.length ? (
					<DataTable id="player-sessions" label="Sessions" columns={sessionColumns} data={stats.sessions} rowId={(x) => x.sid} onRowPress={(x) => onSession(x.sid)} density="compact" defaultSort={[{ id: "start", desc: true }]} />
				) : (
					<Txt variant="muted">No sessions in this range.</Txt>
				)}
			</Panel>
		</>
	);
}

// Timeline --------------------------------------------------------------------------------------------------------------

function TimelineView({ backendId, pid, sid, setSid }: { backendId: string; pid: string; sid: string; setSid(s: string): void }) {
	const [facetParam, setFacet] = usePageParam("facet", "all");
	const facet: Facet = isFacet(facetParam) ? facetParam : "all";
	const [moments, setMoments] = useFlagParam("moments");
	const [mode, setMode] = usePageParam("graph", "drawn");
	const timeline = useTTAnalytics(backendId, "timeline", { pid, limit: 2000 });
	const sessions = timeline.data?.sessions ?? [];
	const session = sessions.find((s) => s.sid === sid);
	const graph = useTTAnalytics(backendId, "player-graph", { pid, facet, ...(sid ? { sid } : {}), ...(moments ? { moments: true } : {}) }, { keepPrevious: true });
	return (
		<>
			<Panel
				title={session ? `Session ${fmtTime(session.start)}` : "Node graph, all sessions"}
				note={session ? `${fmtMinutes(session.minutes)}, ${plural(session.events, "event")}: the moves in order, and the time in each state.` : "States and the moves between them (tap a state for what happened there and its moves)."}
			>
				<Chips
					options={[{ value: "", label: "All sessions" }, ...(sid && !session ? [{ value: sid, label: `session ${shortId(sid)}` }] : []), ...[...sessions].reverse().map((s) => ({ value: s.sid, label: `${fmtTime(s.start).slice(5, 16)} (${fmtMinutes(s.minutes)})` }))]}
					value={sid}
					onChange={setSid}
				/>
				<GraphControls facet={facet} onFacet={setFacet} moments={moments} onMoments={setMoments} />
				{graph.data ? <MermaidButton graph={graph.data} /> : null}
				<QueryState q={graph} isEmpty={(g) => g.nodes.length === 0} empty={facet === "all" ? "No states logged for this player here." : `None of this player's states has a ${facet} part (try all).`} rows={3}>
					{(g) => (
						<View style={{ gap: space.sm }}>
							<SparseNote graph={g} backendId={backendId} pid={pid} />
							<PathStrip graph={g} />
							<GraphPanelBody graph={g} mode={mode === "list" ? "list" : "drawn"} onMode={setMode} />
						</View>
					)}
				</QueryState>
			</Panel>
			<QueryState q={timeline} isEmpty={(t) => t.sessions.length === 0} empty="This player has no events in this range: widen the date range.">
				{(t) => <Sessions backendId={backendId} data={t} onGraph={setSid} />}
			</QueryState>
		</>
	);
}

function Sessions({ backendId, data, onGraph }: { backendId: string; data: TimelineResult; onGraph(sid: string): void }) {
	const [open, setOpen] = useState<string | null>(data.sessions.length ? (data.sessions[data.sessions.length - 1]?.sid ?? null) : null);
	const bySession = useMemo(() => {
		const m = new Map<string, TimelineEvent[]>();
		for (const e of data.events) m.set(e.sid, [...(m.get(e.sid) ?? []), e]);
		return m;
	}, [data.events]);
	return (
		<View style={{ gap: space.md }}>
			{data.truncated ? <Note>Showing the oldest {fmtInt(data.events.length)} events; narrow the date range to see later ones.</Note> : null}
			{[...data.sessions].reverse().map((s) => {
				const events = bySession.get(s.sid) ?? [];
				const isOpen = open === s.sid;
				return (
					<Card key={s.sid} style={{ gap: space.sm }}>
						<Pressable onPress={() => setOpen(isOpen ? null : s.sid)} style={{ gap: 2 }}>
							<View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
								<Txt style={{ fontWeight: "600" }}>Session {fmtTime(s.start)}</Txt>
								{s.firstSession ? <Badge label="first session" tone="brand" /> : null}
							</View>
							<Txt variant="small">
								{fmtMinutes(s.minutes)} · {plural(s.events, "event")} · {s.dev ?? "unknown device"} · artifact {s.art} · sid {shortId(s.sid)}
							</Txt>
						</Pressable>
						<View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
							<Button title="View graph" small icon="git-network-outline" onPress={() => onGraph(s.sid)} />
							{s.firstSession ? <Button title="Replay (if recorded)" small variant="ghost" icon="videocam-outline" onPress={() => openSessionReplay(backendId, s)} /> : null}
							<Button title={isOpen ? "Hide events" : `Events (${events.length})`} small variant="ghost" onPress={() => setOpen(isOpen ? null : s.sid)} />
						</View>
						{isOpen ? (
							events.length ? (
								<EventTable backendId={backendId} id="player-events" label={`Events of session ${shortId(s.sid)}`} events={events} urlSync={false} rowId={(e, i) => `${e.t}-${i}`} />
							) : (
								<EmptyState title="No events of this session in the list." />
							)
						) : null}
					</Card>
				);
			})}
		</View>
	);
}

// Errors ----------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** The error reads' window for the shared filters (the web's errorParamsFor). */
function errorParamsFor(filters: Filters, realm: string): ErrorParams {
	const params: ErrorParams = {};
	const from = filters.from ? Date.parse(filters.from) : Number.NaN;
	if (Number.isFinite(from)) params.from = from;
	else params.window = "30d";
	const to = filters.to ? Date.parse(filters.to) : Number.NaN;
	if (Number.isFinite(to)) params.to = filters.to && filters.to.length === 10 ? to + DAY_MS : to;
	if (typeof filters.branch === "string" && filters.branch) params.branch = filters.branch;
	if (typeof filters.art === "string" && filters.art) params.build = filters.art;
	if (realm) params.realm = realm;
	return params;
}

const ERROR_COLUMNS: DataColumn<PlayerErrorKind>[] = [
	{
		id: "template",
		header: "Error",
		width: 240,
		accessor: (k) => k.template,
		searchText: (k) => k.topFrame ?? "",
		cell: (k) => (
			<View style={{ gap: 2 }}>
				<Txt variant="mono" numberOfLines={3} style={{ fontSize: 11 }}>
					{k.template}
				</Txt>
				{k.topFrame ? (
					<Txt variant="small" numberOfLines={2} style={{ fontFamily: "monospace", fontSize: 10 }}>
						{k.topFrame}
					</Txt>
				) : null}
			</View>
		),
	},
	{ id: "realms", header: "Side", type: "enum", width: 100, accessor: (k) => k.realms.join(", "), cell: (k) => <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>{k.realms.map((r) => <Badge key={r} label={r} tone={r === "server" ? "brand" : "muted"} />)}</View> },
	{ id: "count", header: "Times", type: "number", width: 66, accessor: (k) => k.count, cell: (k) => fmtInt(k.count) },
	{ id: "days", header: "Days", type: "number", width: 56, accessor: (k) => k.days },
	{ id: "firstAt", header: "First", type: "date", width: 90, accessor: (k) => k.firstAt, format: (_v, k) => fmtAgo(k.firstAt), defaultHidden: true },
	{ id: "lastAt", header: "Last", type: "date", width: 90, accessor: (k) => k.lastAt, format: (_v, k) => fmtAgo(k.lastAt) },
	{ id: "total", header: "All time", title: "All occurrences of the kind, every player", type: "number", width: 76, accessor: (k) => k.total, cell: (k) => fmtInt(k.total) },
];

function ErrorsView({ backendId, pid }: { backendId: string; pid: string }) {
	const p = useTheme();
	const { apiFilters } = useTTFilters(backendId);
	const [realm, setRealm] = usePageParam("realm");
	const params = errorParamsFor(apiFilters, realm);
	const q = useTTQuery(backendId, ["errors", "player", pid, params], (api, s) => api.playerErrors(pid, params, s), { refetchInterval: 30_000 });
	return (
		<Panel title="Errors this player hit" note="Most often first. Tap one to open it on the Errors page.">
			<Segmented
				options={[
					{ value: "", label: "Server + client" },
					{ value: "server", label: "Server" },
					{ value: "client", label: "Client" },
				]}
				value={realm}
				onChange={setRealm}
			/>
			<QueryState q={q} rows={3}>
				{(d) =>
					!d.errors.length ? (
						<Txt variant="muted">No errors from this player in this range.</Txt>
					) : (
						<View style={{ gap: space.sm }}>
							<DataTable
								id="player-errors"
								label="Errors this player hit"
								columns={ERROR_COLUMNS}
								data={d.errors}
								rowId={(k) => k.fp}
								onRowPress={(k) => router.push(`/tt/${backendId}/error/${encodeURIComponent(k.fp)}?window=30d`)}
								defaultSort={[{ id: "count", desc: true }]}
								density="compact"
							/>
							<Note>
								{d.more ? `The ${fmtInt(d.errors.length)} kinds they hit most, of ${fmtInt(d.total)}. ` : ""}
								Times counts the occurrences in each minute's report that named the player, so players who hit it in the same minute on one server share that report.
							</Note>
						</View>
					)
				}
			</QueryState>
		</Panel>
	);
}
