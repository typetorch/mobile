/**
 * The TypeTorch dashboard's shared pieces: the backend header, the signed-out notice, the page menu, and the home
 * (Overview) body that both /tt/<id> and the project's TypeTorch tab show.
 */
import { WatchButton } from "@/features/live/WatchButton";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Switch, View } from "react-native";

import { change } from "@/api/tt/benchmarks";
import type { FleetAlert, OverviewResult } from "@/api/tt/types";
import { BarChart, type ChartMark } from "@/charts/LineChart";
import { Badge, Button, Card, Dot, ErrorState, Icon, List, Row, SearchBar, Section, Segmented, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { compact, fmtAgo, fmtInt, fmtMinutes, fmtNum } from "@/lib/format";
import { useAccounts, useBackend, type BackendAccount } from "@/store/accounts";
import { useTheme } from "@/theme";

import { ChangeChip } from "./bits";
import { dayRange, useTTQuery } from "./hooks";
import { chartMarks, DeployMarksToggle, useDeployMarks, useMarkCard } from "./marks";
import { OverviewAnalytics } from "./overview";
import { pageHref, visiblePages } from "./pages";
import { PlaceCard } from "./shell";

export function SignedOutNotice({ account }: { account: BackendAccount }) {
	const p = useTheme();
	if (!account.signedOut) return null;
	return (
		<Card style={{ gap: 8, borderColor: `${p.warning}88` }}>
			<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				<Icon name="log-out-outline" size={18} color={p.warning} />
				<Txt style={{ fontWeight: "600" }}>The backend refused this device's token</Txt>
			</View>
			<Txt variant="muted">It was revoked or ran out. Sign in again to keep using this dashboard.</Txt>
			<Button title="Sign in again" variant="brand" small icon="log-in-outline" onPress={() => router.push(`/backend/connect?reauth=${account.id}`)} style={{ alignSelf: "flex-start" }} />
		</Card>
	);
}

export function BackendHeader({ account }: { account: BackendAccount }) {
	const check = useTTQuery(account.id, ["check"], (api, signal) => api.authCheck(signal), { staleTime: 60_000 });
	const user = check.data?.user ?? account.user;
	const who = user && user.kind === "roblox" ? `@${user.name}` : user ? "token" : "–";
	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Dot tone={check.error ? "critical" : check.data ? "good" : "muted"} />
					<Txt variant="h3" numberOfLines={1} style={{ flex: 1 }}>
						{account.name}
					</Txt>
					<Badge label={check.data?.role ?? account.role} tone={(check.data?.role ?? account.role) === "admin" ? "brand" : "muted"} />
				</View>
				<Txt variant="small" numberOfLines={1}>
					{account.url.replace(/^https?:\/\//, "")} · {who}
					{check.data?.version ? ` · v${check.data.version}` : ""}
				</Txt>
				{check.error && !account.signedOut ? <Txt variant="small">{check.error.message}</Txt> : null}
				<FindPlayer backendId={account.id} />
			</Card>
			<PlaceCard backendId={account.id} />
		</>
	);
}

/** The web's top-bar "Find player": a pid, part of one, or a UserId; opens the Players page with it (`find`). */
function FindPlayer({ backendId }: { backendId: string }) {
	const [text, setText] = useState("");
	const go = () => {
		const value = text.trim();
		if (!value) return;
		router.push(`/tt/${backendId}/players?find=${encodeURIComponent(value)}` as never);
		setText("");
	};
	return <SearchBar value={text} onChangeText={setText} placeholder="Find player (pid or UserId)" onSubmit={go} />;
}

export function PageMenu({ account }: { account: BackendAccount }) {
	const p = useTheme();
	const admin = account.role === "admin";
	// The web's sidebar groups (lib/nav.ts), owner-only pages hidden for the read-only role; Overview is this screen.
	const groups = visiblePages(admin)
		.map((g) => ({ ...g, pages: g.pages.filter((x) => x.key !== "overview") }))
		.filter((g) => g.pages.length);
	return (
		<>
			{groups.map((g) => {
				const ready = g.pages.filter((x) => x.status === "ready");
				const todo = g.pages.filter((x) => x.status === "todo");
				return (
					<Section key={g.id} title={g.label ?? "Dashboard"}>
						<List>
							{ready.map((x) => (
								<Row key={x.key} left={<Icon name={x.icon} size={18} />} title={x.title} subtitle={x.description} chevron onPress={() => router.push(pageHref(account.id, x.key))} />
							))}
							{todo.map((x) => (
								<Row key={x.key} left={<Icon name={x.icon} size={18} color={p.mutedForeground} />} title={x.title} subtitle={`${x.description} · use the web explorer for now`} disabled />
							))}
						</List>
					</Section>
				);
			})}
		</>
	);
}

const RANGES = [
	{ value: 1, label: "Today" },
	{ value: 7, label: "7 days" },
	{ value: 28, label: "28 days" },
] as const;

function alertTone(level: FleetAlert["level"]): "critical" | "warning" | "muted" {
	return level === "critical" ? "critical" : level === "warning" ? "warning" : "muted";
}

/** The web Overview's tiles: label, the number its change chip compares, and the text (pages/Overview.tsx TILES). */
const TILES: { label: string; value(d: OverviewResult): number; text(d: OverviewResult): string }[] = [
	{ label: "Players", value: (d) => d.players, text: (d) => fmtInt(d.players) },
	{ label: "New players", value: (d) => d.newPlayers, text: (d) => fmtInt(d.newPlayers) },
	{ label: "Returning", value: (d) => d.returningPlayers, text: (d) => fmtInt(d.returningPlayers) },
	{ label: "Sessions", value: (d) => d.sessions, text: (d) => fmtInt(d.sessions) },
	{ label: "Events", value: (d) => d.events, text: (d) => compact(d.events) },
	{ label: "Playtime", value: (d) => d.playtimeHours, text: (d) => `${fmtNum(d.playtimeHours, 1)} h` },
	{ label: "Avg session", value: (d) => d.avgSessionMinutes, text: (d) => fmtMinutes(d.avgSessionMinutes) },
	{ label: "Playtime per player", value: (d) => d.playtimePerPlayerMinutes, text: (d) => fmtMinutes(d.playtimePerPlayerMinutes) },
];

/** The web Overview's four DayBars. */
const CHARTS: { key: "players" | "newPlayers" | "sessions" | "playtimeHours"; label: string; format?: (v: number) => string }[] = [
	{ key: "players", label: "Players" },
	{ key: "newPlayers", label: "New players" },
	{ key: "sessions", label: "Sessions" },
	{ key: "playtimeHours", label: "Playtime (hours)", format: (v) => fmtNum(v, 1) },
];

const DAY_MS = 86_400_000;

/**
 * The Overview: live fleet, the analytics overview query, errors, the latest deploy and alerts. With `compare` (the
 * Overview page: "vs previous period" is the route's `vs=prev`, so it travels in a link) the analytics part is the web
 * Overview's (OverviewAnalytics: the filter bar, 8 tiles with Why?, 4 charts, pinned queries, owner cards); without it
 * (the project's TypeTorch tab) a compact Today / 7 / 28 days summary with a local "vs previous period" switch.
 */
export function TTHome({ backendId, poll = true, compare }: { backendId: string; poll?: boolean; compare?: { on: boolean; set(on: boolean): void } }) {
	const p = useTheme();
	const { account } = useBackend(backendId);
	const [days, setDays] = useState<number>(7);
	const [localPrev, setLocalPrev] = useState(false);
	const vsPrev = compare ? compare.on : localPrev;
	const setVsPrev = compare ? compare.set : setLocalPrev;
	const fleet = useTTQuery(backendId, ["fleet", "servers"], (api, s) => api.fleetServers(undefined, s), { refetchInterval: poll ? 15_000 : false });
	const overview = useTTQuery(backendId, ["query", "overview", days], (api, s) => api.query("overview", dayRange(days), {}, s), { staleTime: 60_000, enabled: !compare });
	const errors = useTTQuery(backendId, ["errors", "24h", ""], (api, s) => api.errors({ window: "24h", limit: 5 }, s), { staleTime: 60_000 });
	const deploys = useTTQuery(backendId, ["deploys", "latest"], (api, s) => api.fleetDeploys({ limit: 1 }, s), { staleTime: 60_000 });
	const alerts = useTTQuery(backendId, ["alerts", "recent"], (api, s) => api.fleetAlerts({ limit: 5 }, s), { staleTime: 30_000 });
	// Deploy marks on every chart (a tap opens a mark's card).
	const dayStart = Date.parse(`${dayRange(days).from}T00:00:00Z`);
	const markRange = useMemo(() => ({ from: dayStart, to: dayStart + days * DAY_MS }), [dayStart, days]);
	const marksQ = useDeployMarks(backendId, markRange, undefined, { enabled: !!overview.data });
	// "vs previous period": the same number of days right before, up to the same time of day (the web's previousPeriod),
	// for the tiles' change chips and drawn dashed over the bars (the web's DayBars `previous`).
	const shift = days * DAY_MS;
	const prevFrom = new Date(dayStart - shift).toISOString().slice(0, 10);
	const prevTo = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - shift).toISOString();
	const prevQ = useTTQuery(backendId, ["query", "overview", "prev", prevFrom, prevTo], (api, s) => api.query("overview", { from: prevFrom, to: prevTo }, {}, s), { staleTime: 60_000, enabled: vsPrev && !compare });
	const prev = vsPrev ? prevQ.data : undefined;
	const card = useMarkCard(backendId);
	if (!account) return null;

	const unhealthy = fleet.data ? fleet.data.servers.filter((s) => (s.reasons?.length ?? 0) > 0 || (s.health && s.health !== "ok")).length : null;
	const latest = deploys.data?.deploys[0];
	const o = overview.data;

	return (
		<View style={{ gap: 12 }}>
			<SignedOutNotice account={account} />
			<Section title="Live" right={<WatchButton backendId={backendId} />}>
				{fleet.error ? (
					<ErrorState error={fleet.error} onRetry={() => fleet.refetch()} />
				) : (
					<StatGrid>
						<Stat label="Servers" value={fleet.data ? fmtInt(fleet.data.servers.length) : "…"} />
						<Stat label="Players" value={fleet.data ? fmtInt(fleet.data.players) : "…"} />
						<Stat label="Need a look" value={unhealthy === null ? "…" : fmtInt(unhealthy)} tone={unhealthy ? "warning" : undefined} />
						<Stat label="Errors 24 h" value={errors.data ? compact(errors.data.totals.count) : errors.error ? "–" : "…"} sub={errors.data ? `${errors.data.totals.kinds} kinds · ${errors.data.totals.players} players` : undefined} />
					</StatGrid>
				)}
				<Button title="Open fleet" small icon="server-outline" onPress={() => router.push(pageHref(backendId, "fleet"))} style={{ alignSelf: "flex-start" }} />
			</Section>

			{compare ? (
				<Section title="Overview">
					<OverviewAnalytics backendId={backendId} compare={compare} />
				</Section>
			) : null}
			{compare ? null : <Section title="Players" right={<Segmented options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={days} onChange={setDays} style={{ width: 220 }} />}>
				{overview.error ? <ErrorState error={overview.error} onRetry={() => overview.refetch()} /> : null}
				{!o && !overview.error ? <Skeleton height={120} /> : null}
				{o ? (
					<>
						<PrevToggle on={vsPrev} onChange={setVsPrev} />
						{vsPrev && prevQ.error ? <Txt variant="small">Couldn't load the previous period: {prevQ.error.message}</Txt> : null}
						<StatGrid>
							{TILES.map((t) => (
								<Stat key={t.label} label={t.label} value={t.text(o)} {...(prev ? { sub: <ChangeChip change={change(t.value(o), t.value(prev))} /> } : {})} />
							))}
						</StatGrid>
						<DeployMarksToggle {...marksQ} />
						{CHARTS.map((c) => (
							<OverviewBars key={c.key} data={o} previous={prev} shiftMs={shift} chart={c} marks={chartMarks(p, marksQ.marks)} onMarkPress={card.open} />
						))}
					</>
				) : null}
			</Section>}

			{latest ? (
				<Section title="Latest deploy">
					<List>
						<Row
							chevron
							onPress={() => router.push(`/tt/${backendId}/deploy/${latest.seq}`)}
							left={<Icon name="rocket-outline" size={18} />}
							title={`#${latest.seq} ${latest.kind} · ${latest.branch ?? "–"}`}
							subtitle={`${latest.outcome} · ${latest.ok}/${latest.reported} ok · ${fmtAgo(latest.at)}`}
						/>
					</List>
				</Section>
			) : null}

			{errors.data?.kinds.length ? (
				<Section title="Top errors, 24 h" right={<Button title="All" small variant="ghost" onPress={() => router.push(pageHref(backendId, "errors"))} />}>
					<List>
						{errors.data.kinds.map((k) => (
							<Row key={k.fp} chevron onPress={() => router.push(`/tt/${backendId}/error/${encodeURIComponent(k.fp)}`)} title={k.template} subtitle={`${compact(k.count)}× · ${k.players} players · ${k.realm}`} right={<Txt variant="small">{fmtAgo(k.lastAt)}</Txt>} />
						))}
					</List>
				</Section>
			) : null}

			{alerts.data?.length ? (
				<Section title="Recent alerts">
					<List>
						{alerts.data.map((a) => (
							<Row key={a.id} left={<Dot tone={alertTone(a.level)} />} title={a.message} subtitle={`${a.code} · ${fmtAgo(a.at)}${a.acked ? " · acknowledged" : ""}`} numberOfLines={2} />
						))}
					</List>
				</Section>
			) : null}

			{card.sheet}
			<PageMenu account={account} />
			<Txt variant="small" style={{ textAlign: "center", color: p.mutedForeground }}>
				Pull to refresh · live numbers update every 15 s
			</Txt>
		</View>
	);
}

/** One of the four charts: per day, or per step for a day (the backend's buckets); the previous period dashed. */
function OverviewBars({
	data,
	previous,
	shiftMs,
	chart,
	marks,
	onMarkPress,
}: {
	data: OverviewResult;
	previous: OverviewResult | undefined;
	shiftMs: number;
	chart: (typeof CHARTS)[number];
	marks: ChartMark[];
	onMarkPress(mark: ChartMark): void;
}) {
	const byDay = data.days.length > 1 || !data.buckets?.length;
	const points = byDay ? data.days.map((d) => ({ t: Date.parse(d.date), v: d[chart.key] })) : (data.buckets ?? []).map((b) => ({ t: b.t, v: b[chart.key] }));
	let before: (number | null)[] | undefined;
	if (previous) {
		const at = new Map<number, number>(byDay ? previous.days.map((d) => [Date.parse(d.date) + shiftMs, d[chart.key]]) : (previous.buckets ?? []).map((b) => [b.t + shiftMs, b[chart.key]]));
		before = points.map((pt) => at.get(pt.t) ?? null);
	}
	if (!points.length) return null;
	return (
		<Card style={{ gap: 6 }}>
			<Txt variant="label">{chart.label}</Txt>
			<Txt variant="small">
				{byDay ? "Per day (UTC), by the day a session started" : "Per step (UTC), by the time a session started"}
				{before ? "; dashed: the previous period" : ""}
			</Txt>
			<BarChart
				points={points}
				format={chart.format ?? compact}
				marks={marks}
				onMarkPress={onMarkPress}
				{...(byDay ? {} : { timeLabel: (t: number) => new Date(t).toISOString().slice(11, 16) })}
				{...(before ? { previous: before } : {})}
			/>
		</Card>
	);
}

function PrevToggle({ on, onChange }: { on: boolean; onChange(on: boolean): void }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
			<Switch value={on} onValueChange={onChange} />
			<Txt variant="small" style={{ flex: 1 }}>
				vs previous period: change chips on the tiles, the period before dashed on the charts
			</Txt>
		</View>
	);
}

/** Hook used by the project tab: the backends connected to a universe. */
export function useUniverseBackends(universeId: number) {
	const { backendForUniverse } = useAccounts();
	return backendForUniverse(universeId);
}
