/**
 * The maps' queries and view state, shared by the Maps, Live map, server live map and Recordings screens (web
 * pages/Maps.tsx, pages/recordings/RealMap.tsx useMapExports / useMapGeometry, lib/map-view.ts).
 */
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { useTTQuery } from "@/features/typetorch/hooks";
import { useViewLinkRegistry } from "@/features/typetorch/view-link";

import { DEFAULT_MAP_VIEW, mapViewPatch, readMapView, VIEW_KEYS, type MapViewState } from "./map-view";
import { MAPS_KEY, type MapInfo } from "./maps";

/** The map list (GET /v1/maps); polls every 1.5 s while an export runs. */
export function useMapsList(backendId: string, options: { enabled?: boolean } = {}) {
	return useTTQuery(backendId, MAPS_KEY, (api, signal) => api.maps(signal), {
		refetchInterval: (q) => (q.state.data?.export.state === "running" ? 1500 : false),
		...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
	});
}

/** The exported maps that can be drawn (bounds and parts), null while the list loads; [] when there are none or it fails. */
export function useMapExports(backendId: string): MapInfo[] | null {
	const list = useTTQuery(backendId, MAPS_KEY, (api, signal) => api.maps(signal), { retry: false, staleTime: 60_000 });
	const maps = useMemo(() => list.data?.maps.filter((m) => m.bounds !== null && m.parts > 0) ?? [], [list.data]);
	return list.isLoading ? null : maps;
}

/** One map's decoded geometry, kept for good (keyed by its hash: a new export is a new key). */
export function useMapGeometry(backendId: string, info: Pick<MapInfo, "name" | "hash"> | null) {
	return useTTQuery(backendId, ["map-geometry", info?.name, info?.hash], (api, signal) => api.mapGeometry(info?.name as string, signal), {
		enabled: info !== null,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 10 * 60_000,
	});
}

// The view, one per backend in memory (the web keeps it in the URL; here a link carries it) ------------------------------

const views = new Map<string, MapViewState>();
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
	listeners.add(l);
	return () => {
		listeners.delete(l);
	};
}

/** The backend's map view now (outside React: links). */
export function currentMapView(backendId: string): MapViewState {
	return views.get(backendId) ?? DEFAULT_MAP_VIEW;
}

function setMapView(backendId: string, next: MapViewState) {
	views.set(backendId, next);
	for (const l of listeners) l();
}

/** The map view of a backend (2D / 3D, draw, cell, band, toggles, hidden layers) and a patch setter. */
export function useMapView(backendId: string): [MapViewState, (patch: Partial<MapViewState>) => void] {
	const state = useSyncExternalStore(subscribe, () => currentMapView(backendId));
	const set = useCallback((patch: Partial<MapViewState>) => setMapView(backendId, { ...currentMapView(backendId), ...patch }), [backendId]);
	return [state, set];
}

/** A URL patch without its removed (default) keys. */
export function presentKeys(patch: Record<string, string | null>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(patch)) if (v) out[k] = v;
	return out;
}

/**
 * The map view in links (Maps, Live map, a server's Live map tab): "Copy link to this view" carries the backend's map
 * view under the web's URL keys (mode, draw, cell, band, decor, markers, hide, tex), and a screen opened from such a
 * link makes them the view (keys the link leaves out go back to their defaults, like a web URL). The keys then leave the
 * route: the view lives in memory, shared by the map screens, and a later link writes it again.
 */
export function useMapViewLink(backendId: string): void {
	const registry = useViewLinkRegistry();
	const params = useLocalSearchParams<Record<string, string | string[] | undefined>>();
	const applied = useRef(false);
	useEffect(() => {
		if (applied.current) return;
		applied.current = true;
		const one = (k: string): string | null => {
			const v = params[k];
			const s = Array.isArray(v) ? v[0] : v;
			return s === undefined || s === "" ? null : s;
		};
		const keys = VIEW_KEYS.filter((k) => one(k) !== null);
		if (!keys.length) return;
		setMapView(backendId, readMapView({ get: one, has: (k) => one(k) !== null }));
		router.setParams(Object.fromEntries(keys.map((k) => [k, undefined])));
	}, [backendId, params]);
	useEffect(() => registry?.register("map-view", () => presentKeys(mapViewPatch(currentMapView(backendId)))), [registry, backendId]);
}
