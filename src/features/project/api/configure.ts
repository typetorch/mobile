/**
 * Creator Hub "Configure" calls beyond src/api/opencloud.ts: universe settings (PATCH with an updateMask), root place /
 * place edits, activate / deactivate, permissions, place version history and notes, asset rollback, Team Create,
 * Team Test, the group audit log, followings, Luau execution tasks and place instances (long-running operations).
 *
 * Checked against Roblox's OpenAPI document (2026-11): paths, casing, query names and x-roblox-scopes. Notes from it
 * that shape the code:
 *   - PATCH /cloud/v2/universes/{id}: updateMask is a comma-separated list of camelCase fields. A field named in the
 *     mask but left out of the body is cleared (how a social link is removed and private servers are turned off).
 *     displayName / description are readOnly there: they change through the ROOT place's PATCH.
 *   - PATCH .../places/{placeId} answers 409 while the place is open in an active Team Create session.
 *   - place-version-history pages with cursor / nextCursor + hasMore (not pageToken).
 *   - legacy-develop / legacy-groups page with limit (10|25|50|100) / cursor.
 *   - Luau tasks: create (5 / min) returns the task with its `path`; GET `/cloud/v2/<path>` (200 / min) until the
 *     state is COMPLETE | FAILED | CANCELLED; logs at `<path>/logs` (45 / min).
 *   - Instances (BETA, 45 / min): GET, :listChildren and PATCH all answer an Operation; poll `/cloud/v2/<operation path>`
 *     until done. Only Script / LocalScript / ModuleScript can be read and updated; 200 KB request bodies.
 *   - Followings status answers PascalCase fields.
 *   - Place publishing: POST /universes/v1/{universeId}/places/{placeId}/versions?versionType=Published|Saved, the
 *     raw .rbxl (application/octet-stream) or .rbxlx (application/xml) bytes as the body, universe-places:write,
 *     x-roblox-size-limit 10485760 bytes, 30 / min. 200 answers text/plain `{"versionNumber":7}`; 409 = the place
 *     isn't in that universe.
 *   - Luau binary input: POST /cloud/v2/universes/{universe_id}/luau-execution-session-task-binary-inputs { size }
 *     (5 / min) answers { path, size, uploadUri }; the object (up to 100 MiB) goes to the presigned uploadUri, which
 *     is valid 15 min. The doc doesn't name the upload's method: Roblox's own rocale-cli PUTs the bytes with
 *     content-type application/octet-stream and no API key (presigned), and so does the app. The task then takes
 *     `binaryInput: <path>`; the script reads it as ({...})[1].BinaryInput (a buffer).
 */
