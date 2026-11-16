/**
 * Creator Hub's analytics tools beyond the metric charts: custom dashboards, alerts, the error report (log details and
 * grouping rules), experiments and experience configs. Checked against Roblox's OpenAPI document (2026-11):
 *
 *   Custom dashboards (BETA; 100 reads / 50 writes a minute), universe.analytics.dashboard:read / :write:
 *     GET  /analytics-custom-dashboards/v1/universes/{u}/custom-dashboards ?pageSize&pageToken -> { dashboards[], nextPageToken, capabilities }
 *     GET  .../custom-dashboards/{dashboardId} -> { dashboard: { metadata, document, version } }
 *     POST .../custom-dashboards { name, description, document?, idempotencyKey? } -> { dashboard }
 *     POST .../custom-dashboards/{id}/publish { expectedHeadEtag, document, metadataPatch? } -> { dashboard }
 *     PATCH .../custom-dashboards/{id}/metadata { expectedHeadEtag, patch: { name?, description?, isPinned? } } -> { metadata }
 *     POST .../custom-dashboards/{id}/delete { expectedHeadEtag } -> { metadata }
 *     POST .../custom-dashboard-documents/validate { document } -> { isValid, validationIssues[] }
 *   Alerts (EXPERIMENTAL; 120 reads / 30 writes a minute), universe.analytics.alert:read / :write:
 *     GET    /analytics-alert-control-plane/v1/resource/Universe/id/{u}/alerts ?ids&firingStatus&severities&metrics (repeated) -> AlertDetail[]
 *     GET    .../alerts/incidents ?startTime*&endTime*&metric&alertIds&severities -> Incident[] (window within the last 30 days)
 *     POST   .../alerts CreateAlertConfigRequest -> 201 AlertDetail
 *     PATCH  .../alerts/{alertId} UpdateAlertConfigRequest (partial) -> AlertDetail
 *     DELETE .../alerts/{alertId} -> 204
 *   Error report (EXPERIMENTAL; 60 a minute), universe.analytics:read / :write:
 *     GET /universe-performance-raqi/v1/events/logging/universe/{u}/log-details ?messageHashIds&keyword&startTime&endTime&placeId&placeVersions&firstSeenPlaceVersion -> { values[] }
 *     GET /log-attribute-http-service/v1/universe-regexes ?universeId&status -> { universeRegexes[] }
 *     POST /log-attribute-http-service/v1/universe-regexes { universeId, pattern, output, regexOperation } -> { order }
 *     PUT  .../universe-regexes/{id} { pattern, output, regexOperation } -> { order }; PUT .../{id}/ignore; PUT .../{id}/reorder { order }
 *     DELETE .../universe-regexes/{id}
 *   Experiments (EXPERIMENTAL; async operations), universe:read / universe:write:
 *     GET  /creator-configs-public-api/v1/experimentation/universes/{u}/experiments ?maxPageSize&skip&searchKey&stateFilters&sortOrder&sortKey&productTypeFilter -> { experiments[], total }
 *     GET  .../experiments/{id} -> { experiment }; GET .../experiments/{id}/stats -> { operation: { done, error?, experimentStats? } }
 *     POST .../experiments, PATCH .../experiments/{id} (full replace), POST .../{id}:start, :schedule { scheduledStartTime },
 *          :complete { variantId? }, DELETE .../{id} (discard) -> { operation } polled on GET .../operations/{operationId}
 *     POST .../experiments:calculateMde -> { operation: MdeOperation }
 *   Configs (BETA), universe:read / universe:write:
 *     GET .../configs/universes/{u}/repositories/{repo} (values), /full (with metadata), /draft (draftHash, entries)
 *     PATCH .../draft (partial: null deletes), PUT .../draft:overwrite (full final state), DELETE .../draft { draftHash } (reset)
 *     POST .../publish { draftHash, message, deploymentStrategy } -> { configVersion }
 *     GET .../revisions ?MaxPageSize&Skip&SearchKey&SortOrder&SortKey&startTime&endTime -> { revisions[] }
 *     POST .../revisions/{revisionId}/restore -> { draftHash } (stages the revert; publish afterwards)
 */
import { HttpError } from "@/api/http";
import type { OpenCloud } from "@/api/opencloud";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

type Param = string | number | boolean | undefined | null | readonly (string | number)[];

