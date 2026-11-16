/**
 * Open Cloud calls for the Servers & moderation and Account tools: server management (running game servers, their
 * logs, client session logs, restarts with forecast / options / history), the cloud/v2 restart options, user
 * restrictions at universe or place level (get, list, ban / unban with an idempotency key, filtered logs), the Ads
 * Manager (campaigns, statuses, creatives, campaign options, create / update) and extended services (eligibility,
 * account, per-universe budget configuration, billing activity, bills).
 *
 * Checked against Roblox's OpenAPI document (2026-11): paths, query names, body shapes and x-roblox-scopes. Notes from
 * it that shape the code:
 *   - server-management query parameters are PascalCase (MaxPageSize, PageToken, OrderBy, Filter); Filter is CEL.
 *     game-servers: MaxPageSize 0-100 (default 25; 0 answers only totalCount). Logs: MaxPageSize 1-100; Filter uses
 *     `severity` (== or in), `message_timestamp` (comparisons) and `search` (== / != full-text, case-insensitive);
 *     OrderBy is `message_timestamp` or `log_severity` (+ " desc"). Log severity is an integer: Output 0, Info 1,
 *     Warning 2, Error 3. A game server's `uptime` is a .NET time span ("1.02:03:04").
 *   - The game-servers path needs a place version: game-servers:filter-options lists PlaceVersion (and EngineVersion,
 *     ServerRegion) values.
 *   - POST server-management restarts: { bleedOffDurationMinutes 1-240, places: { <placeId>: { versions[] |
 *     excludeCurrentVersion } } (omitted = every place, every version), attributes (a JSON object, <= 500 bytes) }.
 *   - POST cloud/v2 :restartServers: { placeIds[], closeAllVersions (false = only when a newer version was published),
 *     bleedOffServers, bleedOffDurationMinutes 1-60 }.
 *   - user-restrictions PATCH takes idempotencyKey.key / idempotencyKey.firstSent as query parameters; listLogs filter
 *     supports only `user` and `place` with == and &&.
 *   - ads-management: maxPageSize / pageToken (camelCase); money is micro-USD as a decimal string; POST /campaigns
 *     needs the header x-idempotency-key (a UUID), reused only to retry the same body.
 *   - service-efficiency-api is EXPERIMENTAL; money is { currencyCode, units, nanos }.
 */
import * as Crypto from "expo-crypto";

import { HttpError, qs, requestJson } from "@/api/http";
import { OPEN_CLOUD, ScopeError, type OpenCloud, type UserRestriction } from "@/api/opencloud";

export const SERVER_SCOPES = {
	read: "universe:read",
	write: "universe:write",
	banRead: "universe.user-restriction:read",
	banWrite: "universe.user-restriction:write",
	adRead: "ad.campaign:read",
	adWrite: "ad.campaign:write",
	extRead: "extended-services:read",
	extWrite: "extended-services:write",
} as const;

const sm = (universeId: number) => `/server-management/v1/universes/${universeId}`;
const enc = encodeURIComponent;

/** A CEL string literal. */
export function celString(text: string): string {
	return JSON.stringify(text);
}

// Game servers ---------------------------------------------------------------------------------------------------------

export type ServerStatus = "active" | "shut_down" | "restarted" | "roblox_restarted" | "crashed" | "out_of_memory" | "moderated" | "pending" | "developer_restarted" | "unspecified";

export interface GameServer {
	placeId: string | null;
	placeVersion: string | null;
	jobId: string | null;
	engineVersion: string | null;
	createTime: string;
	/** .NET time span, e.g. "1.02:03:04". */
	uptime: string;
	memoryUsageBytes: number;
	frameRate: number | null;
	occupancy: number;
	maxOccupancy: number;
	/** 0-5 (the document doesn't name them). */
	type: number;
	full: boolean;
	shutDown: boolean;
	status: ServerStatus;
	terminationTime: string | null;
	playerIds: number[];
	serverRegion?: string | null;
}

export interface ListGameServersResponse {
	gameServers?: GameServer[];
	nextPageToken?: string | null;
	previousPageToken?: string | null;
	totalCount?: number | null;
	shutdownServersFetchError?: boolean | null;
	activeServersFetchError?: boolean | null;
}

