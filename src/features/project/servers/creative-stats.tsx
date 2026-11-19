/**
 * Ad creatives as images on the Ads pages, and what can be said about how they perform. Per-ad numbers (impressions,
 * clicks, spend) are in servers/ad-report.ts; a saved creative has none of its own.
 * A creative whose image is also one of the experience's homepage thumbnails (same asset id) shows that thumbnail's
 * play-through numbers from the Analytics API (the thumbnail gallery's queries, over the last 28 days): those are
 * homepage numbers, not ad numbers.
 */
import * as WebBrowser from "expo-web-browser";
import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

import { Badge, Button, Txt } from "@/components/ui";
import { fmtValue } from "@/features/project/analytics/shared";
import { useHomepageAssetIds, useThumbnailStats, useWideAssetImages, type ThumbStat } from "@/features/project/analytics/thumbnail-stats";
import { useTheme } from "@/theme";

import type { RangeSpec } from "../analytics";

/** Ads Manager's "Manage ads" page (create.roblox.com/dashboard/ads is a 404). */
export const ADS_MANAGER_URL = "https://create.roblox.com/advertise/manage";
const STATS_RANGE: RangeSpec = { kind: "preset", days: 28 };

/** Where per-ad clicks and CTR are: on the campaign pages (a saved creative has no numbers of its own). */
export function CtrNote({ compact }: { compact?: boolean }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
			<Txt variant="small" style={{ flexShrink: 1 }}>
				Clicks, CTR and spend are per ad on each campaign (they belong to a campaign's ad, not to a saved creative).
			</Txt>
			<Button title={compact ? "Ads Manager" : "Open Ads Manager"} icon="open-outline" small variant="ghost" onPress={() => void WebBrowser.openBrowserAsync(ADS_MANAGER_URL)} />
		</View>
	);
}

/** Image URLs (16:9) for creative asset ids. */
export function useCreativeImages(assetIds: string[]) {
	return useWideAssetImages(assetIds.map((id) => (/^\d+$/.test(id) ? Number(id) : null)));
}

/**
 * Homepage-thumbnail stats for creatives of this universe's campaigns. The six analytics queries run only when a
 * creative is known to be a homepage thumbnail (personalization pool or main thumbnails), or after `request()` when
 * that can't be told; otherwise nothing is spent.
 */
export function useCreativeThumbnailStats(universeId: number, creativeAssetIds: string[]) {
	const homepage = useHomepageAssetIds(universeId, creativeAssetIds.length > 0);
	const overlap = creativeAssetIds.filter((id) => homepage.ids.has(id));
	const [requested, setRequested] = useState(false);
	const stats = useThumbnailStats(universeId, STATS_RANGE, overlap.length > 0 || requested);
	const byAsset = new Map<string, ThumbStat>();
	for (const s of stats.rows) if (s.assetId !== null) byAsset.set(String(s.assetId), s);
	return {
		can: stats.can,
		byAsset,
		/** Creatives known to be homepage thumbnails. */
		overlap,
		/** Creatives with homepage-thumbnail stats in the last 28 days. */
		matched: creativeAssetIds.filter((id) => byAsset.has(id)).length,
		/** The pool couldn't be read whole, so a creative might still be a homepage thumbnail; no query ran yet. */
		unknown: stats.can && creativeAssetIds.length > 0 && !homepage.loading && !homepage.complete && overlap.length === 0 && !requested,
		request: () => setRequested(true),
		requested,
		loading: stats.loading,
		error: stats.error,
	};
}

/** "Homepage thumbnail · 3.2% play-through · 12K impressions (28 d)". */
export function ThumbStatLine({ stat }: { stat: ThumbStat }) {
	const p = useTheme();
	return (
		<View style={{ gap: 2 }}>
			<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
				<Badge label="Homepage thumbnail" tone="brand" icon="home-outline" />
				<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
					{fmtValue("rate", stat.ptr)} play-through (qualified)
				</Txt>
			</View>
			<Txt variant="small">
				{fmtValue("count", stat.impressions)} impressions · {fmtValue("count", stat.plays)} qualified plays · 7-day {fmtValue("rate", stat.l7ptr)} · last 28 days on the homepage, not from the ad
			</Txt>
		</View>
	);
}

/** Up to `max` creative images in a row (campaign list), with "+N". */
export function CreativeStrip({ assetIds, images, max = 4 }: { assetIds: string[]; images: Record<number, string> | undefined; max?: number }) {
	const p = useTheme();
	if (!assetIds.length) return null;
	return (
		<View style={{ flexDirection: "row", gap: 4, alignItems: "center", marginTop: 4 }}>
			{assetIds.slice(0, max).map((id) => {
				const url = images?.[Number(id)];
				return url ? (
					<Image key={id} source={{ uri: url }} style={{ width: 56, height: 32, borderRadius: 4 }} contentFit="cover" />
				) : (
					<View key={id} style={{ width: 56, height: 32, borderRadius: 4, backgroundColor: p.muted }} />
				);
			})}
			{assetIds.length > max ? <Txt variant="small">+{assetIds.length - max}</Txt> : null}
		</View>
	);
}
