/**
 * Deploy marks for the phone charts (the web's components/DeployMarkers.tsx): one dashed line per release, rollback,
 * promote, re-sign, kernel publish or backup refresh (GET /v1/fleet/marks) and per live event start and end (GET
 * /v1/live-events), with a small flag and a "#42 prod" label. A tap on a line opens its card (kind, seq, branch, build,
 * time, results) with "Open the deploy"; one remembered switch shows or hides them on every chart.
 *
 *   const deploys = useDeployMarks(backendId, { from, to }, branch);     // the marks in range, [] while hidden
 *   const card = useMarkCard(backendId);
 *   <LineChart marks={chartMarks(p, deploys.marks)} onMarkPress={card.open} />   // or BarChart
 *   {card.sheet}
 *   <DeployMarksToggle {...deploys} />
 */
import { router } from "expo-router";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { markDeploySeq, markLabel } from "@/api/tt/deploys";
import { liveEventMarks } from "@/api/tt/live-events";
import { MARK_KINDS, MARK_STYLE, markDetails, markTitle, type DeployMark, type MarkKind } from "@/api/tt/perf";
import type { ChartMark } from "@/charts/LineChart";
import { Button, Dot, Icon, Txt } from "@/components/ui";
import { fmtTime } from "@/lib/format";
import { space, useTheme, type Palette } from "@/theme";

import { useTTQuery } from "./hooks";
import { storedValue } from "./persist";
import { Sheet } from "./sheet";

// Shown or hidden (one switch for every chart, kept on the phone) -----------------------------------------------------------

const shownStore = storedValue<boolean>(
	"tt.deployMarks.shown",
	true,
	(text) => (text === "off" ? false : text === "on" ? true : undefined),
	(shown) => (shown ? null : "off"),
);

export function useDeployMarksShown(): [boolean, (shown: boolean) => void] {
	const shown = useSyncExternalStore(shownStore.subscribe, shownStore.get);
	return [shown, shownStore.set];
}

// The marks -----------------------------------------------------------------------------------------------------------------

export interface DeployMarks {
	/** What the charts draw: the marks in range, or [] while hidden. */
	marks: DeployMark[];
	/** Every mark in range, shown or not (the toggle's count). */
	all: DeployMark[];
	shown: boolean;
	setShown(shown: boolean): void;
	error: Error | null;
	loading: boolean;
}

/**
 * The marks in [from, to] (rounded out to whole minutes so the cache holds still), with the live events' start and end
 * lines. `branch` keeps that branch's releases and the place-wide marks. A backend without the fleet part (404) or
 * without live events: no marks, no error.
 */
export function useDeployMarks(backendId: string, range: { from: number; to: number } | null | undefined, branch?: string, options: { enabled?: boolean } = {}): DeployMarks {
	const [shown, setShown] = useDeployMarksShown();
	const from = range && Number.isFinite(range.from) ? Math.floor(range.from / 60_000) * 60_000 : null;
	const to = range && Number.isFinite(range.to) ? Math.ceil(range.to / 60_000) * 60_000 : null;
	const valid = from !== null && to !== null && to > from && to - from <= 366 * 86_400_000;
	const enabled = valid && (options.enabled ?? true);
	const query = useTTQuery(backendId, ["fleet", "marks", from, to, branch ?? ""], (api, s) => api.fleetMarks({ since: from as number, until: to as number, ...(branch ? { branch } : {}), limit: 1000 }, s), {
		enabled,
		retry: false,
		staleTime: 60_000,
	});
	const events = useTTQuery(backendId, ["live-events", "marks"], (api, s) => api.liveEvents(false, s), { enabled, retry: false, staleTime: 60_000 });
	const all = useMemo(() => {
		const marks = query.data ?? [];
		const extra = events.data && from !== null && to !== null ? liveEventMarks(events.data.events, from, to) : [];
		return extra.length ? [...marks, ...extra].sort((a, b) => a.at - b.at) : marks;
	}, [query.data, events.data, from, to]);
	return { marks: shown ? all : [], all, shown, setShown, error: query.error, loading: enabled && query.isPending };
}

/** A mark kind's color on the phone palette (the web's MARK_STYLE uses CSS variables). */
export function markColor(p: Palette, kind: MarkKind): string {
	switch (kind) {
		case "rollback":
			return p.destructive;
		case "kernel":
			return p.chart[3] ?? p.warning;
		case "backup":
			return p.chart[2] ?? p.warning;
		case "resign":
			return p.mutedForeground;
		case "promote":
			return p.chart[6] ?? p.warning;
		case "event":
			return p.chart[4] ?? p.good;
		default:
			return p.chart[0] ?? p.warning;
	}
}

const dashOf = (kind: MarkKind) => MARK_STYLE[kind].dash?.replace(" ", ",");

/**
 * The marks as chart lines: one per spot (a time, rounded to the minute), labelled "#42 prod" (+N when several share it);
 * a tap gets every mark of that line.
 */
export function chartMarks(p: Palette, marks: readonly DeployMark[]): ChartMark[] {
	const groups = new Map<number, DeployMark[]>();
	for (const m of marks) {
		const at = Math.floor(m.at / 60_000) * 60_000;
		groups.set(at, [...(groups.get(at) ?? []), m]);
	}
	return [...groups].map(([, ms]) => {
		const last = ms[ms.length - 1] as DeployMark;
		const dash = dashOf(last.kind);
		return { t: last.at, color: markColor(p, last.kind), ...(dash ? { dash } : {}), label: `${markLabel(last)}${ms.length > 1 ? ` +${ms.length - 1}` : ""}`, data: ms };
	});
}