export function listGameServers(
	cloud: OpenCloud,
	universeId: number,
	placeId: number,
	version: string,
	params: { maxPageSize?: number; pageToken?: string; orderBy?: string; filter?: string } = {},
	signal?: AbortSignal,
) {
	return cloud.request<ListGameServersResponse>(
		"GET",
		`${sm(universeId)}/places/${placeId}/versions/${enc(version)}/game-servers${qs({ MaxPageSize: params.maxPageSize ?? 50, PageToken: params.pageToken, OrderBy: params.orderBy, Filter: params.filter })}`,
		undefined,
		signal,
		SERVER_SCOPES.read,
	);
}

export type FilterField = "EngineVersion" | "PlaceVersion" | "ALL" | "ServerRegion";

export interface FilterFieldInfo {
	field?: FilterField;
	type?: "String" | "Number";
	values?: unknown[] | null;
}

export interface FilterOptionsResponse {
	filters?: Partial<Record<FilterField, FilterFieldInfo>> | null;
}

export function gameServerFilterOptions(cloud: OpenCloud, universeId: number, placeId: number, field?: FilterField, signal?: AbortSignal) {
	return cloud.request<FilterOptionsResponse>("GET", `${sm(universeId)}/places/${placeId}/game-servers:filter-options${qs({ Filter: field })}`, undefined, signal, SERVER_SCOPES.read);
}

/** A filter field's values as strings (numbers come back as numbers for Number fields). */
export function filterValues(options: FilterOptionsResponse | undefined, field: FilterField): string[] {
	const values = options?.filters?.[field]?.values ?? [];
	return Array.from(new Set(values.filter((v) => v !== null && v !== undefined && v !== "").map((v) => String(v))));
}

/** "1.02:03:04.5" -> seconds. */
export function uptimeSeconds(span: string | null | undefined): number | null {
	const m = /^(-)?(?:(\d+)\.)?(\d+):(\d+):(\d+)(?:\.\d+)?$/.exec(span ?? "");
	if (!m) return null;
	return Number(m[2] ?? 0) * 86_400 + Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5]);
}

// Logs -----------------------------------------------------------------------------------------------------------------

export const LOG_SEVERITIES = [
	{ value: 0, label: "Output" },
	{ value: 1, label: "Info" },
	{ value: 2, label: "Warning" },
	{ value: 3, label: "Error" },
] as const;

export interface StructuredStackFrame {
	line: number;
	function?: string | null;
	scriptPath?: string | null;
	scriptUniqueId?: string | null;
	isDynamic?: boolean | null;
}

export interface LogEntry {
	messageTimestampMs: string | number;
	universeId: number;
	placeId: string | null;
	placeVersion: string | null;
	jobId?: string | null;
	sessionId?: string | null;
	/** 0 Output, 1 Info, 2 Warning, 3 Error (tolerates a name too). */
	severity: number | string;
	message: string | null;
	stackTrace: string | null;
	messageTemplate?: string | null;
	context?: string | null;
	loggerFullPath?: string | null;
	skippedCount: number;
	rateLimitedCount: number;
	structuredStackTrace?: StructuredStackFrame[] | null;
}

/** 0-3, also from a name ("Error"). */
export function severityLevel(severity: number | string | null | undefined): number {
	if (typeof severity === "number") return severity;
	const i = LOG_SEVERITIES.findIndex((s) => s.label.toLowerCase() === String(severity ?? "").toLowerCase());
	return i < 0 ? 0 : i;
}

export interface LogQuery {
	/** Severities to keep (empty = all). */
	severities: number[];
	/** Full-text search (case-insensitive). */
	search?: string;
	newestFirst: boolean;
}

export const LOG_SEARCH_MAX = 200;

/** The CEL filter for a log query (undefined = everything). */
export function logFilter(q: LogQuery): string | undefined {
	const parts: string[] = [];
	if (q.severities.length === 1) parts.push(`severity == ${q.severities[0]}`);
	else if (q.severities.length > 1) parts.push(`severity in [${q.severities.join(", ")}]`);
	const search = (q.search ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, LOG_SEARCH_MAX);
	if (search) parts.push(`search == ${celString(search)}`);
	return parts.length ? parts.join(" && ") : undefined;
}

