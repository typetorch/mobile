/**
 * The drawn node graph (Flow, a player's timeline) on the phone: the web's GraphView (React Flow + dagre) as dagre's
 * layout drawn with react-native-svg. One finger pans, two pinch to zoom (react-native-gesture-handler + reanimated);
 * the buttons zoom, fit, flip the direction and open it full screen. Tap a state for what happened there and its moves
 * in and out. Port of backend/web/src/lib/graph.ts (toFlow) and components/GraphView.tsx.
 */
import { graphlib, layout } from "@dagrejs/dagre";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { G, Path, Rect, Text as SvgText } from "react-native-svg";

import { edgeLabel, edgeWidth, eventsLine, LEFT, moveOrder, nodeKind, orderLabel, START, stateLines, stepsLine, topEdges, type StateNodeKind } from "@/api/tt/graph-text";
import type { GraphData, GraphNode } from "@/api/tt/types";
import { Icon, Txt } from "@/components/ui";
import { fmtDuration, fmtInt, fmtPct } from "@/lib/format";
import { radius, space, useTheme } from "@/theme";

// Layout (web lib/graph.ts toFlow) ----------------------------------------------------------------------------------------

export interface LaidNode {
	key: string;
	state: string;
	kind: StateNodeKind;
	lines: string[];
	visits: number;
	players?: number;
	avgDwellMs: number;
	timeMs?: number;
	eventsLine: string;
	stepsLine: string;
	events: NonNullable<GraphNode["events"]>;
	steps: NonNullable<GraphNode["steps"]>;
	/** Top-left corner and size, in graph units. */
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LaidEdge {
	key: string;
	from: string;
	to: string;
	count: number;
	players?: number;
	share: number;
	avgDwellMs: number;
	back: boolean;
	order?: number[];
	label: string;
	width: number;
	points: { x: number; y: number }[];
}

export interface GraphLayout {
	nodes: LaidNode[];
	edges: LaidEdge[];
	width: number;
	height: number;
	hiddenEdges: number;
}

/** A rough box size for a node, so dagre leaves room for its text. `extra` = the other text lines' lengths. */
export function nodeSize(lines: string[], kind: StateNodeKind, extra: number[] = []): { width: number; height: number } {
	if (kind === "start" || kind === "left") return { width: 130, height: 40 };
	if (kind === "moment") return { width: Math.round(Math.max(90, Math.min(260, 28 + (lines[0]?.length ?? 0) * 6.6))), height: 28 };
	const longest = Math.max(12, ...lines.map((l) => l.length));
	const small = Math.max(0, ...extra);
	return { width: Math.round(Math.min(340, 28 + Math.max(longest * 7.2, small * 6.4))), height: 34 + lines.length * 18 + extra.slice(1).filter(Boolean).length * 16 };
}

export function layoutGraph(graph: GraphData, options: { maxEdges?: number; direction?: "LR" | "TB" } = {}): GraphLayout {
	const edges = topEdges(graph.edges, options.maxEdges ?? 60);
	const used = new Set<string>();
	for (const e of edges) used.add(e.from).add(e.to);
	const byId = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
	const ids = edges.length ? [...used] : graph.nodes.map((n) => n.id);
	const rank = (id: string) => (id === START ? -1 : id === LEFT ? 1 : 0);
	ids.sort((a, b) => rank(a) - rank(b) || (byId.get(b)?.visits ?? 0) - (byId.get(a)?.visits ?? 0) || a.localeCompare(b));
	const key = new Map(ids.map((id, i) => [id, `n${i}`]));
	const single = Boolean(graph.path);
	const moves = moveOrder(graph);

	const g = new graphlib.Graph({ multigraph: false });
	const tb = options.direction !== "LR";
	g.setGraph({ rankdir: tb ? "TB" : "LR", nodesep: tb ? 24 : 28, ranksep: tb ? 56 : 90, marginx: 16, marginy: 16 });
	g.setDefaultEdgeLabel(() => ({}));
	const sizes = new Map<string, { width: number; height: number }>();
	for (const id of ids) {
		const n = byId.get(id);
		const meta = n ? `${n.visits} visits · ${n.players ?? 0} players · 10m 00s`.length : 0;
		const size = nodeSize(stateLines(id), nodeKind(id), [meta, n ? eventsLine(n).length : 0, n ? stepsLine(n).length : 0]);
		sizes.set(id, size);
		g.setNode(key.get(id) as string, { ...size });
	}
	for (const e of edges) g.setEdge(key.get(e.from) as string, key.get(e.to) as string, { width: 40, height: 16 });
	layout(g);
	const info = g.graph() as { width?: number; height?: number };

	const nodes: LaidNode[] = ids.map((id) => {
		const n = byId.get(id);
		const pos = g.node(key.get(id) as string) as { x: number; y: number };
		const size = sizes.get(id) as { width: number; height: number };
		const node: LaidNode = {
			key: key.get(id) as string,
			state: id,
			kind: nodeKind(id),
			lines: stateLines(id),
			visits: n?.visits ?? 0,
			avgDwellMs: n && n.visits ? n.dwellMs / n.visits : 0,
			eventsLine: n ? eventsLine(n) : "",
			stepsLine: n ? stepsLine(n) : "",
			events: n?.events ?? [],
			steps: n?.steps ?? [],
			x: pos.x - size.width / 2,
			y: pos.y - size.height / 2,
			width: size.width,
			height: size.height,
		};
		if (single && n) node.timeMs = n.dwellMs;
		if (n?.players !== undefined) node.players = n.players;
		return node;
	});

	const center = (id: string) => g.node(key.get(id) as string) as { x: number; y: number };
	const maxCount = Math.max(1, ...edges.map((e) => e.count));
	const laid: LaidEdge[] = edges.map((e, i) => {
		const from = center(e.from);
		const to = center(e.to);
		const back = tb ? to.y <= from.y : to.x <= from.x;
		const numbers = moves.get(`${e.from}>${e.to}`);
		const dag = g.edge(key.get(e.from) as string, key.get(e.to) as string) as { points?: { x: number; y: number }[] } | undefined;
		const edge: LaidEdge = {
			key: `e${i}`,
			from: e.from,
			to: e.to,
			count: e.count,
			share: e.share,
			avgDwellMs: e.count ? e.dwellMs / e.count : 0,
			back,
			label: numbers ? orderLabel(numbers) : edgeLabel(e),
			width: single ? 2 : edgeWidth(e.count, maxCount),
			points: dag?.points?.length ? dag.points : [from, to],
		};
		if (e.players !== undefined) edge.players = e.players;
		if (numbers) edge.order = numbers;
		return edge;
	});
	return { nodes, edges: laid, width: Math.max(1, info.width ?? 1), height: Math.max(1, info.height ?? 1), hiddenEdges: graph.hiddenEdges + (graph.edges.length - edges.length) };
}

// Drawing -----------------------------------------------------------------------------------------------------------------

/** A smooth path through dagre's edge points (quadratic curves through the midpoints). */
function edgePath(points: { x: number; y: number }[]): string {
	if (points.length < 2) return "";
	const [a, ...rest] = points as [{ x: number; y: number }, ...{ x: number; y: number }[]];
	if (rest.length === 1) return `M${a.x},${a.y} L${(rest[0] as { x: number }).x},${(rest[0] as { y: number }).y}`;
	let d = `M${a.x},${a.y}`;
	for (let i = 0; i < rest.length - 1; i++) {
		const p = rest[i] as { x: number; y: number };
		const q = rest[i + 1] as { x: number; y: number };
		const mx = (p.x + q.x) / 2;
		const my = (p.y + q.y) / 2;
		d += ` Q${p.x},${p.y} ${i === rest.length - 2 ? q.x : mx},${i === rest.length - 2 ? q.y : my}`;
	}
	return d;
}

function arrowHead(points: { x: number; y: number }[], size: number): string {
	const end = points[points.length - 1] as { x: number; y: number };
	const prev = points[points.length - 2] ?? end;
	const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
	const l = { x: end.x - size * Math.cos(ang - 0.45), y: end.y - size * Math.sin(ang - 0.45) };
	const r = { x: end.x - size * Math.cos(ang + 0.45), y: end.y - size * Math.sin(ang + 0.45) };
	return `M${end.x},${end.y} L${l.x},${l.y} L${r.x},${r.y} Z`;
}

/** Cuts a line to fit a box (about 6.6 units per character at 11 px). */
function fit(text: string, width: number, perChar = 6.4): string {
	const max = Math.max(3, Math.floor(width / perChar));
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function meta(n: LaidNode): string {
	const parts = [`${fmtInt(n.visits)} visit${n.visits === 1 ? "" : "s"}`];
	if (n.timeMs !== undefined) parts.push(`${fmtDuration(n.timeMs)} here`);
	else {
		if (n.players !== undefined) parts.push(`${fmtInt(n.players)} player${n.players === 1 ? "" : "s"}`);
		if (n.avgDwellMs) parts.push(`avg ${fmtDuration(n.avgDwellMs)}`);
	}
	return parts.join(" · ");
}

function GraphSvg({ laid, selected }: { laid: GraphLayout; selected: string | null }) {
	const p = useTheme();
	const momentColor = p.chart[3] ?? p.warning;
	return (
		<Svg width={laid.width} height={laid.height}>
			{laid.edges.map((e) => {
				const color = e.back ? p.mutedForeground : selected && (e.from === selected || e.to === selected) ? p.brand : p.mutedForeground;
				const hot = !!selected && (e.from === selected || e.to === selected);
				return (
					<G key={e.key} opacity={selected && !hot ? 0.35 : 1}>
						<Path d={edgePath(e.points)} stroke={color} strokeWidth={e.width} fill="none" strokeDasharray={e.back ? "5,4" : undefined} strokeLinecap="round" />
						<Path d={arrowHead(e.points, 7 + e.width)} fill={color} />
					</G>
				);
			})}
			{laid.edges.map((e) => {
				const mid = e.points[Math.floor(e.points.length / 2)] as { x: number; y: number };
				const w = Math.max(18, e.label.length * 6 + 8);
				const hot = !!selected && (e.from === selected || e.to === selected);
				return (
					<G key={`l${e.key}`} opacity={selected && !hot ? 0.35 : 1}>
						<Rect x={mid.x - w / 2} y={mid.y - 8} width={w} height={16} rx={4} fill={p.background} stroke={p.border} strokeWidth={0.5} />
						<SvgText x={mid.x} y={mid.y + 3.5} fontSize={10} fill={p.foreground} textAnchor="middle">
							{e.label}
						</SvgText>
					</G>
				);
			})}
			{laid.nodes.map((n) => {
				const isSel = selected === n.state;
				if (n.kind === "moment") {
					return (
						<G key={n.key}>
							<Rect x={n.x} y={n.y} width={n.width} height={n.height} rx={n.height / 2} fill={`${momentColor}22`} stroke={momentColor} strokeWidth={isSel ? 2 : 1} />
							<SvgText x={n.x + n.width / 2} y={n.y + n.height / 2 + 4} fontSize={11} fontWeight="600" fill={p.foreground} textAnchor="middle">
								{fit(n.lines[0] ?? "", n.width - 16)}
							</SvgText>
						</G>
					);
				}
				if (n.kind !== "state") {
					return (
						<G key={n.key}>
							<Rect x={n.x} y={n.y} width={n.width} height={n.height} rx={n.height / 2} fill={p.muted} stroke={n.kind === "left" ? `${p.destructive}99` : p.border} strokeDasharray="4,3" strokeWidth={1} />
							<SvgText x={n.x + n.width / 2} y={n.y + n.height / 2 + 4} fontSize={12} fontWeight="600" fill={p.mutedForeground} textAnchor="middle">
								{`${n.lines[0] ?? ""} (${fmtInt(n.visits)})`}
							</SvgText>
						</G>
					);
				}
				let y = n.y + 20;
				const out = [];
				for (const line of n.lines) {
					out.push(
						<SvgText key={`t${y}`} x={n.x + 12} y={y} fontSize={12} fontWeight="600" fill={p.foreground}>
							{fit(line, n.width - 24, 7)}
						</SvgText>,
					);
					y += 18;
				}
				out.push(
					<SvgText key="meta" x={n.x + 12} y={y} fontSize={11} fill={p.mutedForeground}>
						{fit(meta(n), n.width - 24)}
					</SvgText>,
				);
				y += 16;
				if (n.eventsLine) {
					out.push(
						<SvgText key="ev" x={n.x + 12} y={y} fontSize={11} fill={p.chart[0] ?? p.brand}>
							{fit(n.eventsLine, n.width - 24)}
						</SvgText>,
					);
					y += 16;
				}
				if (n.stepsLine) {
					out.push(
						<SvgText key="st" x={n.x + 12} y={y} fontSize={11} fill={p.chart[2] ?? p.good}>
							{fit(n.stepsLine, n.width - 24)}
						</SvgText>,
					);
				}
				return (
					<G key={n.key}>
						<Rect x={n.x} y={n.y} width={n.width} height={n.height} rx={8} fill={p.card} stroke={isSel ? p.brand : p.border} strokeWidth={isSel ? 2 : 1} />
						{out}
					</G>
				);
			})}
		</Svg>
	);
}

// The pannable, zoomable canvas ---------------------------------------------------------------------------------------------

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;

function Canvas({ laid, height, selected, onSelect }: { laid: GraphLayout; height: number; selected: string | null; onSelect(state: string | null): void }) {
	const p = useTheme();
	const [box, setBox] = useState({ w: 0, h: 0 });
	const tx = useSharedValue(0);
	const ty = useSharedValue(0);
	const s = useSharedValue(1);
	const cx = laid.width / 2;
	const cy = laid.height / 2;

	// Fit: the whole graph, or (very tall or wide) the width from the top.
	const fitView = (animate: boolean) => {
		if (!box.w || !box.h) return;
		let scale = Math.min(box.w / laid.width, box.h / laid.height, 1.1);
		let oy = (box.h - laid.height * scale) / 2;
		if (scale < 0.45) {
			scale = Math.max(MIN_ZOOM, Math.min(1, box.w / laid.width, Math.max(0.45, box.h / laid.height)));
			oy = 8;
		}
		const ox = Math.max(8, (box.w - laid.width * scale) / 2);
		const nx = ox - cx * (1 - scale);
		const ny = oy - cy * (1 - scale);
		if (animate) {
			s.value = withTiming(scale);
			tx.value = withTiming(nx);
			ty.value = withTiming(ny);
		} else {
			s.value = scale;
			tx.value = nx;
			ty.value = ny;
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: fit again when the graph or the box changes
	useEffect(() => fitView(false), [laid, box.w, box.h]);

	const zoomBy = (factor: number) => {
		const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.value * factor));
		// Keep the box's centre where it is.
		const fx = box.w / 2;
		const fy = box.h / 2;
		const gx = (fx - tx.value - cx) / s.value + cx;
		const gy = (fy - ty.value - cy) / s.value + cy;
		s.value = withTiming(next);
		tx.value = withTiming(fx - cx - next * (gx - cx));
		ty.value = withTiming(fy - cy - next * (gy - cy));
	};

	const pan = usePanGesture({
		minDistance: 4,
		onUpdate: (e) => {
			"worklet";
			tx.value += e.changeX;
			ty.value += e.changeY;
		},
	});
	const pinch = usePinchGesture({
		onUpdate: (e) => {
			"worklet";
			const before = s.value;
			const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, before * e.scaleChange));
			const gx = (e.focalX - tx.value - cx) / before + cx;
			const gy = (e.focalY - ty.value - cy) / before + cy;
			s.value = next;
			tx.value = e.focalX - cx - next * (gx - cx);
			ty.value = e.focalY - cy - next * (gy - cy);
		},
	});
	const tap = useTapGesture({
		runOnJS: true,
		onActivate: (e) => {
			const gx = (e.x - tx.value - cx) / s.value + cx;
			const gy = (e.y - ty.value - cy) / s.value + cy;
			const hit = laid.nodes.find((n) => gx >= n.x - 4 && gx <= n.x + n.width + 4 && gy >= n.y - 4 && gy <= n.y + n.height + 4);
			onSelect(hit && hit.kind !== "start" && hit.kind !== "left" ? hit.state : null);
		},
	});
	const gestures = useSimultaneousGestures(pan, pinch, tap);
	const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: s.value }] }));

	return (
		<View style={{ height, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border, overflow: "hidden", backgroundColor: p.background }} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
			<GestureDetector gesture={gestures}>
				<View style={{ flex: 1 }} collapsable={false}>
					<Animated.View style={[{ position: "absolute", left: 0, top: 0, width: laid.width, height: laid.height }, style]}>
						<GraphSvg laid={laid} selected={selected} />
					</Animated.View>
				</View>
			</GestureDetector>
			<View style={{ position: "absolute", right: 8, bottom: 8, gap: 6 }}>
				<CanvasButton icon="add" label="Zoom in" onPress={() => zoomBy(1.3)} />
				<CanvasButton icon="remove" label="Zoom out" onPress={() => zoomBy(1 / 1.3)} />
				<CanvasButton icon="scan-outline" label="Fit" onPress={() => fitView(true)} />
			</View>
		</View>
	);
}

