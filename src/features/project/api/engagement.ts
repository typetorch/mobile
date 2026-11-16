/**
 * Creator Hub "Engagement" calls: virtual events, experience notification strings (+ analytics and a test send),
 * icon / thumbnails (public media, per-language sets, alt text, order), homepage thumbnail personalization,
 * localization (languages, automatic translation, translated name / description, passes / products / badges, the
 * auto-localization table), Translate Text and Generate Speech Asset.
 *
 * Checked against Roblox's OpenAPI document (2026-11): paths, casing, query names, body shapes and x-roblox-scopes.
 * Notes from it that shape the code:
 *   - virtual-events v3 (EXPERIMENTAL): pageSize / pageToken -> nextPageToken; with no time bound the list defaults to
 *     endsAfter = now (upcoming and live events). PATCH is a JSON merge (omitted or null = unchanged, no updateMask).
 *     Create allows visibility public / private only; `groupId` hosts it as a group (else the key owner). DELETE 204.
 *     Event ids are strings (they exceed 2^53). Writes 20 / min.
 *   - notifications developer-configuration: PascalCase query (UniverseId, Count 1-100, Cursor, Id); update and
 *     archive are POSTs. Content is limited to 99 characters (create.roblox.com/docs/production/promotion/
 *     experience-notifications). Analytics (universe.analytics:read) answers an untyped `overview` map and `campaigns`.
 *   - Create User Notification (cloud v2, STABLE): payload.messageId is the notification string id; launchData max
 *     200 bytes; a user gets at most one notification a day per experience and must have opted in.
 *   - legacy-game-internationalization (EXPERIMENTAL, legacy-universe:manage): delete / reorder of a localized
 *     thumbnail and delete of a localized icon refuse the SOURCE language (errors 23 / 26). Toggle bodies are a bare
 *     JSON boolean. Name / description PATCH answers successOperations + failedOperations (partial failure).
 *     Translation history count must be 1-49.
 *   - Passes / products / badges localization need legacy-game-pass:manage, legacy-developer-product:manage,
 *     legacy-badge:manage (these legacy scopes can't be limited to one universe).
 *   - thumbnail-personalization (EXPERIMENTAL): pool pages with limit / nextCursor; configs need `status`
 *     (Active | Inactive) and page with limit / cursor; create / update take up to five homepageThumbnailIds.
 *     DELETE takes homepageThumbnailIds as a repeated query parameter.
 *   - autolocalizationtable is a POST that may create the table when there is none (a side effect).
 *   - translateText (BETA, universe:write): {text, sourceLanguageCode?, targetLanguageCodes[]} -> translations map.
 *   - generateSpeechAsset (BETA, universe:write + asset:read + asset:write, 4 / s): answers an Operation; poll
 *     GET /assets/v1/<operation path> (asset:write) until done; the response is {assetId, remainingQuota}.
 *   - Image uploads are multipart/form-data: localized thumbnail / icon (game, pass, product, badge) take one `Files`
 *     part and refuse the SOURCE language (error 26); the thumbnail answers {mediaAssetId}. The personalization pool
 *     upload takes repeated `files` parts and answers fileToOperationIdDict (file name -> operation id); the status GET
 *     takes repeated operationIds and answers uploadStatus (1 | 2, not described) + uploadThumbnailStatusDict, which
 *     holds only the operations that finished. Images are picked with expo-file-system's system file picker
 *     (File.pickFileAsync, part of Expo Go) and sent as React Native {uri, name, type} FormData parts.
 */
import { chunk, deadline, DEFAULT_TIMEOUT_MS, errorMessage, HttpError, mapLimit, qs, requestJson } from "@/api/http";
import { OPEN_CLOUD, ScopeError, type OpenCloud } from "@/api/opencloud";

const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export const ENG_SCOPES = {
	eventRead: "universe.event:read",
	eventWrite: "universe.event:write",
	notifRead: "universe.notification-string:read",
	notifWrite: "universe.notification-string:write",
	analyticsRead: "universe.analytics:read",
	userNotify: "user.user-notification:write",
	legacyUniverse: "legacy-universe:manage",
	thumbRead: "universe.thumbnail:read",
	thumbWrite: "universe.thumbnail:write",
	passManage: "legacy-game-pass:manage",
	productManage: "legacy-developer-product:manage",
	badgeManage: "legacy-badge:manage",
	universeWrite: "universe:write",
	assetRead: "asset:read",
	assetWrite: "asset:write",
} as const;

// Shared ---------------------------------------------------------------------------------------------------------------

export type ImageState = "Approved" | "PendingReview" | "UnAvailable" | "Rejected" | "Error";

export function stateTone(state: string | undefined): "good" | "warning" | "critical" | "muted" {
	switch (state) {
		case "Approved":
		case "Active":
			return "good";
		case "PendingReview":
		case "Reviewing":
			return "warning";
		case "Rejected":
		case "Error":
		case "Spammy":
			return "critical";
		default:
			return "muted";
	}
}

/** "2026-11-20 18:30" (local time) -> ISO; null when it doesn't parse. */
export function parseLocalDateTime(text: string): string | null {
	const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*$/.exec(text);
	if (!m) return null;
	const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
	const date = new Date(y, mo - 1, d, h, mi);
	if (Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59) return null;
	return date.toISOString();
}

