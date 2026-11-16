/**
 * Roblox images for the maps' textures (web lib/map-textures.ts fetchImage, lib/asset-images.ts): GET /v1/images/<id>
 * answers the image (200), 202 while the backend still fetches it from Roblox, 404 for an unknown or refused image. A
 * ready image is written once to the cache directory (an asset id's pixels never change) and handed on as a local file
 * with its size, which is what expo-gl's texImage2D reads (`{ localUri }`); the files are kept across screens and runs.
 *
 * Only PNG and JPEG are kept. expo-gl decodes `{ localUri }` with stb_image (EXGLImageUtils.cpp loadImage), which has no
 * WebP decoder: a WebP file (the backend stores what Roblox's CDN returns, WebP included) would come back as a null
 * pixel pointer, and texSubImage2D with it is an uninitialised texture or a native crash. So the bytes are sniffed
 * (89 50 4E 47 / FF D8 FF), not trusted by content type, and anything else is "none": the part keeps its plain colour.
 * A cached file is sniffed again before use (a purged or corrupt cache file takes the same path).
 */
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { Image } from "react-native";

import type { Api } from "@/api/backend";

import type { ImageFetch, LocalImage } from "./map-textures";

const ready = new Map<string, Promise<LocalImage>>();

function folder(): Directory {
	const dir = new Directory(Paths.cache, "tt-images");
	if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
	return dir;
}

function sizeOf(uri: string): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), (error) => reject(error)));
}

type Kind = "png" | "jpg";

/** PNG or JPEG by the magic bytes (stb_image decodes both), else null (WebP, GIF, an error page, a truncated file). */
export function imageKind(head: Uint8Array): Kind | null {
	if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "png";
	if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
	return null;
}

/** The first bytes of a file, empty when it can't be read. */
function headOf(file: File): Uint8Array {
	try {
		const handle = file.open(FileMode.ReadOnly);
		try {
			return handle.readBytesSync(8);
		} finally {
			handle.close();
		}
	} catch {
		return new Uint8Array(0);
	}
}

function remove(file: File): void {
	try {
		if (file.exists) file.delete();
	} catch {
		// gone already
	}
}

/** A usable local file: it still exists and is PNG / JPEG (the memory cache can outlive a purged cache folder). */
function usable(uri: string): boolean {
	try {
		const file = new File(uri);
		return file.exists && file.size > 0 && imageKind(headOf(file)) !== null;
	} catch {
		return false;
	}
}

function hand(id: string, uri: string): Promise<ImageFetch> {
	const job = sizeOf(uri).then((s) => ({ uri, ...s }));
	ready.set(id, job);
	job.catch(() => ready.delete(id));
	return job.then((image): ImageFetch => ({ state: "ready", image }));
}

/** One try at an image: a cached file, else the backend (PNG / JPEG 200 written to a file, 202 / 429 / 5xx pending, else none). */
export async function fetchMapImage(api: Api, id: string, signal?: AbortSignal): Promise<ImageFetch> {
	const known = ready.get(id);
	if (known) {
		const image = await known.catch(() => null);
		if (image && usable(image.uri)) return { state: "ready", image };
		ready.delete(id);
	}
	const dir = folder();
	// .webp: left by an earlier build that kept WebP; never handed on, removed.
	for (const ext of ["png", "jpg", "webp"]) {
		const file = new File(dir, `${id}.${ext}`);
		if (!file.exists) continue;
		if (ext !== "webp" && file.size > 0 && imageKind(headOf(file)) === ext) return hand(id, file.uri);
		remove(file);
	}
	const answer = await api.image(id, signal);
	if (answer.status === 200) {
		const bytes = new Uint8Array(answer.bytes);
		const kind = imageKind(bytes);
		if (!kind) return { state: "none" };
		const file = new File(dir, `${id}.${kind}`);
		remove(file);
		file.create();
		await file.write(bytes);
		if (!usable(file.uri)) return { state: "none" };
		return hand(id, file.uri);
	}
	if (answer.status === 202 || answer.status === 429 || answer.status >= 500) return { state: "pending" };
	return { state: "none" };
}
