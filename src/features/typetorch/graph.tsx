/**
 * The node graph (Flow, a player's timeline) for a phone: drawn (graph-view.tsx: dagre + react-native-svg, pan, pinch,
 * tap a state) or as lists (the states busiest first, tap one for its moves out), a one-session path in order, where
 * sessions end and the busiest moves. "Copy Mermaid" gives the drawing as text, like the web's button.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Switch, View } from "react-native";

import { eventsLine, exits, LEFT, nodeKind, realStates, START, stateLines, stepsLine, toMermaid, topEdges } from "@/api/tt/graph-text";
import { FACETS, type Facet, type GraphData, type GraphEdge } from "@/api/tt/types";
import { Badge, Chips, Icon, List, Segmented, Txt } from "@/components/ui";
import { fmtDuration, fmtInt, fmtPct, plural } from "@/lib/format";
import { space, useTheme } from "@/theme";

import { CopyButton, Note, Panel, ShareBar, ShareRow } from "./bits";
import { GraphView } from "./graph-view";
import { DataTable, type DataColumn } from "./table";

const name = (id: string) => stateLines(id).join(" · ");

export function isFacet(value: string): value is Facet {
	return (FACETS as string[]).includes(value);
}

/** Facet chips and the moments switch (the web's FacetToggle + MomentsToggle). */
export function GraphControls({ facet, onFacet, moments, onMoments }: { facet: Facet; onFacet(f: Facet): void; moments: boolean; onMoments(on: boolean): void }) {
	return (
		<View style={{ gap: space.sm }}>
			<Chips options={FACETS.map((f) => ({ value: f, label: f }))} value={facet} onChange={onFacet} />
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
				<Switch value={moments} onValueChange={onMoments} />
				<Txt variant="small" style={{ flex: 1 }}>
					Moments: funnel steps, purchases, personal bests and round ends as nodes
				</Txt>
			</View>
		</View>
	);
}

/** One dim line when a graph has fewer than 3 states, with a link to the events. */
export function SparseNote({ graph, backendId, pid }: { graph: GraphData; backendId: string; pid?: string }) {
	const p = useTheme();
	const states = realStates(graph);
	if (states >= 3) return null;
	const parts = new Set<string>();
	for (const n of graph.nodes) {
		if (nodeKind(n.id) !== "state") continue;
		for (const part of n.id.split("|")) if (part.includes(":")) parts.add(part.slice(0, part.indexOf(":")));
	}
	const which = parts.size ? ` (${[...parts].join(", ")})` : "";
	return (
		<View style={{ gap: 2 }}>
			<Txt variant="small">
				Only {states} state{states === 1 ? "" : "s"}
				{which}: the graph shows what the game logs as state (zone, screen, activity), and this build logs only these so far.
			</Txt>
			<Pressable onPress={() => router.push(`/tt/${backendId}/events${pid ? `?pid=${encodeURIComponent(pid)}` : ""}`)} hitSlop={6}>
				<Txt variant="small" color={p.brand} style={{ textDecorationLine: "underline" }}>
					{pid ? "See this player's events" : "See the events"}
				</Txt>
			</Pressable>
		</View>
	);
}

/** A one-session graph's visits in order, with the time in each. */
export function PathStrip({ graph }: { graph: GraphData }) {
	const p = useTheme();
	if (!graph.path?.length) return null;
	return (
		<View style={{ gap: 4 }}>
			<Txt variant="label">Path</Txt>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
				{graph.path.map((s, i) => (
					<View key={s.step} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
						{i > 0 ? <Icon name="arrow-forward" size={11} color={p.mutedForeground} /> : null}
						<View style={{ borderWidth: 1, borderColor: nodeKind(s.state) === "moment" ? p.chart[3] : p.border, borderRadius: nodeKind(s.state) === "moment" ? 999 : 4, paddingHorizontal: 5, paddingVertical: 1 }}>
							<Txt variant="small" color={p.foreground}>
								<Txt variant="small">#{s.step}</Txt> {name(s.state)} <Txt variant="small">{fmtDuration(s.ms)}</Txt>
							</Txt>
						</View>
					</View>
				))}
				{graph.ended ? (
					<>
						<Icon name="arrow-forward" size={11} color={p.mutedForeground} />
						<Txt variant="small">{stateLines(LEFT)[0]}</Txt>
					</>
				) : (
					<Txt variant="small">(session still on, or its last rows not in yet)</Txt>
				)}
			</View>
		</View>
	);
}

