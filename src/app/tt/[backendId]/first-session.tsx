/**
 * First session: signs that new players got lost in their first session, per zone and button (query `confusion`). Each
 * recording signal opens the Recordings screen's replay list for it (web ReplayLink: tab=replay, signal, zone / target;
 * the filter bar is the backend's, so it is kept), and the header links to the Recordings screen.
 */
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import type { ConfusionResult } from "@/api/tt/types";
import { List, Stat, StatGrid, Txt } from "@/components/ui";
import { Note, Panel, QueryState, ShareRow } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
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

/** Rows with a share: the share bar turns red at 50 %. */
function Shares<T>({ rows, label, value, share, sub, empty }: { rows: readonly T[]; label: (r: T) => string; value: (r: T) => string; share: (r: T) => number; sub: (r: T) => string; empty: string }) {
	if (!rows.length) return <Txt variant="muted">{empty}</Txt>;
	return (
		<List>
			{rows.map((r, i) => (
				<ShareRow key={i} label={label(r)} value={value(r)} share={share(r)} tone={share(r) >= 0.5 ? "critical" : undefined} sub={sub(r)} />
			))}
		</List>
	);
}

function Counts<T>({ rows, label, value, empty, onReplay }: { rows: readonly T[]; label: (r: T) => string; value: (r: T) => string; empty: string; onReplay?: (r: T) => void }) {
	if (!rows.length) return <Txt variant="muted">{empty}</Txt>;
	return (
		<List>
			{rows.map((r, i) => (
				<View key={i} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 8, paddingHorizontal: space.md }}>
					<Txt style={{ flex: 1 }} numberOfLines={2}>
						{label(r)}
					</Txt>
					<Txt variant="small">{value(r)}</Txt>
					{onReplay ? <LinkText label="Replays" onPress={() => onReplay(r)} /> : null}
				</View>
			))}
		</List>
	);
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
				<Shares rows={data.earlyLeave} label={(r) => r.zone} value={(r) => fmtPct(r.share)} share={(r) => r.share} sub={(r) => `${fmtInt(r.early)} early of ${fmtInt(r.sessions)} sessions`} empty="No finished first session in this range." />
			</Panel>
			<Panel title="Screen loops" note="Screens opened 3+ times in one first session.">
				<Shares rows={data.screenLoops} label={(r) => r.screen} value={(r) => fmtPct(r.share)} share={(r) => r.share} sub={(r) => `${fmtInt(r.loopSessions)} looped of ${fmtInt(r.sessions)} sessions · ${fmtInt(r.opens)} opens`} empty="No screens opened in first sessions." />
			</Panel>
			<Panel title="Back and forth" note="Two zones walked between 3+ times in one first session.">
				<Shares rows={data.backAndForth} label={(r) => `${r.a} / ${r.b}`} value={(r) => fmtPct(r.share)} share={(r) => r.share} sub={(r) => `${fmtInt(r.flagged)} flagged of ${fmtInt(r.sessions)} sessions`} empty="No zone changes in first sessions." />
			</Panel>
			<Panel title="From recordings" note="Idle 10 s+, camera spins (360 degrees in 6 s, not moving), 3 presses of one button in 2 s.">
				{rec.available ? (
					<View style={{ gap: space.md }}>
						<Txt variant="label">Idle in zone</Txt>
						<Counts rows={rec.idle ?? []} label={(r) => r.zone} value={(r) => `${fmtInt(r.count)}× · avg ${fmtNum(r.avgSeconds, 1)} s`} empty="No idle spots." onReplay={(r) => openReplays(backendId, "idle", r.zone)} />
						<Txt variant="label">Camera spins in zone</Txt>
						<Counts rows={rec.cameraSpin ?? []} label={(r) => r.zone} value={(r) => `${fmtInt(r.count)}×`} empty="No camera spins." onReplay={(r) => openReplays(backendId, "camera_spin", r.zone)} />
						<Txt variant="label">Button pressed again and again</Txt>
						<Counts rows={rec.repeatedClicks ?? []} label={(r) => r.button} value={(r) => `${fmtInt(r.count)}× · avg ${fmtNum(r.avgPresses, 1)} presses`} empty="No repeated clicks." onReplay={(r) => openReplays(backendId, "repeated_clicks", undefined, r.button)} />
					</View>
				) : (
					<Txt variant="muted">No recordings: {rec.reason ?? "none in this range"}.</Txt>
				)}
			</Panel>
		</>
	);
}
