/**
 * The Recordings screen on the real map (port of the web explorer's pages/recordings/RealMap.tsx, plans/33): when a map
 * has an export (GET /v1/maps; names match the recordings' map values without case or punctuation, no map = the
 * lobby), its layers and replays draw through the maps' MapScene (expo-gl + three) on the exported geometry
 * (GET /v1/maps/<name>/geometry), in 2D or 3D. Without an export the screen keeps its SVG silhouette (MapView).
 *
 *   - Layers: each layer's cells (the query's frame: cell index -> studs from the frame's minX / minZ and cell size) as
 *     world cells or points. Heights: the cell's recorded average (recording layers carry it), else the floor under the
 *     cell from the geometry, else the renderer's floor. A tap picks the cell under it (2D: the point; 3D: a dot or a
 *     heat cell under the finger).
 *   - Replay: the path as a path layer, the current position as a point, the camera's direction as a cone.
 * The switches (Points / Heatmap, 2D / 3D, the cell size) and the height band (All, floors, a from / to range, and in a
 * replay "Follow player", its default: roofs above the player are cut away) live in the screen's route params (the
 * web's URL: mode, draw, cell, band); 2D / 3D and Points / Heatmap fall back to the backend's map view shared with the
 * Maps screen (features/maps/hooks.ts) when the route names none.
 *
 * Phone layout: the scene and its height controls are handed back separately (useRealScene), so the screen keeps the
 * map fixed on top (drags move the map) and the controls in the scroll view under it, like the Maps screen.
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { View } from "react-native";

import type { RecFrame, RecMapLayer } from "@/api/tt/types";
import { Txt } from "@/components/ui";
import { BandControls, ChipRow, ToggleChip } from "@/features/maps/BandControls";
import { currentMapView, useMapExports, useMapGeometry, useMapView } from "@/features/maps/hooks";
import { bandFits, bandParam, mapViewPatch, readMapView, resolveBand, type BandChoice, type MapViewState } from "@/features/maps/map-view";
import { CELL_SIZES, detectFloors, exportFor, floorUnder, recordingLayer, ROOT_HEIGHT, type CellSize, type MapGeometry, type MapInfo, type MapLayer } from "@/features/maps/maps";
import { MapScene } from "@/features/maps/MapScene";
import { usePageParams, useViewLinkRegistry } from "@/features/typetorch/view-link";
import { space } from "@/theme";

import { layerColor, layerName } from "./map";
import type { ReplayScene } from "./ReplayPlayer";

/** The cell size on the real map when the route names none (finer than the query's own 4+ stud grid). */
export const REAL_MAP_CELL: CellSize = 2;

/** The export for a recordings map name (null: none, or the list is still loading). */
export function useExportFor(backendId: string, name: string | null | undefined): { info: MapInfo | null; loading: boolean } {
	const maps = useMapExports(backendId);
	return { info: maps ? exportFor(maps, name) : null, loading: maps === null };
}

/**
 * The view state (the route's params; 2D / 3D and Points / Heatmap else the backend's shared map view) and a setter
 * (writes the route, and 2D / 3D and Points / Heatmap also to the shared view).
 */
export function useRecView(backendId: string): [MapViewState, (patch: Partial<MapViewState>) => void, string | null] {
	const [params, setParams] = usePageParams();
	const [shared, setShared] = useMapView(backendId);
	const fromRoute = readMapView({ get: (k) => params[k] ?? null, has: (k) => params[k] !== undefined });
	const state: MapViewState = {
		...fromRoute,
		mode: params.mode !== undefined ? fromRoute.mode : shared.mode,
		draw: params.draw !== undefined || params.view !== undefined ? fromRoute.draw : shared.draw,
	};
	// A link carries 2D / 3D and Points / Heatmap even when only the shared view holds them (the route wins).
	const registry = useViewLinkRegistry();
	const routeRef = useRef(params);
	routeRef.current = params;
	useEffect(
		() =>
			registry?.register("rec-map-view", () => {
				const route = routeRef.current;
				const view = currentMapView(backendId);
				return {
					...(route.mode === undefined && view.mode === "2d" ? { mode: "2d" } : {}),
					...(route.draw === undefined && route.view === undefined && view.draw === "points" ? { draw: "points" } : {}),
				};
			}),
		[registry, backendId],
	);
	const set = useCallback(
		(patch: Partial<MapViewState>) => {
			setParams(mapViewPatch(patch));
			const keep: Partial<MapViewState> = {};
			if (patch.mode !== undefined) keep.mode = patch.mode;
			if (patch.draw !== undefined) keep.draw = patch.draw;
			if (Object.keys(keep).length) setShared(keep);
		},
		[setParams, setShared],
	);
	return [state, set, params.band ?? null];
}

