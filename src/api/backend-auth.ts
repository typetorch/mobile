/**
 * Signing in to a TypeTorch backend from the app. EVERY mobile auth shape lives in this file, so adjusting to the
 * backend (written in parallel) is one edit here. Expected endpoints:
 *
 *   GET  <backend>/auth/mobile/start?redirect_uri=&state=&code_challenge=&code_challenge_method=S256&device=<max 64>
 *        (browser page: the person signs in, the backend redirects to redirect_uri?code=&state=, or
 *        ?error=access_denied|not_owner|not_blessed|state|failed&state=)
 *   POST <backend>/v1/auth/mobile/token  { code, code_verifier }                              -> MobileToken (400 invalid_grant)
 *   POST <backend>/v1/auth/mobile/token  { device } + Authorization: Bearer <admin token>     -> MobileToken
 *   POST <backend>/v1/auth/mobile/refresh  (Bearer <mobile token>)  -> MobileToken; the old token is revoked at once
 *   POST <backend>/v1/auth/mobile/logout   (Bearer <mobile token>)  -> { ok: true }
 *   GET  <backend>/v1/auth/mobile/tokens[?all=1]  (Bearer)  -> { tokens: [{ id, device, user, role, createdAt, expiresAt,
 *        lastUsedAt, revokedAt?, revokeReason?, current? }], lifetimeDays }. An admin gets EVERY user's tokens, others
 *        only their own; ?all=1 adds revoked and expired rows (it does not widen whose tokens are listed).
 *   DELETE <backend>/v1/auth/mobile/tokens/<id>  (Bearer)
 *   GET  <backend>/v1/auth/check -> always game: { universeId|null, label|null }; a 401 says mobileLogin: true|false
 *        (whether browser sign-in exists); with a mobile token: mobile: { id, expiresAt }
 *   Any route, dead token: 401 { code: "mobile_token_dead", reason } -> the backend shows as signed out.
 *
 * Redirect URIs: the backend allows typetorch://... only, unless it sets TYPETORCH_MOBILE_DEV_REDIRECTS=on (then
 * exp:// and exps:// too, which Expo Go needs). Without it the browser comes back without a code; the admin token
 * path is the fallback.
 *
 * Tokens look like `ttm_<id>_<secret>` and live 30-90 days; the app refreshes one when fewer than 15 days remain.
 */
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { HttpError, requestJson } from "./http";
import type { AuthRole, AuthUser } from "./tt/types";

export interface MobileToken {
	token: string;
	id: string;
	/** Unix ms. */
	expiresAt: number;
	role: AuthRole;
	user: AuthUser | null;
}

export interface MobileSession {
	id: string;
	device: string | null;
	role: AuthRole | null;
	createdAt: number | null;
	lastUsedAt: number | null;
	expiresAt: number | null;
	/** The token this app is using. */
	current: boolean;
	user: AuthUser | null;
}

export const REFRESH_WHEN_DAYS_LEFT = 15;
const DAY_MS = 86_400_000;

/** The host part of `host[:port]` ("[::1]:3000" -> "::1"), lower case. */
function hostName(host: string): string {
	const h = host.toLowerCase();
	if (h.startsWith("[")) return h.slice(1, h.indexOf("]") > 0 ? h.indexOf("]") : undefined);
	return h.replace(/:\d+$/, "");
}

