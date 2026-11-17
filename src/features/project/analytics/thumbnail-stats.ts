/**
 * Per-thumbnail numbers for the thumbnail gallery (Analytics tab > Thumbnails > Gallery) and the ad creatives that are
 * also homepage thumbnails: the six Thumbnail* metrics, each ONE Analytics Query API query broken down by
 * ThumbnailAsset, merged into one row per thumbnail. The queries are built exactly like the Thumbnails cards build
 * them with granularity Auto (same metric, granularity, range and breakdown), so they share the cards' cache (an
 * hour) and the app-wide analytics slot (30 queries a minute per key owner): a gallery is 6 queries at most, 0 when
 * the cards already loaded them.
 */
import { useQuery } from "@tanstack/react-query";

import { ANALYTICS_READ_SCOPE, hasScope, type Granularity } from "@/api/opencloud";
import { assetThumbs } from "@/api/roblox-public";
import { useAccounts } from "@/store/accounts";

import { aggregate, effectiveSpanDays, METRIC_GROUPS, normalizeRates, resolveGranularity, timeRange, type MetricDef, type MetricFormat, type RangeSpec } from "../analytics";
import type { MetricQuery, MetricSeries } from "../api/analytics-query";
import { ENG_SCOPES, gameMedia, homepageThumbnails, personalizedConfigs, type PersonalizedConfig } from "../api/engagement";
import { useMetric } from "./shared";

export type ThumbStatKey = "impressions" | "ptr" | "plays" | "l7ptr" | "session" | "segments";

export interface ThumbStatInfo {
	key: ThumbStatKey;
	metric: string;
	label: string;
	format: MetricFormat;
	/** How the range's number is made from the buckets. */
	how: string;
}

export const THUMB_STATS: ThumbStatInfo[] = [
	{ key: "impressions", metric: "ThumbnailImpressions", label: "Impressions", format: "count", how: "total" },
	{ key: "ptr", metric: "ThumbnailQualifiedPTR", label: "Play-through (qualified)", format: "rate", how: "weighted by impressions" },
	{ key: "plays", metric: "ThumbnailQualifiedPlays", label: "Qualified plays", format: "count", how: "total" },
	{ key: "l7ptr", metric: "ThumbnailL7QualifiedPTR", label: "7-day play-through", format: "rate", how: "latest" },
	{ key: "session", metric: "ThumbnailAverageSessionLengthMinutes", label: "Avg session time", format: "minutes", how: "weighted by plays" },
	{ key: "segments", metric: "ThumbnailWinningSegments", label: "Winning segments", format: "count", how: "for the range" },
];

/** Roblox's note for the play-through rate: the API's closest thing to a click-through rate. */
export const PTR_NOTE = "Qualified plays per impression: the closest thing to CTR the Analytics API has.";

const THUMB_GROUP = METRIC_GROUPS.find((g) => g.key === "thumbnails");

function defOf(metric: string): MetricDef {
	const def = THUMB_GROUP?.metrics.find((m) => m.id === metric);
	if (!def) throw new Error(`${metric} isn't in the Thumbnails metric group`);
	return def;
}

/** The query a Thumbnails card sends for this metric with granularity Auto and its default ThumbnailAsset breakdown. */
export function thumbnailQuery(metric: string, range: RangeSpec): MetricQuery {
	const def = defOf(metric);
	const { granularity, maxDays } = resolveGranularity(def, "Auto", effectiveSpanDays(range, def));
	const tr = timeRange(range, def, granularity, { maxDays });
	return { metric: def.id, granularity, startTime: tr.startTime, endTime: tr.endTime, breakdown: ["ThumbnailAsset"] };
}

export interface ThumbPoint {
	t: number;
	v: number | null;
}

export interface ThumbStat {
	/** The ThumbnailAsset value (an image asset id). */
	key: string;
	label: string;
	/** The image asset id when the value is numeric. */
	assetId: number | null;
	impressions: number | null;
	ptr: number | null;
	plays: number | null;
	l7ptr: number | null;
	session: number | null;
	segments: number | null;
	/** The winning segments' names (the metric answers them as stringValues). */
	segmentNames: string[];
	/** The buckets of each time-series stat (daily, or hourly over 24 hours). */
	trend: Partial<Record<ThumbStatKey, ThumbPoint[]>>;
}

