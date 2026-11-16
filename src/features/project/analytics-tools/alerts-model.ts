/**
 * Alert metrics and their dimensions (create.roblox.com/docs/cloud/guides/alerts/metrics, 2026-11; values are
 * case-sensitive; "filterOnly" dimensions filter but can't break down). All alert metrics keep 28 days of data and
 * evaluate OneMinute / HalfHour / OneHour / OneDay.
 */
import { shortNumber } from "@/charts/LineChart";

import type { AlertConfigState, AlertDetail, AlertIncident, AlertInput, AlertInterval, AlertOperator, AlertSeverity } from "../api/analytics-tools";

export interface AlertMetricGroup {
	title: string;
	metrics: string[];
	dimensions: string[];
	filterOnly: string[];
}

const CLIENT = ["MemoryGroup", "OperatingSystem", "Platform"];

export const ALERT_METRIC_GROUPS: AlertMetricGroup[] = [
	{ title: "Client CPU time", metrics: ["ClientCpuTimeAvg"], dimensions: ["ClientCpuTimeCategory", "ClientCpuTimeSubCategory", ...CLIENT], filterOnly: ["Place"] },
	{ title: "Client crashes", metrics: ["ClientCrashCount", "ClientCrashRate15m"], dimensions: CLIENT, filterOnly: ["Place"] },
	{ title: "Client frame rate", metrics: ["ClientFpsAvg", "ClientFpsP10", "ClientFpsP50", "ClientFpsP90"], dimensions: CLIENT, filterOnly: ["Place"] },
	{ title: "Client memory", metrics: ["ClientMemoryUsageAvg", "ClientMemoryUsageP10", "ClientMemoryUsageP50", "ClientMemoryUsageP90"], dimensions: CLIENT, filterOnly: ["Place"] },
	{
		title: "Client memory %",
		metrics: ["ClientMemoryUsagePercentageAvg", "ClientMemoryUsagePercentageP10", "ClientMemoryUsagePercentageP50", "ClientMemoryUsagePercentageP90"],
		dimensions: CLIENT,
		filterOnly: ["Place"],
	},
	{ title: "Cross-server messaging", metrics: ["CsmFanoutRatio", "CsmGameServersConnectedCount", "CsmMessageSizeBytes", "CsmPublishedMessagesCount", "CsmReceivedMessagesCount"], dimensions: [], filterOnly: [] },
	{
		title: "Data store quota",
		metrics: ["DataStoreConsumedListRequests", "DataStoreConsumedReadRequests", "DataStoreConsumedRemoveRequests", "DataStoreConsumedWriteRequests"],
		dimensions: ["DataStoreRequestSource", "DataStoreTypeV2"],
		filterOnly: [],
	},
	{ title: "Data store requests", metrics: ["DataStoreRequests"], dimensions: ["DataStoreOperation", "DataStoreStatus", "DataStoreTypeV2"], filterOnly: [] },
	{ title: "HTTP requests", metrics: ["HttpServiceRequestsCount"], dimensions: ["HttpServiceMethod", "HttpServiceStatus"], filterOnly: ["HttpServiceDomains", "Place"] },
	{
		title: "HTTP response time",
		metrics: ["HttpServiceResponseTimeAvg", "HttpServiceResponseTimeP10", "HttpServiceResponseTimeP50", "HttpServiceResponseTimeP90"],
		dimensions: ["HttpServiceMethod"],
		filterOnly: ["HttpServiceDomains", "Place"],
	},
	{ title: "Memory store requests", metrics: ["MemoryStoreRequests"], dimensions: ["MemoryStoreOperation", "MemoryStoreStatus"], filterOnly: [] },
	{ title: "Out-of-memory exits", metrics: ["OomUnexpectedExits"], dimensions: CLIENT, filterOnly: ["Place"] },
	{ title: "Peak concurrent players", metrics: ["PeakConcurrentPlayers"], dimensions: CLIENT, filterOnly: ["Place"] },
	{ title: "Server CPU time", metrics: ["CpuTimeAvg", "CpuTimeP10", "CpuTimeP50", "CpuTimeP90"], dimensions: ["CpuTimeCategory", "CpuTimeSubCategory"], filterOnly: ["Place"] },
	{ title: "Server frame rate", metrics: ["ServerFrameRateAvg", "ServerFrameRateP10", "ServerFrameRateP50", "ServerFrameRateP90"], dimensions: [], filterOnly: ["Place"] },
	{ title: "Server memory", metrics: ["MemoryUsageAvg", "MemoryUsageP10", "MemoryUsageP50", "MemoryUsageP90"], dimensions: ["MemoryUsageCategory", "MemoryUsageSubCategory"], filterOnly: ["Place"] },
	{
		title: "Session time",
		metrics: ["SessionDurationSecondsAvg", "SessionDurationSecondsP10", "SessionDurationSecondsP50", "SessionDurationSecondsP90"],
		dimensions: CLIENT,
		filterOnly: ["Place"],
	},
];