/** ISO -> "2026-11-20 18:30" in local time (the format parseLocalDateTime reads). */
export function toLocalDateTime(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const p2 = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function utf8Bytes(text: string): number {
	let n = 0;
	for (const ch of text) {
		const c = ch.codePointAt(0) ?? 0;
		n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
	}
	return n;
}

// Multipart uploads ----------------------------------------------------------------------------------------------------

/** An image picked on the device (React Native's FormData streams a {uri, name, type} part from disk). */
export interface ImageFile {
	uri: string;
	name: string;
	type: string;
	size: number | null;
}

/**
 * A multipart/form-data Open Cloud POST (requestJson only sends JSON). Same contract as OpenCloud.request: 30 s
 * deadline, HttpError with Roblox's message, ScopeError on 401 / 403. The key goes only into the x-api-key header for
 * apis.roblox.com (read from the OpenCloud instance's header builder, never stored or logged here).
 */
async function uploadForm<T>(cloud: OpenCloud, path: string, parts: [string, ImageFile][], scopes: string | string[]): Promise<T> {
	if (!parts.length) throw new Error("Pick an image first.");
	const form = new FormData();
	for (const [field, f] of parts) form.append(field, { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
	const where = `apis.roblox.com${path.split("?")[0]}`;
	const { signal, done } = deadline(DEFAULT_TIMEOUT_MS);
	let response: Response;
	try {
		const headers = { accept: "application/json", ...(cloud as unknown as { headers(): Record<string, string> })["headers"]() };
		response = await fetch(`${OPEN_CLOUD}${path}`, { method: "POST", headers, body: form, signal });
	} catch (error) {
		done();
		const reason = signal.aborted ? ((signal.reason as Error | undefined)?.message ?? "aborted") : (error as Error).message;
		throw new HttpError(0, `cannot reach ${where}: ${reason}`, where);
	}
	let text = "";
	try {
		text = await response.text();
	} finally {
		done();
	}
	let body: unknown = undefined;
	try {
		body = text ? JSON.parse(text) : undefined;
	} catch {
		body = undefined;
	}
	if (!response.ok) {
		const fallback = body === undefined && text && text.length < 300 && !text.trimStart().startsWith("<") ? text.trim() : undefined;
		const err = new HttpError(response.status, fallback ?? (typeof body === "string" && body ? body : errorMessage(body, response.status)), where, body);
		if (response.status === 401 || response.status === 403) throw new ScopeError(err, typeof scopes === "string" ? [scopes] : scopes);
		throw err;
	}
	return body as T;
}

// Virtual events -------------------------------------------------------------------------------------------------------

export type EventVisibility = "private" | "public" | "moderated";
export type FeaturingStatus = "enabled" | "disabled";

export const EVENT_CATEGORIES = [
	{ value: "activity", label: "Activity" },
	{ value: "challenge", label: "Challenge" },
	{ value: "contentUpdate", label: "Content update" },
	{ value: "earlyAccess", label: "Early access" },
	{ value: "expansion", label: "Expansion" },
	{ value: "festival", label: "Festival" },
	{ value: "itemDrop", label: "Item drop" },
	{ value: "locationUpdate", label: "Location update" },
	{ value: "moreLevels", label: "More levels" },
	{ value: "newContent", label: "New content" },
	{ value: "newFeature", label: "New feature" },
	{ value: "newLocation", label: "New location" },
	{ value: "newMap", label: "New map" },
	{ value: "newSeason", label: "New season" },
	{ value: "quest", label: "Quest" },
	{ value: "systemUpdate", label: "System update" },
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number]["value"];

export function categoryLabel(c: string): string {
	return EVENT_CATEGORIES.find((x) => x.value === c)?.label ?? c;
}

export interface GameEvent {
	id: string;
	title?: string | null;
	displayTitle?: string | null;
	subtitle?: string | null;
	description?: string | null;
	startTime?: string | null;
	endTime?: string | null;
	universeId?: number | null;
	placeId?: number | null;
	host?: { hostType: "user" | "group"; hostId: number; hostName?: string | null; hasVerifiedBadge?: boolean | null };
	visibility?: EventVisibility;
	featuringStatus?: FeaturingStatus;
	tagline?: string | null;
	categories?: { category: EventCategory; rank: number }[] | null;
	thumbnails?: { mediaId: number; rank: number }[] | null;
	allThumbnailsCreated?: boolean | null;
	createTime?: string | null;
	updateTime?: string | null;
}

export interface GameEventFields {
	title?: string;
	subtitle?: string;
	description?: string;
	startTime?: string;
	endTime?: string;
	visibility?: EventVisibility;
	placeId?: number;
	categories?: { category: EventCategory; rank: number }[];
	thumbnails?: { mediaId: number; rank: number }[];
	featuringStatus?: FeaturingStatus;
	tagline?: string;
}

/** `when` "upcoming" = upcoming and live (Roblox's default endsAfter = now); "past" = ended before now. */
export function listEvents(cloud: OpenCloud, universeId: number, params: { when: "upcoming" | "past"; pageToken?: string }) {
	const now = new Date().toISOString();
	return cloud.request<{ gameEvents?: GameEvent[] | null; nextPageToken?: string | null; previousPageToken?: string | null }>(
		"GET",
		`/virtual-events/v3/universes/${universeId}/game-events${qs({ pageSize: 25, pageToken: params.pageToken, ...(params.when === "past" ? { endsBefore: now } : { endsAfter: now }) })}`,
		undefined,
		undefined,
		ENG_SCOPES.eventRead,
	);
}

export function getEvent(cloud: OpenCloud, eventId: string) {
	return cloud.request<GameEvent>("GET", `/virtual-events/v3/game-events/${enc(eventId)}`, undefined, undefined, ENG_SCOPES.eventRead);
}

export function createEvent(cloud: OpenCloud, universeId: number, fields: GameEventFields & { title: string; subtitle: string; startTime: string; endTime: string; groupId?: number }) {
	return cloud.request<GameEvent>("POST", `/virtual-events/v3/universes/${universeId}/game-events`, fields, undefined, ENG_SCOPES.eventWrite);
}

export function updateEvent(cloud: OpenCloud, eventId: string, fields: GameEventFields) {
	return cloud.request<GameEvent>("PATCH", `/virtual-events/v3/game-events/${enc(eventId)}`, fields, undefined, ENG_SCOPES.eventWrite);
}

export function deleteEvent(cloud: OpenCloud, eventId: string) {
	return cloud.request<unknown>("DELETE", `/virtual-events/v3/game-events/${enc(eventId)}`, undefined, undefined, ENG_SCOPES.eventWrite);
}

// Notification strings -------------------------------------------------------------------------------------------------

export const NOTIFICATION_CONTENT_MAX = 99;
export const LAUNCH_DATA_MAX_BYTES = 200;

export interface NotificationString {
	id?: string | null;
	name?: string | null;
	content?: string | null;
}

const NOTIF = "/notifications/v1/developer-configuration";

export function listNotificationStrings(cloud: OpenCloud, universeId: number, cursor?: string) {
	return cloud.request<{ notificationStringConfigs?: NotificationString[] | null; nextPageCursor?: string | null; previousPageCursor?: string | null }>(
		"GET",
		`${NOTIF}/experience-notifications-list${qs({ UniverseId: universeId, Count: 50, Cursor: cursor })}`,
		undefined,
		undefined,
		ENG_SCOPES.notifRead,
	);
}

export function getNotificationString(cloud: OpenCloud, id: string) {
	return cloud.request<NotificationString>("GET", `${NOTIF}/experience-notification${qs({ Id: id })}`, undefined, undefined, ENG_SCOPES.notifRead);
}

export function createNotificationString(cloud: OpenCloud, universeId: number, name: string, content: string) {
	return cloud.request<{ id?: string | null }>("POST", `${NOTIF}/create-notification`, { name, content, universeId }, undefined, ENG_SCOPES.notifWrite);
}

export function updateNotificationString(cloud: OpenCloud, id: string, name: string, content: string) {
	return cloud.request<unknown>("POST", `${NOTIF}/update-notification`, { id, name, content }, undefined, ENG_SCOPES.notifWrite);
}

export function archiveNotificationString(cloud: OpenCloud, id: string) {
	return cloud.request<unknown>("POST", `${NOTIF}/archive-notification`, { id }, undefined, ENG_SCOPES.notifWrite);
}

/** The {parameter} names in a notification string ({experienceName} is filled in by Roblox). */
export function notificationParams(content: string): string[] {
	const out = new Set<string>();
	for (const m of content.matchAll(/\{([A-Za-z0-9_-]+)\}/g)) if (m[1] && m[1] !== "experienceName") out.add(m[1]);
	return [...out];
}

export function validateNotification(name: string, content: string): string | null {
	if (!name.trim()) return "Give the notification string a name.";
	if (!content.trim()) return "Write the notification text.";
	if (content.length > NOTIFICATION_CONTENT_MAX) return `The text is ${content.length} characters; Roblox allows ${NOTIFICATION_CONTENT_MAX}.`;
	if ((content.match(/\{/g) ?? []).length !== (content.match(/\}/g) ?? []).length) return "A { has no matching } (parameters look like {name}).";
	return null;
}

export interface NotificationAnalytics {
	overview?: Record<string, unknown> | null;
	campaigns?: Record<string, unknown>[] | null;
}

export function notificationAnalytics(cloud: OpenCloud, universeId: number, start: string, end: string) {
	return cloud.request<NotificationAnalytics>(
		"GET",
		`/notifications/v1/developer-analytics/get-notifs-analytics${qs({ UniverseId: universeId, AggregationStartDateTime: start, AggregationEndDateTime: end })}`,
		undefined,
		undefined,
		ENG_SCOPES.analyticsRead,
	);
}

export interface UserNotificationInput {
	userId: number;
	universeId: number;
	messageId: string;
	parameters: Record<string, string>;
	launchData?: string;
	category?: string;
}

/**
 * A `{userId-…}` parameter takes a user id (ParameterValue.int64Value; Roblox renders it as that user's name, as in
 * the docs' Luau example `{int64Value = 3702832553}`); every other parameter is a stringValue.
 */
export function isUserIdParam(name: string): boolean {
	return /^userId-/i.test(name);
}

/** Create User Notification (sends a real notification to a player who opted in). */
export function sendUserNotification(cloud: OpenCloud, input: UserNotificationInput) {
	const parameters: Record<string, { stringValue: string } | { int64Value: number }> = {};
	for (const [k, v] of Object.entries(input.parameters)) {
		if (isUserIdParam(k)) {
			const id = v.trim();
			if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error(`{${k}} takes a user id (digits only).`);
			parameters[k] = { int64Value: Number(id) };
		} else parameters[k] = { stringValue: v };
	}
	const payload: Record<string, unknown> = { type: "MOMENT", messageId: input.messageId, parameters };
	if (input.launchData) payload.joinExperience = { launchData: input.launchData };
	if (input.category) payload.analyticsData = { category: input.category };
	return cloud.request<{ path?: string; id?: string }>("POST", `/cloud/v2/users/${input.userId}/notifications`, { source: { universe: `universes/${input.universeId}` }, payload }, undefined, ENG_SCOPES.userNotify);
}

// Experience media (public) --------------------------------------------------------------------------------------------

export interface GameMedia {
	assetTypeId?: number;
	/** "Image" | "YouTubeVideo" | … */
	assetType?: string;
	imageId?: number;
	videoHash?: string | null;
	videoTitle?: string | null;
	approved?: boolean;
	altText?: string | null;
	videoId?: string | null;
}

/** games v2 media: every thumbnail and video of the experience, with approval state and alt text. */
export async function gameMedia(universeId: number): Promise<GameMedia[]> {
	const r = await requestJson<{ data?: GameMedia[] }>(`https://games.roblox.com/v2/games/${universeId}/media${qs({ fetchAllExperienceRelatedMedia: false })}`);
	return r.data ?? [];
}

/** Thumbnail id -> image URL (thumbnails v1 games/{u}/thumbnails). */
export async function gameThumbnailUrls(universeId: number, thumbnailIds: number[], size = "768x432"): Promise<Record<number, string>> {
	const ids = Array.from(new Set(thumbnailIds.filter((n) => n > 0)));
	if (!ids.length) return {};
	const pages = await mapLimit(chunk(ids, 50), 2, (b) =>
		requestJson<{ data?: { targetId: number; state: string; imageUrl: string | null }[] }>(
			`https://thumbnails.roblox.com/v1/games/${universeId}/thumbnails${qs({ thumbnailIds: b.join(","), size, format: "Png", isCircular: false })}`,
		),
	);
	const out: Record<number, string> = {};
	for (const p of pages) for (const t of p.data ?? []) if (t.imageUrl) out[t.targetId] = t.imageUrl;
	return out;
}

// Localized thumbnails and icons -----------------------------------------------------------------------------------------

export interface LocalizedThumbnails {
	languageCode: string;
	mediaAssets: { mediaAssetId: string; mediaAssetAltText?: string; state?: ImageState; mediaAssetUrl?: string }[];
}

/** Every language's thumbnail set (public). */
export async function localizedThumbnails(universeId: number): Promise<LocalizedThumbnails[]> {
	const r = await requestJson<{ data?: LocalizedThumbnails[] }>(`https://gameinternationalization.roblox.com/v1/game-thumbnails/games/${universeId}/images${qs({ width: 768, height: 432 })}`);
	return r.data ?? [];
}

const GI = "/legacy-game-internationalization/v1";

export function setThumbnailAltText(cloud: OpenCloud, universeId: number, languageCode: string, thumbnailId: number, altText: string) {
	return cloud.request<unknown>("POST", `${GI}/game-thumbnails/games/${universeId}/language-codes/${enc(languageCode)}/alt-text`, { thumbnailId, altText }, undefined, ENG_SCOPES.legacyUniverse);
}

export function orderThumbnails(cloud: OpenCloud, universeId: number, languageCode: string, mediaAssetIds: number[]) {
	return cloud.request<unknown>("POST", `${GI}/game-thumbnails/games/${universeId}/language-codes/${enc(languageCode)}/images/order`, { mediaAssetIds }, undefined, ENG_SCOPES.legacyUniverse);
}

/** Adds an image to a (non-source) language's thumbnail set. */
export function uploadThumbnail(cloud: OpenCloud, universeId: number, languageCode: string, file: ImageFile) {
	return uploadForm<{ mediaAssetId?: string }>(cloud, `${GI}/game-thumbnails/games/${universeId}/language-codes/${enc(languageCode)}/image`, [["Files", file]], ENG_SCOPES.legacyUniverse);
}

export function deleteThumbnail(cloud: OpenCloud, universeId: number, languageCode: string, imageId: number) {
	return cloud.request<unknown>("DELETE", `${GI}/game-thumbnails/games/${universeId}/language-codes/${enc(languageCode)}/images/${imageId}`, undefined, undefined, ENG_SCOPES.legacyUniverse);
}

export interface LocalizedIcon {
	imageId: string;
	imageUrl: string;
	state: ImageState;
	languageCode: string;
}

export async function gameIconsByLanguage(cloud: OpenCloud, universeId: number): Promise<LocalizedIcon[]> {
	const r = await cloud.request<{ data?: LocalizedIcon[] }>("GET", `${GI}/game-icon/games/${universeId}${qs({ width: 150, height: 150 })}`, undefined, undefined, ENG_SCOPES.legacyUniverse);
	return r.data ?? [];
}

/** Sets a (non-source) language's icon. */
export function uploadGameIcon(cloud: OpenCloud, universeId: number, languageCode: string, file: ImageFile) {
	return uploadForm<unknown>(cloud, `${GI}/game-icon/games/${universeId}/language-codes/${enc(languageCode)}`, [["Files", file]], ENG_SCOPES.legacyUniverse);
}

export function deleteGameIcon(cloud: OpenCloud, universeId: number, languageCode: string) {
	return cloud.request<unknown>("DELETE", `${GI}/game-icon/games/${universeId}/language-codes/${enc(languageCode)}`, undefined, undefined, ENG_SCOPES.legacyUniverse);
}

// Thumbnail personalization ----------------------------------------------------------------------------------------------

export interface HomepageThumbnail {
	homepageThumbnailId: string;
	assetId: number;
	moderationStatus: "Reviewing" | "Rejected" | "Approved" | "Unspecified";
	personalizedConfigStatus: "Active" | "Inactive";
	homepageThumbnailStatus: "Active" | "Spammy";
}

export interface PersonalizedConfig {
	id: string;
	personalizedConfigStatus: "Active" | "Inactive";
	createdUtc: string;
	thumbnails: { homepageThumbnailId: string; assetId: number; personalizedThumbnailStatus: "Active" | "Inactive"; homepageThumbnailStatus: "Active" | "Spammy" }[];
	lastServedUtc?: string | null;
}

export const PERSONALIZATION_MAX = 5;
const TP = (universeId: number) => `/thumbnail-personalization-api/v1/universes/${universeId}`;

export function homepageThumbnails(cloud: OpenCloud, universeId: number, nextCursor?: string) {
	return cloud.request<{ homepageThumbnails: HomepageThumbnail[]; nextCursor?: string | null }>("GET", `${TP(universeId)}/thumbnails${qs({ limit: 50, nextCursor })}`, undefined, undefined, ENG_SCOPES.thumbRead);
}

export function deleteHomepageThumbnails(cloud: OpenCloud, universeId: number, ids: string[]) {
	if (!ids.length) throw new Error("Pick at least one thumbnail.");
	const query = ids.map((id) => `homepageThumbnailIds=${enc(id)}`).join("&");
	return cloud.request<Record<string, boolean>>("DELETE", `${TP(universeId)}/thumbnails?${query}`, undefined, undefined, ENG_SCOPES.thumbWrite);
}

/** Uploads images to the homepage pool; answers file name -> operation id (null when Roblox refused that file). */
export async function uploadHomepageThumbnails(cloud: OpenCloud, universeId: number, files: ImageFile[]) {
	const r = await uploadForm<{ fileToOperationIdDict?: Record<string, string | null> }>(cloud, `${TP(universeId)}/thumbnails/uploads`, files.map((f): [string, ImageFile] => ["files", f]), ENG_SCOPES.thumbWrite);
	return r?.fileToOperationIdDict ?? {};
}

export interface UploadThumbnailStatus {
	homepageThumbnailId?: string | null;
	assetId?: number;
	moderationStatus?: HomepageThumbnail["moderationStatus"];
}

export function homepageUploadStatus(cloud: OpenCloud, universeId: number, operationIds: string[]) {
	if (!operationIds.length) throw new Error("No uploads to check.");
	const query = operationIds.map((id) => `operationIds=${enc(id)}`).join("&");
	return cloud.request<{ uploadStatus: number; uploadThumbnailStatusDict: Record<string, UploadThumbnailStatus> }>("GET", `${TP(universeId)}/thumbnails/uploads/status?${query}`, undefined, undefined, ENG_SCOPES.thumbRead);
}

/** Polls the upload status until every operation finished, at most `maxPolls` times; answers what finished. */
export async function waitForHomepageUploads(cloud: OpenCloud, universeId: number, operationIds: string[], options: { maxPolls?: number; pollMs?: number } = {}) {
	let last: Record<string, UploadThumbnailStatus> = {};
	for (let polls = 0; polls < (options.maxPolls ?? 10); polls++) {
		await sleep(options.pollMs ?? 2000);
		last = (await homepageUploadStatus(cloud, universeId, operationIds)).uploadThumbnailStatusDict ?? {};
		if (operationIds.every((id) => last[id])) return { done: true, finished: last };
	}
	return { done: false, finished: last };
}

export function personalizedConfigs(cloud: OpenCloud, universeId: number, status: "Active" | "Inactive", cursor?: string) {
	return cloud.request<{ personalizedConfigs: PersonalizedConfig[]; nextCursor?: string | null }>("GET", `${TP(universeId)}/personalization${qs({ status, limit: 25, cursor })}`, undefined, undefined, ENG_SCOPES.thumbRead);
}

function checkPool(ids: string[]) {
	if (!ids.length) throw new Error("Pick at least one thumbnail.");
	if (ids.length > PERSONALIZATION_MAX) throw new Error(`Up to ${PERSONALIZATION_MAX} thumbnails.`);
}

export function createPersonalizedConfig(cloud: OpenCloud, universeId: number, homepageThumbnailIds: string[]) {
	checkPool(homepageThumbnailIds);
	return cloud.request<string>("POST", `${TP(universeId)}/personalization/create`, { homepageThumbnailIds }, undefined, ENG_SCOPES.thumbWrite);
}

export function updatePersonalizedConfig(cloud: OpenCloud, universeId: number, id: string, homepageThumbnailIds: string[]) {
	checkPool(homepageThumbnailIds);
	return cloud.request<string>("POST", `${TP(universeId)}/personalization/update`, { id, homepageThumbnailIds }, undefined, ENG_SCOPES.thumbWrite);
}

// Languages ------------------------------------------------------------------------------------------------------------

const GI_PUBLIC = "https://gameinternationalization.roblox.com";

export interface SupportedLanguage {
	name: string;
	languageCodeType: "Language" | "Locale";
	languageCode: string;
}

export async function supportedLanguages(universeId: number): Promise<SupportedLanguage[]> {
	const r = await requestJson<{ data?: SupportedLanguage[] }>(`${GI_PUBLIC}/v1/supported-languages/games/${universeId}`);
	return r.data ?? [];
}

export function sourceLanguage(universeId: number) {
	return requestJson<{ name: string; nativeName: string; languageCode: string }>(`${GI_PUBLIC}/v1/source-language/games/${universeId}`);
}

export interface CreatorLocale {
	locale: { id: number; locale: string; name: string; nativeName: string; language: { id: number; name: string; nativeName: string; languageCode: string; isRightToLeft: boolean } };
	isEnabledForFullExperience: boolean;
}

/** The languages a creator can add (locale v1, public). Unique by language code. */
export async function creatorLanguages(): Promise<{ languageCode: string; name: string; nativeName: string }[]> {
	const r = await requestJson<{ data?: CreatorLocale[] }>(`https://locale.roblox.com/v1/locales/supported-locales-for-creators`);
	const seen = new Map<string, { languageCode: string; name: string; nativeName: string }>();
	for (const l of r.data ?? []) {
		const lang = l.locale?.language;
		if (lang?.languageCode && !seen.has(lang.languageCode)) seen.set(lang.languageCode, { languageCode: lang.languageCode, name: lang.name, nativeName: lang.nativeName });
	}
	return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function editSupportedLanguages(cloud: OpenCloud, universeId: number, changes: { languageCode: string; languageCodeType?: "Language" | "Locale"; delete: boolean }[]) {
	return cloud.request<unknown>(
		"PATCH",
		`${GI}/supported-languages/games/${universeId}`,
		changes.map((c) => ({ languageCodeType: c.languageCodeType ?? "Language", languageCode: c.languageCode, delete: c.delete })),
		undefined,
		ENG_SCOPES.legacyUniverse,
	);
}

export function setSourceLanguage(cloud: OpenCloud, universeId: number, languageCode: string) {
	return cloud.request<unknown>("PATCH", `${GI}/source-language/games/${universeId}${qs({ languageCode })}`, undefined, undefined, ENG_SCOPES.legacyUniverse);
}

export interface AutoTranslationStatus {
	languageCodeType?: "Language" | "Locale";
	languageCode: string;
	isAutomaticTranslationEnabled: boolean;
	isImageTranslationEnabled?: boolean;
}

export async function automaticTranslationStatus(cloud: OpenCloud, universeId: number): Promise<AutoTranslationStatus[]> {
	const r = await cloud.request<{ data?: AutoTranslationStatus[] }>("GET", `${GI}/supported-languages/games/${universeId}/automatic-translation-status`, undefined, undefined, ENG_SCOPES.legacyUniverse);
	return r.data ?? [];
}

export async function displayInfoAutoTranslation(cloud: OpenCloud, universeId: number): Promise<{ languageCode: string; isUniverseDisplayInfoAutomaticTranslationEnabled: boolean }[]> {
	const r = await cloud.request<{ data?: { languageCode: string; isUniverseDisplayInfoAutomaticTranslationEnabled: boolean }[] }>(
		"GET",
		`${GI}/supported-languages/games/${universeId}/universe-display-info-automatic-translation-settings`,
		undefined,
		undefined,
		ENG_SCOPES.legacyUniverse,
	);
	return r.data ?? [];
}

export type TranslationSwitch = "automatic-translation-status" | "image-translation-status" | "universe-display-info-automatic-translation-settings";

/** One per-language switch; the body is a bare JSON boolean. */
export function setTranslationSwitch(cloud: OpenCloud, universeId: number, languageCode: string, which: TranslationSwitch, enabled: boolean) {
	return cloud.request<unknown>("PATCH", `${GI}/supported-languages/games/${universeId}/languages/${enc(languageCode)}/${which}`, enabled, undefined, ENG_SCOPES.legacyUniverse);
}

// Name and description -----------------------------------------------------------------------------------------------------

export interface NameDescription {
	name: string;
	description: string;
	updateType?: "Invalid" | "Name" | "Description";
	languageCode: string;
}

export const EXPERIENCE_NAME_MAX = 50;
export const EXPERIENCE_DESCRIPTION_MAX = 1000;

export async function experienceNameDescriptions(universeId: number): Promise<NameDescription[]> {
	const r = await requestJson<{ data?: NameDescription[] }>(`${GI_PUBLIC}/v1/name-description/games/${universeId}`);
	return r.data ?? [];
}

/** Names / descriptions per language; one entry per field (updateType Name or Description). */
export function updateExperienceNameDescription(cloud: OpenCloud, universeId: number, languageCode: string, fields: { name?: string; description?: string }) {
	const data: NameDescription[] = [];
	if (fields.name !== undefined) data.push({ name: fields.name, description: "", updateType: "Name", languageCode });
	if (fields.description !== undefined) data.push({ name: "", description: fields.description, updateType: "Description", languageCode });
	if (!data.length) throw new Error("Nothing to update.");
	return cloud.request<{ successOperations?: NameDescription[]; failedOperations?: { languageCode: string; errorCode: number }[] }>(
		"PATCH",
		`${GI}/name-description/games/${universeId}`,
		{ data },
		undefined,
		ENG_SCOPES.legacyUniverse,
	);
}

export type HistoryContentType =
	| "UniverseDisplayNames"
	| "UniverseDisplayDescriptions"
	| "BadgeDisplayName"
	| "BadgeDisplayDescription"
	| "DeveloperProductDisplayName"
	| "DeveloperProductDisplayDescription"
	| "GamePassDisplayName"
	| "GamePassDisplayDescription";

export interface TranslationHistoryItem {
	translationText: string;
	translator?: { id: number; agentType: "User" | "Automation" };
	created: string;
}

/** Translation history of a name / description (count 1-49). The scope is legacy-universe:manage for every type. */
export function nameDescriptionHistory(cloud: OpenCloud, params: { contentId: number; contentType: HistoryContentType; languageCode: string; cursor?: string; count?: number }) {
	return cloud.request<{ history?: TranslationHistoryItem[]; lastEvaluatedId?: string | null }>(
		"POST",
		`${GI}/name-description/games/translation-history`,
		{ contentId: params.contentId, contentType: params.contentType, languageCode: params.languageCode, cursor: params.cursor, count: params.count ?? 25, sortOrder: "Desc" },
		undefined,
		ENG_SCOPES.legacyUniverse,
	);
}

// Passes, products and badges ----------------------------------------------------------------------------------------------

export type ItemKind = "game-passes" | "developer-products" | "badges";

export const ITEM_KINDS: { value: ItemKind; label: string; scope: string; nameHistory: HistoryContentType; descriptionHistory: HistoryContentType }[] = [
	{ value: "game-passes", label: "Passes", scope: ENG_SCOPES.passManage, nameHistory: "GamePassDisplayName", descriptionHistory: "GamePassDisplayDescription" },
	{ value: "developer-products", label: "Products", scope: ENG_SCOPES.productManage, nameHistory: "DeveloperProductDisplayName", descriptionHistory: "DeveloperProductDisplayDescription" },
	{ value: "badges", label: "Badges", scope: ENG_SCOPES.badgeManage, nameHistory: "BadgeDisplayName", descriptionHistory: "BadgeDisplayDescription" },
];

export function itemScope(kind: ItemKind): string {
	return ITEM_KINDS.find((k) => k.value === kind)!.scope;
}

export async function itemNameDescriptions(cloud: OpenCloud, kind: ItemKind, id: number): Promise<NameDescription[]> {
	const r = await cloud.request<{ data?: NameDescription[] }>("GET", `${GI}/${kind}/${id}/name-description`, undefined, undefined, itemScope(kind));
	return r.data ?? [];
}

export function updateItemNameDescription(cloud: OpenCloud, kind: ItemKind, id: number, languageCode: string, fields: { name: string; description: string }) {
	return cloud.request<{ name?: string; description?: string }>("PATCH", `${GI}/${kind}/${id}/name-description/language-codes/${enc(languageCode)}`, fields, undefined, itemScope(kind));
}

export function deleteItemNameDescription(cloud: OpenCloud, kind: ItemKind, id: number, languageCode: string) {
	return cloud.request<unknown>("DELETE", `${GI}/${kind}/${id}/name-description/language-codes/${enc(languageCode)}`, undefined, undefined, itemScope(kind));
}

export async function itemIcons(cloud: OpenCloud, kind: ItemKind, id: number): Promise<LocalizedIcon[]> {
	const r = await cloud.request<{ data?: LocalizedIcon[] }>("GET", `${GI}/${kind}/${id}/icons${qs({ width: 150, height: 150 })}`, undefined, undefined, itemScope(kind));
	return r.data ?? [];
}

/** Sets a pass / product / badge icon for a (non-source) language. */
export function uploadItemIcon(cloud: OpenCloud, kind: ItemKind, id: number, languageCode: string, file: ImageFile) {
	return uploadForm<unknown>(cloud, `${GI}/${kind}/${id}/icons/language-codes/${enc(languageCode)}`, [["Files", file]], itemScope(kind));
}

export function deleteItemIcon(cloud: OpenCloud, kind: ItemKind, id: number, languageCode: string) {
	return cloud.request<unknown>("DELETE", `${GI}/${kind}/${id}/icons/language-codes/${enc(languageCode)}`, undefined, undefined, itemScope(kind));
}

// Auto-localization table --------------------------------------------------------------------------------------------------

const LT = "/legacy-localization-tables/v1";

export interface AutoLocalizationSettings {
	isAutolocalizationEnabled?: boolean;
	isAutomaticEntriesSettingEnabled?: boolean;
	isAutomaticEntriesDeletionEnabled?: boolean;
	shouldUseLocalizationTable?: boolean;
	autoLocalizationTableId?: string;
	sourceLanguage?: string;
	assetId?: number;
	shouldUseImageLocalizationTable?: boolean;
	isAutoLocalizationForImageEnabled?: boolean;
}

/** May create the auto-localization table when the experience has none (Roblox's only way to read it with a key). */
export function autoLocalizationTable(cloud: OpenCloud, universeId: number) {
	return cloud.request<AutoLocalizationSettings>("POST", `${LT}/autolocalization/games/${universeId}/autolocalizationtable`, undefined, undefined, ENG_SCOPES.legacyUniverse);
}

export interface AutoLocalizationPatch {
	isAutolocalizationEnabled: boolean;
	isAutomaticEntriesSettingEnabled: boolean;
	/** Note the PATCH spells it "Deletions" while the read says "Deletion". */
	isAutomaticEntriesDeletionsEnabled: boolean;
	shouldUseLocalizationTable: boolean;
	shouldUseImageLocalizationTable: boolean;
	isAutoLocalizationForImageEnabled: boolean;
}

export function setAutoLocalizationSettings(cloud: OpenCloud, universeId: number, settings: AutoLocalizationPatch) {
	if (settings.isAutomaticEntriesSettingEnabled && !settings.isAutolocalizationEnabled) throw new Error("Capturing entries automatically needs automatic text capture (auto-localization) on.");
	return cloud.request<unknown>("PATCH", `${LT}/autolocalization/games/${universeId}/settings`, settings, undefined, ENG_SCOPES.legacyUniverse);
}

export function localizationTable(cloud: OpenCloud, tableId: string) {
	return cloud.request<{ id: string; name: string; ownerType: "User" | "Group"; ownerId: number; assetId: number }>("GET", `${LT}/localization-table/tables/${enc(tableId)}`, undefined, undefined, ENG_SCOPES.legacyUniverse);
}

export function localizationTableCount(cloud: OpenCloud, tableId: string, universeId: number) {
	return cloud.request<{ id: string; entryCount: number }>("GET", `${LT}/localization-table/tables/${enc(tableId)}/entry-count${qs({ gameId: universeId })}`, undefined, undefined, ENG_SCOPES.legacyUniverse);
}

export function localizationLimits(cloud: OpenCloud) {
	return cloud.request<{
		entryOperationLimits?: { maxContextLength?: number; maxKeyLength?: number; maxSourceLength?: number; maxExampleLength?: number; maxGameLocationPathLength?: number };
		tableOperationLimits?: { maxEntriesPerUpdate?: number };
	}>("GET", `${LT}/localization-table/limits`, undefined, undefined, ENG_SCOPES.legacyUniverse);
}

export interface EntryIdentifier {
	key?: string | null;
	context?: string | null;
	source?: string | null;
	entryFormat?: "Invalid" | "Legacy" | "Icu";
}

export interface TableEntry {
	identifier: EntryIdentifier;
	metadata?: { example?: string | null; gameLocations?: { path: string }[]; entryFormat?: string };
	translations?: { locale: string; translationText: string; translator?: { id: number; agentType: "User" | "Automation" }; updatedTime?: string; feedbackCount?: number }[];
	createdTime?: string;
}

export function localizationEntries(cloud: OpenCloud, tableId: string, universeId: number, cursor?: string) {
	return cloud.request<{ data?: TableEntry[]; nextPageCursor?: string | null; previousPageCursor?: string | null }>(
		"GET",
		`${LT}/localization-table/tables/${enc(tableId)}/entries${qs({ cursor, gameId: universeId })}`,
		undefined,
		undefined,
		ENG_SCOPES.legacyUniverse,
	);
}

export interface EntryPatch {
	identifier: EntryIdentifier;
	translations?: { locale: string; translationText?: string; delete?: boolean }[];
	delete?: boolean;
}

export function patchLocalizationTable(cloud: OpenCloud, tableId: string, universeId: number, entries: EntryPatch[]) {
	return cloud.request<{ failedEntriesAndTranslations?: { error?: { errorCode: number; errorMessage: string }; identifier: EntryIdentifier }[]; modifiedEntriesAndTranslations?: unknown[] }>(
		"PATCH",
		`${LT}/localization-table/tables/${enc(tableId)}${qs({ gameId: universeId })}`,
		{ entries },
		undefined,
		ENG_SCOPES.legacyUniverse,
	);
}

export function entryTranslationHistory(cloud: OpenCloud, tableId: string, universeId: number, locale: string, identifier: EntryIdentifier, cursor?: string) {
	return cloud.request<{ entries?: { identifier: EntryIdentifier; history?: TranslationHistoryItem[]; nextCursor?: string | null }[]; failedEntries?: { error?: { errorMessage: string } }[] }>(
		"POST",
		`${LT}/localization-table/tables/${enc(tableId)}/entries/translation-history${qs({ gameId: universeId })}`,
		{ locale, entries: [{ identifier, cursor, count: 25, sortOrder: "Desc" }], sourceType: "Text" },
		undefined,
		ENG_SCOPES.legacyUniverse,
	);
}

// Translate text and text to speech ----------------------------------------------------------------------------------------

/** The languages translateText supports (from the OpenAPI document). */
export const TRANSLATE_LANGUAGES = [
	{ value: "en-us", label: "English" },
	{ value: "fr-fr", label: "French" },
	{ value: "de-de", label: "German" },
	{ value: "es-es", label: "Spanish" },
	{ value: "pt-br", label: "Portuguese" },
	{ value: "it-it", label: "Italian" },
	{ value: "pl-pl", label: "Polish" },
	{ value: "tr-tr", label: "Turkish" },
	{ value: "ru-ru", label: "Russian" },
	{ value: "ja-jp", label: "Japanese" },
	{ value: "ko-kr", label: "Korean" },
	{ value: "zh-cn", label: "Chinese (Simplified)" },
	{ value: "zh-tw", label: "Chinese (Traditional)" },
	{ value: "th-th", label: "Thai" },
	{ value: "vi-vn", label: "Vietnamese" },
	{ value: "id-id", label: "Indonesian" },
] as const;

export function translateText(cloud: OpenCloud, universeId: number, text: string, targetLanguageCodes: string[], sourceLanguageCode?: string) {
	if (!text.trim()) throw new Error("Write some text to translate.");
	if (!targetLanguageCodes.length) throw new Error("Pick at least one language.");
	return cloud.request<{ sourceLanguageCode?: string; translations?: Record<string, string> }>(
		"POST",
		`/cloud/v2/universes/${universeId}:translateText`,
		{ text, ...(sourceLanguageCode ? { sourceLanguageCode } : {}), targetLanguageCodes },
		undefined,
		ENG_SCOPES.universeWrite,
	);
}

export interface SpeechResult {
	assetId: string;
	remainingQuota?: number;
}

/**
 * Generates an English speech audio asset (creates an asset on the key owner's account) and polls the operation
 * at most `maxPolls` times.
 */
export async function generateSpeechAsset(
	cloud: OpenCloud,
	universeId: number,
	input: { text: string; voiceId?: string; pitch?: number; speed?: number },
	options: { maxPolls?: number; pollMs?: number } = {},
): Promise<SpeechResult> {
	const speechStyle: Record<string, unknown> = {};
	if (input.voiceId) speechStyle.voiceId = input.voiceId;
	if (input.pitch !== undefined) speechStyle.pitch = input.pitch;
	if (input.speed !== undefined) speechStyle.speed = input.speed;
	let op = await cloud.request<{ path?: string; done?: boolean; error?: { code?: number | string; message?: string }; response?: Record<string, unknown> }>(
		"POST",
		`/cloud/v2/universes/${universeId}:generateSpeechAsset`,
		{ text: input.text, ...(Object.keys(speechStyle).length ? { speechStyle } : {}) },
		undefined,
		[ENG_SCOPES.universeWrite, ENG_SCOPES.assetRead, ENG_SCOPES.assetWrite],
	);
	const maxPolls = options.maxPolls ?? 15;
	for (let polls = 0; op.done !== true; polls++) {
		if (polls >= maxPolls) throw new Error("The speech asset is still being made; look for it in your Creator Hub audio later.");
		const id = /operations\/([A-Za-z0-9_-]+)$/.exec(op.path ?? "")?.[1];
		if (!id) throw new Error("Roblox gave no operation to wait for.");
		await sleep(options.pollMs ?? 1500);
		op = await cloud.request("GET", `/assets/v1/operations/${enc(id)}`, undefined, undefined, ENG_SCOPES.assetWrite);
	}
	if (op.error && (op.error.message || op.error.code)) throw new Error(`Speech generation failed: ${op.error.message ?? op.error.code}`);
	const r = op.response ?? {};
	const assetId = r.assetId ?? (typeof r.path === "string" ? /(\d+)$/.exec(r.path)?.[1] : undefined);
	if (!assetId) throw new Error("The operation finished without an asset id.");
	return { assetId: String(assetId), remainingQuota: typeof r.remainingQuota === "number" ? r.remainingQuota : undefined };
}
