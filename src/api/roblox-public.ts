/**
 * Roblox's public web APIs (no key, no cookie): users, groups, games, thumbnails, badges, public servers. Checked
 * against Roblox's OpenAPI document (creator-docs content/en-us/reference/cloud/openapi.json, 2026-11) unless a
 * function says "assumed". Unauthenticated calls only see public experiences; private ones come from the Open Cloud
 * key's universes (opencloud.ts).
 */
import { chunk, mapLimit, qs, requestJson } from "./http";

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

/** The groups the user is in with their role. Assumed shape (groups v2 is not in the OpenAPI document). */
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
