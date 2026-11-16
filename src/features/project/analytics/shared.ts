/** Shared bits of the Analytics tab: value formatting and the cached, rate-limited query hooks. */
import { useQuery } from "@tanstack/react-query";

import { fmtBytes, fmtMetric, fmtSeconds } from "@/lib/format";
import { useAccounts } from "@/store/accounts";

import { analyticsSlot, type MetricFormat } from "../analytics";
import { queryDimensionValues, queryMetrics, type MetricQuery, type QueryFilter } from "../api/analytics-query";

/** A metric value in its unit (bytes and seconds on top of the app's metric formats). */
export function fmtValue(format: MetricFormat, v: number | null | undefined): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return "–";
	if (format === "bytes") return fmtBytes(v);
	if (format === "seconds") return v < 60 ? `${+v.toFixed(1)}s` : fmtSeconds(Math.round(v));
	return fmtMetric(format, v);
}

/** Answers cached an hour (Roblox recomputes analytics at most hourly); never retried on their own (rate limit). */
export const CACHE = { staleTime: 3600_000, gcTime: 3600_000, retry: false } as const;

/** One metric query through the app-wide analytics slot. */
export function useMetric(universeId: number, query: MetricQuery, enabled = true) {
	const { cloud } = useAccounts();
	return useQuery({
		queryKey: ["oc", "analytics", universeId, "metric", query],
		enabled: !!cloud && enabled,
		...CACHE,
		queryFn: ({ signal }) => analyticsSlot(() => queryMetrics(cloud!, universeId, query, { signal })),
	});
}

/** The values a dimension takes (pickers). BETA endpoint; same slot and cache. */
export function useDimensionValues(
	universeId: number,
	q: { metric: string; dimension: string; startTime: string; endTime: string; filter?: QueryFilter[] },
	enabled = true,
) {
	const { cloud } = useAccounts();
	return useQuery({
		queryKey: ["oc", "analytics", universeId, "dims", q],
		enabled: !!cloud && enabled,
		...CACHE,
		queryFn: async ({ signal }) => {
			const res = await analyticsSlot(() =>
				queryDimensionValues(cloud!, universeId, { metric: q.metric, dimensions: [q.dimension], startTime: q.startTime, endTime: q.endTime, filter: q.filter, limit: 200 }, { signal }),
			);
			return res.find((d) => d.dimension === q.dimension)?.values ?? res[0]?.values ?? [];
		},
	});
}