import { FileMode, type File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";

import { deadline, errorMessage, HttpError, qs, requestJson } from "@/api/http";
import { OPEN_CLOUD, ScopeError, type CloudPlace, type CloudUniverse, type OpenCloud } from "@/api/opencloud";

const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// Scopes (x-roblox-scopes) ---------------------------------------------------------------------------------------------

export const SCOPES = {
	universeWrite: "universe:write",
	placeRead: "universe.place:read",
	placeWrite: "universe.place:write",
	legacyUniverse: "legacy-universe:manage",
	team: "legacy-team-collaboration:manage",
	groupAudit: "legacy-group:manage",
	followRead: "legacy-universe.following:read",
	followWrite: "legacy-universe.following:write",
	luauWrite: "universe.place.luau-execution-session:write",
	luauRead: "universe.place.luau-execution-session:read",
	instanceRead: "universe.place.instance:read",
	instanceWrite: "universe.place.instance:write",
	assetWrite: "asset:write",
	restrictionRead: "universe.user-restriction:read",
	restrictionWrite: "universe.user-restriction:write",
	placePublish: "universe-places:write",
} as const;

// Public games v1 ------------------------------------------------------------------------------------------------------

/** GET games.roblox.com/v1/games: the fields the Overview shows (everything else is in roblox-public's GameDetail). */
export interface GameDetailFull {
	id: number;
	rootPlaceId: number;
	name: string;
	description: string | null;
	sourceName?: string | null;
	sourceDescription?: string | null;
	price: number | null;
	copyingAllowed?: boolean;
	maxPlayers?: number;
	studioAccessToApisAllowed?: boolean;
	createVipServersAllowed?: boolean;
	/** 1 MorphToR6, 2 MorphToR15, 3 PlayerChoice */
	universeAvatarType?: number | string;
	genre?: string;
	genre_l1?: string;
	genre_l2?: string;
	isAllGenre?: boolean;
	isGenreEnforced?: boolean;
	isContentRestricted?: boolean;
}

export async function gameDetailFull(universeId: number): Promise<GameDetailFull | null> {
	const r = await requestJson<{ data?: GameDetailFull[] }>(`https://games.roblox.com/v1/games${qs({ universeIds: universeId })}`);
	return r.data?.[0] ?? null;
}

export function avatarTypeLabel(t: number | string | undefined): string {
	switch (String(t)) {
		case "1":
		case "MorphToR6":
			return "R6";
		case "2":
		case "MorphToR15":
			return "R15";
		case "3":
		case "PlayerChoice":
			return "Player choice";
		default:
			return t === undefined ? "–" : String(t);
	}
}

// Universe -------------------------------------------------------------------------------------------------------------

export interface SocialLink {
	title?: string;
	uri?: string;
}

export const SOCIAL_FIELDS = [
	{ field: "discordSocialLink", label: "Discord" },
	{ field: "youtubeSocialLink", label: "YouTube" },
	{ field: "twitterSocialLink", label: "X (Twitter)" },
	{ field: "twitchSocialLink", label: "Twitch" },
	{ field: "facebookSocialLink", label: "Facebook" },
	{ field: "guildedSocialLink", label: "Guilded" },
	{ field: "robloxGroupSocialLink", label: "Roblox group" },
] as const;

export type SocialField = (typeof SOCIAL_FIELDS)[number]["field"];

export type UniverseFull = CloudUniverse & Partial<Record<SocialField, SocialLink>>;

export type DeviceField = "desktopEnabled" | "mobileEnabled" | "tabletEnabled" | "consoleEnabled" | "vrEnabled";

/** The universe fields the PATCH can change (Universe schema minus the readOnly / immutable ones). */
export type UniversePatch = Partial<Record<DeviceField | "voiceChatEnabled", boolean>> & {
	privateServerPriceRobux?: number;
} & Partial<Record<SocialField, SocialLink>>;

export function getUniverse(cloud: OpenCloud, universeId: number) {
	return cloud.request<UniverseFull>("GET", `/cloud/v2/universes/${universeId}`);
}

/**
 * PATCH the universe. `mask` lists every field to change; a masked field missing from `body` is cleared (disable
 * private servers, remove a social link).
 */
export function updateUniverse(cloud: OpenCloud, universeId: number, mask: string[], body: UniversePatch) {
	if (!mask.length) throw new Error("Nothing to update.");
	return cloud.request<UniverseFull>("PATCH", `/cloud/v2/universes/${universeId}${qs({ updateMask: mask.join(",") })}`, body, undefined, SCOPES.universeWrite);
}

/** POST /legacy-develop/v1/universes/{id}/activate | deactivate (makes the experience public / private). */
export function setUniverseActive(cloud: OpenCloud, universeId: number, active: boolean) {
	return cloud.request<Record<string, never>>("POST", `/legacy-develop/v1/universes/${universeId}/${active ? "activate" : "deactivate"}`, undefined, undefined, SCOPES.legacyUniverse);
}

export function universePermissions(cloud: OpenCloud, universeId: number) {
	return cloud.request<{ canManage?: boolean; canCloudEdit?: boolean }>("GET", `/legacy-develop/v1/universes/${universeId}/permissions`, undefined, undefined, SCOPES.legacyUniverse);
}

/** "universes/1/places/2" -> 2 */
export function placeIdOf(path: string | undefined): number | null {
	const m = /places\/(\d+)/.exec(path ?? "");
	return m ? Number(m[1]) : null;
}

// Places ---------------------------------------------------------------------------------------------------------------

export type PlaceFull = CloudPlace & { universeRuntimeCreation?: boolean };

export function getPlace(cloud: OpenCloud, universeId: number, placeId: number) {
	return cloud.request<PlaceFull>("GET", `/cloud/v2/universes/${universeId}/places/${placeId}`);
}

export interface PlacePatch {
	displayName?: string;
	description?: string;
	serverSize?: number;
}

/** PATCH a place (the root place's name / description are the experience's). 409 while open in Team Create. */
export async function updatePlace(cloud: OpenCloud, universeId: number, placeId: number, patch: PlacePatch) {
	const mask = Object.keys(patch).filter((k) => patch[k as keyof PlacePatch] !== undefined);
	if (!mask.length) throw new Error("Nothing to update.");
	try {
		return await cloud.request<PlaceFull>("PATCH", `/cloud/v2/universes/${universeId}/places/${placeId}${qs({ updateMask: mask.join(",") })}`, patch, undefined, SCOPES.placeWrite);
	} catch (e) {
		if (e instanceof HttpError && e.status === 409) throw new HttpError(409, `The place is open in an active Team Create session, so Roblox refused the change. Close it in Studio and try again. (${e.message})`, e.where, e.body);
		throw e;
	}
}

/** Creator Hub's limits (the OpenAPI document gives none): name 1–50, description up to 1000, server size 1–700. */
export const PLACE_LIMITS = { name: 50, description: 1000, serverSizeMin: 1, serverSizeMax: 700 };

export function validatePlacePatch(p: PlacePatch): string | null {
	if (p.displayName !== undefined) {
		if (!p.displayName.trim()) return "The name can't be empty.";
		if (p.displayName.length > PLACE_LIMITS.name) return `The name is longer than ${PLACE_LIMITS.name} characters.`;
	}
	if (p.description !== undefined && p.description.length > PLACE_LIMITS.description) return `The description is longer than ${PLACE_LIMITS.description} characters.`;
	if (p.serverSize !== undefined && (!Number.isInteger(p.serverSize) || p.serverSize < PLACE_LIMITS.serverSizeMin || p.serverSize > PLACE_LIMITS.serverSizeMax))
		return `Server size must be a whole number from ${PLACE_LIMITS.serverSizeMin} to ${PLACE_LIMITS.serverSizeMax}.`;
	return null;
}

// Version history ------------------------------------------------------------------------------------------------------

export interface PlaceVersion {
	version?: string | null;
	title?: string | null;
	description?: string | null;
	contributors?: number[] | null;
	/** 0 | 1 | 2 (the document doesn't name them) */
	saveType?: number;
	isPublished?: boolean;
	/** 0 | 1 | 2 */
	publishStatus?: number;
	hasNotes?: boolean;
	createdTime?: string;
	createdBy?: number | null;
}

export interface VersionFilters {
	isPublished?: boolean;
	hasNotes?: boolean;
	searchTerm?: string;
	contributor?: number;
}

export function placeVersions(cloud: OpenCloud, placeId: number, filters: VersionFilters, cursor?: string) {
	return cloud.request<{ nextCursor?: string | null; hasMore?: boolean; placeVersions?: PlaceVersion[] | null }>(
		"GET",
		`/place-version-history-api/v1/${placeId}/history${qs({ cursor, pageSize: 25, isPublished: filters.isPublished, hasNotes: filters.hasNotes, searchTerm: filters.searchTerm, contributor: filters.contributor })}`,
		undefined,
		undefined,
		SCOPES.placeRead,
	);
}

export function placeContributors(cloud: OpenCloud, placeId: number, cursor?: string) {
	return cloud.request<{ nextCursor?: string | null; hasMore?: boolean; contributors?: number[] | null }>(
		"GET",
		`/place-version-history-api/v1/${placeId}/contributors${qs({ cursor, pageSize: 50 })}`,
		undefined,
		undefined,
		SCOPES.placeRead,
	);
}

export function updateVersionNotes(cloud: OpenCloud, placeId: number, version: string, notes: { title: string; description: string }) {
	return cloud.request<{ placeVersion?: PlaceVersion | null }>("POST", `/place-version-history-api/v1/${placeId}/version/${enc(version)}/notes`, notes, undefined, SCOPES.placeWrite);
}

/**
 * POST /assets/v1/assets/{placeId}/versions:rollback { assetVersion: "assets/{placeId}/versions/{n}" }. BETA, and the
 * Assets guide doesn't list places, so this may be refused for a place: the screen says so before asking.
 */
export function rollbackPlace(cloud: OpenCloud, placeId: number, version: string) {
	return cloud.request<{ path?: string | null; published?: boolean }>(
		"POST",
		`/assets/v1/assets/${placeId}/versions:rollback`,
		{ assetVersion: `assets/${placeId}/versions/${version}` },
		undefined,
		SCOPES.assetWrite,
	);
}

// Place-level bans -----------------------------------------------------------------------------------------------------

export interface PlaceRestriction {
	path: string;
	user: string;
	updateTime?: string;
	gameJoinRestriction?: { active: boolean; startTime?: string; duration?: string; privateReason?: string; displayReason?: string; excludeAltAccounts?: boolean; inherited?: boolean };
}

export function placeRestrictions(cloud: OpenCloud, universeId: number, placeId: number, pageToken?: string) {
	return cloud.request<{ userRestrictions?: PlaceRestriction[]; nextPageToken?: string }>(
		"GET",
		`/cloud/v2/universes/${universeId}/places/${placeId}/user-restrictions${qs({ maxPageSize: 100, pageToken })}`,
		undefined,
		undefined,
		SCOPES.restrictionRead,
	);
}

export function setPlaceRestriction(
	cloud: OpenCloud,
	universeId: number,
	placeId: number,
	userId: number,
	r: { active: boolean; durationSeconds?: number; displayReason?: string; privateReason?: string; excludeAltAccounts?: boolean },
) {
	const gameJoinRestriction: Record<string, unknown> = { active: r.active };
	if (r.active) {
		if (r.durationSeconds) gameJoinRestriction.duration = `${Math.round(r.durationSeconds)}s`;
		gameJoinRestriction.displayReason = r.displayReason ?? "";
		gameJoinRestriction.privateReason = r.privateReason ?? "";
		gameJoinRestriction.excludeAltAccounts = r.excludeAltAccounts ?? false;
	}
	return cloud.request<PlaceRestriction>(
		"PATCH",
		`/cloud/v2/universes/${universeId}/places/${placeId}/user-restrictions/${userId}${qs({ updateMask: "gameJoinRestriction" })}`,
		{ gameJoinRestriction },
		undefined,
		SCOPES.restrictionWrite,
	);
}

// Team Create / Team Test ----------------------------------------------------------------------------------------------

export function teamCreate(cloud: OpenCloud, universeId: number) {
	return cloud.request<{ isEnabled?: boolean }>("GET", `/legacy-develop/v1/universes/${universeId}/teamcreate`, undefined, undefined, SCOPES.team);
}

export function setTeamCreate(cloud: OpenCloud, universeId: number, isEnabled: boolean) {
	return cloud.request<Record<string, never>>("PATCH", `/legacy-develop/v1/universes/${universeId}/teamcreate`, { isEnabled }, undefined, SCOPES.team);
}

export interface SessionMember {
	id: number;
	name: string;
	displayName: string;
}

/**
 * Who is in the place's Team Create session. The doc takes limit (10/25/50/100) and cursor, but its response schema
 * (ApiArrayResponse<SkinnyUserResponse>) has only `data`, so one page of 100 is what you get; nextPageCursor is read
 * defensively in case Roblox sends it anyway.
 */
export function activeSessionMembers(cloud: OpenCloud, placeId: number, cursor?: string) {
	return cloud.request<{ data?: SessionMember[]; /** Not in the documented schema. */ nextPageCursor?: string | null }>(
		"GET",
		`/legacy-develop/v1/places/${placeId}/teamcreate/active_session/members${qs({ limit: 100, cursor })}`,
		undefined,
		undefined,
		SCOPES.team,
	);
}

export function removeTeamCreateMember(cloud: OpenCloud, universeId: number, userId: number) {
	return cloud.request<Record<string, never>>("DELETE", `/legacy-develop/v1/universes/${universeId}/teamcreate/memberships`, { userId }, undefined, SCOPES.team);
}

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function closeTeamTest(cloud: OpenCloud, placeId: number, gameId: string) {
	if (!GUID_RE.test(gameId)) throw new Error("The game id must be a server GUID (8-4-4-4-12 hex).");
	return cloud.request<Record<string, never>>("DELETE", `/legacy-develop/v2/teamtest/${placeId}${qs({ gameId })}`, undefined, undefined, SCOPES.team);
}

// Group audit log ------------------------------------------------------------------------------------------------------

/** The audit log action types that concern an experience (the full enum is much longer). */
export const EXPERIENCE_ACTIONS = [
	"SavePlace",
	"PublishPlace",
	"ConfigureGroupGame",
	"AddGroupPlace",
	"RemoveGroupPlace",
	"CreateGamePass",
	"CreateBadge",
	"ConfigureBadge",
	"CreateGroupDeveloperProduct",
	"CreateGroupDeveloperSubscriptionProduct",
	"CreateItems",
	"ConfigureItems",
	"SpendGroupFunds",
] as const;

export interface AuditEntry {
	actor?: { user?: { userId?: number; username?: string; displayName?: string }; role?: { name?: string; rank?: number } };
	actionType: string;
	description?: unknown;
	created: string;
}

export function groupAuditLog(cloud: OpenCloud, groupId: number, params: { actionType?: string; userId?: number; cursor?: string }) {
	return cloud.request<{ data?: AuditEntry[]; nextPageCursor?: string | null; previousPageCursor?: string | null }>(
		"GET",
		`/legacy-groups/v1/groups/${groupId}/audit-log${qs({ actionType: params.actionType, userId: params.userId, limit: 50, sortOrder: "Desc", cursor: params.cursor })}`,
		undefined,
		undefined,
		SCOPES.groupAudit,
	);
}

// Followings -----------------------------------------------------------------------------------------------------------

export interface FollowStatus {
	UniverseId?: number;
	UserId?: number;
	CanFollow?: boolean;
	IsFollowing?: boolean;
	FollowingCountByType?: number;
	FollowingLimitByType?: number;
}

export function followStatus(cloud: OpenCloud, userId: number, universeId: number) {
	return cloud.request<FollowStatus>("GET", `/legacy-followings/v1/users/${userId}/universes/${universeId}/status`, undefined, undefined, SCOPES.followRead);
}

export function setFollowing(cloud: OpenCloud, userId: number, universeId: number, follow: boolean) {
	return cloud.request<{ universeId?: number; userId?: number }>(follow ? "POST" : "DELETE", `/legacy-followings/v1/users/${userId}/universes/${universeId}`, undefined, undefined, SCOPES.followWrite);
}

/** { followedSources: { "<universeId>": "<follow date>" } } */
export function followedUniverses(cloud: OpenCloud, userId: number) {
	return cloud.request<{ followerId?: number; followedSources?: Record<string, string> }>("GET", `/legacy-followings/v2/users/${userId}/universes`, undefined, undefined, SCOPES.followRead);
}

// Luau execution -------------------------------------------------------------------------------------------------------

export type LuauState = "STATE_UNSPECIFIED" | "QUEUED" | "PROCESSING" | "CANCELLED" | "COMPLETE" | "FAILED";

export interface LuauTask {
	path: string;
	createTime?: string;
	updateTime?: string;
	user?: string;
	state?: LuauState;
	script?: string;
	timeout?: string;
	error?: { code?: string; message?: string };
	output?: { results?: unknown[] };
	binaryInput?: string;
}

export interface LuauLog {
	path?: string;
	messages?: string[];
	structuredMessages?: { message: string; createTime?: string; messageType?: "MESSAGE_TYPE_UNSPECIFIED" | "OUTPUT" | "INFO" | "WARNING" | "ERROR" }[];
}

/** Roblox: scripts up to 4 MB, run for up to 5 minutes. */
export const LUAU_LIMITS = { scriptBytes: 4 * 1024 * 1024, timeoutMax: 300 };

export function utf8Length(text: string): number {
	let n = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c < 0x80) n += 1;
		else if (c < 0x800) n += 2;
		else if (c >= 0xd800 && c <= 0xdbff) {
			n += 4;
			i++;
		} else n += 3;
	}
	return n;
}

