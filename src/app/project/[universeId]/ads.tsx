/**
 * Ads Manager (ads-management v1, BETA): this experience's campaigns (or every campaign in your own or the owning
 * group's ads account) as a table like Ads Manager's (on / off, delivery status, spent, impressions, CTR, clicks, CPC
 * from the Analytics API's Sponsored Ads metrics, servers/ad-report.ts; status refreshed through
 * campaigns:batchGetStatus), the saved creatives, and a new campaign. A creative that is also a homepage thumbnail
 * shows that thumbnail's play-through (servers/creative-stats). ?campaign=<id> opens one campaign (its ads as a table,
 * pause, resume, cancel, budget, …); ?create=1 opens the new campaign form. Needs ad.campaign:read; edits need
 * ad.campaign:write; the numbers need universe.analytics:read.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { Switch, View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { gameDetails } from "@/api/roblox-public";
import { Badge, Button, Chips, confirm, EmptyState, List, notify, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { batchCampaignStatus, fmtUsd, listCampaigns, listCreatives, microsToUsd, updateCampaign, type Campaign, type CampaignListParams, type CampaignStatusRow } from "@/features/project/api/servers";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import type { ThumbStat } from "@/features/project/analytics/thumbnail-stats";
import { AD_RANGES, cpc, ctr, useAdReport, type AdRange } from "@/features/project/servers/ad-report";
import { DeliveryBadge, label } from "@/features/project/servers/ads-shared";
import { CampaignCreate } from "@/features/project/servers/CampaignCreate";
import { CampaignDetail } from "@/features/project/servers/CampaignDetail";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { useTheme } from "@/theme";
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
	const [days, setDays] = useState<AdRange>(28);
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
					<Chips options={AD_RANGES} value={days} onChange={setDays} />
					<HomepageStatsHint stats={thumbStats} />
					{list.error ? (
						<CloudError error={list.error} what="Ads" onRetry={() => list.refetch()} />
					) : !list.data ? (
						<SkeletonList rows={4} />
					) : campaigns.length ? (
						<CampaignTable
							campaigns={campaigns}
							statuses={statuses.data}
							universeId={universeId}
							cloud={cloud}
							canWrite={canWrite}
							days={days}
							showUniverse={account !== "experience"}
							images={images.data}
							statFor={statFor}
							footer={list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
						/>
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

const fmtCount = (n: number | null) => (n === null ? "–" : Math.round(n).toLocaleString());
const fmtPct = (n: number | null) => (n === null ? "–" : `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`);
const fmtCpc = (n: number | null) => (n === null ? "–" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

interface CampaignRow {
	c: Campaign;
	status: Campaign["status"];
	delivery: Campaign["deliveryStatus"];
	reasons: string[];
	/** null: no numbers (another experience's campaign, no analytics scope, or still loading). */
	impressions: number | null;
	clicks: number | null;
	spend: number | null;
}

/**
 * The campaigns as Ads Manager's table (a tap opens one, the switch pauses or resumes after asking). Numbers only for
 * this experience's campaigns: the analytics belong to the experience.
 */
