/**
 * Monetization: revenue from the game's server-sent `purchase` rows (query `monetization`), after Roblox's cut. Per day
 * charts (tap a bar: who bought that day), revenue by product (tap: its buyers, `monetization-players`), top buyers, the
 * latest purchases (`monetization-purchases`), and when new players first buy.
 */
import { useState } from "react";
import { View } from "react-native";

import type { MonetizationDay, MonetizationResult } from "@/api/tt/types";
import { BarChart } from "@/charts/LineChart";
import { Button, Card, EmptyState, List, Stat, StatGrid, Txt } from "@/components/ui";
import { NamedPlayerRow, Note, Panel, ProductName, productKindLabel, QueryState, ShareBar, ShareRow } from "@/features/typetorch/bits";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtInt, fmtMinutes, fmtNum, fmtPct, plural } from "@/lib/format";
import { space } from "@/theme";

const CHARTS: { key: keyof Omit<MonetizationDay, "date">; label: string; decimals?: number; description: string }[] = [
	{ key: "revenue", label: "Revenue", description: "Robux the creator keeps per day (UTC), after Roblox's cut." },
	{ key: "purchases", label: "Purchases", description: "Purchases per day." },
	{ key: "payers", label: "Payers", description: "Players who bought something that day." },
	{ key: "arpdau", label: "ARPDAU", decimals: 2, description: "Revenue per daily active user: the day's revenue over its active players." },
];

type BuyersOf = { kind: string; product: string } | { day: string } | null;

export default function MonetizationScreen() {
	return <TTScreen title="Monetization">{({ backendId }) => <Monetization backendId={backendId} />}</TTScreen>;
}

function Monetization({ backendId }: { backendId: string }) {
	const { state } = useTTFilters(backendId);
	const q = useTTAnalytics(backendId, "monetization");
	const [buyers, setBuyers] = useState<BuyersOf>(null);
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Revenue from purchases, {describeRange(state)}, after Roblox's cut. Server-sent purchases only, each counted once.</Note>
			{q.data && q.data.totals.purchases === 0 ? (
				<EmptyState
					icon="card-outline"
					title="No purchases in this range"
					body={
						<View style={{ gap: 6 }}>
							<Txt variant="muted" style={{ textAlign: "center" }}>
								The game server logs them with analytics.purchase(player, {"{ product, robux, where?, kind? }"}) once the purchase is granted: in ProcessReceipt for developer products, and with kind: "gamepass" after a game pass prompt finishes with a purchase. Server only.
							</Txt>
						</View>
					}
				/>
			) : (
				<QueryState q={q} rows={6}>
					{(data) => <Body backendId={backendId} data={data} buyers={buyers} onBuyers={setBuyers} />}
				</QueryState>
			)}
		</>
	);
}

function Body({ backendId, data, buyers, onBuyers }: { backendId: string; data: MonetizationResult; buyers: BuyersOf; onBuyers(b: BuyersOf): void }) {
	const t = data.totals;
	const fp = data.firstPurchase;
	const cut = fmtPct(1 - data.creatorShare, 0);
	return (
		<>
			<StatGrid>
				<Stat label="Revenue" value={`${fmtInt(t.revenue)} R$`} sub={`${fmtInt(t.robux)} R$ paid, Roblox keeps ${cut}`} />
				<Stat label="Purchases" value={fmtInt(t.purchases)} sub={`${fmtNum(t.purchasesPerPayer)} per payer`} />
				<Stat label="Payers" value={fmtInt(t.payers)} sub={`of ${plural(t.activePlayers, "active player")}`} />
				<Stat label="Payer conversion" value={fmtPct(t.payerConversion, 2)} sub="payers / active players" />
				<Stat label="ARPPU" value={`${fmtNum(t.arppu, 1)} R$`} sub={`per paying user, ${fmtNum(t.arpu)} R$ per active player`} />
				<Stat label="ARPDAU" value={`${fmtNum(t.arpdau, 2)} R$`} sub={`over ${plural(t.playerDays, "player-day")}`} />
				<Stat label="Repeat purchase rate" value={fmtPct(t.repeatRate)} sub={`${plural(t.repeatPayers, "payer")} bought 2+ times`} />
				<Stat label="Time to first purchase" value={fmtMinutes(fp.medianMinutes)} sub={fp.payers ? `median, ${plural(fp.payers, "new player")} (avg ${fmtMinutes(fp.avgMinutes)})` : "no new player bought yet"} />
			</StatGrid>
			{buyers && "day" in buyers ? <BuyersPanel backendId={backendId} of={buyers} onClose={() => onBuyers(null)} /> : null}
			{CHARTS.map((c) => (
				<Card key={c.key} style={{ gap: 6 }}>
					<Txt variant="label">{c.label}</Txt>
					<Note>{c.description} Tap a bar for who bought that day.</Note>
					<BarChart points={data.days.map((d) => ({ t: Date.parse(`${d.date}T00:00:00Z`), v: d[c.key] }))} format={(v) => (c.decimals ? fmtNum(v, c.decimals) : fmtInt(v))} onPick={(pt) => onBuyers({ day: new Date(pt.t).toISOString().slice(0, 10) })} />
				</Card>
			))}
			<Panel title="Revenue by product" note="Tap a product for who bought it.">
				<List>
					{data.products.map((x) => (
						<View key={`${x.kind}:${x.product ?? ""}`}>
							<ShareRow
								label={<ProductName backendId={backendId} id={x.product} kind={x.kind} style="body" />}
								value={`${fmtInt(x.revenue)} R$`}
								share={x.share}
								sub={`${productKindLabel(x.kind)} · ${fmtPct(x.share)} · ${fmtInt(x.robux)} R$ paid · ${plural(x.purchases, "purchase")} · ${plural(x.payers, "payer")}`}
								{...(x.product !== null ? { onPress: () => onBuyers(buyers && "product" in buyers && buyers.product === x.product && buyers.kind === x.kind ? null : { kind: x.kind, product: x.product as string }) } : {})}
							/>
							{buyers && "product" in buyers && buyers.product === x.product && buyers.kind === x.kind ? (
								<View style={{ padding: space.sm }}>
									<BuyersPanel backendId={backendId} of={buyers} onClose={() => onBuyers(null)} />
								</View>
							) : null}
						</View>
					))}
				</List>
			</Panel>
			<Panel title="Top buyers" note="Who spent the most in this range, on anything. Tap one to open the player.">
				<Buyers backendId={backendId} />
			</Panel>
			<Panel title="Latest purchases" note="Who bought what, newest first, with the Robux paid and where in the game.">
				<LatestPurchases backendId={backendId} />
			</Panel>
			<Panel title="First purchase" note={`New players (first session in the range) who bought after joining: ${fmtInt(fp.payers)} of ${fmtInt(fp.newPlayers)} (${fmtPct(fp.conversion)}). Which of their sessions it was in:`}>
				{fp.bySession.map((b) => (
					<View key={b.session} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
						<Txt variant="small" style={{ width: 76 }}>
							Session {b.session}
						</Txt>
						<View style={{ flex: 1 }}>
							<ShareBar share={b.share} />
						</View>
						<Txt variant="small" style={{ width: 84, textAlign: "right" }}>
							{fmtInt(b.payers)} ({fmtPct(b.share)})
						</Txt>
					</View>
				))}
			</Panel>
		</>
	);
}

