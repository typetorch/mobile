/**
 * The replay's assets from the backend (ports of the web explorer's lib/anim-clips.ts and lib/asset-images.ts):
 *
 *   - Animation clips: GET /v1/anims/<animationId> answers `{ id, length, looped, keyframes: [{ t, poses: { [joint]:
 *     [qx, qy, qz, qw] } }], priority? }` once the export task has read the animation, 404 until then. A clip never
 *     changes: kept for the app's life; a missing one is asked again after a minute.
 *   - Images for the recorded UI (UiOverlay): GET /v1/images/<assetId> answers the image (200), 202 while the backend
 *     still fetches it from Roblox (retried a few times), 404 for an unknown or refused image. A ready image is written
 *     once to the cache directory (an asset id's pixels never change) and shown from that file by React Native's Image,
 *     which reads PNG, JPEG, WebP and GIF (unlike expo-gl's texture upload: the 3D avatars' clothing goes through the map
 *     renderer's PNG / JPEG loader, features/maps/images.ts).
 * Both are per backend (two backends' asset ids are the same Roblox ids, but either may not have fetched one yet).
 */
import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { Image } from "react-native";

import type { Api } from "@/api/backend";
import { useBackend } from "@/store/accounts";

import type { AnimClip, Quat } from "./ext-replay";

// Animation clips -------------------------------------------------------------------------------------------------------

const MAX_KEYFRAMES = 5000;
const RETRY_MS = 60_000;

const clips = new Map<string, { clip: AnimClip | null; at: number }>();
const clipJobs = new Map<string, Promise<AnimClip | null>>();

const isQuat = (q: unknown): q is Quat => Array.isArray(q) && q.length === 4 && q.every((v) => typeof v === "number" && Number.isFinite(v));

/** A clip from the endpoint's JSON, or null when it isn't one (only well-formed joints and keyframes kept). */
export function parseClip(body: unknown, id: string): AnimClip | null {
	if (!body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;
	if (!Array.isArray(b.keyframes)) return null;
	const keyframes: AnimClip["keyframes"] = [];
	for (const k of b.keyframes.slice(0, MAX_KEYFRAMES) as unknown[]) {
		if (!k || typeof k !== "object") continue;
		const { t, poses } = k as { t?: unknown; poses?: unknown };
		if (typeof t !== "number" || !Number.isFinite(t) || !poses || typeof poses !== "object") continue;
		const kept: Record<string, Quat> = {};
		for (const [name, q] of Object.entries(poses as Record<string, unknown>)) if (isQuat(q)) kept[name] = q;
		keyframes.push({ t, poses: kept });
	}
	keyframes.sort((a, c) => a.t - c.t);
	const length = typeof b.length === "number" && Number.isFinite(b.length) ? b.length : (keyframes[keyframes.length - 1]?.t ?? 0);
	return { id, length, looped: b.looped === true, keyframes, ...(typeof b.priority === "number" ? { priority: b.priority } : {}) };
}

export function loadClip(api: Api, scope: string, id: string, now = Date.now()): Promise<AnimClip | null> {
	const key = `${scope}:${id}`;
	const known = clips.get(key);
	if (known && (known.clip || now - known.at < RETRY_MS)) return Promise.resolve(known.clip);
	const running = clipJobs.get(key);
	if (running) return running;
	const job = (async () => {
		let clip: AnimClip | null = null;
		try {
			clip = parseClip(await api.anim(id), id);
		} catch {
			clip = null;
		}
		clips.set(key, { clip, at: now });
		return clip;
	})().finally(() => clipJobs.delete(key));
	clipJobs.set(key, job);
	return job;
}

/** The clips for these animation ids (digits), as they arrive: a map of id -> clip (null: none). */
export function useAnimClips(backendId: string, ids: readonly string[]): ReadonlyMap<string, AnimClip | null> {
	const { api } = useBackend(backendId);
	const key = [...new Set(ids)].sort().join(",");
	const [map, setMap] = useState<ReadonlyMap<string, AnimClip | null>>(() => new Map());
	useEffect(() => {
		if (!api) return;
		let live = true;
		const list = key ? key.split(",") : [];
		void Promise.all(list.map(async (id) => [id, await loadClip(api, backendId, id)] as const)).then((entries) => {
			if (live) setMap(new Map(entries));
		});
		return () => {
			live = false;
		};
	}, [key, api, backendId]);
	return map;
}

// Images ------------------------------------------------------------------------------------------------------------------

export type AssetImage = { state: "loading" } | { state: "pending" } | { state: "missing" } | { state: "ready"; uri: string; width: number; height: number };

/** The numeric asset id in an Image / template / texture string (`rbxassetid://1`, `http://www.roblox.com/asset/?id=1`, `1`), else null. */
export function assetIdOf(content: string | null | undefined): string | null {
	if (!content) return null;
	const text = content.trim();
	if (/^\d{1,20}$/.test(text)) return text;
	let m = /^rbxassetid:\/\/(\d{1,20})\s*$/i.exec(text);
	if (m) return m[1] as string;
	m = /^https?:\/\/(?:www\.)?roblox\.com\/asset\/?\?(?:.*&)?id=(\d{1,20})(?:&.*)?$/i.exec(text);
	if (m) return m[1] as string;
	return null;
}

/** Retries of a 202 answer and the wait between them. */
export const PENDING_RETRIES = 6;
export const PENDING_WAIT_MS = 5000;

const cache = new Map<string, AssetImage>();
const imageJobs = new Map<string, Promise<AssetImage>>();
const listeners = new Map<string, Set<(image: AssetImage) => void>>();

type Kind = "png" | "jpg" | "webp" | "gif";

/** The image's format by its magic bytes (what React Native's Image decodes), else null (an error page, a truncated file). */
export function uiImageKind(b: Uint8Array): Kind | null {
	if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
	if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
	if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
	return null;
}

function folder(): Directory {
	const dir = new Directory(Paths.cache, "tt-ui-images");
	if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
	return dir;
}

function sizeOf(uri: string): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), (error) => reject(error)));
}