function CanvasButton({ icon, label, onPress }: { icon: "add" | "remove" | "scan-outline" | "expand-outline" | "contract-outline" | "swap-horizontal" | "swap-vertical"; label: string; onPress(): void }) {
	const p = useTheme();
	return (
		<Pressable onPress={onPress} hitSlop={4} accessibilityLabel={label} style={({ pressed }) => [{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: p.card, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border }, pressed && { opacity: 0.7 }]}>
			<Icon name={icon} size={17} color={p.foreground} />
		</Pressable>
	);
}

// What happened in a state, and its moves ----------------------------------------------------------------------------------

function NodeDetails({ node, graph, onClose, onPick }: { node: LaidNode; graph: GraphData; onClose(): void; onPick(state: string): void }) {
	const p = useTheme();
	const out = topEdges(
		graph.edges.filter((e) => e.from === node.state),
		12,
	);
	const into = topEdges(
		graph.edges.filter((e) => e.to === node.state),
		12,
	);
	const name = (id: string) => stateLines(id).join(" · ");
	const moveLine = (state: string, count: number, share: number | null, dwell: number | null, dir: "out" | "in") => (
		<Pressable key={`${dir}${state}`} onPress={() => state !== START && state !== LEFT && onPick(state)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3 }}>
			<Icon name={dir === "out" ? "arrow-forward" : "arrow-back"} size={12} color={p.mutedForeground} />
			<Txt variant="small" color={p.foreground} numberOfLines={1} style={{ flex: 1 }}>
				{name(state)}
			</Txt>
			<Txt variant="small">
				{fmtInt(count)}
				{share !== null ? ` · ${fmtPct(share)}` : ""}
				{dwell !== null ? ` · ${fmtDuration(dwell)}` : ""}
			</Txt>
		</Pressable>
	);
	return (
		<View style={{ gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border, backgroundColor: p.muted }}>
			<View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
				<View style={{ flex: 1, gap: 2 }}>
					<Txt style={{ fontWeight: "600" }}>{node.lines.join(" · ")}</Txt>
					<Txt variant="small">{meta(node)}</Txt>
				</View>
				<Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
					<Icon name="close" size={18} color={p.mutedForeground} />
				</Pressable>
			</View>
			<Txt variant="label">Moves out</Txt>
			{out.length ? out.map((e) => moveLine(e.to, e.count, e.share, node.state === START ? null : e.count ? e.dwellMs / e.count : 0, "out")) : <Txt variant="small">No moves out of this state.</Txt>}
			<Txt variant="label">Moves in</Txt>
			{into.length ? into.map((e) => moveLine(e.from, e.count, null, null, "in")) : <Txt variant="small">No moves into this state.</Txt>}
			<Txt variant="label">Top events here</Txt>
			{node.events.length ? (
				node.events.map((e) => (
					<Txt key={`${e.kind}/${e.name}`} variant="small" color={p.foreground}>
						{e.name} <Txt variant="small">({e.kind})</Txt> {fmtInt(e.count)}
					</Txt>
				))
			) : (
				<Txt variant="small">No custom, purchase or currency events logged in this state.</Txt>
			)}
			<Txt variant="label">Funnel steps here</Txt>
			{node.steps.length ? (
				node.steps.map((s) => (
					<Txt key={`${s.funnel}/${s.step}`} variant="small" color={p.foreground}>
						{s.funnel}: {s.step}{" "}
						<Txt variant="small">
							({fmtInt(s.count)}x, {fmtInt(s.players)} player{s.players === 1 ? "" : "s"})
						</Txt>
					</Txt>
				))
			) : (
				<Txt variant="small">No funnel steps logged in this state.</Txt>
			)}
		</View>
	);
}