export function gameServerLogs(cloud: OpenCloud, universeId: number, placeId: number, version: string, jobId: string, q: LogQuery, pageToken?: string, signal?: AbortSignal) {
	return cloud.request<{ gameServerLogs?: LogEntry[]; nextPageToken?: string | null }>(
		"GET",
		`${sm(universeId)}/places/${placeId}/versions/${enc(version)}/game-servers/${enc(jobId)}/logs${qs({ MaxPageSize: 100, PageToken: pageToken, OrderBy: q.newestFirst ? "message_timestamp desc" : "message_timestamp", Filter: logFilter(q) })}`,
		undefined,
		signal,
		SERVER_SCOPES.read,
	);
}

/** sessionId must be a non-zero UUID (EXPERIMENTAL endpoint). */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clientSessionLogs(cloud: OpenCloud, universeId: number, placeId: number, jobId: string, sessionId: string, q: LogQuery, pageToken?: string, signal?: AbortSignal) {
	return cloud.request<{ clientLogs?: LogEntry[]; nextPageToken?: string | null }>(
		"GET",
		`${sm(universeId)}/places/${placeId}/game-servers/${enc(jobId)}/client-sessions/${enc(sessionId)}/logs${qs({ MaxPageSize: 100, PageToken: pageToken, OrderBy: q.newestFirst ? "message_timestamp desc" : "message_timestamp", Filter: logFilter(q) })}`,
		undefined,
		signal,
		SERVER_SCOPES.read,
	);
}

// Restarts -------------------------------------------------------------------------------------------------------------

export interface PlaceForecast {
	playersImpacted: number;
	totalPlayers: number;
	instancesImpacted: number;
	totalInstances: number;
	latestPlaceVersion?: string | null;
	publishTime?: string;
	isNotInUniverse?: boolean;
	playersPerVersion?: Record<string, number> | null;
	instancesPerVersion?: Record<string, number> | null;
}

export function forecastRestart(cloud: OpenCloud, universeId: number, signal?: AbortSignal) {
	return cloud.request<{ placeForecasts?: Record<string, PlaceForecast> | null }>("GET", `${sm(universeId)}/restarts:forecast`, undefined, signal, SERVER_SCOPES.read);
}

export type RestartState = "DELAYING" | "RESTARTING" | "SUCCEEDED";

export interface PlaceFilter {
	versions?: number[] | null;
	excludeCurrentVersion?: boolean | null;
}

export interface PlaceRestartStatus {
	state: RestartState;
	startTime?: string;
	endTime?: string | null;
	totalPlayers: number;
	totalInstances: number;
	remainingPlayers: number;
	remainingInstances: number;
	filter?: PlaceFilter | null;
	latestVersion?: string | null;
}

export interface RestartStatus {
	universeId?: string | null;
	scheduledTime?: string;
	startTime?: string;
	placeRestartStatuses?: Record<string, PlaceRestartStatus> | null;
}

export function listRestarts(cloud: OpenCloud, universeId: number, signal?: AbortSignal) {
	return cloud.request<{ restartStatuses?: Record<string, RestartStatus> | null }>("GET", `${sm(universeId)}/restarts`, undefined, signal, SERVER_SCOPES.read);
}

export interface LaunchRestartRequest {
	/** 1-240; omitted = restart now. */
	bleedOffDurationMinutes?: number;
	/** Omitted = every place, every version. */
	places?: Record<string, PlaceFilter>;
	/** A JSON object <= 500 bytes, sent to the game servers. */
	attributes?: Record<string, unknown>;
}

export interface LaunchRestartResponse {
	id?: string | null;
	playersImpacted: number;
	instancesImpacted: number;
}

export function launchRestart(cloud: OpenCloud, universeId: number, body: LaunchRestartRequest) {
	return cloud.request<LaunchRestartResponse>("POST", `${sm(universeId)}/restarts`, body, undefined, SERVER_SCOPES.write);
}

export interface RestartServersOptions {
	placeIds?: number[];
	closeAllVersions?: boolean;
	bleedOffServers?: boolean;
	/** 1-60, with bleedOffServers. */
	bleedOffDurationMinutes?: number;
}

/** cloud/v2 :restartServers with its options (the plain call is OpenCloud.restartServers). */
export function restartUniverseServers(cloud: OpenCloud, universeId: number, options: RestartServersOptions) {
	const body: Record<string, unknown> = { path: `universes/${universeId}` };
	if (options.placeIds?.length) body.placeIds = options.placeIds;
	if (options.closeAllVersions !== undefined) body.closeAllVersions = options.closeAllVersions;
	if (options.bleedOffServers) {
		body.bleedOffServers = true;
		if (options.bleedOffDurationMinutes) body.bleedOffDurationMinutes = options.bleedOffDurationMinutes;
	}
	return cloud.request<Record<string, never>>("POST", `/cloud/v2/universes/${universeId}:restartServers`, body, undefined, SERVER_SCOPES.write);
}

