/**
 * The maps' queries and view state, shared by the Maps, Live map, server live map and Recordings screens (web
 * pages/Maps.tsx, pages/recordings/RealMap.tsx useMapExports / useMapGeometry, lib/map-view.ts).
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useTTQuery } from "@/features/typetorch/hooks";

import { DEFAULT_MAP_VIEW, type MapViewState } from "./map-view";
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

// The view, one per backend in memory (the web keeps it in the URL) -----------------------------------------------------

const views = new Map<string, MapViewState>();
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
	listeners.add(l);
	return () => {
		listeners.delete(l);
	};
}

/** The map view of a backend (2D / 3D, draw, cell, band, toggles, hidden layers) and a patch setter. */
export function useMapView(backendId: string): [MapViewState, (patch: Partial<MapViewState>) => void] {
	const state = useSyncExternalStore(subscribe, () => views.get(backendId) ?? DEFAULT_MAP_VIEW);
	const set = useCallback(
		(patch: Partial<MapViewState>) => {
			views.set(backendId, { ...(views.get(backendId) ?? DEFAULT_MAP_VIEW), ...patch });
			for (const l of listeners) l();
		},
		[backendId],
	);
	return [state, set];
}
