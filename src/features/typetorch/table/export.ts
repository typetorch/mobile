/**
 * The web's data-table/clipboard.ts for the phone: copy text with expo-clipboard, and "download" a file by writing it
 * to the cache (expo-file-system) and opening the share sheet (expo-sharing: save to Files / Drive, mail, chat, ...).
 */
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function copyText(text: string): Promise<boolean> {
	try {
		await Clipboard.setStringAsync(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * Saves `text` as a file in the app's cache and opens the share sheet for it. A UTF-8 byte order mark first makes
 * Excel read CSV with accents and dashes right. False when it couldn't be written or shared.
 */
export async function shareTextFile(filename: string, text: string, mime = "text/csv", bom = true): Promise<boolean> {
	try {
		const file = new File(Paths.cache, filename);
		if (file.exists) file.delete();
		file.create();
		file.write(`${bom ? "﻿" : ""}${text}`);
		if (!(await Sharing.isAvailableAsync())) return false;
		await Sharing.shareAsync(file.uri, {
			mimeType: mime,
			dialogTitle: filename,
			...(mime === "text/csv" ? { UTI: "public.comma-separated-values-text" } : mime === "application/json" ? { UTI: "public.json" } : {}),
		});
		return true;
	} catch {
		return false;
	}
}
