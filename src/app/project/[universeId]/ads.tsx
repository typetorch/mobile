/**
 * Ads Manager (ads-management v1, BETA): this experience's campaigns (or every campaign in your own or the owning
 * group's ads account) with their delivery status (refreshed through campaigns:batchGetStatus), the saved creatives,
 * and a new campaign. ?campaign=<id> opens one campaign (pause, resume, cancel, budget, …); ?create=1 opens the new
 * campaign form. Needs ad.campaign:read; edits need ad.campaign:write.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { assetThumbs, gameDetails } from "@/api/roblox-public";
import { Badge, Button, Chips, EmptyState, List, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { batchCampaignStatus, fmtUsd, listCampaigns, listCreatives, microsToUsd, type CampaignListParams } from "@/features/project/api/servers";
import { CloudError } from "@/features/project/CloudError";
import { DeliveryBadge, label } from "@/features/project/servers/ads-shared";
import { CampaignCreate } from "@/features/project/servers/CampaignCreate";
import { CampaignDetail } from "@/features/project/servers/CampaignDetail";
import { ToolScreen } from "@/features/project/tool";
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
	const thumbs = useQuery({
		queryKey: ["oc", "ads", "thumbs", creativeRows.map((c) => c.assetId).join(",")],
		enabled: creativeRows.length > 0,
		staleTime: 3600_000,
		queryFn: () => assetThumbs(creativeRows.map((c) => Number(c.assetId)).filter((n) => Number.isFinite(n))),
	});

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
									return (
										<Row
											key={c.id}
											title={c.name}
											subtitle={`${fmtUsd(microsToUsd(c.budget?.amountMicros))} ${c.budget?.type === "DAILY" ? "/ day" : "total"} · ${label(c.objective)} · ${fmtDate(c.schedule?.startTime)}${c.schedule?.durationInDays ? ` → ${fmtDate(c.schedule.endTime)}` : ""}${reasons.length ? ` · ${reasons.map(label).join(", ")}` : ""}${account !== "experience" && c.targetUniverseId && c.targetUniverseId !== String(universeId) ? ` · experience ${c.targetUniverseId}` : ""}`}
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
						{creativeRows.map((c) => (
							<Row
								key={c.id ?? c.assetId}
								left={thumbs.data?.[Number(c.assetId)] ? <Image source={{ uri: thumbs.data[Number(c.assetId)] }} style={{ width: 48, height: 32, borderRadius: 4 }} contentFit="cover" /> : undefined}
								title={c.assetName || `Asset ${c.assetId}`}
								subtitle={`${c.assetId}${c.width && c.height ? ` · ${c.width}×${c.height}` : ""}${c.source ? ` · ${label(c.source)}` : ""}${c.isArchived ? " · archived" : ""}`}
								right={<Badge label={label(c.moderationStatus) || "unknown"} tone={c.moderationStatus === "APPROVED" ? "good" : c.moderationStatus === "REJECTED" ? "critical" : "brand"} />}
							/>
						))}
					</List>
					{creatives.hasNextPage ? <Button title="Load more" small loading={creatives.isFetchingNextPage} onPress={() => creatives.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</Section>
			) : (
				<EmptyState icon="image-outline" title="No creatives" body="Images used in campaigns are saved here. Upload image assets with Open Cloud or Creator Hub, then pick them in a new campaign." />
			)}
		</>
	);
}
