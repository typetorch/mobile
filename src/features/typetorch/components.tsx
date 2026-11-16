/**
 * The TypeTorch dashboard's shared pieces: the backend header, the signed-out notice, the page menu, and the home
 * (Overview) body that both /tt/<id> and the project's TypeTorch tab show.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Switch, View } from "react-native";

import { change } from "@/api/tt/benchmarks";
import { previousPeriod, type PreviousPeriod } from "@/api/tt/compare";
import { bucketText } from "@/api/tt/perf";
import type { FleetAlert, OverviewResult, StorageReport } from "@/api/tt/types";
import { LineChart } from "@/charts/LineChart";
import { Badge, Button, Card, Dot, ErrorState, Icon, KV, List, Row, Section, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { compact, fmtAgo, fmtBytes, fmtInt, fmtMinutes, fmtNum } from "@/lib/format";
import { useAccounts, useBackend, type BackendAccount } from "@/store/accounts";
import { useTheme } from "@/theme";

import { ChangeChip, ShareRow } from "./bits";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "./filters";
import { useTTQuery } from "./hooks";
import { useDeployMarks } from "./marks";
import { pageHref, TT_PAGES } from "./pages";
import { SavedQueryTile } from "./saved-query";

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
		</Card>
	);
}

export function PageMenu({ account }: { account: BackendAccount }) {
	const p = useTheme();
	const admin = account.role === "admin";
	const pages = TT_PAGES.filter((x) => x.key !== "overview" && (!x.adminOnly || admin));
	const ready = pages.filter((x) => x.status === "ready");
	const todo = pages.filter((x) => x.status === "todo");
	return (
		<>
			<Section title="Dashboard">
				<List>
					{ready.map((x) => (
						<Row key={x.key} left={<Icon name={x.icon} size={18} />} title={x.title} subtitle={x.description} chevron onPress={() => router.push(pageHref(account.id, x.key))} />
					))}
				</List>
			</Section>
			{todo.length ? (
				<Section title="Coming to the app">
					<List>
						{todo.map((x) => (
							<Row key={x.key} left={<Icon name={x.icon} size={18} color={p.mutedForeground} />} title={x.title} subtitle={`${x.description} · use the web explorer for now`} disabled />
						))}
					</List>
				</Section>
			) : null}
		</>
	);
}

const DAY_MS = 86_400_000;

/** The web Overview's charts. */
const CHARTS: { key: "players" | "newPlayers" | "sessions" | "playtimeHours"; label: string }[] = [
	{ key: "players", label: "Players" },
	{ key: "newPlayers", label: "New players" },
	{ key: "sessions", label: "Sessions" },
	{ key: "playtimeHours", label: "Playtime (hours)" },
];

/** The web Overview's eight tiles: label, the number the change chip compares, its text. */
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

/** One chart's points: per step for windows of a day or less (the backend's buckets), else per day (the web's overviewBars). */
function overviewPoints(data: OverviewResult, key: (typeof CHARTS)[number]["key"], shiftMs = 0): { points: { t: number; v: number }[]; per: string; step: boolean } {
	const step = data.bucketMs;
	if (step && step < DAY_MS && data.buckets) {
		return { points: data.buckets.map((b) => ({ t: b.t + shiftMs, v: b[key] })), per: `per ${bucketText(step)} (UTC)`, step: true };
	}
	return { points: data.days.map((d) => ({ t: Date.parse(d.date) + shiftMs, v: d[key] })), per: "per day (UTC)", step: false };
}

