/**
 * Creator Hub "Monetization" calls beyond src/api/opencloud.ts: game pass and developer product create / read / update
 * (prices, sale state, regional and managed pricing), badge create / update, one player's subscription, ban status and
 * Open Cloud profile, what a player owns, their past usernames, and granting the experience use of assets.
 *
 * Checked against Roblox's OpenAPI document (2026-11): paths, casing, query names, body shapes and x-roblox-scopes.
 * Notes from it that shape the code:
 *   - Passes (game-passes/v1) and products (developer-products/v2) are written with multipart/form-data, not JSON, and
 *     only the fields sent change. PATCH answers 204. There is no DELETE: taking an item off sale is the way to retire
 *     it. `isRegionalPricingEnabled` is deprecated in favour of `isManagedPricingEnabled` (price optimization) and must
 *     not be sent together with it for products. Products with `isImmutable` (commerce products) can't be edited.
 *     Passes 5 / s, products 3 / s per key owner.
 *   - Icons are an image file part: imageFile (passes, products), files (badge create), Files (POST
 *     /legacy-publish/v1/badges/{id}/icon, legacy-badge:manage, overwrites the badge's icon). The app picks the image
 *     with expo-file-system's system file picker (File.pickFileAsync, in Expo Go) and sends React Native's
 *     {uri, name, type} FormData part.
 *   - Badges: POST /legacy-badges/v1/universes/{id}/badges (multipart: name, description, paymentSourceType 1 = user,
 *     2 = group, expectedCost, isActive; `files` optional when Roblox has a default badge icon) charges the payment
 *     source unless the universe has free badges left today (badges v1 free-badges-quota). badges v1 metadata gives
 *     the price, the default icon and the name / description lengths. PATCH /legacy-badges/v1/badges/{id} is JSON
 *     {name, description, enabled} and takes legacy-universe.badge:write (or :manage-and-spend-robux).
 *   - Subscriptions: GET .../subscription-products/{EXP-…}/subscriptions/{userId}. Reading another player's
 *     subscription needs universe:write (the read-only scope only reads the key owner's own subscription).
 *   - inventory-items: filter "gamePassIds=1,2;badgeIds=3" (ID fields can't be mixed with type fields), maxPageSize
 *     max 100, pageToken -> nextPageToken. Works with any key when the player's inventory is public.
 *   - inventory v1 is-owned: itemType is an integer enum 0-4 documented as "Asset, GamePass, Badge, Bundle" (in that
 *     order); answers a bare boolean.
 */
import { DEFAULT_TIMEOUT_MS, deadline, errorMessage, HttpError, qs, requestJson } from "@/api/http";
import { OPEN_CLOUD, ScopeError, type OpenCloud, type UserRestriction } from "@/api/opencloud";

const enc = encodeURIComponent;

export const MONEY_SCOPES = {
	passRead: "game-pass:read",
	passWrite: "game-pass:write",
	productRead: "developer-product:read",
	productWrite: "developer-product:write",
	badgeWrite: "legacy-universe.badge:write",
	badgeSpend: "legacy-universe.badge:manage-and-spend-robux",
	subscription: "universe:write",
	banRead: "universe.user-restriction:read",
	userAdvanced: "user.advanced:read",
	userSocial: "user.social:read",
	assetPermissions: "asset-permissions:write",
	badgeIcon: "legacy-badge:manage",
} as const;

/** Robux prices: a whole number from 1 (the doc gives no upper bound; this one only catches typos). */
export const PRICE_MAX = 1_000_000_000;

/** A price field's text as Robux, or an error message. */
export function parsePrice(text: string): { value: number } | { error: string } {
	const t = text.trim();
	if (!/^\d+$/.test(t)) return { error: "The price must be a whole number of Robux." };
	const n = Number(t);
	if (n < 1) return { error: "The price must be at least R$ 1." };
	if (n > PRICE_MAX) return { error: `The price can be at most R$ ${PRICE_MAX.toLocaleString()}.` };
	return { value: n };
}

// Multipart --------------------------------------------------------------------------------------------------------------

/** An image picked on the device, sent as a multipart file part (React Native's FormData reads {uri, name, type}). */
export interface IconFile {
	uri: string;
	name: string;
	type: string;
	size: number | null;
}

