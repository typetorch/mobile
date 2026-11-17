/**
 * Ads Manager (ads-management v1, BETA): this experience's campaigns (or every campaign in your own or the owning
 * group's ads account) with their delivery status (refreshed through campaigns:batchGetStatus) and creative images,
 * the saved creatives, and a new campaign. The API has no reporting (impressions, clicks, spend), so CTR points to Ads
 * Manager; a creative that is also a homepage thumbnail shows that thumbnail's play-through (servers/creative-stats). ?campaign=<id> opens one campaign (pause, resume, cancel, budget, …); ?create=1 opens the new
 * campaign form. Needs ad.campaign:read; edits need ad.campaign:write.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { gameDetails } from "@/api/roblox-public";
import { Badge, Button, Chips, EmptyState, List, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { batchCampaignStatus, fmtUsd, listCampaigns, listCreatives, microsToUsd, type CampaignListParams } from "@/features/project/api/servers";
import { CloudError } from "@/features/project/CloudError";
import { DeliveryBadge, label } from "@/features/project/servers/ads-shared";
import { CampaignCreate } from "@/features/project/servers/CampaignCreate";
import { CampaignDetail } from "@/features/project/servers/CampaignDetail";
import { CreativeStrip, CtrNote, ThumbStatLine, useCreativeImages, useCreativeThumbnailStats } from "@/features/project/servers/creative-stats";
import { ToolScreen } from "@/features/project/tool";
import { fmtValue } from "@/features/project/analytics/shared";
import { fmtDate } from "@/lib/format";

export default function AdsScreen() {
	const queryClient = useQueryClient();
	const { campaign, create } = useLocalSearchParams<{ campaign?: string; create?: string }>();
	return (
		<ToolScreen
			title={campaign ? "Campaign" : create ? "New campaign" : "Ads"}
			scopes={["ad.campaign:read"]}
			onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "ads"], type: "active" })}
		>
			{({ universeId, cloud, can }) =>
				campaign ? (
					<CampaignDetail id={campaign} cloud={cloud} universeId={universeId} canWrite={can("ad.campaign:write")} />
				) : create ? (
					can("ad.campaign:write") ? (
						<CampaignCreate universeId={universeId} cloud={cloud} />
					) : (
						<Txt variant="muted">Add ad.campaign:write to your key to create campaigns.</Txt>
					)
				) : (
					<Campaigns universeId={universeId} cloud={cloud} canWrite={can("ad.campaign:write")} />
				)
			}
		</ToolScreen>
	);
}

type Account = "experience" | "mine" | "group";
type Ended = "all" | "running" | "90d";

function Campaigns({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const [account, setAccount] = useState<Account>("experience");
	const [ended, setEnded] = useState<Ended>("all");
	const [tab, setTab] = useState<"campaigns" | "creatives">("campaigns");
	const owner = useQuery({ queryKey: ["oc", "ads", universeId, "owner"], queryFn: async () => (await gameDetails([universeId]))[0] ?? null, staleTime: 3600_000, retry: false });
	const groupId = owner.data?.creator?.type === "Group" ? owner.data.creator.id : null;

	// endedAfter must not be in the future ("not ended" uses a minute ago) and stays fixed while paging.
	const [endedAfter, setEndedAfter] = useState<string | undefined>(undefined);
	const pickEnded = (v: Ended) => {
		setEnded(v);
		setEndedAfter(v === "running" ? new Date(Math.floor(Date.now() / 60_000) * 60_000 - 60_000).toISOString() : v === "90d" ? new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 - 90 * 86_400_000).toISOString() : undefined);
	};
	const params: CampaignListParams = account === "experience" ? { targetUniverseIds: [universeId], endedAfter } : account === "group" && groupId ? { groupId, endedAfter } : { endedAfter };

	const list = useInfiniteQuery({
		queryKey: ["oc", "ads", universeId, "campaigns", account, groupId, endedAfter ?? "all"],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listCampaigns(cloud, { ...params, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
		retry: false,
	});
	const campaigns = list.data?.pages.flatMap((pg) => pg.campaigns ?? []) ?? [];
	const ids = campaigns.map((c) => c.id);
	const statuses = useQuery({
		queryKey: ["oc", "ads", universeId, "statuses", ids.join(",")],
		enabled: ids.length > 0,
		queryFn: () => batchCampaignStatus(cloud, ids),
		retry: false,
		refetchInterval: 60_000,
	});

	const creatives = useInfiniteQuery({
		queryKey: ["oc", "ads", universeId, "creatives", account, groupId],
		enabled: tab === "creatives",
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listCreatives(cloud, { universeId: account === "experience" ? universeId : undefined, groupId: account === "group" && groupId ? groupId : undefined, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
		retry: false,
	});
	const creativeRows = creatives.data?.pages.flatMap((pg) => pg.creatives ?? []) ?? [];
	// Creative images: every campaign's creatives plus the saved ones, one batched public thumbnails call.
	const campaignCreatives = campaigns.flatMap((c) => c.creativeAssetIds ?? []);
	const images = useCreativeImages(tab === "campaigns" ? campaignCreatives : creativeRows.map((c) => c.assetId));
	// Homepage-thumbnail stats only for this experience's creatives (the analytics are per universe).
	const ownCreatives = Array.from(
		new Set(
			tab === "campaigns"
				? campaigns.filter((c) => !c.targetUniverseId || c.targetUniverseId === String(universeId)).flatMap((c) => c.creativeAssetIds ?? [])
				: creativeRows.filter((c) => !c.universeId || c.universeId === String(universeId)).map((c) => c.assetId),
		),
	);
	const thumbStats = useCreativeThumbnailStats(universeId, ownCreatives);
	const statFor = (assetId: string) => (ownCreatives.includes(assetId) ? thumbStats.byAsset.get(assetId) : undefined);

	return (
		<>
			<Segmented
				options={[
					{ value: "experience", label: "This experience" },
					{ value: "mine", label: "My account" },
					...(groupId ? [{ value: "group" as Account, label: "Group account" }] : []),
				]}
				value={account}
				onChange={setAccount}
			/>
			<Segmented options={[{ value: "campaigns", label: "Campaigns" }, { value: "creatives", label: "Creatives" }]} value={tab} onChange={setTab} />

			{tab === "campaigns" ? (
				<>
					<Chips options={[{ value: "all" as Ended, label: "All" }, { value: "running" as Ended, label: "Not ended" }, { value: "90d" as Ended, label: "Last 90 days" }]} value={ended} onChange={pickEnded} />
					{canWrite ? <Button title="New campaign" variant="brand" icon="add" small onPress={() => router.push(`/project/${universeId}/ads?create=1`)} style={{ alignSelf: "flex-start" }} /> : null}
					<CtrNote />
					<HomepageStatsHint stats={thumbStats} />
					{list.error ? (
						<CloudError error={list.error} what="Ads" onRetry={() => list.refetch()} />
					) : !list.data ? (
						<SkeletonList rows={4} />
					) : campaigns.length ? (
						<Section>
							<List>
								{campaigns.map((c) => {
									const s = statuses.data?.[c.id];
									const status = s?.status ?? c.status;
									const reasons = s?.deliveryStatusReasons ?? c.deliveryStatusReasons ?? [];
									const ids = c.creativeAssetIds ?? [];
									const matched = ids.map(statFor).filter((x) => x !== undefined);
									const best = matched.reduce<(typeof matched)[number] | undefined>((a, b) => (!a || (b.ptr ?? -1) > (a.ptr ?? -1) ? b : a), undefined);
									return (
										<Row
											key={c.id}
											title={c.name}
											subtitle={
												<View style={{ gap: 2 }}>
													<Txt variant="small" numberOfLines={2}>
														{`${fmtUsd(microsToUsd(c.budget?.amountMicros))} ${c.budget?.type === "DAILY" ? "/ day" : "total"} · ${label(c.objective)} · ${fmtDate(c.schedule?.startTime)}${c.schedule?.durationInDays ? ` → ${fmtDate(c.schedule.endTime)}` : ""}${reasons.length ? ` · ${reasons.map(label).join(", ")}` : ""}${account !== "experience" && c.targetUniverseId && c.targetUniverseId !== String(universeId) ? ` · experience ${c.targetUniverseId}` : ""}`}
													</Txt>
													<CreativeStrip assetIds={ids} images={images.data} />
													{best ? (
														<Txt variant="small">
															{matched.length === 1 ? "A creative is" : `${matched.length} creatives are`} homepage thumbnails: up to {fmtValue("rate", best.ptr)} play-through (qualified, 28 d)
														</Txt>
													) : null}
												</View>
											}
											numberOfLines={2}
											right={
												<View style={{ alignItems: "flex-end", gap: 3 }}>
													<DeliveryBadge status={s?.deliveryStatus ?? c.deliveryStatus} />
													{status !== "ACTIVE" ? <Badge label={status.toLowerCase()} tone={status === "PAUSED" ? "warning" : "muted"} /> : null}
												</View>
											}
											chevron
											onPress={() => router.push(`/project/${universeId}/ads?campaign=${encodeURIComponent(c.id)}`)}
										/>
									);
								})}
							</List>
							{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						</Section>
					) : (
						<EmptyState icon="trending-up-outline" title="No campaigns" body={account === "experience" ? "No ad campaigns for this experience in the last 730 days." : "No campaigns in this ads account."} />
					)}
				</>
			) : creatives.error ? (
				<CloudError error={creatives.error} what="Ad creatives" onRetry={() => creatives.refetch()} />
			) : !creatives.data ? (
				<SkeletonList rows={4} />
			) : creativeRows.length ? (
				<Section>
					<List>
						{creativeRows.map((c) => {
							const stat = statFor(c.assetId);
							const url = images.data?.[Number(c.assetId)];
							return (
								<Row
									key={c.id ?? c.assetId}
									left={url ? <Image source={{ uri: url }} style={{ width: 64, height: 36, borderRadius: 4 }} contentFit="cover" /> : undefined}
									title={c.assetName || `Asset ${c.assetId}`}
									subtitle={
										<View style={{ gap: 4 }}>
											<Txt variant="small" numberOfLines={2}>
												{`${c.assetId}${c.width && c.height ? ` · ${c.width}×${c.height}` : ""}${c.source ? ` · ${label(c.source)}` : ""}${c.isArchived ? " · archived" : ""}`}
											</Txt>
											{stat ? <ThumbStatLine stat={stat} /> : null}
										</View>
									}
									right={<Badge label={label(c.moderationStatus) || "unknown"} tone={c.moderationStatus === "APPROVED" ? "good" : c.moderationStatus === "REJECTED" ? "critical" : "brand"} />}
								/>
							);
						})}
					</List>
					{creatives.hasNextPage ? <Button title="Load more" small loading={creatives.isFetchingNextPage} onPress={() => creatives.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
					<CtrNote />
					<HomepageStatsHint stats={thumbStats} />
				</Section>
			) : (
				<EmptyState icon="image-outline" title="No creatives" body="Images used in campaigns are saved here. Upload image assets with Open Cloud or Creator Hub, then pick them in a new campaign." />
			)}
		</>
	);
}

/** The homepage-thumbnail stats' state: a button when nothing tells whether a creative is a homepage thumbnail. */
function HomepageStatsHint({ stats }: { stats: ReturnType<typeof useCreativeThumbnailStats> }) {
	if (!stats.can) return null;
	if (stats.error) return <CloudError error={stats.error} what="Homepage thumbnail stats" />;
	if (stats.loading) return <Txt variant="small">Loading homepage thumbnail stats…</Txt>;
	if (stats.requested && !stats.matched) return <Txt variant="small">None of these creatives has homepage thumbnail stats in the last 28 days.</Txt>;
	if (stats.unknown)
		return (
			<Button
				title="Match creatives with homepage thumbnail stats"
				icon="images-outline"
				small
				variant="ghost"
				onPress={stats.request}
				style={{ alignSelf: "flex-start" }}
			/>
		);
	return null;
}
