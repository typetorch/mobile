/**
 * The replay's 3D scene with people in it (port of the web explorer's components/maps/PlayerScene.tsx, plans/36): the
 * exported map (when there is one) through the maps' MapScene / MapRenderer (expo-gl + three), the recorded player and
 * every recorded entity as actors, seen from the recorded camera ("player") or with the map's touch controls ("orbit":
 * one finger turns, two pan, a pinch zooms).
 *
 *   - The recorded player: the default avatar of its Rig kind (R6 when unknown) at the tt-rec-1 root, facing the
 *     character yaw; hidden when the camera is inside its head (first person, as Roblox hides it locally).
 *   - Entities: a Humanoid model as the default avatar of its rig kind (R6 when unknown) wearing its Look (body colours,
 *     clothing from GET /v1/images through the renderer's image cache, body colours alone until an image is ready or
 *     when there is none); anything else as a box of its size in its kind's colour. Created while alive, disposed when
 *     gone.
 *   - Poses: the playing clips (GET /v1/anims/<id>) blended with the recorded joints (ext-replay.ts blendPose).
 *   - While playing, the scene runs its own animation frames between the screen's 10 Hz clock ticks (smooth motion).
 *   - A tap picks the actor under the finger (the web's click); the web's hover name shows on the tap instead.
 */
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import type { ExtEntity, ExtLook, RecordingReplayResult } from "@/api/tt/types";
import type { Bounds, MapGeometry, MapLayer, Vec3 } from "@/features/maps/maps";
import { MapScene } from "@/features/maps/MapScene";
import type { MapRenderer, TouchPoint } from "@/features/maps/renderer";

import { assetIdOf } from "./assets";
import { createAvatar, placeAvatar, type Avatar, type AvatarKind } from "./avatar";
import { alive, animIdOf, blendPose, cameraAt, entityAt, kindColor, poseTracks, recordedPose, rigAt, sampleClip, selfAt, tracksAt, viewAt, type AnimClip, type Quat } from "./ext-replay";

export interface PlayerSceneProps {
	backendId: string;
	geometry: MapGeometry | null;
	bounds: Bounds | null;
	offset?: Vec3;
	replay: RecordingReplayResult;
	/** ms into the replay. */
	t: number;
	playing?: boolean;
	speed?: number;
	camera: "player" | "orbit";
	/** Clips by animation id (digits); null: none exported. */
	clips?: ReadonlyMap<string, AnimClip | null>;
	/** Extra world layers (the path, in the orbit view). */
	layers?: MapLayer[];
	selected?: number | null;
	/** A tap: the entity under it (null: none), and where (dp in the view). */
	onPick?: (entity: number | null, at: TouchPoint) => void;
	label?: string;
	style?: StyleProp<ViewStyle>;
	/** Drawn over the scene (the recorded UI, tap rings, caption). */
	children?: ReactNode;
}

interface Actor {
	object: THREE.Object3D;
	avatar?: Avatar;
	box?: THREE.Mesh;
	/** Cancels the clothing loads still waiting. */
	cancel?: () => void;
}

const NO_OFFSET: Vec3 = [0, 0, 0];
const NO_CLIPS: ReadonlyMap<string, AnimClip | null> = new Map();
const NO_LAYERS: MapLayer[] = [];

function avatarKind(rig: string | undefined): AvatarKind {
	return rig === "R15" ? "R15" : "R6";
}

/** Puts the Look's clothing on (each image once the renderer has it as a texture); returns a cancel. */
function dress(renderer: MapRenderer, avatar: Avatar, look: ExtLook | undefined): () => void {
	if (!look) return () => undefined;
	const worn: { shirt?: THREE.Texture | null; pants?: THREE.Texture | null; tshirt?: THREE.Texture | null; face?: THREE.Texture | null } = {};
	const cancels: (() => void)[] = [];
	for (const slot of ["shirt", "pants", "tshirt", "face"] as const) {
		const id = assetIdOf(look[slot]);
		if (!id) continue;
		cancels.push(
			renderer.texture(id, (texture) => {
				worn[slot] = texture;
				avatar.setClothing({ ...worn });
				renderer.render();
			}),
		);
	}
	return () => {
		for (const c of cancels) c();
	};
}

