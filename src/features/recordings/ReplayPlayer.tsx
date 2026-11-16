/**
 * One recorded session played back (port of the web explorer's pages/recordings/ReplayPlayer.tsx): the path on the
 * current map, a moving dot with the camera's direction as a cone, and a timeline of inputs, events and confusion
 * signals with a scrubber, play / pause, back to the start and speed.
 *
 * plans/36: a "Player view" (PlayerView: the recorded camera, people, the recorded UI, taps) next to the map, the
 * default for sessions with extended data; under the timeline the AFK spans, a captions strip (buttons, screens,
 * prompts) and an FPS strip (tt-ext-1 View records, else the client tech rows).
 *
 * Phone: the view (map or Player view) and the transport (play, clock, scrubber, timeline) stay on top; the rest scrolls
 * under them. The web's range input is a drag scrubber; its timeline marks are 4 px buttons, too small for a finger, so
 * a tap on the timeline jumps to the nearest mark within reach (else to that moment), and "previous / next mark" step
 * through them.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, Line, Pattern, Polygon, Polyline, Rect } from "react-native-svg";

import type { RecFrame, RecordingReplayResult } from "@/api/tt/types";
import { Badge, Icon, Txt } from "@/components/ui";
import { ChipRow, ToggleChip } from "@/features/maps/BandControls";
import type { MapPoint } from "@/features/maps/maps";
import { radius, space, useTheme } from "@/theme";

import { captions as buildCaptions, fpsSeries } from "./ext-replay";
import { cone, fmtClock, frameAround, mapAtTime, mapName, markers as buildMarkers, poseAt, stateAtTime, type Marker, type Pose } from "./map";
import { MapView, type ToView } from "./MapView";
import { PlayerView } from "./PlayerView";
import type { SceneParts } from "./RealMap";

export type ReplayCamera = "map" | "player";

export const SPEEDS = [0.5, 1, 2, 4, 8] as const;
const TICK_MS = 100;

const WHY: Record<string, string> = {
	left: "the player left",
	window: "the 60 s window ran out",
	cap: "hit the size cap",
	end: "the server ended it",
};

export function whyLabel(why: string | null | undefined): string {
	return why ? (WHY[why] ?? why) : "unknown";
}

/** The replay at the current moment in world studs (the real map draws these; the SVG map uses the overlay). */
export interface ReplayScene {
	/** The whole path on this map, and the part played so far (t: ms into the session). */
	path: (MapPoint & { t?: number })[];
	passed: (MapPoint & { t?: number })[];
	pose: Pose | null;
	/** The camera's direction: [x, z] corners from the character (null without a yaw). */
	cone: [number, number][] | null;
}

/**
 * Draws the map `map` with the overlay (SVG, cell units) or the scene (world studs), handing the map and its controls
 * to `layout`; the screen swaps in the real map when it has an export, else the map layer's frame and silhouette.
 */
export type RenderMap = (map: string, overlay: (toView: ToView) => ReactNode, fallback: RecFrame | null, scene: ReplayScene, height: number, layout: (parts: SceneParts) => ReactNode) => ReactNode;

const defaultRenderMap: RenderMap = (map, overlay, fallback, _scene, height, layout) =>
	layout({
		scene: fallback ? <MapView frame={fallback} background={[]} overlay={overlay} label={`Replay on ${mapName(map)}`} maxHeight={height} /> : <Txt variant="muted">No positions on this map.</Txt>,
		controls: null,
	});

