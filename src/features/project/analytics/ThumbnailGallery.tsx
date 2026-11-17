/**
 * Thumbnail performance gallery (Analytics tab > Thumbnails > Gallery): one card per thumbnail with its image and the
 * range's impressions, qualified play-through, qualified plays, 7-day play-through, average session time and winning
 * segments; sortable by any of them; thumbnails in the active personalization config are marked; a tap opens the
 * thumbnail's trend. Six Analytics Query API queries at most (one per metric, by ThumbnailAsset), shared with the
 * Thumbnails cards' cache (see thumbnail-stats.ts).
 */
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { LineChart } from "@/charts/LineChart";
import { Badge, Button, Card, Chips, EmptyState, Icon, Skeleton, SkeletonList, Txt } from "@/components/ui";
import { CloudError } from "@/features/project/CloudError";
import { useTheme } from "@/theme";

import { GRANULARITY_LABEL, type RangeSpec } from "../analytics";
import { timeLabelFor } from "./MetricCard";
import { fmtValue } from "./shared";
import { PTR_NOTE, THUMB_STATS, useActiveThumbnailConfig, useThumbnailStats, useWideAssetImages, type ThumbStat, type ThumbStatKey } from "./thumbnail-stats";

const TREND_KEYS: ThumbStatKey[] = ["impressions", "ptr", "plays", "l7ptr", "session"];
const statInfo = (key: ThumbStatKey) => THUMB_STATS.find((s) => s.key === key)!;