/** UTF-8 byte length. */
export function utf8Length(text: string): number {
	let n = 0;
	for (const ch of text) {
		const c = ch.codePointAt(0) ?? 0;
		n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
	}
	return n;
}

/** Restart attributes: empty = none; otherwise a JSON object of at most 500 bytes. Throws a readable error. */
export function parseRestartAttributes(text: string): Record<string, unknown> | undefined {
	const t = text.trim();
	if (!t) return undefined;
	let v: unknown;
	try {
		v = JSON.parse(t);
	} catch (e) {
		throw new Error(`Attributes are not valid JSON: ${(e as Error).message}`);
	}
	if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error('Attributes must be a JSON object, like {"reason": "update"}.');
	const bytes = utf8Length(JSON.stringify(v));
	if (bytes > 500) throw new Error(`Attributes are ${bytes} bytes; the limit is 500.`);
	return v as Record<string, unknown>;
}

// User restrictions (bans) at universe or place level ---------------------------------------------------------------

function restrictionsPath(universeId: number, placeId?: number | null): string {
	return placeId ? `/cloud/v2/universes/${universeId}/places/${placeId}/user-restrictions` : `/cloud/v2/universes/${universeId}/user-restrictions`;
}

export function listRestrictionsAt(cloud: OpenCloud, universeId: number, placeId: number | null, pageToken?: string) {
	return cloud.request<{ userRestrictions?: UserRestriction[]; nextPageToken?: string }>(
		"GET",
		`${restrictionsPath(universeId, placeId)}${qs({ maxPageSize: 100, pageToken })}`,
		undefined,
		undefined,
		SERVER_SCOPES.banRead,
	);
}

/** One user's restriction (Roblox answers an inactive one when the user was never banned). */
export function getRestriction(cloud: OpenCloud, universeId: number, placeId: number | null, userId: number) {
	return cloud.request<UserRestriction>("GET", `${restrictionsPath(universeId, placeId)}/${userId}`, undefined, undefined, SERVER_SCOPES.banRead);
}

export interface RestrictionChange {
	active: boolean;
	/** Omitted = permanent. 1 s to 315,576,000,000 s. */
	durationSeconds?: number;
	/** Not shown to the user, 1000 characters max. */
	privateReason?: string;
	/** Shown to the user, 400 characters max. */
	displayReason?: string;
	excludeAltAccounts?: boolean;
}

/** Ban or unban at universe (placeId null) or place level; sends an idempotency key so a retry can't double-apply. */
export function setRestrictionAt(cloud: OpenCloud, universeId: number, placeId: number | null, userId: number, change: RestrictionChange) {
	const gameJoinRestriction: Record<string, unknown> = { active: change.active };
	if (change.active) {
		if (change.durationSeconds) gameJoinRestriction.duration = `${Math.round(change.durationSeconds)}s`;
		gameJoinRestriction.privateReason = change.privateReason ?? "";
		gameJoinRestriction.displayReason = change.displayReason ?? "";
		gameJoinRestriction.excludeAltAccounts = change.excludeAltAccounts ?? false;
	}
	return cloud.request<UserRestriction>(
		"PATCH",
		`${restrictionsPath(universeId, placeId)}/${userId}${qs({ updateMask: "gameJoinRestriction", "idempotencyKey.key": Crypto.randomUUID(), "idempotencyKey.firstSent": new Date().toISOString() })}`,
		{ gameJoinRestriction },
		undefined,
		SERVER_SCOPES.banWrite,
	);
}

export interface RestrictionLogEntry {
	user: string;
	place?: string;
	moderator?: { robloxUser?: string; gameServerScript?: Record<string, never> };
	createTime: string;
	active: boolean;
	startTime?: string;
	duration?: string;
	privateReason?: string;
	displayReason?: string;
	restrictionType?: { gameJoinRestriction?: Record<string, never> };
	excludeAltAccounts?: boolean;
}