/** The states, busiest first; a tap shows its moves out. */
export function StateList({ graph }: { graph: GraphData }) {
	const p = useTheme();
	const [open, setOpen] = useState<string | null>(null);
	const [all, setAll] = useState(false);
	const nodes = useMemo(() => [...graph.nodes].filter((n) => n.id !== START && n.id !== LEFT).sort((a, b) => b.visits - a.visits), [graph.nodes]);
	const maxVisits = Math.max(1, ...nodes.map((n) => n.visits));
	const shown = all ? nodes : nodes.slice(0, 25);
	return (
		<View style={{ gap: space.sm }}>
			<List>
				{shown.map((n) => {
					const out = topEdges(
						graph.edges.filter((e) => e.from === n.id),
						8,
					);
					const isOpen = open === n.id;
					const ev = eventsLine(n);
					const st = stepsLine(n);
					return (
						<View key={n.id}>
							<ShareRow
								onPress={() => setOpen(isOpen ? null : n.id)}
								label={
									<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
										{nodeKind(n.id) === "moment" ? <Badge label="moment" tone="warning" /> : null}
										<Txt numberOfLines={2} style={{ flexShrink: 1 }}>
											{name(n.id)}
										</Txt>
									</View>
								}
								value={fmtInt(n.visits)}
								share={n.visits / maxVisits}
								sub={[`${plural(n.visits, "visit")}`, n.players !== undefined ? plural(n.players, "player") : null, n.visits ? `avg ${fmtDuration(n.dwellMs / n.visits)}` : null, ev || null, st || null].filter(Boolean).join(" · ")}
							/>
							{isOpen ? (
								<View style={{ paddingHorizontal: space.md, paddingBottom: space.sm, gap: 4 }}>
									{out.length ? (
										out.map((e) => (
											<View key={e.to} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
												<Icon name="arrow-forward" size={12} color={p.mutedForeground} />
												<Txt variant="small" color={p.foreground} style={{ flex: 1 }} numberOfLines={1}>
													{name(e.to)}
												</Txt>
												<Txt variant="small">
													{fmtInt(e.count)} · {fmtPct(e.share)}
												</Txt>
											</View>
										))
									) : (
										<Txt variant="small">No moves out of this state.</Txt>
									)}
								</View>
							) : null}
						</View>
					);
				})}
			</List>
			{nodes.length > 25 ? (
				<Pressable onPress={() => setAll((a) => !a)}>
					<Txt variant="small" color={p.brand}>
						{all ? "Show fewer states" : `Show all ${nodes.length} states`}
					</Txt>
				</Pressable>
			) : null}
		</View>
	);
}

type Exit = ReturnType<typeof exits>[number];

const EXIT_COLUMNS: DataColumn<Exit>[] = [
	{ id: "state", header: "State", width: 200, accessor: (e) => name(e.state), filter: "text" },
	{ id: "count", header: "Sessions", width: 80, accessor: (e) => e.count, cell: (e) => fmtInt(e.count) },
	{ id: "share", header: "Share", width: 110, accessor: (e) => e.share, format: (v) => fmtPct(v as number), cell: (e) => <ShareCell share={e.share} />, filter: false },
];

const MOVE_COLUMNS: DataColumn<GraphEdge>[] = [
	{ id: "from", header: "From", width: 170, accessor: (e) => name(e.from) },
	{ id: "to", header: "To", width: 170, accessor: (e) => name(e.to) },
	{ id: "count", header: "Times", width: 70, accessor: (e) => e.count, cell: (e) => fmtInt(e.count) },
	{ id: "share", header: "Share", width: 70, accessor: (e) => e.share, cell: (e) => fmtPct(e.share), format: (v) => fmtPct(v as number) },
	{
		id: "before",
		header: "Avg before",
		title: "Average time in the state before the move",
		width: 90,
		accessor: (e) => (e.from === START ? null : e.count ? e.dwellMs / e.count : 0),
		cell: (e) => (e.from === START ? "–" : fmtDuration(e.count ? e.dwellMs / e.count : 0)),
		format: (_v, e) => (e.from === START ? "" : fmtDuration(e.count ? e.dwellMs / e.count : 0)),
		exportValue: (e) => (e.from === START ? null : (e.count ? e.dwellMs / e.count : 0) / 1000),
	},
];

function ShareCell({ share }: { share: number }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6, width: "100%" }}>
			<View style={{ flex: 1 }}>
				<ShareBar share={share} />
			</View>
			<Txt variant="small" style={{ width: 40, textAlign: "right" }}>
				{fmtPct(share)}
			</Txt>
		</View>
	);
}

/** Where sessions end, and the busiest moves (the web Flow page's two tables). */
export function GraphTables({ graph }: { graph: GraphData }) {
	const out = exits(graph);
	const moves = topEdges(graph.edges, 15);
	return (
		<>
			<Panel title="Where sessions end" note="The last state before leaving (sessions that are over).">
				{out.length ? <DataTable id="flow-exits" label="Where sessions end" columns={EXIT_COLUMNS} data={out} rowId={(e) => e.state} /> : <Txt variant="muted">No session in this range is over yet.</Txt>}
			</Panel>
			<Panel title="Busiest moves" note="Share = of all moves out of the same state; time = average in the state before the move.">
				<DataTable id="flow-moves" label="Busiest moves" columns={MOVE_COLUMNS} data={moves} rowId={(e) => `${e.from}>${e.to}`} />
			</Panel>
		</>
	);
}

/** Drawn (pan, pinch, tap a state) or as lists (the states busiest first, tap one for its moves out). */
export function GraphPanelBody({ graph, mode, onMode }: { graph: GraphData; mode: "drawn" | "list"; onMode(mode: "drawn" | "list"): void }) {
	return (
		<View style={{ gap: space.sm }}>
			<Segmented
				options={[
					{ value: "drawn", label: "Drawn" },
					{ value: "list", label: "List" },
				]}
				value={mode}
				onChange={onMode}
			/>
			{mode === "drawn" ? <GraphView graph={graph} /> : <StateList graph={graph} />}
		</View>
	);
}

export function MermaidButton({ graph }: { graph: GraphData }) {
	return <CopyButton text={toMermaid(graph)} title="Copy Mermaid" />;
}

export { Note, realStates };
