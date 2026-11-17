/**
 * The 2D minimap / 3D map of one map (port of the web explorer's components/maps/MapScene.tsx, plans/33): a GLView
 * (expo-gl) with MapRenderer (three.js) in it and touch gestures on top.
 *
 * Props are plain data: the decoded geometry and its bounds, the view (2D / 3D), the offset that puts the geometry where
 * the game plays it, the Y band, the draw toggles (maps.ts isDrawn) and the layers in world coordinates (MapLayer).
 * Any screen with positions (the Recordings screens' layers and replays, the live maps) draws on it by passing layers.
 *
 * Gestures: one finger turns (3D) or pans (2D), two fingers pan, a pinch zooms; a tap (not a drag) reports the point
 * under it through `onPick` (2D: the point; 3D: the nearest dot within reach, else the heat cell under it). `focus`
 * keeps a world point in the middle (following a player). The web's mouse hover has no phone twin: a tap does it.
 *
 * Size: expo-gl fixes gl.drawingBufferWidth / Height when the context is made and never changes them, so the GLView is
 * only mounted once the view is laid out and is remounted (keyed on its rounded size) whenever that size changes (the
 * Maps screen's Bigger / Smaller, a rotation): the old renderer is disposed and a new one gets a buffer of the new size,
 * then the same geometry, layers and view state (the camera starts fitted again).
 *
 * Focus: expo-router's Stack keeps a screen mounted under a pushed one. While it is not focused the scene is not
 * updated (no three.js rebuilds or frames for a hidden map); the latest props are drawn when it is back in front.
 */
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Txt } from "@/components/ui";
import { useBackend } from "@/store/accounts";
import { radius, useTheme } from "@/theme";

import { fetchMapImage } from "./images";
import type { Bounds, MapGeometry, MapLayer, MapPoint, Vec3 } from "./maps";
import { MapRenderer, type MapMode, type TouchPoint } from "./renderer";

export interface MapSceneProps {
	/** Images (textures) come from this backend. */
	backendId: string;
	geometry: MapGeometry | null;
	bounds: Bounds | null;
	mode: MapMode;
	layers?: MapLayer[];
	offset?: Vec3;
	band?: [number, number] | null;
	/** Non-colliding meshes and unions (as boxes). Default off. */
	decorative?: boolean;
	/** Invisible non-colliding parts (markers, triggers). Default off. */
	markers?: boolean;
	/** Decals, Textures, MaterialVariant images and the materials' look (plans/36 phase 5). Default on. */
	textures?: boolean;
	/** A tap on the map, in world studs (2D: the point; 3D: a dot or heat cell under the finger). */
	onPick?: (point: { x: number; z: number }, at: TouchPoint) => void;
	/** A world point the view keeps centred (a followed player), null: free. */
	focus?: MapPoint | null;
	/** The view's name for screen readers. */
	label?: string;
	style?: StyleProp<ViewStyle>;
	/**
	 * The renderer, each time one is made (a new GL context), and null when it goes: a caller that draws its own objects
	 * (the recordings' Player view: avatars in `actors`, a fixed camera through `setView`) keeps it.
	 */
	onRenderer?: (renderer: MapRenderer | null) => void;
	/** Any tap (not a drag), at its point of the view (dp), before `onPick` (the Player view picks actors with it). */
	onTap?: (at: TouchPoint) => void;
	/** The hint in the corner (default: the gestures); null hides it. */
	hint?: string | null;
	/** The Fit button (default on). */
	fitButton?: boolean;
	/** Drawn over the map, under the hint and Fit (the Player view's recorded UI, taps, caption). */
	children?: ReactNode;
}

const NO_OFFSET: Vec3 = [0, 0, 0];
const NO_LAYERS: MapLayer[] = [];

/** Finger travel (dp) under which a touch is a tap, not a drag. */
const TAP_DP = 8;
const TAP_MS = 450;

type Gesture = { count: number; x: number; y: number; distance: number; startX: number; startY: number; startAt: number; moved: number; multi: boolean };