export function createLuauTask(
	cloud: OpenCloud,
	universeId: number,
	placeId: number,
	body: { script: string; timeoutSeconds: number; /** A binary input's resource path (createLuauBinaryInput). */ binaryInput?: string },
	version?: number,
) {
	const base = `/cloud/v2/universes/${universeId}/places/${placeId}${version ? `/versions/${version}` : ""}`;
	const task: Record<string, string> = { script: body.script, timeout: `${body.timeoutSeconds}s` };
	if (body.binaryInput) task.binaryInput = body.binaryInput;
	return cloud.request<LuauTask>("POST", `${base}/luau-execution-session-tasks`, task, undefined, SCOPES.luauWrite);
}

const TASK_PATH = /^universes\/\d+\/places\/\d+\/(versions\/\d+\/)?(luau-execution-session-tasks\/[\w-]+|luau-execution-sessions\/[\w-]+\/tasks\/[\w-]+)$/;

function taskUrl(path: string): string {
	const clean = path.replace(/^\/+/, "");
	if (!TASK_PATH.test(clean)) throw new HttpError(502, "Roblox returned a task path the app can't poll.", "luau-execution-session-tasks");
	return `/cloud/v2/${clean}`;
}

export const LUAU_DONE: LuauState[] = ["COMPLETE", "FAILED", "CANCELLED"];

