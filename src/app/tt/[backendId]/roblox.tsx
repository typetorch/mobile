/**
 * Roblox: Creator Hub's experience overview from your own events (query `benchmarks`): benchmark cards (period over
 * period, against the 50th / 90th you copy from Creator Hub, kept on this phone), realtime (`realtime` + the live fleet),
 * acquisition from Roblox itself (GET /v1/roblox/analytics/acquisition), 7-day moving averages per join source (`trends`)
 * and how the numbers are calculated. The filter bar's date range doesn't apply; its other filters do.
 */
import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { ApiError } from "@/api/backend";
import { barMax, change, estimatePercentile, loadBenchmarks, type Benchmark, type BenchmarkKey, type Benchmarks } from "@/api/tt/benchmarks";
import type { BenchmarkPeriod, Filters, RobloxAcquisition, RobloxAcquisitionPeriod, TrendValues } from "@/api/tt/types";
import { LineChart } from "@/charts/LineChart";
import { Badge, Button, Card, Chips, EmptyState, Field, Icon, List, Segmented, Txt } from "@/components/ui";
import { ChangeChip, MiniTable, Note, Panel, QueryState } from "@/features/typetorch/bits";
import { FilterBar, isoDate, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { BENCHMARK_ROWS, CALCULATION_NOTES, CARDS, JOIN_SOURCES_DIFFER, ordinal, periodLabel, SOURCE_COLORS, SOURCE_LABELS, sub, TRENDS, type CardSpec, type Differs } from "@/features/typetorch/roblox-cards";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtInt, fmtMinutes, fmtNum, fmtPct } from "@/lib/format";
import { radius, space, useTheme } from "@/theme";

export default function RobloxScreen() {
	return <TTScreen title="Roblox overview">{({ backendId }) => <Roblox backendId={backendId} />}</TTScreen>;
}

// Benchmarks on this phone (the web keeps them in the browser) -------------------------------------------------------

const benchKey = (backendId: string) => `tt-bench-${backendId.replace(/[^A-Za-z0-9._-]/g, "_")}`;

