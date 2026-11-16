/**
 * The app's accounts, all on this device (expo-secure-store, never sent anywhere but where they belong):
 *   - the Open Cloud API key (tt.oc.key)          -> only to apis.roblox.com
 *   - the TypeTorch backends (tt.backends, JSON)  -> metadata only
 *   - one mobile token per backend (tt.backend.<id>.token) -> only to that backend
 *   - preferences (tt.prefs)
 * Tokens near their end (< 15 days) are refreshed when the app starts.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createApi, type Api } from "@/api/backend";
import { logout as backendLogout, needsRefresh, refreshFailure, refreshToken, type MobileToken } from "@/api/backend-auth";
import { introspectKey, OpenCloud, type KeyInfo } from "@/api/opencloud";
import { resetProductLoader } from "@/features/typetorch/product-loader";
import type { AuthRole, AuthUser } from "@/api/tt/types";
import type { Appearance } from "@/theme";

const KEY_OC = "tt.oc.key";
const KEY_BACKENDS = "tt.backends";
const KEY_PREFS = "tt.prefs";
const tokenKey = (id: string) => `tt.backend.${id}.token`;

export interface Prefs {
	appearance: Appearance;
	/** The Roblox user whose experiences and groups to list (defaults to the key's owner). */
	userId: number | null;
	/** Include a group's experiences when my rank there is at least this (255 = owner). */
	groupMinRank: number;
	/** Universes added by hand (e.g. a place id looked up). */
	extraUniverseIds: number[];
}

const DEFAULT_PREFS: Prefs = { appearance: "system", userId: null, groupMinRank: 255, extraUniverseIds: [] };

export interface BackendAccount {
	id: string;
	url: string;
	/** The game name the backend reported (or the host). */
	name: string;
	universeId: number | null;
	tokenId: string;
	expiresAt: number;
	role: AuthRole;
	user: AuthUser | null;
	version?: string;
	addedAt: number;
	/** The token was refused (revoked / expired): sign in again. */
	signedOut?: boolean;
}

interface AccountsValue {
	ready: boolean;
	prefs: Prefs;
	setPrefs: (patch: Partial<Prefs>) => Promise<void>;
	hasKey: boolean;
	keyInfo: KeyInfo | null;
	keyLoading: boolean;
	keyError: Error | null;
	cloud: OpenCloud | null;
	/** Checks the key with Roblox, then keeps it. Throws with Roblox's message when the key is refused. */
	saveKey: (key: string) => Promise<KeyInfo>;
	removeKey: () => Promise<void>;
	backends: BackendAccount[];
	addBackend: (url: string, token: MobileToken, meta: { name: string; universeId: number | null; version?: string }) => Promise<BackendAccount>;
	updateBackend: (id: string, patch: Partial<BackendAccount>) => Promise<void>;
	/** Logs out on the backend (best effort) and forgets it here. */
	removeBackend: (id: string) => Promise<void>;
	/** Replaces a backend's token (sign in again), with other fields to change in the same write (e.g. universeId). */
	replaceToken: (id: string, token: MobileToken, patch?: Partial<BackendAccount>) => Promise<void>;
	backendApi: (id: string) => Api | null;
	backendToken: (id: string) => string | null;
	backendForUniverse: (universeId: number) => BackendAccount[];
}

const AccountsContext = createContext<AccountsValue | null>(null);

async function readJson<T>(key: string, fallback: T): Promise<T> {
	try {
		const text = await SecureStore.getItemAsync(key);
		return text ? ({ ...fallback, ...JSON.parse(text) } as T) : fallback;
	} catch {
		return fallback;
	}
}