/** The analytics overview under the filter bar: eight tiles (vs the previous period when on), four charts with deploy marks. */
function OverviewBody({ backendId, data, previous, period, branch }: { backendId: string; data: OverviewResult; previous?: OverviewResult; period?: PreviousPeriod; branch?: string }) {
	const p = useTheme();
	const marks = useDeployMarks(backendId, Date.parse(data.from), Date.parse(data.to), branch);
	const markLines = (marks.data ?? []).map((m) => ({ t: m.at, color: m.kind === "rollback" ? p.destructive : p.warning }));
	return (
		<>
			<StatGrid>
				{TILES.map((t) => (
					<Stat key={t.label} label={t.label} value={t.text(data)} sub={previous ? <ChangeChip change={change(t.value(data), t.value(previous))} /> : undefined} />
				))}
			</StatGrid>
			{CHARTS.map((c) => {
				const cur = overviewPoints(data, c.key);
				const prev = previous && period ? overviewPoints(previous, c.key, period.shiftMs) : undefined;
				if (cur.points.length < 2 && !prev) return null;
				return (
					<Card key={c.key} style={{ gap: 6 }}>
						<Txt variant="label">
							{c.label}, {cur.per}
							{prev ? "; dashed: the previous period" : ""}
						</Txt>
						<LineChart
							series={[{ label: c.label, points: cur.points }, ...(prev ? [{ label: "Previous period", points: prev.points, dashed: true }] : [])]}
							format={c.key === "playtimeHours" ? (v) => fmtNum(v, 1) : compact}
							{...(cur.step ? { timeLabel: (t: number) => new Date(t).toISOString().slice(11, 16) } : {})}
							marks={markLines}
							height={130}
						/>
					</Card>
				);
			})}
		</>
	);
}

/** The saved queries pinned on the Query page; nothing when none are (or the backend has no saved queries). */
function PinnedQueries({ backendId }: { backendId: string }) {
	const list = useTTQuery(backendId, ["saved-queries"], (api, s) => api.savedQueries(s), { retry: false, staleTime: 30_000 });
	const pinned = (list.data ?? []).filter((q) => q.pinned);
	if (!pinned.length) return null;
	return (
		<Section title="Pinned queries">
			{pinned.map((q) => (
				<SavedQueryTile key={q.id} backendId={backendId} query={q} />
			))}
		</Section>
	);
}

/** What the analytics server keeps on disk (GET /v1/storage, owners only), with the disk's free space. */
function StorageCard({ backendId }: { backendId: string }) {
	const p = useTheme();
	const q = useTTQuery<StorageReport>(backendId, ["storage"], (api, s) => api.storage(s), { refetchInterval: 30_000, retry: false });
	return (
		<Section title="Storage">
			{q.error ? (
				<Txt variant="small">{q.error.message}</Txt>
			) : !q.data ? (
				<Skeleton height={100} />
			) : (
				<Card style={{ gap: 6 }}>
					<Txt variant="muted">What the analytics server keeps on disk. Not filtered.</Txt>
					<KV label="Total" value={fmtBytes(q.data.totalBytes)} />
					{q.data.disk ? (
						<KV
							label="Disk free"
							value={
								<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
									<Txt>
										{fmtBytes(q.data.disk.freeBytes)} of {fmtBytes(q.data.disk.totalBytes)} ({fmtNum(q.data.disk.freePercent, 0)}%)
									</Txt>
									{q.data.disk.level !== "ok" ? <Badge label={q.data.disk.level === "critical" ? "low" : "getting low"} tone={q.data.disk.level === "critical" ? "critical" : "warning"} /> : null}
								</View>
							}
						/>
					) : null}
					{q.data.growth ? (
						<KV label="Growth" value={`${fmtBytes(q.data.growth.todayBytes)} today${q.data.growth.avgPerDayBytes !== null ? ` · ${fmtBytes(q.data.growth.avgPerDayBytes)} a day` : ""}`} />
					) : null}
					{q.data.parts
						.filter((x) => x.bytes > 0)
						.sort((a, b) => b.bytes - a.bytes)
						.slice(0, 8)
						.map((x) => (
							<ShareRow key={x.key} label={x.label} value={fmtBytes(x.bytes)} share={q.data.totalBytes ? x.bytes / q.data.totalBytes : 0} sub={x.days !== undefined ? `${fmtInt(x.days)} days` : undefined} />
						))}
					{q.data.disk && q.data.disk.level !== "ok" ? (
						<Txt variant="small" color={q.data.disk.level === "critical" ? p.destructive : p.warning}>
							Free space is under {q.data.disk.level === "critical" ? q.data.disk.criticalFreePercent : q.data.disk.warnFreePercent}% of the disk.
						</Txt>
					) : null}
				</Card>
			)}
		</Section>
	);
}

