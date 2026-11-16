/**
 * The replay's Player view (port of the web explorer's pages/recordings/PlayerView.tsx, plans/36): what the player saw,
 * at the recorded viewport's aspect.
 *
 *   - The 3D scene from the recorded camera (any session: tt-rec-1 has the camera; FOV from tt-ext-1 View, else 70),
 *     with the recorded player, other players and tracked models (PlayerScene); "Free camera" uses the map's touch
 *     controls instead.
 *   - Over it: the recorded UI (UiOverlay, extended sessions), click / tap rings at the pointer's position, the latest
 *     button / screen / prompt as a caption, and "AFK" while the player was away (the extended streams paused).
 *   - Below: the legend by kind, what is on screen now with its animations (a clip plays when exported, else the
 *     recorded joints or the rest pose, with the animation's id shown), and the picked UI node's or entity's properties.
 * The web's hover name is shown where a person was tapped (no hover on a phone).
 *
 * Phone layout: the viewport and what goes under it are handed to `children` separately, so the replay keeps the view
 * fixed on top and the rest in its scroll view.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";

import type { Bounds } from "@/features/maps/maps";
import type { RecordingReplayResult } from "@/api/tt/types";
import { Txt } from "@/components/ui";
import { ChipRow, ToggleChip } from "@/features/maps/BandControls";
import { useMapGeometry } from "@/features/maps/hooks";
import { radius, space, useTheme } from "@/theme";

import { useAnimClips } from "./assets";
import { afkAt, alive, animIdOf, captionAt, captions, entityAt, entityNames, kindColor, ringsAt, tracksAt, viewAt } from "./ext-replay";
import { fmtClock } from "./map";
import { PlayerScene } from "./PlayerScene";
import { useExportFor } from "./RealMap";
import { UiOverlay, UiProperties } from "./UiOverlay";

/** A box around the recorded positions (the scene's grid) when the map has no export. */
export function boundsOfSamples(replay: RecordingReplayResult): Bounds | null {
	let min: [number, number, number] | null = null;
	let max: [number, number, number] = [0, 0, 0];
	for (const s of replay.samples ?? []) {
		if (s[1] === null || s[2] === null || s[3] === null) continue;
		const p: [number, number, number] = [s[1], s[2], s[3]];
		if (!min) {
			min = [...p];
			max = [...p];
			continue;
		}
		for (let k = 0; k < 3; k++) {
			min[k] = Math.min(min[k] as number, p[k] as number);
			max[k] = Math.max(max[k] as number, p[k] as number);
		}
	}
	if (!min) return null;
	return { min: [min[0] - 20, min[1] - 4, min[2] - 20], max: [max[0] + 20, max[1] + 4, max[2] + 20] };
}

export interface PlayerViewParts {
	/** The viewport (fixed on top). */
	viewport: ReactNode;
	/** Its switches (camera, UI) and read-out. */
	controls: ReactNode;
	/** The legend, what is on screen, the properties. */
	details: ReactNode;
}