/**
 * Polls a task until it ends: every 2 s, at most 200 polls and an overall deadline (default 6.5 min: the script's
 * 5 min limit plus queueing). Each call has requestJson's 30 s deadline; `signal` stops it.
 */
export async function waitLuauTask(
	cloud: OpenCloud,
	task: LuauTask,
	options: { signal?: AbortSignal; deadlineMs?: number; onUpdate?: (t: LuauTask) => void } = {},
): Promise<LuauTask> {
	const url = `${taskUrl(task.path)}${qs({ view: "FULL" })}`;
	const until = Date.now() + (options.deadlineMs ?? 390_000);
	let current = task;
	for (let polls = 0; !LUAU_DONE.includes(current.state ?? "STATE_UNSPECIFIED"); polls++) {
		if (polls >= 200 || Date.now() > until) throw new HttpError(504, "The task didn't finish in time; it may still be running on Roblox.", "luau-execution-session-tasks");
		await sleep(2000);
		if (options.signal?.aborted) throw new HttpError(0, "Stopped waiting (the task may still run on Roblox).", "luau-execution-session-tasks");
		current = await cloud.request<LuauTask>("GET", url, undefined, options.signal, [SCOPES.luauRead]);
		options.onUpdate?.(current);
	}
	return current;
}

/** All log chunks of a task (STRUCTURED view), at most 5 pages. */
export async function luauTaskLogs(cloud: OpenCloud, task: LuauTask, signal?: AbortSignal): Promise<LuauLog[]> {
	const out: LuauLog[] = [];
	let pageToken: string | undefined;
	for (let i = 0; i < 5; i++) {
		const r = await cloud.request<{ luauExecutionSessionTaskLogs?: LuauLog[]; nextPageToken?: string }>(
			"GET",
			`${taskUrl(task.path)}/logs${qs({ maxPageSize: 10000, view: "STRUCTURED", pageToken })}`,
			undefined,
			signal,
			[SCOPES.luauRead],
		);
		out.push(...(r.luauExecutionSessionTaskLogs ?? []));
		if (!r.nextPageToken) break;
		pageToken = r.nextPageToken;
	}
	return out;
}

