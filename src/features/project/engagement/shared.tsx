/** Pieces the Engagement screens share: a switch row, a language picker, the experience's language lists and an image picker. */
import { useQuery } from "@tanstack/react-query";
import { File } from "expo-file-system";
import { Switch, View } from "react-native";

import { Chips, notify, Skeleton, Txt } from "@/components/ui";
import { sourceLanguage, supportedLanguages, type ImageFile } from "@/features/project/api/engagement";
import { useTheme } from "@/theme";

export function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
	const p = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6, opacity: disabled ? 0.5 : 1 }}>
			<View style={{ flex: 1, gap: 2 }}>
				<Txt>{label}</Txt>
				{hint ? <Txt variant="small">{hint}</Txt> : null}
			</View>
			<Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: p.brand, false: p.muted }} />
		</View>
	);
}

/** The experience's source language and supported languages (public, same keys everywhere). */
export function useLanguages(universeId: number) {
	const source = useQuery({ queryKey: ["i18n", universeId, "source"], queryFn: () => sourceLanguage(universeId), staleTime: 120_000, retry: false });
	const supported = useQuery({ queryKey: ["i18n", universeId, "supported"], queryFn: () => supportedLanguages(universeId), staleTime: 120_000, retry: false });
	const sourceCode = source.data?.languageCode ?? null;
	const names = new Map<string, string>();
	for (const l of supported.data ?? []) names.set(l.languageCode, l.name);
	if (source.data) names.set(source.data.languageCode, source.data.name);
	return {
		source,
		supported,
		sourceCode,
		/** Every language code of the experience, the source first. */
		codes: [...(sourceCode ? [sourceCode] : []), ...(supported.data ?? []).map((l) => l.languageCode).filter((c) => c !== sourceCode)],
		nameOf: (code: string) => names.get(code) ?? code,
		loading: source.isLoading || supported.isLoading,
		error: (source.error as Error | null) ?? (supported.error as Error | null),
		refetch: () => Promise.all([source.refetch(), supported.refetch()]),
	};
}

/** Chips to pick one of the experience's languages. */
export function LanguageChips({ codes, value, onChange, nameOf, sourceCode, loading }: { codes: string[]; value: string; onChange: (code: string) => void; nameOf: (c: string) => string; sourceCode: string | null; loading?: boolean }) {
	if (loading) return <Skeleton height={30} />;
	if (!codes.length) return <Txt variant="muted">The experience has no languages set up.</Txt>;
	return <Chips options={codes.map((c) => ({ value: c, label: `${nameOf(c)}${c === sourceCode ? " (source)" : ""}` }))} value={value} onChange={onChange} />;
}

/** Image types Roblox takes for thumbnails and icons, by extension (pickers don't always give a MIME type). */
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", bmp: "image/bmp", tga: "image/x-tga" };
/** A sanity bound so a huge photo isn't sent over a phone connection (and past the 30 s deadline) by mistake. */
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

function asImage(picked: File): ImageFile | string {
	const ext = (picked.name.split(".").pop() ?? "").toLowerCase();
	const type = IMAGE_TYPES[ext] ?? (Object.values(IMAGE_TYPES).includes(picked.type) ? picked.type : null);
	if (!type) return `${picked.name || "That file"} isn't a PNG, JPG, BMP or TGA image.`;
	const size = typeof picked.size === "number" ? picked.size : null;
	if (size !== null && size > IMAGE_MAX_BYTES) return `${picked.name} is over 20 MB.`;
	return { uri: picked.uri, name: picked.name || `image.${ext || "png"}`, type, size };
}

/**
 * Opens the system file picker (expo-file-system, part of Expo Go) for images. Answers the usable images (none when
 * cancelled); files that aren't supported images are named in a notice and left out.
 */
export async function pickImages(multiple = false, max = 10): Promise<ImageFile[]> {
	let files: File[];
	try {
		const mimeTypes = ["image/png", "image/jpeg", "image/bmp", "image/*"];
		if (multiple) {
			const r = await File.pickFileAsync({ mimeTypes, multipleFiles: true });
			if (r.canceled || !r.result) return [];
			files = r.result;
		} else {
			const r = await File.pickFileAsync({ mimeTypes });
			if (r.canceled || !r.result) return [];
			files = [r.result];
		}
	} catch (e) {
		notify("Can't open the file picker", e instanceof Error ? e.message : String(e));
		return [];
	}
	const out: ImageFile[] = [];
	const refused: string[] = [];
	for (const f of files.slice(0, max)) {
		const r = asImage(f);
		if (typeof r === "string") refused.push(r);
		else out.push(r);
	}
	if (files.length > max) refused.push(`Only the first ${max} files are used.`);
	if (refused.length) notify("Some files were left out", refused.join("\n"));
	return out;
}
