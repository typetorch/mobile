/** The system file picker (expo-file-system, part of Expo Go) for one file of any type, e.g. an .rbxl place or a Luau binary input. */
import { File } from "expo-file-system";

import { notify } from "@/components/ui";
import { fileLabel, fmtBytes } from "@/features/project/api/configure";

/**
 * Opens the picker for one file; null when cancelled, over `maxBytes` or refused by `check` (which answers why; it runs
 * after the size check and may read the file's first bytes) — each refusal shows a notice. The size comes from the
 * file system, so a large file isn't read here.
 */
export async function pickOneFile(options: { maxBytes: number; check?: (file: File) => string | null | Promise<string | null> }): Promise<File | null> {
	let picked: File;
	try {
		// "*/*": phones don't know .rbxl / .rbxlx MIME types, so callers check the file after picking.
		const r = await File.pickFileAsync({ mimeTypes: ["*/*"] });
		if (r.canceled || !r.result) return null;
		picked = r.result;
	} catch (e) {
		notify("Can't open the file picker", e instanceof Error ? e.message : String(e));
		return null;
	}
	const size = typeof picked.size === "number" ? picked.size : 0;
	if (size > options.maxBytes) {
		notify("File too large", `${fileLabel(picked, "The file")} is ${fmtBytes(size)}; the limit is ${fmtBytes(options.maxBytes)}.`);
		return null;
	}
	let why: string | null = null;
	try {
		why = (await options.check?.(picked)) ?? null;
	} catch (e) {
		why = e instanceof Error ? e.message : String(e);
	}
	if (why) {
		notify("Can't use this file", why);
		return null;
	}
	return picked;
}