/** The deploy marks a chart line carries (from chartMarks), or one mark. */
function marksOf(mark: ChartMark | DeployMark[]): DeployMark[] {
	if (Array.isArray(mark)) return mark;
	return Array.isArray(mark.data) ? (mark.data as DeployMark[]) : [];
}

/** Opens a release's deploy page (kernel and backup marks have none), or the Live events page for an event's mark. */
export function openMark(backendId: string, mark: DeployMark) {
	if (mark.kind === "event") {
		router.push(`/tt/${backendId}/live-events`);
		return;
	}
	const seq = markDeploySeq(mark);
	if (seq !== null) router.push(`/tt/${backendId}/deploy/${seq}`);
}

/** The card for a tapped line: each mark's title and details, and a button that opens its deploy (or the live events). */
export function MarkCardBody({ backendId, marks, onDone }: { backendId: string; marks: DeployMark[]; onDone(): void }) {
	const p = useTheme();
	return (
		<View style={{ gap: space.md }}>
			{marks
				.slice(-6)
				.reverse()
				.map((m) => {
					const seq = markDeploySeq(m);
					return (
						<View key={m.id} style={{ gap: 4, paddingLeft: space.sm, borderLeftWidth: 3, borderLeftColor: markColor(p, m.kind) }}>
							<Txt style={{ fontWeight: "600" }}>{markTitle(m)}</Txt>
							{markDetails(m).map((line) => (
								<Txt key={line} variant="small">
									{line}
								</Txt>
							))}
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: 2 }}>
								{seq !== null ? (
									<Button
										title={`Open deploy #${seq}`}
										small
										variant="brand"
										icon="rocket-outline"
										onPress={() => {
											onDone();
											openMark(backendId, m);
										}}
									/>
								) : null}
								{m.kind === "event" ? (
									<Button
										title="Live events"
										small
										icon="calendar-outline"
										onPress={() => {
											onDone();
											openMark(backendId, m);
										}}
									/>
								) : null}
							</View>
						</View>
					);
				})}
			{marks.length > 6 ? <Txt variant="small">and {marks.length - 6} earlier</Txt> : null}
		</View>
	);
}

/** A sheet for tapped marks: `open` takes a chart line (from chartMarks) or marks; render `sheet` once on the page. */
export function useMarkCard(backendId: string) {
	const [marks, setMarks] = useState<DeployMark[] | null>(null);
	const open = useCallback((mark: ChartMark | DeployMark[]) => {
		const ms = marksOf(mark);
		if (ms.length) setMarks(ms);
	}, []);
	const close = useCallback(() => setMarks(null), []);
	const sheet = (
		<Sheet open={!!marks} onClose={close} title={marks && marks.length > 1 ? `${marks.length} marks here` : "Mark"}>
			{marks ? <MarkCardBody backendId={backendId} marks={marks} onDone={close} /> : null}
		</Sheet>
	);
	return { open, sheet };
}

/** Show / hide the marks on every chart; nothing while there are none in range. */
export function DeployMarksToggle({ all, shown, setShown }: Pick<DeployMarks, "all" | "shown" | "setShown">) {
	const p = useTheme();
	if (!all.length) return null;
	return (
		<Pressable
			onPress={() => setShown(!shown)}
			hitSlop={6}
			accessibilityLabel={shown ? "Hide the deploy markers on the charts" : "Show the deploy markers on the charts"}
			style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: shown ? p.brand : p.border, backgroundColor: shown ? `${p.brand}18` : p.card }}
		>
			<Icon name={shown ? "eye-outline" : "eye-off-outline"} size={13} color={shown ? p.brand : p.mutedForeground} />
			<Txt variant="small" color={shown ? p.brand : p.mutedForeground}>
				Deploys ({all.length})
			</Txt>
		</Pressable>
	);
}

/** What the lines mean (the kinds in range, with their colours). */
export function MarkLegend({ marks }: { marks: readonly DeployMark[] }) {
	const p = useTheme();
	const counts = MARK_KINDS.map((kind) => ({ kind, n: marks.filter((m) => m.kind === kind).length })).filter((c) => c.n > 0);
	if (!counts.length) return null;
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
			{counts.map((c) => (
				<View key={c.kind} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
					<View style={{ width: 3, height: 12, backgroundColor: markColor(p, c.kind) }} />
					<Txt variant="small">
						{c.n} {MARK_STYLE[c.kind].label.toLowerCase()}
						{c.n === 1 ? "" : "s"}
					</Txt>
				</View>
			))}
		</View>
	);
}

/** The marks as a short list under charts; a tap opens a mark's card. */
export function MarkList({ backendId, marks }: { backendId: string; marks: DeployMark[] | undefined }) {
	const p = useTheme();
	const card = useMarkCard(backendId);
	if (!marks?.length) return null;
	return (
		<View style={{ gap: 4 }}>
			<Txt variant="label">Marks in this window (dashed lines; tap one)</Txt>
			{marks.slice(-12).map((m) => (
				<Pressable key={m.id} onPress={() => card.open([m])} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
					<Dot tone={m.kind === "rollback" ? "critical" : m.kind === "event" ? "good" : "warning"} size={6} />
					<Txt variant="small" style={{ flex: 1 }} numberOfLines={1} color={p.foreground}>
						{fmtTime(m.at).slice(5, 16)} · {markTitle(m)}
					</Txt>
					<Icon name="chevron-forward" size={12} color={p.mutedForeground} />
				</Pressable>
			))}
			{card.sheet}
		</View>
	);
}

export { markLabel };
