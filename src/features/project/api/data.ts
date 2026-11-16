/**
 * Open Cloud storage calls beyond the read-only ones in src/api/opencloud.ts: data store control (show deleted, delete,
 * undelete, snapshot), entry create / full update / increment / restore, ordered data store CRUD, memory store sorted
 * map CRUD, queue add / dequeue / discard, memory store flush, and the secrets store (list, create, update, delete;
 * values sealed on the phone with LibSodium's crypto_box_seal against the universe's public key).
 *
 * Checked against Roblox's OpenAPI document (2026-11): paths, query names (maxPageSize / pageToken, but limit / cursor
 * for secrets), body shapes and x-roblox-scopes. Notes from it that shape the code:
 *   - PATCH data-stores/.../entries/{id}: "Partial update is unsupported. If attributes or users are not provided when
 *     updating the value, they will be cleared." So every write resends value + users + attributes (+ etag).
 *   - :increment clears users / attributes the same way unless they are sent.
 *   - memory-store:flush answers { path, done } whose path already starts with cloud/v2.
 *   - Secrets fields are snake_case (key_id, create_time, update_time).
 */
import * as Crypto from "expo-crypto";

import { qs } from "@/api/http";
import type { CloudDataStore, CloudEntry, OpenCloud, SortedMapItem } from "@/api/opencloud";

import { cryptoBoxSeal, fromBase64, toBase64, utf8 } from "../sealedbox";

const u = (universeId: number) => `/cloud/v2/universes/${universeId}`;
const enc = encodeURIComponent;

