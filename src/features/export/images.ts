/**
 * Pictures in exports (a table's `images`, e.g. ad creatives): fetched and turned into data: URIs before the PDF or PNG
 * is made, so expo-print's page and react-native-svg draw them without loading anything. A picture that can't be fetched
 * in time keeps its URL in the PDF (the print page may still load it) and is left out of a PNG.
 */
import type { ExportBlock } from "./context";

const TIMEOUT_MS = 8000;
const PARALLEL = 6;

async function dataUri(url: string): Promise<string | null> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: ctl.signal });
		if (!res.ok) return null;
		const blob = await res.blob();
		return await new Promise<string | null>((resolve) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(typeof reader.result === "string" && reader.result.startsWith("data:") ? reader.result : null);
			reader.onerror = () => resolve(null);
			reader.readAsDataURL(blob);
		});
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** The blocks with every table picture as a data: URI (`keepUrls`: leave the ones that failed as URLs, else drop them). */
export async function inlineImages(blocks: ExportBlock[], keepUrls: boolean): Promise<ExportBlock[]> {
	const urls = [...new Set(blocks.flatMap((b) => (b.kind === "table" && b.images ? b.images.flat(2) : [])))].filter((u) => !u.startsWith("data:"));
	if (!urls.length) return blocks;
	const got = new Map<string, string | null>();
	for (let i = 0; i < urls.length; i += PARALLEL) {
		const batch = urls.slice(i, i + PARALLEL);
		const out = await Promise.all(batch.map(dataUri));
		batch.forEach((u, j) => got.set(u, out[j] ?? null));
	}
	const swap = (u: string) => (u.startsWith("data:") ? u : (got.get(u) ?? (keepUrls ? u : null)));
	return blocks.map((b) =>
		b.kind === "table" && b.images ? { ...b, images: b.images.map((row) => row.map((cell) => cell.map(swap).filter((u): u is string => !!u))) } : b,
	);
}
