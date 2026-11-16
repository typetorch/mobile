/**
 * One game server (any age): state, versions, health, its last hour of TPS / memory / players, its errors, alerts
 * and deploy reports. Polls every 5 s while open. (Remote debug commands are web-only for now.)
 */
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { LineChart } from "@/charts/LineChart";
import { Badge, Card, Dot, ErrorState, KV, List, Row, Section, Segmented, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { healthTone, useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { compact, fmtAgo, fmtInt, fmtNum, fmtTime, shortId } from "@/lib/format";
import { useTheme } from "@/theme";

const METRIC_RANGES = [
	{ value: 1, label: "1 h" },
	{ value: 6, label: "6 h" },
	{ value: 24, label: "24 h" },
];

export default function ServerScreen() {
	const { job } = useLocalSearchParams<{ job: string }>();
	const j = decodeURIComponent(String(job ?? ""));
	return <TTScreen title={`Server ${shortId(j, 4)}`}>{({ backendId, account }) => <Server backendId={backendId} job={j} admin={account.role === "admin"} />}</TTScreen>;
}

function Server({ backendId, job, admin }: { backendId: string; job: string; admin: boolean }) {
	const p = useTheme();
	const [hours, setHours] = useState(1);
	const detail = useTTQuery(backendId, ["server", job], (api, s) => api.fleetServer(job, s), { refetchInterval: 5_000 });
	const since = Math.floor((Date.now() - hours * 3_600_000) / 60_000) * 60_000;
	const metrics = useTTQuery(backendId, ["server", job, "metrics", hours], (api, s) => api.serverMetrics(job, since, s), { refetchInterval: 15_000, retry: false });
	const errors = useTTQuery(backendId, ["server", job, "errors"], (api, s) => api.serverErrors(job, { window: "24h" }, s), { staleTime: 30_000, retry: false });

	if (detail.error) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
	if (!detail.data) return <Skeleton height={200} />;
	const s = detail.data.server;
	if (!s) return <ErrorState title="Unknown server" error={`The backend has no record of ${job}.`} />;
	const state = detail.data.state;
	const pts = metrics.data ?? [];
	const loc = s.location;

	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Dot tone={state === "live" ? healthTone(s.health) : state === "lost" ? "critical" : "muted"} />
					<Txt variant="mono" selectable style={{ flex: 1 }}>
						{job}
					</Txt>
					<Badge label={state} tone={state === "live" ? "good" : state === "lost" ? "critical" : "muted"} />
				</View>
				{s.reasons?.length ? (
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

			<StatGrid>
				<Stat label="Players" value={`${fmtInt(s.players)}/${fmtInt(s.maxPlayers)}`} />
				<Stat label="TPS" value={s.tps !== null && s.tps !== undefined ? fmtNum(s.tps, 1) : "–"} sub={s.tpsMin !== null && s.tpsMin !== undefined ? `min ${fmtNum(s.tpsMin, 1)}` : undefined} />
				<Stat label="Memory" value={s.memMb !== null && s.memMb !== undefined ? `${fmtInt(s.memMb)} MB` : "–"} sub={s.luaMb !== null && s.luaMb !== undefined ? `Lua ${fmtInt(s.luaMb)} MB` : undefined} />
				<Stat label="Physics" value={s.physFps !== null && s.physFps !== undefined ? `${fmtNum(s.physFps, 0)} FPS` : "–"} />
			</StatGrid>

			<Section title="Last hours" right={<Segmented options={METRIC_RANGES} value={hours} onChange={setHours} style={{ width: 160 }} />}>
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
								timeLabel={(t) => new Date(t).toISOString().slice(11, 16)}
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
								timeLabel={(t) => new Date(t).toISOString().slice(11, 16)}
								height={130}
							/>
						</Card>
						<Card style={{ gap: 6 }}>
							<Txt variant="label">Players</Txt>
							<LineChart series={[{ label: "Players", points: pts.map((x) => ({ t: x.t, v: x.players })) }]} timeLabel={(t) => new Date(t).toISOString().slice(11, 16)} height={110} />
						</Card>
					</>
				) : (
					<Txt variant="muted">No metrics in this window (kernel 0.4.2+ sends them).</Txt>
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

			{detail.data.history?.alerts.length ? (
				<Section title="Alerts">
					<List>
						{detail.data.history.alerts.slice(0, 20).map((a) => (
							<Row key={a.id} left={<Dot tone={a.level === "critical" ? "critical" : a.level === "warning" ? "warning" : "muted"} />} title={a.message} subtitle={`${a.code} · ${fmtAgo(a.at)}`} numberOfLines={2} />
						))}
					</List>
				</Section>
			) : null}

			{detail.data.history?.reports.length ? (
				<Section title="Deploy reports">
					<List>
						{detail.data.history.reports.slice(0, 20).map((r, i) => (
							<Row
								key={i}
								chevron
								onPress={() => router.push(`/tt/${backendId}/deploy/${r.seq}`)}
								left={<Dot tone={r.result === "ok" || r.result === "applied" ? "good" : "warning"} />}
								title={`#${r.seq} · ${r.result}`}
								subtitle={r.error ?? `${r.branch ?? "–"} · ${shortId(r.artifact, 6)}`}
							/>
						))}
					</List>
				</Section>
			) : null}
		</>
	);
}
