/** Pieces the Monetization screens share: a switch row, the "id" route param and the icon picker. */
import { File } from "expo-file-system";
import { useLocalSearchParams } from "expo-router";
import { Switch, View } from "react-native";

import { GameIcon } from "@/components/ProjectRow";
import { Button, notify, Txt } from "@/components/ui";
import type { IconFile } from "@/features/project/api/monetization";
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

/** `?id=123` -> 123; `?id=new` or none -> "new"; anything else -> null (bad link). */
export function useItemIdParam(): number | "new" | null {
	const { id } = useLocalSearchParams<{ id?: string }>();
	if (!id || id === "new") return "new";
	return /^\d+$/.test(id) ? Number(id) : null;
}

/** Image types Roblox takes for icons, by extension (pickers don't always give a MIME type). */
const ICON_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", bmp: "image/bmp", tga: "image/x-tga" };
/** A sanity bound so a huge photo isn't sent over a phone connection by mistake. */
const ICON_MAX_BYTES = 20 * 1024 * 1024;

/** Opens the system file picker (expo-file-system, part of Expo Go) for one image; null when cancelled or refused. */
export async function pickIcon(): Promise<IconFile | null> {
	let picked: File;
	try {
		const r = await File.pickFileAsync({ mimeTypes: ["image/png", "image/jpeg", "image/bmp", "image/*"] });
		if (r.canceled || !r.result) return null;
		picked = r.result;
	} catch (e) {
		notify("Can't open the file picker", e instanceof Error ? e.message : String(e));
		return null;
	}
	const ext = (picked.name.split(".").pop() ?? "").toLowerCase();
	const type = ICON_TYPES[ext] ?? (Object.values(ICON_TYPES).includes(picked.type) ? picked.type : null);
	if (!type) {
		notify("Not a supported image", "Roblox takes PNG, JPG, BMP or TGA images.");
		return null;
	}
	const size = typeof picked.size === "number" ? picked.size : null;
	if (size !== null && size > ICON_MAX_BYTES) {
		notify("Image too large", "Pick an image under 20 MB (Roblox scales icons down to 512 × 512 anyway).");
		return null;
	}
	return { uri: picked.uri, name: picked.name || `icon.${ext || "png"}`, type, size };
}

/** "Choose image" / preview + "Remove" for a form's icon. */
export function IconPicker({ value, onChange, hint, disabled }: { value: IconFile | null; onChange: (f: IconFile | null) => void; hint?: string; disabled?: boolean }) {
	return (
		<View style={{ gap: 6 }}>
			<Txt variant="small">Icon</Txt>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
				{value ? <GameIcon uri={value.uri} size={44} /> : null}
				<View style={{ flex: 1, gap: 2 }}>
					<Txt numberOfLines={1}>{value ? value.name : "No new image"}</Txt>
					{hint ? <Txt variant="small">{hint}</Txt> : null}
				</View>
				<Button title={value ? "Change" : "Choose image"} icon="image-outline" small disabled={disabled} onPress={async () => { const f = await pickIcon(); if (f) onChange(f); }} />
				{value ? <Button title="Remove" icon="close" small disabled={disabled} onPress={() => onChange(null)} /> : null}
			</View>
		</View>
	);
}

export const ICON_REVIEW_NOTE = "Roblox reviews new images, so the icon can take a few minutes to show.";