/** Ban change logs, optionally for one user and / or one place. */
export function restrictionLogsFiltered(cloud: OpenCloud, universeId: number, filter: { userId?: number | null; placeId?: number | null }, pageToken?: string) {
	const parts: string[] = [];
	if (filter.userId) parts.push(`user == 'users/${filter.userId}'`);
	if (filter.placeId) parts.push(`place == 'places/${filter.placeId}'`);
	return cloud.request<{ logs?: RestrictionLogEntry[]; nextPageToken?: string }>(
		"GET",
		`/cloud/v2/universes/${universeId}/user-restrictions:listLogs${qs({ maxPageSize: 100, pageToken, filter: parts.join(" && ") || undefined })}`,
		undefined,
		undefined,
		SERVER_SCOPES.banRead,
	);
}

// Ads Manager ----------------------------------------------------------------------------------------------------------

export type CampaignStatusValue = "ACTIVE" | "PAUSED" | "CANCELLED";
export type DeliveryStatus = "SERVING" | "IN_REVIEW" | "NOT_SERVING" | "REJECTED";
export type Objective = "PLAYS" | "ENGAGEMENT" | "AWARENESS" | "REACH" | "VIDEO_VIEWS" | "ROBUX_SPEND" | "HIGH_VALUE_ACTION";
export type CreateObjective = "PLAYS" | "ENGAGEMENT" | "ROBUX_SPEND";
export type PaymentType = "CREDIT_CARD" | "ADS_CREDIT" | "INVOICE";
export type BudgetType = "DAILY" | "LIFETIME";
export type AgeGroup = "AGE_13_17" | "AGE_18_24" | "AGE_25_PLUS";
export type Device = "PHONE" | "TABLET" | "DESKTOP" | "CONSOLE";
export type AudienceType = "ALL_PLAYERS" | "NEW_USERS" | "RETENTION" | "REACTIVATION";
export type VideoSource = "IMAGE_ONLY" | "PREVIEW_VIDEO";

export interface Budget {
	amountMicros: string;
	type: BudgetType;
	scheduledAmountMicros?: string;
	scheduledEffectiveTime?: string;
}

export interface Schedule {
	durationInDays: number;
	startTime: string;
	endTime?: string;
}

export interface Targeting {
	ageGroups?: AgeGroup[];
	audienceType?: AudienceType;
	countries?: string[];
	devices?: Device[];
	regions?: string[];
}

export interface Campaign {
	id: string;
	name: string;
	status: CampaignStatusValue;
	deliveryStatus?: DeliveryStatus;
	deliveryStatusReasons?: string[];
	objective?: Objective;
	paymentType?: PaymentType;
	budget?: Budget;
	schedule?: Schedule;
	targetUniverseId?: string;
	targeting?: Targeting;
	creativeAssetIds?: string[];
	billingAccountId?: string;
	autoReloadAdCreditEnabled?: boolean;
	creator?: { groupId?: string; userId?: string };
	createTime?: string;
	updateTime?: string;
	video?: { source: VideoSource; previewVideoAssetId?: string };
}

export interface CampaignListParams {
	groupId?: number;
	targetUniverseIds?: number[];
	endedAfter?: string;
	pageToken?: string;
}

export function listCampaigns(cloud: OpenCloud, params: CampaignListParams) {
	// targetUniverseIds repeats ("targetUniverseIds=1&targetUniverseIds=2"), which qs() can't express.
	const base = qs({ groupId: params.groupId, endedAfter: params.endedAfter, maxPageSize: 50, pageToken: params.pageToken });
	const ids = (params.targetUniverseIds ?? []).slice(0, 10).map((id) => `targetUniverseIds=${enc(String(id))}`);
	const query = ids.length ? `${base ? `${base}&` : "?"}${ids.join("&")}` : base;
	return cloud.request<{ campaigns?: Campaign[]; nextPageToken?: string }>("GET", `/ads-management/v1/campaigns${query}`, undefined, undefined, SERVER_SCOPES.adRead);
}

export function getCampaign(cloud: OpenCloud, id: string) {
	return cloud.request<Campaign>("GET", `/ads-management/v1/campaigns/${enc(id)}`, undefined, undefined, SERVER_SCOPES.adRead);
}

export interface UpdateCampaignRequest {
	name?: string;
	status?: CampaignStatusValue;
	budget?: { amountMicros: string };
	schedule?: { startTime?: string; durationInDays?: number };
	creativeAssetIds?: string[];
	autoReloadAdCreditEnabled?: boolean;
	video?: { source: VideoSource };
}