/** The FPS strip: fps over the session (a line, 30 and 60 marked), the value now. */
export function FpsStrip({ series, duration, t }: { series: readonly [number, number][]; duration: number; t: number }) {
	const p = useTheme();
	if (series.length < 2 || duration <= 0) return null;
	const top = Math.max(60, ...series.map((s) => s[1]));
	const x = (ms: number) => Math.max(0, Math.min(100, (ms / duration) * 100));
	const y = (fps: number) => 30 - (Math.min(fps, top) / top) * 28;
	let now: number | null = null;
	for (const s of series) if (s[0] <= t) now = s[1];
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }} testID="replay-fps">
			<Txt variant="small" style={{ width: 52, fontVariant: ["tabular-nums"] }}>
				{now === null ? "fps" : `${Math.round(now)} fps`}
			</Txt>
			<View style={{ flex: 1, height: 32, borderRadius: 4, backgroundColor: p.muted, overflow: "hidden" }} accessibilityLabel="Frames per second over the session">
				<Svg width="100%" height="100%" viewBox="0 0 100 32" preserveAspectRatio="none">
					<Line x1="0" x2="100" y1={y(60)} y2={y(60)} stroke={p.foreground} strokeOpacity={0.15} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
					<Line x1="0" x2="100" y1={y(30)} y2={y(30)} stroke="#ef4444" strokeOpacity={0.35} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
					<Polyline points={series.map((s) => `${x(s[0])},${y(s[1])}`).join(" ")} fill="none" stroke="#10b981" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
					<Line x1={x(t)} x2={x(t)} y1="0" y2="32" stroke={p.foreground} strokeWidth={1} vectorEffect="non-scaling-stroke" />
				</Svg>
			</View>
		</View>
	);
}

/** A seek bar: a tap or a drag anywhere on it moves the replay there (whole ticks). */
function Scrubber({ t, duration, onSeek }: { t: number; duration: number; onSeek: (t: number) => void }) {
	const p = useTheme();
	const width = useRef(1);
	const latest = useRef({ duration, onSeek });
	latest.current = { duration, onSeek };
	const responder = useMemo(() => {
		const seek = (x: number) => {
			const { duration: d, onSeek: fn } = latest.current;
			const k = Math.max(0, Math.min(1, x / Math.max(1, width.current)));
			fn(Math.round((k * d) / TICK_MS) * TICK_MS);
		};
		return PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: () => true,
			onPanResponderTerminationRequest: () => false,
			onShouldBlockNativeResponder: () => true,
			onPanResponderGrant: (e) => seek(e.nativeEvent.locationX),
			onPanResponderMove: (e) => seek(e.nativeEvent.locationX),
		});
	}, []);
	const k = duration ? Math.max(0, Math.min(1, t / duration)) : 0;
	return (
		<View
			style={{ height: 28, justifyContent: "center" }}
			onLayout={(e) => {
				width.current = e.nativeEvent.layout.width;
			}}
			accessibilityRole="adjustable"
			accessibilityLabel="Replay position"
			accessibilityValue={{ min: 0, max: Math.round(duration / 1000), now: Math.round(t / 1000) }}
			{...responder.panHandlers}
		>
			<View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: p.muted }}>
				<View style={{ height: 4, borderRadius: 2, width: `${k * 100}%`, backgroundColor: p.brand }} />
			</View>
			<View pointerEvents="none" style={{ position: "absolute", left: `${k * 100}%`, marginLeft: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: p.background, borderWidth: 2, borderColor: p.brand }} />
		</View>
	);
}