function assetKey(s: MetricSeries): { value: string; label: string } | null {
	const b = s.breakdowns.find((x) => x.dimension === "ThumbnailAsset") ?? s.breakdowns[0];
	if (!b?.value) return null;
	return { value: b.value, label: b.displayValue || b.value };
}

function points(s: MetricSeries | undefined): ThumbPoint[] {
	return (s?.dataPoints ?? []).map((d) => ({ t: Date.parse(d.time), v: d.value }));
}

/** The mean of `values` weighted by `weights` at the same times; the plain mean when no weight lines up. */
function weightedMean(values: ThumbPoint[], weights: ThumbPoint[]): number | null {
	const w = new Map(weights.map((p) => [p.t, p.v ?? 0]));
	let sum = 0;
	let total = 0;
	for (const p of values) {
		if (p.v === null || !Number.isFinite(p.v)) continue;
		const k = w.get(p.t) ?? 0;
		sum += p.v * k;
		total += k;
	}
	return total > 0 ? sum / total : aggregate(values.map((p) => p.v), "mean");
}

/** One row per thumbnail out of the six metrics' series (any of them may still be missing). */
export function mergeThumbnailStats(data: Partial<Record<ThumbStatKey, MetricSeries[]>>): ThumbStat[] {
	const by = new Map<string, { label: string; series: Partial<Record<ThumbStatKey, MetricSeries>> }>();
	for (const info of THUMB_STATS) {
		const list = data[info.key];
		if (!list) continue;
		for (const s of normalizeRates(list, info.format)) {
			const k = assetKey(s);
			if (!k) continue;
			const row = by.get(k.value) ?? { label: k.label, series: {} };
			if (row.label === k.value && k.label !== k.value) row.label = k.label;
			row.series[info.key] = s;
			by.set(k.value, row);
		}
	}
	return [...by].map(([key, { label, series }]) => {
		const impressions = points(series.impressions);
		const plays = points(series.plays);
		const ptr = points(series.ptr);
		const session = points(series.session);
		const l7 = points(series.l7ptr);
		const seg = series.segments?.dataPoints ?? [];
		const segmentNames = Array.from(new Set(seg.flatMap((d) => d.stringValues ?? []).filter(Boolean)));
		const segValue = aggregate(
			seg.map((d) => d.value),
			"sum",
		);
		return {
			key,
			label,
			assetId: /^\d+$/.test(key) ? Number(key) : null,
			impressions: series.impressions ? aggregate(impressions.map((p) => p.v), "sum") : null,
			ptr: series.ptr ? weightedMean(ptr, impressions) : null,
			plays: series.plays ? aggregate(plays.map((p) => p.v), "sum") : null,
			l7ptr: series.l7ptr ? aggregate(l7.map((p) => p.v), "last") : null,
			session: series.session ? weightedMean(session, plays) : null,
			segments: series.segments ? (segmentNames.length ? segmentNames.length : segValue) : null,
			segmentNames,
			trend: { impressions, ptr, plays, l7ptr: l7, session },
		};
	});
}

/**
 * The six queries (one per metric, broken down by ThumbnailAsset) and their rows. `enabled` false sends nothing (rows
 * still come from the cache when the cards or the gallery loaded them).
 */
export function useThumbnailStats(universeId: number, range: RangeSpec, enabled = true) {
	const { keyInfo } = useAccounts();
	const can = hasScope(keyInfo, ANALYTICS_READ_SCOPE, universeId);
	const on = can && enabled;
	const qImpressions = useMetric(universeId, thumbnailQuery("ThumbnailImpressions", range), on);
	const qPtr = useMetric(universeId, thumbnailQuery("ThumbnailQualifiedPTR", range), on);
	const qPlays = useMetric(universeId, thumbnailQuery("ThumbnailQualifiedPlays", range), on);
	const qL7 = useMetric(universeId, thumbnailQuery("ThumbnailL7QualifiedPTR", range), on);
	const qSession = useMetric(universeId, thumbnailQuery("ThumbnailAverageSessionLengthMinutes", range), on);
	const qSegments = useMetric(universeId, thumbnailQuery("ThumbnailWinningSegments", range), on);
	const queries = { impressions: qImpressions, ptr: qPtr, plays: qPlays, l7ptr: qL7, session: qSession, segments: qSegments };
	const all = Object.values(queries);
	const rows = mergeThumbnailStats({
		impressions: qImpressions.data,
		ptr: qPtr.data,
		plays: qPlays.data,
		l7ptr: qL7.data,
		session: qSession.data,
		segments: qSegments.data,
	});
	const trendQuery = thumbnailQuery("ThumbnailImpressions", range);
	return {
		/** The key has universe.analytics:read for this universe. */
		can,
		rows,
		queries,
		loading: all.some((q) => q.isLoading),
		loaded: all.filter((q) => q.data).length,
		error: all.find((q) => q.error)?.error ?? null,
		/** The bucket of the trends (daily, or hourly over 24 hours). */
		granularity: trendQuery.granularity as Granularity,
		startTime: trendQuery.startTime,
		endTime: trendQuery.endTime,
		refetch: () => all.filter((q) => q.error || q.data).forEach((q) => q.refetch()),
	};
}