export function PlayerScene({ backendId, geometry, bounds, offset = NO_OFFSET, replay, t, playing = false, speed = 1, camera, clips = NO_CLIPS, layers = NO_LAYERS, selected = null, onPick, label, style, children }: PlayerSceneProps) {
	const renderer = useRef<MapRenderer | null>(null);
	const [generation, setGeneration] = useState(0);
	const actors = useRef(new Map<number, Actor>());
	const ext = replay.extended ?? null;
	const tracks = useMemo(() => (ext ? poseTracks(ext) : new Map()), [ext]);
	const entities = useMemo(() => (ext?.entities ?? []).filter((e) => e.e !== 0), [ext]);
	const self = useMemo(() => ext?.entities.find((e) => e.e === 0), [ext]);

	const dropAll = () => {
		const owned = actors.current;
		for (const actor of owned.values()) {
			renderer.current?.actors.remove(actor.object);
			disposeActor(actor);
		}
		owned.clear();
	};

	// A new GL context (a remount at a new size) has a new renderer: the actors start over in it.
	const onRenderer = (r: MapRenderer | null) => {
		dropAll();
		renderer.current = r;
		setGeneration((n) => n + 1);
	};

	// a new replay: its actors start over
	useEffect(() => dropAll, [replay]);
	useEffect(() => dropAll, []);

	// what the scene shows at a moment (called per animation frame while playing)
	const draw = useRef<(at: number) => void>(() => undefined);
	draw.current = (at: number) => {
		const r = renderer.current;
		if (!r) return;
		const owned = actors.current;
		const poseFor = (e: number, avatar: Avatar) => {
			const playingClips = [];
			if (ext) {
				for (const track of tracksAt(ext, e, at)) {
					const id = animIdOf(track.anim.id);
					const clip = id ? clips.get(id) : null;
					if (clip) playingClips.push({ pose: sampleClip(clip, track.time, track.anim.looped), weight: track.weight, priority: clip.priority ?? 0, from: track.anim.from });
				}
			}
			const recorded = recordedPose(tracks, e, at);
			avatar.setPose(blendPose(playingClips, recorded) as Record<string, Quat>);
		};
		const ensure = (e: number, make: () => Actor) => {
			let actor = owned.get(e);
			if (!actor) {
				actor = make();
				actor.object.userData.actor = e;
				owned.set(e, actor);
				r.actors.add(actor.object);
			}
			return actor;
		};
		const drop = (e: number) => {
			const actor = owned.get(e);
			if (!actor) return;
			r.actors.remove(actor.object);
			disposeActor(actor);
			owned.delete(e);
		};
		const cam = cameraAt(replay, at);
		// the recorded player
		const root = selfAt(replay, at);
		if (root) {
			const actor = ensure(0, () => {
				const avatar = createAvatar(avatarKind(ext ? rigAt(ext, 0, at)?.rig : undefined), self?.look?.colors ? { colors: self.look.colors } : {});
				return { object: avatar.root, avatar, cancel: dress(r, avatar, self?.look) };
			});
			const avatar = actor.avatar as Avatar;
			placeAvatar(avatar, root.position[0], root.position[1], root.position[2], root.yaw);
			poseFor(0, avatar);
			const head = new THREE.Vector3(root.position[0], root.position[1] + 1.5, root.position[2]);
			const firstPerson = camera === "player" && cam !== null && head.distanceTo(new THREE.Vector3(...cam.position)) < 1.2;
			actor.object.visible = !firstPerson;
			avatar.setHighlight(selected === 0);
		} else drop(0);
		// everyone and everything else
		for (const ent of entities) {
			const state = alive(ent, at) ? entityAt(ent, at) : null;
			if (!state) {
				drop(ent.e);
				continue;
			}
			const actor = ensure(ent.e, () => makeEntity(r, ent, ext ? rigAt(ext, ent.e, at)?.rig : undefined));
			if (actor.avatar) {
				placeAvatar(actor.avatar, state.position[0], state.position[1], state.position[2], state.yaw);
				poseFor(ent.e, actor.avatar);
				actor.avatar.setHighlight(selected === ent.e);
			} else {
				actor.object.position.set(...state.position);
				actor.object.rotation.set(0, state.yaw, 0);
				const material = actor.box?.material as THREE.MeshLambertMaterial | undefined;
				material?.emissive.setHex(selected === ent.e ? 0x444444 : 0x000000);
			}
		}
		if (camera === "player" && cam) r.setView({ position: cam.position, look: cam.look, fov: viewAt(replay, at).fov });
		else r.setView(null);
		r.render();
	};

	// the screen's clock: draw at `t`; while playing, interpolate between its ticks
	useEffect(() => {
		const since = performance.now();
		draw.current(t);
		if (!playing) return;
		let frame = requestAnimationFrame(function step(now) {
			draw.current(t + Math.min(250, now - since) * speed);
			frame = requestAnimationFrame(step);
		});
		return () => cancelAnimationFrame(frame);
	}, [t, playing, speed, camera, selected, clips, replay, generation]);

	// The orbit camera starts framing the map (or the recorded positions' box): without an export the renderer has no
	// geometry change that would fit it and would sit at the origin (the free camera, or a replay without camera samples).
	// The recorded camera (setView) is not moved by it.
	useEffect(() => {
		renderer.current?.fit();
	}, [camera, generation]);

	const onTap = (at: TouchPoint) => {
		if (!onPick) return;
		const hit = renderer.current?.pickActor(at.x, at.y);
		onPick(hit ? (hit.userData.actor as number) : null, at);
	};

	return (
		<MapScene
			backendId={backendId}
			geometry={geometry}
			bounds={bounds}
			mode="3d"
			layers={layers}
			offset={offset}
			label={label ?? "Replay"}
			onRenderer={onRenderer}
			onTap={onTap}
			hint={camera === "player" ? null : "drag to turn, two fingers to pan, pinch to zoom · tap a person"}
			fitButton={camera !== "player"}
			style={style}
		>
			{children}
		</MapScene>
	);
}

function makeEntity(renderer: MapRenderer, ent: ExtEntity, rig: string | undefined): Actor {
	if (ent.humanoid) {
		const avatar = createAvatar(avatarKind(rig), ent.look?.colors ? { colors: ent.look.colors } : {});
		return { object: avatar.root, avatar, cancel: dress(renderer, avatar, ent.look) };
	}
	const [x, y, z] = ent.size;
	const box = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, x), Math.max(0.2, y), Math.max(0.2, z)), new THREE.MeshLambertMaterial({ color: kindColor(ent.kind), transparent: true, opacity: 0.85 }));
	const group = new THREE.Group();
	group.add(box);
	return { object: group, box };
}

function disposeActor(actor: Actor): void {
	actor.cancel?.();
	actor.avatar?.dispose();
	if (actor.box) {
		actor.box.geometry.dispose();
		(actor.box.material as THREE.Material).dispose();
	}
}
