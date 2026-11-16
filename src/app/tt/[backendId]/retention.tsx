/**
 * Retention (web pages/Retention.tsx + pages/RetentionLtv.tsx): two tabs over the same join-day cohorts (`view`):
 *   - Players back (query `retention`, days 1-30): the share of each cohort that played again exactly N days after
 *     joining; today (UTC) so far in orange (it can only go up until midnight UTC, and isn't in the average).
 *   - Revenue (LTV) (query `ltv`, D0/D1/D3/D7/D14/D30): what the cohort spent from its join day through that day, per new
 *     player (creator revenue after Roblox's cut, or Robux paid) or the share who had paid (`ltv` param).
 * "Explain the D1 change" opens the Explain panel (`explain=d1`).
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { LtvCell, LtvResult, RetentionResult } from "@/api/tt/types";
import { Button, KV, Segmented, Txt } from "@/components/ui";
import { Picker } from "@/features/typetorch/analytics-bits";
import { Note, Panel, QueryState } from "@/features/typetorch/bits";
import { ExplainPanel, useExplain } from "@/features/typetorch/explain";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { Sheet } from "@/features/typetorch/sheet";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam } from "@/features/typetorch/view-link";
import { fmtInt, fmtPct, plural } from "@/lib/format";
import { useTheme } from "@/theme";

/** Every day from 1 to 30 (hide some under Columns). */
export const RETENTION_DAYS = Array.from({ length: 30 }, (_, i) => i + 1);
export const LTV_DAYS = [0, 1, 3, 7, 14, 30];

/** Today so far (UTC) as "14:20 of 24h". */
const elapsedText = (elapsed: number) => {
	const min = Math.round(elapsed * 24 * 60);
	return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} of 24h`;
};

/** A share as a percent with 2 decimals, always both: "3.45%", "1.00%". */
export const retentionPct = (rate: number) => `${(rate * 100).toFixed(2)}%`;

const alphaHex = (alpha: number) =>
	Math.round(Math.max(0, Math.min(1, alpha)) * 255)
		.toString(16)
		.padStart(2, "0");

/** A heat cell: blue, darker = more; the day in progress orange with a dashed border; "–" when there's nothing yet. */
function HeatBox({ text, share, partial }: { text: string | null; share: number; partial?: boolean }) {
	const p = useTheme();
	if (text === null) return <Txt variant="small">–</Txt>;
	const alpha = partial ? 0.1 + Math.min(1, share) * 0.8 : 0.08 + Math.min(1, share) * 0.82;
	const color = partial ? p.serious : p.chart[0];
	return (
		<View
			style={{
				backgroundColor: `${color}${alphaHex(alpha)}`,
				borderRadius: 4,
				paddingHorizontal: 6,
				paddingVertical: 3,
				minWidth: 60,
				alignItems: "center",
				...(partial ? { borderWidth: 1, borderStyle: "dashed" as const, borderColor: color } : {}),
			}}
		>
			<Txt variant="small" color={alpha > 0.5 ? "#ffffff" : p.foreground}>
				{text}
			</Txt>
		</View>
	);
}

export default function RetentionScreen() {
	return <TTScreen title="Retention">{({ backendId }) => <Retention backendId={backendId} />}</TTScreen>;
}

function Retention({ backendId }: { backendId: string }) {
	const [tab, setTab] = usePageParam("view", "players");
	const [, explain] = useExplain();
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>
				New players by the day they joined: how many came back on each day from 1 to 30 (D1 = the day after joining), and what they spent by D0 to D30. Today (UTC) shows the value so far in orange; later days show –. Hide days under Columns.
			</Note>
			<Button title="Explain the D1 change" small icon="bar-chart-outline" onPress={() => explain("d1")} style={{ alignSelf: "flex-start" }} />
			<Segmented
				options={[
					{ value: "players", label: "Players back" },
					{ value: "revenue", label: "Revenue (LTV)" },
				]}
				value={tab === "revenue" ? "revenue" : "players"}
				onChange={setTab}
			/>
			{tab === "revenue" ? <RetentionLtv backendId={backendId} /> : <PlayersBack backendId={backendId} />}
			<ExplainPanel backendId={backendId} />
		</>
	);
}

// Players back ---------------------------------------------------------------------------------------------------------

interface CohortRow {
	date: string;
	size: number;
	average?: boolean;
	rates: Record<string, number | null>;
	kept?: Record<string, number | null>;
	partial?: Record<string, number>;
	partialKept?: Record<string, number>;
}

const heatText = (rate: number | null, kept?: number | null) => (rate === null ? "" : `${retentionPct(rate)}${kept !== undefined && kept !== null ? ` (${kept})` : ""}`);

function PlayersBack({ backendId }: { backendId: string }) {
	const q = useTTAnalytics(backendId, "retention", { days: RETENTION_DAYS });
	return (
		<QueryState q={q} isEmpty={(d) => d.cohorts.length === 0} empty="No new players joined in this range.">
			{(data) => <PlayersBody data={data} />}
		</QueryState>
	);
}

function PlayersBody({ data }: { data: RetentionResult }) {
	const total = data.cohorts.reduce((s, c) => s + c.size, 0);
	const elapsed = data.todayElapsed ?? 0;
	const columns = useMemo<DataColumn<CohortRow>[]>(
		() => [
			{ id: "joined", header: "Joined (UTC)", width: 100, type: "date", accessor: (r) => (r.average ? null : r.date), cell: (r) => (r.average ? "Weighted average" : r.date), format: (_v, r) => (r.average ? "Weighted average" : r.date) },
			{ id: "size", header: "New players", width: 80, accessor: (r) => r.size, cell: (r) => fmtInt(r.size) },
			...data.days.map(
				(d): DataColumn<CohortRow> => ({
					id: `day${d}`,
					header: `D${d}`,
					title: `Share of the cohort that played again exactly ${d} days after joining, in percent`,
					width: 96,
					align: "center",
					type: "number",
					accessor: (r) => {
						const rate = r.rates[d];
						return rate === null || rate === undefined ? null : Math.round(rate * 10_000) / 100;
					},
					cell: (r) => {
						const rate = r.rates[d] ?? null;
						const partial = r.partial?.[d];
						if (rate === null && partial !== undefined) return <HeatBox text={heatText(partial, r.partialKept?.[d] ?? 0)} share={partial} partial />;
						return <HeatBox text={rate === null ? null : heatText(rate, r.kept?.[d])} share={rate ?? 0} />;
					},
					format: (_v, r) => {
						const partial = r.partial?.[d];
						return partial !== undefined && (r.rates[d] ?? null) === null ? `${heatText(partial, r.partialKept?.[d] ?? 0)} so far` : heatText(r.rates[d] ?? null, r.kept?.[d]);
					},
				}),
			),
		],
		[data.days],
	);
	const rows = useMemo<CohortRow[]>(
		() =>
			data.cohorts.map((c) => ({
				date: c.date,
				size: c.size,
				rates: c.kept,
				kept: c.keptPlayers,
				...(c.partial ? { partial: c.partial } : {}),
				...(c.partialPlayers ? { partialKept: c.partialPlayers } : {}),
			})),
		[data.cohorts],
	);
	const average = useMemo<CohortRow[]>(() => [{ date: "", size: total, average: true, rates: data.average }], [data.average, total]);
	return (
		<Panel
			title="Cohorts by join day"
			note={`${plural(data.cohorts.length, "cohort")}, ${plural(total, "new player")}. A cell = share of the cohort that played again exactly that many days after joining (players in brackets). Orange = today (UTC), so far (${elapsedText(elapsed)}); it can still go up and isn't in the average.`}
		>
			<DataTable id="retention-cohorts" label="Cohorts by join day" columns={columns} data={rows} rowId={(r) => r.date} pinnedRows={average} defaultSort={[{ id: "joined", desc: true }]} />
			<Txt variant="small">Swipe the table sideways for later days.</Txt>
		</Panel>
	);
}

