/**
 * Roblox images for the maps' textures (web lib/map-textures.ts fetchImage, lib/asset-images.ts): GET /v1/images/<id>
 * answers the PNG (200), 202 while the backend still fetches it from Roblox, 404 for an unknown or refused image. A
 * ready image is written once to the cache directory (an asset id's pixels never change) and handed on as a local file
 * with its size, which is what expo-gl's texImage2D reads (`{ localUri }`); the files are kept across screens and runs.
 */
import { Directory, File, Paths } from "expo-file-system";
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

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/jpg": "jpg" };

/** One try at an image: a cached file, else the backend (200 written to a file, 202 / 429 / 5xx pending, else none). */
export async function fetchMapImage(api: Api, id: string, signal?: AbortSignal): Promise<ImageFetch> {
	const known = ready.get(id);
	if (known) return known.then((image): ImageFetch => ({ state: "ready", image }));
	const dir = folder();
	for (const ext of ["png", "webp", "jpg"]) {
		const file = new File(dir, `${id}.${ext}`);
		if (file.exists && file.size > 0) {
			const job = sizeOf(file.uri).then((s) => ({ uri: file.uri, ...s }));
			ready.set(id, job);
			job.catch(() => ready.delete(id));
			return job.then((image): ImageFetch => ({ state: "ready", image }));
		}
	}
	const answer = await api.image(id, signal);
	const type = answer.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (answer.status === 200 && type.startsWith("image/")) {
		const file = new File(dir, `${id}.${EXTENSIONS[type] ?? "png"}`);
		if (file.exists) file.delete();
		file.create();
		await file.write(new Uint8Array(answer.bytes));
		const job = sizeOf(file.uri).then((s) => ({ uri: file.uri, ...s }));
		ready.set(id, job);
		job.catch(() => ready.delete(id));
		return job.then((image): ImageFetch => ({ state: "ready", image }));
	}
	if (answer.status === 202 || answer.status === 429 || answer.status >= 500) return { state: "pending" };
	return { state: "none" };
}