/** localhost, loopback, the private IPv4 ranges (10/8, 172.16/12, 192.168/16, link-local) and *.local: LAN testing only. */
export function isLocalHost(host: string): boolean {
	const h = hostName(host);
	if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1") return true;
	const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (!ip) return false;
	const [a, b] = [Number(ip[1]), Number(ip[2])];
	return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** A backend address without TLS: tokens to it travel in the clear (allowed only for local hosts, see normalizeBackendUrl). */
export function isUnencrypted(url: string): boolean {
	return /^http:\/\//i.test(url.trim());
}

export const UNENCRYPTED_HINT = "Not encrypted (http://): anyone on this network can read the tokens sent to it. Use it only for local testing.";

/**
 * "https://x.example.com/" or "x.example.com" -> "https://x.example.com". http:// only for localhost and LAN addresses:
 * the admin token, the sign-in code and every ttm_ token would otherwise cross the network in the clear (and a server
 * that redirects http to https still gets each request in the clear first).
 */
export function normalizeBackendUrl(input: string): string {
	let url = input.trim();
	if (!url) throw new Error("enter the backend's address");
	if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
	const parsed = new URL(url);
	const path = parsed.pathname.replace(/\/+$/, "");
	if (parsed.protocol === "http:" && !isLocalHost(parsed.host))
		throw new Error("http:// is only allowed for localhost and LAN addresses: use https:// (the tokens would cross the network unencrypted)");
	return `${parsed.protocol}//${parsed.host}${path}`;
}

export function deviceLabel(): string {
	const name = Device.deviceName ?? Device.modelName ?? "phone";
	return `TypeTorch app on ${name}`.slice(0, 64);
}

/** Expo Go's redirect (exp:// / exps://): the backend must set TYPETORCH_MOBILE_DEV_REDIRECTS=on for browser sign-in. */
export function isDevRedirect(uri = redirectUri()): boolean {
	return /^exps?:\/\//i.test(uri);
}

export const DEV_REDIRECT_HINT =
	"This backend doesn't allow Expo Go redirects (exp://). Set TYPETORCH_MOBILE_DEV_REDIRECTS=on on the backend, use the installed app (typetorch://), or paste the admin token instead.";

const SIGN_IN_ERRORS: Record<string, string> = {
	access_denied: "sign-in was cancelled or refused",
	not_owner: "this Roblox account isn't an owner of the game",
	not_blessed: "this browser isn't trusted for admin on the backend yet",
	state: "the sign-in session expired; start again",
	failed: "the backend couldn't finish the sign-in",
};

/** What the backend offers before sign-in: GET /v1/auth/check without a token answers 401 { mobileLogin }. */
export async function loginOptions(backendUrl: string): Promise<{ mobileLogin: boolean | null }> {
	try {
		const body = await requestJson<Record<string, unknown>>(`${backendUrl}/v1/auth/check`, { timeoutMs: 15_000 });
		return { mobileLogin: typeof body?.mobileLogin === "boolean" ? body.mobileLogin : null };
	} catch (error) {
		if (error instanceof HttpError && error.body && typeof error.body === "object") {
			const b = error.body as Record<string, unknown>;
			if (typeof b.mobileLogin === "boolean") return { mobileLogin: b.mobileLogin };
		}
		if (error instanceof HttpError && error.status === 401) return { mobileLogin: null };
		throw error;
	}
}

/** A 401 that means this mobile token is dead for good (revoked, expired, replaced by a refresh). */
export function isDeadToken(status: number, body: unknown): boolean {
	return status === 401 && !!body && typeof body === "object" && (body as Record<string, unknown>).code === "mobile_token_dead";
}

function toMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
	if (typeof value === "string") {
		if (/^\d+$/.test(value)) return toMs(Number(value));
		const t = Date.parse(value);
		return Number.isFinite(t) ? t : null;
	}
	return null;
}

function role(value: unknown): AuthRole {
	return value === "admin" || value === "game" ? value : "web";
}

/** The token answer, read tolerantly (expiresAt as ms, seconds or ISO). */
export function parseMobileToken(body: unknown): MobileToken {
	const b = (body ?? {}) as Record<string, unknown>;
	const inner = (b.token && typeof b.token === "object" ? b.token : b) as Record<string, unknown>;
	const token = typeof inner.token === "string" ? inner.token : typeof b.token === "string" ? b.token : "";
	if (!token) throw new Error("the backend answered without a token");
	const idFromToken = /^ttm_([^_]+)_/.exec(token)?.[1];
	return {
		token,
		id: String(inner.id ?? b.id ?? idFromToken ?? ""),
		expiresAt: toMs(inner.expiresAt ?? b.expiresAt) ?? Date.now() + 30 * DAY_MS,
		role: role(inner.role ?? b.role),
		user: ((inner.user ?? b.user) as AuthUser | undefined) ?? null,
	};
}

function base64url(bytes: Uint8Array): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] ?? 0;
		const b = bytes[i + 1];
		const c = bytes[i + 2];
		out += chars[a >> 2];
		out += chars[((a & 3) << 4) | ((b ?? 0) >> 4)];
		if (b !== undefined) out += chars[((b & 15) << 2) | ((c ?? 0) >> 6)];
		if (c !== undefined) out += chars[c & 63];
	}
	return out;
}

/** PKCE (RFC 7636): a random verifier and its S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string; state: string }> {
	const verifier = base64url(Crypto.getRandomBytes(32));
	const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
	const challenge = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	const state = base64url(Crypto.getRandomBytes(16));
	return { verifier, challenge, state };
}

/** The deep link the backend sends the browser back to (typetorch://auth, or exp://.../--/auth in Expo Go). */
export function redirectUri(): string {
	return Linking.createURL("auth");
}

/** The browser sign-in's outcome: a token, or why there is none (closed, or no code came back). */
export type BrowserSignIn = { token: MobileToken } | { cancelled: true; hint?: string };

/**
 * (a) Browser sign-in: opens <backend>/auth/mobile/start in an auth session, waits for the redirect with a code, and
 * trades it for a token (the device name goes on the start URL, not in the exchange).
 */