function touchesOf(e: GestureResponderEvent): TouchPoint[] {
	const list = e.nativeEvent.touches?.length ? e.nativeEvent.touches : [e.nativeEvent];
	return list.slice(0, 2).map((t) => ({ x: t.locationX, y: t.locationY }));
}

function centre(points: TouchPoint[]): { x: number; y: number; distance: number } {
	if (points.length < 2) return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, distance: 0 };
	const [a, b] = points as [TouchPoint, TouchPoint];
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

/** The scene in its own error boundary: a map that fails shows why, and the page around it keeps working. */
export function MapScene(props: MapSceneProps) {
	return (
		<ErrorBoundary title="The map crashed" style={props.style as object}>
			<MapSceneView {...props} />
		</ErrorBoundary>
	);
}

function MapSceneView({
	backendId,
	geometry,
	bounds,
	mode,
	layers = NO_LAYERS,
	offset = NO_OFFSET,
	band = null,
	decorative = false,
	markers = false,
	textures = true,
	onPick,
	focus = null,
	label,
	style,
	onRenderer,
	onTap,
	hint: hintProp,
	fitButton = true,
	children,
}: MapSceneProps) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const renderer = useRef<MapRenderer | null>(null);
	const size = useRef({ width: 1, height: 1 });
	const [failed, setFailed] = useState<string | null>(null);
	/** Bumped for each new renderer (a new GL context): the effects below hand it the current props. 0: none yet. */
	const [ready, setReady] = useState(0);
	/** The laid-out size in whole dp, null before the first layout; the GLView's key. */
	const [laid, setLaid] = useState<{ width: number; height: number } | null>(null);
	const focused = useIsFocused();
	const [cursor, setCursor] = useState<{ x: number; z: number } | null>(null);
	const latest = useRef({ onPick, mode, onRenderer, onTap });
	latest.current = { onPick, mode, onRenderer, onTap };
	const apiRef = useRef(api);
	apiRef.current = api;

	const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
		try {
			renderer.current?.dispose();
			const r = new MapRenderer(gl, (id, signal) => {
				const current = apiRef.current;
				if (!current) return Promise.resolve({ state: "none" as const });
				return fetchMapImage(current, id, signal);
			});
			r.setViewSize(size.current.width, size.current.height);
			r.onError = (error) => setFailed(`The map could not be drawn (${error.message}).`);
			renderer.current = r;
			setReady((n) => n + 1);
			latest.current.onRenderer?.(r);
		} catch (error) {
			setFailed(`The map couldn't start (${(error as Error).message}).`);
		}
	};

	useEffect(
		() => () => {
			latest.current.onRenderer?.(null);
			renderer.current?.dispose();
			renderer.current = null;
		},
		[],
	);

	useEffect(() => {
		if (!ready || !focused) return;
		try {
			renderer.current?.update(geometry, bounds, layers, { mode, offset, band, decorative, markers, textures });
		} catch (error) {
			setFailed(`The map could not be drawn (${(error as Error).message}).`);
		}
	}, [ready, focused, geometry, bounds, layers, mode, offset, band, decorative, markers, textures]);

	useEffect(() => {
		if (!ready || !focused || !focus) return;
		try {
			renderer.current?.focus(focus.x, focus.y, focus.z);
		} catch (error) {
			setFailed(`The map could not follow that point (${(error as Error).message}).`);
		}
	}, [ready, focused, focus?.x, focus?.y, focus?.z]);

	const responder = useMemo(() => {
		let g: Gesture | null = null;
		const begin = (e: GestureResponderEvent, keep?: Gesture | null) => {
			const pts = touchesOf(e);
			const c = centre(pts);
			g = {
				count: pts.length,
				x: c.x,
				y: c.y,
				distance: c.distance,
				startX: keep?.startX ?? c.x,
				startY: keep?.startY ?? c.y,
				startAt: keep?.startAt ?? Date.now(),
				moved: keep?.moved ?? 0,
				multi: (keep?.multi ?? false) || pts.length > 1,
			};
		};
		return PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: () => true,
			onPanResponderTerminationRequest: () => false,
			onShouldBlockNativeResponder: () => true,
			onPanResponderGrant: (e) => begin(e),
			onPanResponderMove: (e) => {
				const r = renderer.current;
				const pts = touchesOf(e);
				if (!g || pts.length !== g.count) return begin(e, g);
				const c = centre(pts);
				const dx = c.x - g.x;
				const dy = c.y - g.y;
				g.moved += Math.hypot(dx, dy);
				if (r) {
					if (pts.length >= 2) {
						if (dx || dy) r.pan(dx, dy);
						if (g.distance > 0 && c.distance > 0) r.zoom(c.distance / g.distance, c);
					} else if (dx || dy) r.drag(dx, dy);
					if (latest.current.mode === "2d") setCursor(r.worldAt(c.x, c.y));
				}
				g.x = c.x;
				g.y = c.y;
				g.distance = c.distance;
			},
			onPanResponderRelease: (e) => {
				const done = g;
				g = null;
				if (!done || done.multi || done.moved > TAP_DP || Date.now() - done.startAt > TAP_MS) return;
				const at = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
				const r = renderer.current;
				if (!r) return;
				if (latest.current.mode === "2d") setCursor(r.worldAt(at.x, at.y));
				latest.current.onTap?.(at);
				const pick = latest.current.onPick;
				if (!pick) return;
				const point = r.pickAt(at.x, at.y);
				if (point) pick(point, at);
			},
			onPanResponderTerminate: () => {
				g = null;
			},
		});
	}, []);

	const hint =
		hintProp !== undefined
			? hintProp
			: mode === "2d"
			? cursor
				? `x ${Math.round(cursor.x)}, z ${Math.round(cursor.z)} · drag to pan, pinch to zoom`
				: "drag to pan, pinch to zoom · north up"
			: `drag to turn, two fingers to pan, pinch to zoom${onPick ? " · tap a dot or a cell" : ""}`;

	return (
		<View
			style={[{ overflow: "hidden", borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border, backgroundColor: p.scheme === "dark" ? "#141414" : "#f3f3f3" }, style]}
			accessible
			accessibilityRole="image"
			accessibilityLabel={label ?? "Map"}
		>
			<View
				style={StyleSheet.absoluteFill}
				onLayout={(e) => {
					const { width, height } = e.nativeEvent.layout;
					size.current = { width, height };
					const next = { width: Math.round(width), height: Math.round(height) };
					if (next.width < 1 || next.height < 1) return;
					if (laid && laid.width === next.width && laid.height === next.height) {
						renderer.current?.setViewSize(width, height);
						return;
					}
					// A new size: the drawing buffer can't follow (expo-gl), so the GLView below remounts with a new context.
					if (renderer.current) latest.current.onRenderer?.(null);
					renderer.current?.dispose();
					renderer.current = null;
					setLaid(next);
				}}
				{...responder.panHandlers}
			>
				{failed || !laid ? null : (
					<GLView key={`${laid.width}x${laid.height}`} style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} pointerEvents="none" />
				)}
			</View>
			{children}
			{failed ? (
				<View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
					<Txt variant="small" style={{ textAlign: "center" }}>
						{failed}
					</Txt>
				</View>
			) : null}
			{hint === null ? null : (
				<View pointerEvents="none" style={{ position: "absolute", left: 6, bottom: 6, right: 56, flexDirection: "row" }}>
					<View style={{ backgroundColor: p.scheme === "dark" ? "rgba(10,10,10,0.75)" : "rgba(255,255,255,0.8)", borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 }}>
						<Txt variant="small" style={{ fontSize: 10 }}>
							{hint}
						</Txt>
					</View>
				</View>
			)}
			{fitButton ? (
				<Pressable
					onPress={() => renderer.current?.fit()}
					hitSlop={6}
					style={{ position: "absolute", top: 6, right: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border, backgroundColor: p.scheme === "dark" ? "rgba(10,10,10,0.8)" : "rgba(255,255,255,0.85)" }}
					accessibilityRole="button"
					accessibilityLabel="Fit the whole map"
				>
					<Txt variant="small" color={p.foreground}>
						Fit
					</Txt>
				</Pressable>
			) : null}
		</View>
	);
}