function useBenchmarks(backendId: string): [Benchmarks, (b: Benchmarks) => void] {
	const [bench, setBench] = useState<Benchmarks>({});
	useEffect(() => {
		let live = true;
		SecureStore.getItemAsync(benchKey(backendId))
			.then((raw) => {
				if (live && raw) setBench(loadBenchmarks({ getItem: () => raw }));
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [backendId]);
	const save = (next: Benchmarks) => {
		setBench(next);
		SecureStore.setItemAsync(benchKey(backendId), JSON.stringify(next)).catch(() => undefined);
	};
	return [bench, save];
}

/** The filter bar's filters without its date range (these sections have their own). */
function useNoRange(backendId: string): Filters {
	const { apiFilters } = useTTFilters(backendId);
	return useMemo(() => {
		const { from: _from, to: _to, ...rest } = apiFilters;
		return rest;
	}, [apiFilters]);
}

function Roblox({ backendId }: { backendId: string }) {
	const filters = useNoRange(backendId);
	const [days, setDays] = useState(7);
	const [bench, saveBench] = useBenchmarks(backendId);
	const [editing, setEditing] = useState(false);
	const q = useTTAnalytics(backendId, "benchmarks", { days }, { filters });
	return (
		<>
			<FilterBar backendId={backendId} ranges={[]} />
			<Note>Creator Hub's overview, from your own events and computed the way Creator Hub defines it: the last {days} full UTC days against the {days} days before.</Note>
			<View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
				<Segmented
					options={[7, 14, 28].map((d) => ({ value: d, label: `${d} days` }))}
					value={days}
					onChange={setDays}
					style={{ flex: 1 }}
				/>
				<Button title="Benchmarks" small icon="options-outline" variant={editing ? "brand" : "secondary"} onPress={() => setEditing((e) => !e)} />
			</View>
			{editing ? <BenchmarkEditor value={bench} onSave={saveBench} onClose={() => setEditing(false)} /> : null}
			<QueryState q={q} rows={4}>
				{(r) =>
					r.current.players === 0 && r.previous.players === 0 ? (
						<EmptyState title={`No players in the last ${2 * days} days.`} />
					) : (
						<View style={{ gap: space.sm }}>
							<Note>
								{periodLabel(r.current)} vs {periodLabel(r.previous)}
							</Note>
							{CARDS.map((spec) => (
								<BenchmarkCard key={spec.id} spec={spec} current={r.current} previous={r.previous} {...(spec.key && bench[spec.key] ? { bench: bench[spec.key] as Benchmark } : {})} onSet={() => setEditing(true)} />
							))}
							<Note>No genre benchmarks here: the percentile marker is estimated from the 50th and 90th you type in, by straight lines between them.</Note>
						</View>
					)
				}
			</QueryState>
			<Realtime backendId={backendId} filters={filters} />
			<Acquisition backendId={backendId} days={days} {...(bench.playThrough ? { bench: bench.playThrough } : {})} onSet={() => setEditing(true)} />
			<Trends backendId={backendId} filters={filters} />
			<HowCalculated />
		</>
	);
}

// Cards -----------------------------------------------------------------------------------------------------------------

/** A tap shows the text of an info or "differs" tip under the card (the web's hover tooltips). */
function Tip({ label, text }: { label: string; text: string }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	return (
		<View style={{ gap: 4 }}>
			<Pressable onPress={() => setOpen((o) => !o)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
				<Icon name={open ? "chevron-down" : "information-circle-outline"} size={13} color={p.mutedForeground} />
				<Txt variant="small">{label}</Txt>
			</Pressable>
			{open ? <Txt variant="small">{text}</Txt> : null}
		</View>
	);
}

function DiffersBadge({ differs }: { differs: Differs }) {
	return <Badge label={differs.label} />;
}

function BenchmarkBar({ value, bench, onSet }: { value: number | null; bench?: Benchmark | undefined; onSet(): void }) {
	const p = useTheme();
	if (value === null) return <View style={{ height: 6, borderRadius: 3, backgroundColor: p.muted }} />;
	const max = barMax(value, bench);
	const at = (v: number) => `${Math.min(100, (v / max) * 100)}%` as const;
	const percentile = bench ? estimatePercentile(value, bench) : null;
	return (
		<View style={{ gap: 4 }}>
			<View style={{ height: 6, borderRadius: 3, backgroundColor: p.muted }}>
				<View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: at(value), borderRadius: 3, backgroundColor: p.chart[0] }} />
				{bench ? [bench.p50, bench.p90].map((v, i) => <View key={i} style={{ position: "absolute", top: -4, height: 14, width: 2, left: at(v), backgroundColor: p.foreground, opacity: 0.7 }} />) : null}
			</View>
			{bench ? (
				<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
					<Txt variant="small" style={{ fontSize: 11 }}>
						50th {fmtNum(bench.p50)} · 90th {fmtNum(bench.p90)}
					</Txt>
					<Txt variant="small" style={{ fontSize: 11 }}>
						{percentile === null ? "" : `est. ~${ordinal(percentile)} percentile`}
					</Txt>
				</View>
			) : (
				<Pressable onPress={onSet} hitSlop={6}>
					<Txt variant="small" style={{ fontSize: 11, textDecorationLine: "underline" }}>
						set benchmarks
					</Txt>
				</Pressable>
			)}
		</View>
	);
}

function BenchmarkCard({ spec, current, previous, bench, onSet }: { spec: CardSpec; current: BenchmarkPeriod; previous: BenchmarkPeriod; bench?: Benchmark; onSet(): void }) {
	const p = useTheme();
	const value = spec.value(current);
	return (
		<Card style={{ gap: 6 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
				<Txt variant="label" style={{ flex: 1 }}>
					{spec.title}
				</Txt>
				{spec.differs ? <DiffersBadge differs={spec.differs} /> : null}
			</View>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Txt variant="h2" color={value === null ? p.mutedForeground : undefined}>
					{value === null ? "n/a" : spec.format(value)}
				</Txt>
				<ChangeChip change={change(value, spec.value(previous))} />
			</View>
			<Txt variant="small">{sub(spec, current)}</Txt>
			{spec.key === null ? null : <BenchmarkBar value={value} bench={bench} onSet={onSet} />}
			<Tip label="What this is" text={spec.info} />
			{spec.differs ? <Tip label={`${spec.differs.label}: how it differs from Creator Hub`} text={spec.differs.why} /> : null}
		</Card>
	);
}

function BenchmarkEditor({ value, onSave, onClose }: { value: Benchmarks; onSave(b: Benchmarks): void; onClose(): void }) {
	const [draft, setDraft] = useState<Record<string, { p50: string; p90: string }>>(() => Object.fromEntries(BENCHMARK_ROWS.map((c) => [c.key, { p50: value[c.key]?.p50?.toString() ?? "", p90: value[c.key]?.p90?.toString() ?? "" }])));
	const save = () => {
		const out: Benchmarks = {};
		for (const c of BENCHMARK_ROWS) {
			const p50 = Number.parseFloat(draft[c.key]?.p50 ?? "");
			const p90 = Number.parseFloat(draft[c.key]?.p90 ?? "");
			if (Number.isFinite(p50) && Number.isFinite(p90) && p50 > 0 && p90 > 0) out[c.key as BenchmarkKey] = { p50, p90 };
		}
		onSave(out);
		onClose();
	};
	const set = (key: string, k: "p50" | "p90", text: string) => setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? { p50: "", p90: "" }), [k]: text } }));
	return (
		<Panel title="Benchmarks" note="Copy the 50th and 90th percentile from your Creator Hub overview. Kept on this phone only, per backend.">
			{BENCHMARK_ROWS.map((c) => (
				<View key={c.key} style={{ gap: 4 }}>
					<Txt variant="small">
						{c.title} ({c.unit})
					</Txt>
					<View style={{ flexDirection: "row", gap: space.sm }}>
						<View style={{ flex: 1 }}>
							<Field placeholder="50th" keyboardType="decimal-pad" value={draft[c.key]?.p50 ?? ""} onChangeText={(t) => set(c.key, "p50", t)} />
						</View>
						<View style={{ flex: 1 }}>
							<Field placeholder="90th" keyboardType="decimal-pad" value={draft[c.key]?.p90 ?? ""} onChangeText={(t) => set(c.key, "p90", t)} />
						</View>
					</View>
				</View>
			))}
			<View style={{ flexDirection: "row", gap: space.sm, justifyContent: "flex-end" }}>
				<Button title="Clear" small variant="ghost" onPress={() => setDraft(Object.fromEntries(BENCHMARK_ROWS.map((c) => [c.key, { p50: "", p90: "" }])))} />
				<Button title="Save" small variant="brand" onPress={save} />
			</View>
		</Panel>
	);
}

