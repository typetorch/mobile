/**
 * A top-down map as SVG (port of the web explorer's pages/recordings/MapView.tsx), in cell units (x to the right, z
 * down): the walkable-area silhouette (every recorded sample's density), then each layer as a heatmap (shaded cells) or
 * dots (sized by count). A tap reports its column and row; overlays (the replay's path, dot and camera cone) draw in
 * studs through `toView`.
 *
 * Phone: thousands of cells as one <rect> each are slow in react-native-svg, so cells of one look (the same opacity,
 * or the same dot size, in 1/24 steps) are one <Path>. The web's per-cell hover title has no phone twin (the legend
 * has the counts; a tap picks the cell).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import Svg, { G, Path, Rect } from "react-native-svg";

import type { RecCell, RecFrame } from "@/api/tt/types";
import { radius, useTheme } from "@/theme";

import { maxCount, shade } from "./map";

export interface DrawnLayer {
	id: string;
	label: string;
	color: string;
	cells: RecCell[];
}

export type ToView = (x: number, z: number) => [number, number];

const STEPS = 24;

/** Cells grouped by a quantised value: one path per group. */
function grouped(cells: readonly RecCell[], value: (n: number) => number, shape: (c: number, r: number, v: number) => string): { v: number; d: string }[] {
	const groups = new Map<number, string[]>();
	for (const [c, r, n] of cells) {
		const v = Math.round(value(n) * STEPS) / STEPS;
		if (v <= 0) continue;
		let list = groups.get(v);
		if (!list) groups.set(v, (list = []));
		list.push(shape(c, r, v));
	}
	return [...groups.entries()].map(([v, parts]) => ({ v, d: parts.join("") }));
}

const square = (c: number, r: number) => `M${c} ${r}h1v1h-1z`;
const dot = (cx: number, cy: number, rad: number) => `M${cx - rad} ${cy}a${rad} ${rad} 0 1 0 ${2 * rad} 0a${rad} ${rad} 0 1 0 ${-2 * rad} 0z`;

export function MapView({
	frame,
	background,
	layers = [],
	mode = "heat",
	selected,
	onCellPress,
	overlay,
	label,
	maxHeight,
}: {
	frame: RecFrame;
	background: RecCell[];
	layers?: DrawnLayer[];
	mode?: "heat" | "dots";
	selected?: [number, number] | null;
	onCellPress?: (col: number, row: number) => void;
	overlay?: (toView: ToView) => ReactNode;
	label: string;
	/** dp (default 70% of the window's height, the web's max-h-[70vh]). */
	maxHeight?: number;
}) {
	const p = useTheme();
	const window = useWindowDimensions();
	const [width, setWidth] = useState(0);
	const toView: ToView = (x, z) => [(x - frame.minX) / frame.cell, (z - frame.minZ) / frame.cell];
	const limit = maxHeight ?? window.height * 0.7;
	// The drawing keeps the frame's aspect (the web's xMidYMid meet): as wide as the view, unless that is too tall.
	let w = width;
	let h = frame.cols > 0 ? (width * frame.rows) / frame.cols : 0;
	if (h > limit) {
		h = limit;
		w = (limit * frame.cols) / Math.max(1, frame.rows);
	}
	const bg = useMemo(() => {
		const max = maxCount(background);
		return grouped(background, (n) => 0.06 + 0.22 * shade(n, max, 0), square);
	}, [background]);
	const drawn = useMemo(
		() =>
			layers.map((layer) => {
				const max = maxCount(layer.cells);
				const paths =
					mode === "dots"
						? grouped(
								layer.cells,
								(n) => (0.15 + 0.6 * Math.sqrt(n / (max || 1))) / 0.75,
								(c, r, v) => dot(c + 0.5, r + 0.5, v * 0.75),
							)
						: grouped(layer.cells, (n) => shade(n, max), square);
				return { layer, paths };
			}),
		[layers, mode],
	);
	const fg = p.foreground;
	return (
		<View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%", alignItems: "center" }} accessible accessibilityRole="image" accessibilityLabel={label}>
			{w > 0 && h > 0 ? (
				<Pressable
					disabled={!onCellPress}
					onPress={(e) => {
						if (!onCellPress) return;
						const col = Math.floor((e.nativeEvent.locationX / w) * frame.cols);
						const row = Math.floor((e.nativeEvent.locationY / h) * frame.rows);
						if (col >= 0 && row >= 0 && col < frame.cols && row < frame.rows) onCellPress(col, row);
					}}
					style={{ width: w, height: h, borderRadius: radius.md, borderWidth: 1, borderColor: p.border, backgroundColor: p.scheme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)", overflow: "hidden" }}
				>
					<Svg width={w} height={h} viewBox={`0 0 ${frame.cols} ${frame.rows}`} preserveAspectRatio="xMidYMid meet" pointerEvents="none">
						<G fill={fg}>
							{bg.map((b) => (
								<Path key={`b${b.v}`} d={b.d} opacity={b.v} />
							))}
						</G>
						{drawn.map(({ layer, paths }) => (
							<G key={layer.id} fill={layer.color}>
								{paths.map((x) => (
									<Path key={x.v} d={x.d} opacity={mode === "dots" ? 0.85 : x.v} />
								))}
							</G>
						))}
						{selected ? <Rect x={selected[0]} y={selected[1]} width={1} height={1} fill="none" stroke={fg} strokeWidth={0.15} /> : null}
						{overlay?.(toView)}
					</Svg>
				</Pressable>
			) : null}
		</View>
	);
}
