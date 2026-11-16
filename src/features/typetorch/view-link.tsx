/**
 * What the web keeps in the URL, for the phone: a page's own parameters (a picked funnel, a sheet that is open, the
 * Performance grouping, ...) live in the screen's route params (expo-router), so they survive going back and forth and
 * travel in a link. "Copy link to this view" writes a link (Linking.createURL) with the page, its parameters, the filter
 * bar (web keys) and every table's view on the screen (`<table>.sort=-players`, `<table>.f.<column>=…`), plus
 * `backend=<url>` so another phone with the same backend connected opens it too.
 *
 * In an installed build (APK, dev build) the link is typetorch://tt/…. In Expo Go, Linking.createURL ignores the app's
 * scheme and gives exp://<dev server host>:<port>/--/tt/…: that opens only in Expo Go on a phone that reaches the same
 * Metro dev server. So Expo Go also offers the typetorch:// form, built by hand, for a phone with the installed app.
 */
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams, usePathname } from "expo-router";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { Share } from "react-native";

import { DEFAULT_RANGE, FILTER_KEYS, currentTTFilters, filtersToParams } from "./filters";

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
	return Array.isArray(v) ? v[0] : v;
}

/** One page-level parameter (pid, funnel, facet, ...) in the route, like the web's useParam. "" / the fallback removes it. */
export function usePageParam(key: string, fallback = ""): [string, (value: string) => void] {
	const params = useLocalSearchParams<RawParams>();
	const raw = first(params[key]);
	const value = raw === undefined || raw === "" ? fallback : raw;
	const set = useCallback(
		(next: string) => {
			router.setParams({ [key]: next && next !== fallback ? next : undefined });
		},
		[key, fallback],
	);
	return [value, set];
}

/** Several page-level parameters at once: `set({ a: "1", b: null })` (null / "" removes a key), the rest kept. */
export function usePageParams(): [Record<string, string>, (patch: Record<string, string | null | undefined>) => void] {
	const params = useLocalSearchParams<RawParams>();
	const flat = useMemo(() => {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(params)) {
			const s = first(v);
			if (typeof s === "string" && s !== "") out[k] = s;
		}
		return out;
	}, [params]);
	const set = useCallback((patch: Record<string, string | null | undefined>) => {
		const next: Record<string, string | undefined> = {};
		for (const [k, v] of Object.entries(patch)) next[k] = v ? v : undefined;
		router.setParams(next);
	}, []);
	return [flat, set];
}

/** A number parameter (an index, hours) with a fallback. */
export function useNumberParam(key: string, fallback: number): [number, (value: number) => void] {
	const [raw, setRaw] = usePageParam(key, String(fallback));
	const n = Number(raw);
	const value = Number.isFinite(n) ? n : fallback;
	return [value, useCallback((v: number) => setRaw(String(v)), [setRaw])];
}

/** A boolean parameter ("1" when on). */
export function useFlagParam(key: string, fallback = false): [boolean, (on: boolean) => void] {
	const [raw, setRaw] = usePageParam(key, fallback ? "1" : "");
	const value = raw === "1" || raw === "true";
	return [value, useCallback((on: boolean) => setRaw(on === fallback ? (fallback ? "1" : "") : on ? "1" : "0"), [setRaw, fallback])];
}

// Tables on a screen register what they'd write into a link -------------------------------------------------------------

export interface ViewLinkRegistry {
	/** A table adds its view's parameters to the screen's links; returns the unregister. */
	register(id: string, params: () => Record<string, string>): () => void;
	params(): Record<string, string>;
}

const RegistryContext = createContext<ViewLinkRegistry | null>(null);

/** A screen's registry (TTScreen makes one and hands it to its header's link button and to its tables). */
export function createViewLinkRegistry(): ViewLinkRegistry {
	const tables = new Map<string, () => Record<string, string>>();
	return {
		register(id, params) {
			tables.set(id, params);
			return () => {
				if (tables.get(id) === params) tables.delete(id);
			};
		},
		params() {
			const out: Record<string, string> = {};
			for (const get of tables.values()) Object.assign(out, get());
			return out;
		},
	};
}

export function ViewLinkProvider({ registry, children }: { registry: ViewLinkRegistry; children: ReactNode }) {
	return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

export function useViewLinkRegistry(): ViewLinkRegistry | null {
	return useContext(RegistryContext);
}

/** The parameter a link uses to find the backend on another phone (its URL; ids are per phone). */
export const BACKEND_PARAM = "backend";

/** The app's own scheme (app.json `scheme`); only an installed build answers it, never Expo Go. */
export const APP_SCHEME = "typetorch";

/** A link made in Expo Go (exp:// / exps://): it depends on the dev server that made it. */
export function isExpoGoLink(url: string): boolean {
	return /^exps?:\/\//i.test(url);
}

/** The installed app's form of a link: typetorch://<path>?<query> (Linking.createURL can't make it inside Expo Go). */
export function toAppLink(url: string): string {
	if (!isExpoGoLink(url)) return url;
	const at = url.indexOf("/--/");
	const rest = at >= 0 ? url.slice(at + 4) : url.replace(/^exps?:\/\/[^/?]*\/?/i, "");
	return `${APP_SCHEME}://${rest}`;
}

/** Builds the link to what is on screen now. */
export function buildViewLink(opts: { pathname: string; params: RawParams; backendId: string; backendUrl: string; tables: Record<string, string> }): string {
	const query: Record<string, string> = {};
	const tableKey = (k: string) => Object.keys(opts.tables).some((t) => t === k) || /\.(sort|q|cols|size)$|\.f\./.test(k);
	for (const [k, v] of Object.entries(opts.params)) {
		const s = first(v);
		if (s === undefined || s === "" || k === "backendId" || k === BACKEND_PARAM || (FILTER_KEYS as readonly string[]).includes(k) || tableKey(k)) continue;
		// Dynamic segments ([pid], [job], ...) are in the path already.
		if (opts.pathname.split("/").includes(encodeURIComponent(s)) || opts.pathname.split("/").includes(s)) continue;
		query[k] = s;
	}
	// The range always goes in (even the default), so the link says the whole filter state on its own.
	Object.assign(query, { range: DEFAULT_RANGE }, filtersToParams(currentTTFilters(opts.backendId)), opts.tables);
	query[BACKEND_PARAM] = opts.backendUrl;
	return Linking.createURL(opts.pathname.replace(/^\//, ""), { queryParams: query });
}

/** "Copy link to this view" and "Share link" for the current screen. */
export function useViewLink(backendId: string, backendUrl: string, registry: ViewLinkRegistry | null) {
	const pathname = usePathname();
	const params = useLocalSearchParams<RawParams>();
	const link = useCallback(() => buildViewLink({ pathname, params, backendId, backendUrl, tables: registry?.params() ?? {} }), [pathname, params, backendId, backendUrl, registry]);
	const copy = useCallback(async (app = false) => {
		const url = link();
		await Clipboard.setStringAsync(app ? toAppLink(url) : url);
	}, [link]);
	const share = useCallback(async (app = false) => {
		const made = link();
		const url = app ? toAppLink(made) : made;
		await Share.share({ message: url, url }).catch(() => undefined);
	}, [link]);
	/** True inside Expo Go: the plain link is exp:// and needs the same dev server; `copy(true)` / `share(true)` give typetorch://. */
	const expoGo = useMemo(() => isExpoGoLink(Linking.createURL("")), []);
	return { link, copy, share, expoGo };
}
