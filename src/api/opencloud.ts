/**
 * Roblox Open Cloud with the person's own API key. The key lives in expo-secure-store and goes only into the
 * `x-api-key` header of requests to https://apis.roblox.com (never into a log line, an error message or anywhere else).
 *
 * Checked against Roblox's docs / OpenAPI document (2026-11):
 *   - POST /api-keys/v1/introspect { apiKey } -> { name, authorizedUserId, scopes[{ name, operations, universeIds?,
 *     groupIds?, userIds?, universeDatastores? }], enabled, expired, expirationTimeUtc }  (create.roblox.com/docs/cloud/auth/api-keys)
 *   - cloud/v2 universes, places, data stores, ordered data stores, memory store, messaging, user restrictions
 *   - developer-products/v2 and game-passes/v1 `creator` lists
 *   - Analytics Query API v1 (port of backend/src/opencloud.ts queryAnalyticsMetric)
 */
import { HttpError, qs, requestJson } from "./http";

export const OPEN_CLOUD = "https://apis.roblox.com";

// Introspection and scopes ---------------------------------------------------------------------------------------------

export interface KeyScope {
	name: string;
	operations: string[];
	universeIds?: string[];
	groupIds?: string[];
	userIds?: string[];
	universeDatastores?: { universeId: string; datastoreName: string }[];
}

export interface KeyInfo {
	name: string;
	authorizedUserId: number | null;
	scopes: KeyScope[];
	enabled: boolean;
	expired: boolean;
	expirationTimeUtc: string | null;
}

function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.map((v) => String(v)) : undefined;
}

/** What the key is: its owner, scopes and the universes they reach. The key goes in the body (that is the API). */
export async function introspectKey(apiKey: string): Promise<KeyInfo> {
	const raw = await requestJson<Record<string, unknown>>(`${OPEN_CLOUD}/api-keys/v1/introspect`, { body: { apiKey } });
	const scopes = (Array.isArray(raw.scopes) ? raw.scopes : []).map((s): KeyScope => {
		const r = (s ?? {}) as Record<string, unknown>;
		const ds = Array.isArray(r.universeDatastores)
			? (r.universeDatastores as Record<string, unknown>[]).map((d) => ({ universeId: String(d.universeId ?? ""), datastoreName: String(d.datastoreName ?? "") }))
			: undefined;
		return {
			name: String(r.name ?? ""),
			operations: strings(r.operations) ?? [],
			universeIds: strings(r.universeIds) ?? strings(r.universes),
			groupIds: strings(r.groupIds),
			userIds: strings(r.userIds),
			universeDatastores: ds,
		};
	});
	const uid = Number(raw.authorizedUserId);
	return {
		name: String(raw.name ?? "API key"),
		authorizedUserId: Number.isFinite(uid) && uid > 0 ? uid : null,
		scopes,
		enabled: raw.enabled !== false,
		expired: raw.expired === true,
		expirationTimeUtc: typeof raw.expirationTimeUtc === "string" ? raw.expirationTimeUtc : null,
	};
}