function escapeCel(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Validation shared by the forms ---------------------------------------------------------------------------------------

/** Parses a JSON value typed in a form; throws a readable error. */
export function parseJson(text: string, what = "Value"): unknown {
	const trimmed = text.trim();
	if (!trimmed) throw new Error(`${what} is empty. Type JSON: a number, "a string", true, [ ], { }.`);
	try {
		return JSON.parse(trimmed);
	} catch (e) {
		throw new Error(`${what} is not valid JSON: ${(e as Error).message}`);
	}
}

/** "123, 456" -> ["users/123", "users/456"] (the entry `users` field wants resource paths, not bare ids). */
export function parseUsers(text: string): string[] {
	const parts = text
		.split(/[\s,]+/)
		.map((p) => p.trim().replace(/^users\//, ""))
		.filter(Boolean);
	for (const p of parts) if (!/^\d{1,20}$/.test(p)) throw new Error(`“${p}” is not a user ID.`);
	return Array.from(new Set(parts)).map((p) => `users/${p}`);
}

/** Attributes must be a JSON object (or empty for none). */
export function parseAttributes(text: string): Record<string, unknown> | undefined {
	if (!text.trim()) return undefined;
	const v = parseJson(text, "Attributes");
	if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("Attributes must be a JSON object, like {\"version\": 2}.");
	return v as Record<string, unknown>;
}

/** An integer (as Roblox needs for increments and ordered values); throws a readable error. */
export function parseInteger(text: string, what: string): number {
	const t = text.trim();
	if (!/^-?\d+$/.test(t)) throw new Error(`${what} must be a whole number.`);
	const n = Number(t);
	if (!Number.isSafeInteger(n)) throw new Error(`${what} is too large.`);
	return n;
}

/** Whole seconds in 1..max as a "<n>s" duration. */
export function parseTtl(text: string, max = MEMORY_MAX_TTL): string {
	const t = text.trim().replace(/s$/, "");
	if (!/^\d+$/.test(t)) throw new Error("TTL must be a whole number of seconds.");
	const n = Number(t);
	if (n < 1 || n > max) throw new Error(`TTL must be 1-${max} seconds.`);
	return `${n}s`;
}

/** The longest memory store TTL (45 days). */
export const MEMORY_MAX_TTL = 3_888_000;
/** Data store entry ids: 1-50 characters (OpenAPI: CreateDataStoreEntry `id`). */
export const ENTRY_ID_MAX = 50;
/** Ordered entry ids: 1-63 characters. */
export const ORDERED_ID_MAX = 63;
/** Sorted map item ids: 1-128 characters. */
export const SORTED_MAP_ID_MAX = 128;
/** A data store value is at most 4 MB of JSON. */
export const ENTRY_VALUE_MAX = 4 * 1024 * 1024;

export function checkId(id: string, max: number, what = "Key"): string {
	const t = id.trim();
	if (!t) throw new Error(`${what} is empty.`);
	if (t.length > max) throw new Error(`${what} is ${t.length} characters; the most is ${max}.`);
	return t;
}

function checkValueSize(value: unknown) {
	const n = utf8(JSON.stringify(value) ?? "").length;
	if (n > ENTRY_VALUE_MAX) throw new Error(`The value is ${(n / 1024 / 1024).toFixed(1)} MB; a data store entry holds at most 4 MB.`);
}

// Data stores: control ------------------------------------------------------------------------------------------------

const DS_LIST = "universe-datastores.control:list";
const DS_DELETE = "universe-datastores.control:delete";
const DS_SNAPSHOT = "universe-datastores.control:snapshot";

export function listDataStores(cloud: OpenCloud, universeId: number, params: { prefix?: string; showDeleted?: boolean; pageToken?: string } = {}) {
	return cloud.request<{ dataStores?: CloudDataStore[]; nextPageToken?: string }>(
		"GET",
		`${u(universeId)}/data-stores${qs({ maxPageSize: 100, pageToken: params.pageToken, filter: params.prefix ? `id.startsWith("${escapeCel(params.prefix)}")` : undefined, showDeleted: params.showDeleted || undefined })}`,
		undefined,
		undefined,
		DS_LIST,
	);
}

/** Schedules the store for permanent deletion in 30 days (undelete before then). */
export function deleteDataStore(cloud: OpenCloud, universeId: number, store: string) {
	return cloud.request<CloudDataStore>("DELETE", `${u(universeId)}/data-stores/${enc(store)}`, undefined, undefined, DS_DELETE);
}

export function undeleteDataStore(cloud: OpenCloud, universeId: number, store: string) {
	return cloud.request<CloudDataStore>("POST", `${u(universeId)}/data-stores/${enc(store)}:undelete`, {}, undefined, DS_DELETE);
}

export interface SnapshotResult {
	newSnapshotTaken?: boolean;
	latestSnapshotTime?: string;
}

/** One snapshot per experience per UTC day; later calls are no-ops that return the latest time. */
export function snapshotDataStores(cloud: OpenCloud, universeId: number) {
	return cloud.request<SnapshotResult>("POST", `${u(universeId)}/data-stores:snapshot`, {}, undefined, DS_SNAPSHOT);
}

// Data stores: entries ------------------------------------------------------------------------------------------------

function storePath(universeId: number, store: string, scope?: string): string {
	const s = scope && scope !== "global" ? `/scopes/${enc(scope)}` : "";
	return `${u(universeId)}/data-stores/${enc(store)}${s}`;
}

export function listEntries(cloud: OpenCloud, universeId: number, store: string, params: { scope?: string; prefix?: string; showDeleted?: boolean; pageToken?: string } = {}) {
	return cloud.request<{ dataStoreEntries?: CloudEntry[]; nextPageToken?: string }>(
		"GET",
		`${storePath(universeId, store, params.scope)}/entries${qs({ maxPageSize: 100, pageToken: params.pageToken, filter: params.prefix ? `id.startsWith("${escapeCel(params.prefix)}")` : undefined, showDeleted: params.showDeleted || undefined })}`,
		undefined,
		undefined,
		"universe-datastores.objects:list",
	);
}

/** An RFC 3339 UTC time ("2026-01-02T03:04:05Z"), checked so it can go raw into a path. */
export function checkRfc3339(text: string): string {
	const t = text.trim();
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/.test(t) || Number.isNaN(Date.parse(t))) throw new Error("Use a UTC time like 2026-01-02T03:04:05Z.");
	return t.length === 17 ? `${t.slice(0, 16)}:00Z` : t;
}

/** The value that was current at `time` (`<key>@latest:<RFC 3339>`). Needs versions:read too. */
export function getEntryAsOf(cloud: OpenCloud, universeId: number, store: string, key: string, time: string, scope?: string) {
	const id = enc(key).replace(/%40/g, "@");
	return cloud.request<CloudEntry>("GET", `${storePath(universeId, store, scope)}/entries/${id}@latest:${checkRfc3339(time)}`, undefined, undefined, ["universe-datastores.objects:read", "universe-datastores.versions:read"]);
}

/** Revisions, newest first; `filter` is the doc's CEL on revision_create_time (>= / <= / &&). */
export function listRevisions(cloud: OpenCloud, universeId: number, store: string, key: string, params: { scope?: string; pageToken?: string; from?: string; to?: string } = {}) {
	const parts = [params.from ? `revision_create_time >= ${checkRfc3339(params.from)}` : "", params.to ? `revision_create_time <= ${checkRfc3339(params.to)}` : ""].filter(Boolean);
	return cloud.request<{ dataStoreEntries?: CloudEntry[]; nextPageToken?: string }>(
		"GET",
		`${storePath(universeId, store, params.scope)}/entries/${enc(key)}:listRevisions${qs({ maxPageSize: 50, pageToken: params.pageToken, filter: parts.length ? parts.join(" && ") : undefined })}`,
		undefined,
		undefined,
		"universe-datastores.versions:list",
	);
}

export interface EntryWrite {
	value: unknown;
	users?: string[];
	attributes?: Record<string, unknown>;
}

/** Creates a new key; Roblox answers 400 if it exists. */
export function createEntry(cloud: OpenCloud, universeId: number, store: string, key: string, entry: EntryWrite, scope?: string) {
	const id = checkId(key, ENTRY_ID_MAX);
	checkValueSize(entry.value);
	return cloud.request<CloudEntry>("POST", `${storePath(universeId, store, scope)}/entries${qs({ id })}`, { value: entry.value, users: entry.users ?? [], attributes: entry.attributes ?? {} }, undefined, "universe-datastores.objects:create");
}

/**
 * A full write of an entry: value, users and attributes together (anything left out is cleared by Roblox). `etag`
 * from the read makes the write fail if a game server changed the entry since; `allowMissing` turns it into an
 * upsert (used to restore a deleted key).
 */
export function writeEntry(cloud: OpenCloud, universeId: number, store: string, key: string, entry: EntryWrite & { etag?: string }, options: { scope?: string; allowMissing?: boolean } = {}) {
	checkValueSize(entry.value);
	const body: Record<string, unknown> = { value: entry.value, users: entry.users ?? [], attributes: entry.attributes ?? {} };
	if (entry.etag) body.etag = entry.etag;
	return cloud.request<CloudEntry>(
		"PATCH",
		`${storePath(universeId, store, options.scope)}/entries/${enc(key)}${qs({ allowMissing: options.allowMissing || undefined })}`,
		body,
		undefined,
		"universe-datastores.objects:update",
	);
}

/** Adds `amount` (an integer) to an integer entry, keeping its users and attributes. Creates it when missing. */
export function incrementEntry(cloud: OpenCloud, universeId: number, store: string, key: string, amount: number, keep: { users?: string[]; attributes?: Record<string, unknown> }, scope?: string) {
	return cloud.request<CloudEntry>(
		"POST",
		`${storePath(universeId, store, scope)}/entries/${enc(key)}:increment`,
		{ amount, users: keep.users ?? [], attributes: keep.attributes ?? {} },
		undefined,
		["universe-datastores.objects:create", "universe-datastores.objects:update"],
	);
}

// Ordered data stores --------------------------------------------------------------------------------------------------

const ODS_READ = "universe.ordered-data-store.scope.entry:read";
const ODS_WRITE = "universe.ordered-data-store.scope.entry:write";

export interface OrderedEntry {
	path: string;
	id: string;
	value: number;
}

function orderedPath(universeId: number, store: string, scope: string): string {
	return `${u(universeId)}/ordered-data-stores/${enc(store)}/scopes/${enc(scope || "global")}/entries`;
}

/** Entries by value; `min` / `max` become the doc's filter ("entry >= 10 && entry <= 50"). */
export function listOrdered(cloud: OpenCloud, universeId: number, store: string, scope: string, params: { desc?: boolean; min?: number; max?: number; pageToken?: string } = {}) {
	const parts = [params.min !== undefined ? `entry >= ${params.min}` : "", params.max !== undefined ? `entry <= ${params.max}` : ""].filter(Boolean);
	return cloud.request<{ orderedDataStoreEntries?: OrderedEntry[]; nextPageToken?: string }>(
		"GET",
		`${orderedPath(universeId, store, scope)}${qs({ maxPageSize: 100, orderBy: params.desc === false ? "value" : "value desc", filter: parts.length ? parts.join(" && ") : undefined, pageToken: params.pageToken })}`,
		undefined,
		undefined,
		ODS_READ,
	);
}

export function getOrdered(cloud: OpenCloud, universeId: number, store: string, scope: string, key: string) {
	return cloud.request<OrderedEntry>("GET", `${orderedPath(universeId, store, scope)}/${enc(key)}`, undefined, undefined, ODS_READ);
}

/** Creates a new entry; Roblox answers 400 if it exists. */
export function createOrdered(cloud: OpenCloud, universeId: number, store: string, scope: string, key: string, value: number) {
	return cloud.request<OrderedEntry>("POST", `${orderedPath(universeId, store, scope)}${qs({ id: checkId(key, ORDERED_ID_MAX) })}`, { value }, undefined, ODS_WRITE);
}

export function setOrdered(cloud: OpenCloud, universeId: number, store: string, scope: string, key: string, value: number, allowMissing = false) {
	return cloud.request<OrderedEntry>("PATCH", `${orderedPath(universeId, store, scope)}/${enc(key)}${qs({ allowMissing: allowMissing || undefined })}`, { value }, undefined, ODS_WRITE);
}

export function incrementOrdered(cloud: OpenCloud, universeId: number, store: string, scope: string, key: string, amount: number) {
	return cloud.request<OrderedEntry>("POST", `${orderedPath(universeId, store, scope)}/${enc(key)}:increment`, { amount }, undefined, ODS_WRITE);
}

/** A hard delete: ordered data stores keep no revisions. */
export function deleteOrdered(cloud: OpenCloud, universeId: number, store: string, scope: string, key: string) {
	return cloud.request<unknown>("DELETE", `${orderedPath(universeId, store, scope)}/${enc(key)}`, undefined, undefined, ODS_WRITE);
}

// Memory store: sorted maps --------------------------------------------------------------------------------------------

const MAP_READ = "memory-store.sorted-map:read";
const MAP_WRITE = "memory-store.sorted-map:write";

export interface SortedMapWrite {
	value: unknown;
	/** "<n>s" (required on create and update). */
	ttl: string;
	stringSortKey?: string;
	numericSortKey?: number;
	etag?: string;
}

function mapPath(universeId: number, map: string): string {
	return `${u(universeId)}/memory-store/sorted-maps/${enc(map)}/items`;
}

/**
 * Items in key order; `after` / `before` become the doc's filter on id (only <, > and && are allowed). The v2 list is
 * named after the resource (memoryStoreSortedMapItems); `items` is kept as a fallback.
 */
export function listSortedMap(cloud: OpenCloud, universeId: number, map: string, params: { desc?: boolean; after?: string; before?: string; pageToken?: string } = {}) {
	const parts = [params.after ? `id > "${escapeCel(params.after)}"` : "", params.before ? `id < "${escapeCel(params.before)}"` : ""].filter(Boolean);
	return cloud.request<{ memoryStoreSortedMapItems?: SortedMapItem[]; items?: SortedMapItem[]; nextPageToken?: string }>(
		"GET",
		`${mapPath(universeId, map)}${qs({ maxPageSize: 100, orderBy: params.desc ? "desc" : "asc", filter: parts.length ? parts.join(" && ") : undefined, pageToken: params.pageToken })}`,
		undefined,
		undefined,
		MAP_READ,
	);
}

export function getSortedMapItem(cloud: OpenCloud, universeId: number, map: string, id: string) {
	return cloud.request<SortedMapItem>("GET", `${mapPath(universeId, map)}/${enc(id)}`, undefined, undefined, MAP_READ);
}

function mapBody(item: SortedMapWrite): Record<string, unknown> {
	if (item.stringSortKey !== undefined && item.numericSortKey !== undefined) throw new Error("Use a string or a numeric sort key, not both.");
	const body: Record<string, unknown> = { value: item.value, ttl: item.ttl };
	if (item.stringSortKey !== undefined) body.stringSortKey = item.stringSortKey;
	if (item.numericSortKey !== undefined) body.numericSortKey = item.numericSortKey;
	if (item.etag) body.etag = item.etag;
	return body;
}

export function createSortedMapItem(cloud: OpenCloud, universeId: number, map: string, id: string, item: SortedMapWrite) {
	return cloud.request<SortedMapItem>("POST", `${mapPath(universeId, map)}${qs({ id: checkId(id, SORTED_MAP_ID_MAX, "Item ID") })}`, mapBody(item), undefined, MAP_WRITE);
}

/** Replaces value, TTL and sort key (no sort key clears it). `etag` makes it fail if a server changed the item. */
export function updateSortedMapItem(cloud: OpenCloud, universeId: number, map: string, id: string, item: SortedMapWrite, allowMissing = false) {
	return cloud.request<SortedMapItem>("PATCH", `${mapPath(universeId, map)}/${enc(id)}${qs({ allowMissing: allowMissing || undefined })}`, mapBody(item), undefined, MAP_WRITE);
}

export function deleteSortedMapItem(cloud: OpenCloud, universeId: number, map: string, id: string) {
	return cloud.request<unknown>("DELETE", `${mapPath(universeId, map)}/${enc(id)}`, undefined, undefined, MAP_WRITE);
}

// Memory store: queues -------------------------------------------------------------------------------------------------

export interface QueueItem {
	path?: string;
	data: unknown;
	priority?: number;
	expireTime?: string;
	ttl?: string;
}

function queuePath(universeId: number, queue: string): string {
	return `${u(universeId)}/memory-store/queues/${enc(queue)}/items`;
}

/** Adds an item; `ttl` omitted = 45 days; a higher priority goes nearer the front. */
export function addQueueItem(cloud: OpenCloud, universeId: number, queue: string, item: { data: unknown; ttl?: string; priority?: number }) {
	const body: Record<string, unknown> = { data: item.data };
	if (item.ttl) body.ttl = item.ttl;
	if (item.priority !== undefined) body.priority = item.priority;
	return cloud.request<QueueItem>("POST", queuePath(universeId, queue), body, undefined, "memory-store.queue:add");
}

/**
 * Reads up to `count` (1-100) items from the front. With an invisibility window > 0 s the items are hidden from game
 * servers for that long, and the answer's `id` can be passed to discardQueueItems to remove exactly them. Roblox
 * answers 404 when the queue is empty.
 */
export function readQueue(cloud: OpenCloud, universeId: number, queue: string, count: number, invisibilitySeconds: number) {
	if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Count must be 1-100.");
	if (!Number.isInteger(invisibilitySeconds) || invisibilitySeconds < 0) throw new Error("The invisibility window must be whole seconds.");
	return cloud.request<{ queueItems?: QueueItem[]; id?: string }>(
		"GET",
		`${queuePath(universeId, queue)}:read${qs({ count, allOrNothing: false, invisibilityWindow: `${invisibilitySeconds}s` })}`,
		undefined,
		undefined,
		"memory-store.queue:dequeue",
	);
}

export function discardQueueItems(cloud: OpenCloud, universeId: number, queue: string, readId: string) {
	return cloud.request<unknown>("POST", `${queuePath(universeId, queue)}:discard`, { readId }, undefined, "memory-store.queue:discard");
}

// Memory store: flush --------------------------------------------------------------------------------------------------

export type FlushScope = "LIVE" | "TEST";

export interface FlushOperation {
	path?: string;
	done?: boolean;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Flushes every sorted map and queue of the universe (scope LIVE or TEST), then polls the operation (memory-store:get)
 * at most `maxPolls` times. Resolves with whether it finished within the polls.
 */
export async function flushMemoryStore(cloud: OpenCloud, universeId: number, scope: FlushScope, options: { maxPolls?: number; pollMs?: number; onPoll?: (n: number) => void } = {}): Promise<{ done: boolean; path?: string }> {
	let op = await cloud.request<FlushOperation>("POST", `${u(universeId)}/memory-store:flush${qs({ scope })}`, undefined, undefined, "memory-store:flush");
	const maxPolls = options.maxPolls ?? 15;
	for (let polls = 0; op?.done !== true; polls++) {
		// The answer's path already includes cloud/v2 (OpenAPI note): poll https://apis.roblox.com/<path> as is.
		const path = typeof op?.path === "string" ? op.path.replace(/^\/+/, "") : "";
		// The flush has started either way; without a well-formed operation path there is just nothing to follow.
		if (!new RegExp(`^cloud/v2/universes/${universeId}/memory-store/operations/[A-Za-z0-9_.-]+$`).test(path)) return { done: false };
		if (polls >= maxPolls) return { done: false, path };
		options.onPoll?.(polls + 1);
		await sleep(options.pollMs ?? 2000);
		op = await cloud.request<FlushOperation>("GET", `/${path}${qs({ scope })}`, undefined, undefined, "memory-store:get");
	}
	return { done: true, path: op.path };
}

// Secrets store ---------------------------------------------------------------------------------------------------------

const SECRET_READ = "universe.secret:read";
const SECRET_WRITE = "universe.secret:write";
/** Alphanumeric or underscore, 1-64 characters, not starting with a number (Secret.id). */
export const SECRET_ID = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const SECRETS_MAX = 500;

export interface UniverseSecret {
	id: string;
	domain?: string | null;
	key_id?: string;
	create_time?: string;
	update_time?: string;
}

export function listSecrets(cloud: OpenCloud, universeId: number, cursor?: string) {
	return cloud.request<{ secrets?: UniverseSecret[]; nextPageCursor?: string | null; previousPageCursor?: string | null }>(
		"GET",
		`${u(universeId)}/secrets${qs({ limit: 100, cursor })}`,
		undefined,
		undefined,
		SECRET_READ,
	);
}

/** The universe's sealing key: { id: "public-key", secret: <base64 X25519 public key>, key_id }. */
export function getSecretsPublicKey(cloud: OpenCloud, universeId: number) {
	return cloud.request<{ id?: string; secret?: string; key_id?: string }>("GET", `${u(universeId)}/secrets/public-key`, undefined, undefined, SECRET_READ);
}

/** Seals `value` (UTF-8) for the universe: fetches the public key, crypto_box_seal, base64. The plain value never leaves the phone. */
async function sealForUniverse(cloud: OpenCloud, universeId: number, value: string): Promise<{ secret: string; key_id: string }> {
	const key = await getSecretsPublicKey(cloud, universeId);
	if (!key?.secret || !key.key_id) throw new Error("Roblox answered no public key for this experience.");
	let pk: Uint8Array;
	try {
		pk = fromBase64(key.secret);
	} catch {
		throw new Error("The experience's public key is not base64.");
	}
	if (pk.length !== 32) throw new Error(`The experience's public key is ${pk.length} bytes, not 32; not sealing.`);
	const sealed = cryptoBoxSeal(utf8(value), pk, (n) => Crypto.getRandomBytes(n));
	return { secret: toBase64(sealed), key_id: key.key_id };
}

export function checkSecretId(id: string): string {
	const t = id.trim();
	if (!SECRET_ID.test(t)) throw new Error("A secret name is 1-64 letters, digits or _, and does not start with a digit.");
	return t;
}

/** Creates a secret. `domain`: "*" for any host, "api.example.com", "*.example.org"; empty = a private key that can't be sent as a header or URL. */
export async function createSecret(cloud: OpenCloud, universeId: number, input: { id: string; value: string; domain: string }) {
	const id = checkSecretId(input.id);
	if (!input.value) throw new Error("The secret value is empty.");
	const sealed = await sealForUniverse(cloud, universeId, input.value);
	return cloud.request<UniverseSecret | undefined>("POST", `${u(universeId)}/secrets`, { id, ...sealed, domain: input.domain.trim() }, undefined, SECRET_WRITE);
}

/**
 * Replaces a secret's value and domain (the name can't change). Always sends a freshly sealed value: the doc's only
 * update example sends secret + key_id, there is no updateMask and Secret.secret is nullable, so a domain-only PATCH
 * might clear the stored value. Not worth the risk without a live test.
 */
export async function updateSecret(cloud: OpenCloud, universeId: number, id: string, input: { value: string; domain: string }) {
	if (!input.value) throw new Error("The new secret value is empty.");
	const sealed = await sealForUniverse(cloud, universeId, input.value);
	return cloud.request<UniverseSecret>("PATCH", `${u(universeId)}/secrets/${enc(id)}`, { ...sealed, domain: input.domain.trim() }, undefined, SECRET_WRITE);
}

export function deleteSecret(cloud: OpenCloud, universeId: number, id: string) {
	return cloud.request<unknown>("DELETE", `${u(universeId)}/secrets/${enc(id)}`, undefined, undefined, SECRET_WRITE);
}