/** The drawn graph with its controls, details panel and full-screen view. */
export function GraphView({ graph, maxEdges = 60, height = 460 }: { graph: GraphData; maxEdges?: number; height?: number }) {
	const p = useTheme();
	const insets = useSafeAreaInsets();
	const win = useWindowDimensions();
	const [direction, setDirection] = useState<"TB" | "LR">("TB");
	const [full, setFull] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const laid = useMemo(() => layoutGraph(graph, { maxEdges, direction }), [graph, maxEdges, direction]);
	useEffect(() => setSelected(null), [graph]);
	const picked = laid.nodes.find((n) => n.state === selected && n.kind !== "start" && n.kind !== "left");
	const flip = () => setDirection((d) => (d === "TB" ? "LR" : "TB"));
	const help = `${graph.path ? "Edges are numbered in the order the player moved; each state shows the time spent in it." : "Edges are moves, labelled count · average time before the move; thicker = more."} Tap a state for what happened there. Drag to pan, pinch to zoom.${laid.hiddenEdges > 0 ? ` ${fmtInt(laid.hiddenEdges)} smaller moves not drawn.` : ""}`;
	return (
		<View style={{ gap: space.sm }}>
			<View>
				<Canvas laid={laid} height={height} selected={selected} onSelect={setSelected} />
				<View style={{ position: "absolute", left: 8, bottom: 8, flexDirection: "row", gap: 6 }}>
					<CanvasButton icon="expand-outline" label="Full screen" onPress={() => setFull(true)} />
					<CanvasButton icon={direction === "TB" ? "swap-horizontal" : "swap-vertical"} label={direction === "TB" ? "Left to right" : "Top to bottom"} onPress={flip} />
				</View>
			</View>
			{picked ? <NodeDetails node={picked} graph={graph} onClose={() => setSelected(null)} onPick={setSelected} /> : null}
			<Txt variant="small">{help}</Txt>
			<Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)} statusBarTranslucent>
				<View style={{ flex: 1, backgroundColor: p.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
						<Txt variant="h3" style={{ flex: 1 }}>
							{graph.path ? "Session graph" : "Graph"}
						</Txt>
						<CanvasButton icon={direction === "TB" ? "swap-horizontal" : "swap-vertical"} label="Direction" onPress={flip} />
						<CanvasButton icon="contract-outline" label="Close full screen" onPress={() => setFull(false)} />
					</View>
					<View style={{ flex: 1, paddingHorizontal: space.sm }}>
						<Canvas laid={laid} height={Math.max(200, win.height - insets.top - insets.bottom - (picked ? 300 : 70))} selected={selected} onSelect={setSelected} />
					</View>
					{picked ? (
						<View style={{ maxHeight: 280, padding: space.sm }}>
							<Animated.ScrollView>
								<NodeDetails node={picked} graph={graph} onClose={() => setSelected(null)} onPick={setSelected} />
							</Animated.ScrollView>
						</View>
					) : null}
				</View>
			</Modal>
		</View>
	);
}
