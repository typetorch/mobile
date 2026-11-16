/**
 * Churn risk on the Players page (the web's components/ChurnRisk.tsx, query `churn`): how many players are active, at
 * risk, lapsing or churned, as of today over the last 90 days (the filter bar's other filters choose the players), and
 * the list of one bucket (`risk` in the route; DataTable `players-churn`) with the numbers behind each player's risk. A
 * row opens the player. For owners each player carries their notification opt-in; Export gives their UserIds.
 */
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { churnFilters, CHURN_DAYS, type ChurnBucket, type ChurnPlayer, type ChurnResult } from "@/api/tt/audience";
import { Badge, Txt } from "@/components/ui";
import { fmtInt, fmtPct, plural, shortId } from "@/lib/format";
import { radius, space, useTheme, type Palette } from "@/theme";

import { Note, openPlayer, Panel, QueryState } from "./bits";
import { PlayerHover } from "./cards";
import { useTTFilters, useTTRawQuery } from "./filters";
import { DataTable, type DataColumn } from "./table";
import { usePageParam } from "./view-link";

export const CHURN_LABELS: Record<ChurnBucket, { label: string; tone: keyof Pick<Palette, "good" | "warning" | "serious" | "critical">; hint: string }> = {
	active: { label: "Active", tone: "good", hint: "playing on their usual rhythm" },
	at_risk: { label: "At risk", tone: "warning", hint: "late for their usual gap between play days, or playing half as often as the two weeks before" },
	lapsing: { label: "Lapsing", tone: "serious", hint: "away 14+ days, or over 3x their usual gap" },
	churned: { label: "Churned", tone: "critical", hint: "away 28+ days" },
};
const BUCKETS = Object.keys(CHURN_LABELS) as ChurnBucket[];

export function ChurnBadge({ bucket }: { bucket: ChurnBucket }) {
	const p = useTheme();
	const b = CHURN_LABELS[bucket];
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: p.border }}>
			<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p[b.tone] }} />
			<Txt variant="small" color={p.foreground} style={{ fontSize: 11 }}>
				{b.label}
			</Txt>
		</View>
	);
}

const OPTIN: Record<string, string> = { subscribed: "Subscribed", not_subscribed: "Not subscribed" };

function churnColumns(backendId: string, withOptin: boolean, muted: string): DataColumn<ChurnPlayer>[] {
	return [
		{
			id: "pid",
			header: "Player",
			width: 130,
			accessor: (x) => x.pid,
			searchText: (x) => [x.uid !== undefined ? `UserId ${x.uid}` : "", x.name ?? "", x.displayName ?? ""].join(" "),
			cell: (x) => (
				<PlayerHover backendId={backendId} pid={x.pid} {...(x.uid !== undefined ? { uid: x.uid } : {})} {...(x.name ? { name: x.name } : {})} {...(x.displayName ? { displayName: x.displayName } : {})}>
					<View>
						<Txt variant="mono" style={{ fontSize: 11 }}>
							{shortId(x.pid, 10)}
						</Txt>
						{x.name ? (
							<Txt variant="small" style={{ fontSize: 10, color: muted }}>
								@{x.name}
							</Txt>
						) : x.uid !== undefined ? (
							<Txt variant="small" style={{ fontSize: 10, color: muted }}>
								UserId {x.uid}
							</Txt>
						) : null}
					</View>
				</PlayerHover>
			),
		},
		{ id: "bucket", header: "Risk", type: "enum", width: 96, accessor: (x) => CHURN_LABELS[x.bucket].label, cell: (x) => <ChurnBadge bucket={x.bucket} /> },
		{ id: "lastPlayed", header: "Last played", type: "date", width: 100, accessor: (x) => x.lastPlayed },
		{ id: "daysSince", header: "Days away", title: "Days since the last play day (UTC)", type: "number", width: 70, accessor: (x) => x.daysSince, cell: (x) => fmtInt(x.daysSince) },
		{
			id: "usualGap",
			header: "Usual gap",
			title: "The median days between their play days (one play day: none)",
			type: "number",
			width: 76,
			accessor: (x) => x.usualGap,
			format: (_v, x) => (x.usualGap === null ? "–" : plural(x.usualGap, "day")),
		},
		{ id: "playDays", header: "Play days", title: "Days with a session in the last 90 days", type: "number", width: 70, accessor: (x) => x.playDays, cell: (x) => fmtInt(x.playDays) },
		{
			id: "trend",
			header: "Last 14 d / before",
			title: "Play days in the last 14 days, and in the 14 days before",
			type: "number",
			width: 90,
			accessor: (x) => x.recentDays - x.priorDays,
			format: (_v, x) => `${x.recentDays} / ${x.priorDays}`,
		},
		...(withOptin
			? [
					{
						id: "optin",
						header: "Notifications",
						title: "The notification opt-in the backend learned from Roblox's replies to sends (owners only)",
						type: "enum",
						width: 100,
						accessor: (x: ChurnPlayer) => (x.optin ? (OPTIN[x.optin] ?? x.optin) : "Unknown"),
						cell: (x: ChurnPlayer) => (x.optin === "subscribed" ? <Badge label="Subscribed" tone="brand" /> : <Txt variant="small">{x.optin ? (OPTIN[x.optin] ?? x.optin) : "Unknown"}</Txt>),
					} satisfies DataColumn<ChurnPlayer>,
				]
			: []),
		{ id: "uid", header: "UserId", type: "text", width: 100, accessor: (x) => (x.uid === undefined ? null : String(x.uid)), defaultHidden: true },
		{ id: "firstPlayed", header: "First played", type: "date", width: 100, accessor: (x) => x.firstPlayed, defaultHidden: true },
	];
}