// Realtime --------------------------------------------------------------------------------------------------------------

function RealtimeRow({ label, info, value, current, previous, lowerIsBetter = false }: { label: string; info: string; value: string; current: number | null; previous: number | null; lowerIsBetter?: boolean }) {
	return (
		<View style={{ paddingVertical: 8, paddingHorizontal: space.md, gap: 4 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Txt variant="muted" style={{ flex: 1 }}>
					{label}
				</Txt>
				<Txt style={{ fontWeight: "600" }}>{value}</Txt>
				<ChangeChip change={change(current, previous, lowerIsBetter)} />
			</View>
			<Tip label="What this is" text={info} />
		</View>
	);
}

function Realtime({ backendId, filters }: { backendId: string; filters: Filters }) {
	const p = useTheme();
	const q = useTTAnalytics(backendId, "realtime", { hours: 24, ccuDays: 7 }, { filters });
	const branch = typeof filters.branch === "string" ? filters.branch : undefined;
	const live = useTTQuery(backendId, ["fleet", "servers", branch ?? ""], (api, s) => api.fleetServers(branch, s), { refetchInterval: 30_000 });
	return (
		<Panel title="Realtime" note="Last 24 hours vs the 24 before.">
			<QueryState q={q} rows={4}>
				{(r) => {
					const now = live.data?.players ?? r.ccu.now;
					const hasCcu = r.ccu.series.some((x) => x.peak > 0);
					return (
						<View style={{ gap: space.sm }}>
							<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
								<Txt variant="muted" style={{ flex: 1 }}>
									Concurrent users
								</Txt>
								<Badge label="Estimate" />
								<ChangeChip change={change(r.ccu.currentPeak, r.ccu.previousPeak)} />
							</View>
							<Txt variant="title">{fmtInt(now)}</Txt>
							{hasCcu ? (
								<LineChart
									area={false}
									height={110}
									series={[
										{ label: "Peak", points: r.ccu.series.map((x) => ({ t: Date.parse(x.hour), v: x.peak })), color: p.chart[0] },
										{ label: "Hourly average", points: r.ccu.series.map((x) => ({ t: Date.parse(x.hour), v: x.avg })), color: p.chart[1] },
									]}
									timeLabel={(t) => new Date(t).toISOString().slice(5, 13).replace("T", " ")}
								/>
							) : (
								<Note>No heartbeats with players in 7 days.</Note>
							)}
							<Tip
								label="What this is"
								text="Players on live servers now (fleet API). The line is each UTC hour's peak minute over 7 days, as Creator Hub's peak concurrent players (and the hourly average), from the servers' heartbeats: players per minute, summed over servers. Studio play tests don't count. An estimate: a heartbeat is about once a minute per server."
							/>
							<List>
								<RealtimeRow label="Peak concurrent users" info="The highest minute of the last 24 h (Creator Hub's peak concurrent players), from the servers' heartbeats." value={fmtInt(r.ccu.currentPeak)} current={r.ccu.currentPeak} previous={r.ccu.previousPeak} />
								<RealtimeRow label="Average concurrent users" info="The mean of the last 24 h's per-minute player counts (Creator Hub's average concurrent players); minutes without a heartbeat count as 0." value={fmtNum(r.ccu.currentAvg, 1)} current={r.ccu.currentAvg} previous={r.ccu.previousAvg} />
								<RealtimeRow label="Session time" info="Average length of the sessions that started in the window and are over (first to last event; Studio play tests left out)." value={r.current.avgSessionMinutes === null ? "n/a" : fmtMinutes(r.current.avgSessionMinutes)} current={r.current.avgSessionMinutes} previous={r.previous.avgSessionMinutes} />
								<RealtimeRow label="Client error rate" info="Script errors clients reported (tech/error) per session. Games can't see crashes, so this is errors, not crashes." value={r.current.errorsPerSession === null ? "n/a" : `${fmtNum(r.current.errorsPerSession, 2)} / session`} current={r.current.errorsPerSession} previous={r.previous.errorsPerSession} lowerIsBetter />
								<RealtimeRow label="Client frame rate" info="Average of the fps clients report every minute (tech/client)." value={r.current.clientFps === null ? "n/a" : `${fmtNum(r.current.clientFps, 0)} fps`} current={r.current.clientFps} previous={r.previous.clientFps} />
								<RealtimeRow label="Server memory" info="Average of the memory servers report every minute (tech/server, MB)." value={r.current.serverMemoryMb === null ? "n/a" : `${fmtInt(r.current.serverMemoryMb)} MB`} current={r.current.serverMemoryMb} previous={r.previous.serverMemoryMb} lowerIsBetter />
							</List>
							<Note>{fmtInt(r.current.sessions)} sessions in the last 24 h.</Note>
						</View>
					);
				}}
			</QueryState>
		</Panel>
	);
}

// Acquisition, from Roblox ------------------------------------------------------------------------------------------------

const ANALYTICS_SCOPE = "universe.analytics:read";
const pct = (v: number | null) => (v === null ? null : v * 100);
const ACQUISITION_CARDS: { key: "playThroughHome" | "qualifiedPlayThrough" | "impressions" | "qualifiedPlays"; title: string; value(p: RobloxAcquisitionPeriod): number | null; format(v: number): string; info: string }[] = [
	{ key: "playThroughHome", title: "Play-through rate (home recommendations)", value: (p) => pct(p.playThroughHome), format: (v) => `${fmtNum(v, 2)}%`, info: "Roblox's RFYPlayThroughRate: the share of users shown the game in Home's recommendations who went on to play, per day, averaged over the period's days (Creator Hub's PTR chart)." },
	{ key: "qualifiedPlayThrough", title: "Qualified play-through rate", value: (p) => pct(p.qualifiedPlayThrough), format: (v) => `${fmtNum(v, 2)}%`, info: "Roblox's QualifiedEndToEndCVR: the share of users with an impression, from every source, who went on to a qualified play (intentional engagement, not a bounce), per day, averaged over the period's days." },
	{ key: "impressions", title: "Users with impressions", value: (p) => p.impressions, format: (v) => fmtInt(v), info: "Roblox's UniqueUsersWithImpressions: users who saw the game's tile on Home, Search, Charts or elsewhere, unique per day, summed over the period's days." },
	{ key: "qualifiedPlays", title: "Users with qualified plays", value: (p) => p.qualifiedPlays, format: (v) => fmtInt(v), info: "Roblox's QualifiedUniqueUsersWithPlaySessions: users with a qualified play after an impression, unique per day, summed over the period's days." },
];

function Acquisition({ backendId, days, bench, onSet }: { backendId: string; days: number; bench?: Benchmark; onSet(): void }) {
	const q = useTTQuery(backendId, ["roblox", "acquisition", days], (api, s) => api.robloxAcquisition(days, s), { staleTime: 300_000, retry: false });
	const off = q.error instanceof ApiError && q.error.status === 409;
	return (
		<Panel title="Acquisition, from Roblox" note={`Creator Hub's play-through rate and its parts, read from Roblox's Analytics Query API (the game can't see impressions): the last ${days} full UTC days against the ${days} days before. The filter bar doesn't apply. Cached an hour.`}>
			{off ? (
				<Note>
					Off: give OPENCLOUD_API_KEY the {ANALYTICS_SCOPE} scope on the game and set TYPETORCH_UNIVERSE_ID, then restart the backend.
				</Note>
			) : (
				<QueryState q={q} rows={2}>
					{(r) => <AcquisitionBody r={r} bench={bench} onSet={onSet} />}
				</QueryState>
			)}
		</Panel>
	);
}

function AcquisitionBody({ r, bench, onSet }: { r: RobloxAcquisition; bench?: Benchmark | undefined; onSet(): void }) {
	const p = useTheme();
	if (r.current.daysWithData === 0 && r.previous.daysWithData === 0) return <Txt variant="muted">Roblox has no acquisition data for the last {2 * r.days} days.</Txt>;
	return (
		<View style={{ gap: space.sm }}>
			{ACQUISITION_CARDS.map((spec) => {
				const value = spec.value(r.current);
				const missing = r.current.daysWithData < r.days ? `${r.current.daysWithData} of ${r.days} days have data` : null;
				return (
					<View key={spec.key} style={{ gap: 4, borderWidth: 1, borderColor: p.border, borderRadius: radius.md, padding: 10 }}>
						<Txt variant="label">{spec.title}</Txt>
						<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
							<Txt variant="h2" color={value === null ? p.mutedForeground : undefined}>
								{value === null ? "n/a" : spec.format(value)}
							</Txt>
							<ChangeChip change={change(value, spec.value(r.previous))} />
						</View>
						{spec.key === "playThroughHome" ? <BenchmarkBar value={value} bench={bench} onSet={onSet} /> : null}
						<Txt variant="small" style={{ fontSize: 11 }}>
							{missing ?? `Roblox's ${r.metrics[spec.key]}`}
						</Txt>
						<Tip label="What this is" text={spec.info} />
					</View>
				);
			})}
			{r.sources.length ? (
				<MiniTable
					columns={[
						{ key: "source", header: "Source", width: 130, render: (s) => s.label },
						{ key: "imp", header: "Users with impressions", width: 96, align: "right", render: (s) => fmtInt(s.impressions) },
						{ key: "qp", header: "Users with qualified plays", width: 96, align: "right", render: (s) => fmtInt(s.qualifiedPlays) },
						{ key: "rate", header: "Qualified plays per impression", width: 96, align: "right", render: (s) => fmtPct(s.rate, 2) },
					]}
					rows={r.sources}
					rowKey={(s) => s.source}
				/>
			) : null}
			<Note>
				Rates are the mean of Roblox's daily values; counts are unique users per day, summed. The per-source rate is plays over impressions for the period. Fetched {r.fetchedAt.replace("T", " ").slice(0, 16)} UTC.
			</Note>
		</View>
	);
}

// 7-day moving averages ---------------------------------------------------------------------------------------------------

function Trends({ backendId, filters }: { backendId: string; filters: Filters }) {
	const p = useTheme();
	const [metric, setMetric] = useState<string>("d1");
	const [days, setDays] = useState(28);
	const from = isoDate(Date.now() - days * 86_400_000);
	const q = useTTAnalytics(backendId, "trends", { window: 7 }, { filters: { ...filters, from } });
	const spec = TRENDS.find((t) => t.key === metric) ?? (TRENDS[0] as (typeof TRENDS)[number]);
	return (
		<Panel title="Snapshot of 7-day moving averages" note="Per full UTC day, total and per join source (where the player's first session that day came from). Counts are averaged over the 7 days; ratios are the mean of the 7 daily values.">
			<Chips options={TRENDS.map((t) => ({ value: t.key as string, label: t.label }))} value={spec.key} onChange={setMetric} />
			<Segmented options={[14, 28, 56, 90].map((d) => ({ value: d, label: `${d} d` }))} value={days} onChange={setDays} />
			<QueryState q={q} isEmpty={(r) => r.days.every((d) => d.total.dau === 0)} empty="No players in this range yet." rows={3}>
				{(r) => {
					const pick = (v: TrendValues | undefined) => (v ? v[spec.key] : null);
					const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
					if (!r.days.some((d) => {
						const v = pick(d.total);
						return typeof v === "number" && v > 0;
					})) {
						return <Txt variant="muted">{spec.key === "d1" ? "No D1 values yet: a join day counts once the day after it is over." : `No ${spec.label.toLowerCase()} in this range yet.`}</Txt>;
					}
					return (
						<LineChart
							area={false}
							height={200}
							format={spec.format}
							series={[
								{ label: "Total", points: r.days.map((d) => ({ t: t(d.date), v: pick(d.total) })), color: p.foreground },
								...r.sources.map((s) => ({ label: SOURCE_LABELS[s] ?? s, points: r.days.map((d) => ({ t: t(d.date), v: pick(d.bySource[s]) })), color: p.chart[SOURCE_COLORS[s] ?? 7] ?? p.brand })),
							]}
						/>
					);
				}}
			</QueryState>
			<Tip label="Ours: how the join sources differ" text={JOIN_SOURCES_DIFFER} />
		</Panel>
	);
}

function HowCalculated() {
	const [open, setOpen] = useState(false);
	return (
		<Panel title="How these are calculated" note="The rules this page follows to match Creator Hub. Cards marked Estimate or Ours can't match exactly." right={<Button title={open ? "Hide" : "Show"} small variant="ghost" onPress={() => setOpen((o) => !o)} />}>
			{open
				? CALCULATION_NOTES.map((n) => (
						<View key={n.title} style={{ gap: 2 }}>
							<Txt style={{ fontWeight: "600" }}>{n.title}</Txt>
							<Txt variant="muted">{n.text}</Txt>
						</View>
					))
				: null}
		</Panel>
	);
}