/** The timeline: AFK spans hatched, the marks, the playhead. A tap jumps to the nearest mark within reach, else there. */
function Timeline({ marks, afk, t, duration, onSeek }: { marks: readonly Marker[]; afk: readonly [number, number | null][]; t: number; duration: number; onSeek: (t: number) => void }) {
	const p = useTheme();
	const [width, setWidth] = useState(1);
	const pct = (ms: number) => (duration ? Math.max(0, Math.min(100, (ms / duration) * 100)) : 0);
	return (
		<Pressable
			onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
			onPress={(e) => {
				if (!duration) return;
				const x = e.nativeEvent.locationX;
				let best: Marker | null = null;
				let bestD = 14;
				for (const m of marks) {
					const d = Math.abs((m.t / duration) * width - x);
					if (d <= bestD) {
						bestD = d;
						best = m;
					}
				}
				onSeek(best ? best.t : Math.max(0, Math.min(duration, (x / Math.max(1, width)) * duration)));
			}}
			style={{ height: 26, borderRadius: 4, backgroundColor: p.muted, overflow: "hidden" }}
			accessibilityLabel={`Timeline: ${marks.length} marks`}
			testID="replay-timeline"
		>
			{afk.map(([from, to], i) => (
				<View
					key={`afk-${i}`}
					pointerEvents="none"
					testID="replay-afk"
					style={{
						position: "absolute",
						top: 0,
						bottom: 0,
						left: `${pct(from)}%`,
						width: `${Math.max(0, pct(to ?? duration) - pct(from))}%`,
						backgroundColor: p.scheme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
						overflow: "hidden",
					}}
				>
					<Svg width="100%" height="100%">
						<Defs>
							<Pattern id={`hatch-${i}`} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
								<Rect x={4} y={0} width={2} height={6} fill="rgba(127,127,127,0.35)" />
							</Pattern>
						</Defs>
						<Rect x={0} y={0} width="100%" height="100%" fill={`url(#hatch-${i})`} />
					</Svg>
				</View>
			))}
			{marks.map((m, i) => (
				<View key={`${m.t}-${i}`} pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, width: 3, marginLeft: -1.5, left: `${pct(m.t)}%`, backgroundColor: m.color, opacity: m.kind === "signal" ? 0.6 : 0.9, borderRadius: 1 }} />
			))}
			<View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, left: `${pct(t)}%`, backgroundColor: p.foreground }} />
		</Pressable>
	);
}

function IconButton({ icon, label, onPress, primary }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onPress: () => void; primary?: boolean }) {
	const p = useTheme();
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={label}
			hitSlop={4}
			style={({ pressed }) => ({
				width: 38,
				height: 34,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: radius.md,
				backgroundColor: primary ? p.primary : p.secondary,
				borderWidth: primary ? 0 : StyleSheet.hairlineWidth,
				borderColor: p.border,
				opacity: pressed ? 0.7 : 1,
			})}
		>
			<Icon name={icon} size={18} color={primary ? p.primaryForeground : p.foreground} />
		</Pressable>
	);
}