export async function signInWithBrowser(backendUrl: string, device = deviceLabel()): Promise<BrowserSignIn> {
	const { verifier, challenge, state } = await createPkce();
	const redirect = redirectUri();
	const params = new URLSearchParams({ redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: "S256", device: device.slice(0, 64) });
	const result = await WebBrowser.openAuthSessionAsync(`${backendUrl}/auth/mobile/start?${params.toString()}`, redirect);
	// Closed without coming back: in Expo Go that is usually the backend refusing the exp:// redirect.
	if (result.type !== "success") return isDevRedirect(redirect) ? { cancelled: true, hint: DEV_REDIRECT_HINT } : { cancelled: true };
	const parsed = Linking.parse(result.url);
	const q = parsed.queryParams ?? {};
	const one = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "");
	const err = one(q.error);
	if (err) throw new Error(`sign-in failed: ${SIGN_IN_ERRORS[err] ?? err}`);
	if (one(q.state) !== state) throw new Error("sign-in failed: the answer's state doesn't match (start again)");
	const code = one(q.code);
	if (!code) throw new Error(isDevRedirect(redirect) ? DEV_REDIRECT_HINT : "sign-in failed: no code in the answer");
	try {
		const body = await requestJson<unknown>(`${backendUrl}/v1/auth/mobile/token`, { body: { code, code_verifier: verifier } });
		return { token: parseMobileToken(body) };
	} catch (error) {
		if (error instanceof HttpError && error.status === 400) throw new Error("sign-in failed: the code was refused (invalid_grant); start again");
		throw error;
	}
}

/** (b) The admin token, once: trades it for a mobile token. The admin token is not kept anywhere. */
export async function signInWithAdminToken(backendUrl: string, adminToken: string, device = deviceLabel()): Promise<MobileToken> {
	const body = await requestJson<unknown>(`${backendUrl}/v1/auth/mobile/token`, {
		headers: { authorization: `Bearer ${adminToken.trim()}` },
		body: { device },
	});
	return parseMobileToken(body);
}

export function needsRefresh(expiresAt: number, now = Date.now()): boolean {
	return expiresAt - now < REFRESH_WHEN_DAYS_LEFT * DAY_MS;
}

/** A new token for an old one. The backend revokes the old token at once: save the new one before anything else runs. */
export async function refreshToken(backendUrl: string, token: string): Promise<MobileToken> {
	const body = await requestJson<unknown>(`${backendUrl}/v1/auth/mobile/refresh`, { headers: { authorization: `Bearer ${token}` }, body: {}, timeoutMs: 10_000 });
	return parseMobileToken(body);
}

/** Ends the session on the backend; a 401 (already gone) is fine. */
export async function logout(backendUrl: string, token: string): Promise<void> {
	try {
		await requestJson<unknown>(`${backendUrl}/v1/auth/mobile/logout`, { headers: { authorization: `Bearer ${token}` }, body: {} });
	} catch (error) {
		if (error instanceof HttpError && (error.status === 401 || error.status === 404)) return;
		throw error;
	}
}

/**
 * The live app sessions the backend shows this token: an admin gets every user's, others only their own (filter with
 * `sameSessionUser` for "mine"). Revoked and expired ones are left out (the list is asked without ?all=1).
 */
export async function listSessions(backendUrl: string, token: string, currentId?: string): Promise<MobileSession[]> {
	const body = await requestJson<Record<string, unknown>>(`${backendUrl}/v1/auth/mobile/tokens`, { headers: { authorization: `Bearer ${token}` } });
	const list = Array.isArray(body?.tokens) ? body.tokens : [];
	const now = Date.now();
	return (list as Record<string, unknown>[]).filter((t) => {
		if (t.revokedAt) return false;
		const ends = toMs(t.expiresAt);
		return ends === null || ends > now;
	}).map((t) => {
		const id = String(t.id ?? "");
		return {
			id,
			device: typeof t.device === "string" ? t.device : null,
			role: t.role ? role(t.role) : null,
			createdAt: toMs(t.createdAt),
			lastUsedAt: toMs(t.lastUsedAt ?? t.lastUsed),
			expiresAt: toMs(t.expiresAt),
			current: t.current === true || (!!currentId && id === currentId),
			user: (t.user as AuthUser | undefined) ?? null,
		};
	});
}

/** The same user, as the backend counts it (the admin token is one user; Roblox users by id). */
export function sameSessionUser(a: AuthUser | null | undefined, b: AuthUser | null | undefined): boolean {
	if (!a || !b) return false;
	if (a.kind === "token" || b.kind === "token") return a.kind === b.kind;
	return a.userId === b.userId;
}

export async function revokeSession(backendUrl: string, token: string, id: string): Promise<void> {
	await requestJson<unknown>(`${backendUrl}/v1/auth/mobile/tokens/${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
}