type FormFields = Record<string, string | number | boolean | IconFile | undefined | null>;

/**
 * A multipart/form-data Open Cloud call (requestJson only sends JSON). Same contract as OpenCloud.request: 30 s
 * deadline, HttpError with Roblox's message, ScopeError on 401 / 403. The key goes only into the x-api-key header for
 * apis.roblox.com (taken from the OpenCloud instance, never stored here).
 */
async function multipart<T>(
	cloud: OpenCloud,
	method: "POST" | "PATCH",
	path: string,
	fields: FormFields,
	scopes: string | string[],
	isScopeFailure: (error: HttpError) => boolean = () => true,
): Promise<T> {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		if (v === undefined || v === null) continue;
		// React Native's FormData streams a {uri, name, type} part from the file on disk.
		if (typeof v === "object") form.append(k, { uri: v.uri, name: v.name, type: v.type } as unknown as Blob);
		else form.append(k, String(v));
	}
	const where = `apis.roblox.com${path.split("?")[0]}`;
	const { signal, done } = deadline(DEFAULT_TIMEOUT_MS);
	let response: Response;
	try {
		// The key stays inside OpenCloud: this reads its (private) header builder, which only ever targets apis.roblox.com.
		response = await fetch(`${OPEN_CLOUD}${path}`, { method, headers: { accept: "application/json", ...cloud["headers"]() }, body: form, signal });
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
		const err = new HttpError(response.status, fallback ?? errorMessage(body, response.status), where, body);
		if ((response.status === 401 || response.status === 403) && isScopeFailure(err)) throw new ScopeError(err, typeof scopes === "string" ? [scopes] : scopes);
		throw err;
	}
	return body as T;
}

// Pricing ----------------------------------------------------------------------------------------------------------------

export type PriceFeature = "Invalid" | "PriceOptimization" | "UserFixedPrice" | "RegionalPricing";

export interface PriceInformation {
	defaultPriceInRobux: number | null;
	enabledFeatures: PriceFeature[];
}

/** Short labels for the enabled pricing features (list badges). */
export function featureLabels(info: { enabledFeatures?: string[] } | null | undefined): string[] {
	const f = info?.enabledFeatures ?? [];
	const out: string[] = [];
	if (f.includes("PriceOptimization")) out.push("price optimization");
	if (f.includes("RegionalPricing")) out.push("regional pricing");
	return out;
}

/** The fields a pass / product form writes (create sends every set field; update sends only changed ones). */
export interface ItemFields {
	name?: string;
	description?: string;
	isForSale?: boolean;
	price?: number;
	isRegionalPricingEnabled?: boolean;
	isManagedPricingEnabled?: boolean;
	/** A new icon (both kinds call the part imageFile). */
	imageFile?: IconFile;
}

// Game passes ------------------------------------------------------------------------------------------------------------

/** GamePassConfigV2 */
export interface GamePassConfig {
	gamePassId: number;
	name: string;
	description: string;
	isForSale: boolean;
	iconAssetId: number;
	createdTimestamp: string;
	updatedTimestamp: string;
	priceInformation: PriceInformation | null;
	isManagedPricingEnabled: boolean;
}

export function getGamePass(cloud: OpenCloud, universeId: number, gamePassId: number) {
	return cloud.request<GamePassConfig>("GET", `/game-passes/v1/universes/${universeId}/game-passes/${gamePassId}/creator`, undefined, undefined, MONEY_SCOPES.passRead);
}

export function createGamePass(cloud: OpenCloud, universeId: number, fields: ItemFields & { name: string }) {
	return multipart<GamePassConfig>(cloud, "POST", `/game-passes/v1/universes/${universeId}/game-passes`, { ...fields }, MONEY_SCOPES.passWrite);
}

/** Only the fields given change (204). */
export function updateGamePass(cloud: OpenCloud, universeId: number, gamePassId: number, fields: ItemFields) {
	return multipart<void>(cloud, "PATCH", `/game-passes/v1/universes/${universeId}/game-passes/${gamePassId}`, { ...fields }, MONEY_SCOPES.passWrite);
}

// Developer products -----------------------------------------------------------------------------------------------------

