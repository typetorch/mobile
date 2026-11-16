/**
 * Icon & thumbnails: the icon per language (with moderation state; upload or delete a localized one), every
 * thumbnail and video of the experience with approval state and alt text, each language's own thumbnail set (upload,
 * reorder, delete, alt text), and homepage thumbnail personalization (engagement/Personalization.tsx).
 *
 * Reads are public (games v2 media, thumbnails v1, gameinternationalization v1); writes need legacy-universe:manage.
 * Roblox refuses uploading, deleting or reordering the SOURCE language's icon and set through these endpoints (error
 * 26), so the main set is edited here only for alt text. Images come from the system file picker (expo-file-system).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { gameIcons } from "@/api/roblox-public";
import { Badge, Button, Card, confirm, ErrorState, Field, List, notify, Row, ScopeNotice, Section, Segmented, Skeleton, SkeletonList, Txt } from "@/components/ui";
import {
	deleteGameIcon,
	deleteThumbnail,
	ENG_SCOPES,
	gameIconsByLanguage,
	gameMedia,
	gameThumbnailUrls,
	localizedThumbnails,
	orderThumbnails,
	setThumbnailAltText,
	stateTone,
	uploadGameIcon,
	uploadThumbnail,
	type ImageFile,
} from "@/features/project/api/engagement";
import { Personalization } from "@/features/project/engagement/Personalization";
import { LanguageChips, pickImages, useLanguages } from "@/features/project/engagement/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";

export default function ThumbnailsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen
			title="Icon & thumbnails"
			scopes={[]}
			onRefresh={() => {
				for (const key of ["gameMedia", "i18n", "oc"]) queryClient.refetchQueries({ queryKey: [key], type: "active" });
			}}
		>
			{({ universeId, cloud, can }) => <Thumbnails universeId={universeId} cloud={cloud} canManage={can(ENG_SCOPES.legacyUniverse)} canPersonalize={can(ENG_SCOPES.thumbRead)} canPersonalizeWrite={can(ENG_SCOPES.thumbWrite)} />}
		</ToolScreen>
	);
}

function Thumbnails({ universeId, cloud, canManage, canPersonalize, canPersonalizeWrite }: { universeId: number; cloud: OpenCloud; canManage: boolean; canPersonalize: boolean; canPersonalizeWrite: boolean }) {
	const [tab, setTab] = useState<"media" | "personalize">("media");
	return (
		<>
			<Segmented options={[{ value: "media", label: "Icon & thumbnails" }, { value: "personalize", label: "Personalization" }]} value={tab} onChange={setTab} />
			{tab === "media" ? (
				<>
					<IconSection universeId={universeId} cloud={cloud} canManage={canManage} />
					<MediaSection universeId={universeId} cloud={cloud} canManage={canManage} />
					<LocalizedSection universeId={universeId} cloud={cloud} canManage={canManage} />
					<Txt variant="small">The main (source-language) icon and thumbnails can't be uploaded or deleted with an API key: Roblox only allows that for the other languages. Change the main ones on Creator Hub.</Txt>
				</>
			) : canPersonalize ? (
				<Personalization universeId={universeId} cloud={cloud} canWrite={canPersonalizeWrite} />
			) : (
				<ScopeNotice what="Thumbnail personalization" scopes={[ENG_SCOPES.thumbRead]} />
			)}
		</>
	);
}

// Icon -------------------------------------------------------------------------------------------------------------------

function IconSection({ universeId, cloud, canManage }: { universeId: number; cloud: OpenCloud; canManage: boolean }) {
	const queryClient = useQueryClient();
	const langs = useLanguages(universeId);
	const publicIcon = useQuery({ queryKey: ["gameIcon512", universeId], queryFn: () => gameIcons([universeId], "512x512"), staleTime: 300_000, enabled: !canManage, retry: false });
	const icons = useQuery({ queryKey: ["oc", "gameIcons", universeId], queryFn: () => gameIconsByLanguage(cloud, universeId), enabled: canManage, retry: false });
	const remove = useMutation({
		mutationFn: (languageCode: string) => deleteGameIcon(cloud, universeId, languageCode),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oc", "gameIcons", universeId] }),
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});
	const upload = useMutation({
		mutationFn: (args: { languageCode: string; file: ImageFile }) => uploadGameIcon(cloud, universeId, args.languageCode, args.file),
		onSuccess: (_r, args) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "gameIcons", universeId] });
			notify("Icon uploaded", `The ${langs.nameOf(args.languageCode)} icon shows once Roblox approves it.`);
		},
		onError: (e) => notify("Upload failed", cloudErrorText(e)),
	});
	const others = langs.codes.filter((c) => c !== langs.sourceCode);
	const [uploadLang, setUploadLang] = useState("");
	const target = uploadLang || others[0] || "";

	async function onUpload() {
		if (!target) return;
		const [file] = await pickImages(false);
		if (!file) return;
		const has = icons.data?.some((i) => i.languageCode === target) ?? false;
		const title = has ? `Replace the ${langs.nameOf(target)} icon?` : `Upload a ${langs.nameOf(target)} icon?`;
		const body = `${file.name} becomes the icon players with that language see, after Roblox reviews it.${has ? " The current one is replaced." : ""}`;
		if (await confirm(title, body, has ? "Replace" : "Upload", has)) upload.mutate({ languageCode: target, file });
	}

	if (!canManage) {
		const url = publicIcon.data?.[universeId];
		return (
			<Section title="Icon">
				<Card style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
					{url ? <Image source={{ uri: url }} style={{ width: 72, height: 72, borderRadius: 12 }} /> : <Skeleton width={72} height={72} />}
					<Txt variant="small" style={{ flex: 1 }}>
						Add {ENG_SCOPES.legacyUniverse} to see the icon per language with its moderation state.
					</Txt>
				</Card>
			</Section>
		);
	}
	return (
		<Section title="Icon per language">
			{icons.error ? (
				<CloudError error={icons.error} what="Icons" onRetry={() => icons.refetch()} />
			) : !icons.data ? (
				<SkeletonList rows={1} />
			) : (
				<List>
					{icons.data.map((icon) => {
						const isSource = icon.languageCode === langs.sourceCode;
						return (
							<Row
								key={icon.languageCode}
								left={icon.imageUrl ? <Image source={{ uri: icon.imageUrl }} style={{ width: 48, height: 48, borderRadius: 8 }} /> : undefined}
								title={`${langs.nameOf(icon.languageCode)}${isSource ? " (main icon)" : ""}`}
								subtitle={`Image ${icon.imageId}`}
								right={
									<View style={{ alignItems: "flex-end", gap: 6 }}>
										<Badge label={icon.state} tone={stateTone(icon.state)} />
										{!isSource ? (
											<Button
												title="Delete"
												small
												variant="destructive"
												loading={remove.isPending && remove.variables === icon.languageCode}
												onPress={async () => {
													if (await confirm(`Delete the ${langs.nameOf(icon.languageCode)} icon?`, "Players with that language see the main icon instead.", "Delete")) remove.mutate(icon.languageCode);
												}}
											/>
										) : null}
									</View>
								}
							/>
						);
					})}
				</List>
			)}
			{others.length ? (
				<View style={{ gap: 6 }}>
					<Txt variant="label">Upload a language's icon</Txt>
					<LanguageChips codes={others} value={target} onChange={setUploadLang} nameOf={langs.nameOf} sourceCode={langs.sourceCode} />
					<Button title={`Choose ${langs.nameOf(target)} icon`} icon="cloud-upload-outline" small loading={upload.isPending} onPress={onUpload} style={{ alignSelf: "flex-start" }} />
					<Txt variant="small">A square image (Roblox scales it to 512 × 512).</Txt>
				</View>
			) : (
				<Txt variant="small">Add languages in Localization to give them their own icon.</Txt>
			)}
		</Section>
	);
}

// Alt text editor --------------------------------------------------------------------------------------------------------

function AltText({ current, onSave, saving }: { current: string; onSave: (text: string) => void; saving: boolean }) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState(current);
	useEffect(() => setText(current), [current]);
	if (!open) return <Button title="Alt text" icon="create-outline" small variant="ghost" onPress={() => setOpen(true)} />;
	return (
		<View style={{ gap: 6, paddingHorizontal: 12, paddingBottom: 10 }}>
			<Field value={text} onChangeText={setText} placeholder="Describe the image for screen readers" autoCapitalize="sentences" maxLength={1000} />
			<View style={{ flexDirection: "row", gap: 8 }}>
				<Button
					title="Save alt text"
					small
					variant="brand"
					loading={saving}
					onPress={() => {
						onSave(text.trim());
						setOpen(false);
					}}
				/>
				<Button title="Cancel" small onPress={() => setOpen(false)} />
			</View>
		</View>
	);
}

// Main media -------------------------------------------------------------------------------------------------------------

function MediaSection({ universeId, cloud, canManage }: { universeId: number; cloud: OpenCloud; canManage: boolean }) {
	const queryClient = useQueryClient();
	const langs = useLanguages(universeId);
	const media = useQuery({
		queryKey: ["gameMedia", universeId, "full"],
		queryFn: async () => {
			const items = await gameMedia(universeId);
			const urls = await gameThumbnailUrls(universeId, items.filter((m) => m.imageId).map((m) => m.imageId!), "384x216").catch(() => ({}) as Record<number, string>);
			return { items, urls };
		},
		retry: false,
	});
	const alt = useMutation({
		mutationFn: (args: { id: number; text: string }) => setThumbnailAltText(cloud, universeId, langs.sourceCode!, args.id, args.text),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gameMedia", universeId] }),
		onError: (e) => notify("Alt text failed", cloudErrorText(e)),
	});

	return (
		<Section title={`Thumbnails & videos${media.data ? ` (${media.data.items.length})` : ""}`}>
			{media.error ? (
				<ErrorState error={media.error} onRetry={() => media.refetch()} />
			) : !media.data ? (
				<SkeletonList rows={3} />
			) : media.data.items.length ? (
				<List>
					{media.data.items.map((m, i) => {
						const url = m.imageId ? media.data.urls[m.imageId] : undefined;
						const video = m.assetType !== "Image";
						return (
							<View key={`${m.imageId ?? m.videoHash ?? i}`}>
								<Row
									left={url ? <Image source={{ uri: url }} style={{ width: 96, height: 54, borderRadius: 6 }} /> : <Skeleton width={96} height={54} />}
									title={video ? `Video${m.videoTitle ? `: ${m.videoTitle}` : ""}` : `#${i + 1} · image ${m.imageId}`}
									subtitle={m.altText ? `Alt: ${m.altText}` : video ? (m.videoId ? `Video asset ${m.videoId}` : m.videoHash ? `YouTube ${m.videoHash}` : "") : "No alt text"}
									numberOfLines={2}
									right={<Badge label={m.approved ? "approved" : "pending"} tone={m.approved ? "good" : "warning"} />}
								/>
								{canManage && !video && m.imageId && langs.sourceCode ? <AltText current={m.altText ?? ""} saving={alt.isPending && alt.variables?.id === m.imageId} onSave={(text) => alt.mutate({ id: m.imageId!, text })} /> : null}
							</View>
						);
					})}
				</List>
			) : (
				<Txt variant="muted">No thumbnails: players see a default image.</Txt>
			)}
		</Section>
	);
}

// Localized sets ---------------------------------------------------------------------------------------------------------

/** Creator Hub's cap on an experience's thumbnails (per language set). */
const THUMBNAILS_MAX = 10;