export function PlayerView({
	backendId,
	replay,
	t,
	playing = false,
	speed = 1,
	map,
	width,
	maxHeight,
	children,
}: {
	backendId: string;
	replay: RecordingReplayResult;
	t: number;
	playing?: boolean;
	speed?: number;
	map: string;
	/** The width available (dp). */
	width: number;
	/** The tallest the viewport may be (dp); a tall recorded aspect gets narrower instead. */
	maxHeight?: number;
	children: (parts: PlayerViewParts) => ReactNode;
}) {
	const p = useTheme();
	const window = useWindowDimensions();
	const ext = replay.extended ?? null;
	const [free, setFree] = useState(false);
	const [showUi, setShowUi] = useState(true);
	const [picked, setPicked] = useState<{ kind: "ui" | "entity"; id: number } | null>(null);
	const [named, setNamed] = useState<{ e: number; left: number; top: number } | null>(null);
	const exp = useExportFor(backendId, map);
	const geometry = useMapGeometry(backendId, exp.info);
	const fallbackBounds = useMemo(() => boundsOfSamples(replay), [replay]);
	const animIds = useMemo(() => [...new Set((ext?.anims ?? []).map((a) => animIdOf(a.id)).filter((id): id is string => id !== null))], [ext]);
	const clips = useAnimClips(backendId, animIds);
	const names = useMemo(() => (ext ? entityNames(ext) : new Map<number, string>()), [ext]);
	const captionList = useMemo(() => captions(replay), [replay]);
	const view = viewAt(replay, t);
	const afk = afkAt(ext, t);
	const caption = captionAt(captionList, t);
	const rings = ringsAt(replay, t);
	const onScreen = (ext?.entities ?? []).filter((e) => e.e !== 0 && alive(e, t) && entityAt(e, t));
	const kinds = [...new Set(onScreen.map((e) => (e.player ? "player" : e.kind)))].sort();
	const real = exp.info !== null;
	const pickedEntity = picked?.kind === "entity" ? (ext?.entities.find((e) => e.e === picked.id) ?? null) : null;
	const aspect = view.w / Math.max(1, view.h);
	const limit = maxHeight ?? window.height * 0.5;
	let vw = Math.max(1, width);
	let vh = vw / aspect;
	if (vh > limit) {
		vh = limit;
		vw = vh * aspect;
	}
	const insetPx = (view.inset / Math.max(1, view.h)) * vh;

	const viewport = (
		<View style={{ width: vw, height: vh, alignSelf: "center" }} testID="player-viewport">
			<PlayerScene
				backendId={backendId}
				geometry={geometry.data ?? null}
				bounds={exp.info?.bounds ?? fallbackBounds}
				offset={exp.info?.offset ?? [0, 0, 0]}
				replay={replay}
				t={t}
				playing={playing}
				speed={speed}
				camera={free ? "orbit" : "player"}
				clips={clips}
				selected={picked?.kind === "entity" ? picked.id : null}
				onPick={(e, at) => {
					setPicked(e === null ? null : { kind: "entity", id: e });
					setNamed(e === null ? null : { e, left: at.x, top: at.y });
				}}
				label={`Player view at ${fmtClock(t)}`}
				style={{ width: vw, height: vh, backgroundColor: "#0f172a" }}
			>
				{ext && showUi && !free ? (
					<UiOverlay backendId={backendId} ui={ext.ui} t={t} viewport={{ w: view.w, h: view.h, inset: view.inset }} width={vw} selected={picked?.kind === "ui" ? picked.id : null} onSelect={(i) => setPicked(i === null ? null : { kind: "ui", id: i })} />
				) : null}
				{!free
					? rings.map((r) => {
							const size = 24 + r.age * 48;
							return (
								<View
									key={`${r.t}-${r.x}-${r.y}`}
									pointerEvents="none"
									testID="tap-ring"
									style={{
										position: "absolute",
										left: r.x * vw - size / 2,
										top: r.y * vh + insetPx - size / 2,
										width: size,
										height: size,
										borderRadius: size / 2,
										borderWidth: 2,
										borderColor: r.type === "tap" ? "#22d3ee" : "#f8fafc",
										opacity: 1 - r.age,
									}}
								/>
							);
						})
					: null}
				{afk ? (
					<View pointerEvents="none" style={{ position: "absolute", top: 8, left: 0, right: 0, alignItems: "center" }}>
						<View style={{ backgroundColor: p.scheme === "dark" ? "rgba(10,10,10,0.85)" : "rgba(255,255,255,0.88)", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 }}>
							<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
								AFK: extended streams paused
							</Txt>
						</View>
					</View>
				) : null}
				{caption ? (
					<View pointerEvents="none" style={{ position: "absolute", bottom: 8, left: 0, right: 0, alignItems: "center" }} testID="player-caption">
						<View style={{ maxWidth: "90%", backgroundColor: p.scheme === "dark" ? "rgba(10,10,10,0.85)" : "rgba(255,255,255,0.88)", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 }}>
							<Txt variant="small" color={p.foreground} numberOfLines={1}>
								{caption.label}
							</Txt>
						</View>
					</View>
				) : null}
				{named && picked?.kind === "entity" && picked.id === named.e ? (
					<View pointerEvents="none" style={{ position: "absolute", left: Math.min(vw - 120, named.left + 12), top: Math.min(vh - 24, named.top + 12), backgroundColor: p.scheme === "dark" ? "rgba(10,10,10,0.9)" : "rgba(255,255,255,0.92)", borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
						<Txt variant="small" color={p.foreground} numberOfLines={1}>
							{names.get(named.e) ?? `entity ${named.e}`}
						</Txt>
					</View>
				) : null}
			</PlayerScene>
		</View>
	);

	const controls = (
		<View style={{ gap: 6 }}>
			<ChipRow>
				<ToggleChip label="Recorded camera" pressed={!free} onPress={() => setFree(false)} />
				<ToggleChip label="Free camera" pressed={free} onPress={() => setFree(true)} />
				{ext?.ui.length ? <ToggleChip label="UI" pressed={showUi} onPress={() => setShowUi(!showUi)} /> : null}
			</ChipRow>
			<Txt variant="small">
				{view.w}x{view.h} px, FOV {view.fov}
				{ext ? "" : " (assumed: no extended data)"}
				{real ? "" : " · no map export: people only"}
			</Txt>
		</View>
	);

	const details = ext ? (
		<View style={{ gap: space.md }}>
			<View style={{ gap: 4 }}>
				<Txt style={{ fontWeight: "600" }}>On screen</Txt>
				{kinds.length ? (
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityLabel="Legend">
						{kinds.map((k) => (
							<View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
								<View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: kindColor(k) }} />
								<Txt variant="small">{k}</Txt>
							</View>
						))}
					</View>
				) : (
					<Txt variant="small">No other players or tracked models near the player.</Txt>
				)}
				<View style={{ gap: 2 }} testID="player-entities">
					{[...(ext.entities.some((e) => e.e === 0) ? [0] : []), ...onScreen.map((e) => e.e)].map((e) => {
						const anims = tracksAt(ext, e, t);
						return (
							<Pressable key={e} onPress={() => setPicked({ kind: "entity", id: e })} style={{ paddingVertical: 3 }} accessibilityRole="button">
								<Txt variant="small">
									<Txt variant="small" color={picked?.kind === "entity" && picked.id === e ? p.brand : p.foreground} style={{ textDecorationLine: "underline" }}>
										{names.get(e) ?? `entity ${e}`}
									</Txt>
									{anims.length
										? ` playing ${anims
												.map((a) => {
													const id = animIdOf(a.anim.id);
													const has = id ? clips.get(id) : null;
													return `${id ?? a.anim.id}${has ? "" : " (no clip)"}`;
												})
												.join(", ")}`
										: ""}
								</Txt>
							</Pressable>
						);
					})}
				</View>
			</View>
			<View>
				{picked?.kind === "ui" ? <UiProperties ui={ext.ui} i={picked.id} t={t} /> : null}
				{picked?.kind === "entity" ? <EntityProperties replay={replay} e={picked.id} name={names.get(picked.id) ?? `entity ${picked.id}`} entity={pickedEntity ?? null} t={t} /> : null}
				{!picked ? <Txt variant="small">Tap a person, a model or a piece of the UI for its recorded properties.</Txt> : null}
			</View>
		</View>
	) : (
		<Txt variant="small">This session has no extended recording: the Player view shows the recorded camera, the player and their clicks and taps (FOV assumed 70).</Txt>
	);

	return <>{children({ viewport, controls, details })}</>;
}

