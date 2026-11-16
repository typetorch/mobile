/**
 * Localization > Passes / products / badges: pick an item, see its name, description and icon in every language,
 * edit or delete a language's translation, upload or delete a localized icon. Needs legacy-game-pass:manage,
 * legacy-developer-product:manage or legacy-badge:manage (legacy scopes that can't be limited to one experience).
 * Items come from the public pass / badge lists (products need developer-product:read) or a typed id, which also
 * reaches off-sale passes, disabled badges and products past the listed pages.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { publicGamePasses, universeBadges } from "@/api/roblox-public";
import { Badge, Button, Card, Chips, confirm, Field, List, notify, Row, ScopeNotice, Section, Segmented, Skeleton, SkeletonList, Txt } from "@/components/ui";
import {
	deleteItemIcon,
	deleteItemNameDescription,
	ITEM_KINDS,
	itemIcons,
	itemNameDescriptions,
	stateTone,
	translateText,
	updateItemNameDescription,
	uploadItemIcon,
	type ImageFile,
	type ItemKind,
} from "@/features/project/api/engagement";
import { translateCode } from "@/features/project/engagement/ExperienceInfo";
import { TranslationHistory } from "@/features/project/engagement/History";
import { LanguageChips, pickImages, useLanguages } from "@/features/project/engagement/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { useTheme } from "@/theme";

async function itemsOf(cloud: OpenCloud, universeId: number, kind: ItemKind, canProducts: boolean): Promise<{ id: number; name: string }[]> {
	if (kind === "game-passes") return (await publicGamePasses(universeId)).map((g) => ({ id: g.id, name: g.displayName ?? g.name }));
	if (kind === "badges") return (await universeBadges(universeId)).map((b) => ({ id: b.id, name: b.name }));
	if (!canProducts) return [];
	const out: { id: number; name: string }[] = [];
	let token: string | undefined;
	for (let page = 0; page < 10; page++) {
		const r = await cloud.developerProducts(universeId, token);
		out.push(...(r.developerProducts ?? []).map((d) => ({ id: d.productId, name: d.name })));
		token = r.nextPageToken || undefined;
		if (!token) break;
	}
	return out;
}

export function ItemLocalization({ universeId, cloud, can }: { universeId: number; cloud: OpenCloud; can: (scope: string) => boolean }) {
	const [kind, setKind] = useState<ItemKind>("game-passes");
	const [itemId, setItemId] = useState<number | null>(null);
	const [manualId, setManualId] = useState("");
	const meta = ITEM_KINDS.find((k) => k.value === kind)!;
	const canProducts = can("developer-product:read");
	const items = useQuery({ queryKey: ["i18n-items", universeId, kind, canProducts], queryFn: () => itemsOf(cloud, universeId, kind, canProducts), retry: false, staleTime: 120_000 });
	useEffect(() => setItemId(null), [kind]);

	return (
		<>
			<Segmented options={ITEM_KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={setKind} />
			{!can(meta.scope) ? (
				<ScopeNotice what={`Localized ${meta.label.toLowerCase()}`} scopes={[meta.scope]} />
			) : (
				<>
					{items.error ? (
						<CloudError error={items.error} what={meta.label} onRetry={() => items.refetch()} />
					) : items.isLoading ? (
						<Skeleton height={30} />
					) : items.data?.length ? (
						<Chips options={items.data.map((i) => ({ value: i.id, label: i.name }))} value={itemId ?? 0} onChange={setItemId} />
					) : (
						<Txt variant="small">{kind === "developer-products" && !canProducts ? "Add developer-product:read to list products, or type a product id:" : `No ${meta.label.toLowerCase()} found; type an id:`}</Txt>
					)}
					<View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
						<View style={{ flex: 1 }}>
							<Field value={manualId} onChangeText={setManualId} placeholder={`Open by ${meta.label.toLowerCase().replace(/s$/, "")} id`} keyboardType="number-pad" />
						</View>
						<Button title="Open" small disabled={!/^\d+$/.test(manualId.trim())} onPress={() => setItemId(Number(manualId.trim()))} />
					</View>
					{itemId ? <ItemDetail key={`${kind}-${itemId}`} universeId={universeId} cloud={cloud} kind={kind} itemId={itemId} canHistory={can("legacy-universe:manage")} canTranslate={can("universe:write")} /> : null}
				</>
			)}
		</>
	);
}

function ItemDetail({ universeId, cloud, kind, itemId, canHistory, canTranslate }: { universeId: number; cloud: OpenCloud; kind: ItemKind; itemId: number; canHistory: boolean; canTranslate: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const meta = ITEM_KINDS.find((k) => k.value === kind)!;
	const langs = useLanguages(universeId);
	const texts = useQuery({ queryKey: ["oc", "i18n-item", kind, itemId, "text"], queryFn: () => itemNameDescriptions(cloud, kind, itemId), retry: false });
	const icons = useQuery({ queryKey: ["oc", "i18n-item", kind, itemId, "icons"], queryFn: () => itemIcons(cloud, kind, itemId), retry: false });
	const [lang, setLang] = useState("");
	const others = langs.codes.filter((c) => c !== langs.sourceCode);
	const active = lang || others[0] || "";
	const row = texts.data?.find((r) => r.languageCode === active);
	const source = texts.data?.find((r) => r.languageCode === langs.sourceCode);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setName(row?.name ?? "");
		setDescription(row?.description ?? "");
	}, [active, row?.name, row?.description]);

	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["oc", "i18n-item", kind, itemId] });
	const save = useMutation({
		mutationFn: () => updateItemNameDescription(cloud, kind, itemId, active, { name: name.trim(), description: description.trim() }),
		onSuccess: invalidate,
		onError: (e) => notify("Save failed", cloudErrorText(e)),
	});
	const remove = useMutation({
		mutationFn: () => deleteItemNameDescription(cloud, kind, itemId, active),
		onSuccess: invalidate,
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});
	const removeIcon = useMutation({
		mutationFn: (code: string) => deleteItemIcon(cloud, kind, itemId, code),
		onSuccess: invalidate,
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});
	const uploadIcon = useMutation({
		mutationFn: (args: { code: string; file: ImageFile }) => uploadItemIcon(cloud, kind, itemId, args.code, args.file),
		onSuccess: (_r, args) => {
			invalidate();
			notify("Icon uploaded", `The ${langs.nameOf(args.code)} icon shows once Roblox approves it.`);
		},
		onError: (e) => notify("Upload failed", cloudErrorText(e)),
	});
	const [iconLang, setIconLang] = useState("");
	const iconTarget = iconLang || others[0] || "";

	async function onUploadIcon() {
		if (!iconTarget) return;
		const [file] = await pickImages(false);
		if (!file) return;
		const has = icons.data?.some((i) => i.languageCode === iconTarget) ?? false;
		if (await confirm(has ? `Replace the ${langs.nameOf(iconTarget)} icon?` : `Upload a ${langs.nameOf(iconTarget)} icon?`, `${file.name} becomes the icon players with that language see, after Roblox reviews it.${has ? " The current one is replaced." : ""}`, has ? "Replace" : "Upload", has)) uploadIcon.mutate({ code: iconTarget, file });
	}
	const translate = useMutation({
		mutationFn: async () => {
			const target = translateCode(active);
			if (!target) throw new Error(`Roblox's translator doesn't support ${active}.`);
			const src = langs.sourceCode ? translateCode(langs.sourceCode) ?? undefined : undefined;
			const [n, d] = await Promise.all([source?.name ? translateText(cloud, universeId, source.name, [target], src) : null, source?.description ? translateText(cloud, universeId, source.description, [target], src) : null]);
			return { name: n?.translations?.[target], description: d?.translations?.[target] };
		},
		onSuccess: (r) => {
			if (r.name !== undefined) setName(r.name);
			if (r.description !== undefined) setDescription(r.description);
		},
		onError: (e) => notify("Translation failed", cloudErrorText(e)),
	});

	function onSave() {
		setError(null);
		if (!name.trim()) return setError("The name can't be empty.");
		save.mutate();
	}

	if (texts.error) return <CloudError error={texts.error} what={`This ${meta.label.toLowerCase().replace(/s$/, "")}`} onRetry={() => texts.refetch()} />;
	if (!texts.data || langs.loading) return <SkeletonList rows={2} />;

	return (
		<>
			<Section title="Every language">
				<List>
					{texts.data.map((t) => (
						<Row key={t.languageCode} title={`${langs.nameOf(t.languageCode)}${t.languageCode === langs.sourceCode ? " (source)" : ""}: ${t.name || "–"}`} subtitle={t.description || "No description"} numberOfLines={3} />
					))}
				</List>
			</Section>
			{others.length ? (
				<Section title="Edit a translation">
					<LanguageChips codes={others} value={active} onChange={setLang} nameOf={langs.nameOf} sourceCode={langs.sourceCode} />
					<Card style={{ gap: 8 }}>
						<Field label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" />
						<Field label="Description" value={description} onChangeText={setDescription} multiline autoCapitalize="sentences" style={{ fontFamily: undefined }} />
						{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
						<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
							<Button title="Save" variant="brand" small loading={save.isPending} onPress={onSave} />
							{canTranslate && source ? <Button title="Translate from source" icon="language-outline" small loading={translate.isPending} onPress={() => translate.mutate()} /> : null}
							{row ? (
								<Button
									title="Delete translation"
									small
									variant="destructive"
									loading={remove.isPending}
									onPress={async () => {
										if (await confirm(`Delete the ${langs.nameOf(active)} translation?`, "Players with that language see the source name and description.", "Delete")) remove.mutate();
									}}
								/>
							) : null}
						</View>
					</Card>
					{canHistory ? (
						<>
							<TranslationHistory key={`n-${active}`} cloud={cloud} contentId={itemId} contentType={meta.nameHistory} languageCode={active} label="Name" />
							<TranslationHistory key={`d-${active}`} cloud={cloud} contentId={itemId} contentType={meta.descriptionHistory} languageCode={active} label="Description" />
						</>
					) : null}
				</Section>
			) : (
				<Txt variant="muted">The experience has only its source language; add languages to translate items.</Txt>
			)}
			<Section title="Icons per language">
				{icons.error ? (
					<CloudError error={icons.error} what="Icons" onRetry={() => icons.refetch()} />
				) : !icons.data ? (
					<SkeletonList rows={1} />
				) : icons.data.length ? (
					<List>
						{icons.data.map((icon) => {
							const isSource = icon.languageCode === langs.sourceCode;
							return (
								<Row
									key={icon.languageCode}
									left={icon.imageUrl ? <Image source={{ uri: icon.imageUrl }} style={{ width: 40, height: 40, borderRadius: 6 }} /> : undefined}
									title={`${langs.nameOf(icon.languageCode)}${isSource ? " (main)" : ""}`}
									subtitle={`Image ${icon.imageId}`}
									right={
										<View style={{ alignItems: "flex-end", gap: 4 }}>
											<Badge label={icon.state} tone={stateTone(icon.state)} />
											{!isSource ? (
												<Button
													title="Delete"
													small
													variant="destructive"
													loading={removeIcon.isPending && removeIcon.variables === icon.languageCode}
													onPress={async () => {
														if (await confirm(`Delete the ${langs.nameOf(icon.languageCode)} icon?`, "Players with that language see the main icon.", "Delete")) removeIcon.mutate(icon.languageCode);
													}}
												/>
											) : null}
										</View>
									}
								/>
							);
						})}
					</List>
				) : (
					<Txt variant="muted">No icons.</Txt>
				)}
				{others.length ? (
					<View style={{ gap: 6 }}>
						<Txt variant="label">Upload a language's icon</Txt>
						<LanguageChips codes={others} value={iconTarget} onChange={setIconLang} nameOf={langs.nameOf} sourceCode={langs.sourceCode} />
						<Button title={`Choose ${langs.nameOf(iconTarget)} icon`} icon="cloud-upload-outline" small loading={uploadIcon.isPending} onPress={onUploadIcon} style={{ alignSelf: "flex-start" }} />
						<Txt variant="small">The main icon is changed with the item itself (Monetization); Roblox refuses it here.</Txt>
					</View>
				) : null}
			</Section>
		</>
	);
}
