/**
 * Roblox's public web APIs (no key, no cookie): users, groups, games, thumbnails, badges, public servers, develop v1
 * universe status, plus (at the end) the Open Cloud calls the projects list makes with the person's key. Checked
 * against Roblox's OpenAPI document (creator-docs content/en-us/reference/cloud/openapi.json, 2026-11) unless a
 * function says "assumed". Unauthenticated calls only see public experiences; private ones come from the Open Cloud
 * key's universes (opencloud.ts).
 */
import { chunk, HttpError, mapLimit, qs, requestJson } from "./http";
import type { CloudUniverse, OpenCloud } from "./opencloud";

export interface RobloxUser {
	id: number;
	name: string;
	displayName: string;
	description?: string;
	created?: string;
}

export interface GameSummary {
	/** The universe id. */
	id: number;
	name: string;
	description?: string | null;
	creator?: { id: number; type: string };
	rootPlace?: { id: number };
	created?: string;
	updated?: string;
	placeVisits?: number;
}

export interface GameDetail {
	id: number;
	rootPlaceId: number;
	name: string;
	description: string | null;
	creator: { id: number; name: string; type: "User" | "Group" | string; hasVerifiedBadge?: boolean };
	price: number | null;
	playing: number;
	visits: number;
	maxPlayers: number;
	created: string;
	updated: string;
	genre?: string;
	genre_l1?: string;
	genre_l2?: string;
	favoritedCount: number;
	universeAvatarType?: string;
	createVipServersAllowed?: boolean;
	copyingAllowed?: boolean;
}

export interface GameVotes {
	id: number;
	upVotes: number;
	downVotes: number;
}

export interface GroupRole {
	group: { id: number; name: string; memberCount?: number; hasVerifiedBadge?: boolean };
	role: { id: number; name: string; rank: number };
}

export interface PlaceInfo {
	id: number;
	universeId: number;
	name: string;
	description?: string;
}

export interface PublicServer {
	id: string;
	maxPlayers: number;
	playing?: number;
	fps?: number;
	ping?: number;
}

export interface Badge {
	id: number;
	name: string;
	description: string | null;
	enabled: boolean;
	iconImageId: number;
	created: string;
	updated: string;
	statistics?: { pastDayAwardedCount: number; awardedCount: number; winRatePercentage: number };
}

export interface PublicGamePass {
	id: number;
	name: string;
	displayName?: string;
	price: number | null;
	productId?: number;
	sellerName?: string;
}

interface Page<T> {
	data: T[];
	nextPageCursor?: string | null;
}

const GAMES = "https://games.roblox.com";
const THUMBS = "https://thumbnails.roblox.com";

export async function getUser(userId: number): Promise<RobloxUser> {
	return requestJson<RobloxUser>(`https://users.roblox.com/v1/users/${userId}`);
}

export async function usersByIds(userIds: number[]): Promise<RobloxUser[]> {
	const out: RobloxUser[] = [];
	for (const ids of chunk(Array.from(new Set(userIds)), 100)) {
		const r = await requestJson<{ data: RobloxUser[] }>("https://users.roblox.com/v1/users", { body: { userIds: ids, excludeBannedUsers: false } });
		out.push(...r.data);
	}
	return out;
}

export async function userByName(username: string): Promise<RobloxUser | null> {
	const r = await requestJson<{ data: RobloxUser[] }>("https://users.roblox.com/v1/usernames/users", {
		body: { usernames: [username.trim()], excludeBannedUsers: false },
	});
	return r.data[0] ?? null;
}

async function allPages<T>(url: (cursor?: string) => string, maxPages = 10): Promise<T[]> {
	const out: T[] = [];
	let cursor: string | undefined;
	for (let i = 0; i < maxPages; i++) {
		const page = await requestJson<Page<T>>(url(cursor));
		out.push(...page.data);
		if (!page.nextPageCursor) break;
		cursor = page.nextPageCursor;
	}
	return out;
}

/** The user's public experiences (accessFilter 2 = public; private ones need the Open Cloud key). */
export function userGames(userId: number): Promise<GameSummary[]> {
	return allPages<GameSummary>((cursor) => `${GAMES}/v2/users/${userId}/games${qs({ accessFilter: 2, limit: 50, sortOrder: "Desc", cursor })}`);
}

