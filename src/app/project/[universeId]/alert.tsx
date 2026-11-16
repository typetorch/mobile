/**
 * One analytics alert (?id=) or a new one (no id): its condition, state and recent incidents; enable / disable,
 * edit and delete (delete confirms first). Roblox has no single-alert GET, so the list is asked for this one id.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { shortNumber } from "@/charts/LineChart";
import { Badge, Button, Card, confirm, EmptyState, KV, List, notify, Row, Section, Skeleton, Txt } from "@/components/ui";
import { ALERT_READ, ALERT_WRITE, createAlert, deleteAlert, listAlerts, listIncidents, updateAlert, type AlertDetail, type AlertInput } from "@/features/project/api/analytics-tools";
import { AlertForm } from "@/features/project/analytics-tools/AlertForm";
import { alertPatch, INCIDENT_MAX_MS, incidentSummary, OPERATOR_TEXT, severityTone, stateTone } from "@/features/project/analytics-tools/alerts-model";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtTime } from "@/lib/format";

export default function AlertScreen() {
	const { id } = useLocalSearchParams<{ id?: string }>();
	const queryClient = useQueryClient();
	const alertId = id ? String(id) : "";
	return (
		<ToolScreen title={alertId ? "Alert" : "New alert"} scopes={alertId ? [ALERT_READ] : [ALERT_WRITE]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "alerts"], type: "active" })}>
			{({ universeId, cloud, can }) => (alertId ? <AlertView universeId={universeId} cloud={cloud} alertId={alertId} canWrite={can(ALERT_WRITE)} /> : <NewAlert universeId={universeId} cloud={cloud} />)}
		</ToolScreen>
	);
}

function NewAlert({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const queryClient = useQueryClient();
	const create = useMutation({
		mutationFn: (input: AlertInput) => createAlert(cloud, universeId, input),
		onSuccess: (a) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "alerts", universeId] });
			if (a?.alertId) router.replace(`/project/${universeId}/alert?id=${encodeURIComponent(a.alertId)}`);
			else router.back();
		},
		onError: (e) => notify("Couldn't create the alert", cloudErrorText(e)),
	});
	return (
		<>
			<Txt variant="small">Alerts check a performance metric on an interval and open an incident when the condition holds for the given number of periods in a row.</Txt>
			<AlertForm busy={create.isPending} submitTitle="Create alert" onSubmit={(input) => create.mutate(input)} />
		</>
	);
}

function AlertView({ universeId, cloud, alertId, canWrite }: { universeId: number; cloud: OpenCloud; alertId: string; canWrite: boolean }) {
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const q = useQuery({ queryKey: ["oc", "alerts", universeId, "one", alertId], queryFn: () => listAlerts(cloud, universeId, { ids: [alertId] }) });
	const incidents = useQuery({
		queryKey: ["oc", "alerts", universeId, "incidents-of", alertId],
		queryFn: () => {
			const end = Date.now();
			return listIncidents(cloud, universeId, { startTime: new Date(end - INCIDENT_MAX_MS).toISOString(), endTime: new Date(end).toISOString(), alertIds: [alertId] });
		},
	});
	const alert: AlertDetail | undefined = q.data?.find((a) => a.alertId === alertId);
	const refresh = () => queryClient.invalidateQueries({ queryKey: ["oc", "alerts", universeId] });

	const update = useMutation({
		mutationFn: (body: Parameters<typeof updateAlert>[3]) => updateAlert(cloud, universeId, alertId, body),
		onSuccess: () => {
			setEditing(false);
			refresh();
		},
		onError: (e) => notify("Couldn't save the alert", cloudErrorText(e)),
	});
	const del = useMutation({
		mutationFn: () => deleteAlert(cloud, universeId, alertId),
		onSuccess: () => {
			refresh();
			router.back();
		},
		onError: (e) => notify("Couldn't delete the alert", cloudErrorText(e)),
	});

	if (q.error) return <CloudError error={q.error} what="This alert" onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton height={180} />;
	if (!alert) return <EmptyState icon="alarm-outline" title="Alert not found" body="It may have been deleted." />;

	const c = alert.condition;
	const enabled = alert.configState === "Enabled";
	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
					<Txt variant="h2" style={{ flexShrink: 1 }}>
						{alert.name}
					</Txt>
					<Badge label={alert.firingStatus === "Firing" ? "FIRING" : "OK"} tone={alert.firingStatus === "Firing" ? "critical" : "good"} />
					<Badge label={alert.severity.replace("_", " ")} tone={severityTone(alert.severity)} />
					<Badge label={alert.configState} tone={stateTone(alert.configState)} />
				</View>
				{alert.description ? <Txt variant="muted">{alert.description}</Txt> : null}
				<Txt variant="mono">
					{alert.metric} {OPERATOR_TEXT[c.operator]} {c.threshold}
					{c.evaluationMode === "PeriodOverPeriod" ? ` change vs ${c.periodOffsetMultiplier ?? 1} interval(s) back` : ""}
				</Txt>
				<Txt variant="small">
					Checked every {alert.interval}, fires after {alert.consecutiveOccurrences} period{alert.consecutiveOccurrences > 1 ? "s" : ""} in a row
					{alert.lastFiredAt ? ` · last fired ${fmtAgo(alert.lastFiredAt)}` : " · never fired"}
				</Txt>
			</Card>

			{canWrite ? (
				<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
					{alert.configState === "Enabled" || alert.configState === "Disabled" ? (
						<Button
							title={enabled ? "Disable" : "Enable"}
							icon={enabled ? "notifications-off-outline" : "notifications-outline"}
							small
							loading={update.isPending && !editing}
							onPress={async () => {
								if (enabled && !(await confirm("Disable this alert?", "It stops checking and won't fire until you enable it again.", "Disable"))) return;
								update.mutate({ configState: enabled ? "Disabled" : "Enabled" });
							}}
						/>
					) : null}
					<Button title={editing ? "Cancel edit" : "Edit"} icon="create-outline" small onPress={() => setEditing(!editing)} />
					<Button
						title="Delete"
						icon="trash-outline"
						variant="destructive"
						small
						loading={del.isPending}
						onPress={async () => {
							if (await confirm(`Delete “${alert.name}”?`, "The alert and its configuration are removed for good.", "Delete")) del.mutate();
						}}
					/>
				</View>
			) : (
				<Txt variant="small">Read only: add {ALERT_WRITE} to edit, mute or delete.</Txt>
			)}
			{alert.configState === "PausedByRoblox" ? <Txt variant="small">Roblox paused this alert; edit or re-enable it on Creator Hub if it stays paused.</Txt> : null}

			{editing ? <AlertForm
					initial={alert}
					busy={update.isPending}
					submitTitle="Save changes"
					onSubmit={(input) => {
						const patch = alertPatch(alert, input);
						if (!Object.keys(patch).length) {
							setEditing(false);
							notify("Nothing changed", "The alert already has these settings.");
						} else update.mutate(patch);
					}}
				/> : null}

			<Section title="Incidents (30 days)">
				{incidents.error ? (
					<CloudError error={incidents.error} what="Incidents" onRetry={() => incidents.refetch()} />
				) : !incidents.data ? (
					<Skeleton height={60} />
				) : incidents.data.length ? (
					<List>
						{incidents.data
							.slice()
							.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
							.map((i) => (
								<Row
									key={i.id}
									left={<Badge label={i.status === "Firing" ? "firing" : "resolved"} tone={i.status === "Firing" ? "critical" : "muted"} />}
									title={fmtTime(i.openedAt)}
									subtitle={`${i.resolvedAt ? `resolved ${fmtTime(i.resolvedAt)}` : "still open"} · ${incidentSummary(i)}${
										i.firstFiringMetadata?.firingCondition?.[0] ? ` · first ${shortNumber(i.firstFiringMetadata.firingCondition[0].firingValue)}` : ""
									}`}
									numberOfLines={3}
								/>
							))}
					</List>
				) : (
					<Txt variant="muted">It hasn't fired in the last 30 days.</Txt>
				)}
			</Section>

			<Section title="Details">
				<Card>
					<KV label="Alert ID" value={alert.alertId} mono />
					<KV label="Filter" value={alert.filter?.length ? alert.filter.map((f) => `${f.dimension} in ${f.values.join(", ")}`).join("; ") : "none"} />
					<KV label="Breakdown" value={alert.breakdown?.length ? alert.breakdown.map((b) => b.dimensions.join(" × ")).join("; ") : "none"} />
					<KV label="Webhooks" value={String(alert.webhookReceiverConfig?.receivers?.length ?? 0)} />
					<KV label="Created" value={fmtTime(alert.createdAt)} />
					<KV label="Modified" value={`${fmtTime(alert.lastModifiedAt)}${alert.lastModifiedBy ? ` by ${alert.lastModifiedBy}` : ""}`} />
				</Card>
			</Section>
		</>
	);
}
