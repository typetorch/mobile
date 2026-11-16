/**
 * First session: signs that new players got lost in their first session, per zone and button (query `confusion`). Each
 * recording signal opens the Recordings screen's replay list for it (web ReplayLink: tab=replay, signal, zone / target;
 * the filter bar is the backend's, so it is kept), and the header links to the Recordings screen.
 */
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import type { ConfusionResult } from "@/api/tt/types";
import { Stat, StatGrid, Txt } from "@/components/ui";
import { Note, Panel, QueryState, ShareBar } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { space, useTheme } from "@/theme";

type Signal = "idle" | "camera_spin" | "repeated_clicks";

/** The Recordings screen's session list for one signal, to replay the sessions behind it. */
function openReplays(backendId: string, signal: Signal, zone?: string, target?: string) {
	const params: Record<string, string> = { tab: "replay", signal };
	if (zone && zone !== "(unknown)") params.zone = zone;
	if (target && target !== "(unknown)") params.target = target;
	router.push({ pathname: "/tt/[backendId]/recordings", params: { backendId, ...params } });
}

function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
	const p = useTheme();
	return (
		<Pressable onPress={onPress} hitSlop={8} accessibilityRole="link">
			<Txt variant="small" color={p.brand} style={{ textDecorationLine: "underline" }}>
				{label}
			</Txt>
		</Pressable>
	);
}

export default function FirstSessionScreen() {
	return <TTScreen title="First session">{({ backendId }) => <FirstSession backendId={backendId} />}</TTScreen>;
}

function FirstSession({ backendId }: { backendId: string }) {
	const q = useTTAnalytics(backendId, "confusion");
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Signs that new players got lost in their first session, per zone and button.</Note>
			<LinkText label="Maps, replays and quit autopsy" onPress={() => router.push({ pathname: "/tt/[backendId]/recordings", params: { backendId } })} />
			<QueryState q={q} isEmpty={(d) => d.firstSessions === 0} empty="No first sessions in this range.">
				{(data) => <Body backendId={backendId} data={data} />}
			</QueryState>
		</>
	);
}

type Idle = NonNullable<ConfusionResult["recordings"]["idle"]>[number];
type Spin = NonNullable<ConfusionResult["recordings"]["cameraSpin"]>[number];
type Clicks = NonNullable<ConfusionResult["recordings"]["repeatedClicks"]>[number];

/** A 0-1 share as a bar and a percentage (red from 50 %); it sorts by the share. */
function shareColumn<T>(id: string, header: string, get: (row: T) => number): DataColumn<T> {
	return {
		id,
		header,
		type: "number",
		width: 110,
		filter: false,
		accessor: get,
		format: (v) => fmtPct(v as number),
		cell: (row) => (
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
				<ShareBar share={get(row)} width={50} {...(get(row) >= 0.5 ? { tone: "critical" as const } : {})} />
				<Txt variant="small">{fmtPct(get(row))}</Txt>
			</View>
		),
	};
}

const count = <T,>(id: string, header: string, get: (row: T) => number, defaultHidden = false): DataColumn<T> => ({ id, header, type: "number", width: 76, accessor: get, cell: (row) => fmtInt(get(row)), defaultHidden });

const EARLY_LEAVE: DataColumn<ConfusionResult["earlyLeave"][number]>[] = [
	{ id: "zone", header: "Zone", width: 150, accessor: (r) => r.zone },
	count("sessions", "Sessions", (r) => r.sessions),
	count("early", "Early", (r) => r.early),
	shareColumn("share", "Share", (r) => r.share),
];

const SCREEN_LOOPS: DataColumn<ConfusionResult["screenLoops"][number]>[] = [
	{ id: "screen", header: "Screen", width: 150, accessor: (r) => r.screen },
	count("sessions", "Sessions", (r) => r.sessions),
	count("opens", "Opens", (r) => r.opens),
	count("loopSessions", "Looped sessions", (r) => r.loopSessions, true),
	shareColumn("share", "Looped", (r) => r.share),
];

const BACK_AND_FORTH: DataColumn<ConfusionResult["backAndForth"][number]>[] = [
	{ id: "zones", header: "Zones", width: 170, accessor: (r) => `${r.a} / ${r.b}` },
	count("sessions", "Sessions", (r) => r.sessions),
	count("flagged", "Flagged sessions", (r) => r.flagged, true),
	shareColumn("share", "Flagged", (r) => r.share),
];