/** Points / Heatmap (left out with `draw: false`), 2D / 3D (only with a real map) and the cell size (real map only). */
export function ViewSwitches({ backendId, real, draw = true, cell, autoCell }: { backendId: string; real: boolean; draw?: boolean; cell?: boolean; autoCell?: number }) {
	const [state, set] = useRecView(backendId);
	const size = state.cell ?? REAL_MAP_CELL;
	return (
		<View style={{ gap: space.sm }}>
			{draw || real ? (
				<ChipRow>
					{draw ? (
						<>
							<ToggleChip label="Points" pressed={state.draw === "points"} onPress={() => set({ draw: "points" })} />
							<ToggleChip label="Heatmap" pressed={state.draw === "heat"} onPress={() => set({ draw: "heat" })} />
						</>
					) : null}
					{real ? (
						<>
							<ToggleChip label="2D" pressed={state.mode === "2d"} onPress={() => set({ mode: "2d" })} />
							<ToggleChip label="3D" pressed={state.mode === "3d"} onPress={() => set({ mode: "3d" })} />
						</>
					) : null}
				</ChipRow>
			) : null}
			{real && cell ? (
				<ChipRow label="Cell">
					{CELL_SIZES.map((c) => (
						<ToggleChip key={c} label={`${c} stud${c === 1 ? "" : "s"}`} pressed={size === c} onPress={() => set({ cell: c === REAL_MAP_CELL ? null : c })} />
					))}
				</ChipRow>
			) : !real && cell && autoCell ? (
				<Txt variant="small">Cells of {autoCell} studs (no map export: the recordings' own grid)</Txt>
			) : null}
		</View>
	);
}

/**
 * The band the route asks for on this screen: a replay (`feetY` given, null while the player's height is unknown)
 * follows the player unless the route names a band (`band=all` for everything); elsewhere "player" means all.
 */
export function bandChoiceFor(raw: string | null, choice: BandChoice, replay: boolean): BandChoice {
	if (replay) return raw === null ? { kind: "player" } : choice;
	return choice.kind === "player" ? { kind: "all" } : choice;
}

/** The feet height to follow: the lowest root height of the last 1.5 s played (a jump doesn't pull the cut up). */
export function followFeet(scene: ReplayScene): number | null {
	const passed = scene.passed;
	const last = passed[passed.length - 1];
	if (!last) return scene.pose?.y === null || scene.pose?.y === undefined ? null : scene.pose.y - ROOT_HEIGHT;
	const since = (last.t ?? 0) - 1500;
	let low = Number.POSITIVE_INFINITY;
	for (let i = passed.length - 1; i >= 0; i--) {
		const p = passed[i] as (typeof passed)[number];
		if ((p.t ?? 0) < since) break;
		if (Number.isFinite(p.y)) low = Math.min(low, p.y);
	}
	return Number.isFinite(low) ? low - ROOT_HEIGHT : null;
}

export interface SceneParts {
	/** The map (or `fallback` when the geometry can't be read). */
	scene: ReactNode;
	/** Its height controls (none on a fallback). */
	controls: ReactNode;
}

/** The scene on the real map, once its geometry loads (an error falls back to `fallback`), and its height controls. */
export function useRealScene({
	backendId,
	info,
	layers,
	onPick,
	label,
	fallback,
	feetY,
	height,
}: {
	backendId: string;
	info: MapInfo;
	layers: MapLayer[];
	onPick?: (p: { x: number; z: number }) => void;
	label: string;
	fallback: ReactNode;
	feetY?: number | null;
	height: number;
}): SceneParts {
	const [state, , rawBand] = useRecView(backendId);
	const [, setParams] = usePageParams();
	const geometry = useMapGeometry(backendId, info);
	const replay = feetY !== undefined;
	const floors = useMemo(() => (geometry.data ? detectFloors(geometry.data, info.offset[1]) : []), [geometry.data, info.offset]);
	const lo = info.bounds ? Math.floor(info.bounds.min[1] + info.offset[1]) : 0;
	const hi = info.bounds ? Math.ceil(info.bounds.max[1] + info.offset[1]) : 100;
	const choice = bandChoiceFor(rawBand, state.band, replay);
	const band = resolveBand(choice, floors, lo, hi, feetY);
	// A free range from another map that doesn't fit this one's heights: back to the default.
	const misfit = choice.kind === "range" && !bandFits(choice, lo, hi);
	useEffect(() => {
		if (misfit) setParams({ band: null });
	}, [misfit, setParams]);
	// In a replay "All" has to be said out loud (absent = follow the player).
	const setBand = (b: BandChoice) => setParams({ band: b.kind === "all" ? (replay ? "all" : null) : b.kind === "player" ? null : bandParam(b) });
	if (geometry.error) return { scene: fallback, controls: null };
	return {
		scene: (
			<MapScene
				backendId={backendId}
				geometry={geometry.data ?? null}
				bounds={info.bounds}
				mode={state.mode}
				layers={layers}
				offset={info.offset}
				band={band}
				label={label}
				{...(onPick ? { onPick } : {})}
				style={{ height }}
			/>
		),
		controls: <BandControls choice={choice} band={band} floors={floors} lo={lo} hi={hi} follow={replay} onChange={setBand} />,
	};
}

/** The map layers tab's layers as world layers (heat cells or points), the picked cell outlined. */
export function worldLayers(layers: readonly RecMapLayer[], frame: RecFrame, draw: "heat" | "points", geometry: MapGeometry | null | undefined, offset: MapInfo["offset"], selected: [number, number] | null): MapLayer[] {
	const floor = geometry ? (x: number, z: number) => floorUnder(geometry, x, z, offset) : undefined;
	const out: MapLayer[] = layers.map((l, i) => {
		const world = recordingLayer({ id: l.id, label: layerName(l.id), color: layerColor(l.id, i), cells: l.cells, ...(l.cell !== undefined ? { cell: l.cell } : {}) }, frame, floor);
		return draw === "heat" ? { ...world, points: [] } : { ...world, cells: [] };
	});
	if (selected) {
		const x0 = frame.minX + selected[0] * frame.cell;
		const z0 = frame.minZ + selected[1] * frame.cell;
		const hit = layers.flatMap((l) => l.cells).find((c) => c[0] === selected[0] && c[1] === selected[1] && c[3] !== undefined);
		const y = hit?.[3] !== undefined ? (hit[3] as number) - ROOT_HEIGHT + 0.3 : (floor?.(x0 + frame.cell / 2, z0 + frame.cell / 2) ?? 0) + 0.3;
		const c = frame.cell;
		out.push({
			id: "selected",
			label: "Picked cell",
			color: "#f8fafc",
			paths: [
				[
					{ x: x0, y, z: z0 },
					{ x: x0 + c, y, z: z0 },
					{ x: x0 + c, y, z: z0 + c },
					{ x: x0, y, z: z0 + c },
					{ x: x0, y, z: z0 },
				],
			],
		});
	}
	return out;
}

/** The real map with the layers tab's layers: hands the scene and its controls to `children` (the screen's layout). */
export function RealLayersMap(props: Parameters<typeof useRealLayersMap>[0] & { children: (parts: SceneParts) => ReactNode }) {
	return <>{props.children(useRealLayersMap(props))}</>;
}

export function useRealLayersMap({
	backendId,
	info,
	frame,
	layers,
	selected,
	onCellPress,
	label,
	fallback,
	height,
}: {
	backendId: string;
	info: MapInfo;
	frame: RecFrame;
	layers: readonly RecMapLayer[];
	selected: [number, number] | null;
	onCellPress: (col: number, row: number) => void;
	label: string;
	fallback: ReactNode;
	height: number;
}): SceneParts {
	const [state] = useRecView(backendId);
	const geometry = useMapGeometry(backendId, info);
	const world = useMemo(() => worldLayers(layers, frame, state.draw, geometry.data, info.offset, selected), [layers, frame, state.draw, geometry.data, info.offset, selected]);
	const pick = (p: { x: number; z: number }) => {
		const col = Math.floor((p.x - frame.minX) / frame.cell);
		const row = Math.floor((p.z - frame.minZ) / frame.cell);
		if (col >= 0 && row >= 0 && col < frame.cols && row < frame.rows) onCellPress(col, row);
	};
	return useRealScene({ backendId, info, layers: world, onPick: pick, label, fallback, height });
}

/** The replay's layers in world studs: the whole path faint, the played part, the camera cone, the character. */
export function replayLayers(scene: ReplayScene): MapLayer[] {
	const pose = scene.pose;
	const y = pose?.y ?? scene.passed[scene.passed.length - 1]?.y ?? 0;
	const out: MapLayer[] = [
		{ id: "replay-all", label: "Path", color: "#93c5fd", paths: [scene.path] },
		{ id: "replay-passed", label: "Path so far", color: "#2563eb", paths: [scene.passed] },
	];
	if (scene.cone) out.push({ id: "replay-cone", label: "Camera", color: "#f59e0b", polygons: [scene.cone.map(([x, z]) => ({ x, y, z }))] });
	if (pose) out.push({ id: "replay-dot", label: "Player", color: "#ef4444", points: [{ x: pose.x, y, z: pose.z }], pointSize: 12 });
	return out;
}

/** The real map with a replay on it: hands the scene and its controls to `children` (the replay's layout). */
export function RealReplayMap(props: Parameters<typeof useRealReplayMap>[0] & { children: (parts: SceneParts) => ReactNode }) {
	return <>{props.children(useRealReplayMap(props))}</>;
}

export function useRealReplayMap({ backendId, info, scene, label, fallback, height }: { backendId: string; info: MapInfo; scene: ReplayScene; label: string; fallback: ReactNode; height: number }): SceneParts {
	const layers = useMemo(() => replayLayers(scene), [scene]);
	const feet = followFeet(scene);
	// Whole studs: the cut moves a stud at a time, not on every tick's sway.
	return useRealScene({ backendId, info, layers, label, fallback, feetY: feet === null ? null : Math.round(feet), height });
}
