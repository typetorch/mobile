/**
 * Fleet: the live servers (the web page streams SSE; the app polls every 5 s while the screen is open), the
 * versions they run, and the recently gone ones.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import type { FleetServer } from "@/api/tt/types";
import { ShareBars } from "@/charts/LineChart";
import { Badge, Button, Card, Chips, Dot, EmptyState, ErrorState, List, Row, Section, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { healthTone, useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtInt, fmtNum, shortId } from "@/lib/format";
import { useTheme } from "@/theme";

function serverTone(s: FleetServer) {
	const h = healthTone(s.health);
	if (h === "critical") return "critical" as const;
	if ((s.reasons?.length ?? 0) > 0 || (s.health && s.health !== "ok")) return "warning" as const;
	return h === "muted" ? ("muted" as const) : ("good" as const);
}

function ServerRow({ s, backendId }: { s: FleetServer; backendId: string }) {
	const p = useTheme();
	const parts = [
		s.branch ?? "–",
		s.artifact ? shortId(s.artifact, 6) : null,
		s.tps !== null && s.tps !== undefined ? `${fmtNum(s.tps, 0)} TPS` : null,
		s.memMb !== null && s.memMb !== undefined ? `${fmtInt(s.memMb)} MB` : null,
		s.startedAt ? `up ${fmtAgo(s.startedAt).replace(" ago", "")}` : null,
	].filter(Boolean);
	return (
		<Row
			chevron
			onPress={() => router.push(`/tt/${backendId}/server/${encodeURIComponent(s.job)}`)}
			left={<Dot tone={serverTone(s)} />}
			title={
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<Txt variant="mono" numberOfLines={1} style={{ flexShrink: 1 }}>
						{shortId(s.job, 6)}
					</Txt>
					{s.serverType && s.serverType !== "public" ? <Badge label={s.serverType} /> : null}
					{s.experiment ? <Badge label="experiment" tone="brand" /> : null}
				</View>
			}
			subtitle={
				<View style={{ gap: 2 }}>
					<Txt variant="small" numberOfLines={1}>
						{parts.join(" · ")}
					</Txt>
					{s.reasons?.length ? (
						<Txt variant="small" color={p.warning} numberOfLines={1}>
							{s.reasons.map((r) => `${r.label} ${r.value}${r.unit ? ` ${r.unit}` : ""}`).join(" · ")}
						</Txt>
					) : null}
				</View>
			}
			right={
				<Txt style={{ fontWeight: "600" }}>
					{fmtInt(s.players)}
					<Txt variant="small">/{fmtInt(s.maxPlayers)}</Txt>
				</Txt>
			}
		/>
	);
}

export default function FleetScreen() {
	return <TTScreen title="Fleet">{({ backendId }) => <Fleet backendId={backendId} />}</TTScreen>;
}

function Fleet({ backendId }: { backendId: string }) {
	const [branch, setBranch] = useState<string>("");
	const [showGone, setShowGone] = useState(false);
	const servers = useTTQuery(backendId, ["fleet", "servers"], (api, s) => api.fleetServers(undefined, s), { refetchInterval: 5_000 });
	const gone = useTTQuery(backendId, ["fleet", "gone"], (api, s) => api.fleetGoneServers(undefined, s), { enabled: showGone });

	const branches = useMemo(() => Array.from(new Set((servers.data?.servers ?? []).map((s) => s.branch ?? "–"))).sort(), [servers.data]);
	const list = useMemo(
		() => (servers.data?.servers ?? []).filter((s) => !branch || (s.branch ?? "–") === branch).sort((a, b) => (b.players ?? 0) - (a.players ?? 0)),
		[servers.data, branch],
	);
	const needLook = list.filter((s) => serverTone(s) !== "good" && serverTone(s) !== "muted").length;

	if (servers.error) return <ErrorState error={servers.error} onRetry={() => servers.refetch()} />;
	if (!servers.data) return <SkeletonList rows={6} />;

	return (
		<>
			<StatGrid>
				<Stat label="Servers" value={fmtInt(list.length)} />
				<Stat label="Players" value={fmtInt(list.reduce((n, s) => n + (s.players ?? 0), 0))} />
				<Stat label="Need a look" value={fmtInt(needLook)} tone={needLook ? "warning" : undefined} />
				<Stat label="Versions" value={fmtInt(servers.data.byArtifact.length)} />
			</StatGrid>
			{branches.length > 1 ? <Chips options={[{ value: "", label: "All branches" }, ...branches.map((b) => ({ value: b, label: b }))]} value={branch} onChange={setBranch} /> : null}

			{servers.data.byArtifact.length > 1 ? (
				<Section title="Players per version">
					<Card>
						<ShareBars rows={servers.data.byArtifact.map((a) => ({ label: `${shortId(a.artifact, 6)} · ${a.servers} servers`, value: a.players }))} format={(v) => fmtInt(v)} />
					</Card>
				</Section>
			) : null}

			<Section title={`Live servers · every 5 s`}>
				{list.length ? (
					<List>
						{list.map((s) => (
							<ServerRow key={s.job} s={s} backendId={backendId} />
						))}
					</List>
				) : (
					<EmptyState icon="server-outline" title="No live servers" body="When a game server with the TypeTorch kernel starts, it shows up here within a heartbeat." />
				)}
			</Section>

			<Section title="Recently gone">
				{!showGone ? (
					<Button title="Show closed and lost servers" small icon="time-outline" onPress={() => setShowGone(true)} style={{ alignSelf: "flex-start" }} />
				) : gone.error ? (
					<ErrorState error={gone.error} />
				) : !gone.data ? (
					<SkeletonList rows={3} />
				) : gone.data.length ? (
					<List>
						{gone.data.slice(0, 50).map((s) => (
							<Row
								key={s.job}
								chevron
								onPress={() => router.push(`/tt/${backendId}/server/${encodeURIComponent(s.job)}`)}
								left={<Dot tone={s.state === "lost" ? "critical" : "muted"} />}
								title={<Txt variant="mono">{shortId(s.job, 6)}</Txt>}
								subtitle={`${s.state} ${fmtAgo(s.closedAt ?? s.lostAt)} · ${s.branch ?? "–"} · ${shortId(s.artifact, 6)}`}
							/>
						))}
					</List>
				) : (
					<Txt variant="muted">No gone servers kept.</Txt>
				)}
			</Section>
		</>
	);
}