function LocalizedSection({ universeId, cloud, canManage }: { universeId: number; cloud: OpenCloud; canManage: boolean }) {
	const queryClient = useQueryClient();
	const langs = useLanguages(universeId);
	const sets = useQuery({ queryKey: ["i18n", universeId, "thumbnails"], queryFn: () => localizedThumbnails(universeId), retry: false });
	const codes = langs.codes.filter((c) => c !== langs.sourceCode);
	const [lang, setLang] = useState("");
	const active = lang || codes[0] || "";
	const assets = sets.data?.find((s) => s.languageCode === active)?.mediaAssets ?? [];
	const [order, setOrder] = useState<string[] | null>(null);
	useEffect(() => setOrder(null), [active, sets.data]);
	const shown = order ? order.map((id) => assets.find((a) => a.mediaAssetId === id)!).filter(Boolean) : assets;

	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["i18n", universeId, "thumbnails"] });
	const remove = useMutation({
		mutationFn: (id: string) => deleteThumbnail(cloud, universeId, active, Number(id)),
		onSuccess: invalidate,
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});
	const saveOrder = useMutation({
		mutationFn: (ids: string[]) => orderThumbnails(cloud, universeId, active, ids.map(Number)),
		onSuccess: () => {
			setOrder(null);
			invalidate();
		},
		onError: (e) => notify("Reorder failed", cloudErrorText(e)),
	});
	const alt = useMutation({
		mutationFn: (args: { id: string; text: string }) => setThumbnailAltText(cloud, universeId, active, Number(args.id), args.text),
		onSuccess: invalidate,
		onError: (e) => notify("Alt text failed", cloudErrorText(e)),
	});
	const upload = useMutation({
		mutationFn: async (args: { languageCode: string; files: ImageFile[] }) => {
			// One file per request (the endpoint takes a single image); stop at the first refusal and say how far it got.
			let done = 0;
			for (const f of args.files) {
				try {
					await uploadThumbnail(cloud, universeId, args.languageCode, f);
				} catch (e) {
					if (done) invalidate();
					throw new Error(`${done} of ${args.files.length} uploaded; ${f.name} failed: ${cloudErrorText(e)}`);
				}
				done++;
			}
			return done;
		},
		onSuccess: (n) => {
			invalidate();
			notify("Uploaded", `${n} thumbnail${n === 1 ? "" : "s"} added. They show once Roblox approves them.`);
		},
		onError: (e) => notify("Upload failed", e instanceof Error ? e.message : cloudErrorText(e)),
	});

	async function onUpload() {
		if (!active) return;
		const room = Math.max(0, THUMBNAILS_MAX - assets.length);
		if (!room) return notify("The set is full", `A language has up to ${THUMBNAILS_MAX} thumbnails; delete one first.`);
		const files = await pickImages(true, room);
		if (!files.length) return;
		if (await confirm(`Upload ${files.length} ${langs.nameOf(active)} thumbnail${files.length === 1 ? "" : "s"}?`, `${files.map((f) => f.name).join(", ")}. They're added to the end of the set and go public after Roblox reviews them.`, "Upload", false)) upload.mutate({ languageCode: active, files });
	}

	function move(index: number, by: number) {
		const ids = (order ?? assets.map((a) => a.mediaAssetId)).slice();
		const to = index + by;
		if (to < 0 || to >= ids.length) return;
		[ids[index], ids[to]] = [ids[to]!, ids[index]!];
		setOrder(ids);
	}

	if (langs.error || sets.error) return <ErrorState error={langs.error ?? sets.error} onRetry={() => Promise.all([langs.refetch(), sets.refetch()])} title="Couldn't load the localized thumbnails" />;
	return (
		<Section title="Thumbnails per language">
			{langs.loading || !sets.data ? (
				<Skeleton height={30} />
			) : !codes.length ? (
				<Txt variant="muted">The experience supports only its source language. Add languages in Localization to give them their own thumbnails.</Txt>
			) : (
				<>
					<LanguageChips codes={codes} value={active} onChange={setLang} nameOf={langs.nameOf} sourceCode={langs.sourceCode} />
					{shown.length ? (
						<List>
							{shown.map((a, i) => (
								<View key={a.mediaAssetId}>
									<Row
										left={a.mediaAssetUrl ? <Image source={{ uri: a.mediaAssetUrl }} style={{ width: 96, height: 54, borderRadius: 6 }} /> : <Skeleton width={96} height={54} />}
										title={`#${i + 1} · image ${a.mediaAssetId}`}
										subtitle={a.mediaAssetAltText ? `Alt: ${a.mediaAssetAltText}` : "No alt text"}
										numberOfLines={2}
										right={
											<View style={{ alignItems: "flex-end", gap: 4 }}>
												{a.state ? <Badge label={a.state} tone={stateTone(a.state)} /> : null}
												{canManage ? (
													<View style={{ flexDirection: "row", gap: 4 }}>
														<Button title="↑" small disabled={i === 0} onPress={() => move(i, -1)} />
														<Button title="↓" small disabled={i === shown.length - 1} onPress={() => move(i, 1)} />
														<Button
															title="✕"
															small
															variant="destructive"
															loading={remove.isPending && remove.variables === a.mediaAssetId}
															onPress={async () => {
																if (await confirm("Delete this thumbnail?", `It's removed from the ${langs.nameOf(active)} set. This can't be undone.`, "Delete")) remove.mutate(a.mediaAssetId);
															}}
														/>
													</View>
												) : null}
											</View>
										}
									/>
									{canManage ? <AltText current={a.mediaAssetAltText ?? ""} saving={alt.isPending && alt.variables?.id === a.mediaAssetId} onSave={(text) => alt.mutate({ id: a.mediaAssetId, text })} /> : null}
								</View>
							))}
						</List>
					) : (
						<Txt variant="muted">No {langs.nameOf(active)} thumbnails: players with that language see the main ones.</Txt>
					)}
					{order ? (
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button title="Save order" variant="brand" small loading={saveOrder.isPending} onPress={() => saveOrder.mutate(order)} />
							<Button title="Undo" small onPress={() => setOrder(null)} />
						</View>
					) : null}
					{canManage ? (
						<Button title={`Add ${langs.nameOf(active)} thumbnails`} icon="cloud-upload-outline" small loading={upload.isPending} onPress={onUpload} style={{ alignSelf: "flex-start" }} />
					) : (
						<Txt variant="small">Add {ENG_SCOPES.legacyUniverse} to upload, reorder, delete and set alt text.</Txt>
					)}
				</>
			)}
		</Section>
	);
}