function alertTone(level: FleetAlert["level"]): "critical" | "warning" | "muted" {
	return level === "critical" ? "critical" : level === "warning" ? "warning" : "muted";
}

/** The Overview: live fleet, the analytics overview query, errors, the latest deploy and alerts. */
export function TTHome({ backendId, poll = true }: { backendId: string; poll?: boolean }) {
	const p = useTheme();
	const { account } = useBackend(backendId);
	const { state, apiFilters } = useTTFilters(backendId);
	const [compare, setCompare] = useState(false);
	const period = useMemo(() => previousPeriod(state), [state]);
	const fleet = useTTQuery(backendId, ["fleet", "servers"], (api, s) => api.fleetServers(undefined, s), { refetchInterval: poll ? 15_000 : false });
	// The filter bar's range and filters (branch, artifact, device, new / returning, variant), like the web's Overview.
	const overview = useTTAnalytics(backendId, "overview", {}, { staleTime: 60_000, keepPrevious: true });
	const prevOverview = useTTAnalytics(backendId, "overview", {}, { staleTime: 60_000, enabled: compare && period !== undefined, ...(period ? { filters: period.filters } : {}) });
	const branch = typeof apiFilters.branch === "string" ? apiFilters.branch : undefined;
	const errors = useTTQuery(backendId, ["errors", "24h", ""], (api, s) => api.errors({ window: "24h", limit: 5 }, s), { staleTime: 60_000 });
	const deploys = useTTQuery(backendId, ["deploys", "latest"], (api, s) => api.fleetDeploys({ limit: 1 }, s), { staleTime: 60_000 });
	const alerts = useTTQuery(backendId, ["alerts", "recent"], (api, s) => api.fleetAlerts({ limit: 5 }, s), { staleTime: 30_000 });
	if (!account) return null;

	const unhealthy = fleet.data ? fleet.data.servers.filter((s) => (s.reasons?.length ?? 0) > 0 || (s.health && s.health !== "ok")).length : null;
	const latest = deploys.data?.deploys[0];
	const o = overview.data;

	return (
		<View style={{ gap: 12 }}>
			<SignedOutNotice account={account} />
			<Section title="Live">
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

			<Section title="Players">
				<FilterBar backendId={backendId} />
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Txt variant="small" style={{ flex: 1 }}>
						Players, sessions and playtime, {describeRange(state)}. Session length = first to last event.
					</Txt>
					<Txt variant="small">vs before</Txt>
					<Switch value={compare && !!period} onValueChange={setCompare} disabled={!period} />
				</View>
				{overview.error ? <ErrorState error={overview.error} onRetry={() => overview.refetch()} /> : null}
				{!o && !overview.error ? <Skeleton height={120} /> : null}
				{o ? <OverviewBody backendId={backendId} data={o} {...(compare && prevOverview.data && period ? { previous: prevOverview.data, period } : {})} {...(branch ? { branch } : {})} /> : null}
			</Section>

			<PinnedQueries backendId={backendId} />

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

			{account.role === "admin" ? <StorageCard backendId={backendId} /> : null}

			<PageMenu account={account} />
			<Txt variant="small" style={{ textAlign: "center", color: p.mutedForeground }}>
				Pull to refresh · live numbers update every 15 s
			</Txt>
		</View>
	);
}

/** Hook used by the project tab: the backends connected to a universe. */
export function useUniverseBackends(universeId: number) {
	const { backendForUniverse } = useAccounts();
	return backendForUniverse(universeId);
}