export function ReplayPlayer({
	backendId,
	replay,
	renderMap = defaultRenderMap,
	initialT = 0,
	camera: cameraProp,
	onCameraChange,
	header,
}: {
	backendId: string;
	replay: RecordingReplayResult;
	renderMap?: RenderMap;
	initialT?: number;
	/** Map or Player view (controlled by the screen, from the route); default: Player view for extended sessions. */
	camera?: ReplayCamera;
	onCameraChange?: (camera: ReplayCamera) => void;
	/** Shown first in the scroll view (the session's title, "All sessions"). */
	header?: ReactNode;
}) {
	const p = useTheme();
	const window = useWindowDimensions();
	const [width, setWidth] = useState(window.width - 2 * space.lg);
	const [cameraState, setCameraState] = useState<ReplayCamera>(replay.extended ? "player" : "map");
	const camera = cameraProp ?? cameraState;
	const setCamera = (c: ReplayCamera) => (onCameraChange ? onCameraChange(c) : setCameraState(c));
	const duration = replay.duration ?? 0;
	const samples = replay.samples ?? [];
	const [t, setT] = useState(Math.min(initialT, duration));
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeed] = useState<number>(1);
	useEffect(() => {
		if (!playing) return;
		const timer = setInterval(() => {
			setT((current) => {
				const next = current + TICK_MS * speed;
				if (next >= duration) {
					setPlaying(false);
					return duration;
				}
				return next;
			});
		}, TICK_MS);
		return () => clearInterval(timer);
	}, [playing, speed, duration]);
	const marks = useMemo(() => buildMarkers(replay), [replay]);
	const map = mapAtTime(replay.maps, t) ?? replay.map ?? "";
	// The path on the current map: samples whose map segment is this map.
	const onMap = useMemo(() => {
		const segments = replay.maps ?? [];
		return samples.filter((s) => s[1] !== null && s[3] !== null && mapAtTime(segments, s[0]) === map);
	}, [samples, replay.maps, map]);
	const fallback = useMemo(() => frameAround(onMap.map((s) => [s[1] as number, s[3] as number])), [onMap]);
	const pose = poseAt(onMap, t);
	const points = useMemo(() => onMap.map((s) => ({ x: s[1] as number, y: s[2] ?? 0, z: s[3] as number, t: s[0] })), [onMap]);
	const scene: ReplayScene = {
		path: points,
		passed: points.filter((pt) => pt.t <= t),
		pose,
		cone: pose ? cone(pose, 10) : null,
	};
	const state = stateAtTime(replay, t);
	const recent = marks.filter((m) => m.t <= t).slice(-6).reverse();
	const keys = (replay.inputs ?? []).filter((i) => i.type === "key" && i.t <= t).length;
	const captionList = useMemo(() => buildCaptions(replay), [replay]);
	const fps = useMemo(() => fpsSeries(replay), [replay]);
	const afk = replay.extended?.afk ?? [];
	const overlay = (toView: ToView) => {
		const passed = onMap.filter((s) => s[0] <= t);
		const line = (list: typeof onMap) => list.map((s) => toView(s[1] as number, s[3] as number).join(",")).join(" ");
		const view = pose ? toView(pose.x, pose.z) : null;
		const c = pose ? cone(pose, 3 * (fallback?.cell ?? 4)) : null;
		return (
			<>
				<Polyline points={line(onMap)} fill="none" stroke="#3b82f6" strokeOpacity={0.25} strokeWidth={0.25} strokeLinejoin="round" />
				<Polyline points={line(passed)} fill="none" stroke="#3b82f6" strokeWidth={0.35} strokeLinejoin="round" />
				{c ? <Polygon points={c.map(([x, z]) => toView(x, z).join(",")).join(" ")} fill="#f59e0b" fillOpacity={0.35} /> : null}
				{view ? <Circle cx={view[0]} cy={view[1]} r={0.7} fill="#ef4444" stroke="white" strokeWidth={0.2} /> : null}
			</>
		);
	};
	const seek = (ms: number) => setT(Math.max(0, Math.min(duration, ms)));
	const step = (dir: -1 | 1) => {
		const next = dir > 0 ? marks.find((m) => m.t > t + 1) : [...marks].reverse().find((m) => m.t < t - 1);
		seek(next ? next.t : dir > 0 ? duration : 0);
	};
	const viewHeight = Math.round(window.height * 0.42);

	const badges = (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
			<Badge label={replay.dev ?? "unknown device"} />
			<Badge label={replay.art || "no build"} />
			<Badge label={`Ended: ${whyLabel(replay.why)}`} tone={replay.why === "left" ? "critical" : "muted"} />
			{replay.gaps ? <Badge label={`${replay.gaps} chunk(s) lost`} /> : null}
			{replay.extended ? <Badge label="Extended" tone="brand" /> : null}
			{replay.extended?.gaps ? <Badge label={`${replay.extended.gaps} extended chunk(s) lost`} /> : null}
			{replay.extended?.failed ? <Badge label="Extended data partly unreadable" /> : null}
			{replay.extended?.truncated ? <Badge label="Extended data cut at the size cap" /> : null}
		</View>
	);
	const where = (
		<Txt variant="small">
			{mapName(map)}
			{state.zone ? ` · zone ${state.zone}` : ""}
			{state.screen ? ` · screen ${state.screen}` : ""}
		</Txt>
	);
	const transport = (
		<View style={{ gap: 6 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
				<IconButton icon={playing ? "pause" : "play"} label={playing ? "Pause" : "Play"} primary onPress={() => (t >= duration ? (setT(0), setPlaying(true)) : setPlaying(!playing))} />
				<IconButton icon="refresh" label="Back to the start" onPress={() => setT(0)} />
				<IconButton icon="play-skip-back" label="Previous mark" onPress={() => step(-1)} />
				<IconButton icon="play-skip-forward" label="Next mark" onPress={() => step(1)} />
				<Txt variant="small" color={p.foreground} style={{ marginLeft: "auto", fontVariant: ["tabular-nums"] }} >
					{fmtClock(t)} / {fmtClock(duration)}
				</Txt>
			</View>
			<Scrubber t={t} duration={duration} onSeek={seek} />
			<Timeline marks={marks} afk={afk} t={t} duration={duration} onSeek={seek} />
		</View>
	);
	const speeds = (
		<ChipRow label="Speed">
			{SPEEDS.map((s) => (
				<ToggleChip key={s} label={`${s}x`} pressed={speed === s} onPress={() => setSpeed(s)} />
			))}
		</ChipRow>
	);
	const cameraSwitch = (
		<ChipRow>
			<ToggleChip label="Map" pressed={camera === "map"} onPress={() => setCamera("map")} />
			<ToggleChip label="Player view" pressed={camera === "player"} onPress={() => setCamera("player")} />
		</ChipRow>
	);
	const strips = (
		<View style={{ gap: space.sm }}>
			{captionList.length ? <Captions list={captionList} duration={duration} onSeek={seek} /> : null}
			<FpsStrip series={fps} duration={duration} t={t} />
			<Txt variant="small">
				{afk.length ? "Hatched: AFK (the extended streams paused). " : ""}Marks: grey clicks and taps, purple buttons / screens / prompts, red deaths, orange the game's events, amber confusion signals. Tap the timeline to jump to the nearest mark.
			</Txt>
		</View>
	);
	const recentList = (
		<View style={{ gap: 4 }}>
			<Txt style={{ fontWeight: "600" }}>Just happened</Txt>
			{recent.length ? (
				<View style={{ gap: 3 }} testID="replay-recent">
					{recent.map((m, i) => (
						<Pressable key={`${m.t}-${i}`} onPress={() => seek(m.t)} style={{ flexDirection: "row", gap: 8 }}>
							<Txt variant="small" style={{ width: 48, fontVariant: ["tabular-nums"] }}>
								{fmtClock(m.t)}
							</Txt>
							<Txt variant="small" color={p.foreground} style={{ flex: 1 }}>
								{m.label}
							</Txt>
						</Pressable>
					))}
				</View>
			) : (
				<Txt variant="small">Nothing yet.</Txt>
			)}
			<Txt variant="small">{keys} key presses so far</Txt>
		</View>
	);

	const layout = (view: ReactNode, viewControls: ReactNode, details: ReactNode) => (
		<View style={{ flex: 1, gap: space.sm }}>
			<View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ alignItems: "center" }}>
				{view}
			</View>
			{transport}
			<ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
				{header}
				{speeds}
				{badges}
				{cameraSwitch}
				{where}
				{viewControls}
				{strips}
				{recentList}
				{details}
			</ScrollView>
		</View>
	);

	if (camera === "player")
		return (
			<PlayerView backendId={backendId} replay={replay} t={t} playing={playing} speed={speed} map={map} width={width} maxHeight={viewHeight}>
				{(parts) => layout(parts.viewport, parts.controls, parts.details)}
			</PlayerView>
		);
	return <>{renderMap(map, overlay, fallback, scene, viewHeight, (parts) => layout(<View style={{ width: "100%" }}>{parts.scene}</View>, parts.controls, null))}</>;
}

/** The captions strip: each button / screen / prompt where it happened; a tap jumps there. */
function Captions({ list, duration, onSeek }: { list: readonly { t: number; label: string }[]; duration: number; onSeek: (t: number) => void }) {
	const p = useTheme();
	const pct = (ms: number) => (duration ? Math.max(0, Math.min(100, (ms / duration) * 100)) : 0);
	return (
		<View style={{ height: 22, borderRadius: 4, overflow: "hidden", backgroundColor: p.muted }} testID="replay-captions" accessibilityLabel="Buttons, screens and prompts">
			{list.map((c, i) => (
				<Pressable
					key={`${c.t}-${i}`}
					onPress={() => onSeek(c.t)}
					hitSlop={{ top: 6, bottom: 6 }}
					style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(c.t)}%`, maxWidth: 96, borderLeftWidth: 2, borderLeftColor: "#8b5cf6", paddingHorizontal: 3, justifyContent: "center" }}
				>
					<Txt variant="small" color={p.foreground} numberOfLines={1} style={{ fontSize: 10 }}>
						{c.label}
					</Txt>
				</Pressable>
			))}
		</View>
	);
}