/** A query string where arrays repeat the parameter (`?ids=1&ids=2`), as these APIs expect. */
export function query(params: Record<string, Param>): string {
	const parts: string[] = [];
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === "") continue;
		const values = Array.isArray(v) ? v : [v as string | number | boolean];
		for (const one of values) if (one !== "") parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(one))}`);
	}
	return parts.length ? `?${parts.join("&")}` : "";
}

// Custom dashboards ----------------------------------------------------------------------------------------------------

export const DASHBOARD_READ = "universe.analytics.dashboard:read";
export const DASHBOARD_WRITE = "universe.analytics.dashboard:write";

export interface DashboardActor {
	userId?: string | null;
}

export interface DashboardMetadata {
	dashboardId?: string;
	universeId?: string | null;
	name?: string;
	description?: string;
	lifecycleState?: string;
	isPinned?: boolean | null;
	pinnedTime?: string | null;
	createdTime?: string | null;
	createdBy?: DashboardActor | null;
	updatedTime?: string | null;
	updatedBy?: DashboardActor | null;
	publishedTime?: string | null;
	publishedBy?: DashboardActor | null;
	headEtag?: string;
	latestPublishedDocumentId?: string;
	latestPublishedVersion?: string | null;
}

export interface DashboardLimits {
	maxDashboardsPerUniverse?: number | null;
	maxDocumentPayloadBytes?: number | null;
	maxSummaryCardsPerDashboard?: number | null;
	maxChartTilesPerDashboard?: number | null;
	maxTableMetricColumns?: number | null;
	maxDashboardNameLength?: number | null;
	maxDashboardDescriptionLength?: number | null;
	maxTileTitleLength?: number | null;
	maxPinnedDashboardsPerUniverse?: number | null;
	maxIdempotencyKeyLength?: number | null;
}

export interface DashboardCapabilities {
	universeId?: string | null;
	canCreate?: boolean | null;
	canEdit?: boolean | null;
	canPublish?: boolean | null;
	canDelete?: boolean | null;
	limits?: DashboardLimits | null;
}

export interface TileFilter {
	dimensionKey?: string;
	values?: string[] | null;
}

export interface DashboardMetricVariantSelection {
	pseudoDimensionKey?: string;
	variantKey?: string;
}

export interface DashboardComputedMetricSource {
	sourceKey?: string;
	filters?: TileFilter[] | null;
	variantSelections?: DashboardMetricVariantSelection[] | null;
	metricKey?: string;
	/** Schema-v1 only. */
	metric?: { metricKey?: string | null } | null;
}

export interface DashboardComputedMetric {
	sources?: DashboardComputedMetricSource[] | null;
	formula?: string;
	displayName?: string;
	l7Smoothing?: boolean | null;
}

export interface DashboardMetricReference {
	metricKey?: string | null;
	computedMetric?: DashboardComputedMetric | null;
	variantSelections?: DashboardMetricVariantSelection[] | null;
}

export type DashboardAggregation = string;
export type DashboardGranularity =
	| "DASHBOARD_GRANULARITY_INVALID"
	| "DASHBOARD_GRANULARITY_CUMULATIVE"
	| "DASHBOARD_GRANULARITY_MINUTE"
	| "DASHBOARD_GRANULARITY_HALF_HOUR"
	| "DASHBOARD_GRANULARITY_HOUR"
	| "DASHBOARD_GRANULARITY_DAY"
	| "DASHBOARD_GRANULARITY_WEEK"
	| "DASHBOARD_GRANULARITY_MONTH";
export type DashboardChartType =
	| "DASHBOARD_CHART_TYPE_INVALID"
	| "DASHBOARD_CHART_TYPE_SPLINE"
	| "DASHBOARD_CHART_TYPE_AREA"
	| "DASHBOARD_CHART_TYPE_BAR"
	| "DASHBOARD_CHART_TYPE_COLUMN"
	| "DASHBOARD_CHART_TYPE_PIE"
	| "DASHBOARD_CHART_TYPE_TABLE"
	| "DASHBOARD_CHART_TYPE_DURATION_SPLINE"
	| "DASHBOARD_CHART_TYPE_DURATION_AREA";

export interface ChartTileMetric {
	metric?: DashboardMetricReference | null;
	seriesKey?: string;
	aggregation?: DashboardAggregation | number | null;
	filters?: TileFilter[] | null;
}

export interface DashboardChartDataSpec {
	metrics?: ChartTileMetric[] | null;
	aggregation?: DashboardAggregation | number | null;
	breakdownDimensionKeys?: string[] | null;
	granularity?: DashboardGranularity | number | null;
	filters?: TileFilter[] | null;
}

export interface ChartTile {
	tileId?: string;
	title?: string;
	dataSpec?: DashboardChartDataSpec | null;
	chartSpec?: { chartType?: DashboardChartType | number | null; overlays?: Record<string, unknown> | null; smoothing?: string | number | null } | null;
}

export interface DashboardTable {
	componentId?: string;
	title?: string;
	dataSpec?: DashboardChartDataSpec | null;
}

export interface SummaryCardTile {
	tileId?: string;
	title?: string;
	metric?: DashboardMetricReference | null;
	aggregation?: DashboardAggregation | number | null;
	filters?: TileFilter[] | null;
	titleSource?: string | number | null;
}

export interface DashboardControlledSubcontextBody {
	chart?: ChartTile | null;
	tabbedChart?: { componentId?: string; title?: string; tabs?: { tabKey?: string; labelKey?: string; chart?: ChartTile | null }[] | null } | null;
	table?: DashboardTable | null;
	tabbedTable?: { componentId?: string; title?: string; tabs?: { tabKey?: string; labelKey?: string; table?: DashboardTable | null }[] | null } | null;
}

export interface DashboardComponent extends DashboardControlledSubcontextBody {
	summaryCard?: SummaryCardTile | null;
	controlledSubcontext?: { dimensionFilterAndBreakdown?: unknown; timeRange?: unknown; body?: DashboardControlledSubcontextBody | null } | null;
}

export interface DashboardLayoutNode {
	component?: DashboardComponent | null;
	stack?: { children?: DashboardLayoutNode[] | null } | null;
	flex?: { children?: DashboardLayoutNode[] | null } | null;
	grid?: { columnCount?: number | null; children?: DashboardLayoutNode[] | null } | null;
}

export interface DashboardSurface {
	resourceTypeKeys?: (string | number)[] | null;
	controls?: {
		timeRangeOptions?: { none?: object | null; dateRange?: { defaultSelection?: { relativeRangeKey?: string | null; customRange?: { startTime?: string; endTime?: string } | null } | null } | null } | null;
		filterDimensionKeys?: string[] | null;
		defaultFilters?: TileFilter[] | null;
		breakdownDimensionKeys?: string[] | null;
		defaultBreakdownDimensionKeys?: string[] | null;
		granularity?: { fixed?: { granularity?: DashboardGranularity | number | null } | null } | null;
		annotationOptions?: unknown;
	} | null;
	bodyNodes?: DashboardLayoutNode[] | null;
}

export interface CustomDashboardDocument {
	schemaVersion?: number | null;
	config?: {
		page?: {
			untabbed?: { metadata?: { titleKey?: string } | null; surface?: DashboardSurface | null } | null;
			fixedTab?: { tabs?: { tabKey?: string; labelKey?: string; surface?: DashboardSurface | null }[] | null; tabOrder?: string[] | null } | null;
			breakdownTab?: { tabBreakdownDimensionKey?: string; tabSurface?: DashboardSurface | null; preTabNodes?: DashboardLayoutNode[] | null } | null;
		} | null;
	} | null;
}

export interface CustomDashboard {
	metadata?: DashboardMetadata | null;
	document?: CustomDashboardDocument | null;
	version?: { publishedDocumentId?: string; publishedVersion?: string | null; contentHash?: string } | null;
}

export interface DashboardValidationIssue {
	fieldPath?: string;
	reason?: string;
	message?: string;
	rejectedValues?: string[];
}

const dashBase = (u: number) => `/analytics-custom-dashboards/v1/universes/${u}`;

export function listDashboards(cloud: OpenCloud, universeId: number, pageToken?: string) {
	return cloud.request<{ dashboards?: DashboardMetadata[]; nextPageToken?: string | null; capabilities?: DashboardCapabilities | null }>(
		"GET",
		`${dashBase(universeId)}/custom-dashboards${query({ pageSize: 50, pageToken })}`,
		undefined,
		undefined,
		DASHBOARD_READ,
	);
}

export function getDashboard(cloud: OpenCloud, universeId: number, dashboardId: string) {
	return cloud.request<{ dashboard?: CustomDashboard | null }>("GET", `${dashBase(universeId)}/custom-dashboards/${encodeURIComponent(dashboardId)}`, undefined, undefined, DASHBOARD_READ);
}

export function createDashboard(cloud: OpenCloud, universeId: number, body: { name: string; description: string; document?: CustomDashboardDocument; idempotencyKey?: string }) {
	return cloud.request<{ dashboard?: CustomDashboard | null }>("POST", `${dashBase(universeId)}/custom-dashboards`, body, undefined, DASHBOARD_WRITE);
}

export function publishDashboard(cloud: OpenCloud, universeId: number, dashboardId: string, expectedHeadEtag: string, document: CustomDashboardDocument) {
	return cloud.request<{ dashboard?: CustomDashboard | null }>(
		"POST",
		`${dashBase(universeId)}/custom-dashboards/${encodeURIComponent(dashboardId)}/publish`,
		{ expectedHeadEtag, document },
		undefined,
		DASHBOARD_WRITE,
	);
}

export function patchDashboardMetadata(cloud: OpenCloud, universeId: number, dashboardId: string, expectedHeadEtag: string, patch: { name?: string; description?: string; isPinned?: boolean }) {
	return cloud.request<{ metadata?: DashboardMetadata | null }>(
		"PATCH",
		`${dashBase(universeId)}/custom-dashboards/${encodeURIComponent(dashboardId)}/metadata`,
		{ expectedHeadEtag, patch },
		undefined,
		DASHBOARD_WRITE,
	);
}

export function deleteDashboard(cloud: OpenCloud, universeId: number, dashboardId: string, expectedHeadEtag: string) {
	return cloud.request<{ metadata?: DashboardMetadata | null }>("POST", `${dashBase(universeId)}/custom-dashboards/${encodeURIComponent(dashboardId)}/delete`, { expectedHeadEtag }, undefined, DASHBOARD_WRITE);
}

export function validateDashboardDocument(cloud: OpenCloud, universeId: number, document: CustomDashboardDocument) {
	return cloud.request<{ isValid?: boolean | null; validationIssues?: DashboardValidationIssue[] | null }>(
		"POST",
		`${dashBase(universeId)}/custom-dashboard-documents/validate`,
		{ document },
		undefined,
		DASHBOARD_WRITE,
	);
}

// Alerts ---------------------------------------------------------------------------------------------------------------

export const ALERT_READ = "universe.analytics.alert:read";
export const ALERT_WRITE = "universe.analytics.alert:write";

export type AlertSeverity = "SEV_0" | "SEV_1" | "SEV_2";
export type AlertInterval = "OneMinute" | "HalfHour" | "OneHour" | "OneDay";
export type AlertOperator = "Gt" | "Gte" | "Lt" | "Lte";
export type AlertEvaluationMode = "Absolute" | "PeriodOverPeriod";
export type AlertConfigState = "Enabled" | "Disabled" | "PausedByRoblox" | "Syncing" | "Error";
export type FiringStatus = "OK" | "Firing";

export interface AlertFilter {
	dimension: string;
	values: string[];
}

export interface AlertCondition {
	operator: AlertOperator;
	threshold: number;
	evaluationMode: AlertEvaluationMode;
	periodOffsetMultiplier?: number | null;
}

export interface AlertDetail {
	alertId: string;
	resourceType: "Universe";
	resourceId: string;
	name: string;
	metric: string;
	description?: string | null;
	severity: AlertSeverity;
	interval: AlertInterval;
	consecutiveOccurrences: number;
	filter?: AlertFilter[] | null;
	breakdown?: { dimensions: string[] }[] | null;
	condition: AlertCondition;
	configState: AlertConfigState;
	webhookReceiverConfig?: { receivers?: { webhookConfigurationId: string }[] | null } | null;
	firingStatus: FiringStatus;
	lastFiredAt?: string | null;
	createdAt: string;
	lastModifiedAt: string;
	lastModifiedBy?: string | null;
}

export interface FiringMetadata {
	filter?: AlertFilter[] | null;
	breakdown?: { dimensions: string[] }[] | null;
	condition: AlertCondition;
	firingCondition: { firingValue: number; firingDimension?: { dimension: string; value: string } | null }[];
}

export interface AlertIncident {
	id: string;
	resourceType: "Universe";
	resourceId: string;
	status: FiringStatus;
	openedAt: string;
	openedWindowStartAt: string;
	resolvedAt?: string | null;
	resolvedWindowStartAt?: string | null;
	firstFiringMetadata: FiringMetadata;
	latestFiringMetadata: FiringMetadata;
	alertConfig: {
		id: string;
		name: string;
		metric: string;
		severity: AlertSeverity;
		description?: string | null;
		interval: AlertInterval;
		filter?: AlertFilter[] | null;
		breakdown?: { dimensions: string[] }[] | null;
		condition: AlertCondition;
	};
}

/** Create body (CreateAlertConfigRequest). Name at most 128 characters; consecutiveOccurrences at least 1. */
export interface AlertInput {
	name: string;
	metric: string;
	description?: string | null;
	severity: AlertSeverity;
	interval: AlertInterval;
	consecutiveOccurrences: number;
	breakdown?: { dimensions: string[] }[];
	filter?: AlertFilter[];
	condition: { operator: AlertOperator; threshold: number; evaluationMode: AlertEvaluationMode; periodOffsetMultiplier?: number | null };
	webhookReceiverConfig?: { receivers: { webhookConfigurationId: string }[] } | null;
}

const alertBase = (u: number) => `/analytics-alert-control-plane/v1/resource/Universe/id/${u}/alerts`;

export function listAlerts(cloud: OpenCloud, universeId: number, params: { ids?: string[]; firingStatus?: FiringStatus; severities?: AlertSeverity[]; metrics?: string[] } = {}) {
	return cloud.request<AlertDetail[]>("GET", `${alertBase(universeId)}${query(params)}`, undefined, undefined, ALERT_READ);
}

export function listIncidents(cloud: OpenCloud, universeId: number, params: { startTime: string; endTime: string; metric?: string; alertIds?: string[]; severities?: AlertSeverity[] }) {
	return cloud.request<AlertIncident[]>("GET", `${alertBase(universeId)}/incidents${query(params)}`, undefined, undefined, ALERT_READ);
}

export function createAlert(cloud: OpenCloud, universeId: number, body: AlertInput) {
	return cloud.request<AlertDetail>("POST", alertBase(universeId), body, undefined, ALERT_WRITE);
}

export function updateAlert(cloud: OpenCloud, universeId: number, alertId: string, body: Partial<AlertInput> & { configState?: AlertConfigState }) {
	return cloud.request<AlertDetail>("PATCH", `${alertBase(universeId)}/${encodeURIComponent(alertId)}`, body, undefined, ALERT_WRITE);
}

export function deleteAlert(cloud: OpenCloud, universeId: number, alertId: string) {
	return cloud.request<void>("DELETE", `${alertBase(universeId)}/${encodeURIComponent(alertId)}`, undefined, undefined, ALERT_WRITE);
}

// Error report ---------------------------------------------------------------------------------------------------------

export const ERRORS_READ = "universe.analytics:read";
export const ERRORS_WRITE = "universe.analytics:write";

export interface ErrorLogDetail {
	id: string | null;
	logSeverity?: string | null;
	logSource?: string | null;
	os?: string | null;
	platform?: string | null;
	message: string | null;
	stacktrace?: string | null;
	firstSeenUtc?: string | null;
	firstSeenPlaceVersion?: number | null;
}

export interface LogDetailsQuery {
	messageHashIds?: string[];
	keyword?: string;
	startTime?: string;
	endTime?: string;
	placeId?: number;
	placeVersions?: number[];
	firstSeenPlaceVersion?: number;
}

export function logDetails(cloud: OpenCloud, universeId: number, params: LogDetailsQuery) {
	return cloud.request<{ values?: ErrorLogDetail[] | null }>(
		"GET",
		`/universe-performance-raqi/v1/events/logging/universe/${universeId}/log-details${query({ ...params })}`,
		undefined,
		undefined,
		ERRORS_READ,
	);
}

export type RegexStatus = "Invalid" | "CreatorCreated" | "AutoGenerated" | "CreatorIgnored";
export type RegexOperation = "Invalid" | "Ignore" | "Group";

export interface UniverseRegex {
	id: number;
	universeId: number;
	regexStatus: RegexStatus;
	pattern: string | null;
	output: string | null;
	order: number;
	regexOperation: RegexOperation;
	createdTime: string;
	updatedTime: string;
	matchedCount?: number | null;
	sampleMessage?: string | null;
}

const REGEXES = "/log-attribute-http-service/v1/universe-regexes";

export function listRegexes(cloud: OpenCloud, universeId: number, status?: RegexStatus) {
	return cloud.request<{ universeRegexes?: UniverseRegex[] | null }>("GET", `${REGEXES}${query({ universeId, status })}`, undefined, undefined, ERRORS_READ);
}

export function createRegex(cloud: OpenCloud, universeId: number, body: { pattern: string; output: string; regexOperation: RegexOperation }) {
	return cloud.request<{ order?: number }>("POST", REGEXES, { universeId, ...body }, undefined, ERRORS_WRITE);
}

export function updateRegex(cloud: OpenCloud, id: number, body: { pattern: string; output: string; regexOperation: RegexOperation }) {
	return cloud.request<{ order?: number }>("PUT", `${REGEXES}/${id}`, body, undefined, ERRORS_WRITE);
}

export function ignoreRegex(cloud: OpenCloud, id: number) {
	return cloud.request<unknown>("PUT", `${REGEXES}/${id}/ignore`, undefined, undefined, ERRORS_WRITE);
}

export function reorderRegex(cloud: OpenCloud, id: number, order: number) {
	return cloud.request<{ order?: number }>("PUT", `${REGEXES}/${id}/reorder`, { order }, undefined, ERRORS_WRITE);
}

export function deleteRegex(cloud: OpenCloud, id: number) {
	return cloud.request<unknown>("DELETE", `${REGEXES}/${id}`, undefined, undefined, ERRORS_WRITE);
}

// Experiments ----------------------------------------------------------------------------------------------------------

export const CONFIG_READ = "universe:read";
export const CONFIG_WRITE = "universe:write";

export type ExperimentState =
	| "EXPERIMENT_STATE_DRAFT"
	| "EXPERIMENT_STATE_SCHEDULED"
	| "EXPERIMENT_STATE_RUNNING"
	| "EXPERIMENT_STATE_COMPLETED"
	| "EXPERIMENT_STATE_CANCELLED"
	| "EXPERIMENT_STATE_DELETED";
export type ExperimentProductType = "EXPERIMENT_PRODUCT_TYPE_IN_GAME_CONFIGS" | "EXPERIMENT_PRODUCT_TYPE_MATCHMAKING";
export type UniverseExperimentMetric =
	| "UNIVERSE_EXPERIMENT_METRIC_AVERAGE_SESSION_TIME"
	| "UNIVERSE_EXPERIMENT_METRIC_PLAYTIME_PER_USER"
	| "UNIVERSE_EXPERIMENT_METRIC_DAY_1_RETENTION"
	| "UNIVERSE_EXPERIMENT_METRIC_DAY_7_RETENTION"
	| "UNIVERSE_EXPERIMENT_METRIC_PAYER_CONVERSION_RATE"
	| "UNIVERSE_EXPERIMENT_METRIC_AVERAGE_REVENUE_PER_USER"
	| "UNIVERSE_EXPERIMENT_METRIC_AVERAGE_REVENUE_PER_PAYING_USER";

export const EXPERIMENT_METRICS: { value: UniverseExperimentMetric; label: string }[] = [
	{ value: "UNIVERSE_EXPERIMENT_METRIC_AVERAGE_SESSION_TIME", label: "Avg session time" },
	{ value: "UNIVERSE_EXPERIMENT_METRIC_PLAYTIME_PER_USER", label: "Playtime / user" },
	{ value: "UNIVERSE_EXPERIMENT_METRIC_DAY_1_RETENTION", label: "D1 retention" },
	{ value: "UNIVERSE_EXPERIMENT_METRIC_DAY_7_RETENTION", label: "D7 retention" },
	{ value: "UNIVERSE_EXPERIMENT_METRIC_PAYER_CONVERSION_RATE", label: "Payer conversion" },
	{ value: "UNIVERSE_EXPERIMENT_METRIC_AVERAGE_REVENUE_PER_USER", label: "ARPU" },
	{ value: "UNIVERSE_EXPERIMENT_METRIC_AVERAGE_REVENUE_PER_PAYING_USER", label: "ARPPU" },
];

export interface RpnToken {
	operator?: string;
	operand?: { attributeReference?: string | null; literalValue?: { booleanValue?: boolean | null; integerValue?: number | null; doubleValue?: number | null; stringValue?: string | null } | null };
}
export interface ConditionalRuleDefinition {
	tokens?: RpnToken[] | null;
}

export interface VariantMeta {
	variantId?: string | null;
	label?: string | null;
	isBaseline: boolean;
	weight: number;
}

export interface ExperimentConfiguration {
	productType?: ExperimentProductType;
	inGameConfigExperimentConfiguration?: {
		variants?: { variantMeta?: VariantMeta | null; configEntry?: { key?: string | null; entryValue?: unknown; description?: string | null } | null }[] | null;
	} | null;
	matchmakingExperimentConfiguration?: {
		variants?: { variantMeta?: VariantMeta | null; placeMatchmakingConfigs?: { placeId: number; matchmakingScoringConfigId?: string | null; usePlatformDefault: boolean }[] | null }[] | null;
	} | null;
}

export interface ExperimentSummary {
	id?: string | null;
	name?: string | null;
	description?: string | null;
	createdTime?: string;
	lastUpdatedTime?: string | null;
	startedTime?: string | null;
	stoppedTime?: string | null;
	state?: ExperimentState;
	createdBy?: string | null;
	experimentConfigKey?: string | null;
	scheduledTime?: string | null;
	durationSeconds?: number;
	productType?: ExperimentProductType;
}

export interface ProductExperiment extends Omit<ExperimentSummary, "experimentConfigKey" | "productType"> {
	experimentConfiguration?: ExperimentConfiguration | null;
	exposurePercent?: number;
	targetingCriteria?: { rule?: ConditionalRuleDefinition | null } | null;
	operationalStatus?: string;
	universeMetricConfiguration?: { goalMetric?: UniverseExperimentMetric; learningMetrics?: UniverseExperimentMetric[] | null } | null;
}

export interface ExperimentApiError {
	errorType?: string;
	errorCode?: string | null;
	errorMessage?: string | null;
	errorContext?: Record<string, string | null> | null;
}

export interface ExperimentOperation {
	operationId?: string | null;
	status?: string;
	createdTime?: string;
	done?: boolean;
	error?: ExperimentApiError | null;
	experiment?: ProductExperiment | null;
}

export interface ExperimentInput {
	name: string;
	description: string;
	experimentConfiguration: ExperimentConfiguration;
	exposurePercent: number;
	targetingCriteria?: { rule?: ConditionalRuleDefinition | null } | null;
	durationSeconds: number;
	universeGoalMetric: UniverseExperimentMetric;
}

const expBase = (u: number) => `/creator-configs-public-api/v1/experimentation/universes/${u}`;

export function listExperiments(
	cloud: OpenCloud,
	universeId: number,
	params: { maxPageSize?: number; skip?: number; searchKey?: string; stateFilters?: ExperimentState[]; sortOrder?: "SORT_ORDER_ASCENDING" | "SORT_ORDER_DESCENDING"; sortKey?: string; productTypeFilter?: ExperimentProductType } = {},
) {
	return cloud.request<{ experiments?: ExperimentSummary[] | null; total?: number }>("GET", `${expBase(universeId)}/experiments${query(params)}`, undefined, undefined, CONFIG_READ);
}

export function getExperiment(cloud: OpenCloud, universeId: number, id: string) {
	return cloud.request<{ experiment?: ProductExperiment | null }>("GET", `${expBase(universeId)}/experiments/${encodeURIComponent(id)}`, undefined, undefined, CONFIG_READ);
}

/** The stats are an async fetch: the same GET is repeated (at most `maxPolls`) until `done`. */
export async function experimentStats(cloud: OpenCloud, universeId: number, id: string, maxPolls = 5) {
	for (let i = 0; ; i++) {
		const r = await cloud.request<{ operation?: { done?: boolean; error?: ExperimentApiError | null; experimentStats?: { isSrmDetected?: boolean } | null } | null }>(
			"GET",
			`${expBase(universeId)}/experiments/${encodeURIComponent(id)}/stats`,
			undefined,
			undefined,
			CONFIG_READ,
		);
		const op = r.operation;
		if (op?.done) {
			if (op.error) throw new HttpError(502, experimentErrorText(op.error), "experiment stats");
			return op.experimentStats ?? null;
		}
		if (i + 1 >= maxPolls) throw new HttpError(504, "the stats are still being computed; pull to refresh in a moment", "experiment stats");
		await sleep(2000);
	}
}

export function experimentErrorText(e: ExperimentApiError): string {
	const kind = (e.errorType ?? "").replace(/^EXPERIMENT_API_ERROR_TYPE_/, "").toLowerCase().replace(/_/g, " ");
	return e.errorMessage || kind || e.errorCode || "the operation failed";
}

/**
 * Waits for an experiment operation: polls GET .../operations/{operationId} every 2 s, at most `maxPolls` times. A
 * finished operation with an error throws it.
 */
export async function waitOperation(cloud: OpenCloud, universeId: number, op: ExperimentOperation | null | undefined, maxPolls = 15): Promise<ExperimentOperation | null> {
	let current = op ?? null;
	for (let i = 0; current && !current.done && current.operationId && i < maxPolls; i++) {
		await sleep(2000);
		const r = await cloud.request<{ operation?: ExperimentOperation | null }>("GET", `${expBase(universeId)}/operations/${encodeURIComponent(current.operationId)}`, undefined, undefined, CONFIG_READ);
		current = r.operation ?? current;
	}
	if (current?.done && current.error) throw new HttpError(502, experimentErrorText(current.error), "experiment operation");
	return current;
}

export async function createExperiment(cloud: OpenCloud, universeId: number, body: ExperimentInput) {
	const r = await cloud.request<{ operation?: ExperimentOperation | null }>("POST", `${expBase(universeId)}/experiments`, body, undefined, CONFIG_WRITE);
	return waitOperation(cloud, universeId, r.operation);
}

export async function updateExperiment(cloud: OpenCloud, universeId: number, id: string, body: ExperimentInput) {
	const r = await cloud.request<{ operation?: ExperimentOperation | null }>("PATCH", `${expBase(universeId)}/experiments/${encodeURIComponent(id)}`, body, undefined, CONFIG_WRITE);
	return waitOperation(cloud, universeId, r.operation);
}

export async function startExperiment(cloud: OpenCloud, universeId: number, id: string) {
	const r = await cloud.request<{ operation?: ExperimentOperation | null }>("POST", `${expBase(universeId)}/experiments/${encodeURIComponent(id)}:start`, {}, undefined, CONFIG_WRITE);
	return waitOperation(cloud, universeId, r.operation);
}

export async function scheduleExperiment(cloud: OpenCloud, universeId: number, id: string, scheduledStartTime: string) {
	const r = await cloud.request<{ operation?: ExperimentOperation | null }>("POST", `${expBase(universeId)}/experiments/${encodeURIComponent(id)}:schedule`, { scheduledStartTime }, undefined, CONFIG_WRITE);
	return waitOperation(cloud, universeId, r.operation);
}

/** Stops the experiment; with `variantId` that variant is rolled out as the winner. */
export async function completeExperiment(cloud: OpenCloud, universeId: number, id: string, variantId?: string) {
	const r = await cloud.request<{ operation?: ExperimentOperation | null }>(
		"POST",
		`${expBase(universeId)}/experiments/${encodeURIComponent(id)}:complete`,
		variantId ? { variantId } : {},
		undefined,
		CONFIG_WRITE,
	);
	return waitOperation(cloud, universeId, r.operation);
}

export async function discardExperiment(cloud: OpenCloud, universeId: number, id: string) {
	const r = await cloud.request<{ operation?: ExperimentOperation | null }>("DELETE", `${expBase(universeId)}/experiments/${encodeURIComponent(id)}`, undefined, undefined, CONFIG_WRITE);
	return waitOperation(cloud, universeId, r.operation);
}

export interface MdeResult {
	totalSampleSize?: number;
	mdeRelativePercentages?: number[];
	minimumSampleSizeThreshold?: number;
}

/**
 * Minimum detectable effect. The call answers an MdeOperation. The doc says to poll the same POST until the
 * operation is done (GET .../operations/{id} only returns ExperimentOperation, which has no `mde`), so the identical
 * request is re-sent at most `maxPolls` times, 2 s apart.
 */
export async function calculateMde(
	cloud: OpenCloud,
	universeId: number,
	body: { exposurePercent: number; durationSeconds: number; baselineWeight: number; variantWeights: number[]; universeGoalMetric: UniverseExperimentMetric; targetingCriteria?: { rule?: ConditionalRuleDefinition | null } | null },
	maxPolls = 10,
): Promise<MdeResult> {
	type MdeOp = { operationId?: string | null; done?: boolean; error?: ExperimentApiError | null; mde?: MdeResult | null };
	const first = await cloud.request<{ operation?: MdeOp | null }>("POST", `${expBase(universeId)}/experiments:calculateMde`, body, undefined, CONFIG_READ);
	let op = first.operation ?? null;
	for (let i = 0; op && !op.done && i < maxPolls; i++) {
		await sleep(2000);
		const r = await cloud.request<{ operation?: MdeOp | null }>("POST", `${expBase(universeId)}/experiments:calculateMde`, body, undefined, CONFIG_READ);
		op = r.operation ?? op;
	}
	if (!op?.done) throw new HttpError(504, "the calculation didn't finish in time; try again", "calculateMde");
	if (op.error) throw new HttpError(502, experimentErrorText(op.error), "calculateMde");
	if (!op.mde) throw new HttpError(502, "Roblox finished the calculation but returned no result", "calculateMde");
	return op.mde;
}

// Configs --------------------------------------------------------------------------------------------------------------

export type ConfigRepository =
	| "InExperienceConfig"
	| "RecommendationServicesConfig"
	| "DataStoresConfig"
	| "ExtendedServicesConfig"
	| "LeaderboardsConfig"
	| "ExperienceUserConfig"
	| "JourneysConfig"
	| "AntiCheatConfig"
	| "DataCaptureConfig";

export const CONFIG_REPOSITORIES: { value: ConfigRepository; label: string }[] = [
	{ value: "InExperienceConfig", label: "In-experience" },
	{ value: "ExperienceUserConfig", label: "Experience user" },
	{ value: "DataStoresConfig", label: "Data stores" },
	{ value: "LeaderboardsConfig", label: "Leaderboards" },
	{ value: "RecommendationServicesConfig", label: "Recommendations" },
	{ value: "ExtendedServicesConfig", label: "Extended services" },
	{ value: "JourneysConfig", label: "Journeys" },
	{ value: "AntiCheatConfig", label: "Anti-cheat" },
	{ value: "DataCaptureConfig", label: "Data capture" },
];

export interface ConditionalRulesPayload {
	rules?: Record<string, ConditionalRuleDefinition | null> | null;
	rulesOrder?: string[] | null;
}

export interface ConfigValueFull {
	variants?: { type?: "conditional"; variantTypeId?: string | null; value?: unknown }[] | null;
	value?: unknown;
	description?: string | null;
	lastModifiedTime?: string;
	lastAccessedTime?: string;
}

export interface ConfigRepositoryFull {
	entries?: Record<string, ConfigValueFull> | null;
	metadata?: { configVersion?: number } | null;
	conditionalRules?: ConditionalRulesPayload | null;
}

export interface ConfigRepositoryValues {
	metadata?: { configVersion?: number } | null;
	entries?: Record<string, unknown> | null;
	conditionalRules?: ConditionalRulesPayload | null;
}

export interface ConfigRepositoryDraft {
	draftHash?: string | null;
	entries?: Record<string, { value?: unknown; description?: string | null } | null> | null;
	conditionalRules?: ConditionalRulesPayload | null;
}

export interface ConfigRevision {
	revisionId?: string | null;
	version?: number;
	time?: string;
	publishedBy?: string | null;
	message?: string | null;
	deploymentResult?: string | null;
	autoRestoreToVersion?: number;
	changes?: Record<string, { before?: unknown; after?: unknown }> | null;
	conditionalRulesChanges?: unknown;
}

export type DeploymentStrategy = "GradualRollout" | "Immediate";

const repoBase = (u: number, repo: ConfigRepository) => `/creator-configs-public-api/v1/configs/universes/${u}/repositories/${repo}`;

export function getConfigValues(cloud: OpenCloud, universeId: number, repo: ConfigRepository) {
	return cloud.request<ConfigRepositoryValues>("GET", repoBase(universeId, repo), undefined, undefined, CONFIG_READ);
}

export function getConfigFull(cloud: OpenCloud, universeId: number, repo: ConfigRepository) {
	return cloud.request<ConfigRepositoryFull>("GET", `${repoBase(universeId, repo)}/full`, undefined, undefined, CONFIG_READ);
}

export function getConfigDraft(cloud: OpenCloud, universeId: number, repo: ConfigRepository) {
	return cloud.request<ConfigRepositoryDraft>("GET", `${repoBase(universeId, repo)}/draft`, undefined, undefined, CONFIG_READ);
}

/** Partial changeset: a key set to null deletes it; a key set to its published value discards the change. */
export function patchConfigDraft(cloud: OpenCloud, universeId: number, repo: ConfigRepository, body: { draftHash?: string | null; entries: Record<string, unknown>; conditionalRules?: ConditionalRulesPayload }) {
	return cloud.request<{ draftHash?: string | null }>("PATCH", `${repoBase(universeId, repo)}/draft`, body, undefined, CONFIG_WRITE);
}

/** The body is the whole intended configuration after publish: omitted keys (and rules, when conditionalRules is omitted) are removed. */
export function overwriteConfigDraft(cloud: OpenCloud, universeId: number, repo: ConfigRepository, body: { draftHash?: string | null; entries: Record<string, unknown>; conditionalRules?: ConditionalRulesPayload | null }) {
	return cloud.request<{ draftHash?: string | null }>("PUT", `${repoBase(universeId, repo)}/draft:overwrite`, body, undefined, CONFIG_WRITE);
}

export function resetConfigDraft(cloud: OpenCloud, universeId: number, repo: ConfigRepository, draftHash?: string | null) {
	return cloud.request<{ draftHash?: string | null }>("DELETE", `${repoBase(universeId, repo)}/draft`, draftHash ? { draftHash } : {}, undefined, CONFIG_WRITE);
}

export function publishConfigDraft(cloud: OpenCloud, universeId: number, repo: ConfigRepository, body: { draftHash: string; message?: string; deploymentStrategy?: DeploymentStrategy }) {
	return cloud.request<{ configVersion?: number }>("POST", `${repoBase(universeId, repo)}/publish`, body, undefined, CONFIG_WRITE);
}

export function listConfigRevisions(cloud: OpenCloud, universeId: number, repo: ConfigRepository, params: { MaxPageSize?: number; Skip?: number; SearchKey?: string; SortOrder?: string; SortKey?: string; startTime?: string; endTime?: string } = {}) {
	return cloud.request<{ revisions?: ConfigRevision[] | null }>("GET", `${repoBase(universeId, repo)}/revisions${query(params)}`, undefined, undefined, CONFIG_READ);
}

/** Stages a revert to `revisionId` (clears the draft); it takes effect only after a publish. */
export function restoreConfigRevision(cloud: OpenCloud, universeId: number, repo: ConfigRepository, revisionId: string) {
	return cloud.request<{ draftHash?: string | null }>("POST", `${repoBase(universeId, repo)}/revisions/${encodeURIComponent(revisionId)}/restore`, {}, undefined, CONFIG_WRITE);
}
