/**
 * Analytics alerts (EXPERIMENTAL): every alert with its firing status (filter by firing / OK and severity), the
 * incidents of the last 1-30 days (what fired, when, the value, resolved or not), and a way to create one. Tapping an
 * alert opens it (edit, mute, delete).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Chips, Dot, EmptyState, List, Row, Section, Segmented, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { ALERT_READ, ALERT_WRITE, listAlerts, listIncidents, type AlertSeverity, type FiringStatus } from "@/features/project/api/analytics-tools";
import { INCIDENT_MAX_MS, incidentSummary, OPERATOR_TEXT, severityTone, stateTone } from "@/features/project/analytics-tools/alerts-model";
import { CloudError } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtTime } from "@/lib/format";
import { shortNumber } from "@/charts/LineChart";

export default function AlertsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Alerts" scopes={[ALERT_READ]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "alerts"], type: "active" })}>
			{({ universeId, cloud, can }) => <Alerts universeId={universeId} cloud={cloud} canWrite={can(ALERT_WRITE)} />}
		</ToolScreen>
	);
}

const DAY = 86_400_000;

function Alerts({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const [view, setView] = useState<"alerts" | "incidents">("alerts");
	const [status, setStatus] = useState<"all" | FiringStatus>("all");
	const [severity, setSeverity] = useState<"all" | AlertSeverity>("all");
	const [days, setDays] = useState(7);

	const alerts = useQuery({
		queryKey: ["oc", "alerts", universeId, "list", status, severity],
		queryFn: () => listAlerts(cloud, universeId, { firingStatus: status === "all" ? undefined : status, severities: severity === "all" ? undefined : [severity] }),
	});
	const incidents = useQuery({
		queryKey: ["oc", "alerts", universeId, "incidents", days, severity],
		enabled: view === "incidents",
		queryFn: () => {
			const end = Date.now();
			return listIncidents(cloud, universeId, { startTime: new Date(end - Math.min(days * DAY, INCIDENT_MAX_MS)).toISOString(), endTime: new Date(end).toISOString(), severities: severity === "all" ? undefined : [severity] });
		},
	});
	const list = alerts.data ?? [];
	const firing = list.filter((a) => a.firingStatus === "Firing").length;
	const open = (alertId: string) => router.push(`/project/${universeId}/alert?id=${encodeURIComponent(alertId)}`);

	return (
		<>
			{alerts.data && status === "all" ? (
				<StatGrid>
					<Stat label="Firing now" value={String(firing)} tone={firing ? "critical" : "good"} />
					<Stat label="Alerts" value={String(list.length)} sub={`${list.filter((a) => a.configState !== "Enabled").length} not enabled`} />
				</StatGrid>
			) : null}
			{canWrite ? (
				<Button title="New alert" icon="add" small onPress={() => router.push(`/project/${universeId}/alert`)} style={{ alignSelf: "flex-start" }} />
			) : (
				<Txt variant="small">Read only: add {ALERT_WRITE} to create, mute and delete alerts.</Txt>
			)}
			<Segmented options={[{ value: "alerts", label: "Alerts" }, { value: "incidents", label: "Incidents" }]} value={view} onChange={setView} />
			<Chips
				options={[{ value: "all", label: "Any severity" }, { value: "SEV_0", label: "SEV 0" }, { value: "SEV_1", label: "SEV 1" }, { value: "SEV_2", label: "SEV 2" }]}
				value={severity}
				onChange={(v) => setSeverity(v as typeof severity)}
			/>

			{view === "alerts" ? (
				<>
					<Segmented options={[{ value: "all", label: "All" }, { value: "Firing", label: "Firing" }, { value: "OK", label: "OK" }]} value={status} onChange={setStatus} />
					{alerts.error ? (
						<CloudError error={alerts.error} what="Alerts" onRetry={() => alerts.refetch()} />
					) : !alerts.data ? (
						<SkeletonList rows={4} />
					) : list.length ? (
						<Section>
							<List>
								{list
									.slice()
									.sort((a, b) => Number(b.firingStatus === "Firing") - Number(a.firingStatus === "Firing") || a.name.localeCompare(b.name))
									.map((a) => (
										<Row
											key={a.alertId}
											left={<Dot tone={a.firingStatus === "Firing" ? "critical" : "good"} size={10} />}
											title={a.name}
											subtitle={`${a.metric} ${OPERATOR_TEXT[a.condition.operator]} ${shortNumber(a.condition.threshold)}${a.condition.evaluationMode === "PeriodOverPeriod" ? " change" : ""} · ${a.interval} ×${a.consecutiveOccurrences}${a.lastFiredAt ? ` · fired ${fmtAgo(a.lastFiredAt)}` : ""}`}
											numberOfLines={2}
											right={
												<>
													<Badge label={a.severity.replace("_", " ")} tone={severityTone(a.severity)} />
													{a.configState !== "Enabled" ? <Badge label={a.configState} tone={stateTone(a.configState)} /> : null}
												</>
											}
											onPress={() => open(a.alertId)}
											chevron
										/>
									))}
							</List>
						</Section>
					) : (
						<EmptyState icon="alarm-outline" title={status === "all" ? "No alerts" : `No ${status === "Firing" ? "firing" : "OK"} alerts`} body="Alerts watch performance metrics (FPS, crashes, memory, data store errors…) and fire on a threshold." />
					)}
				</>
			) : (
				<>
					<Segmented options={[{ value: 1, label: "24 h" }, { value: 7, label: "7 days" }, { value: 30, label: "30 days" }]} value={days} onChange={setDays} />
					{incidents.error ? (
						<CloudError error={incidents.error} what="Alert incidents" onRetry={() => incidents.refetch()} />
					) : !incidents.data ? (
						<SkeletonList rows={4} />
					) : incidents.data.length ? (
						<Section>
							<List>
								{incidents.data
									.slice()
									.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
									.map((i) => (
										<Row
											key={i.id}
											left={<Dot tone={i.status === "Firing" ? "critical" : "muted"} size={10} />}
											title={i.alertConfig.name}
											subtitle={`${fmtTime(i.openedAt)}${i.resolvedAt ? ` → resolved ${fmtAgo(i.resolvedAt)}` : " · still firing"} · ${incidentSummary(i)}`}
											numberOfLines={3}
											right={<Badge label={i.alertConfig.severity.replace("_", " ")} tone={severityTone(i.alertConfig.severity)} />}
											onPress={() => open(i.alertConfig.id)}
											chevron
										/>
									))}
							</List>
						</Section>
					) : (
						<EmptyState icon="checkmark-circle-outline" title="Nothing fired" body={`No alert fired in the last ${days === 1 ? "24 hours" : `${days} days`}.`} />
					)}
				</>
			)}
		</>
	);
}
