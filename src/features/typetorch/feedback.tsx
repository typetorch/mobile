/**
 * Player feedback pieces (web pages/feedback/shared.tsx, plans/32), shared by the Feedback page and the player page's
 * Feedback view: a rating drawn in its scale's own shape (thumbs, stars, a labelled scale such as the faces BAD..GREAT),
 * one scale's distribution, the trend (count per bucket as bars, the average normalised rating as a line under it), and
 * the list of submissions.
 */
import { View } from "react-native";

import type { FeedbackRow, FeedbackScaleSummary, FeedbackSummaryResult } from "@/api/tt/types";
import { Badge, Icon, Txt } from "@/components/ui";
import { BarChart, LineChart } from "@/charts/LineChart";
import { fmtAgo, fmtInt, fmtNum, fmtPct, fmtTime } from "@/lib/format";
import { radius, space, useTheme, type Palette } from "@/theme";

import { PidLink } from "./bits";

/** A readable scale name: the legacy rows say so. */
export function scaleName(s: { scale: string; legacy?: boolean }): string {
	return s.legacy || s.scale === "legacy_faces5" ? "Faces (legacy)" : s.scale || "(no scale)";
}

/** Good / middling / bad by the normalised rating (0..1). */
export function normTone(p: Palette, norm: number | null): string {
	if (norm === null) return p.mutedForeground;
	if (norm >= 0.67) return p.good;
	if (norm >= 0.34) return p.warning;
	return p.critical;
}

/** The rating as words. */
export function ratingText(row: Pick<FeedbackRow, "type" | "steps" | "r" | "label">): string {
	if (row.r === null) return "No rating";
	if (row.type === "thumbs") return row.label ?? (row.r ? "Thumbs up" : "Thumbs down");
	if (row.type === "stars") return `${row.r} of ${row.steps} stars`;
	return row.label ? `${row.label} (${row.r} of ${row.steps})` : `${row.r} of ${row.steps}`;
}

