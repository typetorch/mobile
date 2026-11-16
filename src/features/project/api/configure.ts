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
 */
import { HttpError, qs, requestJson } from "@/api/http";
import type { CloudPlace, CloudUniverse, OpenCloud } from "@/api/opencloud";

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

export function createLuauTask(cloud: OpenCloud, universeId: number, placeId: number, body: { script: string; timeoutSeconds: number }, version?: number) {
	const base = `/cloud/v2/universes/${universeId}/places/${placeId}${version ? `/versions/${version}` : ""}`;
	return cloud.request<LuauTask>("POST", `${base}/luau-execution-session-tasks`, { script: body.script, timeout: `${body.timeoutSeconds}s` }, undefined, SCOPES.luauWrite);
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