function BuyersPanel({ backendId, of, onClose }: { backendId: string; of: NonNullable<BuyersOf>; onClose(): void }) {
	const { state } = useTTFilters(backendId);
	const title = "day" in of ? `Buyers on ${of.day}` : "Buyers of this product";
	const note = "day" in of ? "That UTC day, under the page's other filters. Biggest spenders first." : `${productKindLabel(of.kind)}, ${describeRange(state)}, under the page's filters. Biggest spenders first.`;
	return (
		<Panel title={title} note={note} right={<Button title="Close" small variant="ghost" onPress={onClose} />}>
			{"day" in of ? <Buyers backendId={backendId} day={of.day} /> : <Buyers backendId={backendId} kind={of.kind} product={of.product} />}
		</Panel>
	);
}

function Buyers({ backendId, kind, product, day }: { backendId: string; kind?: string; product?: string; day?: string }) {
	const all = kind === undefined && product === undefined;
	const { apiFilters } = useTTFilters(backendId);
	const q = useTTAnalytics(backendId, "monetization-players", all ? {} : { kind, product }, day ? { filters: { ...apiFilters, from: day, to: day } } : {});
	return (
		<QueryState q={q} rows={4}>
			{(d) =>
				d.players.length ? (
					<View style={{ gap: space.sm }}>
						<List>
							{d.players.map((x) => (
								<NamedPlayerRow
									key={x.pid}
									backendId={backendId}
									row={x}
									detail={`${plural(x.purchases, "purchase")}${all ? ` · ${plural(x.products, "product")}` : ""} · last ${fmtAgo(x.lastAt)}`}
									right={<Txt style={{ fontWeight: "600" }}>{fmtInt(x.revenue)} R$</Txt>}
								/>
							))}
						</List>
						{d.more ? <Note>{`The ${fmtInt(d.players.length)} biggest spenders, of ${fmtInt(d.total)}.`}</Note> : null}
					</View>
				) : (
					<Txt variant="muted">Nobody bought this in this range.</Txt>
				)
			}
		</QueryState>
	);
}

function LatestPurchases({ backendId }: { backendId: string }) {
	const q = useTTAnalytics(backendId, "monetization-purchases", { limit: 100 });
	const [all, setAll] = useState(false);
	return (
		<QueryState q={q} rows={4}>
			{(d) =>
				d.purchases.length ? (
					<View style={{ gap: space.sm }}>
						<List>
							{(all ? d.purchases : d.purchases.slice(0, 25)).map((x) => (
								<View key={`${x.at}:${x.pid}:${x.kind}:${x.product ?? ""}:${x.sid}`}>
									<NamedPlayerRow
										backendId={backendId}
										row={x}
										detail={`${fmtAgo(x.at)} · ${productKindLabel(x.kind)}${x.where ? ` · ${x.where}` : ""}`}
										right={<Txt style={{ fontWeight: "600" }}>{fmtInt(x.robux)} R$</Txt>}
									/>
									<View style={{ paddingHorizontal: 12, paddingBottom: 6, marginTop: -4 }}>
										{x.product === null ? <Txt variant="small">no id</Txt> : <ProductName backendId={backendId} id={x.product} kind={x.kind} />}
									</View>
								</View>
							))}
						</List>
						{d.purchases.length > 25 ? <Button title={all ? "Show fewer" : `Show all ${d.purchases.length}`} small variant="ghost" onPress={() => setAll((a) => !a)} style={{ alignSelf: "flex-start" }} /> : null}
						{d.more ? <Note>{`The latest ${fmtInt(d.purchases.length)}, of ${fmtInt(d.total)}.`}</Note> : null}
					</View>
				) : (
					<Txt variant="muted">No purchases in this range.</Txt>
				)
			}
		</QueryState>
	);
}