function CampaignTable({
	campaigns,
	statuses,
	universeId,
	cloud,
	canWrite,
	days,
	showUniverse,
	images,
	statFor,
	footer,
}: {
	campaigns: Campaign[];
	statuses: Record<string, CampaignStatusRow> | undefined;
	universeId: number;
	cloud: OpenCloud;
	canWrite: boolean;
	days: AdRange;
	showUniverse: boolean;
	images: Record<number, string> | undefined;
	statFor: (assetId: string) => ThumbStat | undefined;
	footer: ReactNode;
}) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const report = useAdReport(universeId, days);
	const toggle = useMutation({
		mutationFn: ({ c, status }: { c: Campaign; status: "ACTIVE" | "PAUSED" }) => updateCampaign(cloud, c.id, { status }),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["oc", "ads"] }),
		onError: (e) => notify("Couldn't update the campaign", cloudErrorText(e)),
	});
	const rows: CampaignRow[] = campaigns.map((c) => {
		const s = statuses?.[c.id];
		const own = !c.targetUniverseId || c.targetUniverseId === String(universeId);
		const n = own && report.can && !report.loading && !report.error ? (report.rows.get(c.id) ?? { impressions: 0, clicks: 0, spend: 0 }) : null;
		return {
			c,
			status: s?.status ?? c.status,
			delivery: s?.deliveryStatus ?? c.deliveryStatus,
			reasons: s?.deliveryStatusReasons ?? c.deliveryStatusReasons ?? [],
			impressions: n?.impressions ?? null,
			clicks: n?.clicks ?? null,
			spend: n?.spend ?? null,
		};
	});
	const columns: DataColumn<CampaignRow>[] = [
		{
			id: "campaign",
			header: "Campaign",
			accessor: (r) => r.c.name,
			width: 190,
			hideable: false,
			cell: (r) => {
				const ids = r.c.creativeAssetIds ?? [];
				const best = ids
					.map(statFor)
					.filter((x): x is ThumbStat => x !== undefined)
					.sort((a, b) => (b.ptr ?? -1) - (a.ptr ?? -1))[0];
				return (
					<View style={{ gap: 2 }}>
						<Txt style={{ fontWeight: "600" }} numberOfLines={2}>
							{r.c.name}
						</Txt>
						<Txt variant="small" numberOfLines={2}>
							{`${fmtUsd(microsToUsd(r.c.budget?.amountMicros))} ${r.c.budget?.type === "DAILY" ? "/ day" : "total"} · ${label(r.c.objective)} · ${fmtDate(r.c.schedule?.startTime)}${r.c.schedule?.durationInDays ? ` → ${fmtDate(r.c.schedule.endTime)}` : ""}${showUniverse && r.c.targetUniverseId && r.c.targetUniverseId !== String(universeId) ? ` · experience ${r.c.targetUniverseId}` : ""}`}
						</Txt>
						<CreativeStrip assetIds={ids} images={images} max={3} />
						{best ? <Txt variant="small">homepage thumbnail: {fmtValue("rate", best.ptr)} play-through</Txt> : null}
					</View>
				);
			},
		},
		{
			id: "on",
			header: "Off/on",
			type: "boolean",
			width: 72,
			accessor: (r) => r.status === "ACTIVE",
			cell: (r) =>
				r.status === "CANCELLED" ? (
					<Txt variant="small">cancelled</Txt>
				) : (
					<Switch
						value={r.status === "ACTIVE"}
						disabled={!canWrite || toggle.isPending}
						trackColor={{ true: p.brand, false: p.muted }}
						thumbColor="#ffffff"
						onValueChange={async (on) => {
							const ok = on
								? await confirm(
										"Resume the campaign?",
										`It starts serving again and spends up to ${fmtUsd(microsToUsd(r.c.budget?.amountMicros))} ${r.c.budget?.type === "DAILY" ? "a day" : "in total"}.`,
										"Resume",
										false,
									)
								: await confirm("Pause the campaign?", "It stops serving ads until you resume it.", "Pause", false);
							if (ok) toggle.mutate({ c: r.c, status: on ? "ACTIVE" : "PAUSED" });
						}}
					/>
				),
		},
		{
			id: "status",
			header: "Status",
			type: "enum",
			width: 120,
			accessor: (r) => label(r.delivery),
			cell: (r) => (
				<View style={{ gap: 2, alignItems: "flex-start" }}>
					<DeliveryBadge status={r.delivery} />
					{r.reasons.length ? (
						<Txt variant="small" numberOfLines={2}>
							{r.reasons.map(label).join(", ")}
						</Txt>
					) : null}
				</View>
			),
		},
		{ id: "spend", header: "Spent", hint: "USD", type: "number", align: "right", accessor: (r) => r.spend, format: (v) => (v === null || v === undefined ? "–" : fmtUsd(v as number)) },
		{ id: "impressions", header: "Impressions", type: "number", align: "right", width: 104, accessor: (r) => r.impressions, format: (v) => fmtCount((v as number | null) ?? null) },
		{ id: "ctr", header: "CTR", type: "number", align: "right", width: 72, accessor: (r) => ctr(r), format: (v) => fmtPct((v as number | null) ?? null), title: "Clicks per impression" },
		{ id: "clicks", header: "Clicks", type: "number", align: "right", width: 80, accessor: (r) => r.clicks, format: (v) => fmtCount((v as number | null) ?? null) },
		{ id: "cpc", header: "CPC", type: "number", align: "right", width: 80, accessor: (r) => cpc(r), format: (v) => fmtCpc((v as number | null) ?? null), title: "Spend per click" },
		{
			id: "budget",
			header: "Budget",
			hint: "USD",
			type: "number",
			align: "right",
			accessor: (r) => microsToUsd(r.c.budget?.amountMicros) ?? null,
			format: (v, r) => `${fmtUsd((v as number | null) ?? null)}${r.c.budget?.type === "DAILY" ? " / day" : ""}`,
			defaultHidden: true,
		},
		{ id: "id", header: "Campaign id", accessor: (r) => r.c.id, mono: true, defaultHidden: true },
	];
	return (
		<Section>
			{!report.can ? (
				<Txt variant="small">Add universe.analytics:read (for this experience) to your key to see spend, impressions, clicks and CTR.</Txt>
			) : report.error ? (
				<CloudError error={report.error} what="Ad reporting" onRetry={report.refetch} />
			) : report.loading ? (
				<Txt variant="small">Loading spend, impressions and clicks…</Txt>
			) : null}
			<DataTable
				id="ads-campaigns"
				label="Campaigns"
				columns={columns}
				data={rows}
				rowId={(r) => r.c.id}
				urlSync={false}
				onRowPress={(r) => router.push(`/project/${universeId}/ads?campaign=${encodeURIComponent(r.c.id)}`)}
			/>
			{footer}
		</Section>
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