// Revenue (LTV) --------------------------------------------------------------------------------------------------------

export type LtvMetric = "revenue" | "robux" | "payers";
export const LTV_METRICS: Record<LtvMetric, { label: string; title: string }> = {
	revenue: { label: "Revenue per player", title: "What the creator kept per new player of the cohort (after Roblox's cut), from the join day through this day" },
	robux: { label: "Robux paid per player", title: "Robux the cohort paid per new player (before Roblox's cut), from the join day through this day" },
	payers: { label: "Payer share", title: "Share of the cohort who had bought something by this day" },
};

/** The picked number of a cell. */
export function ltvValue(c: LtvCell, metric: LtvMetric): number {
	return metric === "revenue" ? c.revenuePerPlayer : metric === "robux" ? c.robuxPerPlayer : c.payerShare;
}

/** A cell's text: "12.30 R$" per player (always 2 decimals), or "8.3% (5)" payers. */
export function ltvText(c: LtvCell, metric: LtvMetric): string {
	return metric === "payers" ? `${fmtPct(c.payerShare, 1)} (${fmtInt(c.payers)})` : `${ltvValue(c, metric).toFixed(2)} R$`;
}

interface LtvRow {
	date: string;
	size: number;
	average?: boolean;
	days: Record<string, LtvCell | null>;
}

function RetentionLtv({ backendId }: { backendId: string }) {
	const [metric, setMetric] = usePageParam("ltv", "revenue");
	const m: LtvMetric = metric in LTV_METRICS ? (metric as LtvMetric) : "revenue";
	const q = useTTAnalytics(backendId, "ltv", { days: LTV_DAYS });
	return (
		<>
			<Picker label="Show" value={m} onChange={setMetric} options={(Object.keys(LTV_METRICS) as LtvMetric[]).map((k) => ({ value: k, label: LTV_METRICS[k].label }))} />
			<QueryState q={q} isEmpty={(d) => d.cohorts.length === 0} empty="No new players joined in this range.">
				{(data) => <LtvBody data={data} metric={m} />}
			</QueryState>
		</>
	);
}

