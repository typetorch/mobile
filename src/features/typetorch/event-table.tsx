/**
 * Event rows as a DataTable (the web's components/EventTable.tsx): time, kind, name, side, state and props, plus the
 * extra columns a page adds. Sort, filter, export like any table; a purchase row's product id opens its card.
 */
import { useMemo } from "react";
import { View } from "react-native";

import { Badge, Txt } from "@/components/ui";
import { compactJson, fmtTime } from "@/lib/format";

import { productTypeOf } from "./bits";
import { ProductId } from "./cards";
import { DataTable, type DataColumn, type DataTableProps } from "./table";

export interface ListedEvent {
	time: string;
	t: number;
	kind: string;
	name: string;
	state: string | null;
	src: string | null;
	props: unknown;
}

/** A purchase row's product id (`props.product`; the row's name is the purchase kind: product, gamepass, ...). */
function purchaseProduct(e: ListedEvent): unknown {
	if (e.kind !== "purchase" || !productTypeOf(e.name) || typeof e.props !== "object" || e.props === null) return undefined;
	const product = (e.props as Record<string, unknown>).product;
	return typeof product === "number" || typeof product === "string" ? product : undefined;
}

/** The columns every event table has. `dateToo` shows the day as well as the time. */
export function eventColumns<E extends ListedEvent>(backendId: string, dateToo: boolean): DataColumn<E>[] {
	const shown = (e: E) => (dateToo ? fmtTime(e.time) : fmtTime(e.time).slice(11));
	return [
		{ id: "time", header: dateToo ? "Time (UTC)" : "Time", type: "date", width: dateToo ? 140 : 80, mono: true, accessor: (e) => e.t, format: (_v, e) => shown(e) },
		{ id: "kind", header: "Kind", type: "enum", width: 90, accessor: (e) => e.kind, cell: (e) => <Badge label={e.kind} /> },
		{ id: "name", header: "Name", width: 140, accessor: (e) => e.name },
		{ id: "side", header: "Side", type: "enum", options: ["server", "client"], width: 70, accessor: (e) => e.src },
		{ id: "state", header: "State", width: 120, accessor: (e) => e.state },
		{
			id: "props",
			header: "Props",
			width: 240,
			accessor: (e) => e.props,
			format: (v) => compactJson(v, 400),
			filter: "text",
			cell: (e) => {
				const props = compactJson(e.props, 400);
				if (!props || props === "{}") return "–";
				const product = purchaseProduct(e);
				return (
					<View style={{ gap: 2 }}>
						{product !== undefined ? <ProductId backendId={backendId} id={product} kind={e.name} /> : null}
						<Txt variant="mono" numberOfLines={3} style={{ fontSize: 10 }}>
							{props}
						</Txt>
					</View>
				);
			},
		},
	];
}

export function EventTable<E extends ListedEvent>({ backendId, events, dateToo = false, extra, ...rest }: { backendId: string; events: readonly E[]; dateToo?: boolean; extra?: DataColumn<E>[] } & Omit<DataTableProps<E>, "columns" | "data">) {
	const columns = useMemo(() => [...eventColumns<E>(backendId, dateToo), ...(extra ?? [])], [backendId, dateToo, extra]);
	return <DataTable<E> columns={columns} data={events} density="compact" {...rest} />;
}