// Place instances ------------------------------------------------------------------------------------------------------

export type ScriptClass = "Script" | "LocalScript" | "ModuleScript";

export interface EngineInstance {
	Id?: string;
	Parent?: string;
	Name?: string;
	Details?: Partial<Record<ScriptClass, { Source?: string; Enabled?: boolean; RunContext?: string }>> & { Folder?: Record<string, never> } & Record<string, unknown>;
}

export interface PlaceInstance {
	path: string;
	hasChildren?: boolean;
	engineInstance?: EngineInstance;
}

interface Operation<T> {
	path?: string;
	done?: boolean;
	error?: { code?: number; message?: string };
	response?: T & { "@type"?: string };
}

const OPERATION_PATH = /^universes\/\d+\/places\/\d+\/instances\/[\w-]+\/operations\/[\w-]+$/;

/** Waits for an instance Operation: every 2 s, at most 15 polls (Roblox's own sample polls 10 × 5 s). */
async function settle<T>(cloud: OpenCloud, first: Operation<T>, scopes: string[], signal?: AbortSignal): Promise<T> {
	let op = first;
	for (let polls = 0; !op.done; polls++) {
		if (polls >= 15) throw new HttpError(504, "Roblox didn't finish the instance operation in time; try again.", "instances");
		const path = (op.path ?? "").replace(/^\/+/, "");
		if (!OPERATION_PATH.test(path)) throw new HttpError(502, "Roblox returned no operation path to poll.", "instances");
		await sleep(2000);
		if (signal?.aborted) throw new HttpError(0, "cancelled", "instances");
		op = await cloud.request<Operation<T>>("GET", `/cloud/v2/${path}`, undefined, signal, scopes);
	}
	if (op.error) throw new HttpError(op.error.code === 422 ? 422 : 502, op.error.message || `instance operation failed (${op.error.code ?? "?"})`, "instances", op.error);
	return (op.response ?? {}) as T;
}

