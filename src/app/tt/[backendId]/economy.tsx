/**
 * Economy: one in-game currency at a time from the game's `currency` rows (query `economy`): earned vs spent per day, the
 * running balance, earned per active player, and the top sources and sinks by reason.
 */
import { useState } from "react";
import { View } from "react-native";

import type { EconomyFlow, EconomyResult } from "@/api/tt/types";
import { LineChart } from "@/charts/LineChart";
import { Card, Chips, EmptyState, List, Stat, StatGrid, Txt } from "@/components/ui";
import { Note, Panel, QueryState, ShareRow } from "@/features/typetorch/bits";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtInt, fmtNum, fmtPct, plural } from "@/lib/format";
import { space } from "@/theme";

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

export default function EconomyScreen() {
	return <TTScreen title="Economy">{({ backendId }) => <Economy backendId={backendId} />}</TTScreen>;
}

function Economy({ backendId }: { backendId: string }) {
	const { state } = useTTFilters(backendId);
	const [currency, setCurrency] = useState("");
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

function Flows({ rows, empty }: { rows: EconomyFlow[]; empty: string }) {
	if (!rows.length) return <Txt variant="muted">{empty}</Txt>;
	return (
		<List>
			{rows.map((r) => (
				<ShareRow key={r.reason} label={r.reason || "(no reason)"} value={fmtNum(r.amount)} share={r.share} sub={`${fmtPct(r.share)} · ${plural(r.rows, "event")} · ${plural(r.players, "player")}`} />
			))}
		</List>
	);
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
				<Flows rows={data.sources} empty="Nothing earned in this range." />
			</Panel>
			<Panel title="Top sinks" note="Where it goes: the reasons of negative deltas.">
				<Flows rows={data.sinks} empty="Nothing spent in this range." />
			</Panel>
			<View style={{ height: space.sm }} />
		</>
	);
}
