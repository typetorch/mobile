/**
 * Homepage thumbnail personalization: the thumbnail pool (moderation and availability state), delete from the pool,
 * and the personalization configs (active / past). Pick up to five pool thumbnails to start a new config (which
 * deactivates the current one and starts fresh statistics) or to swap the active config's thumbnails (statistics
 * kept). Upload images to the pool (system file picker; each file becomes an upload operation) and follow their
 * processing with the upload status call (a bounded poll, then a manual "Check status").
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { assetThumbs } from "@/api/roblox-public";
import { Badge, Button, Card, confirm, EmptyState, Icon, List, notify, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import {
	createPersonalizedConfig,
	deleteHomepageThumbnails,
	homepageThumbnails,
	PERSONALIZATION_MAX,
	personalizedConfigs,
	stateTone,
	updatePersonalizedConfig,
	uploadHomepageThumbnails,
	waitForHomepageUploads,
	type UploadThumbnailStatus,
} from "@/features/project/api/engagement";
import { pickImages } from "@/features/project/engagement/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { fmtAgo, fmtTime } from "@/lib/format";
import { useTheme } from "@/theme";

export function Personalization({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [picked, setPicked] = useState<string[]>([]);
	const [status, setStatus] = useState<"Active" | "Inactive">("Active");

	const pool = useInfiniteQuery({
		queryKey: ["oc", "personalization", universeId, "pool"],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => homepageThumbnails(cloud, universeId, pageParam),
		getNextPageParam: (last) => last.nextCursor || undefined,
		retry: false,
	});
	const thumbs = pool.data?.pages.flatMap((pg) => pg.homepageThumbnails ?? []) ?? [];
	const configs = useInfiniteQuery({
		queryKey: ["oc", "personalization", universeId, "configs", status],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => personalizedConfigs(cloud, universeId, status, pageParam),
		getNextPageParam: (last) => last.nextCursor || undefined,
		retry: false,
	});
	const configRows = configs.data?.pages.flatMap((pg) => pg.personalizedConfigs ?? []) ?? [];
	const assetIds = [...thumbs.map((t) => t.assetId), ...configRows.flatMap((c) => c.thumbnails.map((t) => t.assetId))];
	const images = useQuery({ queryKey: ["assetThumbs", [...new Set(assetIds)].sort().join(",")], queryFn: () => assetThumbs(assetIds), enabled: assetIds.length > 0, staleTime: 600_000 });

	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["oc", "personalization", universeId] });
	const remove = useMutation({
		mutationFn: (ids: string[]) => deleteHomepageThumbnails(cloud, universeId, ids),
		onSuccess: (r) => {
			const failed = Object.entries(r ?? {}).filter(([, ok]) => !ok).map(([id]) => id);
			if (failed.length) notify("Some weren't deleted", failed.join(", "));
			setPicked([]);
			invalidate();
		},
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});
	const create = useMutation({
		mutationFn: (ids: string[]) => createPersonalizedConfig(cloud, universeId, ids),
		onSuccess: () => {
			setPicked([]);
			invalidate();
		},
		onError: (e) => notify("Couldn't start personalization", cloudErrorText(e)),
	});
	const update = useMutation({
		mutationFn: (args: { id: string; ids: string[] }) => updatePersonalizedConfig(cloud, universeId, args.id, args.ids),
		onSuccess: () => {
			setPicked([]);
			invalidate();
		},
		onError: (e) => notify("Update failed", cloudErrorText(e)),
	});

	// The last upload: file name -> operation id (null = Roblox refused the file), and what finished processing.
	const [uploads, setUploads] = useState<{ ops: Record<string, string | null>; finished: Record<string, UploadThumbnailStatus>; done: boolean } | null>(null);
	const pendingOps = (u: typeof uploads) => Object.values(u?.ops ?? {}).filter((id): id is string => !!id);
	const upload = useMutation({
		mutationFn: async (files: Parameters<typeof uploadHomepageThumbnails>[2]) => {
			const ops = await uploadHomepageThumbnails(cloud, universeId, files);
			setUploads({ ops, finished: {}, done: false });
			const ids = Object.values(ops).filter((id): id is string => !!id);
			if (!ids.length) return { ops, finished: {}, done: true };
			return { ops, ...(await waitForHomepageUploads(cloud, universeId, ids, { maxPolls: 10, pollMs: 2000 })) };
		},
		onSuccess: (r) => {
			setUploads(r);
			invalidate();
		},
		onError: (e) => notify("Upload failed", cloudErrorText(e)),
	});
	const check = useMutation({
		mutationFn: () => waitForHomepageUploads(cloud, universeId, pendingOps(uploads), { maxPolls: 1, pollMs: 0 }),
		onSuccess: (r) => {
			setUploads((u) => (u ? { ...u, ...r } : u));
			invalidate();
		},
		onError: (e) => notify("Couldn't check the uploads", cloudErrorText(e)),
	});

	async function onUpload() {
		const files = await pickImages(true, 10);
		if (!files.length) return;
		if (await confirm(`Upload ${files.length} image${files.length === 1 ? "" : "s"} to the pool?`, `${files.map((f) => f.name).join(", ")}. Roblox reviews them; they're only served once you put them in a config.`, "Upload", false)) upload.mutate(files);
	}

	const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
	const active = status === "Active" ? configRows[0] : undefined;

	async function onDelete() {
		if (await confirm(`Delete ${picked.length} thumbnail${picked.length === 1 ? "" : "s"}?`, "They're removed from the homepage pool (and from any config that uses them). This can't be undone.", "Delete")) remove.mutate(picked);
	}
	async function onCreate() {
		if (picked.length > PERSONALIZATION_MAX) return notify("Too many", `Pick up to ${PERSONALIZATION_MAX} thumbnails.`);
		if (await confirm("Start a new personalization?", `A new config with ${picked.length} thumbnail${picked.length === 1 ? "" : "s"} replaces the active one; its statistics start from zero.`, "Start")) create.mutate(picked);
	}
	async function onUpdate() {
		if (!active) return;
		if (picked.length > PERSONALIZATION_MAX) return notify("Too many", `Pick up to ${PERSONALIZATION_MAX} thumbnails.`);
		if (await confirm("Replace the active config's thumbnails?", `The active config serves these ${picked.length} thumbnail${picked.length === 1 ? "" : "s"} instead; its statistics are kept.`, "Replace", false)) update.mutate({ id: active.id, ids: picked });
	}

	return (
		<>
			<Section
				title={`Homepage thumbnail pool${pool.data ? ` (${thumbs.length}${pool.hasNextPage ? "+" : ""})` : ""}`}
				right={canWrite ? <Button title="Upload" icon="cloud-upload-outline" small loading={upload.isPending} onPress={onUpload} /> : undefined}
			>
				{uploads ? (
					<Card style={{ gap: 4 }}>
						<Txt style={{ fontWeight: "600" }}>{upload.isPending ? "Processing the upload…" : uploads.done ? "Upload processed" : "Upload still processing"}</Txt>
						{Object.entries(uploads.ops).map(([file, op]) => {
							const r = op ? uploads.finished[op] : undefined;
							return (
								<Txt key={file} variant="small">
									{file}: {!op ? "refused by Roblox" : r ? `asset ${r.assetId ?? "?"} · ${r.moderationStatus ?? "processed"}` : "processing"}
								</Txt>
							);
						})}
						<View style={{ flexDirection: "row", gap: 8 }}>
							{!uploads.done && !upload.isPending ? <Button title="Check status" small loading={check.isPending} onPress={() => check.mutate()} /> : null}
							{!upload.isPending ? <Button title="Dismiss" small variant="ghost" onPress={() => setUploads(null)} /> : null}
						</View>
					</Card>
				) : null}
				{pool.error ? (
					<CloudError error={pool.error} what="Thumbnail personalization" onRetry={() => pool.refetch()} />
				) : !pool.data ? (
					<SkeletonList rows={3} />
				) : thumbs.length ? (
					<>
						<List>
							{thumbs.map((t) => {
								const on = picked.includes(t.homepageThumbnailId);
								const url = images.data?.[t.assetId];
								return (
									<Row
										key={t.homepageThumbnailId}
										left={
											<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
												{canWrite ? <Icon name={on ? "checkbox" : "square-outline"} size={20} color={on ? p.brand : p.mutedForeground} /> : null}
												{url ? <Image source={{ uri: url }} style={{ width: 80, height: 45, borderRadius: 6 }} /> : <View style={{ width: 80, height: 45, borderRadius: 6, backgroundColor: p.muted }} />}
											</View>
										}
										title={`Asset ${t.assetId}`}
										subtitle={`${t.personalizedConfigStatus === "Active" ? "in the active config" : "not in use"}${t.homepageThumbnailStatus === "Spammy" ? " · flagged spammy" : ""}`}
										right={<Badge label={t.moderationStatus} tone={stateTone(t.moderationStatus)} />}
										onPress={canWrite ? () => toggle(t.homepageThumbnailId) : undefined}
									/>
								);
							})}
						</List>
						{pool.hasNextPage ? <Button title="Load more" small loading={pool.isFetchingNextPage} onPress={() => pool.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
					</>
				) : (
					<EmptyState icon="images-outline" title="The pool is empty" body={canWrite ? "Upload images with the Upload button, then put up to five in a config." : "Add universe.thumbnail:write to upload homepage thumbnails."} />
				)}
				{canWrite && picked.length ? (
					<Card style={{ gap: 8 }}>
						<Txt>
							{picked.length} picked{picked.length > PERSONALIZATION_MAX ? ` (a config takes up to ${PERSONALIZATION_MAX})` : ""}
						</Txt>
						<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
							<Button title="Start new config" small variant="brand" loading={create.isPending} disabled={picked.length > PERSONALIZATION_MAX} onPress={onCreate} />
							{active ? <Button title="Swap into active config" small loading={update.isPending} disabled={picked.length > PERSONALIZATION_MAX} onPress={onUpdate} /> : null}
							<Button title="Delete" small variant="destructive" loading={remove.isPending} onPress={onDelete} />
							<Button title="Clear" small variant="ghost" onPress={() => setPicked([])} />
						</View>
					</Card>
				) : canWrite ? (
					<Txt variant="small">Tap thumbnails to pick them for a config or to delete them.</Txt>
				) : (
					<Txt variant="small">Read only: add universe.thumbnail:write to change personalization.</Txt>
				)}
			</Section>

			<Section title="Personalization configs">
				<Segmented options={[{ value: "Active", label: "Active" }, { value: "Inactive", label: "Past" }]} value={status} onChange={setStatus} />
				{configs.error ? (
					<CloudError error={configs.error} what="Personalization configs" onRetry={() => configs.refetch()} />
				) : !configs.data ? (
					<SkeletonList rows={2} />
				) : configRows.length ? (
					configRows.map((c) => (
						<Card key={c.id} style={{ gap: 6 }}>
							<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
								<Txt style={{ fontWeight: "600" }}>Config {c.id}</Txt>
								<Badge label={c.personalizedConfigStatus} tone={stateTone(c.personalizedConfigStatus)} />
							</View>
							<Txt variant="small">
								Started {fmtTime(c.createdUtc)} UTC · last served {c.lastServedUtc ? fmtAgo(c.lastServedUtc) : "never"}
							</Txt>
							<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
								{c.thumbnails.map((t) => {
									const url = images.data?.[t.assetId];
									return (
										<Pressable key={t.homepageThumbnailId} onPress={canWrite ? () => toggle(t.homepageThumbnailId) : undefined} style={{ gap: 2, opacity: t.personalizedThumbnailStatus === "Active" ? 1 : 0.5 }}>
											{url ? <Image source={{ uri: url }} style={{ width: 96, height: 54, borderRadius: 6 }} /> : <View style={{ width: 96, height: 54, borderRadius: 6, backgroundColor: p.muted }} />}
											<Txt variant="small">{t.homepageThumbnailStatus === "Spammy" ? "spammy" : t.personalizedThumbnailStatus.toLowerCase()}</Txt>
										</Pressable>
									);
								})}
							</View>
						</Card>
					))
				) : (
					<Txt variant="muted">{status === "Active" ? "No active personalization: the homepage shows the main thumbnail." : "No past configs."}</Txt>
				)}
				{configs.hasNextPage ? <Button title="Load more" small loading={configs.isFetchingNextPage} onPress={() => configs.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				<Txt variant="small">Roblox doesn't expose per-thumbnail click numbers to API keys; the configs show what's served and when.</Txt>
			</Section>
		</>
	);
}
