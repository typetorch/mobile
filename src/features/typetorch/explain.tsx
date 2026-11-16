/**
 * "Explain this change" (web components/ExplainPanel.tsx): a sheet that breaks a metric's change (the filter bar's range
 * vs the period before, as the "vs previous period" chips compare) down by segment with the `explain` query. A
 * plain-language headline first, then per dimension a diverging chart of each segment's rate and mix effects and the
 * segments with both periods. A segment's name drills in: that segment split by the other dimensions (one level). The
 * metric lives in the route (`explain=d1`), so an explained view travels in "Copy link to this view".
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { previousPeriod } from "@/api/tt/compare";
import { DIMENSION_LABELS, EXPLAIN_METRIC_LABELS, EXPLAIN_METRICS, explainHeadline, fmtMetric, fmtSigned, rankDimensions, segmentName, segmentPhrase } from "@/api/tt/explain";
import type { ExplainDimension, ExplainMetric, ExplainResult, ExplainSegment, ExplainWithin } from "@/api/tt/types";
import { Badge, Button, Chips, Icon, Txt } from "@/components/ui";
import { Legend } from "@/charts/LineChart";
import { fmtInt, fmtPct, fmtTime } from "@/lib/format";
import { radius, space, useTheme } from "@/theme";

import { QueryState } from "./bits";
import { describeRange, useTTAnalytics, useTTFilters } from "./filters";
import { Sheet } from "./sheet";
import { usePageParam } from "./view-link";

export const EXPLAIN_PARAM = "explain";

/** The open panel's metric (from the route) and a setter ("" closes it). */
export function useExplain(): [ExplainMetric | "", (metric: ExplainMetric | "") => void] {
	const [value, set] = usePageParam(EXPLAIN_PARAM);
	const metric = (EXPLAIN_METRICS as string[]).includes(value) ? (value as ExplainMetric) : "";
	return [metric, set as (metric: ExplainMetric | "") => void];
}

/** The small "Why?" button next to a tile's change chip. */
export function ExplainButton({ metric, label }: { metric: ExplainMetric; label?: string }) {
	const p = useTheme();
	const [, open] = useExplain();
	return (
		<Pressable onPress={() => open(metric)} hitSlop={6} accessibilityLabel={`Explain this change${label ? `: ${label}` : ""}`} style={{ flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start" }}>
			<Icon name="bar-chart-outline" size={12} color={p.mutedForeground} />
			<Txt variant="small" style={{ fontSize: 11 }}>
				Why?
			</Txt>
		</Pressable>
	);
}

/** Each segment's rate and mix (or its whole change, for counts) as bars left / right of zero, stacked by sign. */
function ContributionChart({ data, dimension }: { data: ExplainResult; dimension: ExplainResult["dimensions"][number] }) {
	const p = useTheme();
	const count = data.kind === "count";
	const parts = (s: ExplainSegment) => (count ? [{ v: s.contribution, c: p.chart[0]! }] : [{ v: s.rate, c: p.chart[0]! }, { v: s.mix, c: p.chart[1]! }]);
	const max = Math.max(
		1e-9,
		...dimension.segments.flatMap((s) => {
			const ps = parts(s);
			return [ps.filter((x) => x.v > 0).reduce((a, x) => a + x.v, 0), -ps.filter((x) => x.v < 0).reduce((a, x) => a + x.v, 0)];
		}),
	);
	return (
		<View style={{ gap: 6 }}>
			{dimension.segments.map((s) => {
				const ps = parts(s);
				const pos = ps.filter((x) => x.v > 0);
				const neg = ps.filter((x) => x.v < 0);
				return (
					<View key={s.other ? "\u0000other" : (s.value ?? "\u0000null")} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
						<Txt variant="small" numberOfLines={1} style={{ width: 96, textAlign: "right" }}>
							{segmentName(dimension.dimension, s)}
						</Txt>
						<View style={{ flex: 1, flexDirection: "row", height: 14 }}>
							<View style={{ flex: 1, flexDirection: "row-reverse" }}>
								{neg.map((x, i) => (
									<View key={i} style={{ width: `${(-x.v / max) * 100}%`, backgroundColor: x.c, height: 14 }} />
								))}
							</View>
							<View style={{ width: 1, backgroundColor: p.border }} />
							<View style={{ flex: 1, flexDirection: "row" }}>
								{pos.map((x, i) => (
									<View key={i} style={{ width: `${(x.v / max) * 100}%`, backgroundColor: x.c, height: 14 }} />
								))}
							</View>
						</View>
					</View>
				);
			})}
			<Legend items={count ? [{ label: "Change", color: p.chart[0]! }] : [{ label: "Rate (the segment itself)", color: p.chart[0]! }, { label: "Mix (its share of players)", color: p.chart[1]! }]} />
		</View>
	);
}

/** The segments with both periods (the web's table, one block per segment on a phone). */
function SegmentList({ data, dimension, onDrill }: { data: ExplainResult; dimension: ExplainResult["dimensions"][number]; onDrill?: ((w: ExplainWithin) => void) | undefined }) {
	const p = useTheme();
	const ratio = data.kind === "ratio";
	const value = (v: number | null) => fmtMetric(data.unit, v);
	return (
		<View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md }}>
			{dimension.segments.map((s, i) => {
				const name = segmentName(dimension.dimension, s);
				const canDrill = onDrill && !s.other;
				return (
					<Pressable
						key={s.other ? "\u0000other" : (s.value ?? "\u0000null")}
						disabled={!canDrill}
						onPress={() => onDrill?.({ dimension: dimension.dimension, value: s.value })}
						style={({ pressed }) => [{ padding: space.sm, gap: 2, borderTopWidth: i ? 1 : 0, borderColor: p.border }, pressed && { backgroundColor: p.accent }]}
					>
						<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
							<Txt style={{ flex: 1, fontWeight: "600" }} color={s.other || s.value === null ? p.mutedForeground : canDrill ? p.brand : p.foreground} numberOfLines={1}>
								{name}
							</Txt>
							{s.small ? <Badge label="few players" /> : null}
							<Txt style={{ fontWeight: "600" }}>{fmtSigned(data.unit, s.contribution)}</Txt>
						</View>
						<Txt variant="small">
							Players {fmtInt(s.baseline.players)} → {fmtInt(s.current.players)}
							{ratio ? ` (${fmtPct(s.baseline.share, 0)} → ${fmtPct(s.current.share, 0)})` : ""} · {value(s.baseline.value)} → {value(s.current.value)}
						</Txt>
						<Txt variant="small">
							{ratio ? `Rate ${fmtSigned(data.unit, s.rate)} · Mix ${fmtSigned(data.unit, s.mix)}` : ""}
							{ratio && s.shareOfChange !== null ? " · " : ""}
							{s.shareOfChange !== null ? `${fmtPct(s.shareOfChange, 0)} of the change` : ""}
						</Txt>
					</Pressable>
				);
			})}
			{onDrill ? (
				<Txt variant="small" style={{ padding: space.sm }}>
					Tap a segment to split it by the other dimensions. Few players: fewer than {data.minPlayers} in one of the periods, don't trust that row much.
				</Txt>
			) : null}
		</View>
	);
}