export function alertGroupOf(metric: string): AlertMetricGroup | undefined {
	return ALERT_METRIC_GROUPS.find((g) => g.metrics.includes(metric));
}

export const SEVERITIES: { value: AlertSeverity; label: string }[] = [
	{ value: "SEV_0", label: "SEV 0 (critical)" },
	{ value: "SEV_1", label: "SEV 1" },
	{ value: "SEV_2", label: "SEV 2" },
];

export const INTERVALS: { value: AlertInterval; label: string }[] = [
	{ value: "OneMinute", label: "1 min" },
	{ value: "HalfHour", label: "30 min" },
	{ value: "OneHour", label: "1 hour" },
	{ value: "OneDay", label: "1 day" },
];

export const OPERATORS: { value: AlertOperator; label: string }[] = [
	{ value: "Gt", label: ">" },
	{ value: "Gte", label: "≥" },
	{ value: "Lt", label: "<" },
	{ value: "Lte", label: "≤" },
];

export const OPERATOR_TEXT: Record<AlertOperator, string> = { Gt: ">", Gte: "≥", Lt: "<", Lte: "≤" };

export function severityTone(s: AlertSeverity): "critical" | "serious" | "warning" {
	return s === "SEV_0" ? "critical" : s === "SEV_1" ? "serious" : "warning";
}

export function stateTone(s: AlertConfigState): "good" | "muted" | "warning" | "critical" {
	return s === "Enabled" ? "good" : s === "Disabled" ? "muted" : s === "Error" ? "critical" : "warning";
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "123 > 100" for the latest firing of an incident (up to three firing slices). */
export function incidentSummary(i: AlertIncident): string {
	const fc = i.latestFiringMetadata?.firingCondition ?? [];
	const c = i.latestFiringMetadata?.condition ?? i.alertConfig.condition;
	const values = fc
		.slice(0, 3)
		.map((f) => `${shortNumber(f.firingValue)}${f.firingDimension ? ` (${f.firingDimension.dimension}=${f.firingDimension.value})` : ""}`)
		.join(", ");
	return `${values || "?"} ${c ? `${OPERATOR_TEXT[c.operator]} ${shortNumber(c.threshold)}${c.evaluationMode === "PeriodOverPeriod" ? " change" : ""}` : ""}`;
}

/**
 * Incidents can be asked for at most 30 days back (GetAlertIncidentsOperation.MaxQueryDays), checked on Roblox's clock
 * after the request arrives, so the start keeps a 10 minute margin; the screens still call it "30 days".
 */
export const INCIDENT_MAX_MS = 30 * 86_400_000 - 10 * 60_000;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The PATCH body for an edit: only the fields that differ from the alert. The API replaces filter and breakdown
 * entirely when they are sent, so they are left out unless they changed.
 */
export function alertPatch(before: AlertDetail, after: AlertInput): Partial<AlertInput> {
	const out: Partial<AlertInput> = {};
	if (after.name !== before.name) out.name = after.name;
	if (after.metric !== before.metric) out.metric = after.metric;
	if ((after.description ?? "") !== (before.description ?? "")) out.description = after.description ?? "";
	if (after.severity !== before.severity) out.severity = after.severity;
	if (after.interval !== before.interval) out.interval = after.interval;
	if (after.consecutiveOccurrences !== before.consecutiveOccurrences) out.consecutiveOccurrences = after.consecutiveOccurrences;
	if (!same(after.filter ?? [], before.filter ?? [])) out.filter = after.filter ?? [];
	if (!same(after.breakdown ?? [], before.breakdown ?? [])) out.breakdown = after.breakdown ?? [];
	const c = before.condition;
	const ac = after.condition;
	if (
		ac.operator !== c.operator ||
		ac.threshold !== c.threshold ||
		ac.evaluationMode !== c.evaluationMode ||
		(ac.evaluationMode === "PeriodOverPeriod" && (ac.periodOffsetMultiplier ?? null) !== (c.periodOffsetMultiplier ?? null))
	)
		out.condition = ac;
	const ids = (x: AlertInput["webhookReceiverConfig"] | AlertDetail["webhookReceiverConfig"]) => (x?.receivers ?? []).map((r) => r.webhookConfigurationId.toLowerCase()).sort();
	if (!same(ids(after.webhookReceiverConfig), ids(before.webhookReceiverConfig))) out.webhookReceiverConfig = after.webhookReceiverConfig ?? { receivers: [] };
	return out;
}
