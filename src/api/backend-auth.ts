/**
 * Signing in to a TypeTorch backend from the app. EVERY mobile auth shape lives in this file, so adjusting to the
 * backend (written in parallel) is one edit here. Expected endpoints:
 *
 *   GET  <backend>/auth/mobile/start?redirect_uri=&state=&code_challenge=&code_challenge_method=S256&device=
 *        (browser page: the person signs in, the backend redirects to redirect_uri?code=&state=)
 *   POST <backend>/v1/auth/mobile/token  { code, code_verifier, device }                      -> MobileToken
 *   POST <backend>/v1/auth/mobile/token  { device } + Authorization: Bearer <admin token>     -> MobileToken
 *   POST <backend>/v1/auth/mobile/refresh  (Bearer <mobile token>)                           -> MobileToken
 *   POST <backend>/v1/auth/mobile/logout   (Bearer <mobile token>)
 *   GET  <backend>/v1/auth/mobile/tokens   (Bearer)                                          -> { tokens: MobileSession[] }
 *   DELETE <backend>/v1/auth/mobile/tokens/<id>  (Bearer)
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

/** "https://x.example.com/" or "x.example.com" -> "https://x.example.com" (http only for LAN / localhost testing). */
export function normalizeBackendUrl(input: string): string {
	let url = input.trim();
	if (!url) throw new Error("enter the backend's address");
	if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
	const parsed = new URL(url);
	const path = parsed.pathname.replace(/\/+$/, "");
	return `${parsed.protocol}//${parsed.host}${path}`;
}

export function deviceLabel(): string {
	const name = Device.deviceName ?? Device.modelName ?? "phone";
	return `TypeTorch app on ${name}`.slice(0, 80);
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

/**
 * (a) Browser sign-in: opens <backend>/auth/mobile/start in an auth session, waits for the redirect with a code, and
 * trades it for a token. Answers null when the person closed the browser.
 */
export async function signInWithBrowser(backendUrl: string, device = deviceLabel()): Promise<MobileToken | null> {
	const { verifier, challenge, state } = await createPkce();
	const redirect = redirectUri();
	const params = new URLSearchParams({ redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: "S256", device });
	const result = await WebBrowser.openAuthSessionAsync(`${backendUrl}/auth/mobile/start?${params.toString()}`, redirect);
	if (result.type !== "success") return null;
	const parsed = Linking.parse(result.url);
	const q = parsed.queryParams ?? {};
	const one = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "");
	if (one(q.error)) throw new Error(`sign-in failed: ${one(q.error_description) || one(q.error)}`);
	if (one(q.state) !== state) throw new Error("sign-in failed: the answer's state doesn't match (start again)");
	const code = one(q.code);
	if (!code) throw new Error("sign-in failed: no code in the answer");
	const body = await requestJson<unknown>(`${backendUrl}/v1/auth/mobile/token`, { body: { code, code_verifier: verifier, device } });
	return parseMobileToken(body);
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

export async function refreshToken(backendUrl: string, token: string): Promise<MobileToken> {
	const body = await requestJson<unknown>(`${backendUrl}/v1/auth/mobile/refresh`, { headers: { authorization: `Bearer ${token}` }, body: {} });
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

export async function listSessions(backendUrl: string, token: string, currentId?: string): Promise<MobileSession[]> {
	const body = await requestJson<Record<string, unknown>>(`${backendUrl}/v1/auth/mobile/tokens`, { headers: { authorization: `Bearer ${token}` } });
	const list = Array.isArray(body?.tokens) ? body.tokens : Array.isArray(body?.sessions) ? body.sessions : Array.isArray(body) ? (body as unknown[]) : [];
	return (list as Record<string, unknown>[]).map((t) => {
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

export async function revokeSession(backendUrl: string, token: string, id: string): Promise<void> {
	await requestJson<unknown>(`${backendUrl}/v1/auth/mobile/tokens/${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
}
