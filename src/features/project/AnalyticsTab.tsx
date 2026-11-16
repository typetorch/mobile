/**
 * Creator Hub's analytics for any universe the key has `universe.analytics:read` on: a group per Creator Hub page
 * (engagement, retention, monetization, acquisition, performance, economy, funnels, journeys, custom events,
 * observability, benchmarks, ...), each card its own Analytics Query API query (cached for an hour), with a shared
 * range and granularity, and per-card breakdowns, variants and filters. Only the first cards of the open group load
 * by themselves (Roblox allows 30 queries a minute per key owner).
 */
import { useState } from "react";
import { View } from "react-native";

import { ANALYTICS_READ_SCOPE, hasScope } from "@/api/opencloud";
import { Chips, ScopeNotice, Txt } from "@/components/ui";
import { useAccounts } from "@/store/accounts";

import { DAY, METRIC_GROUPS, timeRange, type GranularityChoice, type RangeSpec } from "./analytics";
import type { QueryFilter } from "./api/analytics-query";
import { Benchmarks } from "./analytics/Benchmarks";
import { Compare } from "./analytics/Compare";
import { MetricCard } from "./analytics/MetricCard";
import { GranularityControls, GroupPick, RangeControls } from "./analytics/options";
import { AcquisitionFunnel, CohortTable } from "./analytics/views";

/** Cards per group that load without a tap. */
const AUTO_LOAD = 4;

export function AnalyticsTab({ universeId }: { universeId: number }) {
	const { keyInfo, hasKey } = useAccounts();
	const [range, setRange] = useState<RangeSpec>({ kind: "preset", days: 28 });
	const [granularity, setGranularity] = useState<GranularityChoice>("Auto");
	const [groupKey, setGroupKey] = useState(METRIC_GROUPS[0]!.key);
	const [picks, setPicks] = useState<Record<string, string | null>>({});
	if (!hasKey || !hasScope(keyInfo, ANALYTICS_READ_SCOPE, universeId)) return <ScopeNotice what="Analytics" scopes={[ANALYTICS_READ_SCOPE]} />;

	const group = METRIC_GROUPS.find((g) => g.key === groupKey) ?? METRIC_GROUPS[0]!;
	const views = group.views ?? [];
	const pick = group.pick;
	const picked = pick ? (picks[group.key] ?? null) : null;
	const groupFilter: QueryFilter | null = pick && picked !== null ? { dimension: pick.dimension, operation: "In", values: [picked] } : null;
	const waiting = pick?.required && picked === null ? `Pick a ${pick.label.toLowerCase()} above.` : null;
	const pickRange = timeRange(range, {}, "OneDay");
	const custom = range.kind === "custom";

	return (
		<View style={{ gap: 12 }}>
			<RangeControls range={range} onChange={setRange} />
			{views.includes("benchmarks") || views.includes("compare") ? null : <GranularityControls value={granularity} onChange={setGranularity} />}
			<Chips options={METRIC_GROUPS.map((g) => ({ value: g.key, label: g.title }))} value={group.key} onChange={setGroupKey} />
			{group.help ? <Txt variant="small">{group.help}</Txt> : null}

			{pick ? (
				<GroupPick
					key={group.key}
					universeId={universeId}
					metric={pick.metric}
					dimension={pick.dimension}
					label={pick.label}
					required={pick.required}
					startTime={pickRange.startTime}
					endTime={pickRange.endTime}
					value={picked}
					onChange={(v) => setPicks((cur) => ({ ...cur, [group.key]: v }))}
				/>
			) : null}

			{views.includes("acquisitionFunnel") ? <AcquisitionFunnel universeId={universeId} range={range} /> : null}
			{views.includes("cohorts") ? <CohortTable universeId={universeId} range={range} /> : null}
			{views.includes("benchmarks") ? <Benchmarks universeId={universeId} range={range} /> : null}
			{views.includes("compare") ? <Compare universeId={universeId} range={range} /> : null}

			{group.metrics.map((m, i) => (
				<MetricCard
					key={`${group.key}:${m.key ?? m.id}`}
					universeId={universeId}
					metric={m}
					range={range}
					granularity={granularity}
					groupFilter={groupFilter}
					autoLoad={i < AUTO_LOAD - (views.includes("acquisitionFunnel") ? 2 : 0)}
					waiting={waiting}
				/>
			))}

			<Txt variant="small" style={{ textAlign: "center" }}>
				{custom ? `${range.start} to ${range.end} (UTC)` : `Up to ${new Date(Math.floor(Date.now() / DAY) * DAY).toISOString().slice(0, 10)} (UTC; finer than daily: up to the last half hour)`} · Roblox Analytics Query
				API · cached for an hour · 30 queries a minute
			</Txt>
		</View>
	);
}