/** "universe-datastores.objects" and "universe.analytics" compare loosely (Roblox mixes "." and "-" between systems). */
function norm(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The key's scopes as "name:operation" strings. */
export function scopeList(info: KeyInfo): string[] {
	return info.scopes.flatMap((s) => (s.operations.length ? s.operations.map((op) => `${s.name}:${op}`) : [s.name]));
}

/**
 * Whether the key has `scope` ("name:operation") for `universeId` (any universe when omitted). A scope without a
 * resource list, or with "*", covers every universe.
 */
export function hasScope(info: KeyInfo | null | undefined, scope: string, universeId?: number): boolean {
	if (!info) return false;
	const [name = "", op = ""] = scope.split(":");
	return info.scopes.some((s) => {
		if (norm(s.name) !== norm(name)) return false;
		if (op && !s.operations.some((o) => norm(o) === norm(op))) return false;
		if (universeId === undefined) return true;
		const lists = [s.universeIds, s.universeDatastores?.map((d) => d.universeId)].filter((l): l is string[] => Array.isArray(l) && l.length > 0);
		if (!lists.length) return true;
		return lists.some((l) => l.includes("*") || l.includes(String(universeId)));
	});
}

/** The universes the key names explicitly (a "*" adds nothing: it means every universe the owner has). */
export function keyUniverseIds(info: KeyInfo | null | undefined): number[] {
	if (!info) return [];
	const ids = new Set<number>();
	for (const s of info.scopes) {
		for (const id of s.universeIds ?? []) if (/^\d+$/.test(id)) ids.add(Number(id));
		for (const d of s.universeDatastores ?? []) if (/^\d+$/.test(d.universeId)) ids.add(Number(d.universeId));
	}
	return [...ids];
}

/** The groups a key's scopes reach (creator-target scopes). */
export function keyGroupIds(info: KeyInfo | null | undefined): number[] {
	if (!info) return [];
	const ids = new Set<number>();
	for (const s of info.scopes) for (const id of s.groupIds ?? []) if (/^\d+$/.test(id)) ids.add(Number(id));
	return [...ids];
}

// Errors -----------------------------------------------------------------------------------------------------------------

/** A 401 / 403 from Open Cloud for a call whose scopes are known: the key lacks one of `scopes` for this resource. */
export class ScopeError extends HttpError {
	override name = "ScopeError";
	constructor(
		cause: HttpError,
		readonly scopes: string[],
	) {
		super(cause.status, `${cause.message} (the key needs ${scopes.join(" + ")} for this experience)`, cause.where, cause.body);
	}
}

/** The scopes a failed call needed, when it failed for want of them. */
export function missingScopesOf(error: unknown): string[] | null {
	return error instanceof ScopeError ? error.scopes : null;
}

// Calls ------------------------------------------------------------------------------------------------------------------

export class OpenCloud {
	constructor(private readonly apiKey: string) {}

	private headers(): Record<string, string> {
		return { "x-api-key": this.apiKey };
	}

	/**
	 * One Open Cloud call. `scopes` are the scopes the endpoint needs (from the OpenAPI document's x-roblox-scopes):
	 * a 401 / 403 then throws a ScopeError that names them, so screens can say which scope to add to the key.
	 */
	async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal, scopes?: string | string[]): Promise<T> {
		try {
			return await requestJson<T>(`${OPEN_CLOUD}${path}`, { method, headers: this.headers(), body, signal });
		} catch (error) {
			if (scopes && error instanceof HttpError && (error.status === 401 || error.status === 403)) throw new ScopeError(error, typeof scopes === "string" ? [scopes] : scopes);
			throw error;
		}
	}

	// Universe and places
	universe(universeId: number) {
		return this.request<CloudUniverse>("GET", `/cloud/v2/universes/${universeId}`);
	}
	place(universeId: number, placeId: number) {
		return this.request<CloudPlace>("GET", `/cloud/v2/universes/${universeId}/places/${placeId}`);
	}
	restartServers(universeId: number) {
		return this.request<Record<string, never>>("POST", `/cloud/v2/universes/${universeId}:restartServers`, {}, undefined, "universe:write");
	}
	publishMessage(universeId: number, topic: string, message: string) {
		return this.request<unknown>("POST", `/cloud/v2/universes/${universeId}:publishMessage`, { topic, message }, undefined, "universe-messaging-service:publish");
	}

	// Data stores (v2)
	listDataStores(universeId: number, params: { prefix?: string; pageToken?: string } = {}) {
		return this.request<{ dataStores?: CloudDataStore[]; nextPageToken?: string }>(
			"GET",
			`/cloud/v2/universes/${universeId}/data-stores${qs({ maxPageSize: 100, pageToken: params.pageToken, filter: params.prefix ? `id.startsWith("${escapeCel(params.prefix)}")` : undefined })}`,
			undefined,
			undefined,
			"universe-datastores.control:list",
		);
	}
	listEntries(universeId: number, store: string, params: { scope?: string; prefix?: string; pageToken?: string } = {}) {
		return this.request<{ dataStoreEntries?: CloudEntry[]; nextPageToken?: string }>(
			"GET",
			`${storePath(universeId, store, params.scope)}/entries${qs({ maxPageSize: 100, pageToken: params.pageToken, filter: params.prefix ? `id.startsWith("${escapeCel(params.prefix)}")` : undefined })}`,
			undefined,
			undefined,
			"universe-datastores.objects:list",
		);
	}
	getEntry(universeId: number, store: string, key: string, scope?: string) {
		return this.request<CloudEntry>("GET", `${storePath(universeId, store, scope)}/entries/${entryRef(key)}`, undefined, undefined, "universe-datastores.objects:read");
	}
	/** A past revision: `<key>@<revisionId>` (the v2 revision syntax). */
	getEntryRevision(universeId: number, store: string, key: string, revisionId: string, scope?: string) {
		return this.request<CloudEntry>("GET", `${storePath(universeId, store, scope)}/entries/${entryRef(key, revisionId)}`, undefined, undefined, ["universe-datastores.objects:read", "universe-datastores.versions:read"]);
	}
	listRevisions(universeId: number, store: string, key: string, params: { scope?: string; pageToken?: string } = {}) {
		return this.request<{ dataStoreEntries?: CloudEntry[]; nextPageToken?: string }>(
			"GET",
			`${storePath(universeId, store, params.scope)}/entries/${encodeURIComponent(key)}:listRevisions${qs({ maxPageSize: 50, pageToken: params.pageToken })}`,
			undefined,
			undefined,
			"universe-datastores.versions:list",
		);
	}
	updateEntry(universeId: number, store: string, key: string, value: unknown, scope?: string) {
		return this.request<CloudEntry>("PATCH", `${storePath(universeId, store, scope)}/entries/${encodeURIComponent(key)}`, { value }, undefined, "universe-datastores.objects:update");
	}
	deleteEntry(universeId: number, store: string, key: string, scope?: string) {
		return this.request<unknown>("DELETE", `${storePath(universeId, store, scope)}/entries/${encodeURIComponent(key)}`, undefined, undefined, "universe-datastores.objects:delete");
	}

	// Ordered data stores (v2)
	listOrdered(universeId: number, store: string, scope: string, params: { desc?: boolean; pageToken?: string } = {}) {
		return this.request<{ orderedDataStoreEntries?: { path: string; id: string; value: number }[]; nextPageToken?: string }>(
			"GET",
			`/cloud/v2/universes/${universeId}/ordered-data-stores/${encodeURIComponent(store)}/scopes/${encodeURIComponent(scope || "global")}/entries${qs({ maxPageSize: 100, orderBy: params.desc === false ? "value" : "value desc", pageToken: params.pageToken })}`,
			undefined,
			undefined,
			"universe.ordered-data-store.scope.entry:read",
		);
	}

	// Memory store (v2, read only). The list is named after the resource (memoryStoreSortedMapItems), like the other v2
	// lists here; `items` is kept as a fallback.
	listSortedMap(universeId: number, map: string, params: { desc?: boolean; pageToken?: string } = {}) {
		return this.request<{ memoryStoreSortedMapItems?: SortedMapItem[]; items?: SortedMapItem[]; nextPageToken?: string }>(
			"GET",
			`/cloud/v2/universes/${universeId}/memory-store/sorted-maps/${encodeURIComponent(map)}/items${qs({ maxPageSize: 100, orderBy: params.desc ? "desc" : "asc", pageToken: params.pageToken })}`,
			undefined,
			undefined,
			"memory-store.sorted-map:read",
		);
	}
	/** A peek: invisibilityWindow 0s, so the read doesn't hide the items from game servers. */
	peekQueue(universeId: number, queue: string, count = 100) {
		return this.request<{ queueItems?: { path?: string; data: unknown; priority?: number; expireTime?: string }[]; id?: string }>(
			"GET",
			`/cloud/v2/universes/${universeId}/memory-store/queues/${encodeURIComponent(queue)}/items:read${qs({ count, allOrNothing: false, invisibilityWindow: "0s" })}`,
			undefined,
			undefined,
			"memory-store.queue:dequeue",
		);
	}

	// User restrictions (bans)
	listRestrictions(universeId: number, pageToken?: string) {
		return this.request<{ userRestrictions?: UserRestriction[]; nextPageToken?: string }>(
			"GET",
			`/cloud/v2/universes/${universeId}/user-restrictions${qs({ maxPageSize: 100, pageToken })}`,
			undefined,
			undefined,
			"universe.user-restriction:read",
		);
	}
	restrictionLogs(universeId: number, pageToken?: string) {
		return this.request<{ logs?: RestrictionLog[]; nextPageToken?: string }>(
			"GET",
			`/cloud/v2/universes/${universeId}/user-restrictions:listLogs${qs({ maxPageSize: 100, pageToken })}`,
			undefined,
			undefined,
			"universe.user-restriction:read",
		);
	}
	/** Ban (active true) or unban (active false). `durationSeconds` omitted = permanent. */
	setRestriction(universeId: number, userId: number, restriction: { active: boolean; durationSeconds?: number; privateReason?: string; displayReason?: string; excludeAltAccounts?: boolean }) {
		const gameJoinRestriction: Record<string, unknown> = { active: restriction.active };
		if (restriction.active) {
			if (restriction.durationSeconds) gameJoinRestriction.duration = `${Math.round(restriction.durationSeconds)}s`;
			gameJoinRestriction.privateReason = restriction.privateReason ?? "";
			gameJoinRestriction.displayReason = restriction.displayReason ?? "";
			gameJoinRestriction.excludeAltAccounts = restriction.excludeAltAccounts ?? false;
		}
		return this.request<UserRestriction>(
			"PATCH",
			`/cloud/v2/universes/${universeId}/user-restrictions/${userId}${qs({ updateMask: "gameJoinRestriction" })}`,
			{ gameJoinRestriction },
			undefined,
			"universe.user-restriction:write",
		);
	}

	// Monetization
	developerProducts(universeId: number, pageToken?: string) {
		return this.request<{ developerProducts?: DeveloperProduct[]; nextPageToken?: string }>(
			"GET",
			`/developer-products/v2/universes/${universeId}/developer-products/creator${qs({ pageSize: 50, pageToken })}`,
			undefined,
			undefined,
			"developer-product:read",
		);
	}
	gamePasses(universeId: number, pageToken?: string) {
		return this.request<{ gamePasses?: CreatorGamePass[]; nextPageToken?: string }>(
			"GET",
			`/game-passes/v1/universes/${universeId}/game-passes/creator${qs({ pageSize: 50, pageToken })}`,
			undefined,
			undefined,
			"game-pass:read",
		);
	}

	// Analytics Query API
	queryMetric(universeId: number, query: AnalyticsQuery, options: { pollMs?: number; maxPolls?: number; signal?: AbortSignal } = {}) {
		return queryAnalyticsMetric(this, universeId, query, options);
	}
}