/** The developer product creator view (developer-products/v2 GET .../creator). */
export interface DeveloperProductConfig {
	productId: number;
	name: string;
	description: string;
	iconImageAssetId: number | null;
	universeId: number;
	isForSale: boolean;
	/** Deprecated by Roblox but still returned and writable. */
	storePageEnabled?: boolean | null;
	priceInformation: PriceInformation | null;
	isImmutable: boolean;
	createdTimestamp: string;
	updatedTimestamp: string;
	isManagedPricingEnabled: boolean;
}

export function getDeveloperProduct(cloud: OpenCloud, universeId: number, productId: number) {
	return cloud.request<DeveloperProductConfig>("GET", `/developer-products/v2/universes/${universeId}/developer-products/${productId}/creator`, undefined, undefined, MONEY_SCOPES.productRead);
}

export function createDeveloperProduct(cloud: OpenCloud, universeId: number, fields: ItemFields & { name: string }) {
	return multipart<DeveloperProductConfig>(cloud, "POST", `/developer-products/v2/universes/${universeId}/developer-products`, { ...fields }, MONEY_SCOPES.productWrite);
}

export function updateDeveloperProduct(cloud: OpenCloud, universeId: number, productId: number, fields: ItemFields & { storePageEnabled?: boolean }) {
	return multipart<void>(cloud, "PATCH", `/developer-products/v2/universes/${universeId}/developer-products/${productId}`, { ...fields }, MONEY_SCOPES.productWrite);
}

/** Every page of the creator lists (the Monetization list reads through opencloud.ts; these feed the player lookup). */
export async function allGamePasses(cloud: OpenCloud, universeId: number, maxPages = 10): Promise<{ id: number; name: string }[]> {
	const out: { id: number; name: string }[] = [];
	let token: string | undefined;
	for (let i = 0; i < maxPages; i++) {
		const r = await cloud.gamePasses(universeId, token);
		out.push(...(r.gamePasses ?? []).map((g) => ({ id: g.gamePassId, name: g.name })));
		if (!r.nextPageToken) break;
		token = r.nextPageToken;
	}
	return out;
}

// Badges -----------------------------------------------------------------------------------------------------------------

const BADGES = "https://badges.roblox.com";

export interface BadgeMetadata {
	badgeCreationPrice: number;
	maxBadgeNameLength: number;
	maxBadgeDescriptionLength: number;
	/** 0 when Roblox has no default icon (then a badge can't be created without an icon file). */
	defaultBadgeIconImageId: number;
}

export function badgeMetadata() {
	return requestJson<BadgeMetadata>(`${BADGES}/v1/badges/metadata`);
}

/** Free badges left for the current UTC day (a bare integer). */
export function freeBadgesQuota(universeId: number) {
	return requestJson<number>(`${BADGES}/v1/universes/${universeId}/free-badges-quota`);
}

export interface BadgeDetail {
	id: number;
	name: string;
	description: string | null;
	displayName?: string;
	displayDescription?: string | null;
	enabled: boolean;
	iconImageId: number;
	displayIconImageId?: number;
	created: string;
	updated: string;
	statistics?: { pastDayAwardedCount: number; awardedCount: number; winRatePercentage: number };
	awardingUniverse?: { id: number; name: string; rootPlaceId: number };
}

/** One badge (public badges v1). */
export function getBadge(badgeId: number) {
	return requestJson<BadgeDetail>(`${BADGES}/v1/badges/${badgeId}`);
}

/** The numeric code of Roblox's first `errors[]` entry, if any. */
function robloxErrorCode(error: HttpError): number | null {
	const errors = (error.body as { errors?: { code?: unknown }[] } | undefined)?.errors;
	const code = Array.isArray(errors) ? errors[0]?.code : undefined;
	return typeof code === "number" ? code : null;
}

/**
 * Whether a badge call's 401 / 403 is about the key's scopes. The doc lists 403s that aren't: 2 "You do not have
 * permission to manage this badge", 5 "no permission to manage this item" (icon), 6 "Text moderated", 12 "no permission to manage this game's badges", 17
 * "Insufficient funds", 28 "no permission to spend this group's funds". Those keep Roblox's own message.
 */
function badgeScopeFailure(error: HttpError): boolean {
	if (error.status === 401) return true;
	const code = robloxErrorCode(error);
	return code === null || code === 0;
}

