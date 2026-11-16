/**
 * Group-level views that aren't one metric: the acquisition funnel (impressions -> clicks -> plays, as Creator Hub
 * draws it) and the cohort retention table (daily / weekly cohorts as a heatmap).
 */
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { Button, Card, Segmented, Skeleton, Txt } from "@/components/ui";
import { CloudError } from "@/features/project/CloudError";
import { fmtPct } from "@/lib/format";
import { useTheme } from "@/theme";

import { DAY, naturalCompare, normalizeRates, spanDays, timeRange, type RangeSpec } from "../analytics";
import { fmtValue, useMetric } from "./shared";

/** Unique users with an impression, a click and a play over the range (granularity None: Roblox's own uniques). */
export function AcquisitionFunnel({ universeId, range }: { universeId: number; range: RangeSpec }) {
	const p = useTheme();
	const tr = timeRange(range, {}, "None");
	const base = { granularity: "None" as const, startTime: tr.startTime, endTime: tr.endTime };
	const impressions = useMetric(universeId, { metric: "UniqueUsersWithImpressions", ...base });
	const clicks = useMetric(universeId, { metric: "UniqueUsersWithClicks", ...base });
	const plays = useMetric(universeId, { metric: "UniqueUsersWithPlaySessions", ...base });
	const value = (q: typeof impressions) => q.data?.[0]?.dataPoints[0]?.value ?? null;
	const steps = [
		{ label: "Saw the tile", q: impressions },
		{ label: "Clicked", q: clicks },
		{ label: "Played", q: plays },
	];
	const top = value(impressions) ?? 0;
	const error = steps.find((s) => s.q.error)?.q;
	return (
		<Card style={{ gap: 10 }}>
			<Txt style={{ fontWeight: "600" }}>Acquisition funnel</Txt>
			<Txt variant="small">Unique users at each step over the range.</Txt>
			{error ? <CloudError error={error.error} what="Acquisition funnel" onRetry={() => steps.forEach((s) => s.q.refetch())} /> : null}
			{steps.map((s, i) => {
				const v = value(s.q);
				const prev = i ? value(steps[i - 1]!.q) : null;
				return (
					<View key={s.label} style={{ gap: 4 }}>
						<View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
							<Txt variant="small" color={p.foreground}>
								{s.label}
							</Txt>
							{s.q.isLoading ? null : (
								<Txt variant="small" color={p.foreground}>
									{fmtValue("count", v)}
									{prev && v !== null ? `  ·  ${fmtPct(v / prev, 1)} of previous` : ""}
								</Txt>
							)}
						</View>
						{s.q.isLoading ? (
							<Skeleton height={10} />
						) : (
							<View style={{ height: 10, borderRadius: 4, backgroundColor: p.muted }}>
								<View style={{ height: 10, borderRadius: 4, width: `${top && v ? Math.min(100, (v / top) * 100) : 0}%`, backgroundColor: p.chart[i % p.chart.length] }} />
							</View>
						)}
					</View>
				);
			})}
			{top && value(plays) !== null ? <Txt variant="small">End to end: {fmtPct((value(plays) ?? 0) / top, 2)} of users who saw the tile played.</Txt> : null}
		</Card>
	);
}

const MAX_ROWS = 30;
const MAX_COLS = 31;