/** The active personalization config's thumbnails (needs universe.thumbnail:read; one Open Cloud call, not analytics). */
export function useActiveThumbnailConfig(universeId: number, enabled = true) {
	const { cloud, keyInfo } = useAccounts();
	const can = !!cloud && hasScope(keyInfo, ENG_SCOPES.thumbRead, universeId);
	const q = useQuery({
		queryKey: ["oc", "personalization", universeId, "active-summary"],
		enabled: can && enabled,
		staleTime: 300_000,
		retry: false,
		queryFn: async (): Promise<PersonalizedConfig | null> => (await personalizedConfigs(cloud!, universeId, "Active")).personalizedConfigs?.[0] ?? null,
	});
	const config = q.data ?? null;
	const thumbs = (config?.thumbnails ?? []).filter((t) => t.personalizedThumbnailStatus === "Active");
	/** A ThumbnailAsset value is in the active config (by asset id, or by homepage thumbnail id). */
	const isActive = (key: string, assetId: number | null) => thumbs.some((t) => t.homepageThumbnailId === key || (assetId !== null && t.assetId === assetId));
	/** The image asset id behind a ThumbnailAsset value that is a homepage thumbnail id. */
	const assetFor = (key: string): number | null => thumbs.find((t) => t.homepageThumbnailId === key)?.assetId ?? null;
	return { can, query: q, config, isActive, assetFor };
}

/**
 * Asset ids of the experience's homepage thumbnails: the personalization pool (first 50, universe.thumbnail:read) and
 * the main thumbnails (games v2 media, public). Used to tell which ad creatives are also homepage thumbnails before
 * spending analytics queries on them.
 */
export function useHomepageAssetIds(universeId: number, enabled = true) {
	const { cloud, keyInfo } = useAccounts();
	const canPool = !!cloud && hasScope(keyInfo, ENG_SCOPES.thumbRead, universeId);
	const pool = useQuery({
		queryKey: ["oc", "personalization", universeId, "pool-ids"],
		enabled: canPool && enabled,
		staleTime: 600_000,
		retry: false,
		queryFn: async () => {
			const r = await homepageThumbnails(cloud!, universeId);
			return { ids: (r.homepageThumbnails ?? []).map((t) => String(t.assetId)), more: !!r.nextCursor };
		},
	});
	const media = useQuery({
		queryKey: ["gameMedia", universeId, "image-ids"],
		enabled,
		staleTime: 600_000,
		retry: false,
		queryFn: async () => (await gameMedia(universeId)).filter((m) => m.imageId).map((m) => String(m.imageId)),
	});
	const ids = new Set([...(pool.data?.ids ?? []), ...(media.data ?? [])]);
	/** The whole pool was read: a creative missing from `ids` isn't a homepage thumbnail. */
	const complete = !!pool.data && !pool.data.more && !!media.data;
	return { ids, loading: (canPool && pool.isLoading) || media.isLoading, complete };
}

/** Image URLs for asset ids, 16:9 (thumbnails v1 assets at 480x270): thumbnails and ad creatives. */
export function useWideAssetImages(assetIds: (number | null)[]) {
	const ids = Array.from(new Set(assetIds.filter((n): n is number => n !== null && n > 0))).sort((a, b) => a - b);
	return useQuery({ queryKey: ["assetThumbs", "480x270", ids.join(",")], queryFn: () => assetThumbs(ids, "480x270"), enabled: ids.length > 0, staleTime: 600_000, retry: false });
}
