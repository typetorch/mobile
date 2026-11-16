/**
 * One release: its outcome, the servers' reports by result, errors, the servers behind, its alerts (ack for admins),
 * and the releases before and after. Promote / rollback are CLI operations: the backend API has no endpoint for them.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { OUTCOME_STYLE, startedByText } from "@/api/tt/deploys";
import { Badge, Button, Card, Dot, ErrorState, KV, List, Row, Section, Skeleton, Stat, StatGrid, Txt, confirm } from "@/components/ui";
import { outcomeTone, useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtInt, fmtTime, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { useTheme } from "@/theme";

export default function DeployScreen() {
	const { seq } = useLocalSearchParams<{ seq: string }>();
	const n = Number(seq);
	return <TTScreen title={`Deploy #${n}`}>{({ backendId, account }) => <Deploy backendId={backendId} seq={n} admin={account.role === "admin"} />}</TTScreen>;
}

function Deploy({ backendId, seq, admin }: { backendId: string; seq: number; admin: boolean }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const queryClient = useQueryClient();
	const q = useTTQuery(backendId, ["deploy", seq], (a, s) => a.fleetDeploy(seq, s), { refetchInterval: (query) => (query.state.data?.deploy.outcome === "pending" ? 5_000 : false) });
	const ack = useMutation({
		mutationFn: (id: number) => api!.ackAlert(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tt", backendId] }),
	});
	if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton height={220} />;
	const { deploy: d, report, alerts, previous, next } = q.data;
	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Txt variant="h3" style={{ flex: 1 }}>
						#{d.seq} {d.kind}
					</Txt>
					<Badge label={OUTCOME_STYLE[d.outcome]?.label ?? d.outcome} tone={outcomeTone(d.outcome)} />
				</View>
				<Txt variant="muted">{OUTCOME_STYLE[d.outcome]?.help}</Txt>
				{d.message ? <Txt>{d.message}</Txt> : null}
			</Card>
			<StatGrid>
				<Stat label="Reported" value={fmtInt(d.reported)} />
				<Stat label="OK" value={fmtInt(d.ok)} tone={d.ok ? "good" : undefined} />
				<Stat label="Failed" value={fmtInt(d.failed)} tone={d.failed ? "critical" : undefined} />
				<Stat label="Stuck" value={fmtInt(d.stuck)} tone={d.stuck ? "warning" : undefined} />
			</StatGrid>
			<Card>
				<KV label="Branch" value={d.branch ?? "–"} />
				<KV label="Channel" value={d.channel ?? "–"} />
				<KV label="Artifact" value={shortId(d.artifact, 8)} mono />
				<KV label="From" value={shortId(d.from, 8)} mono />
				<KV label="Started by" value={startedByText(d)} />
				<KV label="Started" value={`${fmtTime(d.startedAt)} (${fmtAgo(d.at)})`} />
				<KV label="First report" value={fmtTime(d.firstReport)} />
				<KV label="Last report" value={fmtTime(d.lastReport)} />
				<KV label="New error kinds" value={fmtInt(d.errorKinds)} />
			</Card>

			{report?.results.length ? (
				<Section title="Results">
					<List>
						{report.results.map((r) => (
							<Row
								key={r.result}
								left={<Dot tone={r.result === "ok" || r.result === "applied" ? "good" : "warning"} />}
								title={r.result}
								subtitle={`${fmtInt(r.servers)} servers · ${fmtInt(r.players)} players${r.medianSeconds !== null ? ` · median ${r.medianSeconds.toFixed(1)} s` : ""}`}
							/>
						))}
					</List>
				</Section>
			) : null}

			{d.errors.length ? (
				<Section title="Errors">
					<List>
						{d.errors.map((e, i) => (
							<Row key={i} title={e.error} subtitle={`${e.servers} servers`} numberOfLines={3} />
						))}
					</List>
				</Section>
			) : null}

			{report?.behind.length ? (
				<Section title={`Servers behind (${report.behind.length})`}>
					<List>
						{report.behind.slice(0, 30).map((s) => (
							<Row key={s.job} chevron onPress={() => router.push(`/tt/${backendId}/server/${encodeURIComponent(s.job)}`)} title={<Txt variant="mono">{shortId(s.job, 6)}</Txt>} subtitle={`${shortId(s.artifact, 6)} · ${s.players ?? 0} players`} />
						))}
					</List>
				</Section>
			) : null}

			{alerts.length ? (
				<Section title="Alerts">
					<List>
						{alerts.map((a) => (
							<Row
								key={a.id}
								left={<Dot tone={a.level === "critical" ? "critical" : a.level === "warning" ? "warning" : "muted"} />}
								title={a.message}
								subtitle={`${a.code} · ${fmtAgo(a.at)}${a.acked ? " · acknowledged" : ""}`}
								numberOfLines={3}
								right={
									admin && !a.acked ? (
										<Button
											title="Ack"
											small
											loading={ack.isPending && ack.variables === a.id}
											onPress={async () => {
												if (await confirm("Acknowledge this alert?", a.message, "Acknowledge", false)) ack.mutate(a.id);
											}}
										/>
									) : undefined
								}
							/>
						))}
					</List>
					{ack.error ? <Txt variant="small" color={p.destructive}>{(ack.error as Error).message}</Txt> : null}
				</Section>
			) : null}

			<View style={{ flexDirection: "row", gap: 8 }}>
				{previous ? <Button title={`← #${previous.seq}`} small onPress={() => router.replace(`/tt/${backendId}/deploy/${previous.seq}`)} /> : null}
				<View style={{ flex: 1 }} />
				{next ? <Button title={`#${next.seq} →`} small onPress={() => router.replace(`/tt/${backendId}/deploy/${next.seq}`)} /> : null}
			</View>
			<Txt variant="small" style={{ textAlign: "center" }}>
				Promote and roll back with the TypeTorch CLI (they are signed releases); the backend API has no endpoint for them.
			</Txt>
		</>
	);
}