/** One rating in its scale's shape: a thumb, a row of stars, or the step's label (faces) with r / steps. */
export function Rating({ row }: { row: Pick<FeedbackRow, "type" | "steps" | "r" | "label" | "norm"> }) {
	const p = useTheme();
	const text = ratingText(row);
	if (row.r === null) {
		return (
			<View accessibilityLabel={text} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
				<Icon name="chatbox-ellipses-outline" size={14} color={p.mutedForeground} />
				<Txt variant="small">text only</Txt>
			</View>
		);
	}
	if (row.type === "thumbs") {
		const c = normTone(p, row.r ? 1 : 0);
		return (
			<View accessibilityLabel={text} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
				<Icon name={row.r ? "thumbs-up" : "thumbs-down"} size={16} color={c} />
				{row.label ? (
					<Txt variant="small" color={c} style={{ fontWeight: "600" }}>
						{row.label}
					</Txt>
				) : null}
			</View>
		);
	}
	if (row.type === "stars") {
		const steps = Math.max(1, Math.min(10, row.steps));
		return (
			<View accessibilityLabel={text} style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
				{Array.from({ length: steps }, (_, i) => (
					<Icon key={i} name={i < (row.r ?? 0) ? "star" : "star-outline"} size={14} color={i < (row.r ?? 0) ? p.warning : `${p.mutedForeground}66`} />
				))}
			</View>
		);
	}
	const c = normTone(p, row.norm);
	return (
		<View accessibilityLabel={text} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
			<View style={{ borderWidth: 1, borderColor: c, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
				<Txt variant="small" color={c} style={{ fontWeight: "700" }}>
					{row.label ?? String(row.r)}
				</Txt>
			</View>
			<Txt variant="small" style={{ fontSize: 11 }}>
				{row.r}/{row.steps}
			</Txt>
		</View>
	);
}

/** One scale's distribution: thumbs as up / down shares, stars and scales as a histogram per step with the average. */
export function Distribution({ scale }: { scale: FeedbackScaleSummary }) {
	const p = useTheme();
	const rated = scale.rated;
	if (scale.type === "thumbs") {
		const up = scale.counts.find((c) => c.r === 1)?.n ?? 0;
		const down = scale.counts.find((c) => c.r === 0)?.n ?? 0;
		const parts = [
			{ key: "up", icon: "thumbs-up" as const, label: scale.labels[1] ?? "Up", n: up, color: p.good },
			{ key: "down", icon: "thumbs-down" as const, label: scale.labels[0] ?? "Down", n: down, color: p.critical },
		];
		return (
			<View style={{ gap: space.sm }}>
				<View style={{ flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", backgroundColor: p.muted }}>
					{rated ? parts.map((x) => (x.n ? <View key={x.key} style={{ width: `${(x.n / rated) * 100}%`, backgroundColor: x.color }} /> : null)) : null}
				</View>
				<View style={{ flexDirection: "row", gap: space.md }}>
					{parts.map((x) => (
						<View key={x.key} style={{ flex: 1, gap: 2 }}>
							<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
								<Icon name={x.icon} size={14} color={x.color} />
								<Txt variant="small">{x.label}</Txt>
							</View>
							<Txt variant="h2">{rated ? fmtPct(x.n / rated, 0) : "–"}</Txt>
							<Txt variant="small">{fmtInt(x.n)}</Txt>
						</View>
					))}
				</View>
			</View>
		);
	}
	const max = Math.max(1, ...scale.counts.map((c) => c.n));
	return (
		<View style={{ gap: space.sm }}>
			{[...scale.counts].reverse().map((c) => {
				const norm = scale.steps > 1 ? (c.r - 1) / (scale.steps - 1) : 1;
				const name = c.label ?? (scale.type === "stars" ? `${c.r} star${c.r === 1 ? "" : "s"}` : String(c.r));
				return (
					<View key={c.r} accessibilityLabel={`${name}: ${fmtInt(c.n)}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						<View style={{ width: 84, flexDirection: "row", alignItems: "center", gap: 3 }}>
							{scale.type === "stars" ? <Icon name="star" size={12} color={p.warning} /> : null}
							<Txt variant="small" color={p.foreground} numberOfLines={1} style={{ flexShrink: 1, fontWeight: "600" }}>
								{name}
							</Txt>
						</View>
						<View style={{ flex: 1, height: 12, borderRadius: 3, backgroundColor: p.muted, overflow: "hidden" }}>
							<View style={{ height: 12, width: `${(c.n / max) * 100}%`, backgroundColor: normTone(p, norm), borderRadius: 3 }} />
						</View>
						<Txt variant="small" style={{ width: 72, textAlign: "right" }}>
							{fmtInt(c.n)} {rated ? fmtPct(c.n / rated, 0) : ""}
						</Txt>
					</View>
				);
			})}
			<Txt>
				Average <Txt style={{ fontWeight: "700" }}>{scale.avgR === null ? "–" : `${fmtNum(scale.avgR, 2)} / ${scale.steps}`}</Txt>
				{scale.avgNorm === null ? null : <Txt variant="muted"> ({fmtPct(scale.avgNorm, 0)} of the top)</Txt>}
			</Txt>
		</View>
	);
}

/** Count per bucket as bars, and under it the average normalised rating as a line (0-100 %, across scales). */
export function TrendChart({ summary }: { summary: FeedbackSummaryResult }) {
	const p = useTheme();
	const label = (t: number) => {
		const iso = new Date(t).toISOString();
		return summary.bucket === "hour" ? iso.slice(11, 16) : iso.slice(5, 10);
	};
	const counts = summary.trend.map((x) => ({ t: x.t, v: x.n }));
	const score = summary.trend.map((x) => ({ t: x.t, v: x.avgNorm === null ? null : Math.round(x.avgNorm * 1000) / 10 }));
	return (
		<View style={{ gap: space.sm }}>
			<Txt variant="small">Feedback per {summary.bucket}</Txt>
			<BarChart points={counts} height={130} color={p.chart[0]} timeLabel={label} format={(v) => fmtInt(v)} />
			<Txt variant="small">Average (% of top)</Txt>
			<LineChart series={[{ label: "Average (% of top)", color: p.chart[2], points: score }]} height={120} area={false} timeLabel={label} format={(v) => `${fmtNum(v, 1)}%`} />
		</View>
	);
}

/** "4m 05s" / "1h 12m" for play time in seconds. */
export function fmtPlay(seconds: number | null): string | null {
	if (seconds === null) return null;
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	if (m < 60) return `${m}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The submissions, newest first: rating, text, then who / when / device / play time / state / topic / ctx. */
export function FeedbackList({ backendId, rows, showPlayer = true }: { backendId: string; rows: FeedbackRow[]; showPlayer?: boolean }) {
	const p = useTheme();
	return (
		<View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.lg }}>
			{rows.map((row, i) => {
				const play = fmtPlay(row.play_s);
				return (
					<View key={`${row.t}-${row.pid}-${row.sid}-${row.scale}-${row.r}-${row.text ?? ""}-${i}`} style={{ gap: 6, padding: space.md, borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
						<View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
							<Rating row={row} />
							{row.topic ? <Badge label={row.topic} /> : null}
							{row.legacy ? <Badge label="legacy" /> : null}
							<View style={{ flex: 1 }} />
							<Txt variant="small" style={{ fontSize: 11 }}>
								{fmtAgo(row.t)}
							</Txt>
						</View>
						{row.text ? (
							<Txt selectable>
								{row.text}
								{row.len > row.text.length ? <Txt variant="small"> (cut, {fmtInt(row.len)} characters sent)</Txt> : null}
							</Txt>
						) : (
							<Txt variant="small">No text</Txt>
						)}
						<View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
							{showPlayer ? <PidLink backendId={backendId} pid={row.pid} {...(row.uid !== undefined ? { uid: row.uid } : {})} {...(row.name ? { name: row.name } : {})} {...(row.displayName ? { displayName: row.displayName } : {})} /> : null}
							<Txt variant="small">{fmtTime(row.t)}</Txt>
							{row.dev ? <Txt variant="small">{row.dev}</Txt> : null}
							{play ? <Txt variant="small">played {play}</Txt> : null}
							{row.state ? (
								<Txt variant="mono" style={{ fontSize: 11 }} numberOfLines={1}>
									{row.state}
								</Txt>
							) : null}
						</View>
						{row.ctx ? (
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
								{Object.entries(row.ctx).map(([k, v]) => (
									<View key={k} style={{ backgroundColor: p.muted, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
										<Txt variant="mono" style={{ fontSize: 11 }} color={p.mutedForeground}>
											{k}: {String(v)}
										</Txt>
									</View>
								))}
							</View>
						) : null}
					</View>
				);
			})}
		</View>
	);
}