export function updateCampaign(cloud: OpenCloud, id: string, body: UpdateCampaignRequest) {
	return cloud.request<Campaign>("PATCH", `/ads-management/v1/campaigns/${enc(id)}`, body, undefined, SERVER_SCOPES.adWrite);
}

export interface CampaignStatusRow {
	id: string;
	status?: CampaignStatusValue;
	deliveryStatus?: DeliveryStatus;
	deliveryStatusReasons?: string[];
}

/** Statuses for up to 100 campaigns per call (chunks larger lists). */
export async function batchCampaignStatus(cloud: OpenCloud, ids: string[]): Promise<Record<string, CampaignStatusRow>> {
	const out: Record<string, CampaignStatusRow> = {};
	for (let i = 0; i < ids.length && i < 1000; i += 100) {
		const r = await cloud.request<{ statuses?: CampaignStatusRow[]; failures?: { id: string; reason: string }[] }>(
			"POST",
			"/ads-management/v1/campaigns:batchGetStatus",
			{ campaignIds: ids.slice(i, i + 100) },
			undefined,
			SERVER_SCOPES.adRead,
		);
		for (const s of r.statuses ?? []) out[s.id] = s;
	}
	return out;
}

export interface Creative {
	id?: string;
	assetId: string;
	assetName?: string;
	assetType?: "IMAGE";
	billingAccountId?: string;
	createTime?: string;
	updateTime?: string;
	height?: number;
	width?: number;
	isArchived?: boolean;
	moderationStatus?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
	source?: "UPLOAD" | "IN_HOUSE_GEN_AI";
	universeId?: string;
}

export function listCreatives(cloud: OpenCloud, params: { groupId?: number; universeId?: number; isArchived?: boolean; pageToken?: string }) {
	return cloud.request<{ creatives?: Creative[]; nextPageToken?: string }>(
		"GET",
		`/ads-management/v1/creatives${qs({ groupId: params.groupId, universeId: params.universeId, isArchived: params.isArchived, assetType: "IMAGE", maxPageSize: 100, pageToken: params.pageToken })}`,
		undefined,
		undefined,
		SERVER_SCOPES.adRead,
	);
}

export interface AdReason {
	code: string;
	message: string;
	remediation?: string;
	resource?: string;
}

export interface BillingAccountOption {
	id: string;
	displayName: string;
	type: "SELF_SERVICE" | "MANAGED" | "INTERNAL";
	status: "ACTIVE" | "DISABLED" | "ARCHIVED";
	paymentTypes: PaymentType[];
	creator: { groupId?: string; userId?: string };
	maximumDailyBudgetMicros?: string;
}

export interface CampaignOptions {
	adFormats?: { format?: string; width?: number; height?: number }[];
	billingAccounts?: BillingAccountOption[];
	budgetConstraints?: { budgetType: BudgetType; minimumAmountMicros: string; maximumAmountMicros?: string; maximumDurationInDays?: number }[];
	creativeRequirements?: { acceptedAssetTypes?: string[]; maximumCount?: number; minimumCount?: number };
	eligibility?: { eligible?: boolean; reasons?: string[]; details?: AdReason[]; universeId?: string };
	mutableFields?: string[];
	objectiveOptions?: { objective: CreateObjective; available: boolean; supportsTargeting: boolean; audienceTypes: AudienceType[]; unavailableReasons?: AdReason[] }[];
	objectives?: CreateObjective[];
	paymentTypes?: PaymentType[];
	targetingDimensions?: { ageGroups?: AgeGroup[]; countries?: string[]; devices?: Device[]; regions?: string[] };
	video?: { sources: VideoSource[]; previewVideo?: { available: boolean; videoAssetId?: string } };
}

export function campaignOptions(cloud: OpenCloud, universeId: number) {
	return cloud.request<CampaignOptions>("GET", `/ads-management/v1/campaign-options${qs({ universeId })}`, undefined, undefined, SERVER_SCOPES.adRead);
}

export interface CreateCampaignRequest {
	name: string;
	objective: CreateObjective;
	paymentType: PaymentType;
	budget: { amountMicros: string; type: BudgetType };
	schedule: { startTime: string; durationInDays: number };
	targetUniverseId: string;
	creativeAssetIds: string[];
	billingAccountId?: string;
	autoReloadAdCreditEnabled?: boolean;
	targeting?: Targeting;
	video?: { source: VideoSource };
}

