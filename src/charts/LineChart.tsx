/**
 * Small charts drawn with react-native-svg (ships in Expo Go). A LineChart takes one or more time series, measures
 * its width, and shows the values under the finger (touch and drag to scrub).
 */
import { useMemo, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { Txt } from "@/components/ui";
import { font, useTheme } from "@/theme";

export interface ChartPoint {
	t: number;
	v: number | null;
}

export interface ChartSeries {
	label: string;
	points: ChartPoint[];
	color?: string;
	/** Drawn dashed (a previous period). */
	dashed?: boolean;
}

/** A vertical mark (a deploy, a live event): drawn dashed with a small flag; a tap near it calls `onMarkPress`. */
export interface ChartMark {
	t: number;
	color?: string;
	/** SVG dash pattern ("2,3"); default "2,3". */
	dash?: string;
	/** Short text beside the flag ("#42 prod"), drawn while a chart has at most 6 marks. */
	label?: string;
	/** Anything the tap handler needs (the deploy marks of this line). */
	data?: unknown;
}

const PAD = { top: 10, right: 8, bottom: 20, left: 40 };
/** How close (points) a tap must land to a mark to pick it instead of scrubbing. */
const MARK_HIT = 14;
const MAX_LABELLED = 6;

/** The dashed line, a flag on top and the label beside it. */
function MarkLine({ x, top, bottom, mark, fallback, labels, muted }: { x: number; top: number; bottom: number; mark: ChartMark; fallback: string; labels: boolean; muted: string }) {
	const color = mark.color ?? fallback;
	return (
		<G>
			<Line x1={x} x2={x} y1={top} y2={bottom} stroke={color} strokeWidth={1.25} strokeDasharray={mark.dash ?? "2,3"} opacity={0.9} />
			<Path d={`M${x - 4},${top} L${x + 4},${top} L${x},${top + 6} Z`} fill={color} />
			{labels && mark.label ? (
				<SvgText x={x + 6} y={top + 8} fontSize={9} fill={muted}>
					{mark.label}
				</SvgText>
			) : null}
		</G>
	);
}

export function niceMax(max: number): number {
	if (max <= 0) return 1;
	const exp = Math.pow(10, Math.floor(Math.log10(max)));
	const f = max / exp;
	const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
	return nice * exp;
}

export function shortNumber(n: number): string {
	const a = Math.abs(n);
	if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
	if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
	if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
	if (a > 0 && a < 1) return `${+n.toFixed(2)}`;
	return `${+n.toFixed(1)}`;
}

function dayLabel(t: number): string {
	const d = new Date(t);
	return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function LineChart({
	series,
	height = 160,
	format = shortNumber,
	axisFormat,
	timeLabel = dayLabel,
	area = true,
	marks,
	onMarkPress,
}: {
	series: ChartSeries[];
	height?: number;
	format?: (v: number) => string;
	axisFormat?: (v: number) => string;
	timeLabel?: (t: number) => string;
	area?: boolean;
	/** Dashed vertical lines at these times (deploys, releases), drawn when inside the chart's span. */
	marks?: ChartMark[];
	/** A tap on (near) a mark. */
	onMarkPress?: (mark: ChartMark) => void;
}) {
	const p = useTheme();
	const [width, setWidth] = useState(0);
	const [hover, setHover] = useState<number | null>(null);

	const times = useMemo(() => Array.from(new Set(series.flatMap((s) => s.points.map((pt) => pt.t)))).sort((a, b) => a - b), [series]);
	const maxV = useMemo(() => niceMax(Math.max(0, ...series.flatMap((s) => s.points.map((pt) => pt.v ?? 0)))), [series]);
	const minV = useMemo(() => Math.min(0, ...series.flatMap((s) => s.points.map((pt) => pt.v ?? 0))), [series]);

	const plotW = Math.max(1, width - PAD.left - PAD.right);
	const plotH = height - PAD.top - PAD.bottom;
	const x = (t: number) => {
		if (times.length <= 1) return PAD.left + plotW / 2;
		const t0 = times[0] as number;
		const t1 = times[times.length - 1] as number;
		return PAD.left + ((t - t0) / (t1 - t0)) * plotW;
	};
	const y = (v: number) => PAD.top + plotH - ((v - minV) / (maxV - minV || 1)) * plotH;

	const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
	const t0 = times[0];
	const t1 = times[times.length - 1];
	const inMarks = times.length > 1 && t0 !== undefined && t1 !== undefined ? (marks ?? []).filter((m) => m.t >= t0 && m.t <= t1) : [];
	const touch = useRef<{ x: number; moved: boolean } | null>(null);
	const markAt = (px: number) => {
		let best: ChartMark | undefined;
		let bestD = MARK_HIT;
		for (const m of inMarks) {
			const d = Math.abs(x(m.t) - px);
			if (d <= bestD) {
				bestD = d;
				best = m;
			}
		}
		return best;
	};
	const release = () => {
		const start = touch.current;
		touch.current = null;
		setHover(null);
		if (start && !start.moved && onMarkPress) {
			const m = markAt(start.x);
			if (m) onMarkPress(m);
		}
	};
	const scrub = (px: number) => {
		if (!times.length) return;
		let best = 0;
		let bestD = Infinity;
		times.forEach((t, i) => {
			const d = Math.abs(x(t) - px);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		});
		setHover(best);
	};

	const colors = series.map((s, i) => s.color ?? p.chart[i % p.chart.length] ?? p.brand);
	const hoverT = hover !== null ? times[hover] : undefined;
	const yTicks = [0, 0.5, 1].map((f) => minV + (maxV - minV) * f);

	return (
		<View style={{ gap: 6 }}>
			<View
				onLayout={onLayout}
				style={{ height }}
				onStartShouldSetResponder={() => true}
				onMoveShouldSetResponder={() => true}
				onResponderGrant={(e) => {
					touch.current = { x: e.nativeEvent.locationX, moved: false };
					scrub(e.nativeEvent.locationX);
				}}
				onResponderMove={(e) => {
					if (touch.current && Math.abs(e.nativeEvent.locationX - touch.current.x) > 6) touch.current.moved = true;
					scrub(e.nativeEvent.locationX);
				}}
				onResponderRelease={release}
				onResponderTerminate={() => {
					touch.current = null;
					setHover(null);
				}}
			>
				{width > 0 ? (
					<Svg width={width} height={height}>
						{yTicks.map((v, i) => (
							<G key={i}>
								<Line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke={p.border} strokeWidth={1} />
								<SvgText x={PAD.left - 6} y={y(v) + 3} fontSize={font.xs - 1} fill={p.mutedForeground} textAnchor="end">
									{(axisFormat ?? format)(v)}
								</SvgText>
							</G>
						))}
						{times.length ? (
							<>
								<SvgText x={PAD.left} y={height - 4} fontSize={font.xs - 1} fill={p.mutedForeground} textAnchor="start">
									{timeLabel(times[0] as number)}
								</SvgText>
								<SvgText x={width - PAD.right} y={height - 4} fontSize={font.xs - 1} fill={p.mutedForeground} textAnchor="end">
									{timeLabel(times[times.length - 1] as number)}
								</SvgText>
							</>
						) : null}
						{inMarks.map((m, i) => (
							<MarkLine key={`m${i}`} x={x(m.t)} top={PAD.top} bottom={PAD.top + plotH} mark={m} fallback={p.warning} labels={inMarks.length <= MAX_LABELLED} muted={p.mutedForeground} />
						))}
						{series.map((s, si) => {
							const pts = s.points.filter((pt) => pt.v !== null).sort((a, b) => a.t - b.t);
							if (!pts.length) return null;
							const line = pts.map((pt, i) => `${i ? "L" : "M"}${x(pt.t).toFixed(1)},${y(pt.v as number).toFixed(1)}`).join(" ");
							const fill =
								area && series.length === 1 && pts.length > 1
									? `${line} L${x((pts[pts.length - 1] as ChartPoint).t).toFixed(1)},${y(Math.max(0, minV)).toFixed(1)} L${x((pts[0] as ChartPoint).t).toFixed(1)},${y(Math.max(0, minV)).toFixed(1)} Z`
									: null;
							return (
								<G key={si}>
									{fill ? <Path d={fill} fill={colors[si]} opacity={0.12} /> : null}
									<Path d={line} stroke={colors[si]} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? "4,3" : undefined} fill="none" strokeLinejoin="round" strokeLinecap="round" />
									{pts.length === 1 ? <Circle cx={x((pts[0] as ChartPoint).t)} cy={y((pts[0] as ChartPoint).v as number)} r={3} fill={colors[si]} /> : null}
								</G>
							);
						})}
						{hoverT !== undefined ? (
							<G>
								<Line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={PAD.top + plotH} stroke={p.mutedForeground} strokeWidth={1} strokeDasharray="3,3" />
								{series.map((s, si) => {
									const pt = s.points.find((q) => q.t === hoverT);
									return pt && pt.v !== null ? <Circle key={si} cx={x(hoverT)} cy={y(pt.v)} r={3.5} fill={colors[si]} stroke={p.background} strokeWidth={1.5} /> : null;
								})}
							</G>
						) : null}
					</Svg>
				) : null}
			</View>
			{hoverT !== undefined ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
					<Txt variant="small">{timeLabel(hoverT)}</Txt>
					{series.map((s, si) => {
						const pt = s.points.find((q) => q.t === hoverT);
						return (
							<Txt key={si} variant="small" color={colors[si]}>
								{series.length > 1 ? `${s.label}: ` : ""}
								{pt && pt.v !== null ? format(pt.v) : "–"}
							</Txt>
						);
					})}
				</View>
			) : series.length > 1 ? (
				<Legend items={series.map((s, i) => ({ label: s.label, color: colors[i] as string }))} />
			) : null}
		</View>
	);
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
			{items.map((it, i) => (
				<View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
					<View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: it.color }} />
					<Txt variant="small" numberOfLines={1}>
						{it.label}
					</Txt>
				</View>
			))}
		</View>
	);
}

