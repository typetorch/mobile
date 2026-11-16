/**
 * One game server (any age): state, versions, health, its last hour of TPS / memory / players, its errors, alerts
 * and deploy reports. Polls every 5 s while open. A server that is gone keeps its offline history: when it went, its
 * timeline (alerts, deploy reports, generation swaps), its debug bundles and its whole-life charts.
 *
 * Remote debug (owners, web pages/Server.tsx): while the screen is in front the backend is told it watches the job
 * (every 20 s), the server picks that up at its next heartbeat (at once with a wake message) and long-polls for
 * commands; each fetch on a tab is one audited, read-only command whose answer stays in this screen's memory. The
 * read-only `web` role sees the heartbeats only. Roblox's own logs for the JobId need no session.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { LineChart } from "@/charts/LineChart";
import { Badge, Button, Card, Dot, ErrorState, Icon, KV, List, Row, Section, Segmented, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { Pressable } from "react-native";
import type { DebugStatus, FleetServerDetail, RemotePlayers, RemoteStatus } from "@/api/tt/types";
import { useServerStreams } from "@/features/maps/live-streams";
import { GeoCredit, HealthBadge, LocationLabel, networkText, ReasonList, reasonLines } from "@/features/typetorch/fleet-bits";
import { healthTone, useTTQuery } from "@/features/typetorch/hooks";
import { isReadOnly } from "@/features/typetorch/roles";
import { CONNECTED_GRACE_MS, useRemote, useRemoteRunner, useServerWatch } from "@/features/typetorch/server/remote-debug";
import { RobloxLogs } from "@/features/typetorch/server/roblox-logs";
import { DebugContext, ToneText, useFirstFetch, type DebugContextValue } from "@/features/typetorch/server/shared";
import { AuditTab, BudgetTab, BuildsTab, DexTab, ErrorsTab, GameTab, LogsTab, ModulesTab, NetworkTab, PlayersTab, StateTab, StatusTab, type PlayerLogRequest } from "@/features/typetorch/server/tabs";
import { usePageParam } from "@/features/typetorch/view-link";
import { useBackend } from "@/store/accounts";
import { chartMarks, DeployMarksToggle, useDeployMarks, useMarkCard } from "@/features/typetorch/marks";
import { TTScreen } from "@/features/typetorch/screen";
import { lifeStart, lifetimeMs, offlineText, timelineEvents, type TimelineEvent } from "@/api/tt/server-history";
import { compact, fmtAgo, fmtBytes, fmtDuration, fmtInt, fmtNum, fmtTime, shortId } from "@/lib/format";
import { useTheme } from "@/theme";

const METRIC_RANGES = [
	{ value: 1, label: "1 h" },
	{ value: 6, label: "6 h" },
	{ value: 24, label: "24 h" },
	{ value: 0, label: "Life" },
];

function timelineTone(e: TimelineEvent): "critical" | "warning" | "good" | "muted" {
	return e.tone === "critical" ? "critical" : e.tone === "warning" ? "warning" : e.tone === "good" ? "good" : "muted";
}


export const SERVER_TABS = [
	{ id: "status", label: "Status" },
	{ id: "logs", label: "Logs" },
	{ id: "players", label: "Players" },
	{ id: "game", label: "Game" },
	{ id: "map", label: "Live map" },
	{ id: "state", label: "State" },
	{ id: "dex", label: "Dex" },
	{ id: "modules", label: "Modules" },
	{ id: "builds", label: "Builds" },
	{ id: "budget", label: "Budget" },
	{ id: "errors", label: "Errors" },
	{ id: "network", label: "Network" },
	{ id: "audit", label: "Audit" },
] as const;
type TabId = (typeof SERVER_TABS)[number]["id"];

export const CONNECTING_TEXT = "Connecting: the server picks this up at its next heartbeat, up to 30 s.";
export const WAKING_TEXT = "Waking server...";
export const READ_ONLY_TEXT = "Read-only session: remote debug needs an owner.";
export const GONE_TEXT = "The fleet no longer has this server's heartbeats (kept 30 days after it goes). What it still holds is below.";

/** How the session looks from here: the backend's view, the last watch reply, and whether an answer came lately. */
export function sessionState(debug: DebugStatus | undefined, watch: DebugStatus | undefined, answeredAt: number | undefined, now = Date.now()): { connected: boolean; lastPollAt?: number } {
	const lastPollAt = Math.max(debug?.lastPollAt ?? 0, watch?.lastPollAt ?? 0) || undefined;
	const recent = answeredAt !== undefined && now - answeredAt < CONNECTED_GRACE_MS;
	return { connected: Boolean(debug?.connected || watch?.connected || recent), ...(lastPollAt ? { lastPollAt } : {}) };
}

