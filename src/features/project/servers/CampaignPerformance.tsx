/**
 * A campaign's performance like Ads Manager's campaign panel: the range, the totals (spent, impressions, clicks, CTR,
 * CPC), a daily chart, and the ads as a table (creative, on / off, status, spent, impressions, CTR, clicks, CPC), from
 * the Sponsored Ads metrics (ad-report.ts) and GET /campaigns/{id}/ads. An ad's switch pauses or resumes it (resuming
 * asks first: it spends money). Plays aren't in the API, so there's no Plays column.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { Switch, View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { LineChart } from "@/charts/LineChart";
import { Badge, Chips, confirm, notify, Section, Stat, StatGrid, Txt } from "@/components/ui";
import { useExportLines } from "@/features/export/context";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { useTheme } from "@/theme";

import { fmtUsd, listCampaignAds, listCreatives, updateCampaignAd, type Campaign, type CampaignAd } from "../api/servers";
import { CloudError, cloudErrorText } from "../CloudError";
import { AD_RANGES, cpc, ctr, useAdReport, type AdNumbers, type AdRange } from "./ad-report";
import { label } from "./ads-shared";
import { useCreativeImages } from "./creative-stats";

const fmtCount = (n: number | null) => (n === null ? "–" : Math.round(n).toLocaleString());
const fmtPct = (n: number | null) => (n === null ? "–" : `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`);
const fmtMoney = (n: number | null) => (n === null ? "–" : fmtUsd(n));
const fmtCpc = (n: number | null) => (n === null ? "–" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

type ChartKey = "impressions" | "clicks" | "spend" | "ctr";

interface AdRow extends AdNumbers {
	ad: CampaignAd;
	name: string;
	image: string | undefined;
}

const DELIVERY_TONE: Record<CampaignAd["deliveryStatus"], "good" | "brand" | "muted" | "critical"> = { SERVING: "good", IN_REVIEW: "brand", NOT_SERVING: "muted", REJECTED: "critical" };

export function CampaignPerformance({ c, cloud, universeId, canWrite }: { c: Campaign; cloud: OpenCloud; universeId: number; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [days, setDays] = useState<AdRange>(28);
	const [chart, setChart] = useState<ChartKey>("impressions");
	const target = Number(c.targetUniverseId) || universeId;
	const report = useAdReport(target, days, c.id);
	useExportLines(() => [`Campaign: ${c.name} (id ${c.id})`, `Numbers: last ${AD_RANGES.find((r) => r.value === days)?.label} (whole UTC hours)`]);
	const ads = useQuery({ queryKey: ["oc", "ads", "campaign", c.id, "ads"], queryFn: () => listCampaignAds(cloud, c.id), retry: false, staleTime: 60_000 });
	const groupId = c.creator?.groupId && /^\d+$/.test(c.creator.groupId) ? Number(c.creator.groupId) : undefined;
	const saved = useQuery({
		queryKey: ["oc", "ads", "creatives", target, "names", groupId ?? "me"],
		enabled: (ads.data?.length ?? 0) > 0,
		staleTime: 300_000,
		queryFn: () => listCreatives(cloud, { universeId: target, groupId }),
		retry: false,
	});
	const images = useCreativeImages((ads.data ?? []).map((a) => a.creativeAssetId));
	const toggle = useMutation({
		mutationFn: ({ ad, status }: { ad: CampaignAd; status: "ACTIVE" | "PAUSED" }) => updateCampaignAd(cloud, c.id, ad.id, status),
		onSuccess: (updated) => {
			queryClient.setQueryData<CampaignAd[]>(["oc", "ads", "campaign", c.id, "ads"], (old) => old?.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
			void queryClient.invalidateQueries({ queryKey: ["oc", "ads", "campaign", c.id, "ads"] });
		},
		onError: (e) => notify("Couldn't change the ad", cloudErrorText(e)),
	});
	const editable = canWrite && c.status !== "CANCELLED";

	const rows: AdRow[] = useMemo(
		() =>
			(ads.data ?? []).map((ad) => {
				const n = report.rows.get(ad.id) ?? { impressions: report.loading ? null : 0, clicks: report.loading ? null : 0, spend: report.loading ? null : 0 };
				const info = saved.data?.creatives?.find((x) => x.assetId === ad.creativeAssetId);
				return { ad, ...n, name: info?.assetName || `Asset ${ad.creativeAssetId}`, image: images.data?.[Number(ad.creativeAssetId)] };
			}),
		[ads.data, report.rows, report.loading, saved.data, images.data],
	);

	const columns = useMemo<DataColumn<AdRow>[]>(
		() => [
			{
				id: "creative",
				header: "Creative",
				accessor: (r) => r.name,
				searchText: (r) => r.ad.creativeAssetId,
				width: 140,
				cell: (r) => (
					<View style={{ gap: 2 }}>
						{r.image ? <Image source={{ uri: r.image }} style={{ width: 112, height: 63, borderRadius: 4 }} contentFit="cover" /> : <View style={{ width: 112, height: 63, borderRadius: 4, backgroundColor: p.muted }} />}
						<Txt variant="small" numberOfLines={1}>
							{r.name}
						</Txt>
					</View>
				),
			},
			{
				id: "on",
				header: "Off/on",
				accessor: (r) => r.ad.status === "ACTIVE",
				format: (v) => (v ? "On" : "Off"),
				type: "boolean",
				width: 72,
				cell: (r) =>
					r.ad.status === "REMOVED" ? (
						<Txt variant="small">removed</Txt>
					) : (
						<Switch
							value={r.ad.status === "ACTIVE"}
							disabled={!editable || toggle.isPending}
							trackColor={{ true: p.brand, false: p.muted }}
							thumbColor="#ffffff"
							onValueChange={async (on) => {
								if (on && !(await confirm("Resume this ad?", `"${r.name}" starts serving again and spends from the campaign's budget.`, "Resume", false))) return;
								toggle.mutate({ ad: r.ad, status: on ? "ACTIVE" : "PAUSED" });
							}}
						/>
					),
			},
			{
				id: "status",
				header: "Status",
				type: "enum",
				accessor: (r) => label(r.ad.deliveryStatus),
				order: ["Serving", "In review", "Not serving", "Rejected"],
				width: 112,
				cell: (r) => (
					<View style={{ gap: 2, alignItems: "flex-start" }}>
						<Badge label={label(r.ad.deliveryStatus)} tone={DELIVERY_TONE[r.ad.deliveryStatus] ?? "muted"} />
						{r.ad.reviewIssues?.length ? (
							<Txt variant="small" color={p.destructive} numberOfLines={2}>
								{r.ad.reviewIssues[0]!.message}
							</Txt>
						) : null}
					</View>
				),
			},
			{ id: "spend", header: "Spent", hint: "USD", type: "number", align: "right", accessor: (r) => r.spend, format: (v) => fmtMoney(v as number | null) },
			{ id: "impressions", header: "Impressions", type: "number", align: "right", width: 104, accessor: (r) => r.impressions, format: (v) => fmtCount(v as number | null) },
			{ id: "ctr", header: "CTR", type: "number", align: "right", width: 72, accessor: (r) => ctr(r), format: (v) => fmtPct(v as number | null), title: "Clicks per impression" },
			{ id: "clicks", header: "Clicks", type: "number", align: "right", width: 80, accessor: (r) => r.clicks, format: (v) => fmtCount(v as number | null) },
			{ id: "cpc", header: "CPC", type: "number", align: "right", width: 80, accessor: (r) => cpc(r), format: (v) => fmtCpc(v as number | null), title: "Spend per click" },
			{ id: "adId", header: "Ad id", accessor: (r) => r.ad.id, mono: true, defaultHidden: true },
			{ id: "assetId", header: "Asset id", accessor: (r) => r.ad.creativeAssetId, mono: true, defaultHidden: true },
		],
		[p, editable, toggle],
	);

	const t = report.totals;
	const chartValue = (pt: AdNumbers) => (chart === "ctr" ? ctr(pt) : pt[chart]);
	const chartFormat = chart === "spend" ? (v: number) => fmtMoney(v) : chart === "ctr" ? (v: number) => fmtPct(v) : (v: number) => fmtCount(v);

	return (
		<Section title="Performance">
			<Chips options={AD_RANGES} value={days} onChange={setDays} />
			{!report.can ? (
				<Txt variant="small">Add universe.analytics:read (for this experience) to your key to see spend, impressions, clicks and CTR.</Txt>
			) : report.error ? (
				<CloudError error={report.error} what="Ad reporting" onRetry={report.refetch} />
			) : (
				<>
					<StatGrid title="Campaign performance">
						<Stat label="Spent" value={fmtMoney(t.spend)} sub={`last ${AD_RANGES.find((r) => r.value === days)?.label}`} />
						<Stat label="Impressions" value={fmtCount(t.impressions)} />
						<Stat label="Clicks" value={fmtCount(t.clicks)} sub={`CTR ${fmtPct(ctr(t))}`} />
						<Stat label="Cost per click" value={fmtCpc(cpc(t))} sub={t.impressions ? `${fmtCpc(t.spend !== null ? (t.spend / t.impressions) * 1000 : null)} per 1,000 impressions` : undefined} />
					</StatGrid>
					<Chips
						options={[
							{ value: "impressions" as ChartKey, label: "Impressions" },
							{ value: "clicks" as ChartKey, label: "Clicks" },
							{ value: "spend" as ChartKey, label: "Spent" },
							{ value: "ctr" as ChartKey, label: "CTR" },
						]}
						value={chart}
						onChange={setChart}
					/>
					{report.trend.length ? (
						<LineChart
							height={170}
							series={[{ label: chart === "spend" ? "Spent" : chart === "ctr" ? "CTR" : chart === "clicks" ? "Clicks" : "Impressions", points: report.trend.map((pt) => ({ t: pt.t, v: chartValue(pt) })) }]}
							format={chartFormat}
							axisFormat={chartFormat}
							timeLabel={days <= 1 ? (ms) => `${String(new Date(ms).getHours()).padStart(2, "0")}:00` : undefined}
							exportTitle={`${c.name}: ${chart}`}
						/>
					) : (
						<Txt variant="small">{report.loading ? "Loading performance…" : "No impressions in this range."}</Txt>
					)}
				</>
			)}
			{ads.error ? (
				<CloudError error={ads.error} what="Campaign ads" onRetry={() => ads.refetch()} />
			) : (
				<DataTable
					id="ads-campaign-ads"
					label="Ads"
					columns={columns}
					data={rows}
					rowId={(r) => r.ad.id}
					loading={ads.isPending}
					defaultSort={[{ id: "spend", desc: true }]}
					urlSync={false}
					search={false}
					empty={<Txt variant="muted">{c.video?.source === "PREVIEW_VIDEO" ? "This campaign runs the experience's preview video." : "No ads in this campaign."}</Txt>}
				/>
			)}
			<Txt variant="small">Spend is in USD. Roblox's API reports impressions, clicks and spend; plays from ads are only in Ads Manager. Recent hours can still change.</Txt>
		</Section>
	);
}
