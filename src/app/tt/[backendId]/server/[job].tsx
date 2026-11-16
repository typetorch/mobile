/**
 * One game server (any age): state, versions, health, its last hour of TPS / memory / players, its errors, alerts
 * and deploy reports. Polls every 5 s while open. A server that is gone keeps its offline history: when it went, its
 * timeline (alerts, deploy reports, generation swaps), its debug bundles, its errors (30 days) and its whole-life charts,
 * also once the fleet's row is gone (state "gone", server null; only "unknown" means nothing is kept). (Remote debug
 * commands are web-only for now.)
 */
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { LineChart } from "@/charts/LineChart";
import { Badge, Card, Dot, ErrorState, KV, List, Row, Section, Segmented, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { healthTone, useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { lifeStart, lifetimeMs, offlineText, timelineEvents, type TimelineEvent } from "@/api/tt/server-history";
import { compact, fmtAgo, fmtBytes, fmtDuration, fmtInt, fmtNum, fmtTime, shortId } from "@/lib/format";
import { useTheme } from "@/theme";

/** The error log keeps 30 days, like the fleet keeps gone servers (the web's SERVER_ERRORS_WINDOW). */
const SERVER_ERRORS_WINDOW = "30d";

/** The web's GONE_TEXT. */
const GONE_TEXT = "The fleet no longer has this server's heartbeats (kept 30 days after it goes). What it still holds is below.";

const METRIC_RANGES = [
	{ value: 1, label: "1 h" },
	{ value: 6, label: "6 h" },
	{ value: 24, label: "24 h" },
	{ value: 0, label: "Life" },
];

function timelineTone(e: TimelineEvent): "critical" | "warning" | "good" | "muted" {
	return e.tone === "critical" ? "critical" : e.tone === "warning" ? "warning" : e.tone === "good" ? "good" : "muted";
}

export default function ServerScreen() {
	const { job } = useLocalSearchParams<{ job: string }>();
	const j = decodeURIComponent(String(job ?? ""));
	return <TTScreen title={`Server ${shortId(j, 4)}`}>{({ backendId, account }) => <Server backendId={backendId} job={j} admin={account.role === "admin"} />}</TTScreen>;
}

function Server({ backendId, job, admin }: { backendId: string; job: string; admin: boolean }) {
	const p = useTheme();
	// null: 1 h for a live server, its whole life for one that went.
	const [picked, setHours] = useState<number | null>(null);
	const detail = useTTQuery(backendId, ["server", job], (api, s) => api.fleetServer(job, s), {
		// Live: every 5 s; lost (it may come back): every 30 s; closed / gone / unknown: no polling.
		refetchInterval: (q) => (!q.state.data || q.state.data.state === "live" ? 5_000 : q.state.data.state === "lost" ? 30_000 : false),
	});
	const hours = picked ?? (detail.data && detail.data.state !== "live" ? 0 : 1);
	const life = detail.data ? lifeStart(detail.data) : undefined;
	const since = hours === 0 ? (life ?? Date.now() - 24 * 3_600_000) : Math.floor((Date.now() - hours * 3_600_000) / 60_000) * 60_000;
	const metrics = useTTQuery(backendId, ["server", job, "metrics", hours, hours === 0 ? since : 0], (api, s) => api.serverMetrics(job, since, s), { refetchInterval: 15_000, retry: false, enabled: hours !== 0 || !!detail.data });
	const errors = useTTQuery(backendId, ["server", job, "errors", SERVER_ERRORS_WINDOW], (api, s) => api.serverErrors(job, { window: SERVER_ERRORS_WINDOW }, s), {
		staleTime: 30_000,
		retry: false,
	});

	if (detail.error) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
	if (!detail.data) return <Skeleton height={200} />;
	const state = detail.data.state;
	if (state === "unknown")
		return <ErrorState title="No heartbeat from this JobId" error={`The fleet keeps a server's history for 30 days after it goes; nothing is kept for ${job}.`} />;
	// "gone": the row is past the fleet's 30 days (server null), but its alerts, reports, bundles and metrics remain.
	const s = detail.data.server;
	const pts = metrics.data ?? [];
	const loc = s?.location;
	const lived = lifetimeMs(detail.data);
	const timeline = timelineEvents(detail.data);
	const bundles = detail.data.history?.bundles ?? [];
	const timeLabel = (t: number) => (hours === 0 && lived !== undefined && lived > 86_400_000 ? new Date(t).toISOString().slice(5, 16).replace("T", " ") : new Date(t).toISOString().slice(11, 16));

	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Dot tone={state === "live" ? healthTone(s?.health) : state === "lost" ? "critical" : "muted"} />
					<Txt variant="mono" selectable style={{ flex: 1 }}>
						{job}
					</Txt>
					<Badge label={state === "live" ? "live" : "offline"} tone={state === "live" ? "good" : state === "lost" ? "critical" : "muted"} />
				</View>
				{state !== "live" ? <Txt variant="small">Offline: {offlineText(detail.data)}</Txt> : null}
				{state === "gone" ? <Txt variant="small">{GONE_TEXT}</Txt> : null}
				{lived !== undefined ? <Txt variant="small">{state === "live" ? "Up" : "Ran"} {fmtDuration(lived)}</Txt> : null}
				{s?.reasons?.length ? (
					<View style={{ gap: 2 }}>
						{s.reasons.map((r, i) => (
							<Txt key={i} variant="small" color={p.warning}>
								{r.label}: {String(r.value)}
								{r.unit ? ` ${r.unit}` : ""} ({r.op} {String(r.threshold)})
							</Txt>
						))}
					</View>
				) : null}
			</Card>

			{s ? (
				<StatGrid>
					<Stat label="Players" value={`${fmtInt(s.players)}/${fmtInt(s.maxPlayers)}`} />
					<Stat label="TPS" value={s.tps !== null && s.tps !== undefined ? fmtNum(s.tps, 1) : "–"} sub={s.tpsMin !== null && s.tpsMin !== undefined ? `min ${fmtNum(s.tpsMin, 1)}` : undefined} />
					<Stat label="Memory" value={s.memMb !== null && s.memMb !== undefined ? `${fmtInt(s.memMb)} MB` : "–"} sub={s.luaMb !== null && s.luaMb !== undefined ? `Lua ${fmtInt(s.luaMb)} MB` : undefined} />
					<Stat label="Physics" value={s.physFps !== null && s.physFps !== undefined ? `${fmtNum(s.physFps, 0)} FPS` : "–"} />
				</StatGrid>
			) : null}

			<Section title={s ? "Last hours" : "Its metrics"} right={<Segmented options={METRIC_RANGES} value={hours} onChange={setHours} style={{ width: 210 }} />}>
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
							/>
						</Card>
						<Card style={{ gap: 6 }}>
							<Txt variant="label">Players</Txt>
							<LineChart series={[{ label: "Players", points: pts.map((x) => ({ t: x.t, v: x.players })) }]} timeLabel={timeLabel} height={110} />
						</Card>
					</>
				) : (
					<Txt variant="muted">{hours === 0 ? "No metrics kept for this server (kernel 0.4.2+ sends them; raw points go after a day, 5-minute rollups later)." : "No metrics in this window (kernel 0.4.2+ sends them)."}</Txt>
				)}
			</Section>

			{s ? (
				<Section title="Details">
					<Card>
						<KV label="Branch" value={s.branch ?? "–"} />
						<KV label="Channel" value={s.channel ?? "–"} />
						<KV label="Artifact" value={shortId(s.artifact, 8)} mono />
						<KV label="Applied deploy" value={s.appliedSeq !== null ? `#${s.appliedSeq}` : "–"} />
						<KV label="Kernel" value={s.kernel ?? "–"} />
						<KV label="Health" value={s.health ?? "–"} />
						<KV label="Place" value={s.placeId ? `${s.placeId}${s.placeVersion ? ` v${s.placeVersion}` : ""}` : "–"} />
						<KV label="Type" value={s.serverType ?? "–"} />
						<KV label="Started" value={s.startedAt ? `${fmtTime(s.startedAt)} (${fmtAgo(s.startedAt)})` : "–"} />
						<KV label="Last heartbeat" value={fmtAgo(s.lastSeen ?? s.lastWrite)} />
						{s.closedAt ? <KV label="Closed" value={fmtTime(s.closedAt)} /> : null}
						{s.lostAt ? <KV label="Lost" value={fmtTime(s.lostAt)} /> : null}
						{loc ? <KV label="Location" value={[loc.city, loc.region, loc.countryName ?? loc.country].filter(Boolean).join(", ") || "–"} /> : null}
						{loc?.org ? <KV label="Network" value={loc.org} /> : null}
						{admin && s.ip ? <KV label="Address" value={s.ip} mono /> : null}
						<KV label="Remote debug" value={detail.data.debug.connected ? "connected" : detail.data.debug.watched ? "watched" : "off"} />
					</Card>
				</Section>
			) : null}

			<Section title="Errors it reported (30 d)">
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
								onPress={() => router.push(`/tt/${backendId}/error/${encodeURIComponent(e.fp)}?window=${SERVER_ERRORS_WINDOW}`)}
								title={e.template}
								subtitle={`${compact(e.count)}× · ${e.realms.join(", ")} · last ${fmtAgo(e.lastAt)}`}
							/>
						))}
					</List>
				) : (
					<Txt variant="muted">No errors from this server in the last 30 days.</Txt>
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
}
