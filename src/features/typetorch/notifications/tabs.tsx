/**
 * The Notifications screen's tabs (ports of the web's pages/notifications/{HealthTab,FunnelTab,InboxTab,SubscribersTab,
 * KindsTab,QueueTab,SettingsTab}.tsx). Owner-only parts (Inbox, Subscribers, Settings, the live queue, the switches)
 * are only rendered for owners; the backend answers 403 to the read-only role either way.
 */
import { keepPreviousData, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { NotifyConfigView, NotifyFunnelCounts, NotifyFunnelResult, NotifyOptinResult, NotifyOptinState, NotifyOptinTotals, NotifyOptinUser, NotifyQueueFailure, NotifyQueueResult, NotifyRecentSend, NotifyStatus, NotifyUserView } from "@/api/tt/types";
import { LineChart, Sparkline } from "@/charts/LineChart";
import { Badge, Button, Card, Chips, confirm, ErrorState, Field, KV, SearchBar, Section, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { JsonBlock, ShareBar } from "@/features/typetorch/bits";
import { shareFile } from "@/features/typetorch/files";
import { useTTQuery } from "@/features/typetorch/hooks";
import { JoinData } from "@/features/typetorch/join-data";
import { Sheet } from "@/features/typetorch/sheet";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParams } from "@/features/typetorch/view-link";
import { fmtAgo, fmtInt, fmtPct, fmtTime, plural } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { radius, space, useTheme, type Tone } from "@/theme";

import { PlayerPanel, SendDetail, useNotifyUser, Who } from "./player";
import { fillText, healthSentence, initials, NOTIFY_CONFIG_KEY, NOTIFY_USERS_COUNTS_KEY, StatStrip, StatusDot, SubscriberBar, useNotifySettings, type AttentionItem, type NotifyTab } from "./shared";
import { ChoiceChips, OnOff } from "../settings/controls";

const dayTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const hourTime = (iso: string) => Date.parse(iso);
const dayLabel = (t: number) => new Date(t).toISOString().slice(5, 10);
const hourLabel = (t: number) => new Date(t).toISOString().slice(11, 16);

// Health ---------------------------------------------------------------------------------------------------------------

const ISSUE: Record<AttentionItem["level"], { label: string; tone: Tone }> = { error: { label: "error", tone: "critical" }, warn: { label: "warn", tone: "warning" }, info: { label: "info", tone: "muted" } };
const TAB_NAMES: Record<NotifyTab, string> = { health: "Health", funnel: "the funnel", inbox: "the inbox", subscribers: "subscribers", kinds: "kinds", queue: "errors", settings: "settings" };

function Trend({ label, value, values, sub }: { label: string; value: string; values: number[]; sub: string }) {
	return (
		<Card style={{ gap: 4, flexGrow: 1, flexBasis: "45%" }}>
			<Txt variant="small">{label}</Txt>
			<Txt style={{ fontSize: 22, fontWeight: "700" }}>{value}</Txt>
			<Sparkline values={values} width={150} height={30} />
			<Txt variant="small">{sub}</Txt>
		</Card>
	);
}

export function HealthTab({
	status,
	funnel,
	counts,
	countsNote,
	items,
	goTab,
	owner,
}: {
	status: NotifyStatus | undefined;
	funnel: NotifyFunnelResult | undefined;
	counts: Pick<NotifyOptinTotals, "subscribed" | "notSubscribed" | "unknown"> | undefined;
	countsNote?: string | undefined;
	items: AttentionItem[];
	goTab(tab: NotifyTab): void;
	owner: boolean;
}) {
	const p = useTheme();
	const s = healthSentence(status, funnel);
	const daily = funnel?.daily ?? [];
	const t = funnel?.totals;
	const looks = items.filter((i) => i.level !== "info").length;
	return (
		<View style={{ gap: space.md }}>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<StatusDot level={s.level} />
					<Txt variant="small">{looks ? `${looks} to look at` : "All good"}</Txt>
				</View>
				<Txt>
					<Txt style={{ fontWeight: "600" }}>{s.lead}</Txt> {s.rest}
				</Txt>
			</Card>
			<Card style={{ gap: 8 }}>
				<Txt variant="small">Who can get notifications</Txt>
				{counts ? <SubscriberBar counts={counts} /> : <Txt variant="muted">The opt-in list is for owners.</Txt>}
				{countsNote ? <Txt variant="small">{countsNote}</Txt> : null}
				{owner ? <Button title="See the list" small icon="arrow-forward" onPress={() => goTab("subscribers")} style={{ alignSelf: "flex-start" }} /> : null}
			</Card>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
				<Trend label="Opened" value={t?.sent ? fmtPct(t.openRate) : "–"} values={daily.map((d) => (d.sent ? d.opened / d.sent : 0))} sub="share of sends opened, per day" />
				<Trend label="Back next day" value={t?.players ? fmtPct(t.returnRate) : "–"} values={daily.map((d) => d.returnRate)} sub={`+${fmtInt(t?.assisted ?? 0)} assisted (back without opening)`} />
			</View>
			<Section title="Needs attention">
				<Txt variant="small">From the live status and the range's queue and opt-in rows.</Txt>
				{items.length ? (
					items.map((item) => (
						<Card key={item.id} style={{ gap: 4 }}>
							<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
								<Badge label={ISSUE[item.level].label} tone={ISSUE[item.level].tone} />
								<Txt style={{ fontWeight: "600", flex: 1 }}>{item.title}</Txt>
							</View>
							<Txt variant="small">{item.detail}</Txt>
							{item.tab !== "health" && (owner || (item.tab !== "settings" && item.tab !== "inbox" && item.tab !== "subscribers")) ? (
								<Pressable onPress={() => goTab(item.tab)} hitSlop={6}>
									<Txt variant="small" color={p.brand} style={{ fontWeight: "600" }}>
										See {TAB_NAMES[item.tab]}
									</Txt>
								</Pressable>
							) : null}
						</Card>
					))
				) : (
					<Txt variant="muted">Nothing needs a look right now.</Txt>
				)}
			</Section>
			{owner ? null : <Txt variant="small">The live queue and the controls are for owners.</Txt>}
		</View>
	);
}

// Funnel ---------------------------------------------------------------------------------------------------------------

export interface FunnelStep {
	label: string;
	n: number;
	rate: number | null;
}

export function funnelSteps(funnel: NotifyFunnelResult, optin: NotifyOptinResult | undefined): FunnelStep[] {
	const t = funnel.totals;
	const raw: [string, number][] = [
		...(optin
			? ([
					["Prompt shown", optin.totals.shown],
					["Subscribed", optin.totals.subscribed],
				] as [string, number][])
			: []),
		["Sent", t.sent],
		["Opened", t.opened],
		["Played 1 min+", t.played],
		["Back next day", t.returnedD1],
	];
	return raw.map(([label, n], i) => {
		const before = i ? (raw[i - 1]?.[1] ?? 0) : 0;
		return { label, n, rate: i && before > 0 ? n / before : null };
	});
}

function Steps({ steps }: { steps: FunnelStep[] }) {
	const p = useTheme();
	const max = Math.max(1, ...steps.map((s) => s.n));
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
			{steps.map((s, i) => (
				<View key={s.label} style={{ width: "30%", flexGrow: 1, gap: 2 }}>
					<View style={{ height: 80, justifyContent: "flex-end" }}>
						<View style={{ height: `${Math.max(4, (s.n / max) * 100)}%`, backgroundColor: p.brand, opacity: 1 - i * 0.1, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
					</View>
					<Txt style={{ fontWeight: "700" }}>{fmtInt(s.n)}</Txt>
					<Txt variant="small" numberOfLines={1}>
						{s.label}
					</Txt>
					<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
						{s.rate === null ? (i ? "–" : " ") : fmtPct(s.rate, 0)}
					</Txt>
				</View>
			))}
		</View>
	);
}

function Insight({ title, headline, detail }: { title: string; headline: string; detail: string }) {
	return (
		<Card style={{ gap: 2 }}>
			<Txt variant="small">{title}</Txt>
			<Txt style={{ fontWeight: "600" }}>{headline}</Txt>
			<Txt variant="small">{detail}</Txt>
		</Card>
	);
}

type WhereRow = NotifyOptinResult["byWhere"][number];
const WHERE_COLUMNS: DataColumn<WhereRow>[] = [
	{ id: "where", header: "Spot", accessor: (r) => r.where, format: (_v, r) => r.where || "(none)", mono: true },
	{ id: "checks", header: "Checks", type: "number", accessor: (r) => r.checks },
	{ id: "canPrompt", header: "Can prompt", type: "number", accessor: (r) => r.canPrompt, defaultHidden: true },
	{ id: "errors", header: "Errors", type: "number", accessor: (r) => r.errors },
	{ id: "shown", header: "Shown", type: "number", accessor: (r) => r.shown },
	{ id: "shownRate", header: "Shown rate", type: "number", title: "shown / checks", accessor: (r) => r.shownRate, format: (v) => fmtPct(v as number) },
	{ id: "closed", header: "Closed", type: "number", accessor: (r) => r.closed, defaultHidden: true },
	{ id: "avgShownSecs", header: "Up for", hint: "s", type: "number", accessor: (r) => r.avgShownSecs },
	{
		id: "subscribedRate",
		header: "Subscribed",
		type: "number",
		title: "players whose last prompt was here and whose sends came back subscribed / players shown it here",
		accessor: (r) => r.subscribedRate ?? null,
		format: (v) => (v === null ? "–" : fmtPct(v as number)),
		cell: (r) =>
			r.shownPlayers ? (
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<ShareBar share={r.subscribedRate ?? 0} width={50} />
					<Txt variant="small">{fmtPct(r.subscribedRate ?? 0, 0)}</Txt>
				</View>
			) : (
				<Txt variant="small">–</Txt>
			),
		width: 120,
	},
];

export function FunnelTab({ funnel, optin }: { funnel: NotifyFunnelResult; optin: NotifyOptinResult | undefined }) {
	const p = useTheme();
	const steps = funnelSteps(funnel, optin);
	const t = funnel.totals;
	const drops = steps.filter((s) => s.rate !== null);
	const worst = drops.reduce<FunnelStep | null>((a, s) => (a === null || (s.rate ?? 1) < (a.rate ?? 1) ? s : a), null);
	const worstBefore = worst ? steps[steps.indexOf(worst) - 1] : undefined;
	const kinds = funnel.kinds.filter((k) => k.sent > 0).sort((a, b) => b.openRate - a.openRate);
	const spots = (optin?.byWhere ?? []).filter((w) => (w.shownPlayers ?? 0) > 0).sort((a, b) => (b.subscribedRate ?? 0) - (a.subscribedRate ?? 0));
	return (
		<View style={{ gap: space.md }}>
			<Section title="From prompt to back in game">
				<Txt variant="small">Each % is of the step before. Subscribed is learned from Roblox's answer to a send; Sent counts sends, not players.</Txt>
				<Steps steps={steps} />
			</Section>
			<Insight
				title="Biggest drop"
				headline={worst && worstBefore ? `${worstBefore.label} to ${worst.label.toLowerCase()}` : "Not enough data"}
				detail={worst && worst.rate !== null ? `${fmtPct(1 - worst.rate, 0)} don't make it to the next step.` : "Needs at least one step with rows."}
			/>
			<Insight
				title="Best kind"
				headline={kinds[0] ? `${kinds[0].kind}: ${fmtPct(kinds[0].openRate, 0)} opened` : "No sends yet"}
				detail={
					kinds.length > 1
						? kinds
								.slice(1, 4)
								.map((k) => `${k.kind} ${fmtPct(k.openRate, 0)}`)
								.join(", ")
						: "Only one kind sent in this range."
				}
			/>
			<Insight
				title="Best prompt spot"
				headline={spots[0] ? `${spots[0].where || "(none)"}: ${fmtPct(spots[0].subscribedRate ?? 0, 0)} subscribed` : "No prompt answers yet"}
				detail={
					spots.length > 1
						? spots
								.slice(1, 4)
								.map((w) => `${w.where || "(none)"} ${fmtPct(w.subscribedRate ?? 0, 0)}`)
								.join(", ")
						: "Answers come from Roblox's reply to a send."
				}
			/>
			<StatStrip
				items={[
					{ label: "Wants", value: fmtInt(t.wants), sub: `${fmtInt(t.planned)} planned` },
					{ label: "Sent", value: fmtInt(t.sent), sub: `${fmtInt(t.players)} players` },
					{ label: "Open rate", value: t.sent ? fmtPct(t.openRate) : "–", sub: `${fmtInt(t.opened)} opened` },
					{ label: "Played 1 min+", value: t.opened ? fmtPct(t.playedRate) : "–", sub: `${fmtInt(t.played)} of the opened` },
					{ label: "Assisted returns", value: fmtInt(t.assisted), sub: "came back within 24 h without opening" },
					{ label: "Dry run / test sends", value: `${fmtInt(t.dry)} / ${fmtInt(t.tests)}`, sub: "test sends reach Roblox; neither counts in Sent" },
				]}
			/>
			<Section title="Sends and opens">
				<Txt variant="small">Per day (UTC, by the day of the send).</Txt>
				<Card>
					<LineChart
						area={false}
						timeLabel={dayLabel}
						series={[
							{ label: "Sent", points: funnel.daily.map((d) => ({ t: dayTime(d.date), v: d.sent })), color: p.brand },
							{ label: "Opened", points: funnel.daily.map((d) => ({ t: dayTime(d.date), v: d.opened })), color: p.good },
							{ label: "Played 1 min+", points: funnel.daily.map((d) => ({ t: dayTime(d.date), v: d.played })), color: p.warning },
						]}
					/>
				</Card>
			</Section>
			<Section title="Opt-in prompt by spot">
				<Txt variant="small">Checked, shown, and how many players shown it there turned out subscribed. Roblox doesn't say what the player picked; the backend infers it from its sends.</Txt>
				{optin ? (
					<>
						{optin.byWhere.length ? <DataTable id="notify-optin-where" label="Opt-in by where" columns={WHERE_COLUMNS} data={optin.byWhere} rowId={(r) => r.where} density="compact" /> : <Txt variant="muted">No opt-in prompt rows in this range.</Txt>}
						<Txt variant="small">
							{fmtInt(optin.totals.checks)} checks, {fmtInt(optin.totals.canPrompt)} could prompt, {fmtInt(optin.totals.errors)} errors; {fmtInt(optin.totals.closed)} closed
							{optin.totals.avgShownSecs === null ? "" : `, up ${optin.totals.avgShownSecs} s on average`}. Inferred: {fmtInt(optin.totals.subscribed)} subscribed, {fmtInt(optin.totals.notSubscribed)} not.
						</Txt>
					</>
				) : (
					<Txt variant="muted">The opt-in rows didn't load.</Txt>
				)}
			</Section>
		</View>
	);
}

// Inbox ----------------------------------------------------------------------------------------------------------------

export const RECENT_LIMIT = 200;
export type SendFilter = "all" | "opened" | "unopened" | "failed" | "queued" | "dry" | "test";
const SEND_FILTERS: [SendFilter, string][] = [
	["all", "All"],
	["opened", "Opened"],
	["unopened", "Not opened"],
	["failed", "Failed"],
	["queued", "Queued"],
	["dry", "Dry run"],
	["test", "Test"],
];
type ConsentFilter = "subscribed" | "not_subscribed" | null;

export function sendMatches(s: Pick<NotifyRecentSend, "status" | "openedAt" | "test">, f: SendFilter): boolean {
	switch (f) {
		case "opened":
			return s.openedAt !== null;
		case "unopened":
			return s.status === "sent" && s.openedAt === null;
		case "failed":
			return s.status === "failed" || s.status === "cancelled";
		case "queued":
			return s.status === "planned" || s.status === "sending";
		case "dry":
			return s.status === "dry";
		case "test":
			return s.test;
		default:
			return true;
	}
}

export function sendLabel(s: Pick<NotifyRecentSend, "status" | "openedAt">): { text: string; tone: Tone } {
	if (s.openedAt !== null) return { text: "opened", tone: "brand" };
	if (s.status === "failed") return { text: "failed", tone: "critical" };
	if (s.status === "cancelled") return { text: "cancelled", tone: "muted" };
	if (s.status === "planned" || s.status === "sending") return { text: "queued", tone: "muted" };
	if (s.status === "dry") return { text: "dry run", tone: "muted" };
	return { text: "sent", tone: "muted" };
}

function FeedRow({ s, text, selected, onPress }: { s: NotifyRecentSend; text: string | undefined; selected: boolean; onPress(): void }) {
	const p = useTheme();
	const label = sendLabel(s);
	const at = s.sentAt ?? s.plannedAt;
	return (
		<Pressable onPress={onPress} style={{ flexDirection: "row", gap: 10, paddingVertical: 9, paddingHorizontal: 10, backgroundColor: selected ? p.muted : undefined, alignItems: "flex-start" }}>
			<View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
				<Txt variant="small" style={{ fontWeight: "600" }}>
					{initials(s.name, s.userId)}
				</Txt>
			</View>
			<View style={{ flex: 1, gap: 2 }}>
				<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
					<Txt style={{ fontWeight: "600" }}>{s.name ? `@${s.name}` : String(s.userId)}</Txt>
					<Txt variant="mono" color={p.mutedForeground}>
						{s.kind}
					</Txt>
					{s.test ? <Badge label="test" /> : null}
				</View>
				{text ? (
					<Txt variant="small" numberOfLines={1}>
						{text}
					</Txt>
				) : null}
			</View>
			<View style={{ alignItems: "flex-end", gap: 2 }}>
				<Badge label={label.text} tone={label.tone} />
				{at ? <Txt variant="small">{fmtAgo(at)}</Txt> : null}
			</View>
		</Pressable>
	);
}

function SideDetail({ backendId, view, send }: { backendId: string; view: NotifyUserView; send: NotifyRecentSend }) {
	const [open, setOpen] = useState(false);
	const s = view.state;
	const full = view.sends.find((x) => x.nid === send.nid) ?? send;
	const opened = view.events?.opens?.find((o) => o.nid === send.nid);
	const earlier = view.sends.filter((x) => x.nid !== send.nid).slice(0, 5);
	const pending = view.intents.filter((i) => i.status === "pending").slice(0, 5);
	return (
		<View style={{ gap: space.sm }}>
			<Who backendId={backendId} view={view} />
			<Txt variant="small">
				UserId {view.userId}
				{s ? ` · ${s.online ? "online" : "offline"}` : ""}
				{s?.lastSeen ? ` · seen ${fmtAgo(s.lastSeen)}` : ""}
			</Txt>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
				{s?.optin === "subscribed" ? (
					<Badge label={`Subscribed${s.optinAt ? ` since ${fmtTime(s.optinAt).slice(0, 10)}` : ""}`} tone="brand" />
				) : s?.optin === "not_subscribed" ? (
					<Badge label="Not subscribed" tone="critical" />
				) : (
					<Badge label="Opt-in unknown" />
				)}
				{s?.muted && s.muteUntil ? <Badge label={`muted until ${fmtTime(s.muteUntil).slice(0, 10)}`} /> : null}
				{s?.unopened ? <Badge label={plural(s.unopened, "unopened")} /> : null}
				{view.prefs?.off.map((k) => <Badge key={k} label={`${k} off in game`} />)}
			</View>
			<Txt variant="label">This send</Txt>
			<Card style={{ gap: 0 }}>
				<KV label="Kind" value={`${full.kind}${full.template ? ` · ${full.template}` : ""}`} mono />
				<KV label="Sent" value={full.sentAt ? fmtTime(full.sentAt) : `not yet (${full.status})`} />
				<KV label="Opened" value={full.openedAt ? `${fmtTime(full.openedAt)}${full.playedSecs !== null ? `, played ${fmtInt(Math.round(full.playedSecs / 60))} min` : ""}` : "no"} />
				<KV label="nid" value={full.nid} mono />
			</Card>
			<Button title={open ? "Hide request, answer and join data" : "Request, answer and join data"} small onPress={() => setOpen((o) => !o)} style={{ alignSelf: "flex-start" }} />
			{open ? (
				<>
					<SendDetail send={full} />
					{opened?.jd ? <JoinData jd={opened.jd} label="Join data of the opening session" /> : null}
				</>
			) : null}
			<Txt variant="label">Earlier</Txt>
			{earlier.length ? (
				earlier.map((e) => (
					<View key={e.nid} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
						<Txt variant="mono">{e.kind}</Txt>
						<Txt variant="small">
							{fmtTime(e.sentAt ?? e.plannedAt).slice(0, 10)} · {sendLabel(e).text}
						</Txt>
					</View>
				))
			) : (
				<Txt variant="small">No other sends.</Txt>
			)}
			<Txt variant="label">Intents</Txt>
			{pending.length ? (
				pending.map((i) => (
					<View key={`${i.kind}|${i.key}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
						<Txt variant="mono">
							{i.kind}
							{i.key ? ` · ${i.key}` : ""}
						</Txt>
						<Txt variant="small">{i.planned ? "planned" : i.at ? `from ${fmtTime(i.at)}` : "pending"}</Txt>
					</View>
				))
			) : (
				<Txt variant="small">Nothing pending.</Txt>
			)}
		</View>
	);
}

/** The picked send and its player (GET /v1/notify/user), in a bottom sheet (the web's side panel). */
function SideSheet({ backendId, send, onClose, onOpenPlayer }: { backendId: string; send: NotifyRecentSend | undefined; onClose(): void; onOpenPlayer(uid: number): void }) {
	const q = useNotifyUser(backendId, send ? { uid: String(send.userId) } : null);
	if (!send) return null;
	return (
		<Sheet open onClose={onClose} title={`${send.name ? `@${send.name}` : `UserId ${send.userId}`} · ${send.kind}`}>
			{q.error ? <ErrorState error={q.error} title="Could not load this player" /> : !q.data ? <Skeleton height={140} /> : <SideDetail backendId={backendId} view={q.data} send={send} />}
			<Button
				title="Open full player view"
				icon="person-outline"
				onPress={() => {
					onClose();
					onOpenPlayer(send.userId);
				}}
			/>
		</Sheet>
	);
}

export function InboxTab({ backendId, kind, status }: { backendId: string; kind: string; status: NotifyStatus | undefined }) {
	const [, setParams] = usePageParams();
	const [filter, setFilter] = useState<SendFilter>("all");
	const [consent, setConsent] = useState<ConsentFilter>(null);
	const [text, setText] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const q = useTTQuery(backendId, ["notify", "recent", kind], (api, s) => api.notifyRecent({ limit: RECENT_LIMIT, ...(kind ? { kind } : {}) }, s), { refetchInterval: 15_000, retry: false });
	const texts = useMemo(() => new Map((status?.kinds ?? []).map((k) => [k.kind, k.text])), [status]);
	const openPlayer = (uid: number) => setParams({ player: String(uid), by: "uid" });
	const needle = text.trim().toLowerCase().replace(/^@/, "");
	const shown = (q.data?.sends ?? []).filter(
		(s) =>
			sendMatches(s, filter) &&
			(consent === null || s.optin === consent) &&
			(!needle || String(s.userId).includes(needle) || s.nid.toLowerCase().includes(needle) || (s.name ?? "").toLowerCase().includes(needle) || (s.displayName ?? "").toLowerCase().includes(needle)),
	);
	const pick = (q.data?.sends ?? []).find((s) => s.nid === selected);
	return (
		<View style={{ gap: space.md }}>
			<Section title="Inbox" right={q.data ? <Badge label={plural(q.data.sends.length, "send")} /> : undefined}>
				<Txt variant="small">
					The newest {RECENT_LIMIT} sends of everyone{kind ? ` (kind ${kind})` : ""}, live (every 15 s). Tap one to see its player and Roblox's answer.
				</Txt>
				<Chips options={SEND_FILTERS.map(([value, label]) => ({ value, label }))} value={filter} onChange={setFilter} />
				<ChoiceChips
					options={[
						{ value: "subscribed", label: "Subscribers" },
						{ value: "not_subscribed", label: "Not subscribed" },
					]}
					value={consent ? [consent] : []}
					onChange={(v) => setConsent((c) => (c === v ? null : v))}
				/>
				<SearchBar value={text} onChangeText={setText} placeholder="Player, UserId or nid" />
				{q.error ? (
					<ErrorState error={q.error} onRetry={() => void q.refetch()} />
				) : !q.data ? (
					<Skeleton height={160} />
				) : !q.data.sends.length ? (
					<Txt variant="muted">Nothing planned or sent yet.</Txt>
				) : shown.length ? (
					<Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
						{shown.map((s) => (
							<FeedRow key={s.nid} s={s} text={fillText(texts.get(s.kind), s.params)} selected={s.nid === selected} onPress={() => setSelected((x) => (x === s.nid ? null : s.nid))} />
						))}
					</Card>
				) : (
					<Txt variant="muted">No send matches.</Txt>
				)}
				{/^\d{1,19}$/.test(needle) && !shown.length ? <Button title={`Open player ${needle}`} small icon="person-outline" onPress={() => openPlayer(Number(needle))} style={{ alignSelf: "flex-start" }} /> : null}
			</Section>
			<SideSheet backendId={backendId} send={pick} onClose={() => setSelected(null)} onOpenPlayer={openPlayer} />
			<PlayerPanel backendId={backendId} />
		</View>
	);
}

// Subscribers ----------------------------------------------------------------------------------------------------------

export const SUBSCRIBERS_PAGE = 50;
const STATES: { id: NotifyOptinState; label: string; count: (c: NotifyOptinTotals) => number }[] = [
	{ id: "subscribed", label: "Subscribed", count: (c) => c.subscribed },
	{ id: "not_subscribed", label: "Not subscribed", count: (c) => c.notSubscribed },
	{ id: "unknown", label: "Unknown", count: (c) => c.unknown },
	{ id: "muted", label: "Muted", count: (c) => c.muted },
];

/** The counts alone (the Health tab's bar, the KPI card): one tiny page of the default state. */
export function useOptinCounts(backendId: string, enabled: boolean) {
	return useTTQuery(backendId, NOTIFY_USERS_COUNTS_KEY, (api, s) => api.notifyUsers({ limit: 1 }, s).then((v) => v.counts), { enabled, retry: false, staleTime: 15_000 });
}

function stateBadge(u: NotifyOptinUser) {
	if (u.muteUntil) return <Badge label="muted" />;
	if (u.optin === "subscribed") return <Badge label="subscribed" tone="brand" />;
	if (u.optin === "not_subscribed") return <Badge label="not subscribed" tone="critical" />;
	return <Badge label="unknown" />;
}

export function SubscribersTab({ backendId }: { backendId: string }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const [, setParams] = usePageParams();
	const [state, setState] = useState<NotifyOptinState>("subscribed");
	const [text, setText] = useState("");
	const [q, setQ] = useState("");
	const [cursors, setCursors] = useState<string[]>([]);
	const cursor = cursors[cursors.length - 1];
	const users = useTTQuery(backendId, ["notify", "users", state, q, cursor ?? ""], (a, s) => a.notifyUsers({ state, limit: SUBSCRIBERS_PAGE, ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) }, s), {
		placeholderData: keepPreviousData,
		retry: false,
	});
	const csv = useMutation({
		mutationFn: async () => {
			const r = await api!.notifyUsersCsv({ state, ...(q ? { q } : {}) });
			const shared = await shareFile(r.name, `﻿${r.text}`, "text/csv");
			return { ...r, shared };
		},
	});
	const openPlayer = (uid: number) => setParams({ tab: "inbox", player: String(uid), by: "uid" });
	const columns: DataColumn<NotifyOptinUser>[] = [
		{ id: "player", header: "Player", accessor: (r) => r.name ?? String(r.userId), format: (_v, r) => (r.name ? `@${r.name}` : String(r.userId)), searchText: (r) => r.displayName ?? "" },
		{ id: "userId", header: "UserId", accessor: (r) => r.userId, format: (_v, r) => String(r.userId), mono: true },
		{ id: "state", header: "State", type: "enum", accessor: (r) => (r.muteUntil ? "muted" : (r.optin ?? "unknown")), cell: stateBadge },
		{ id: "since", header: state === "muted" ? "Muted until" : "Since", type: "date", accessor: (r) => (state === "muted" ? r.muteUntil : r.optinAt), format: (v) => (typeof v === "number" ? fmtTime(v).slice(0, 10) : "–") },
		{ id: "lastSeen", header: "Last seen", type: "date", accessor: (r) => r.lastSeen, cell: (r) => (r.online ? <Badge label="online" tone="good" /> : <Txt variant="small">{r.lastSeen ? fmtAgo(r.lastSeen) : "–"}</Txt>) },
		{ id: "sends", header: "Sent", type: "number", title: "real sends kept (120 days), not tests", accessor: (r) => r.sends },
		{ id: "opened", header: "Opened", type: "number", accessor: (r) => r.opened },
	];
	const view = users.data;
	return (
		<Section title="Who can get notifications">
			<Txt variant="small">Roblox has no list of opted-in players: the backend learns it from Roblox's answer to a send. Unknown = never sent to yet. Tap a player for their notifications.</Txt>
			{users.error ? (
				<ErrorState error={users.error} onRetry={() => void users.refetch()} />
			) : !view ? (
				<Skeleton height={200} />
			) : (
				<View style={{ gap: space.sm }}>
					<SubscriberBar counts={view.counts} />
					<ChoiceChips
						options={STATES.map((s) => ({ value: s.id, label: `${s.label} ${fmtInt(s.count(view.counts))}` }))}
						value={[state]}
						onChange={(next) => {
							setState(next);
							setCursors([]);
						}}
					/>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						<View style={{ flex: 1 }}>
							<Field
								value={text}
								onChangeText={setText}
								placeholder="UserId or @name"
								returnKeyType="search"
								onSubmitEditing={() => {
									setQ(text.trim());
									setCursors([]);
								}}
							/>
						</View>
						<Button title="Export CSV" small icon="download-outline" loading={csv.isPending} onPress={() => csv.mutate()} />
					</View>
					{csv.error ? (
						<Txt variant="small" color={p.destructive}>
							{csv.error.message}
						</Txt>
					) : null}
					{csv.data?.truncated ? <Txt variant="small">The CSV holds the first 10 000 rows.</Txt> : null}
					<DataTable
						id="notify-subscribers"
						label="Subscribers"
						columns={columns}
						data={view.users}
						rowId={(r) => String(r.userId)}
						density="compact"
						pageSize={SUBSCRIBERS_PAGE}
						search={false}
						urlSync={false}
						onRowPress={(r) => openPlayer(r.userId)}
						empty={<Txt variant="muted">{q ? "No player matches in this state." : "No players in this state."}</Txt>}
					/>
					<Txt variant="small">
						Page {cursors.length + 1}, {fmtInt(view.users.length)} shown of {fmtInt(STATES.find((s) => s.id === state)?.count(view.counts) ?? 0)}
						{q ? ` (search "${q}")` : ""}. Names come from the server's name cache.
					</Txt>
					<View style={{ flexDirection: "row", gap: 8 }}>
						<Button title="Previous" small disabled={!cursors.length} onPress={() => setCursors((c) => c.slice(0, -1))} />
						<Button title="Next" small disabled={!view.next} onPress={() => view.next && setCursors((c) => [...c, view.next as string])} />
					</View>
				</View>
			)}
		</Section>
	);
}

// Kinds ----------------------------------------------------------------------------------------------------------------

type DayRow = NotifyFunnelCounts & { date: string; kind: string };
type KindRow = NotifyFunnelCounts & { kind: string; skipped: number; pending: number | null; live?: NotifyStatus["kinds"][number] };

const count = <R extends NotifyFunnelCounts>(id: keyof NotifyFunnelCounts, header: string, title?: string, hidden = false): DataColumn<R> => ({
	id,
	header,
	type: "number",
	...(title ? { title } : {}),
	...(hidden ? { defaultHidden: true } : {}),
	accessor: (r) => r[id],
});
const rate = <R extends NotifyFunnelCounts>(id: string, header: string, get: (r: NotifyFunnelCounts) => number, title: string, hidden = false): DataColumn<R> => ({
	id,
	header,
	type: "number",
	title,
	...(hidden ? { defaultHidden: true } : {}),
	accessor: (r) => get(r),
	format: (v) => fmtPct(v as number),
});

const DAY_COLUMNS: DataColumn<DayRow>[] = [
	{ id: "date", header: "Day", accessor: (r) => r.date },
	{ id: "kind", header: "Kind", type: "enum", accessor: (r) => r.kind, format: (_v, r) => r.kind || "(none)", mono: true },
	count("wants", "Wants", "want rows from game servers"),
	count("planned", "Planned"),
	count("sent", "Sent", "real sends: not dry runs, not tests"),
	count("dry", "Dry run", "planned and logged, never sent"),
	count("opened", "Opened"),
	rate("openRate", "Open rate", (r) => r.openRate, "opened / sent"),
	count("played", "Played 1 min+"),
	count("returnedD1", "Back D1", "players sent to on a day who played the next day"),
	count("assisted", "Assisted", "never opened it, came back within 24 h"),
	count("tests", "Test sends", "real sends from Send a test: they reach Roblox but stay out of Sent and the rates"),
];

/** A kind's on / off switch (owners): turning one off asks first (its pending sends then wait). */
function KindSwitch({ backendId, kind, enabled }: { backendId: string; kind: string; enabled: boolean }) {
	const { set, busy } = useNotifySettings(backendId);
	return (
		<OnOff
			on={enabled}
			disabled={busy}
			onChange={async (on) => {
				if (!on && !(await confirm(`Turn kind ${kind} off?`, "Nothing of this kind is planned or sent until it is turned back on; its pending sends wait.", "Turn off"))) return;
				set(`notify.kinds.${kind}.enabled`, on);
			}}
		/>
	);
}

export function KindsTab({ backendId, funnel, queue, status, canEdit }: { backendId: string; funnel: NotifyFunnelResult; queue: NotifyQueueResult | undefined; status: NotifyStatus | undefined; canEdit: boolean }) {
	const [byDay, setByDay] = useState(false);
	const skipped = new Map<string, number>();
	for (const s of queue?.skipped ?? []) skipped.set(s.kind, (skipped.get(s.kind) ?? 0) + s.skipped);
	const names = [...new Set([...funnel.kinds.map((k) => k.kind), ...(status?.kinds.map((k) => k.kind) ?? [])])];
	const zero = Object.fromEntries(Object.keys(funnel.totals).map((k) => [k, 0])) as unknown as NotifyFunnelCounts;
	const rows: KindRow[] = names.map((kind) => {
		const f = funnel.kinds.find((k) => k.kind === kind);
		const live = status?.kinds.find((k) => k.kind === kind);
		return { ...(f ?? zero), kind, skipped: skipped.get(kind) ?? 0, pending: live ? live.pending : null, ...(live ? { live } : {}) };
	});
	const columns: DataColumn<KindRow>[] = [
		{
			id: "kind",
			header: "Kind",
			accessor: (r) => r.kind,
			cell: (r) => (
				<View style={{ gap: 2 }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
						<Txt variant="mono">{r.kind || "(none)"}</Txt>
						{r.live?.halted ? <Badge label="stopped" tone="critical" /> : null}
					</View>
					{r.live?.text ? (
						<Txt variant="small" numberOfLines={3}>
							{r.live.text}
						</Txt>
					) : null}
				</View>
			),
			width: 170,
		},
		...(status
			? [
					{
						id: "on",
						header: "On",
						sortable: false,
						accessor: (r: KindRow) => (r.live ? (r.live.enabled ? "on" : "off") : ""),
						cell: (r: KindRow) =>
							r.live ? canEdit ? <KindSwitch backendId={backendId} kind={r.kind} enabled={r.live.enabled} /> : <Badge label={r.live.enabled ? "on" : "off"} /> : <Txt variant="small">not pushed</Txt>,
						width: 120,
					} satisfies DataColumn<KindRow>,
				]
			: []),
		count("sent", "Sent", "real sends: not dry runs, not tests"),
		{
			id: "openRate",
			header: "Opened",
			type: "number",
			title: "opened / sent",
			accessor: (r) => r.openRate,
			format: (v) => fmtPct(v as number),
			cell: (r) => (
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<ShareBar share={r.openRate} width={44} />
					<Txt variant="small">{fmtPct(r.openRate)}</Txt>
				</View>
			),
			width: 120,
		},
		rate("playedRate", "Played 1 min+", (r) => r.playedRate, "played at least a minute / opened"),
		rate("returnRate", "Back D1", (r) => r.returnRate, "players sent to who played the next day"),
		{ id: "skipped", header: "Skipped", type: "number", accessor: (r) => r.skipped },
		{ id: "pending", header: "Pending", type: "number", accessor: (r) => r.pending },
		count("opened", "Opens", undefined, true),
		count("played", "Played", undefined, true),
		count("returnedD1", "Returned D1", undefined, true),
		count("assisted", "Assisted", "never opened it, came back within 24 h", true),
		count("planned", "Planned", undefined, true),
		count("wants", "Wants", undefined, true),
		count("dry", "Dry run", undefined, true),
		count("tests", "Test sends", undefined, true),
	];
	return (
		<View style={{ gap: space.md }}>
			<Section title="Kinds">
				<Txt variant="small">Per kind in this range: real sends, the share opened, played at least a minute, back the next day; skips and the live pending count.</Txt>
				<DataTable id="notify-kinds" label="Funnel by kind" columns={columns} data={rows} rowId={(r) => r.kind} density="compact" />
			</Section>
			<Button title={byDay ? "Hide by kind and day" : "By kind and day"} small icon={byDay ? "chevron-up" : "chevron-down"} onPress={() => setByDay((o) => !o)} style={{ alignSelf: "flex-start" }} />
			{byDay ? <DataTable id="notify-days" label="Funnel by kind and day" columns={DAY_COLUMNS} data={funnel.days} rowId={(r) => `${r.date}|${r.kind}`} density="compact" /> : null}
		</View>
	);
}

// Queue & errors -------------------------------------------------------------------------------------------------------

type WhyRow = { kind: string; why: string; n: number };
const whyColumns = (what: string): DataColumn<WhyRow>[] => [
	{ id: "kind", header: "Kind", type: "enum", accessor: (r) => r.kind, format: (_v, r) => r.kind || "(none)", mono: true },
	{ id: "why", header: "Why", type: "enum", accessor: (r) => r.why, format: (_v, r) => r.why || "(none)", mono: true },
	{ id: "n", header: what, type: "number", accessor: (r) => r.n },
];
const PLANNED_COLUMNS = whyColumns("Planned");
const SKIPPED_COLUMNS = whyColumns("Skipped");

const FAILURE_COLUMNS: DataColumn<NotifyQueueFailure>[] = [
	{ id: "http", header: "HTTP", type: "number", accessor: (r) => r.http, format: (_v, r) => (r.http === null ? "network" : String(r.http)) },
	{ id: "code", header: "Code", accessor: (r) => r.code, format: (_v, r) => r.code || "–", mono: true },
	{ id: "kind", header: "Kind", type: "enum", accessor: (r) => r.kind, format: (_v, r) => r.kind || "(none)", mono: true },
	{ id: "failures", header: "Failures", type: "number", accessor: (r) => r.failures },
	{ id: "final", header: "Final", type: "number", title: "ended the send (no retry)", accessor: (r) => r.final },
	{ id: "sends", header: "Sends", type: "number", accessor: (r) => r.sends },
	{ id: "lastAt", header: "Last", type: "date", accessor: (r) => r.lastAt, format: (_v, r) => (r.lastAt ? fmtAgo(r.lastAt) : "–") },
];

/** The live numbers as label / value lines (the status chip's sheet). */
export function RightNow({ status }: { status: NotifyStatus }) {
	const rows: [string, string][] = [
		["Pending", fmtInt(status.queue.pending)],
		["Due in the next hour", fmtInt(status.queue.due1h)],
		["Sending", fmtInt(status.queue.sending)],
		["Rate", `${status.bucket.rate}/s (ceiling ${status.rate}/s)`],
		["Last 24 h", `${fmtInt(status.sends24h.sent)} sent, ${fmtInt(status.sends24h.failed)} failed, ${fmtInt(status.sends24h.dry)} dry`],
		["Muted players", fmtInt(status.mutes)],
		...(status.outbox !== undefined ? [["Outbox", `${fmtInt(status.outbox)} rows waiting`] as [string, string]] : []),
		...(status.rowsDropped ? [["Rows dropped", fmtInt(status.rowsDropped)] as [string, string]] : []),
		...(status.presenceStaleHours !== undefined ? [["Presence stale after", `${fmtInt(status.presenceStaleHours)} h`] as [string, string]] : []),
		["Last 429", status.bucket.last429At ? fmtAgo(status.bucket.last429At) : "none yet"],
	];
	return (
		<Card style={{ gap: 0 }}>
			{rows.map(([label, value]) => (
				<KV key={label} label={label} value={value} />
			))}
		</Card>
	);
}

function LiveQueue({ status }: { status: NotifyStatus }) {
	return (
		<View style={{ gap: space.sm }}>
			<StatGrid>
				<Stat label="Pending" value={fmtInt(status.queue.pending)} sub={`${fmtInt(status.queue.due1h)} due in the next hour`} />
				<Stat
					label="Sending"
					value={fmtInt(status.queue.sending)}
					sub={`${status.bucket.rate}/s now, ceiling ${status.rate}/s; ${Math.floor(status.bucket.tokens)} tokens; ${status.bucket.last429At ? `last 429 ${fmtAgo(status.bucket.last429At)}` : "no 429 yet"}`}
				/>
				<Stat label="Last 24 h" value={fmtInt(status.sends24h.sent)} sub={`sent; ${fmtInt(status.sends24h.failed)} failed, ${fmtInt(status.sends24h.dry)} dry`} />
				<Stat label="Muted players" value={fmtInt(status.mutes)} sub="a refused send mutes for 7 days" />
			</StatGrid>
			{status.outbox !== undefined || status.rowsDropped || status.presenceStaleHours !== undefined ? (
				<Card style={{ gap: 0 }}>
					{status.outbox !== undefined ? <KV label="Outbox" value={`${fmtInt(status.outbox)} rows waiting`} /> : null}
					{status.rowsDropped ? <KV label="Rows dropped" value={fmtInt(status.rowsDropped)} /> : null}
					{status.presenceStaleHours !== undefined ? <KV label="Presence stale after" value={`${fmtInt(status.presenceStaleHours)} h`} /> : null}
				</Card>
			) : null}
		</View>
	);
}

export function QueueTab({ data, status }: { data: NotifyQueueResult; status: NotifyStatus | undefined }) {
	const p = useTheme();
	const t = data.totals;
	return (
		<View style={{ gap: space.md }}>
			{status ? <LiveQueue status={status} /> : null}
			<Section title="Failures" right={status ? <Badge label={plural(status.mutes, "muted player")} /> : undefined}>
				<Txt variant="small">Sends Roblox refused in this range, by HTTP status and code. A player who isn't opted in is muted for 7 days.</Txt>
				{data.failures.length ? (
					<DataTable id="notify-failures" label="Failures by http and code" columns={FAILURE_COLUMNS} data={data.failures} rowId={(r) => `${r.kind}|${r.http}|${r.code}`} density="compact" />
				) : (
					<Txt variant="muted">No failed sends in this range.</Txt>
				)}
			</Section>
			<Section title="Planned, by why">
				{data.planned.length ? (
					<DataTable id="notify-planned" label="Planned by kind and why" columns={PLANNED_COLUMNS} data={data.planned.map((r) => ({ kind: r.kind, why: r.why, n: r.planned }))} rowId={(r) => `${r.kind}|${r.why}`} density="compact" />
				) : (
					<Txt variant="muted">Nothing planned in this range.</Txt>
				)}
			</Section>
			<Section title="Skipped, by why">
				{data.skipped.length ? (
					<DataTable id="notify-skipped" label="Skipped by kind and why" columns={SKIPPED_COLUMNS} data={data.skipped.map((r) => ({ kind: r.kind, why: r.why, n: r.skipped }))} rowId={(r) => `${r.kind}|${r.why}`} density="compact" />
				) : (
					<Txt variant="muted">Nothing skipped in this range.</Txt>
				)}
			</Section>
			<Section title="Queue history">
				<Txt variant="small">The sender's history in this range (per hour, UTC).</Txt>
				<Card style={{ gap: 0 }}>
					<KV label="Planned" value={fmtInt(t.planned)} />
					<KV label="Sent" value={fmtInt(t.sent)} />
					<KV label="Dry run" value={fmtInt(t.dry)} />
					<KV label="Failed" value={fmtInt(t.failed)} />
					<KV label="429s" value={fmtInt(t.rateLimited)} />
					<KV label="Skipped" value={fmtInt(t.skipped)} />
					{t.last429At ? <KV label="Last 429" value={fmtTime(t.last429At)} /> : null}
				</Card>
				{data.hours.length ? (
					<Card>
						<LineChart
							area={false}
							timeLabel={hourLabel}
							series={[
								{ label: "Planned", points: data.hours.map((h) => ({ t: hourTime(h.hour), v: h.planned })), color: p.mutedForeground },
								{ label: "Sent", points: data.hours.map((h) => ({ t: hourTime(h.hour), v: h.sent })), color: p.brand },
								{ label: "Dry run", points: data.hours.map((h) => ({ t: hourTime(h.hour), v: h.dry })), color: p.good },
								{ label: "Failed", points: data.hours.map((h) => ({ t: hourTime(h.hour), v: h.failed })), color: p.warning },
								{ label: "429", points: data.hours.map((h) => ({ t: hourTime(h.hour), v: h.rateLimited })), color: p.critical },
							]}
						/>
					</Card>
				) : null}
			</Section>
		</View>
	);
}

// Settings -------------------------------------------------------------------------------------------------------------

function NumberSetting({ label, value, min, max, disabled, onSave }: { label: string; value: number; min: number; max: number; disabled: boolean; onSave(next: number): void }) {
	const [text, setText] = useState(String(value));
	const n = Number(text);
	const ok = text.trim() !== "" && Number.isFinite(n) && n >= min && n <= max;
	return (
		<View style={{ gap: 4 }}>
			<Txt variant="small">{label}</Txt>
			<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				<View style={{ width: 110 }}>
					<Field value={text} onChangeText={setText} keyboardType="number-pad" />
				</View>
				<Button title="Save" small disabled={disabled || !ok || Math.round(n) === value} onPress={() => ok && onSave(Math.round(n))} />
			</View>
			<Txt variant="small" style={{ fontSize: 10 }}>
				{fmtInt(min)} to {fmtInt(max)}
			</Txt>
		</View>
	);
}

function Controls({ backendId, status }: { backendId: string; status: NotifyStatus }) {
	const p = useTheme();
	const { set, busy, error, notice } = useNotifySettings(backendId);
	return (
		<Section title="Sending">
			<Txt variant="small">Runtime settings: saved at once, audited, no redeploy. Dry run plans and logs every send without posting it to Roblox.</Txt>
			<Card style={{ gap: space.sm }}>
				<Txt variant="small">Sending</Txt>
				<ChoiceChips
					options={[
						{ value: "on", label: "On" },
						{ value: "off", label: "Paused" },
					]}
					value={[status.enabled ? "on" : "off"]}
					disabled={busy}
					onChange={async (v) => {
						if (v === "off" && !(await confirm("Pause sending?", "Nothing is planned or sent until it is turned back on.", "Pause"))) return;
						set("notify.enabled", v === "on");
					}}
				/>
				<Txt variant="small">Dry run</Txt>
				<OnOff on={status.dryRun} disabled={busy} onChange={(v) => set("notify.dryRun", v)} />
				<Txt variant="small">Day clock</Txt>
				<ChoiceChips
					options={[
						{ value: "rolling24", label: "Rolling 24 h" },
						{ value: "utc_day", label: "UTC day" },
					]}
					value={[status.clock]}
					disabled={busy}
					onChange={(v) => set("notify.clock", v)}
				/>
				<NumberSetting key={`rate-${status.rate}`} label="Rate ceiling (sends / s)" value={status.rate} min={1} max={4000} disabled={busy} onSave={(v) => set("notify.rate", v)} />
				{status.presenceStaleHours !== undefined ? (
					<NumberSetting key={`stale-${status.presenceStaleHours}`} label="Presence goes stale after (hours)" value={status.presenceStaleHours} min={1} max={168} disabled={busy} onSave={(v) => set("notify.presenceStaleHours", v)} />
				) : null}
			</Card>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
				<Badge
					label={status.configured.universe && status.configured.apiKey ? "Open Cloud configured" : `Missing ${[!status.configured.universe && "universe", !status.configured.apiKey && "API key"].filter(Boolean).join(" and ")}`}
					tone={status.configured.universe && status.configured.apiKey ? "muted" : "critical"}
				/>
				<Badge label={status.keys.current ? `Signing key set${status.keys.previous ? " (+ previous)" : ""}` : "No signing key"} tone={status.keys.current ? "muted" : "critical"} />
				<Badge label={status.config ? "Config pushed" : "No config pushed"} tone={status.config ? "muted" : "critical"} />
			</View>
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error.message}
				</Txt>
			) : null}
			{notice ? <Txt variant="small">{notice}</Txt> : null}
		</Section>
	);
}

export interface ParamRow {
	id: number;
	name: string;
	value: string;
	fixed: boolean;
}

export function placeholdersOf(text: string | undefined): string[] {
	const out: string[] = [];
	for (const m of (text ?? "").matchAll(/\{([A-Za-z0-9_-]{1,32})\}/g)) if (m[1] && !out.includes(m[1])) out.push(m[1]);
	return out;
}

export function rowsToParams(rows: ParamRow[]): Record<string, string> | undefined {
	const out: Record<string, string> = {};
	for (const row of rows) {
		const name = row.name.trim();
		if (!name) {
			if (row.value.trim()) throw new Error("A param has a value but no name.");
			continue;
		}
		if (name in out) throw new Error(`"${name}" is there twice.`);
		out[name] = row.value;
	}
	return Object.keys(out).length ? out : undefined;
}

let nextRowId = 1;
function rowsFor(text: string | undefined, keep: ParamRow[] = []): ParamRow[] {
	const fixed = placeholdersOf(text).map((name) => ({ id: nextRowId++, name, value: keep.find((r) => r.name === name)?.value ?? "", fixed: true }));
	const custom = keep.filter((r) => !r.fixed && !fixed.some((f) => f.name === r.name.trim()));
	return [...fixed, ...custom];
}

export function TestSend({ backendId, kinds }: { backendId: string; kinds: { kind: string; text?: string | undefined }[] }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const [userId, setUserId] = useState("");
	const [kind, setKind] = useState("");
	const picked = kind || kinds[0]?.kind || "";
	const textOf = (k: string) => kinds.find((x) => x.kind === k)?.text;
	const [rows, setRows] = useState<ParamRow[]>(() => rowsFor(textOf(picked)));
	const [rowsKind, setRowsKind] = useState(picked);
	if (rowsKind !== picked) {
		setRowsKind(picked);
		setRows(rowsFor(textOf(picked), rows));
	}
	const [data, setData] = useState("");
	const [problem, setProblem] = useState<string | null>(null);
	const send = useMutation({ mutationFn: (input: Parameters<NonNullable<typeof api>["notifyTest"]>[0]) => api!.notifyTest(input) });
	const edit = (id: number, patch: Partial<ParamRow>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
	const preview = fillText(textOf(picked), Object.fromEntries(rows.filter((r) => r.name.trim() && r.value).map((r) => [r.name.trim(), r.value])));
	const submit = async () => {
		setProblem(null);
		const id = Number(userId.trim());
		if (!Number.isSafeInteger(id) || id <= 0) return setProblem("UserId must be a positive whole number.");
		if (!picked) return setProblem("Pick a kind.");
		let params: Record<string, string> | undefined;
		try {
			params = rowsToParams(rows);
		} catch (error) {
			return setProblem((error as Error).message);
		}
		if (!(await confirm("Send a test?", `A real ${picked} notification goes to UserId ${id} now, outside the caps (marked test).`, "Send", false))) return;
		send.mutate({ userId: id, kind: picked, ...(params ? { params } : {}), ...(data.trim() ? { data: data.trim() } : {}) });
	};
	return (
		<View style={{ gap: space.sm }}>
			<Field label="UserId" value={userId} onChangeText={setUserId} keyboardType="number-pad" placeholder="123456789" />
			<Txt variant="label">Kind</Txt>
			{kinds.length ? <Chips options={kinds.map((k) => ({ value: k.kind, label: k.kind }))} value={picked} onChange={setKind} /> : <Txt variant="muted">No kinds pushed.</Txt>}
			<Txt variant="label">Params</Txt>
			{textOf(picked) ? <Txt variant="mono">{`Text: ${textOf(picked)}`}</Txt> : null}
			{rows.map((row) => (
				<View key={row.id} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
					<View style={{ width: "35%" }}>
						<Field value={row.name} editable={!row.fixed} placeholder="name" onChangeText={(t) => edit(row.id, { name: t })} />
					</View>
					<View style={{ flex: 1 }}>
						<Field value={row.value} placeholder="value" onChangeText={(t) => edit(row.id, { value: t })} />
					</View>
					{row.fixed ? <View style={{ width: 32 }} /> : <Button title="✕" small variant="ghost" onPress={() => setRows((all) => all.filter((r) => r.id !== row.id))} />}
				</View>
			))}
			<Button title="Add param" small icon="add" onPress={() => setRows((all) => [...all, { id: nextRowId++, name: "", value: "", fixed: false }])} style={{ alignSelf: "flex-start" }} />
			<Field label="Launch data" value={data} onChangeText={setData} maxLength={64} placeholder="optional, up to 64 bytes" />
			{preview ? (
				<View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md, padding: 8, backgroundColor: p.muted }}>
					<Txt variant="small">Preview</Txt>
					<Txt>{preview}</Txt>
				</View>
			) : null}
			<Button title="Send a test" small variant="primary" icon="send-outline" loading={send.isPending} disabled={send.isPending || !kinds.length} onPress={() => void submit()} style={{ alignSelf: "flex-start" }} />
			{problem ? (
				<Txt variant="small" color={p.destructive}>
					{problem}
				</Txt>
			) : null}
			{send.error ? (
				<Txt variant="small" color={p.destructive}>
					{send.error.message}
				</Txt>
			) : null}
			{send.data ? (
				<Txt variant="small">
					Test {send.data.nid}: {send.data.status}
				</Txt>
			) : null}
		</View>
	);
}

type KindRecord = { template?: string; priority?: number; perWeek?: number; repeat?: string; send?: string; maxWaitHours?: number; beats?: { kinds?: string[]; withinHours?: number } };
const kindsOf = (view: NotifyConfigView | undefined): Record<string, KindRecord> => {
	const kinds = (view?.config as { kinds?: unknown } | null | undefined)?.kinds;
	return kinds && typeof kinds === "object" && !Array.isArray(kinds) ? (kinds as Record<string, KindRecord>) : {};
};

function KindConfigList({ backendId, status, config }: { backendId: string; status: NotifyStatus; config: NotifyConfigView | undefined }) {
	const record = kindsOf(config);
	const names = [...new Set([...status.kinds.map((k) => k.kind), ...Object.keys(record)])];
	if (!names.length) return <Txt variant="muted">No kinds yet: push the game's notifications config with typetorch notify push.</Txt>;
	return (
		<>
			{names.map((name) => {
				const k = record[name] ?? {};
				const live = status.kinds.find((x) => x.kind === name);
				return (
					<Card key={name} style={{ gap: 0 }}>
						<View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 4 }}>
							<Txt variant="mono" style={{ fontWeight: "600", flex: 1 }}>
								{name}
							</Txt>
							{live?.halted ? <Badge label="stopped" tone="critical" /> : null}
						</View>
						<KV label="Template" value={k.template ?? "none (game supplies it)"} mono={!!k.template} />
						<KV label="Priority (lower wins)" value={k.priority !== undefined ? String(k.priority) : "–"} />
						<KV label="Max / week" value={k.perWeek !== undefined ? String(k.perWeek) : "–"} />
						<KV label="When" value={`${k.send === "preferred_hour" ? "preferred hour" : (k.send ?? "asap")}${k.repeat ? `, ${k.repeat.replace("_", " ")}` : ""}${k.maxWaitHours ? `, waits up to ${k.maxWaitHours} h` : ""}`} />
						<KV label="Beats" value={k.beats?.kinds?.length ? `${k.beats.kinds.join(", ")} within ${k.beats.withinHours ?? "?"} h` : "–"} />
						<KV label="On" value={live ? <KindSwitch backendId={backendId} kind={name} enabled={live.enabled} /> : "not pushed"} />
					</Card>
				);
			})}
		</>
	);
}

export function SettingsTab({ backendId, status }: { backendId: string; status: NotifyStatus }) {
	const config = useTTQuery(backendId, NOTIFY_CONFIG_KEY, (api, s) => api.notifyConfig(s), { retry: false });
	const [showConfig, setShowConfig] = useState(false);
	return (
		<View style={{ gap: space.md }}>
			<Controls backendId={backendId} status={status} />
			<Section title="Send a test">
				<Txt variant="small">Goes out now, outside the caps, marked test (counted under Test sends, not Sent). In dry run it is only logged.</Txt>
				<TestSend backendId={backendId} kinds={status.kinds.map((k) => ({ kind: k.kind, text: k.text }))} />
			</Section>
			<Section title="Kinds">
				<Txt variant="small">From the pushed config record (read-only: typetorch notify push changes it); the switch is a runtime setting. {fmtInt(status.kinds.length)} pushed.</Txt>
				<KindConfigList backendId={backendId} status={status} config={config.data} />
				<Button title={showConfig ? "Hide the pushed config" : "Show the pushed config"} small onPress={() => setShowConfig((o) => !o)} style={{ alignSelf: "flex-start" }} />
				{showConfig ? (
					config.error ? (
						<ErrorState error={config.error} onRetry={() => void config.refetch()} />
					) : !config.data ? (
						<Skeleton height={80} />
					) : config.data.config ? (
						<View style={{ gap: 4 }}>
							<Txt variant="small">
								Pushed {config.data.updatedAt ? fmtAgo(config.data.updatedAt) : "at an unknown time"}
								{config.data.by ? ` by ${config.data.by}` : ""}. Change it with typetorch notify push.
							</Txt>
							<JsonBlock value={config.data.config} />
						</View>
					) : (
						<Txt variant="muted">No config pushed yet: run typetorch notify push.</Txt>
					)
				) : null}
			</Section>
		</View>
	);
}

