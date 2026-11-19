/**
 * Sponsored Ads reporting (Ads Manager's table): impressions, clicks and spend from the Analytics Query API's
 * SponsoredAdsImpressions / SponsoredAdsClicks / SponsoredAdsSpendUsd (create.roblox.com/docs/cloud/guides/advertising
 * "Report on performance"), per ad (AdId = the id from GET /campaigns/{id}/ads) or per campaign (CampaignId). CTR and
 * CPC are computed here. Roblox reports clicks, not plays: the Plays column of Ads Manager has no API.
 *
 * Each view is three queries (one per metric), hourly over the range (≤ 31 days at OneHour), whole hours, broken down
 * by AdId or CampaignId: the totals and the per-day trend both come from the same answers. They go through the
 * app-wide analytics slot and cache (an hour) like every other analytics query. Needs universe.analytics:read.
 */
import { ANALYTICS_READ_SCOPE, hasScope } from "@/api/opencloud";
import { useAccounts } from "@/store/accounts";

import type { MetricQuery, MetricSeries, QueryFilter } from "../api/analytics-query";
import { useMetric } from "../analytics/shared";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type AdRange = 1 | 7 | 28;
export const AD_RANGES: { value: AdRange; label: string }[] = [
	{ value: 1, label: "24 hours" },
	{ value: 7, label: "7 days" },
	{ value: 28, label: "28 days" },
];

export interface AdNumbers {
	impressions: number | null;
	clicks: number | null;
	/** USD. */
	spend: number | null;
}

export interface AdPoint extends AdNumbers {
	/** The bucket's start (a UTC day, or an hour over 24 hours). */
	t: number;
}

export const ctr = (n: AdNumbers) => (n.impressions && n.clicks !== null ? n.clicks / n.impressions : null);
export const cpc = (n: AdNumbers) => (n.clicks && n.spend !== null ? n.spend / n.clicks : null);

/** The [start, end) of the last `days` days in whole hours (the current hour is still filling, so it's left out). */
function hourRange(days: number, now = Date.now()) {
	const end = Math.floor(now / HOUR) * HOUR;
	return { startTime: new Date(end - days * DAY).toISOString(), endTime: new Date(end).toISOString() };
}

function query(metric: string, days: number, by: "AdId" | "CampaignId", filter: QueryFilter[]): MetricQuery {
	return { metric, granularity: "OneHour", ...hourRange(days), breakdown: [by], ...(filter.length ? { filter } : {}) };
}

const KEYS = ["impressions", "clicks", "spend"] as const;
const METRICS: Record<(typeof KEYS)[number], string> = { impressions: "SponsoredAdsImpressions", clicks: "SponsoredAdsClicks", spend: "SponsoredAdsSpendUsd" };

const empty = (): AdNumbers => ({ impressions: null, clicks: null, spend: null });
const add = (a: number | null, b: number | null) => (b === null || !Number.isFinite(b) ? a : (a ?? 0) + b);

/** Totals per breakdown value and the trend over all of them, from the three metrics' answers. */
export function mergeAdReport(data: Partial<Record<(typeof KEYS)[number], MetricSeries[]>>, by: string, bucketMs: number) {
	const rows = new Map<string, AdNumbers>();
	const buckets = new Map<number, AdPoint>();
	const totals = empty();
	for (const key of KEYS) {
		for (const s of data[key] ?? []) {
			const id = s.breakdowns.find((b) => b.dimension === by)?.value ?? s.breakdowns[0]?.value;
			if (!id) continue;
			const row = rows.get(id) ?? empty();
			for (const pt of s.dataPoints) {
				const v = pt.value;
				if (v === null || !Number.isFinite(v)) continue;
				row[key] = add(row[key], v);
				totals[key] = add(totals[key], v);
				const t = Math.floor(Date.parse(pt.time) / bucketMs) * bucketMs;
				const b = buckets.get(t) ?? { t, ...empty() };
				b[key] = add(b[key], v);
				buckets.set(t, b);
			}
			rows.set(id, row);
		}
	}
	// A metric that answered counts as 0 where it had no value (no impressions that day), not as unknown.
	for (const key of KEYS) {
		if (!data[key]) continue;
		totals[key] ??= 0;
		for (const r of rows.values()) r[key] ??= 0;
		for (const b of buckets.values()) b[key] ??= 0;
	}
	return { rows, totals, trend: [...buckets.values()].sort((a, b) => a.t - b.t) };
}

/**
 * The report for one campaign's ads (`campaignId`) or for every campaign of the experience (no id: per CampaignId).
 * `universeId` is the advertised experience (the analytics belong to it).
 */
export function useAdReport(universeId: number, days: AdRange, campaignId?: string, enabled = true) {
	const { keyInfo } = useAccounts();
	const can = hasScope(keyInfo, ANALYTICS_READ_SCOPE, universeId);
	const on = can && enabled && universeId > 0;
	const by = campaignId ? "AdId" : "CampaignId";
	const filter: QueryFilter[] = campaignId ? [{ dimension: "CampaignId", operation: "In", values: [campaignId] }] : [];
	const qi = useMetric(universeId, query(METRICS.impressions, days, by, filter), on);
	const qc = useMetric(universeId, query(METRICS.clicks, days, by, filter), on);
	const qs = useMetric(universeId, query(METRICS.spend, days, by, filter), on);
	const merged = mergeAdReport({ impressions: qi.data, clicks: qc.data, spend: qs.data }, by, days <= 1 ? HOUR : DAY);
	return {
		can,
		...merged,
		loading: on && (qi.isPending || qc.isPending || qs.isPending),
		error: qi.error ?? qc.error ?? qs.error ?? null,
		refetch: () => void Promise.all([qi.refetch(), qc.refetch(), qs.refetch()]),
	};
}