/** The Replay column: opens the Recordings screen's session list for the signal. */
function replayColumn<T>(backendId: string, get: (row: T) => { signal: Signal; zone?: string; target?: string }): DataColumn<T> {
	return {
		id: "replay",
		header: "Replay",
		width: 70,
		accessor: () => "",
		filter: false,
		sortable: false,
		searchable: false,
		exportValue: () => null,
		cell: (row) => {
			const r = get(row);
			return <LinkText label="Replays" onPress={() => openReplays(backendId, r.signal, r.zone, r.target)} />;
		},
	};
}

const idleColumns = (backendId: string): DataColumn<Idle>[] => [
	{ id: "zone", header: "Idle in zone", width: 150, accessor: (r) => r.zone },
	count("count", "Times", (r) => r.count),
	{ id: "avg", header: "Avg", type: "number", width: 70, accessor: (r) => r.avgSeconds, format: (_v, r) => `${fmtNum(r.avgSeconds, 1)} s` },
	replayColumn<Idle>(backendId, (r) => ({ signal: "idle", zone: r.zone })),
];

const spinColumns = (backendId: string): DataColumn<Spin>[] => [
	{ id: "zone", header: "Camera spins in zone", width: 170, accessor: (r) => r.zone },
	count("count", "Times", (r) => r.count),
	replayColumn<Spin>(backendId, (r) => ({ signal: "camera_spin", zone: r.zone })),
];

const clickColumns = (backendId: string): DataColumn<Clicks>[] => [
	{ id: "button", header: "Button pressed again and again", width: 190, mono: true, accessor: (r) => r.button },
	count("count", "Times", (r) => r.count),
	{ id: "avgPresses", header: "Avg presses", type: "number", width: 80, accessor: (r) => r.avgPresses, format: (_v, r) => fmtNum(r.avgPresses, 1) },
	replayColumn<Clicks>(backendId, (r) => ({ signal: "repeated_clicks", target: r.button })),
];

/** One signal's table, `first-session-<id>` like the web. */
function SignalTable<T>({ id, rows, columns, empty }: { id: string; rows: readonly T[]; columns: DataColumn<T>[]; empty: string }) {
	return <DataTable id={`first-session-${id}`} label={id.replace(/-/g, " ")} columns={columns} data={rows} density="compact" empty={<Txt variant="muted">{empty}</Txt>} />;
}

function Body({ backendId, data }: { backendId: string; data: ConfusionResult }) {
	const rec = data.recordings;
	return (
		<>
			<StatGrid>
				<Stat label="First sessions" value={fmtInt(data.firstSessions)} />
				<Stat label="Players" value={fmtInt(data.players)} />
				<Stat
					label="Recorded sessions"
					value={rec.available ? fmtInt(rec.sessions ?? 0) : "none"}
					tone={rec.available ? undefined : "muted"}
					sub={rec.available ? `${fmtInt(rec.failedSessions ?? 0)} failed to decode` : rec.reason}
				/>
				<Stat label="Early leaves" value={fmtInt(data.earlyLeave.reduce((s, z) => s + z.early, 0))} sub="first sessions under 2 min" />
			</StatGrid>
			<Panel title="Early leaves by zone" note="Zone the first session ended in; early = under 2 minutes.">
				<SignalTable id="early-leave" rows={data.earlyLeave} columns={EARLY_LEAVE} empty="No finished first session in this range." />
			</Panel>
			<Panel title="Screen loops" note="Screens opened 3+ times in one first session.">
				<SignalTable id="screen-loops" rows={data.screenLoops} columns={SCREEN_LOOPS} empty="No screens opened in first sessions." />
			</Panel>
			<Panel title="Back and forth" note="Two zones walked between 3+ times in one first session.">
				<SignalTable id="back-and-forth" rows={data.backAndForth} columns={BACK_AND_FORTH} empty="No zone changes in first sessions." />
			</Panel>
			<Panel title="From recordings" note="Idle 10 s+, camera spins (360 degrees in 6 s, not moving), 3 presses of one button in 2 s. Replays opens the recorded sessions behind a row.">
				{rec.available ? (
					<View style={{ gap: space.md }}>
						<SignalTable id="idle" rows={rec.idle ?? []} columns={idleColumns(backendId)} empty="No idle spots." />
						<SignalTable id="camera-spin" rows={rec.cameraSpin ?? []} columns={spinColumns(backendId)} empty="No camera spins." />
						<SignalTable id="repeated-clicks" rows={rec.repeatedClicks ?? []} columns={clickColumns(backendId)} empty="No repeated clicks." />
					</View>
				) : (
					<Txt variant="muted">No recordings: {rec.reason ?? "none in this range"}.</Txt>
				)}
			</Panel>
		</>
	);
}