/** The four bucket tiles; the picked one is outlined. */
function BucketTiles({ data, picked, onPick }: { data: ChurnResult; picked: ChurnBucket; onPick(b: ChurnBucket): void }) {
	const p = useTheme();
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
			{BUCKETS.map((b) => {
				const row = data.buckets.find((x) => x.bucket === b);
				const payers = data.payers[b] ?? 0;
				const on = b === picked;
				return (
					<Pressable
						key={b}
						onPress={() => onPick(b)}
						accessibilityRole="button"
						accessibilityState={{ selected: on }}
						accessibilityHint={CHURN_LABELS[b].hint}
						style={{ flexGrow: 1, flexBasis: "45%", gap: 2, padding: space.sm, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? p.brand : p.border, backgroundColor: p.card }}
					>
						<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
							<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p[CHURN_LABELS[b].tone] }} />
							<Txt variant="small">{CHURN_LABELS[b].label}</Txt>
						</View>
						<Txt style={{ fontSize: 20, fontWeight: "700" }}>{fmtInt(row?.players ?? 0)}</Txt>
						<Txt variant="small">
							{fmtPct(row?.share ?? 0, 1)} of players{payers ? `, ${plural(payers, "payer")}` : ""}
						</Txt>
					</Pressable>
				);
			})}
		</View>
	);
}

export function ChurnRisk({ backendId }: { backendId: string }) {
	const p = useTheme();
	const { apiFilters } = useTTFilters(backendId);
	const [raw, setBucket] = usePageParam("risk", "at_risk");
	const bucket: ChurnBucket = raw in CHURN_LABELS ? (raw as ChurnBucket) : "at_risk";
	const filters = useMemo(() => churnFilters(apiFilters), [apiFilters]);
	const q = useTTRawQuery<ChurnResult>(backendId, "churn", { bucket, limit: 500 }, { filters, keepPrevious: true });
	const withOptin = Boolean(q.data?.list.some((x) => "optin" in x));
	const columns = useMemo(() => churnColumns(backendId, withOptin, p.mutedForeground), [backendId, withOptin, p.mutedForeground]);
	return (
		<Panel
			title="Churn risk"
			note={`Each player's last play day against their own usual gap between play days, as of today over the last ${CHURN_DAYS} days (the filter bar's other filters pick the players). Pick a bucket to list its players, the most play days first.`}
		>
			<QueryState q={q} isEmpty={(d) => d.players === 0} empty="No players in the last 90 days." rows={3}>
				{(data) => (
					<View style={{ gap: space.sm }}>
						<BucketTiles data={data} picked={bucket} onPick={setBucket} />
						<Note>
							{CHURN_LABELS[bucket].label}: {CHURN_LABELS[bucket].hint}. {data.more > 0 ? `The first ${fmtInt(data.list.length)} of ${fmtInt(data.total)}.` : `${plural(data.total, "player")}.`}
							{withOptin && bucket !== "active" ? ` ${plural(data.list.filter((x) => x.optin === "subscribed").length, "of them is", "of them are")} subscribed to notifications (a win-back send can reach them).` : ""}
						</Note>
						<DataTable id="players-churn" label="Churn risk players" columns={columns} data={data.list} rowId={(x) => x.pid} density="compact" onRowPress={(x) => openPlayer(backendId, x.pid)} />
					</View>
				)}
			</QueryState>
		</Panel>
	);
}