/** The answer: headline, both periods, then one dimension's chart and segments (the most telling dimension first). */
export function ExplainView({ data, onDrill }: { data: ExplainResult; onDrill?: (w: ExplainWithin) => void }) {
	const p = useTheme();
	const ranked = useMemo(() => rankDimensions(data), [data]);
	const [picked, setPicked] = useState<ExplainDimension | undefined>(undefined);
	const dimension = ranked.find((d) => d.dimension === picked) ?? ranked[0];
	if (!dimension) return <Txt variant="muted">No segments.</Txt>;
	return (
		<View style={{ gap: space.md }}>
			<Txt style={{ fontWeight: "600" }}>{explainHeadline(data)}</Txt>
			<View style={{ flexDirection: "row", gap: space.sm }}>
				{(["baseline", "current"] as const).map((w) => (
					<View key={w} style={{ flex: 1, borderWidth: 1, borderColor: p.border, borderRadius: radius.md, padding: space.sm, gap: 2 }}>
						<Txt variant="small">{w === "baseline" ? "Before" : "Now"}</Txt>
						<Txt variant="h3">{fmtMetric(data.unit, data[w].value)}</Txt>
						<Txt variant="small">
							{fmtTime(data[w].from).slice(0, 16)} – {fmtTime(data[w].to).slice(0, 16)} UTC · {fmtInt(data[w].players)} players
						</Txt>
					</View>
				))}
			</View>
			<Txt variant="small">Split by</Txt>
			<Chips options={ranked.map((d) => ({ value: d.dimension, label: DIMENSION_LABELS[d.dimension] }))} value={dimension.dimension} onChange={setPicked} />
			<Txt variant="small">
				{data.kind === "ratio"
					? "Rate: the segment itself got better or worse. Mix: its share of players changed (a bigger share only helps when it is above average)."
					: "Each segment's own change; they add up to the total."}
			</Txt>
			<ContributionChart data={data} dimension={dimension} />
			<SegmentList data={data} dimension={dimension} onDrill={onDrill} />
		</View>
	);
}

/** The sheet itself; put it once on a page that has "Why?" buttons (it opens when `explain=` is in the route). */
export function ExplainPanel({ backendId }: { backendId: string }) {
	const [metric, setMetric] = useExplain();
	const { state } = useTTFilters(backendId);
	const period = useMemo(() => previousPeriod(state), [state]);
	const [within, setWithin] = useState<ExplainWithin | null>(null);
	useEffect(() => setWithin(null), [metric]);
	const open = metric !== "";
	const options = { metric: metric || "players", ...(period ? { baseline: { from: period.filters.from, to: period.filters.to } } : {}), ...(within ? { within } : {}) };
	const q = useTTAnalytics(backendId, "explain", options, { enabled: open && period !== undefined });
	const range = describeRange(state);
	return (
		<Sheet open={open} onClose={() => setMetric("")} title="Explain this change" subtitle={`${range.replace(/^./, (c) => c.toUpperCase())} against the period before, of the same length, under the filter bar's filters.`}>
			<Chips options={EXPLAIN_METRICS.map((m) => ({ value: m, label: EXPLAIN_METRIC_LABELS[m] }))} value={metric || "players"} onChange={(m) => setMetric(m)} />
			{within ? (
				<View style={{ gap: 4 }}>
					<Button title="All players" small variant="ghost" icon="arrow-back" onPress={() => setWithin(null)} style={{ alignSelf: "flex-start" }} />
					<Txt variant="small">
						Only {segmentPhrase(within.dimension, { value: within.value })} ({DIMENSION_LABELS[within.dimension]}), split by the other dimensions.
					</Txt>
				</View>
			) : null}
			{period === undefined ? (
				<Txt variant="muted">Pick a start date in the filter bar: there is no period before to compare with.</Txt>
			) : (
				<QueryState q={q} rows={6}>
					{(data) => <ExplainView key={`${data.metric}:${within?.dimension ?? ""}:${within?.value ?? ""}`} data={data} {...(within ? {} : { onDrill: setWithin })} />}
				</QueryState>
			)}
		</Sheet>
	);
}