/**
 * Vertical bars over time (counts per bucket; the web's DayBars). `onPick`: called with the bar under the finger when it
 * lifts. `previous`: the period before, one value per bar (its first step over the first bar), drawn as a dashed line.
 * `marks`: each on the bar it falls in (bars run from their time to the next bar's); a tap near one calls `onMarkPress`.
 */
export function BarChart({
	points,
	height = 120,
	color,
	format = shortNumber,
	timeLabel = dayLabel,
	onPick,
	previous,
	previousLabel = "Previous period",
	marks,
	onMarkPress,
}: {
	points: ChartPoint[];
	height?: number;
	color?: string;
	format?: (v: number) => string;
	timeLabel?: (t: number) => string;
	onPick?: (point: ChartPoint) => void;
	previous?: (number | null)[];
	previousLabel?: string;
	marks?: ChartMark[];
	onMarkPress?: (mark: ChartMark) => void;
}) {
	const p = useTheme();
	const [width, setWidth] = useState(0);
	const [hover, setHover] = useState<number | null>(null);
	const touch = useRef<{ x: number; moved: boolean } | null>(null);
	const max = niceMax(Math.max(0, ...points.map((pt) => pt.v ?? 0), ...(previous ?? []).map((v) => v ?? 0)));
	const plotW = Math.max(1, width - PAD.left - PAD.right);
	const plotH = height - PAD.top - PAD.bottom;
	const slot = points.length ? plotW / points.length : plotW;
	const barW = Math.max(1, slot * 0.72);
	const c = color ?? p.brand;
	const indexAt = (px: number) => (points.length ? Math.max(0, Math.min(points.length - 1, Math.floor((px - PAD.left) / slot))) : null);
	const pick = (px: number) => setHover(indexAt(px));
	const hp = hover !== null ? points[hover] : undefined;
	const starts = points.map((pt) => pt.t);
	// One line per bar that has marks (the bar's last mark's style; the tap gets them all through `data`).
	const placed = useMemo(() => {
		const out = new Map<number, ChartMark>();
		if (!marks?.length || !points.length) return out;
		const last = starts[starts.length - 1] as number;
		const step = starts.length > 1 ? last - (starts[starts.length - 2] as number) : 86_400_000;
		for (const m of marks) {
			if (!(m.t >= (starts[0] as number)) || m.t >= last + step) continue;
			let i = 0;
			while (i + 1 < starts.length && (starts[i + 1] as number) <= m.t) i++;
			const before = out.get(i);
			// Several lines on one bar: one line, every mark in its tap (the web groups them per bar too).
			if (before && Array.isArray(before.data) && Array.isArray(m.data)) {
				const data = [...(before.data as unknown[]), ...(m.data as unknown[])];
				out.set(i, { ...m, data, ...(m.label ? { label: `${m.label.replace(/ \+\d+$/, "")} +${data.length - 1}` } : {}) });
			} else out.set(i, m);
		}
		return out;
	}, [marks, points]);
	const barX = (i: number) => PAD.left + i * slot + slot / 2;
	const markNear = (px: number) => {
		let best: ChartMark | undefined;
		let bestD = MARK_HIT;
		for (const [i, m] of placed) {
			const d = Math.abs(barX(i) - px);
			if (d <= bestD) {
				bestD = d;
				best = m;
			}
		}
		return best;
	};
	const release = () => {
		const start = touch.current;
		touch.current = null;
		const m = start && !start.moved && onMarkPress ? markNear(start.x) : undefined;
		if (m && onMarkPress) onMarkPress(m);
		else if (onPick && hp) onPick(hp);
		setHover(null);
	};
	const prevPath = previous
		? previous
				.map((v, i) => (v === null || v === undefined || i >= points.length ? null : `${barX(i).toFixed(1)},${(PAD.top + plotH - (v / max) * plotH).toFixed(1)}`))
				.reduce<string[]>((parts, pt, i, all) => {
					if (pt === null) return parts;
					parts.push(`${i > 0 && all[i - 1] !== null ? "L" : "M"}${pt}`);
					return parts;
				}, [])
				.join(" ")
		: "";
	const prevAt = hover !== null && previous ? previous[hover] : undefined;
	return (
		<View style={{ gap: 6 }}>
			<View
				style={{ height }}
				onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
				onStartShouldSetResponder={() => true}
				onMoveShouldSetResponder={() => true}
				onResponderGrant={(e) => {
					touch.current = { x: e.nativeEvent.locationX, moved: false };
					pick(e.nativeEvent.locationX);
				}}
				onResponderMove={(e) => {
					if (touch.current && Math.abs(e.nativeEvent.locationX - touch.current.x) > 6) touch.current.moved = true;
					pick(e.nativeEvent.locationX);
				}}
				onResponderRelease={release}
				onResponderTerminate={() => {
					touch.current = null;
					setHover(null);
				}}
			>
				{width > 0 ? (
					<Svg width={width} height={height}>
						{[0, 0.5, 1].map((f, i) => {
							const yy = PAD.top + plotH - f * plotH;
							return (
								<G key={i}>
									<Line x1={PAD.left} x2={width - PAD.right} y1={yy} y2={yy} stroke={p.border} strokeWidth={1} />
									<SvgText x={PAD.left - 6} y={yy + 3} fontSize={font.xs - 1} fill={p.mutedForeground} textAnchor="end">
										{format(max * f)}
									</SvgText>
								</G>
							);
						})}
						{points.map((pt, i) => {
							const h = ((pt.v ?? 0) / max) * plotH;
							return <Rect key={i} x={PAD.left + i * slot + (slot - barW) / 2} y={PAD.top + plotH - h} width={barW} height={Math.max(h, pt.v ? 1 : 0)} rx={Math.min(2, barW / 2)} fill={c} opacity={hover === null || hover === i ? 1 : 0.45} />;
						})}
						{prevPath ? <Path d={prevPath} stroke={p.mutedForeground} strokeWidth={1.5} strokeDasharray="4,3" fill="none" /> : null}
						{[...placed].map(([i, m]) => (
							<MarkLine key={`m${i}`} x={barX(i)} top={PAD.top} bottom={PAD.top + plotH} mark={m} fallback={p.warning} labels={placed.size <= MAX_LABELLED} muted={p.mutedForeground} />
						))}
						{points.length ? (
							<>
								<SvgText x={PAD.left} y={height - 4} fontSize={font.xs - 1} fill={p.mutedForeground}>
									{timeLabel((points[0] as ChartPoint).t)}
								</SvgText>
								<SvgText x={width - PAD.right} y={height - 4} fontSize={font.xs - 1} fill={p.mutedForeground} textAnchor="end">
									{timeLabel((points[points.length - 1] as ChartPoint).t)}
								</SvgText>
							</>
						) : null}
					</Svg>
				) : null}
			</View>
			{hp ? (
				<Txt variant="small">
					{timeLabel(hp.t)}: {hp.v === null ? "–" : format(hp.v)}
					{previous ? ` · ${previousLabel.toLowerCase()} ${prevAt === null || prevAt === undefined ? "–" : format(prevAt)}` : ""}
				</Txt>
			) : previous ? (
				<Legend
					items={[
						{ label: "This period", color: c },
						{ label: `${previousLabel} (dashed)`, color: p.mutedForeground },
					]}
				/>
			) : null}
		</View>
	);
}