/** An entry id for a GET: "@<revision>" picks a revision, so an id that has "@" in it gets "@latest". */
function entryRef(key: string, revisionId?: string): string {
	const id = encodeURIComponent(key).replace(/%40/g, "@");
	if (revisionId) return `${id}@${encodeURIComponent(revisionId)}`;
	return key.includes("@") ? `${id}@latest` : id;
}

function escapeCel(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function storePath(universeId: number, store: string, scope?: string): string {
	const s = scope && scope !== "global" ? `/scopes/${encodeURIComponent(scope)}` : "";
	return `/cloud/v2/universes/${universeId}/data-stores/${encodeURIComponent(store)}${s}`;
}

// Types ------------------------------------------------------------------------------------------------------------------

export interface CloudUniverse {
	path: string;
	createTime: string;
	updateTime: string;
	displayName: string;
	description: string;
	user?: string;
	group?: string;
	visibility?: string;
	ageRating?: string;
	voiceChatEnabled?: boolean;
	privateServerPriceRobux?: number;
	desktopEnabled?: boolean;
	mobileEnabled?: boolean;
	tabletEnabled?: boolean;
	consoleEnabled?: boolean;
	vrEnabled?: boolean;
	rootPlace?: string;
}

export interface CloudPlace {
	path: string;
	createTime: string;
	updateTime: string;
	displayName: string;
	description: string;
	serverSize: number;
	root?: boolean;
}

export interface CloudDataStore {
	path: string;
	id: string;
	createTime?: string;
	state?: string;
	expireTime?: string;
}

export interface CloudEntry {
	path: string;
	id: string;
	createTime?: string;
	revisionId?: string;
	revisionCreateTime?: string;
	state?: string;
	etag?: string;
	value?: unknown;
	users?: string[];
	attributes?: Record<string, unknown>;
}

export interface SortedMapItem {
	path: string;
	id: string;
	value: unknown;
	etag?: string;
	expireTime?: string;
	stringSortKey?: string;
	numericSortKey?: number;
}

export interface UserRestriction {
	path: string;
	updateTime?: string;
	/** "users/<id>" */
	user: string;
	gameJoinRestriction?: {
		active: boolean;
		startTime?: string;
		duration?: string;
		privateReason?: string;
		displayReason?: string;
		excludeAltAccounts?: boolean;
		inherited?: boolean;
	};
}

export interface RestrictionLog {
	user: string;
	place?: string;
	moderator?: { robloxUser?: string; gameServerScript?: Record<string, never> };
	createTime: string;
	active: boolean;
	startTime?: string;
	duration?: string;
	privateReason?: string;
	displayReason?: string;
	excludeAltAccounts?: boolean;
}

export interface DeveloperProduct {
	productId: number;
	name: string;
	description?: string;
	iconImageAssetId?: number;
	isForSale: boolean;
	priceInformation?: { defaultPriceInRobux?: number | null; enabledFeatures?: string[] };
	createdTimestamp?: string;
	updatedTimestamp?: string;
}

export interface CreatorGamePass {
	gamePassId: number;
	name: string;
	description?: string;
	isForSale: boolean;
	iconAssetId?: number;
	priceInformation?: { defaultPriceInRobux?: number | null; enabledFeatures?: string[] };
	createdTimestamp?: string;
	updatedTimestamp?: string;
}

/** "users/123" -> 123 */
export function idFromPath(path: string | undefined): number | null {
	const m = /(\d+)$/.exec(path ?? "");
	return m ? Number(m[1]) : null;
}

/** "86400s" -> seconds */
export function durationSeconds(duration: string | undefined): number | null {
	const m = /^(\d+(?:\.\d+)?)s$/.exec(duration ?? "");
	return m ? Number(m[1]) : null;
}

// Analytics Query API ----------------------------------------------------------------------------------------------------

export const ANALYTICS_READ_SCOPE = "universe.analytics:read";

export type Granularity = "OneMinute" | "HalfHour" | "OneHour" | "OneDay" | "OneWeek" | "OneMonth" | "None";

export interface AnalyticsQuery {
	/** A metric id from create.roblox.com/docs/cloud/guides/analytics/metrics (e.g. `DailyActiveUsers`). */
	metric: string;
	granularity: Granularity;
	/** RFC 3339; start inclusive, end exclusive. */
	startTime: string;
	endTime: string;
	breakdown?: string[];
	filter?: { dimension: string; values: string[]; operation: string }[];
	limit?: number;
}

export interface AnalyticsSeries {
	breakdowns: { dimension: string; value: string; displayValue?: string }[];
	dataPoints: { time: string; value: number | null; status?: string }[];
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * One metric over a date range (port of the backend's queryAnalyticsMetric): `POST /analytics-query-api/v1/universes/{u}/metrics`;
 * a slow query answers `{ done: false, path }` and is polled on `GET /analytics-query-api/{path}` until done. Roblox
 * allows 30 queries a minute per key owner, so callers keep few in flight (analytics.ts).
 */
export async function queryAnalyticsMetric(
	cloud: OpenCloud,
	universeId: number,
	query: AnalyticsQuery,
	options: { pollMs?: number; maxPolls?: number; signal?: AbortSignal } = {},
): Promise<AnalyticsSeries[]> {
	const path = `/analytics-query-api/v1/universes/${universeId}/metrics`;
	let body: Record<string, unknown>;
	try {
		body = record(await cloud.request<unknown>("POST", path, query, options.signal, ANALYTICS_READ_SCOPE));
	} catch (error) {
		if (error instanceof HttpError) {
			const e = record(record(error.body).error);
			const hint = error.status === 401 || error.status === 403 ? ` (the key needs ${ANALYTICS_READ_SCOPE} for this universe)` : "";
			throw new HttpError(error.status, `${typeof e.message === "string" ? e.message : error.message}${hint}`, error.where, error.body);
		}
		throw error;
	}
	for (let polls = 0; body.done !== true; polls++) {
		if (polls >= (options.maxPolls ?? 20)) throw new HttpError(504, `${query.metric}: the query didn't finish in time`, path);
		const operation = typeof body.path === "string" ? body.path.replace(/^\/+/, "") : "";
		if (!/^v1\/universes\/\d+\/operations\/[A-Za-z0-9_/-]+$/.test(operation)) throw new HttpError(502, `${query.metric}: no operation path to poll`, path);
		await sleep(options.pollMs ?? 1000);
		if (options.signal?.aborted) throw new HttpError(0, "cancelled", path);
		body = record(await cloud.request<unknown>("GET", `/analytics-query-api/${operation}`, undefined, options.signal));
	}
	const error = record(body.error);
	if (typeof error.message === "string" || typeof error.code === "number") {
		throw new HttpError(502, `${query.metric}: ${String(error.message ?? "query failed")}`, path);
	}
	const values = record(body.response).values;
	return (Array.isArray(values) ? values : []).map((series) => {
		const s = record(series);
		const breakdowns = (Array.isArray(s.breakdowns) ? s.breakdowns : [])
			.map(record)
			.filter((b) => typeof b.dimension === "string" && typeof b.value === "string")
			.map((b) => ({ dimension: b.dimension as string, value: b.value as string, ...(typeof b.displayValue === "string" ? { displayValue: b.displayValue } : {}) }));
		const dataPoints = (Array.isArray(s.dataPoints) ? s.dataPoints : [])
			.map(record)
			.filter((p) => typeof p.time === "string" && Number.isFinite(Date.parse(p.time)))
			.map((p) => {
				const n = typeof p.value === "number" ? p.value : typeof p.value === "string" && p.value.trim() !== "" ? Number(p.value) : Number.NaN;
				return { time: p.time as string, value: Number.isFinite(n) ? n : null, ...(typeof p.status === "string" ? { status: p.status } : {}) };
			})
			.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
		return { breakdowns, dataPoints };
	});
}