const instBase = (universeId: number, placeId: number, instanceId: string) => `/cloud/v2/universes/${universeId}/places/${placeId}/instances/${enc(instanceId)}`;

export async function getInstance(cloud: OpenCloud, universeId: number, placeId: number, instanceId: string, signal?: AbortSignal): Promise<PlaceInstance> {
	const op = await cloud.request<Operation<PlaceInstance>>("GET", instBase(universeId, placeId, instanceId), undefined, signal, SCOPES.instanceRead);
	return settle(cloud, op, [SCOPES.instanceRead], signal);
}

/** Page sizes tried for listChildren: 200 first, smaller after a 422 (the response is capped at 500,000 bytes, and children carry script sources). */
export const CHILD_PAGE_SIZES = [200, 50, 10, 1] as const;

export interface ChildPageParam {
	pageToken?: string;
	/** The page size the earlier page was read with; a page token only works with the same parameters. */
	maxPageSize?: number;
}

/**
 * listChildren with a size fallback: on a 422 operation error (over 500,000 bytes) it retries the same page with the
 * next smaller size. The size that worked is returned so the next page is read with it (a page token needs the same
 * parameters). At most 4 attempts.
 */
export async function listInstanceChildren(cloud: OpenCloud, universeId: number, placeId: number, instanceId: string, page: ChildPageParam = {}, signal?: AbortSignal) {
	const sizes = page.maxPageSize ? CHILD_PAGE_SIZES.filter((n) => n <= page.maxPageSize!) : [...CHILD_PAGE_SIZES];
	let last: unknown;
	for (const maxPageSize of sizes) {
		try {
			const op = await cloud.request<Operation<{ instances?: PlaceInstance[]; nextPageToken?: string }>>(
				"GET",
				`${instBase(universeId, placeId, instanceId)}:listChildren${qs({ maxPageSize, pageToken: page.pageToken })}`,
				undefined,
				signal,
				SCOPES.instanceRead,
			);
			return { ...(await settle(cloud, op, [SCOPES.instanceRead], signal)), maxPageSize };
		} catch (e) {
			if (!(e instanceof HttpError && e.status === 422)) throw e;
			last = e;
		}
	}
	throw last;
}

/** Script source limit for an update: 200,000 bytes UTF-8. */
export const SOURCE_MAX_BYTES = 200_000;

/**
 * PATCH a script's properties (only Script / LocalScript / ModuleScript are supported), then waits for the operation.
 * The body follows Roblox's Engine instances guide: { engineInstance: { Details: { <Class>: { <Property>: value } } } }.
 * Roblox refuses scripts open in Studio or inside a package.
 */
export async function updateScript(cloud: OpenCloud, universeId: number, placeId: number, instanceId: string, cls: ScriptClass, props: { Source?: string; Enabled?: boolean }) {
	if (props.Source !== undefined && utf8Length(props.Source) > SOURCE_MAX_BYTES) throw new Error(`The source is over ${SOURCE_MAX_BYTES.toLocaleString()} bytes (UTF-8), Roblox's limit.`);
	// No updateMask: the guide's request has none (only the populated Details fields change).
	const op = await cloud.request<Operation<PlaceInstance>>(
		"PATCH",
		instBase(universeId, placeId, instanceId),
		{ engineInstance: { Details: { [cls]: props } } },
		undefined,
		SCOPES.instanceWrite,
	);
	return settle(cloud, op, [SCOPES.instanceRead, SCOPES.instanceWrite]);
}

export function instanceClass(i: PlaceInstance | undefined): string {
	const d = i?.engineInstance?.Details;
	if (!d) return "Instance";
	const keys = Object.keys(d).filter((k) => k !== "@type");
	return keys[0] ?? "Instance";
}

export function isScriptClass(c: string): c is ScriptClass {
	return c === "Script" || c === "LocalScript" || c === "ModuleScript";
}

/** "universes/1/places/2/instances/abc" -> "abc" */
export function instanceIdOf(i: PlaceInstance): string {
	return i.engineInstance?.Id ?? i.path.split("/").pop() ?? "";
}

// Raw file uploads (place publishing, Luau binary input) ----------------------------------------------------------------