/** How often the screen re-reads the server: every second while a wake is on its way, 5 s while it waits, 15 s once connected. */
export function detailRefetch(data: FleetServerDetail | undefined, waking = false): number | false {
	if (!data) return 5_000;
	if (data.state === "live") return data.debug.connected ? 15_000 : waking ? 1_000 : 5_000;
	return data.state === "lost" ? 30_000 : false;
}

/** Why a closed, lost, gone or unknown server has nothing to debug. */
function goneText(detail: FleetServerDetail): { title: string; text: string } {
	const s = detail.server;
	if (detail.state === "unknown") return { title: "No heartbeat from this JobId", text: "The fleet keeps a server's history for 30 days after it goes. Nothing to debug." };
	if (detail.state === "gone") return { title: "Gone", text: GONE_TEXT };
	if (detail.state === "closed") return { title: "Closed", text: `This server closed at ${fmtTime(s?.closedAt ?? s?.lastSeen)} UTC: nothing to debug. Its history is below.` };
	return { title: "Lost", text: `This server stopped sending heartbeats at ${fmtTime(s?.lostAt ?? s?.lastSeen)} UTC: nothing to debug. Its history is below.` };
}

export default function ServerScreen() {
	const { job } = useLocalSearchParams<{ job: string }>();
	const j = decodeURIComponent(String(job ?? ""));
	return (
		<TTScreen title={`Server ${shortId(j, 4)}`}>
			{({ backendId, account }) => <Server key={j} backendId={backendId} job={j} admin={account.role === "admin"} readOnly={isReadOnly(account)} />}
		</TTScreen>
	);
}