export function ThumbnailGallery({ universeId, range }: { universeId: number; range: RangeSpec }) {
	const p = useTheme();
	const [sort, setSort] = useState<ThumbStatKey>("impressions");
	const [desc, setDesc] = useState(true);
	const [open, setOpen] = useState<string | null>(null);
	const stats = useThumbnailStats(universeId, range);
	const active = useActiveThumbnailConfig(universeId);
	const assetOf = (s: ThumbStat) => s.assetId ?? active.assetFor(s.key);
	const images = useWideAssetImages([...stats.rows.map(assetOf), ...active.config?.thumbnails.map((t) => t.assetId) ?? []]);

	const rows = [...stats.rows].sort((a, b) => {
		const x = a[sort];
		const y = b[sort];
		if (x === null && y === null) return 0;
		if (x === null) return 1;
		if (y === null) return -1;
		return desc ? y - x : x - y;
	});
	// Active-config thumbnails with no numbers in the range (just added, or not served yet).
	const missing = !stats.queries.impressions.data ? [] : (active.config?.thumbnails ?? []).filter((t) => t.personalizedThumbnailStatus === "Active" && !stats.rows.some((s) => s.key === t.homepageThumbnailId || assetOf(s) === t.assetId));
	const hourly = stats.granularity === "OneHour";

	return (
		<View style={{ gap: 10 }}>
			<Card style={{ gap: 6 }}>
				<Txt style={{ fontWeight: "600" }}>Thumbnail gallery</Txt>
				<Txt variant="small">
					Each homepage thumbnail Roblox served in the range ({stats.startTime.slice(0, 10)} to {new Date(Date.parse(stats.endTime) - 1).toISOString().slice(0, 10)} UTC; Roblox keeps 30 days). Play-through (qualified): {PTR_NOTE}
				</Txt>
				<Txt variant="label">Sort by</Txt>
				<Chips options={THUMB_STATS.map((s) => ({ value: s.key, label: s.label }))} value={sort} onChange={setSort} />
				<View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
					<Button title={desc ? "Highest first" : "Lowest first"} icon={desc ? "arrow-down" : "arrow-up"} small variant="ghost" onPress={() => setDesc(!desc)} />
					<Badge label={`${stats.loaded} of ${THUMB_STATS.length} metrics loaded`} tone={stats.loaded === THUMB_STATS.length ? "good" : "muted"} />
					{active.can ? null : <Badge label="active config unknown (needs universe.thumbnail:read)" tone="warning" />}
				</View>
			</Card>

			{stats.error ? <CloudError error={stats.error} what="Thumbnail stats" onRetry={stats.refetch} /> : null}
			{active.query.error ? <CloudError error={active.query.error} what="Active personalization config" onRetry={() => active.query.refetch()} /> : null}
			{stats.loading && !rows.length ? <SkeletonList rows={3} /> : null}
			{!stats.loading && !rows.length && !stats.error ? (
				<EmptyState icon="images-outline" title="No thumbnail data in this range" body="Roblox reports per-thumbnail numbers for thumbnails served through thumbnail personalization (Icon & thumbnails > Personalization)." />
			) : null}

			{rows.map((s, i) => {
				const assetId = assetOf(s);
				const url = assetId !== null ? images.data?.[assetId] : undefined;
				const inActive = active.isActive(s.key, assetId);
				const expanded = open === s.key;
				return (
					<Card key={s.key} style={{ gap: 8 }}>
						<Pressable onPress={() => setOpen(expanded ? null : s.key)} style={({ pressed }) => [{ gap: 8 }, pressed && { opacity: 0.7 }]}>
							<View style={{ flexDirection: "row", gap: 10 }}>
								{url ? (
									<Image source={{ uri: url }} style={{ width: 128, height: 72, borderRadius: 6 }} contentFit="cover" />
								) : (
									<View style={{ width: 128, height: 72, borderRadius: 6, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
										{images.isLoading ? <Skeleton height={72} width={128} /> : <Icon name="image-outline" color={p.mutedForeground} />}
									</View>
								)}
								<View style={{ flex: 1, gap: 4 }}>
									<View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
										<Txt style={{ fontWeight: "600" }}>#{i + 1}</Txt>
										<Txt variant="small" numberOfLines={1} selectable>
											{assetId !== null ? `Asset ${assetId}` : s.label}
										</Txt>
									</View>
									<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
										{inActive ? <Badge label="In active config" tone="good" icon="checkmark-circle" /> : active.config ? <Badge label="Not in active config" /> : null}
									</View>
									<Txt variant="h3" style={{ fontWeight: "700" }}>
										{fmtValue("rate", s.ptr)}
									</Txt>
									<Txt variant="small">Play-through (qualified)</Txt>
								</View>
								<Icon name={expanded ? "chevron-up" : "chevron-down"} size={16} color={p.mutedForeground} />
							</View>
							<View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 6 }}>
								{THUMB_STATS.filter((x) => x.key !== "ptr").map((x) => (
									<View key={x.key} style={{ flexBasis: "33%", flexGrow: 1, gap: 1 }}>
										<Txt variant="small" numberOfLines={1}>
											{x.label}
										</Txt>
										<Txt style={{ fontWeight: sort === x.key ? "700" : "500" }} color={sort === x.key ? p.foreground : undefined}>
											{fmtValue(x.format, s[x.key])}
										</Txt>
									</View>
								))}
							</View>
							{s.segmentNames.length ? <Txt variant="small">Won in: {s.segmentNames.slice(0, 8).join(", ")}{s.segmentNames.length > 8 ? ` +${s.segmentNames.length - 8}` : ""}</Txt> : null}
						</Pressable>
						{expanded ? <ThumbTrend stat={s} hourly={hourly} granularityLabel={GRANULARITY_LABEL[stats.granularity]} /> : null}
					</Card>
				);
			})}

			{missing.length ? (
				<Card style={{ gap: 6 }}>
					<Txt style={{ fontWeight: "600" }}>In the active config, no numbers yet</Txt>
					<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
						{missing.map((t) => {
							const url = images.data?.[t.assetId];
							return url ? (
								<Image key={t.homepageThumbnailId} source={{ uri: url }} style={{ width: 96, height: 54, borderRadius: 6 }} contentFit="cover" />
							) : (
								<View key={t.homepageThumbnailId} style={{ width: 96, height: 54, borderRadius: 6, backgroundColor: p.muted }} />
							);
						})}
					</View>
				</Card>
			) : null}

			<Txt variant="small" style={{ textAlign: "center" }}>
				{THUMB_STATS.length} Analytics queries (one per metric, by thumbnail), shared with the Thumbnails cards · {hourly ? "hourly" : "daily"} buckets · play-through weighted by impressions, session time by plays, 7-day play-through
				is the latest bucket · cached for an hour
			</Txt>
		</View>
	);
}

function ThumbTrend({ stat, hourly, granularityLabel }: { stat: ThumbStat; hourly: boolean; granularityLabel: string }) {
	const [key, setKey] = useState<ThumbStatKey>("ptr");
	const info = statInfo(key);
	const pts = stat.trend[key] ?? [];
	return (
		<View style={{ gap: 6 }}>
			<Chips options={TREND_KEYS.map((k) => ({ value: k, label: statInfo(k).label }))} value={key} onChange={setKey} />
			{pts.some((x) => x.v !== null) ? (
				<LineChart
					exportTitle={`Thumbnail ${stat.assetId ?? stat.label}: ${info.label}`}
					series={[{ label: info.label, points: pts }]}
					height={150}
					format={(v) => fmtValue(info.format, v)}
					timeLabel={timeLabelFor(hourly ? "OneHour" : "OneDay")}
				/>
			) : (
				<Txt variant="muted">No {info.label.toLowerCase()} data for this thumbnail in the range.</Txt>
			)}
			<Txt variant="small">{granularityLabel[0]!.toUpperCase() + granularityLabel.slice(1)} values.</Txt>
		</View>
	);
}
