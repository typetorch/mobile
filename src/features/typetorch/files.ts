/**
 * Files the backend hands over (a backup tar, a CSV the server made): written to the app's cache with
 * expo-file-system and offered through the share sheet (expo-sharing: save to Files / Drive, mail, chat, ...). The web
 * saves a Blob through a download link instead.
 */
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Writes `bytes` (or text) as `filename` in the cache and opens the share sheet. False when it couldn't. */
export async function shareFile(filename: string, content: ArrayBuffer | string, mime: string): Promise<boolean> {
	const safe = filename.replace(/[^\w.-]+/g, "_") || "download";
	const file = new File(Paths.cache, safe);
	if (file.exists) file.delete();
	file.create();
	await file.write(typeof content === "string" ? content : new Uint8Array(content));
	if (!(await Sharing.isAvailableAsync())) return false;
	await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: safe });
	return true;
}