/** Roblox's limits: x-roblox-size-limit of the place publishing endpoint, and the binary input object's 100 MiB. */
export const UPLOAD_LIMITS = {
	placeBytes: 10 * 1024 * 1024,
	binaryInputBytes: 100 * 1024 * 1024,
	/**
	 * The app's own cap for a binary input: the file is read into memory and handed to the native request, so a
	 * 100 MiB file would need over 200 MB of phone memory at once.
	 */
	binaryInputAppBytes: 50 * 1024 * 1024,
};

/** Deadlines for the uploads: longer than requestJson's 30 s (megabytes over a phone connection), still bounded. */
export const UPLOAD_TIMEOUT_MS = { place: 120_000, binaryInput: 180_000 };

export type PlaceFileKind = "rbxl" | "rbxlx";

/** "Game.rbxl" -> "rbxl"; anything that isn't a place file -> null. */
export function placeFileKind(name: string): PlaceFileKind | null {
	const m = /\.(rbxlx?)$/i.exec(name.trim());
	return m ? (m[1]!.toLowerCase() as PlaceFileKind) : null;
}

/**
 * What to call a picked file. On Android the picker hands back the provider's document URI (no copy), so `File.name`
 * is often an opaque document id ("msf:1000012345", "document:1234") rather than the display name, which
 * expo-file-system doesn't expose; those get `fallback`. iOS copies the file and keeps its real name.
 */
export function fileLabel(file: File, fallback = "picked file"): string {
	const name = (file.name ?? "").trim();
	return !name || /[:;=]/.test(name) || /^\d+$/.test(name) ? fallback : name;
}

/**
 * The kind of place file from its first bytes: binary .rbxl files start with `<roblox!`, XML .rbxlx files with
 * `<roblox` (after an optional BOM, whitespace or `<?xml …?>`). Null when it isn't a place file.
 */
export function sniffPlaceKind(bytes: Uint8Array): PlaceFileKind | null {
	const head = Array.from(bytes.subarray(0, 512), (b) => String.fromCharCode(b)).join("");
	if (head.startsWith("<roblox!")) return "rbxl";
	const text = head.replace(/^\xEF\xBB\xBF/, "").trimStart();
	return text.startsWith("<roblox") || (text.startsWith("<?xml") && text.includes("<roblox")) ? "rbxlx" : null;
}

/**
 * A picked file's place kind, from its first 512 bytes (read with a read-only handle, not the whole file), because the
 * name often has no extension on Android. When the header can't be read, falls back to the name's extension.
 */
export async function detectPlaceKind(file: File): Promise<PlaceFileKind | null> {
	let head: Uint8Array;
	try {
		const handle = file.open(FileMode.ReadOnly);
		try {
			head = await handle.readBytes(512);
		} finally {
			handle.close();
		}
	} catch {
		return placeFileKind(file.name);
	}
	return sniffPlaceKind(head);
}

/** "12.3 MB" (base 1024, like the limits). */
export function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Reads a picked file's bytes, refusing it (before reading when the size is known) when it's over `max`. */
async function readCapped(file: File, max: number): Promise<Uint8Array<ArrayBuffer>> {
	const known = typeof file.size === "number" && file.size > 0 ? file.size : null;
	const label = fileLabel(file, "The file");
	if (known !== null && known > max) throw new Error(`${label} is ${fmtBytes(known)}; the limit is ${fmtBytes(max)}.`);
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.byteLength > max) throw new Error(`${label} is ${fmtBytes(bytes.byteLength)}; the limit is ${fmtBytes(max)}.`);
	if (!bytes.byteLength) throw new Error(`${label} is empty.`);
	return bytes;
}

/** Only https Roblox hosts get the user's file (the presigned upload URI comes from Roblox's answer). */
function isRobloxHttps(uri: string): boolean {
	try {
		const u = new URL(uri);
		const host = u.hostname.toLowerCase();
		return u.protocol === "https:" && (host === "roblox.com" || host.endsWith(".roblox.com"));
	} catch {
		return false;
	}
}

/**
 * Sends raw bytes (requestJson only sends JSON / strings), with expo/fetch so the bytes reach the native request as
 * they are. `cloud` + an Open Cloud path adds the x-api-key header, and then only for https://apis.roblox.com; a bare
 * URI (a presigned upload URI) gets no key and must be an https roblox.com host. A deadline aborts it; 401 / 403 on a
 * keyed call throws a ScopeError naming `scopes`. Answers the response text.
 */
