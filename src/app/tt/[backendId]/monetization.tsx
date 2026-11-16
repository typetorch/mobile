/**
 * Monetization: revenue from the game's server-sent `purchase` rows (query `monetization`), after Roblox's cut. Per day
 * charts (tap a bar: who bought that day), revenue by product (tap: its buyers, `monetization-players`), top buyers, the
 * latest purchases (`monetization-purchases`), and when new players first buy.
 */
import { useMemo } from "react";
import { View } from "react-native";

import type { MonetizationDay, MonetizationPlayer, MonetizationProduct, MonetizationPurchase, MonetizationResult } from "@/api/tt/types";
import { BarChart } from "@/charts/LineChart";
import { Button, Card, EmptyState, Stat, StatGrid, Txt } from "@/components/ui";
import { Note, openPlayer, Panel, productKindLabel, QueryState, ShareBar } from "@/features/typetorch/bits";
import { playerColumns, ProductId, ProductKind } from "@/features/typetorch/cards";
import { describeRange, FilterBar, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { chartMarks, DeployMarksToggle, useDeployMarks, useMarkCard } from "@/features/typetorch/marks";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParams } from "@/features/typetorch/view-link";
import { fmtAgo, fmtInt, fmtMinutes, fmtNum, fmtPct, fmtTime, plural, shortId } from "@/lib/format";
import { space, useTheme } from "@/theme";

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
	// The web's URL state: `buyers` = "<kind>:<product id>" (a product's buyers), `buyersDay` = a UTC day's buyers.
	const [params, setParams] = usePageParams();
	const buyers: BuyersOf = params.buyersDay ? { day: params.buyersDay } : params.buyers && params.buyers.includes(":") ? { kind: params.buyers.slice(0, params.buyers.indexOf(":")), product: params.buyers.slice(params.buyers.indexOf(":") + 1) } : null;
	const setBuyers = (b: BuyersOf) => setParams(b === null ? { buyers: null, buyersDay: null } : "day" in b ? { buyers: null, buyersDay: b.day } : { buyers: `${b.kind}:${b.product}`, buyersDay: null });
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
	const p = useTheme();
	const t = data.totals;
	const range = useMemo(() => ({ from: Date.parse(`${data.from.slice(0, 10)}T00:00:00Z`), to: Date.parse(`${data.to.slice(0, 10)}T00:00:00Z`) + 86_400_000 }), [data.from, data.to]);
	const deploys = useDeployMarks(backendId, range);
	const card = useMarkCard(backendId);
	const productColumns = useMemo<DataColumn<MonetizationProduct>[]>(
		() => [
			{
				id: "product",
				header: "Product",
				width: 170,
				accessor: (x) => x.product,
				filter: "text",
				cell: (x) => (x.product === null ? <Txt variant="small">no id</Txt> : <ProductId backendId={backendId} id={x.product} kind={x.kind} showName filterColumn="product" />),
			},
			{ id: "kind", header: "Kind", type: "enum", width: 120, accessor: (x) => x.kind, format: (v) => productKindLabel(String(v)), cell: (x) => <ProductKind kind={x.kind} filterColumn="kind" /> },
			{ id: "revenue", header: "Revenue", type: "number", width: 84, accessor: (x) => x.revenue, cell: (x) => fmtInt(x.revenue) },
			{ id: "robux", header: "Robux paid", type: "number", width: 84, accessor: (x) => x.robux, cell: (x) => fmtInt(x.robux) },
			{
				id: "share",
				header: "Share",
				type: "number",
				width: 110,
				accessor: (x) => x.share,
				format: (v) => fmtPct(v as number),
				filter: false,
				cell: (x) => (
					<View style={{ flexDirection: "row", alignItems: "center", gap: 6, width: "100%" }}>
						<View style={{ flex: 1 }}>
							<ShareBar share={x.share} />
						</View>
						<Txt variant="small" style={{ width: 40, textAlign: "right" }}>
							{fmtPct(x.share)}
						</Txt>
					</View>
				),
			},
			{ id: "purchases", header: "Purchases", type: "number", width: 80, accessor: (x) => x.purchases, cell: (x) => fmtInt(x.purchases) },
			{ id: "payers", header: "Payers", type: "number", width: 70, accessor: (x) => x.payers, cell: (x) => fmtInt(x.payers) },
		],
		[backendId],
	);
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
			<DeployMarksToggle {...deploys} />
			{CHARTS.map((c) => (
				<Card key={c.key} style={{ gap: 6 }}>
					<Txt variant="label">{c.label}</Txt>
					<Note>{c.description} Tap a bar for who bought that day.</Note>
					<BarChart
						points={data.days.map((d) => ({ t: Date.parse(`${d.date}T00:00:00Z`), v: d[c.key] }))}
						format={(v) => (c.decimals ? fmtNum(v, c.decimals) : fmtInt(v))}
						onPick={(pt) => onBuyers({ day: new Date(pt.t).toISOString().slice(0, 10) })}
						marks={chartMarks(p, deploys.marks)}
						onMarkPress={card.open}
					/>
				</Card>
			))}
			{card.sheet}
			<Panel title="Revenue by product" note="Tap a product for who bought it, a kind to show only game passes or developer products. Tap an id for its name, icon and price on Roblox (and Show only this).">
				<DataTable
					id="monetization-products"
					label="Revenue by product"
					columns={productColumns}
					data={data.products}
					rowId={(x) => `${x.kind}:${x.product ?? ""}`}
					density="compact"
					defaultSort={[{ id: "revenue", desc: true }]}
					isRowSelected={(x) => !!buyers && "product" in buyers && buyers.product === x.product && buyers.kind === x.kind}
					onRowPress={(x) => {
						if (x.product === null) return;
						onBuyers(buyers && "product" in buyers && buyers.product === x.product && buyers.kind === x.kind ? null : { kind: x.kind, product: x.product });
					}}
				/>
				{buyers && "product" in buyers ? <BuyersPanel backendId={backendId} of={buyers} onClose={() => onBuyers(null)} /> : null}
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
	const columns = useMemo<DataColumn<MonetizationPlayer>[]>(
		() => [
			...playerColumns<MonetizationPlayer>(backendId),
			{ id: "revenue", header: "Revenue", type: "number", width: 80, accessor: (x) => x.revenue, cell: (x) => fmtInt(x.revenue) },
			{ id: "robux", header: "Robux paid", type: "number", width: 84, accessor: (x) => x.robux, cell: (x) => fmtInt(x.robux) },
			{ id: "purchases", header: "Purchases", type: "number", width: 80, accessor: (x) => x.purchases, cell: (x) => fmtInt(x.purchases) },
			...(all ? [{ id: "products", header: "Products", title: "Different products bought", type: "number" as const, width: 76, accessor: (x: MonetizationPlayer) => x.products, cell: (x: MonetizationPlayer) => fmtInt(x.products) }] : []),
			{ id: "firstAt", header: "First purchase", type: "date", width: 110, accessor: (x) => x.firstAt, format: (_v, x) => fmtAgo(x.firstAt), defaultHidden: !all },
			{ id: "lastAt", header: "Last purchase", type: "date", width: 110, accessor: (x) => x.lastAt, format: (_v, x) => fmtAgo(x.lastAt) },
		],
		[backendId, all],
	);
	return (
		<QueryState q={q} rows={4}>
			{(d) =>
				d.players.length ? (
					<View style={{ gap: space.sm }}>
						<DataTable
							id={day ? "monetization-day-buyers" : all ? "monetization-buyers" : "monetization-product-buyers"}
							label={day ? `Buyers on ${day}` : all ? "Top buyers" : "Buyers of this product"}
							columns={columns}
							data={d.players}
							rowId={(x) => x.pid}
							onRowPress={(x) => openPlayer(backendId, x.pid)}
							defaultSort={[{ id: "revenue", desc: true }]}
							density="compact"
						/>
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
	const columns = useMemo<DataColumn<MonetizationPurchase>[]>(
		() => [
			{ id: "at", header: "When", type: "date", width: 110, accessor: (x) => x.at, format: (_v, x) => fmtAgo(x.at), exportValue: (x) => x.at, searchText: (x) => fmtTime(x.at) },
			...playerColumns<MonetizationPurchase>(backendId).slice(0, 1),
			{
				id: "product",
				header: "Product",
				width: 160,
				accessor: (x) => x.product,
				filter: "text",
				cell: (x) => (x.product === null ? <Txt variant="small">no id</Txt> : <ProductId backendId={backendId} id={x.product} kind={x.kind} showName filterColumn="product" />),
			},
			{ id: "kind", header: "Kind", type: "enum", width: 120, accessor: (x) => x.kind, format: (v) => productKindLabel(String(v)), cell: (x) => <ProductKind kind={x.kind} filterColumn="kind" /> },
			{ id: "robux", header: "Robux paid", type: "number", width: 84, accessor: (x) => x.robux, cell: (x) => fmtInt(x.robux) },
			{ id: "revenue", header: "Revenue", type: "number", width: 80, accessor: (x) => x.revenue, cell: (x) => fmtInt(x.revenue), defaultHidden: true },
			{ id: "where", header: "Where", type: "enum", width: 100, accessor: (x) => x.where },
			...playerColumns<MonetizationPurchase>(backendId).slice(1),
			{ id: "sid", header: "Session", width: 110, mono: true, accessor: (x) => x.sid, format: (_v, x) => shortId(x.sid, 10), defaultHidden: true },
		],
		[backendId],
	);
	return (
		<QueryState q={q} rows={4}>
			{(d) =>
				d.purchases.length ? (
					<View style={{ gap: space.sm }}>
						<DataTable
							id="monetization-purchases"
							label="Latest purchases"
							columns={columns}
							data={d.purchases}
							rowId={(x) => `${x.at}:${x.pid}:${x.kind}:${x.product ?? ""}:${x.sid}`}
							defaultSort={[{ id: "at", desc: true }]}
							density="compact"
							pageSize={25}
						/>
						{d.more ? <Note>{`The latest ${fmtInt(d.purchases.length)}, of ${fmtInt(d.total)}.`}</Note> : null}
					</View>
				) : (
					<Txt variant="muted">No purchases in this range.</Txt>
				)
			}
		</QueryState>
	);
}