/**
 * The key from the OpenCloud client. OpenCloud.request has no way to add a header, and POST /campaigns requires
 * x-idempotency-key, so this one call goes through requestJson itself; the key still goes only to apis.roblox.com.
 */
function apiKeyOf(cloud: OpenCloud): string {
	const key = (cloud as unknown as { apiKey?: unknown }).apiKey;
	if (typeof key !== "string" || !key) throw new Error("No Open Cloud API key is set.");
	return key;
}

/** Creates a campaign (spends money once it runs). `idempotencyKey` is a UUID reused only to retry the same body. */
export async function createCampaign(cloud: OpenCloud, body: CreateCampaignRequest, idempotencyKey: string): Promise<Campaign> {
	try {
		return await requestJson<Campaign>(`${OPEN_CLOUD}/ads-management/v1/campaigns`, {
			method: "POST",
			headers: { "x-api-key": apiKeyOf(cloud), "x-idempotency-key": idempotencyKey },
			body,
		});
	} catch (error) {
		if (error instanceof HttpError && (error.status === 401 || error.status === 403)) throw new ScopeError(error, [SERVER_SCOPES.adWrite]);
		throw error;
	}
}

export function newIdempotencyKey(): string {
	return Crypto.randomUUID();
}

/** "5000000" -> 5 (USD). */
export function microsToUsd(micros: string | null | undefined): number | null {
	if (micros === null || micros === undefined || !/^-?\d+$/.test(micros)) return null;
	return Number(micros) / 1_000_000;
}

export function fmtUsd(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return "–";
	return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "12.50" -> "12500000" (micro-USD as a decimal string). Throws a readable error. */
export function usdToMicros(text: string, what = "Budget"): string {
	const t = text.trim().replace(/^\$/, "");
	const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
	if (!m) throw new Error(`${what} must be an amount in US dollars, like 25 or 12.50.`);
	const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(2, "0") || 0) * 10_000;
	if (micros <= 0) throw new Error(`${what} must be more than $0.`);
	return String(micros);
}

// Extended services (service efficiency, EXPERIMENTAL) -----------------------------------------------------------------

export interface Money {
	currencyCode?: string | null;
	units?: number;
	nanos?: number;
}

export function moneyValue(m: Money | null | undefined): number | null {
	if (!m) return null;
	return (m.units ?? 0) + (m.nanos ?? 0) / 1e9;
}

export function fmtMoney(m: Money | null | undefined): string {
	const v = moneyValue(m);
	if (v === null) return "–";
	const code = m?.currencyCode || "USD";
	return code === "USD" ? fmtUsd(v) : `${v.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${code}`;
}

/** A Money from a typed amount ("12.5"); throws a readable error. */
export function parseMoney(text: string, currencyCode: string, what = "Budget"): Money {
	const t = text.trim().replace(/^\$/, "");
	const m = /^(\d{1,12})(?:\.(\d{1,9}))?$/.exec(t);
	if (!m) throw new Error(`${what} must be an amount, like 100 or 25.50.`);
	return { currencyCode, units: Number(m[1]), nanos: Number((m[2] ?? "").padEnd(9, "0") || 0) };
}

export interface ExtendedOwner {
	kind: "users" | "groups";
	id: number;
}

export type AccountState = "Invalid" | "Normal" | "Overdue" | "Suspended";
export type AccountTaxType = "Invalid" | "Individual" | "Business";
export type TaxIdType = "Invalid" | "UnitedStatesEin" | "EuropeanVatNumber" | "UnitedKingdomVatNumber" | "CanadianBusinessNumber" | "CanadianGstHstNumber" | "MexicanRfcNumber";

export interface ExtendedAccount {
	accountTaxType: AccountTaxType;
	accountName?: string | null;
	taxId?: string | null;
	taxIdType?: TaxIdType;
}

export const ELIGIBILITY_LABELS: Record<string, string> = {
	Age: "Age",
	AccountCountry: "Account country",
	IdVerified: "ID verified",
	EmailVerified: "Email verified",
	ModerationStatus: "Moderation standing",
	Premium: "Premium",
	UserAgreement: "User agreement",
};

export function extendedAllowed(cloud: OpenCloud, universeId: number) {
	return cloud.request<boolean>("GET", `/service-efficiency-api/v1/is_allowed${qs({ universeId })}`, undefined, undefined, SERVER_SCOPES.extRead);
}