function Server({ backendId, job, admin, readOnly }: { backendId: string; job: string; admin: boolean; readOnly: boolean }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const [hours, setHours] = useState(1);
	const [waking, setWaking] = useState(false);
	const detail = useTTQuery(backendId, ["server", job], (a, s) => a.fleetServer(job, s), { refetchInterval: (q) => detailRefetch(q.state.data as FleetServerDetail | undefined, waking) });
	const live = detail.data?.state === "live";
	// The read-only web role sees the server (its heartbeats) but opens no debug session: the backend refuses its
	// watches and commands.
	const watch = useServerWatch(api, job, live && !readOnly);
	const [answeredAt, setAnsweredAt] = useState<number | undefined>();
	const onAnswer = useCallback(() => setAnsweredAt(Date.now()), []);
	const call = useRemoteRunner(api, job, onAnswer);
	const session = sessionState(detail.data?.debug, watch.reply, answeredAt);
	const ready = live && !readOnly && session.connected;
	const wakingNow = live && !session.connected && watch.reply?.wake === true;
	if (wakingNow !== waking) setWaking(wakingNow);
	const [tabParam, setTab] = usePageParam("tab", "status");
	const tabs = readOnly ? SERVER_TABS.filter((t) => t.id !== "audit") : SERVER_TABS;
	const tab: TabId = tabs.some((t) => t.id === tabParam) ? (tabParam as TabId) : "status";
	const status = useRemote<RemoteStatus>(call, "status");
	// Once, as soon as the server polls, whatever the tab: the header's place version and the Status tab come from it.
	useFirstFetch(ready, status.run);
	const players = useRemote<RemotePlayers>(call, "players");
	// Plans/34: the game's declarations and stream frames about every second while an owner's screen is open on a live server.
	const streams = useServerStreams(api, job, live && !readOnly && tab === "game");
	const [logRequest, setLogRequest] = useState<PlayerLogRequest | undefined>();
	const showLogs = useCallback(
		(userId: number) => {
			setLogRequest((r) => ({ userId, n: (r?.n ?? 0) + 1 }));
			setTab("logs");
		},
		[setTab],
	);
	const context = useMemo<DebugContextValue>(
		() => ({ backendId, job, call, ready, waitReason: readOnly ? READ_ONLY_TEXT : live ? (wakingNow ? WAKING_TEXT : CONNECTING_TEXT) : "This server isn't running." }),
		[backendId, job, call, ready, live, wakingNow, readOnly],
	);
	const life = detail.data ? lifeStart(detail.data) : undefined;
	const since = hours === 0 ? (life ?? Date.now() - 24 * 3_600_000) : Math.floor((Date.now() - hours * 3_600_000) / 60_000) * 60_000;
	const metrics = useTTQuery(backendId, ["server", job, "metrics", hours, hours === 0 ? since : 0], (api, s) => api.serverMetrics(job, since, s), { refetchInterval: 15_000, retry: false, enabled: hours !== 0 || !!detail.data });
	const errors = useTTQuery(backendId, ["server", job, "errors"], (api, s) => api.serverErrors(job, { window: "24h" }, s), { staleTime: 30_000, retry: false });
	// Deploy marks on the status charts (this server's branch and the place-wide ones); a tap opens a mark's card.
	const markRange = useMemo(() => ({ from: since, to: Math.ceil(Date.now() / 60_000) * 60_000 }), [since]);
	const deploys = useDeployMarks(backendId, markRange, detail.data?.server?.branch ?? undefined, { enabled: !!detail.data });
	const card = useMarkCard(backendId);
	const chartMarkList = chartMarks(p, deploys.marks);

	const timeline = detail.data ? timelineEvents(detail.data) : [];
	const bundles = detail.data?.history?.bundles ?? [];
	const history = (
		<>
				<Section title="Errors, 24 h">
					{errors.error ? (
						<Txt variant="small">{errors.error.message}</Txt>
					) : !errors.data ? (
						<Skeleton height={60} />
					) : errors.data.errors.length ? (
						<List>
							{errors.data.errors.slice(0, 30).map((e) => (
								<Row
									key={e.fp}
									chevron
									onPress={() => router.push(`/tt/${backendId}/error/${encodeURIComponent(e.fp)}`)}
									title={e.template}
									subtitle={`${compact(e.count)}× · ${e.realms.join(", ")} · last ${fmtAgo(e.lastAt)}`}
								/>
							))}
						</List>
					) : (
						<Txt variant="muted">No errors from this server in the last 24 hours.</Txt>
					)}
				</Section>

				{timeline.length ? (
					<Section title="Timeline">
						<List>
							{timeline.slice(0, 60).map((e) => {
								const seq = e.kind === "report" ? Number(e.key.split(":")[1]) : null;
								const open = e.bundle ? () => router.push(`/tt/${backendId}/bundle/${e.bundle}`) : seq ? () => router.push(`/tt/${backendId}/deploy/${seq}`) : undefined;
								return (
									<Row
										key={e.key}
										left={<Dot tone={timelineTone(e)} />}
										title={e.title}
										subtitle={`${fmtTime(e.at)} UTC${e.detail ? ` · ${e.detail}` : ""}${e.bundle ? " · debug bundle" : ""}`}
										numberOfLines={2}
										{...(open ? { onPress: open, chevron: true } : {})}
									/>
								);
							})}
						</List>
					</Section>
				) : null}

				{bundles.length ? (
					<Section title="Debug bundles">
						<Txt variant="small">What this server sent when something failed (kept 30 days, 20 per server). Shown as text.</Txt>
						<List>
							{bundles.map((b) => (
								<Row
									key={b.id}
									chevron
									onPress={() => router.push(`/tt/${backendId}/bundle/${b.id}`)}
									left={<Dot tone={b.level === "critical" ? "critical" : b.level === "warning" ? "warning" : "muted"} />}
									title={b.message || b.code}
									subtitle={`${b.code} · ${fmtTime(b.at)}${b.stage ? ` · ${b.stage}` : ""} · ${fmtInt(b.players)} players · ${fmtBytes(b.size)}`}
									numberOfLines={2}
								/>
							))}
						</List>
					</Section>
				) : null}

		</>
	);

	if (detail.error) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
	if (!detail.data) return <Skeleton height={200} />;
	const s = detail.data.server;
	if (!s) {
		// Gone (past the fleet's 30 days, but alerts, reports or bundles still name it) or unknown: what it still holds.
		const gone = goneText(detail.data);
		return (
			<>
				<Card style={{ gap: 4 }}>
					<Txt variant="mono" selectable>
						{job}
					</Txt>
					<Badge label="offline" />
					<Txt style={{ fontWeight: "600" }}>{gone.title}</Txt>
					<Txt variant="small">{gone.text}</Txt>
				</Card>
				{detail.data.state !== "unknown" ? history : null}
				{detail.data.state !== "unknown" ? <RobloxLogs backendId={backendId} job={job} /> : null}
			</>
		);
	}
	const state = detail.data.state;
	const pts = metrics.data ?? [];
	const loc = s.location;
	const placeVersion = s.placeVersion ?? status.data?.status?.placeVersion ?? undefined;
	const lived = lifetimeMs(detail.data);
	const timeLabel = (t: number) => (hours === 0 && lived !== undefined && lived > 86_400_000 ? new Date(t).toISOString().slice(5, 16).replace("T", " ") : new Date(t).toISOString().slice(11, 16));

	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Dot tone={state === "live" ? healthTone(s.health) : state === "lost" ? "critical" : "muted"} />
					<Txt variant="mono" selectable style={{ flex: 1 }}>
						{job}
					</Txt>
					<Badge label={state === "live" ? "live" : "offline"} tone={state === "live" ? "good" : state === "lost" ? "critical" : "muted"} />
				</View>
				{state !== "live" ? <Txt variant="small">Offline: {offlineText(detail.data)}</Txt> : null}
				{lived !== undefined ? <Txt variant="small">{state === "live" ? "Up" : "Ran for"} {fmtDuration(lived)}</Txt> : null}
				<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
					{state === "live" ? <HealthBadge server={s} /> : null}
					<LocationLabel location={loc} />
					{placeVersion ? <Txt variant="small">place v{placeVersion}</Txt> : null}
				</View>
				{state === "live" && reasonLines(s).length ? (
					<View style={{ gap: 4 }}>
						<Txt variant="label">Why it is {s.health && s.health !== "ok" ? s.health : "flagged"}</Txt>
						<ReasonList lines={reasonLines(s)} />
					</View>
				) : null}
				{loc ? <GeoCredit geo={detail.data.geo} /> : null}
			</Card>

			{state !== "live" ? (
				<Card style={{ gap: 4 }}>
					<Txt style={{ fontWeight: "600" }}>{goneText(detail.data).title}</Txt>
					<Txt variant="small">{goneText(detail.data).text}</Txt>
				</Card>
			) : (
				<DebugContext.Provider value={context}>
					<Section title="Debug session">
						{readOnly ? (
							<ToneText tone="muted">{READ_ONLY_TEXT}</ToneText>
						) : watch.error ? (
							<ToneText tone="critical">{`Watch refused: ${watch.error}`}</ToneText>
						) : session.connected ? (
							<ToneText tone="good">{`Connected${session.lastPollAt ? `, last poll ${fmtTime(session.lastPollAt).slice(11)} UTC` : ""}`}</ToneText>
						) : (
							<ToneText tone="warning">{wakingNow ? WAKING_TEXT : watch.reply !== undefined ? CONNECTING_TEXT : "Opening a session"}</ToneText>
						)}
						<Txt variant="small">
							{readOnly ? "Heartbeats and the audit only: no commands go to the server from this session." : "Read only. Every fetch is one audited command; answers stay in this screen (gone when you leave it)."}
						</Txt>
						<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
							{tabs.map((t) => {
								const on = t.id === tab;
								return (
									<Pressable
										key={t.id}
										onPress={() => (t.id === "map" && !readOnly ? router.push(`/tt/${backendId}/server-map/${encodeURIComponent(job)}`) : setTab(t.id))}
										style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? p.brand : p.border, backgroundColor: on ? p.brand : p.card }}
									>
										<Txt variant="small" color={on ? p.brandForeground : p.foreground} style={{ fontWeight: "600" }}>
											{t.label}
											{t.id === "map" && !readOnly ? " ↗" : ""}
										</Txt>
									</Pressable>
								);
							})}
						</ScrollView>
						<View style={{ display: tab === "status" ? "flex" : "none" }}>
							<StatusTab status={status} />
						</View>
						<View style={{ display: tab === "logs" ? "flex" : "none" }}>
							<LogsTab active={tab === "logs"} players={players} request={logRequest} />
						</View>
						<View style={{ display: tab === "players" ? "flex" : "none" }}>
							<PlayersTab active={tab === "players"} players={players} onLogs={showLogs} />
						</View>
						{tab === "game" ? readOnly ? <Txt variant="muted">{READ_ONLY_TEXT}</Txt> : <GameTab streams={streams} /> : null}
						{tab === "map" ? (
							readOnly ? (
								<Txt variant="muted">{READ_ONLY_TEXT}</Txt>
							) : (
								<Button title="Open the live map" small icon="locate-outline" onPress={() => router.push(`/tt/${backendId}/server-map/${encodeURIComponent(job)}`)} style={{ alignSelf: "flex-start" }} />
							)
						) : null}
						<View style={{ display: tab === "state" ? "flex" : "none" }}>
							<StateTab active={tab === "state"} />
						</View>
						<View style={{ display: tab === "dex" ? "flex" : "none" }}>
							<DexTab active={tab === "dex"} />
						</View>
						<View style={{ display: tab === "modules" ? "flex" : "none" }}>
							<ModulesTab active={tab === "modules"} />
						</View>
						<View style={{ display: tab === "builds" ? "flex" : "none" }}>
							<BuildsTab active={tab === "builds"} />
						</View>
						<View style={{ display: tab === "budget" ? "flex" : "none" }}>
							<BudgetTab active={tab === "budget"} />
						</View>
						<View style={{ display: tab === "errors" ? "flex" : "none" }}>
							<ErrorsTab active={tab === "errors"} />
						</View>
						<View style={{ display: tab === "network" ? "flex" : "none" }}>
							<NetworkTab active={tab === "network"} />
						</View>
						{!readOnly && tab === "audit" ? <AuditTab backendId={backendId} active job={job} /> : null}
					</Section>
				</DebugContext.Provider>
			)}

			<StatGrid>
				<Stat label="Players" value={`${fmtInt(s.players)}/${fmtInt(s.maxPlayers)}`} />
				<Stat label="TPS" value={s.tps !== null && s.tps !== undefined ? fmtNum(s.tps, 1) : "–"} sub={s.tpsMin !== null && s.tpsMin !== undefined ? `min ${fmtNum(s.tpsMin, 1)}` : undefined} />
				<Stat label="Memory" value={s.memMb !== null && s.memMb !== undefined ? `${fmtInt(s.memMb)} MB` : "–"} sub={s.luaMb !== null && s.luaMb !== undefined ? `Lua ${fmtInt(s.luaMb)} MB` : undefined} />
				<Stat label="Physics" value={s.physFps !== null && s.physFps !== undefined ? `${fmtNum(s.physFps, 0)} FPS` : "–"} />
			</StatGrid>


			<Section title="Last hours" right={<Segmented options={METRIC_RANGES} value={hours} onChange={setHours} style={{ width: 210 }} />}>
				{metrics.error ? (
					<Txt variant="small">{metrics.error.message}</Txt>
				) : !metrics.data ? (
					<Skeleton height={140} />
				) : pts.length ? (
					<>
						<Card style={{ gap: 6 }}>
							<Txt variant="label">TPS</Txt>
							<LineChart
								series={[
									{ label: "TPS", points: pts.map((x) => ({ t: x.t, v: x.tps })) },
									{ label: "Slowest second", points: pts.map((x) => ({ t: x.t, v: x.tpsMin })) },
								]}
								timeLabel={timeLabel}
								height={130}
								marks={chartMarkList}
								onMarkPress={card.open}
							/>
						</Card>
						<Card style={{ gap: 6 }}>
							<Txt variant="label">Memory (MB)</Txt>
							<LineChart
								series={[
									{ label: "Total", points: pts.map((x) => ({ t: x.t, v: x.memMb })) },
									{ label: "Lua heap", points: pts.map((x) => ({ t: x.t, v: x.luaMb })) },
								]}
								timeLabel={timeLabel}
								height={130}
								marks={chartMarkList}
								onMarkPress={card.open}
							/>
						</Card>
						<Card style={{ gap: 6 }}>
							<Txt variant="label">Players</Txt>
							<LineChart series={[{ label: "Players", points: pts.map((x) => ({ t: x.t, v: x.players })) }]} timeLabel={timeLabel} height={110} marks={chartMarkList} onMarkPress={card.open} />
						</Card>
						<DeployMarksToggle {...deploys} />
						{card.sheet}
					</>
				) : (
					<Txt variant="muted">{hours === 0 ? "No metrics kept for this server (kernel 0.4.2+ sends them; raw points go after a day, 5-minute rollups later)." : "No metrics in this window (kernel 0.4.2+ sends them)."}</Txt>
				)}
			</Section>

			<Section title="Details">
				<Card>
					<KV label="Branch" value={s.branch ?? "–"} />
					<KV label="Channel" value={s.channel ?? "–"} />
					<KV label="Artifact" value={shortId(s.artifact, 8)} mono />
					<KV label="Applied deploy" value={s.appliedSeq !== null ? `#${s.appliedSeq}` : "–"} />
					<KV label="Kernel" value={s.kernel ?? "–"} />
					<KV label="Health" value={s.health ?? "–"} />
					<KV label="Place" value={s.placeId ? `${s.placeId}${placeVersion ? ` v${placeVersion}` : ""}` : "–"} />
					<KV label="Type" value={s.serverType ?? "–"} />
					<KV label="Started" value={s.startedAt ? `${fmtTime(s.startedAt)} (${fmtAgo(s.startedAt)})` : "–"} />
					<KV label="Last heartbeat" value={fmtAgo(s.lastSeen ?? s.lastWrite)} />
					{s.closedAt ? <KV label="Closed" value={fmtTime(s.closedAt)} /> : null}
					{s.lostAt ? <KV label="Lost" value={fmtTime(s.lostAt)} /> : null}
					{loc ? <KV label="Location" value={[loc.city, loc.region, loc.countryName ?? loc.country].filter(Boolean).join(", ") || "–"} /> : null}
					{loc && networkText(loc) ? <KV label="Network" value={networkText(loc) as string} /> : null}
					{s.ip !== undefined ? (
						<KV
							label="IP"
							value={`${s.ip ?? "–"}${s.firstIp && s.ip && s.firstIp !== s.ip ? ` (first ${s.firstIp}${s.ipChangedAt ? `, changed ${fmtAgo(s.ipChangedAt)}` : ""})` : ""}`}
							mono
						/>
					) : null}
					<KV label="Remote debug" value={detail.data.debug.connected ? "connected" : detail.data.debug.watched ? "watched" : "off"} />
					<KV label="Debug watch" value={admin ? (watch.reply ? `until ${fmtTime(watch.reply.watchedUntil ?? null).slice(11)} UTC` : "–") : "owners only"} />
				</Card>
			</Section>

			{history}
			{state !== "unknown" ? <RobloxLogs backendId={backendId} job={job} placeVersion={placeVersion} /> : null}
		</>
	);
}