function settle(key: string, image: AssetImage): AssetImage {
	cache.set(key, image);
	for (const fn of listeners.get(key) ?? []) fn(image);
	return image;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ready(key: string, uri: string): Promise<AssetImage> {
	try {
		const size = await sizeOf(uri);
		return settle(key, { state: "ready", uri, ...size });
	} catch {
		return settle(key, { state: "missing" });
	}
}

/** Loads one asset image (shared by every caller; a 202 is retried, then stays "pending" until the app restarts). */
export function loadAssetImage(api: Api, scope: string, id: string): Promise<AssetImage> {
	const key = `${scope}:${id}`;
	const known = cache.get(key);
	if (known && known.state !== "loading") return Promise.resolve(known);
	const running = imageJobs.get(key);
	if (running) return running;
	cache.set(key, { state: "loading" });
	const job = (async (): Promise<AssetImage> => {
		const dir = folder();
		for (const ext of ["png", "jpg", "webp", "gif"] as const) {
			const file = new File(dir, `${id}.${ext}`);
			if (file.exists && file.size > 0) return ready(key, file.uri);
		}
		for (let attempt = 0; attempt <= PENDING_RETRIES; attempt++) {
			let answer: Awaited<ReturnType<Api["image"]>>;
			try {
				answer = await api.image(id);
			} catch {
				return settle(key, { state: "missing" });
			}
			if (answer.status === 202) {
				if (attempt === PENDING_RETRIES) return settle(key, { state: "pending" });
				settle(key, { state: "pending" });
				await wait(PENDING_WAIT_MS);
				continue;
			}
			if (answer.status !== 200) return settle(key, { state: "missing" });
			const bytes = new Uint8Array(answer.bytes);
			const kind = uiImageKind(bytes);
			if (!kind) return settle(key, { state: "missing" });
			try {
				const file = new File(dir, `${id}.${kind}`);
				if (file.exists) file.delete();
				file.create();
				await file.write(bytes);
				return ready(key, file.uri);
			} catch {
				return settle(key, { state: "missing" });
			}
		}
		return settle(key, { state: "pending" });
	})().finally(() => imageJobs.delete(key));
	imageJobs.set(key, job);
	return job;
}

/** The image for an Image / template string: null when it is no asset id (draw a placeholder), else its state. */
export function useAssetImage(backendId: string, content: string | null | undefined): AssetImage | null {
	const { api } = useBackend(backendId);
	const id = assetIdOf(content);
	const key = `${backendId}:${id}`;
	const [image, setImage] = useState<AssetImage | null>(() => (id ? (cache.get(key) ?? { state: "loading" }) : null));
	useEffect(() => {
		if (!id || !api) {
			setImage(null);
			return;
		}
		setImage(cache.get(key) ?? { state: "loading" });
		let set = listeners.get(key);
		if (!set) listeners.set(key, (set = new Set()));
		const fn = (next: AssetImage) => setImage(next);
		set.add(fn);
		void loadAssetImage(api, backendId, id).then(fn);
		return () => {
			set?.delete(fn);
		};
	}, [id, key, api, backendId]);
	return image;
}