export function extendedEligibility(cloud: OpenCloud, owner: ExtendedOwner) {
	return cloud.request<{ eligibilityRequirementResults?: { eligibilityRequirement?: string; eligible?: boolean }[] }>(
		"GET",
		`/service-efficiency-api/v1/eligibility/${owner.kind}/${owner.id}`,
		undefined,
		undefined,
		SERVER_SCOPES.extRead,
	);
}

export function extendedAccount(cloud: OpenCloud, owner: ExtendedOwner) {
	return cloud.request<{ account: ExtendedAccount }>("GET", `/service-efficiency-api/v1/accounts/${owner.kind}/${owner.id}`, undefined, undefined, SERVER_SCOPES.extRead);
}

export function updateExtendedAccount(cloud: OpenCloud, owner: ExtendedOwner, account: ExtendedAccount) {
	return cloud.request<{ account: ExtendedAccount }>("PUT", `/service-efficiency-api/v1/accounts/${owner.kind}/${owner.id}`, { account }, undefined, SERVER_SCOPES.extWrite);
}

export interface BillSummary {
	timestamp: number;
	billId?: string | null;
	billStatus: "Invalid" | "Unpaid" | "Paid" | "Closed";
	totalAmount: Money;
}

export interface BillingActivities {
	accountState?: AccountState;
	billSummaries?: BillSummary[] | null;
	currentBalance: Money;
	monthToDateBalance: Money;
	chargingThreshold: Money;
}

export function billingActivities(cloud: OpenCloud, owner: ExtendedOwner, range: { startYear: number; startMonth: number; endYear: number; endMonth: number }) {
	return cloud.request<BillingActivities>("GET", `/service-efficiency-api/v1/billing_activities/${owner.kind}/${owner.id}${qs(range)}`, undefined, undefined, SERVER_SCOPES.extRead);
}

export interface Price {
	cost?: Money;
	unitAmount?: number;
}

export interface BillDetails {
	accountState?: AccountState;
	billId?: string | null;
	billStatus: BillSummary["billStatus"];
	usageAmount: Money;
	taxAmount: Money;
	totalAmount: Money;
	usages: {
		consumerId: number;
		consumerName?: string | null;
		subtotalAmount: Money;
		serviceUsages: { serviceId: string; subtotalAmount: Money; resourceUsages: { resourceId: string; freeAmount?: number; paidAmount?: number; unitCost: Money; price: Price; totalCost: Money }[] }[];
	}[];
	payments: { timestamp: number; amount: Money; status: "Invalid" | "Pending" | "Successful" | "Failed" }[];
	conversionRate?: number | null;
}

export function getBill(cloud: OpenCloud, owner: ExtendedOwner, which: { billId?: string; latest?: boolean }) {
	return cloud.request<BillDetails>(
		"GET",
		`/service-efficiency-api/v1/bills/${owner.kind}/${owner.id}${qs({ billId: which.billId, latest: which.billId ? undefined : which.latest ? true : undefined })}`,
		undefined,
		undefined,
		SERVER_SCOPES.extRead,
	);
}

export interface ResourceConfiguration {
	resourceId: string;
	unlocked: boolean;
	monthlyBudget?: Money;
	unitCost: Money;
	price: Price;
}

export interface ServiceConfiguration {
	serviceId: string;
	monthlyBudget?: Money;
	resourceConfigurations: ResourceConfiguration[];
	budgetLevel: "ResourceOnly" | "ServiceOnly";
}

export interface ConsumerConfiguration {
	accountState?: AccountState;
	accountInfoComplete?: boolean;
	serviceConfigurations: ServiceConfiguration[];
}

export function extendedConfiguration(cloud: OpenCloud, universeId: number) {
	return cloud.request<ConsumerConfiguration>("GET", `/service-efficiency-api/v1/configurations/universes/${universeId}`, undefined, undefined, SERVER_SCOPES.extRead);
}

export function updateExtendedConfiguration(cloud: OpenCloud, universeId: number, serviceConfigurations: ServiceConfiguration[]) {
	return cloud.request<ConsumerConfiguration>("PATCH", `/service-efficiency-api/v1/configurations/universes/${universeId}`, { serviceConfigurations }, undefined, SERVER_SCOPES.extWrite);
}