/** Cohort retention as a table: one row per cohort (start day / week), one column per day / week since. */
export function CohortTable({ universeId, range }: { universeId: number; range: RangeSpec }) {
	const p = useTheme();
	const [kind, setKind] = useState<"daily" | "weekly">("daily");
	const [show, setShow] = useState(false);
	const weekly = kind === "weekly";
	// A weekly table needs a few weeks; a daily one at least two weeks.
	const minDays = weekly ? 56 : 14;
	const effective: RangeSpec = spanDays(range) < minDays ? { kind: "preset", days: weekly ? 90 : 28 } : range;
	// The table shows the latest MAX_ROWS cohorts, so only those are asked for: less data, and a daily query never spans
	// the more than 2 years Roblox only takes weekly / monthly / total data for.
	const tr = timeRange(effective, {}, weekly ? "OneWeek" : "OneDay", { maxDays: weekly ? MAX_ROWS * 7 : MAX_ROWS });
	const q = useMetric(
		universeId,
		{ metric: weekly ? "WeeklyCohortRetention" : "DailyCohortRetention", granularity: weekly ? "OneWeek" : "OneDay", startTime: tr.startTime, endTime: tr.endTime, breakdown: [weekly ? "CohortWeek" : "CohortDay"] },
		show,
	);
	const series = q.data ? normalizeRates(q.data, "rate") : [];
	const cols = series
		.map((s) => ({ key: s.breakdowns[0]?.displayValue || s.breakdowns[0]?.value || "", s }))
		.sort((a, b) => naturalCompare(a.key, b.key))
		.slice(0, MAX_COLS);
	const times = Array.from(new Set(series.flatMap((s) => s.dataPoints.map((d) => d.time))))
		.sort((a, b) => Date.parse(b) - Date.parse(a))
		.slice(0, MAX_ROWS);
	const cell = new Map<string, number | null>();
	for (const c of cols) for (const d of c.s.dataPoints) cell.set(`${c.key}|${d.time}`, d.value);
	const max = Math.max(0.0001, ...[...cell.values()].map((v) => v ?? 0));
	const colLabel = (k: string) => (/^\d+$/.test(k) ? `${weekly ? "W" : "D"}${k}` : k);
	const W = 46;
	return (
		<Card style={{ gap: 10 }}>
			<Txt style={{ fontWeight: "600" }}>Cohort retention</Txt>
			<Txt variant="small">Each row is the users who first played that {weekly ? "week" : "day"}; each column, the share who came back {weekly ? "that many weeks" : "that many days"} later.</Txt>
			<Segmented
				options={[
					{ value: "daily", label: "Daily cohorts" },
					{ value: "weekly", label: "Weekly cohorts" },
				]}
				value={kind}
				onChange={setKind}
			/>
			{effective !== range ? <Txt variant="small">Shown over the last {weekly ? 90 : 28} days (the range is too short for cohorts).</Txt> : null}
			{!show ? <Button title="Load cohorts" icon="grid-outline" small onPress={() => setShow(true)} style={{ alignSelf: "flex-start" }} /> : null}
			{show && q.isLoading ? <Skeleton height={160} /> : null}
			{q.error ? <CloudError error={q.error} what="Cohort retention" onRetry={() => q.refetch()} /> : null}
			{q.data && !times.length ? <Txt variant="muted">No cohort data in this range.</Txt> : null}
			{times.length ? (
				<ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0 }} showsHorizontalScrollIndicator>
					<View style={{ gap: 2 }}>
						<View style={{ flexDirection: "row", gap: 2 }}>
							<View style={{ width: 64 }}>
								<Txt variant="label">Cohort</Txt>
							</View>
							{cols.map((c) => (
								<View key={c.key} style={{ width: W, alignItems: "center" }}>
									<Txt variant="label" numberOfLines={1}>
										{colLabel(c.key)}
									</Txt>
								</View>
							))}
						</View>
						{times.map((t) => (
							<View key={t} style={{ flexDirection: "row", gap: 2 }}>
								<View style={{ width: 64, justifyContent: "center" }}>
									<Txt variant="small">{new Date(Date.parse(t)).toISOString().slice(5, 10)}</Txt>
								</View>
								{cols.map((c) => {
									const v = cell.get(`${c.key}|${t}`);
									const has = v !== undefined && v !== null;
									return (
										<View
											key={c.key}
											style={{ width: W, height: 24, borderRadius: 3, alignItems: "center", justifyContent: "center", backgroundColor: has ? `${p.brand}${Math.round(25 + (v / max) * 200).toString(16).padStart(2, "0")}` : p.muted }}
										>
											<Txt variant="small" color={p.foreground} style={{ fontSize: 10 }}>
												{has ? fmtPct(v, v < 0.1 ? 1 : 0) : ""}
											</Txt>
										</View>
									);
								})}
							</View>
						))}
					</View>
				</ScrollView>
			) : null}
			{q.data && times.length ? (
				<Txt variant="small">
					Latest cohorts first{tr.endTime ? `, up to ${new Date(Date.parse(tr.endTime) - DAY).toISOString().slice(0, 10)}` : ""}
					{tr.clipped ? `; the last ${MAX_ROWS} ${weekly ? "weeks" : "days"} of the range` : ""}.
				</Txt>
			) : null}
		</Card>
	);
}