async function sendBytes(
	target: { cloud: OpenCloud; path: string; scopes: string[] } | { uri: string },
	options: { method: "POST" | "PUT"; contentType: string; body: Uint8Array<ArrayBuffer>; timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
	let url: string;
	const headers: Record<string, string> = { "content-type": options.contentType, accept: "application/json, text/plain" };
	if ("cloud" in target) {
		if (!target.path.startsWith("/")) throw new Error("Bad Open Cloud path.");
		url = `${OPEN_CLOUD}${target.path}`;
		// The key stays inside OpenCloud: this reads its (private) header builder, and only for apis.roblox.com.
		Object.assign(headers, target.cloud["headers"]());
	} else {
		if (!isRobloxHttps(target.uri)) {
			let host = "an unknown host";
			try {
				host = new URL(target.uri).host;
			} catch {
				// not a URL: keep "an unknown host"
			}
			throw new HttpError(502, `Roblox returned an upload address on ${host}; the app only uploads to https roblox.com hosts.`, "upload");
		}
		url = target.uri;
	}
	const where = (() => {
		try {
			const u = new URL(url);
			return `${u.host}${u.pathname}`;
		} catch {
			return "upload";
		}
	})();
	const { signal, done } = deadline(options.timeoutMs, options.signal);
	let text = "";
	let status = 0;
	let ok = false;
	try {
		// redirect "error": a keyed request never follows a redirect elsewhere with the key.
		const response = await expoFetch(url, { method: options.method, headers, body: options.body, signal, redirect: "error" });
		status = response.status;
		ok = response.ok;
		text = await response.text();
	} catch (error) {
		const reason = signal.aborted ? ((signal.reason as Error | undefined)?.message ?? "aborted") : (error as Error).message;
		throw new HttpError(0, `cannot reach ${where}: ${reason}`, where);
	} finally {
		done();
	}
	if (!ok) {
		let body: unknown;
		try {
			body = text ? JSON.parse(text) : undefined;
		} catch {
			body = undefined;
		}
		const fallback = body === undefined && text && text.length < 300 && !text.trimStart().startsWith("<") ? text.trim() : undefined;
		const err = new HttpError(status, fallback ?? errorMessage(body, status), where, body);
		if ("cloud" in target && (status === 401 || status === 403)) throw new ScopeError(err, target.scopes);
		throw err;
	}
	return text;
}

export type PlaceVersionType = "Published" | "Saved";

/**
 * Publishes (or only saves) a new place version from a picked .rbxl / .rbxlx file. Published replaces what players
 * join. Checks the size (Roblox's 10 MiB) and the file's header before sending; the header, not the name, picks the
 * content type (Android names are often document ids with no extension). Answers the new version number when Roblox
 * gives one.
 */
export async function publishPlaceFile(cloud: OpenCloud, universeId: number, placeId: number, file: File, versionType: PlaceVersionType): Promise<{ versionNumber?: number }> {
	const bytes = await readCapped(file, UPLOAD_LIMITS.placeBytes);
	const kind = sniffPlaceKind(bytes);
	if (!kind) throw new Error(`${fileLabel(file, "The file")} isn't a Roblox place file: pick an .rbxl or .rbxlx file.`);
	let text: string;
	try {
		text = await sendBytes(
			{ cloud, path: `/universes/v1/${universeId}/places/${placeId}/versions${qs({ versionType })}`, scopes: [SCOPES.placePublish] },
			{ method: "POST", contentType: kind === "rbxl" ? "application/octet-stream" : "application/xml", body: bytes, timeoutMs: UPLOAD_TIMEOUT_MS.place },
		);
	} catch (e) {
		if (e instanceof HttpError && e.status === 409 && !(e instanceof ScopeError)) throw new HttpError(409, `Roblox says this place isn't part of the experience. (${e.message})`, e.where, e.body);
		throw e;
	}
	try {
		const r = JSON.parse(text) as { versionNumber?: unknown };
		return typeof r.versionNumber === "number" ? { versionNumber: r.versionNumber } : {};
	} catch {
		return {};
	}
}

export interface LuauBinaryInput {
	/** universes/{id}/luau-execution-session-task-binary-inputs/{id}: pass as the task's binaryInput. */
	path: string;
	size?: number;
	/** When it stops being usable (15 minutes after creation). */
	expiresAt: number;
}

const BINARY_INPUT_PATH = /^universes\/\d+\/luau-execution-session-task-binary-inputs\/[\w-]+$/;

/**
 * Creates a Luau task binary input for a picked file and uploads the file to its presigned URI (PUT, octet-stream, no
 * key). The returned path works for any task in this universe for 15 minutes.
 */
export async function createLuauBinaryInput(cloud: OpenCloud, universeId: number, file: File, signal?: AbortSignal): Promise<LuauBinaryInput> {
	const bytes = await readCapped(file, Math.min(UPLOAD_LIMITS.binaryInputAppBytes, UPLOAD_LIMITS.binaryInputBytes));
	const created = await cloud.request<{ path?: string; size?: number; uploadUri?: string }>(
		"POST",
		`/cloud/v2/universes/${universeId}/luau-execution-session-task-binary-inputs`,
		{ size: bytes.byteLength },
		signal,
		SCOPES.luauWrite,
	);
	const expiresAt = Date.now() + 14 * 60_000;
	const path = (created.path ?? "").replace(/^\/+/, "");
	if (!BINARY_INPUT_PATH.test(path) || !created.uploadUri) throw new HttpError(502, "Roblox didn't return a binary input path and upload address.", "luau-execution-session-task-binary-inputs");
	await sendBytes({ uri: created.uploadUri }, { method: "PUT", contentType: "application/octet-stream", body: bytes, timeoutMs: UPLOAD_TIMEOUT_MS.binaryInput, signal });
	return { path, size: created.size ?? bytes.byteLength, expiresAt };
}