function LtvBody({ data, metric }: { data: LtvResult; metric: LtvMetric }) {
	const total = data.cohorts.reduce((s, c) => s + c.size, 0);
	const max = useMemo(() => {
		let mx = 0;
		for (const c of data.cohorts) for (const cell of Object.values(c.days)) if (cell) mx = Math.max(mx, ltvValue(cell, metric));
		return mx;
	}, [data.cohorts, metric]);
	const elapsed = data.todayElapsed ?? 0;
	// The web's cell tooltip (Robux paid in total, payers, the in-progress text) as a sheet on a tap.
	const [detail, setDetail] = useState<{ row: LtvRow; day: number; cell: LtvCell } | null>(null);
	const columns = useMemo<DataColumn<LtvRow>[]>(
		() => [
			{ id: "joined", header: "Joined (UTC)", width: 100, type: "date", accessor: (r) => (r.average ? null : r.date), cell: (r) => (r.average ? "Weighted average" : r.date), format: (_v, r) => (r.average ? "Weighted average" : r.date) },
			{ id: "size", header: "New players", width: 80, accessor: (r) => r.size, cell: (r) => fmtInt(r.size) },
			...data.days.map(
				(d): DataColumn<LtvRow> => ({
					id: `d${d}`,
					header: `D${d}`,
					title: `${LTV_METRICS[metric].title} (D${d}${d === 0 ? " = the join day" : ""}). ${`Orange: today (UTC) so far, ${Math.round(elapsed * 100)}% of the day over.`}`,
					width: 104,
					align: "center",
					type: "number",
					accessor: (r) => {
						const c = r.days[d];
						return c ? (metric === "payers" ? Math.round(c.payerShare * 10_000) / 100 : ltvValue(c, metric)) : null;
					},
					cell: (r) => {
						const c = r.days[d];
						const box = <HeatBox text={c ? ltvText(c, metric) : null} share={c && max > 0 ? ltvValue(c, metric) / max : 0} {...(c?.partial ? { partial: true } : {})} />;
						if (!c) return box;
						return (
							<Pressable onPress={() => setDetail({ row: r, day: d, cell: c })} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${r.average ? "Weighted average" : r.date} D${d}: ${ltvText(c, metric)}`}>
								{box}
							</Pressable>
						);
					},
					format: (_v, r) => {
						const c = r.days[d];
						return c ? `${ltvText(c, metric)}${c.partial ? " so far" : ""} · ${fmtInt(c.robux)} R$ paid in total, ${plural(c.payers, "payer")}` : "";
					},
				}),
			),
		],
		[data.days, metric, max, elapsed],
	);
	const rows = useMemo<LtvRow[]>(() => data.cohorts.map((c) => ({ date: c.date, size: c.size, days: c.days })), [data.cohorts]);
	const average = useMemo<LtvRow[]>(() => [{ date: "", size: total, average: true, days: data.average }], [data.average, total]);
	const cut = `${Math.round((1 - data.creatorShare) * 100)}%`;
	return (
		<Panel
			title="Revenue per cohort (LTV)"
			note={`${plural(data.cohorts.length, "cohort")}, ${plural(total, "new player")}. A cell = what the cohort spent from its join day (D0) through that day, per new player (revenue: after Roblox's ${cut}). Orange = today (UTC), so far; it can still go up and isn't in the average. – = not started. The filter bar applies: pick a join source or country to see whether those players paid back. Tap a cell for the Robux paid and payers.`}
		>
			<DataTable id="retention-ltv" label="Revenue per cohort" columns={columns} data={rows} rowId={(r) => r.date} pinnedRows={average} defaultSort={[{ id: "joined", desc: true }]} />
			<Sheet
				open={!!detail}
				onClose={() => setDetail(null)}
				title={detail ? `${detail.row.average ? "Weighted average" : `Joined ${detail.row.date}`} · D${detail.day}` : ""}
				subtitle={detail ? `${LTV_METRICS[metric].title}${detail.day === 0 ? " (D0 = the join day)" : ""}.` : ""}
			>
				{detail ? (
					<>
						<KV label={LTV_METRICS[metric].label} value={`${ltvText(detail.cell, metric)}${detail.cell.partial ? " so far" : ""}`} />
						<KV label="Robux paid in total" value={`${fmtInt(detail.cell.robux)} R$`} />
						<KV label="Payers" value={`${fmtInt(detail.cell.payers)} (${fmtPct(detail.cell.payerShare, 1)})`} />
						<KV label={detail.row.average ? "Weighted over" : "Cohort"} value={plural(detail.cell.players ?? detail.row.size, "new player")} />
						{detail.cell.partial ? <Note>{`In progress: today (UTC) so far, ${Math.round(elapsed * 100)}% of the day over. Can still go up until midnight UTC.`}</Note> : null}
					</>
				) : null}
			</Sheet>
		</Panel>
	);
}