async function readList<T>(key: string): Promise<T[]> {
	try {
		const text = await SecureStore.getItemAsync(key);
		const parsed = text ? JSON.parse(text) : [];
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
}

function newId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function AccountsProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const [ready, setReady] = useState(false);
	const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
	const [ocKey, setOcKey] = useState<string | null>(null);
	const [backends, setBackendsState] = useState<BackendAccount[]>([]);
	/** The latest list, so writes that follow each other in one handler build on each other, not on a stale render. */
	const backendsRef = useRef<BackendAccount[]>([]);
	const tokens = useRef(new Map<string, string>());
	const [tokenVersion, setTokenVersion] = useState(0);

	const setBackends = useCallback((next: BackendAccount[]) => {
		backendsRef.current = next;
		setBackendsState(next);
	}, []);

	/** Applies `update` to the LATEST list (not the one this render saw), then saves it. */
	const persistBackends = useCallback(
		async (update: (list: BackendAccount[]) => BackendAccount[]) => {
			const next = update(backendsRef.current);
			setBackends(next);
			await SecureStore.setItemAsync(KEY_BACKENDS, JSON.stringify(next));
		},
		[setBackends],
	);

	// Load everything once.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			const [p, key, list] = await Promise.all([readJson<Prefs>(KEY_PREFS, DEFAULT_PREFS), SecureStore.getItemAsync(KEY_OC).catch(() => null), readList<BackendAccount>(KEY_BACKENDS)]);
			for (const b of list) {
				const t = await SecureStore.getItemAsync(tokenKey(b.id)).catch(() => null);
				if (t) tokens.current.set(b.id, t);
			}
			// Refresh tokens that end within 15 days BEFORE any screen uses them: the backend revokes the old token the
			// moment it answers a refresh, so the new one is saved first. A failed refresh keeps the old token.
			const loaded: BackendAccount[] = [];
			for (const b of list) {
				const t = tokens.current.get(b.id);
				if (!t || b.signedOut || !needsRefresh(b.expiresAt)) {
					loaded.push(b);
					continue;
				}
				try {
					const next = await refreshToken(b.url, t);
					await SecureStore.setItemAsync(tokenKey(b.id), next.token);
					tokens.current.set(b.id, next.token);
					loaded.push({ ...b, tokenId: next.id || b.tokenId, expiresAt: next.expiresAt, role: next.role, user: next.user ?? b.user });
				} catch (error) {
					// A dead token (401) or a sign-in too old to renew (403 mobile_signin_too_old) shows as signed out; a refresh
					// already running (409) or a network error keeps the token for the next start.
					loaded.push(refreshFailure(error) === "signed_out" ? { ...b, signedOut: true } : b);
				}
			}
			if (loaded.some((b, i) => b !== list[i])) await SecureStore.setItemAsync(KEY_BACKENDS, JSON.stringify(loaded)).catch(() => undefined);
			if (cancelled) return;
			setPrefsState(p);
			setOcKey(key);
			setBackends(loaded);
			setTokenVersion((v) => v + 1);
			setReady(true);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const keyQuery = useQuery({
		queryKey: ["oc-introspect", ocKey ? ocKey.slice(-6) : null],
		queryFn: () => introspectKey(ocKey as string),
		enabled: !!ocKey,
		staleTime: 10 * 60_000,
		retry: 1,
	});

	const cloud = useMemo(() => (ocKey ? new OpenCloud(ocKey) : null), [ocKey]);

	const prefsRef = useRef(prefs);
	prefsRef.current = prefs;
	const setPrefs = useCallback(async (patch: Partial<Prefs>) => {
		const next = { ...prefsRef.current, ...patch };
		prefsRef.current = next;
		setPrefsState(next);
		await SecureStore.setItemAsync(KEY_PREFS, JSON.stringify(next));
	}, []);

	const saveKey = useCallback(
		async (key: string) => {
			const trimmed = key.trim();
			if (!trimmed) throw new Error("paste an Open Cloud API key");
			const info = await introspectKey(trimmed);
			if (!info.enabled) throw new Error("this key is disabled on Creator Hub");
			if (info.expired) throw new Error("this key has expired");
			await SecureStore.setItemAsync(KEY_OC, trimmed);
			queryClient.setQueryData(["oc-introspect", trimmed.slice(-6)], info);
			setOcKey(trimmed);
			await queryClient.invalidateQueries({ queryKey: ["projects"] });
			return info;
		},
		[queryClient],
	);

	const removeKey = useCallback(async () => {
		await SecureStore.deleteItemAsync(KEY_OC);
		setOcKey(null);
		queryClient.removeQueries({ queryKey: ["oc"] });
		await queryClient.invalidateQueries({ queryKey: ["projects"] });
	}, [queryClient]);

	const addBackend = useCallback(
		async (url: string, token: MobileToken, meta: { name: string; universeId: number | null; version?: string }) => {
			const account: BackendAccount = {
				id: newId(),
				url,
				name: meta.name,
				universeId: meta.universeId,
				tokenId: token.id,
				expiresAt: token.expiresAt,
				role: token.role,
				user: token.user,
				...(meta.version ? { version: meta.version } : {}),
				addedAt: Date.now(),
			};
			await SecureStore.setItemAsync(tokenKey(account.id), token.token);
			tokens.current.set(account.id, token.token);
			setTokenVersion((v) => v + 1);
			await persistBackends((list) => [...list, account]);
			return account;
		},
		[persistBackends],
	);

	const updateBackend = useCallback(
		async (id: string, patch: Partial<BackendAccount>) => {
			await persistBackends((list) => list.map((b) => (b.id === id ? { ...b, ...patch, id } : b)));
		},
		[persistBackends],
	);

	const replaceToken = useCallback(
		async (id: string, token: MobileToken, patch: Partial<BackendAccount> = {}) => {
			await SecureStore.setItemAsync(tokenKey(id), token.token);
			tokens.current.set(id, token.token);
			setTokenVersion((v) => v + 1);
			resetProductLoader(id);
			await persistBackends((list) =>
				list.map((b) =>
					b.id === id ? { ...b, ...patch, id, tokenId: token.id, expiresAt: token.expiresAt, role: token.role, user: token.user ?? b.user, signedOut: false } : b,
				),
			);
			queryClient.removeQueries({ queryKey: ["tt", id] });
		},
		[persistBackends, queryClient],
	);

	const removeBackend = useCallback(
		async (id: string) => {
			const b = backendsRef.current.find((x) => x.id === id);
			const t = tokens.current.get(id);
			if (b && t) await backendLogout(b.url, t).catch(() => undefined);
			await SecureStore.deleteItemAsync(tokenKey(id)).catch(() => undefined);
			tokens.current.delete(id);
			setTokenVersion((v) => v + 1);
			resetProductLoader(id);
			queryClient.removeQueries({ queryKey: ["tt", id] });
			await persistBackends((list) => list.filter((x) => x.id !== id));
		},
		[persistBackends, queryClient],
	);

	// One API client per backend and token.
	const apis = useMemo(() => {
		const map = new Map<string, Api>();
		for (const b of backends) {
			const t = tokens.current.get(b.id);
			if (!t) continue;
			map.set(
				b.id,
				createApi({
					base: b.url,
					token: t,
					// A 401 on a mobile token (code mobile_token_dead) means revoked / expired / replaced: sign in again.
					onUnauthorized: () => {
						// An Api built for an older token (renewed or signed in again since) says nothing about the new one.
						if (tokens.current.get(b.id) !== t) return;
						persistBackends((list) => list.map((x) => (x.id === b.id ? { ...x, signedOut: true } : x))).catch(() => undefined);
					},
				}),
			);
		}
		return map;
		// tokenVersion: the token map changed.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [backends, tokenVersion]);

	const value: AccountsValue = {
		ready,
		prefs,
		setPrefs,
		hasKey: !!ocKey,
		keyInfo: keyQuery.data ?? null,
		keyLoading: keyQuery.isLoading,
		keyError: (keyQuery.error as Error | null) ?? null,
		cloud,
		saveKey,
		removeKey,
		backends,
		addBackend,
		updateBackend,
		removeBackend,
		replaceToken,
		backendApi: (id) => apis.get(id) ?? null,
		backendToken: (id) => tokens.current.get(id) ?? null,
		backendForUniverse: (universeId) => backends.filter((b) => b.universeId === universeId),
	};

	return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts(): AccountsValue {
	const value = useContext(AccountsContext);
	if (!value) throw new Error("useAccounts outside AccountsProvider");
	return value;
}

/** The backend account and its API client for a route's backendId. */
export function useBackend(backendId: string | undefined): { account: BackendAccount | null; api: Api | null } {
	const { backends, backendApi } = useAccounts();
	const account = backends.find((b) => b.id === backendId) ?? null;
	return { account, api: account ? backendApi(account.id) : null };
}
