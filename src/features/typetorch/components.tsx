/**
 * The TypeTorch dashboard's shared pieces: the backend header, the signed-out notice, the page menu, and the home
 * (Overview) body that both /tt/<id> and the project's TypeTorch tab show.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Switch, View } from "react-native";

import type { FleetAlert } from "@/api/tt/types";
import { BarChart } from "@/charts/LineChart";
import { Badge, Button, Card, Dot, ErrorState, Icon, List, Row, Section, Segmented, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { compact, fmtAgo, fmtInt, fmtMinutes, fmtNum } from "@/lib/format";
import { useAccounts, useBackend, type BackendAccount } from "@/store/accounts";
import { useTheme } from "@/theme";

import { dayRange, useTTQuery } from "./hooks";
import { chartMarks, DeployMarksToggle, useDeployMarks, useMarkCard } from "./marks";
import { pageHref, TT_PAGES } from "./pages";

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

const RANGES = [
	{ value: 1, label: "Today" },
	{ value: 7, label: "7 days" },
	{ value: 28, label: "28 days" },
] as const;

function alertTone(level: FleetAlert["level"]): "critical" | "warning" | "muted" {
	return level === "critical" ? "critical" : level === "warning" ? "warning" : "muted";
}

/** The Overview: live fleet, the analytics overview query, errors, the latest deploy and alerts. */
export function TTHome({ backendId, poll = true }: { backendId: string; poll?: boolean }) {
	const p = useTheme();
	const { account } = useBackend(backendId);
	const [days, setDays] = useState<number>(7);
	const fleet = useTTQuery(backendId, ["fleet", "servers"], (api, s) => api.fleetServers(undefined, s), { refetchInterval: poll ? 15_000 : false });
	const overview = useTTQuery(backendId, ["query", "overview", days], (api, s) => api.query("overview", dayRange(days), {}, s), { staleTime: 60_000 });
	const errors = useTTQuery(backendId, ["errors", "24h", ""], (api, s) => api.errors({ window: "24h", limit: 5 }, s), { staleTime: 60_000 });
	const deploys = useTTQuery(backendId, ["deploys", "latest"], (api, s) => api.fleetDeploys({ limit: 1 }, s), { staleTime: 60_000 });
	const alerts = useTTQuery(backendId, ["alerts", "recent"], (api, s) => api.fleetAlerts({ limit: 5 }, s), { staleTime: 30_000 });
	// Deploy marks on the players chart (a tap opens a mark's card).
	const dayStart = Date.parse(`${dayRange(days).from}T00:00:00Z`);
	const markRange = useMemo(() => ({ from: dayStart, to: dayStart + days * 86_400_000 }), [dayStart, days]);
	const marksQ = useDeployMarks(backendId, markRange, undefined, { enabled: !!overview.data });
	// "vs previous period": the same number of days right before, drawn dashed over the bars (the web's DayBars `previous`).
	const [vsPrev, setVsPrev] = useState(false);
	const prevFrom = new Date(dayStart - days * 86_400_000).toISOString().slice(0, 10);
	const prevTo = new Date(dayStart - 86_400_000).toISOString().slice(0, 10);
	const prevQ = useTTQuery(backendId, ["query", "overview", "prev", prevFrom, prevTo], (api, s) => api.query("overview", { from: prevFrom, to: prevTo }, {}, s), { staleTime: 60_000, enabled: vsPrev });
	const shift = days * 86_400_000;
	const prevDays = useMemo(() => new Map((prevQ.data?.days ?? []).map((d) => [Date.parse(d.date) + shift, d.players])), [prevQ.data, shift]);
	const prevSteps = useMemo(() => new Map((prevQ.data?.buckets ?? []).map((b) => [b.t + shift, b.players])), [prevQ.data, shift]);
	const card = useMarkCard(backendId);
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

			<Section title="Players" right={<Segmented options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={days} onChange={setDays} style={{ width: 220 }} />}>
				{overview.error ? <ErrorState error={overview.error} onRetry={() => overview.refetch()} /> : null}
				{!o && !overview.error ? <Skeleton height={120} /> : null}
				{o ? (
					<>
						<StatGrid>
							<Stat label="Players" value={fmtInt(o.players)} sub={`${fmtInt(o.newPlayers)} new · ${fmtInt(o.returningPlayers)} returning`} />
							<Stat label="Sessions" value={fmtInt(o.sessions)} sub={`${fmtMinutes(o.avgSessionMinutes)} avg`} />
							<Stat label="Playtime" value={`${fmtNum(o.playtimeHours, 1)} h`} sub={`${fmtMinutes(o.playtimePerPlayerMinutes)} per player`} />
							<Stat label="Events" value={compact(o.events)} />
						</StatGrid>
						{o.days.length > 1 ? (
							<Card style={{ gap: 6 }}>
								<Txt variant="label">Players per day</Txt>
								<BarChart
									points={o.days.map((d) => ({ t: Date.parse(d.date), v: d.players }))}
									format={compact}
									marks={chartMarks(p, marksQ.marks)}
									onMarkPress={card.open}
									{...(vsPrev && prevQ.data ? { previous: o.days.map((d) => prevDays.get(Date.parse(d.date)) ?? null) } : {})}
								/>
								<PrevToggle on={vsPrev} onChange={setVsPrev} />
								<DeployMarksToggle {...marksQ} />
							</Card>
						) : o.buckets?.length ? (
							<Card style={{ gap: 6 }}>
								<Txt variant="label">Players per step</Txt>
								<BarChart
									points={o.buckets.map((b) => ({ t: b.t, v: b.players }))}
									format={compact}
									timeLabel={(t) => new Date(t).toISOString().slice(11, 16)}
									marks={chartMarks(p, marksQ.marks)}
									onMarkPress={card.open}
									{...(vsPrev && prevQ.data ? { previous: o.buckets.map((b) => prevSteps.get(b.t) ?? null) } : {})}
								/>
								<PrevToggle on={vsPrev} onChange={setVsPrev} />
								<DeployMarksToggle {...marksQ} />
							</Card>
						) : null}
					</>
				) : null}
			</Section>

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

function PrevToggle({ on, onChange }: { on: boolean; onChange(on: boolean): void }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
			<Switch value={on} onValueChange={onChange} />
			<Txt variant="small" style={{ flex: 1 }}>
				vs previous period (dashed)
			</Txt>
		</View>
	);
}

/** Hook used by the project tab: the backends connected to a universe. */
export function useUniverseBackends(universeId: number) {
	const { backendForUniverse } = useAccounts();
	return backendForUniverse(universeId);
}