function EntityProperties({ replay, e, name, entity, t }: { replay: RecordingReplayResult; e: number; name: string; entity: NonNullable<RecordingReplayResult["extended"]>["entities"][number] | null; t: number }) {
	const p = useTheme();
	const ext = replay.extended;
	const state = entity ? entityAt(entity, t) : null;
	const rows: [string, string][] = [["Entity", name]];
	if (entity) {
		rows.push(["Kind", entity.kind], ["Humanoid", entity.humanoid ? "yes" : "no"], ["Size", entity.size.map((v) => v.toFixed(1)).join(" x ")]);
		rows.push(["Seen", `${fmtClock(entity.from)} to ${entity.to === null ? "the end" : fmtClock(entity.to)}`]);
		if (state) rows.push(["Position", state.position.map((v) => v.toFixed(1)).join(", ")]);
		const look = entity.look;
		if (look?.shirt) rows.push(["Shirt", look.shirt]);
		if (look?.pants) rows.push(["Pants", look.pants]);
		if (look?.tshirt) rows.push(["T-shirt", look.tshirt]);
		if (look?.face) rows.push(["Face", look.face]);
	}
	const mine = ext?.rigs.filter((r) => r.e === e && r.t <= t) ?? [];
	const rig = mine[mine.length - 1] ?? ext?.rigs.find((r) => r.e === e);
	if (rig) rows.push(["Rig", `${rig.rig} (${rig.joints.length} joints)`]);
	for (const track of ext ? tracksAt(ext, e, t) : []) rows.push([`Track ${track.anim.track}`, `${track.anim.id} · ${track.time.toFixed(2)} s · speed ${track.speed} · weight ${track.weight}${track.anim.looped ? " · looped" : ""}`]);
	return (
		<View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md, padding: space.sm, gap: 3, backgroundColor: p.card }} testID="entity-properties">
			{rows.map(([k, v]) => (
				<View key={k} style={{ flexDirection: "row", gap: space.sm }}>
					<Txt variant="small" style={{ width: 84 }}>
						{k}
					</Txt>
					<Txt variant="small" color={p.foreground} style={{ flex: 1 }} selectable>
						{v}
					</Txt>
				</View>
			))}
		</View>
	);
}