/** Creates a badge under the universe's root place and charges `paymentSourceType` (1 user, 2 group) `expectedCost`. */
export function createBadge(
	cloud: OpenCloud,
	universeId: number,
	fields: { name: string; description: string; paymentSourceType: 1 | 2; expectedCost: number; isActive: boolean; files?: IconFile },
) {
	return multipart<BadgeDetail>(cloud, "POST", `/legacy-badges/v1/universes/${universeId}/badges`, { ...fields }, MONEY_SCOPES.badgeSpend, badgeScopeFailure);
}

/** JSON PATCH; a 403 only becomes a ScopeError when it isn't one of the doc's non-scope refusals (see badgeScopeFailure). */
export async function updateBadge(cloud: OpenCloud, badgeId: number, body: { name?: string; description?: string; enabled?: boolean }) {
	try {
		return await cloud.request<Record<string, never>>("PATCH", `/legacy-badges/v1/badges/${badgeId}`, body);
	} catch (error) {
		if (error instanceof HttpError && (error.status === 401 || error.status === 403) && badgeScopeFailure(error)) throw new ScopeError(error, [MONEY_SCOPES.badgeWrite]);
		throw error;
	}
}

/** Overwrites a badge's icon (legacy-publish; the localized-icon endpoint refuses the source language). */
export function uploadBadgeIcon(cloud: OpenCloud, badgeId: number, file: IconFile) {
	return multipart<{ targetId?: number }>(cloud, "POST", `/legacy-publish/v1/badges/${badgeId}/icon`, { Files: file }, MONEY_SCOPES.badgeIcon, badgeScopeFailure);
}

// Players ----------------------------------------------------------------------------------------------------------------

export interface Subscription {
	path: string;
	createTime?: string;
	updateTime?: string;
	active?: boolean;
	willRenew?: boolean;
	lastBillingTime?: string;
	nextRenewTime?: string;
	expireTime?: string;
	state?: "STATE_UNSPECIFIED" | "SUBSCRIBED_WILL_RENEW" | "SUBSCRIBED_WILL_NOT_RENEW" | "SUBSCRIBED_RENEWAL_PAYMENT_PENDING" | "EXPIRED";
	expirationDetails?: { reason?: "EXPIRATION_REASON_UNSPECIFIED" | "PRODUCT_INACTIVE" | "PRODUCT_DELETED" | "SUBSCRIBER_CANCELLED" | "SUBSCRIBER_REFUNDED" | "LAPSED" };
	purchasePlatform?: "PURCHASE_PLATFORM_UNSPECIFIED" | "DESKTOP" | "MOBILE";
	paymentProvider?: "PAYMENT_PROVIDER_UNSPECIFIED" | "STRIPE" | "APPLE" | "GOOGLE" | "ROBLOX_CREDIT" | "ROBUX";
	user?: string;
}

/** A subscription product id as Creator Hub shows it: "EXP-" and digits. */
export const SUBSCRIPTION_PRODUCT_ID = /^EXP-\d+$/;

/** One player's subscription to a product (subscription id = user id); FULL adds the billing fields. */
export function getSubscription(cloud: OpenCloud, universeId: number, productId: string, userId: number) {
	return cloud.request<Subscription>(
		"GET",
		`/cloud/v2/universes/${universeId}/subscription-products/${enc(productId)}/subscriptions/${userId}${qs({ view: "FULL" })}`,
		undefined,
		undefined,
		MONEY_SCOPES.subscription,
	);
}

/** The player's restriction in this universe (Roblox answers an inactive one when they were never banned). */
export function getUserRestriction(cloud: OpenCloud, universeId: number, userId: number) {
	return cloud.request<UserRestriction>("GET", `/cloud/v2/universes/${universeId}/user-restrictions/${userId}`, undefined, undefined, MONEY_SCOPES.banRead);
}

export interface CloudUser {
	path?: string | null;
	createTime?: string | null;
	id?: string | null;
	name?: string | null;
	displayName?: string | null;
	about?: string | null;
	locale?: string | null;
	premium?: boolean;
	idVerified?: boolean | null;
	socialNetworkProfiles?: {
		facebook?: string | null;
		twitter?: string | null;
		youtube?: string | null;
		twitch?: string | null;
		guilded?: string | null;
		visibility?: string;
	} | null;
}

