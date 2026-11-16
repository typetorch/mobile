/**
 * Small charts drawn with react-native-svg (ships in Expo Go). A LineChart takes one or more time series, measures
 * its width, and shows the values under the finger (touch and drag to scrub).
 */
import { useMemo, useState } from "react";
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
}

const PAD = { top: 10, right: 8, bottom: 20, left: 40 };

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
}: {
	series: ChartSeries[];
	height?: number;
	format?: (v: number) => string;
	axisFormat?: (v: number) => string;
	timeLabel?: (t: number) => string;
	area?: boolean;
	/** Dashed vertical lines at these times (deploys, releases), drawn when inside the chart's span. */
	marks?: { t: number; color?: string }[];
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
				onResponderGrant={(e) => scrub(e.nativeEvent.locationX)}
				onResponderMove={(e) => scrub(e.nativeEvent.locationX)}
				onResponderRelease={() => setHover(null)}
				onResponderTerminate={() => setHover(null)}
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
						{times.length > 1
							? (marks ?? [])
									.filter((m) => m.t >= (times[0] as number) && m.t <= (times[times.length - 1] as number))
									.map((m, i) => <Line key={`m${i}`} x1={x(m.t)} x2={x(m.t)} y1={PAD.top} y2={PAD.top + plotH} stroke={m.color ?? p.warning} strokeWidth={1} strokeDasharray="2,3" opacity={0.8} />)
							: null}
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
									<Path d={line} stroke={colors[si]} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
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

/** Vertical bars over time (counts per bucket). `onPick`: called with the bar under the finger when it lifts. */
export function BarChart({
	points,
	height = 120,
	color,
	format = shortNumber,
	timeLabel = dayLabel,
	onPick,
}: {
	points: ChartPoint[];
	height?: number;
	color?: string;
	format?: (v: number) => string;
	timeLabel?: (t: number) => string;
	onPick?: (point: ChartPoint) => void;
}) {
	const p = useTheme();
	const [width, setWidth] = useState(0);
	const [hover, setHover] = useState<number | null>(null);
	const max = niceMax(Math.max(0, ...points.map((pt) => pt.v ?? 0)));
	const plotW = Math.max(1, width - PAD.left - PAD.right);
	const plotH = height - PAD.top - PAD.bottom;
	const slot = points.length ? plotW / points.length : plotW;
	const barW = Math.max(1, slot * 0.72);
	const c = color ?? p.brand;
	const pick = (px: number) => setHover(points.length ? Math.max(0, Math.min(points.length - 1, Math.floor((px - PAD.left) / slot))) : null);
	const hp = hover !== null ? points[hover] : undefined;
	const release = () => {
		if (onPick && hp) onPick(hp);
		setHover(null);
	};
	return (
		<View style={{ gap: 6 }}>
			<View
				style={{ height }}
				onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
				onStartShouldSetResponder={() => true}
				onMoveShouldSetResponder={() => true}
				onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
				onResponderMove={(e) => pick(e.nativeEvent.locationX)}
				onResponderRelease={release}
				onResponderTerminate={() => setHover(null)}
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
				</Txt>
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