/** A tiny inline trend line (error kinds, list rows). */
export function Sparkline({ values, width = 64, height = 20, color }: { values: number[]; width?: number; height?: number; color?: string }) {
	const p = useTheme();
	if (values.length < 2) return <View style={{ width, height }} />;
	const max = Math.max(1, ...values);
	const step = width / (values.length - 1);
	const d = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - 1 - (v / max) * (height - 2)).toFixed(1)}`).join(" ");
	return (
		<Svg width={width} height={height}>
			<Path d={d} stroke={color ?? p.brand} strokeWidth={1.5} fill="none" />
		</Svg>
	);
}

/** Horizontal share bars (a breakdown table: label, bar, value). */
export function ShareBars({ rows, format = shortNumber, color }: { rows: { label: string; value: number }[]; format?: (v: number) => string; color?: string }) {
	const p = useTheme();
	const max = Math.max(1, ...rows.map((r) => r.value));
	return (
		<View style={{ gap: 8 }}>
			{rows.map((r, i) => (
				<View key={i} style={{ gap: 3 }}>
					<View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
						<Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>
							{r.label}
						</Txt>
						<Txt variant="small" color={p.foreground}>
							{format(r.value)}
						</Txt>
					</View>
					<View style={{ height: 4, borderRadius: 2, backgroundColor: p.muted }}>
						<View style={{ height: 4, borderRadius: 2, width: `${(r.value / max) * 100}%`, backgroundColor: color ?? p.chart[i % p.chart.length] }} />
					</View>
				</View>
			))}
		</View>
	);
}