/** Any key reads the basic fields; user.advanced:read adds idVerified, user.social:read the social links. */
export function getCloudUser(cloud: OpenCloud, userId: number) {
	return cloud.request<CloudUser>("GET", `/cloud/v2/users/${userId}`);
}

export interface InventoryItem {
	path: string;
	assetDetails?: { assetId: string; inventoryItemAssetType?: string; instanceId?: string };
	badgeDetails?: { badgeId: string };
	gamePassDetails?: { gamePassId: string };
	privateServerDetails?: { privateServerId: string };
	addTime?: string | null;
}

/**
 * Which of the given passes and badges the player has, from Open Cloud inventory-items (filtered by ID, 100 per page,
 * at most `maxPages`). Only meaningful when the inventory is visible (public, or the key belongs to the player).
 */
export async function ownedItems(cloud: OpenCloud, userId: number, ids: { gamePassIds: number[]; badgeIds: number[] }, maxPages = 10): Promise<InventoryItem[]> {
	const out: InventoryItem[] = [];
	const parts: string[] = [];
	if (ids.gamePassIds.length) parts.push(`gamePassIds=${ids.gamePassIds.join(",")}`);
	if (ids.badgeIds.length) parts.push(`badgeIds=${ids.badgeIds.join(",")}`);
	if (!parts.length) return out;
	let pageToken: string | undefined;
	for (let i = 0; i < maxPages; i++) {
		const r = await cloud.request<{ inventoryItems?: InventoryItem[]; nextPageToken?: string }>(
			"GET",
			`/cloud/v2/users/${userId}/inventory-items${qs({ maxPageSize: 100, pageToken, filter: parts.join(";") })}`,
		);
		out.push(...(r.inventoryItems ?? []));
		if (!r.nextPageToken) break;
		pageToken = r.nextPageToken;
	}
	return out;
}

/** inventory v1 itemType, in the doc's order (Asset, GamePass, Badge, Bundle). */
export const ITEM_TYPES = [
	{ value: 0, label: "Asset" },
	{ value: 1, label: "Game pass" },
	{ value: 2, label: "Badge" },
	{ value: 3, label: "Bundle" },
] as const;

export function isOwned(userId: number, itemType: number, itemId: number) {
	return requestJson<boolean>(`https://inventory.roblox.com/v1/users/${userId}/items/${itemType}/${itemId}/is-owned`);
}

export function canViewInventory(userId: number) {
	return requestJson<{ canView: boolean }>(`https://inventory.roblox.com/v1/users/${userId}/can-view-inventory`);
}

export function usernameHistory(userId: number, cursor?: string) {
	return requestJson<{ previousPageCursor?: string | null; nextPageCursor?: string | null; data: { name: string }[] }>(
		`https://users.roblox.com/v1/users/${userId}/username-history${qs({ limit: 50, sortOrder: "Desc", cursor })}`,
	);
}

// Asset permissions ------------------------------------------------------------------------------------------------------

export type AssetGrantError =
	| "UnknownError"
	| "InvalidRequest"
	| "AssetNotFound"
	| "CannotManageAsset"
	| "PublicAssetCannotBeGrantedTo"
	| "CannotManageSubject"
	| "SubjectNotFound"
	| "AssetTypeNotEnabled"
	| "PermissionLimitReached"
	| "DependenciesLimitReached"
	| "NotRequestable"
	| "RequesterNotAConnection"
	| "AlreadyPending"
	| "AlreadyHasAccess"
	| "RequestNotFound"
	| "InvalidRequestStatus"
	| "RateLimited"
	| "CallerNotOwner"
	| "BatchSizeLimitExceeded";

/** Lets the experience use these assets (audio, meshes, … the key owner manages). */
export function grantAssetUse(cloud: OpenCloud, universeId: number, assetIds: number[], grantToDependencies: boolean) {
	return cloud.request<{ successAssetIds?: number[] | null; errors?: { assetId: number; code: AssetGrantError }[] | null }>(
		"PATCH",
		"/asset-permissions-api/v1/assets/permissions",
		{ subjectType: "Universe", subjectId: String(universeId), action: "Use", requests: assetIds.map((assetId) => ({ assetId, grantToDependencies })) },
		undefined,
		MONEY_SCOPES.assetPermissions,
	);
}