export function groupGames(groupId: number): Promise<GameSummary[]> {
	return allPages<GameSummary>((cursor) => `${GAMES}/v2/groups/${groupId}/gamesV2${qs({ accessFilter: 2, limit: 100, sortOrder: "Desc", cursor })}`);
}

/**
 * The groups the user is in with their role. Assumed shape (groups v2 is not in the OpenAPI document). The projects
 * list uses it for names and ranks and as the fallback for the Open Cloud memberships list (cloudUserMemberships).
 */
export async function userGroups(userId: number): Promise<GroupRole[]> {
	const r = await requestJson<{ data: GroupRole[] }>(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
	return r.data ?? [];
}

/** Details for any number of universes (50 per request). */
export async function gameDetails(universeIds: number[]): Promise<GameDetail[]> {
	const batches = chunk(Array.from(new Set(universeIds)), 50);
	const pages = await mapLimit(batches, 3, (ids) => requestJson<{ data: GameDetail[] }>(`${GAMES}/v1/games?universeIds=${ids.join(",")}`));
	return pages.flatMap((p) => p.data ?? []);
}

export async function gameVotes(universeIds: number[]): Promise<GameVotes[]> {
	const batches = chunk(Array.from(new Set(universeIds)), 50);
	const pages = await mapLimit(batches, 3, (ids) => requestJson<{ data: GameVotes[] }>(`${GAMES}/v1/games/votes?universeIds=${ids.join(",")}`));
	return pages.flatMap((p) => p.data ?? []);
}

interface ThumbAnswer {
	targetId: number;
	state: string;
	imageUrl: string | null;
}

/** Square icons, universeId -> https URL. */
export async function gameIcons(universeIds: number[], size = "150x150"): Promise<Record<number, string>> {
	const batches = chunk(Array.from(new Set(universeIds)), 100);
	const pages = await mapLimit(batches, 3, (ids) =>
		requestJson<{ data: ThumbAnswer[] }>(`${THUMBS}/v1/games/icons${qs({ universeIds: ids.join(","), returnPolicy: "PlaceHolder", size, format: "Png", isCircular: false })}`),
	);
	const out: Record<number, string> = {};
	for (const p of pages) for (const t of p.data ?? []) if (t.imageUrl) out[t.targetId] = t.imageUrl;
	return out;
}

/** The first wide thumbnail of a universe (the overview's banner). */
export async function gameBanner(universeId: number): Promise<string | null> {
	const r = await requestJson<{ data: { universeId: number; thumbnails: ThumbAnswer[] }[] }>(
		`${THUMBS}/v1/games/multiget/thumbnails${qs({ universeIds: universeId, countPerUniverse: 1, defaults: true, size: "768x432", format: "Png", isCircular: false })}`,
	);
	return r.data?.[0]?.thumbnails?.[0]?.imageUrl ?? null;
}

export async function groupIcons(groupIds: number[]): Promise<Record<number, string>> {
	if (!groupIds.length) return {};
	const batches = chunk(Array.from(new Set(groupIds)), 100);
	const pages = await mapLimit(batches, 3, (ids) =>
		requestJson<{ data: ThumbAnswer[] }>(`${THUMBS}/v1/groups/icons${qs({ groupIds: ids.join(","), size: "150x150", format: "Png", isCircular: false })}`),
	);
	const out: Record<number, string> = {};
	for (const p of pages) for (const t of p.data ?? []) if (t.imageUrl) out[t.targetId] = t.imageUrl;
	return out;
}

export async function headshots(userIds: number[]): Promise<Record<number, string>> {
	if (!userIds.length) return {};
	const batches = chunk(Array.from(new Set(userIds)), 100);
	const pages = await mapLimit(batches, 3, (ids) =>
		requestJson<{ data: ThumbAnswer[] }>(`${THUMBS}/v1/users/avatar-headshot${qs({ userIds: ids.join(","), size: "48x48", format: "Png", isCircular: true })}`),
	);
	const out: Record<number, string> = {};
	for (const p of pages) for (const t of p.data ?? []) if (t.imageUrl) out[t.targetId] = t.imageUrl;
	return out;
}

/** Asset thumbnails (badge / pass / product icons by image asset id). */
export async function assetThumbs(assetIds: number[]): Promise<Record<number, string>> {
	const ids = assetIds.filter((n) => n > 0);
	if (!ids.length) return {};
	const batches = chunk(Array.from(new Set(ids)), 100);
	const pages = await mapLimit(batches, 3, (b) =>
		requestJson<{ data: ThumbAnswer[] }>(`${THUMBS}/v1/assets${qs({ assetIds: b.join(","), size: "150x150", format: "Png", isCircular: false })}`),
	);
	const out: Record<number, string> = {};
	for (const p of pages) for (const t of p.data ?? []) if (t.imageUrl) out[t.targetId] = t.imageUrl;
	return out;
}

/** The places of a universe (develop v1; public for public universes). */
export function universePlaces(universeId: number): Promise<PlaceInfo[]> {
	return allPages<PlaceInfo>((cursor) => `https://develop.roblox.com/v1/universes/${universeId}/places${qs({ isUniverseCreation: false, limit: 100, sortOrder: "Asc", cursor })}`, 5);
}

/** One page of a place's public servers (serverType 0 = public). */
export async function publicServers(placeId: number, cursor?: string): Promise<{ servers: PublicServer[]; next: string | null }> {
	const r = await requestJson<Page<PublicServer>>(`${GAMES}/v1/games/${placeId}/servers/0${qs({ sortOrder: "Desc", limit: 100, cursor, excludeFullGames: false })}`);
	return { servers: r.data ?? [], next: r.nextPageCursor ?? null };
}

export function universeBadges(universeId: number): Promise<Badge[]> {
	return allPages<Badge>((cursor) => `https://badges.roblox.com/v1/universes/${universeId}/badges${qs({ limit: 100, sortOrder: "Asc", cursor })}`, 5);
}

/** Public game passes (games v1; assumed: not in the OpenAPI document). Used when the key lacks game-pass:read. */
export function publicGamePasses(universeId: number): Promise<PublicGamePass[]> {
	return allPages<PublicGamePass>((cursor) => `${GAMES}/v1/games/${universeId}/game-passes${qs({ limit: 100, sortOrder: "Asc", cursor })}`, 5);
}

/** A place id to its universe (assumed shape: { universeId }). */
export async function placeUniverse(placeId: number): Promise<number | null> {
	const r = await requestJson<{ universeId: number | null }>(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
	return r.universeId ?? null;
}

async function idIcons(path: string, param: string, ids: number[]): Promise<Record<number, string>> {
	const list = Array.from(new Set(ids.filter((n) => n > 0)));
	if (!list.length) return {};
	const pages = await mapLimit(chunk(list, 100), 3, (b) =>
		requestJson<{ data: ThumbAnswer[] }>(`${THUMBS}${path}${qs({ [param]: b.join(","), size: "150x150", format: "Png", isCircular: false })}`),
	);
	const out: Record<number, string> = {};
	for (const p of pages) for (const t of p.data ?? []) if (t.imageUrl) out[t.targetId] = t.imageUrl;
	return out;
}

export const badgeIcons = (ids: number[]) => idIcons("/v1/badges/icons", "badgeIds", ids);
export const gamePassIcons = (ids: number[]) => idIcons("/v1/game-passes", "gamePassIds", ids);
export const productIcons = (ids: number[]) => idIcons("/v1/developer-products/icons", "developerProductIds", ids);

// Develop v1 universes (status flags) -----------------------------------------------------------------------------------

/** develop.roblox.com UniverseModel (the multiget and group universe lists share it). */
export interface DevelopUniverse {
	id: number;
	name: string;
	description?: string | null;
	isArchived: boolean;
	rootPlaceId: number;
	isActive: boolean;
	/** "Public" / "Private" (free text in the document). */
	privacyType: string;
	creatorType: "User" | "Group" | string;
	creatorTargetId: number;
	creatorName?: string;
	created: string;
	updated: string;
	/** 1 Editors, 2 PlayTesters, 3 Friends, 4 Public (0 Invalid). */
	audiences?: number[];
}

const DEVELOP = "https://develop.roblox.com";

/** GET develop /v1/universes/multiget?ids=…&ids=… (no auth, 100 ids per call): name, privacy, active and archived flags. */
export async function developUniverses(universeIds: number[]): Promise<DevelopUniverse[]> {
	const batches = chunk(Array.from(new Set(universeIds.filter((n) => n > 0))), 100);
	const pages = await mapLimit(batches, 3, (ids) => requestJson<{ data?: DevelopUniverse[] }>(`${DEVELOP}/v1/universes/multiget?${ids.map((id) => `ids=${id}`).join("&")}`));
	return pages.flatMap((p) => p.data ?? []);
}

/**
 * GET develop /v1/groups/{groupId}/universes (no auth tried; the document also allows a cookie, which the app never
 * has). `isArchived` true lists the archived ones. Private universes are kept when Roblox returns them.
 */
export function groupUniverses(groupId: number, isArchived = false): Promise<DevelopUniverse[]> {
	return allPages<DevelopUniverse>((cursor) => `${DEVELOP}/v1/groups/${groupId}/universes${qs({ isArchived, limit: 100, sortOrder: "Desc", cursor })}`, 5);
}

// Inventory: places a user created ---------------------------------------------------------------------------------------

export interface InventoryPlace {
	universeId: number;
	placeId: number;
	name: string;
	/** creator.type: 1 User, 2 Group, 3 Experience. */
	creator: { id: number; name: string; type: number };
	priceInRobux?: number | null;
}

/**
 * GET inventory /v1/users/{userId}/places/inventory (no auth). placesTab, itemsPerPage and cursor are all required;
 * the document leaves the placesTab enum (0-5) unnamed: 0 is taken as "Created" (assumed). The cursor is typed as an
 * integer, so only numeric next cursors are followed, at most 3 pages. Only places the user created are returned.
 */
export async function userCreatedPlaces(userId: number): Promise<InventoryPlace[]> {
	const out: InventoryPlace[] = [];
	let cursor = "0";
	for (let i = 0; i < 3; i++) {
		const page = await requestJson<Page<InventoryPlace>>(`https://inventory.roblox.com/v1/users/${userId}/places/inventory${qs({ placesTab: 0, itemsPerPage: 100, cursor })}`);
		out.push(...(page.data ?? []));
		if (!page.nextPageCursor || !/^\d+$/.test(page.nextPageCursor)) break;
		cursor = page.nextPageCursor;
	}
	return out.filter((p) => p.creator?.type === 1 && p.creator.id === userId && p.universeId > 0);
}

// Open Cloud calls the projects list uses (the person's key; only to apis.roblox.com) ------------------------------------

/** Cloud v2 GroupMembership. */
export interface CloudGroupMembership {
	/** groups/{group_id}/memberships/{membership_id} */
	path: string;
	createTime?: string;
	updateTime?: string;
	/** users/{user_id} */
	user: string;
	/** groups/{group_id}/roles/{role_id}: the highest-ranked role. */
	role: string;
	roles?: string[];
}

/** Cloud v2 GroupRole (permissions only with group:read for non-guest roles). */
export interface CloudGroupRole {
	path: string;
	id: string;
	displayName: string;
	description?: string;
	rank: number;
	memberCount?: number;
	permissions?: Partial<Record<"manageGroupUniverses" | "viewUniverseAnalytics" | "spendGroupFunds" | "advertiseGroup", boolean>> & Record<string, boolean | undefined>;
}

/** Cloud v2 Group. */
export interface CloudGroup {
	path: string;
	id: string;
	displayName: string;
	description?: string;
	/** users/{user_id} */
	owner?: string;
	memberCount?: number;
	publicEntryAllowed?: boolean;
	locked?: boolean;
	verified?: boolean;
}

/** The number at the end of a resource path ("groups/7/roles/9" -> 9). */
function tailId(path: string | undefined, segment: string): number | null {
	const m = path ? new RegExp(`${segment}/(\\d+)`).exec(path) : null;
	return m ? Number(m[1]) : null;
}

export interface UserGroupMembership {
	groupId: number;
	roleId: number | null;
}

/**
 * Every group a user is in: GET /cloud/v2/groups/-/memberships with the wildcard group id, which requires a user
 * filter (CEL `user in ['users/<id>']`, kept identical on every page or Roblox answers 400). No scope; at most 10
 * pages of 100.
 */
export async function cloudUserMemberships(cloud: OpenCloud, userId: number): Promise<UserGroupMembership[]> {
	const filter = `user in ['users/${userId}']`;
	const out: UserGroupMembership[] = [];
	let pageToken: string | undefined;
	for (let i = 0; i < 10; i++) {
		const r = await cloud.request<{ groupMemberships?: CloudGroupMembership[]; nextPageToken?: string }>("GET", `/cloud/v2/groups/-/memberships${qs({ maxPageSize: 100, pageToken, filter })}`);
		for (const m of r.groupMemberships ?? []) {
			const groupId = tailId(m.path, "groups");
			if (groupId) out.push({ groupId, roleId: tailId(m.role, "roles") });
		}
		if (!r.nextPageToken) break;
		pageToken = r.nextPageToken;
	}
	return out;
}

/** GET /cloud/v2/groups/{group_id}/roles/{role_id}: name and rank (permissions need group:read). */
export function cloudGroupRole(cloud: OpenCloud, groupId: number, roleId: number) {
	return cloud.request<CloudGroupRole>("GET", `/cloud/v2/groups/${groupId}/roles/${roleId}`, undefined, undefined, "group:read");
}

/** GET /cloud/v2/groups/{group_id} (no scope). */
export function cloudGroup(cloud: OpenCloud, groupId: number) {
	return cloud.request<CloudGroup>("GET", `/cloud/v2/groups/${groupId}`);
}

/** GET /legacy-develop/v1/user/groups/canmanage [legacy-group:manage]: groups the key owner can manage. */
export async function canManageGroups(cloud: OpenCloud): Promise<{ id: number; name: string }[]> {
	const r = await cloud.request<{ data?: { id: number; name: string }[] }>("GET", "/legacy-develop/v1/user/groups/canmanage", undefined, undefined, "legacy-group:manage");
	return r.data ?? [];
}

export interface UniversePermission {
	universeId: number;
	canManage: boolean;
	canCloudEdit?: boolean;
}

/** GET /legacy-develop/v1/universes/multiget/permissions?ids=… [legacy-universe:manage] (50 ids per call). */
export async function universePermissions(cloud: OpenCloud, universeIds: number[]): Promise<UniversePermission[]> {
	const batches = chunk(Array.from(new Set(universeIds.filter((n) => n > 0))), 50);
	const pages = await mapLimit(batches, 2, (ids) =>
		cloud.request<{ data?: UniversePermission[] }>("GET", `/legacy-develop/v1/universes/multiget/permissions?${ids.map((id) => `ids=${id}`).join("&")}`, undefined, undefined, "legacy-universe:manage"),
	);
	return pages.flatMap((p) => p.data ?? []);
}

/**
 * GET /ads-management/v1/advertisable-universes [ad.campaign:read] (not paginated): the universes a billing account can
 * advertise, the personal one or a group's (`groupId`).
 */
export async function advertisableUniverses(cloud: OpenCloud, groupId?: number): Promise<number[]> {
	const r = await cloud.request<{ advertisableUniverses?: { universeId: string }[] }>(
		"GET",
		`/ads-management/v1/advertisable-universes${qs({ groupId })}`,
		undefined,
		undefined,
		"ad.campaign:read",
	);
	return (r.advertisableUniverses ?? []).map((u) => Number(u.universeId)).filter((n) => Number.isFinite(n) && n > 0);
}

/** GET /cloud/v2/universes/{universeId}: works for private universes the key reaches (games v1 may omit those). */
export function cloudUniverse(cloud: OpenCloud, universeId: number) {
	return cloud.request<CloudUniverse>("GET", `/cloud/v2/universes/${universeId}`);
}

/** A 400/401/403/404 (the call is not for this account), as opposed to a network or server failure. */
export function isRefusal(error: unknown): boolean {
	return error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429;
}
