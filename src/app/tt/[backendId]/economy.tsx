/**
 * Economy: one in-game currency at a time from the game's `currency` rows (query `economy`): earned vs spent per day, the
 * running balance, earned per active player, and the top sources and sinks by reason.
 */
import { View } from "react-native";

import type { EconomyFlow, EconomyResult } from "@/api/tt/types";
import { LineChart } from "@/charts/LineChart";
import { Card, Chips, EmptyState, Stat, StatGrid, Txt } from "@/components/ui";
import { Note, Panel, QueryState, ShareBar } from "@/features/typetorch/bits";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam } from "@/features/typetorch/view-link";
import { fmtInt, fmtNum, fmtPct, plural } from "@/lib/format";
import { space } from "@/theme";

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

export default function EconomyScreen() {
	return <TTScreen title="Economy">{({ backendId }) => <Economy backendId={backendId} />}</TTScreen>;
}

function Economy({ backendId }: { backendId: string }) {
	const { state } = useTTFilters(backendId);
	// The web's URL parameter `currency`.
	const [currency, setCurrency] = usePageParam("currency");
	const q = useTTAnalytics(backendId, "economy", currency ? { currency } : {}, { keepPrevious: true });
	const names = q.data?.currencies.map((c) => c.currency) ?? [];
	const shown = currency || q.data?.currency || "";
	const items = shown && !names.includes(shown) ? [shown, ...names] : names;
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Currency earned and spent, {describeRange(state)}, from the game's currency events.</Note>
			{items.length > 1 ? <Chips options={items.map((n) => ({ value: n, label: n }))} value={shown} onChange={setCurrency} /> : null}
			{q.data && q.data.currencies.length === 0 ? (
				<EmptyState
					icon="cash-outline"
					title="No currency events in this range"
					body={
						<View style={{ gap: 6 }}>
							<Txt variant="muted" style={{ textAlign: "center" }}>
								The game server logs them with analytics.currency(player, name, delta, reason): a positive delta when currency comes in, a negative one when it is spent. Server only: clients can't send them.
							</Txt>
							<Txt variant="mono" style={{ textAlign: "center" }}>
								analytics.currency(player, "coins", 50, "round_reward")
							</Txt>
						</View>
					}
				/>
			) : (
				<QueryState q={q} rows={6}>
					{(data) => <Body data={data} />}
				</QueryState>
			)}
		</>
	);
}

const FLOW_COLUMNS: DataColumn<EconomyFlow>[] = [
	{ id: "reason", header: "Reason", width: 150, accessor: (r) => r.reason || "(no reason)" },
	{ id: "amount", header: "Amount", type: "number", width: 90, accessor: (r) => r.amount, cell: (r) => fmtNum(r.amount) },
	{
		id: "share",
		header: "Share",
		type: "number",
		width: 110,
		accessor: (r) => r.share,
		format: (v) => fmtPct(v as number),
		filter: false,
		cell: (r) => (
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6, width: "100%" }}>
				<View style={{ flex: 1 }}>
					<ShareBar share={r.share} />
				</View>
				<Txt variant="small" style={{ width: 40, textAlign: "right" }}>
					{fmtPct(r.share)}
				</Txt>
			</View>
		),
	},
	{ id: "rows", header: "Events", type: "number", width: 72, accessor: (r) => r.rows, cell: (r) => fmtInt(r.rows) },
	{ id: "players", header: "Players", type: "number", width: 72, accessor: (r) => r.players, cell: (r) => fmtInt(r.players) },
];

function Flows({ id, label, rows, empty }: { id: string; label: string; rows: EconomyFlow[]; empty: string }) {
	if (!rows.length) return <Txt variant="muted">{empty}</Txt>;
	return <DataTable id={id} label={label} columns={FLOW_COLUMNS} data={rows} rowId={(r) => r.reason} defaultSort={[{ id: "amount", desc: true }]} />;
}

function Body({ data }: { data: EconomyResult }) {
	const t = data.totals;
	const unit = data.currency ?? "";
	const days = data.days;
	return (
		<>
			<StatGrid>
				<Stat label="Earned" value={fmtNum(t.earned)} sub={`${plural(t.earners, "player")} earned ${unit}`} />
				<Stat label="Spent" value={fmtNum(t.spent)} sub={`${plural(t.spenders, "player")} spent ${unit}`} />
				<Stat label="Net" value={fmtNum(t.net)} sub={t.net >= 0 ? "more came in than went out" : "more went out than came in"} />
				<Stat label="Spent per earned" value={t.earned > 0 ? fmtPct(t.sinkRatio) : "–"} sub={t.earned > 0 ? (t.sinkRatio > 1 ? "draining" : "the rest piles up") : "nothing earned"} />
				<Stat label="Earned / active player" value={fmtNum(t.earnedPerActive)} sub={`${plural(t.activePlayers, "active player")}`} />
				<Stat label="Spent / active player" value={fmtNum(t.spentPerActive)} />
				<Stat label="Avg net / player" value={fmtNum(t.avgNetPerPlayer)} sub={`median ${fmtNum(t.medianNetPerPlayer)}, ${plural(t.players, "player")} with ${unit}`} />
				<Stat label="Events" value={fmtInt(t.rows)} sub={`of ${unit}`} />
			</StatGrid>
			<Card style={{ gap: 6 }}>
				<Txt variant="label">Earned vs spent per day (UTC)</Txt>
				<LineChart
					area={false}
					series={[
						{ label: "Earned", points: days.map((d) => ({ t: day(d.date), v: d.earned })) },
						{ label: "Spent", points: days.map((d) => ({ t: day(d.date), v: d.spent })) },
					]}
				/>
			</Card>
			<Card style={{ gap: 6 }}>
				<Txt variant="label">Running balance</Txt>
				<Note>The net (earned − spent) added up from the start of the range: above zero, currency piles up in the game.</Note>
				<LineChart
					area={false}
					series={[
						{ label: "Running balance", points: days.map((d) => ({ t: day(d.date), v: d.balance })) },
						{ label: "Net that day", points: days.map((d) => ({ t: day(d.date), v: d.net })) },
					]}
				/>
			</Card>
			<Card style={{ gap: 6 }}>
				<Txt variant="label">Earned per active player</Txt>
				<LineChart series={[{ label: "Earned per active player", points: days.map((d) => ({ t: day(d.date), v: d.earnedPerActive })) }]} height={130} />
			</Card>
			<Panel title="Top sources" note="Where it comes from: the reasons of positive deltas.">
				<Flows id="economy-sources" label="Top sources" rows={data.sources} empty="Nothing earned in this range." />
			</Panel>
			<Panel title="Top sinks" note="Where it goes: the reasons of negative deltas.">
				<Flows id="economy-sinks" label="Top sinks" rows={data.sinks} empty="Nothing spent in this range." />
			</Panel>
			<View style={{ height: space.sm }} />
		</>
	);
}
