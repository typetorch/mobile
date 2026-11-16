/**
 * The Notifications Player panel (owners; web pages/notifications/PlayerPanel.tsx): one player's notifications from
 * GET /v1/notify/user?uid=|pid=|name=. Search by a UserId, a pid or a name the server's name cache knows; the search
 * lives in the route (`player`, and `by` when it isn't guessed) so a link opens it (the player page links here with
 * `player=<pid>&by=pid`). Shows who it is, the consent the backend learned (opt-in, mute, kinds off in game, the
 * prompt rows), every send with its opens and plays (tap one for the request, Roblox's answer and the launch data),
 * the opening sessions' join data and the intents. `PlayerView` is also the player page's Notifications view.
 */
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { NotifyUserEvent, NotifyUserIntent, NotifyUserLookup, NotifyUserSend, NotifyUserView } from "@/api/tt/types";
import { Badge, Button, Card, Chips, ErrorState, Field, KV, Section, Skeleton, Txt } from "@/components/ui";
import { Callout } from "@/features/typetorch/analytics-bits";
import { JsonBlock, PidLink } from "@/features/typetorch/bits";
import { usePlayerProfile } from "@/features/typetorch/cards";
import { useTTQuery } from "@/features/typetorch/hooks";
import { JoinData } from "@/features/typetorch/join-data";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParams } from "@/features/typetorch/view-link";
import { fmtAgo, fmtInt, fmtTime, shortId } from "@/lib/format";
import { space, useTheme, type Tone } from "@/theme";

export type LookupBy = "auto" | "uid" | "pid" | "name";
const BY_LABELS: Record<LookupBy, string> = { auto: "Guess", uid: "UserId", pid: "pid", name: "Name" };
const isBy = (v: string | undefined): v is LookupBy => v === "auto" || v === "uid" || v === "pid" || v === "name";

/**
 * What to ask the server: digits are a UserId; a value with "-" or longer than 20 characters is a pid; anything else a
 * username or display name. `by` overrides the guess. Null when the value can't be one.
 */
export function playerLookup(value: string, by: LookupBy = "auto"): NotifyUserLookup | null {
	const v = value.trim();
	if (!v) return null;
	const kind = by !== "auto" ? by : /^\d{1,19}$/.test(v) ? "uid" : v.includes("-") || v.length > 20 ? "pid" : "name";
	if (kind === "uid") return /^\d{1,19}$/.test(v) ? { uid: v } : null;
	if (kind === "pid") return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? { pid: v } : null;
	return /^[A-Za-z0-9_ .-]{1,64}$/.test(v) ? { name: v } : null;
}

const time = (v: unknown) => (typeof v === "number" || typeof v === "string" ? fmtTime(v) : "–");

const SEND_TONE: Record<NotifyUserSend["status"], Tone> = { sent: "brand", dry: "muted", planned: "muted", sending: "muted", failed: "critical", cancelled: "muted" };

export const SEND_COLUMNS: DataColumn<NotifyUserSend>[] = [
	{
		id: "kind",
		header: "Kind",
		type: "enum",
		accessor: (r) => r.kind,
		cell: (r) => (
			<View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
				<Txt variant="mono">{r.kind}</Txt>
				{r.test ? <Badge label="test" /> : null}
			</View>
		),
	},
	{ id: "plannedAt", header: "Planned", type: "date", accessor: (r) => r.plannedAt, format: time },
	{ id: "sentAt", header: "Sent", type: "date", accessor: (r) => r.sentAt, format: time },
	{
		id: "status",
		header: "Status",
		type: "enum",
		accessor: (r) => r.status,
		cell: (r) => (
			<View style={{ gap: 2 }}>
				<Badge label={r.status} tone={SEND_TONE[r.status]} />
				{r.http || r.code ? <Txt variant="small">{[r.http, r.code].filter(Boolean).join(" ")}</Txt> : null}
				{r.try > 1 ? <Txt variant="small">try {r.try}</Txt> : null}
			</View>
		),
		width: 130,
	},
	{ id: "openedAt", header: "Opened", type: "date", accessor: (r) => r.openedAt, format: time },
	{ id: "playedSecs", header: "Played", hint: "s", type: "number", accessor: (r) => r.playedSecs },
	{ id: "category", header: "Category", accessor: (r) => r.category, mono: true, defaultHidden: true },
	{ id: "nid", header: "nid", accessor: (r) => r.nid, mono: true, defaultHidden: true },
];

const INTENT_ORDER = ["pending", "sent", "failed", "dropped", "expired", "superseded"] as const;
const paramsText = (r: NotifyUserIntent) =>
	r.params
		? Object.entries(r.params)
				.map(([k, v]) => `${k}=${v}`)
				.join(", ")
		: "";
const INTENT_COLUMNS: DataColumn<NotifyUserIntent>[] = [
	{ id: "kind", header: "Kind", type: "enum", accessor: (r) => r.kind, mono: true },
	{ id: "key", header: "Key", accessor: (r) => r.key, mono: true },
	{
		id: "status",
		header: "Status",
		type: "enum",
		order: INTENT_ORDER,
		accessor: (r) => r.status,
		cell: (r) => (
			<View style={{ gap: 2 }}>
				<Badge label={r.status} tone={r.status === "pending" ? "brand" : r.status === "failed" ? "critical" : "muted"} />
				{r.planned ? <Txt variant="small">planned</Txt> : null}
			</View>
		),
	},
	{ id: "at", header: "At", type: "date", accessor: (r) => r.at, format: time },
	{ id: "until", header: "Until", type: "date", accessor: (r) => r.until, format: time },
	{ id: "updated", header: "Updated", type: "date", accessor: (r) => r.updated, format: time, defaultHidden: true },
	{ id: "params", header: "Params", accessor: (r) => paramsText(r) || null, mono: true, width: 200 },
];

const EVENT_LABELS: Record<NotifyUserEvent["name"], string> = {
	optin_check: "prompt check",
	optin_shown: "prompt shown",
	optin_closed: "prompt closed",
	optin_inferred: "inferred",
	open: "opened",
	open_bad: "bad open",
	played: "played",
};

const CONSENT_COLUMNS: DataColumn<NotifyUserEvent>[] = [
	{ id: "at", header: "At", type: "date", accessor: (r) => r.at, format: time },
	{ id: "name", header: "Row", type: "enum", accessor: (r) => EVENT_LABELS[r.name] ?? r.name },
	{ id: "where", header: "Where", accessor: (r) => r.where, mono: true },
	{
		id: "result",
		header: "Result",
		accessor: (r) => r.state ?? r.can ?? "",
		cell: (r) =>
			r.name === "optin_inferred" ? (
				<Badge label={r.state === "not_subscribed" ? "not subscribed" : (r.state ?? "–")} tone={r.state === "subscribed" ? "brand" : "muted"} />
			) : r.can ? (
				<Txt variant="small">{r.can === "true" ? "can prompt" : "can't prompt"}</Txt>
			) : (
				<Txt variant="small">–</Txt>
			),
	},
	{ id: "secs", header: "Up for", hint: "s", type: "number", accessor: (r) => r.secs },
	{ id: "err", header: "Error", accessor: (r) => r.err, mono: true, width: 200 },
	{ id: "pid", header: "pid", accessor: (r) => r.pid, format: (v) => shortId(v as string, 6), mono: true, defaultHidden: true },
];

function Consent({ view }: { view: NotifyUserView }) {
	const s = view.state;
	const rows = (view.events?.rows ?? []).filter((r) => r.name.startsWith("optin_"));
	return (
		<View style={{ gap: space.sm }}>
			<Txt variant="label">Consent</Txt>
			<Card style={{ gap: 0 }}>
				<KV
					label="Kinds off in game"
					value={
						view.prefs?.off.length ? (
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", flexShrink: 1 }}>
								{view.prefs.off.map((k) => (
									<Badge key={k} label={k} />
								))}
								<Txt variant="small">reported {fmtAgo(view.prefs.updated)}</Txt>
							</View>
						) : view.prefs ? (
							`none, every kind on (reported ${fmtAgo(view.prefs.updated)})`
						) : (
							"never reported"
						)
					}
				/>
				{s ? (
					<>
						<KV
							label="Opt-in"
							value={
								<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
									{s.optin ? <Badge label={s.optin === "subscribed" ? "subscribed" : "not subscribed"} tone={s.optin === "subscribed" ? "brand" : "muted"} /> : <Txt>unknown</Txt>}
									{s.optinAt ? <Txt variant="small">learned {fmtAgo(s.optinAt)}</Txt> : null}
								</View>
							}
						/>
						<KV label="Muted" value={s.muted && s.muteUntil ? `until ${fmtTime(s.muteUntil)}` : "no"} />
						<KV label="Online" value={s.online ? "yes" : "no"} />
						{s.lastSeen ? <KV label="Last seen" value={fmtTime(s.lastSeen)} /> : null}
						<KV label="Unopened" value={fmtInt(s.unopened)} />
						{s.backoffAt ? <KV label="Backoff since" value={fmtTime(s.backoffAt)} /> : null}
						{s.cappedUntil ? <KV label="Capped until" value={fmtTime(s.cappedUntil)} /> : null}
						{s.nextCheck ? <KV label="Next check" value={fmtTime(s.nextCheck)} /> : null}
						{s.busy ? <KV label="Busy" value={s.busy} /> : null}
					</>
				) : (
					<Txt variant="small">The sender has no state for this player yet.</Txt>
				)}
			</Card>
			{rows.length ? (
				<DataTable id="notify-player-consent" label="Prompt and consent rows" columns={CONSENT_COLUMNS} data={rows} rowId={(r) => `${r.t}|${r.pid}|${r.name}|${r.nid ?? ""}`} density="compact" />
			) : view.events ? (
				<Txt variant="muted">No prompt or consent rows for this player.</Txt>
			) : null}
		</View>
	);
}

/** Plans/30: next to each opened send, the opening session's raw join data. */
function Opens({ view }: { view: NotifyUserView }) {
	const byNid = new Map((view.events?.opens ?? []).map((o) => [o.nid, o]));
	const opened = view.sends.filter((s) => s.openedAt !== null && byNid.has(s.nid));
	if (!opened.length) return null;
	return (
		<View style={{ gap: space.sm }}>
			<Txt variant="label">Opening sessions ({fmtInt(opened.length)})</Txt>
			<Txt variant="small">What Roblox handed the session each opened notification started (its join row's raw join data).</Txt>
			{opened.map((s) => {
				const o = byNid.get(s.nid);
				return (
					<View key={s.nid} style={{ gap: 4 }}>
						<Txt variant="small">
							{s.kind} · {s.nid} · opened {time(s.openedAt)}
						</Txt>
						{o?.jd ? <JoinData jd={o.jd} label="Join data" /> : <Txt variant="small">No join data stored for that session.</Txt>}
					</View>
				);
			})}
		</View>
	);
}

/** The player as one link (tap: the player page; long press: the card); the UserId alone without a pid. */
export function Who({ backendId, view }: { backendId: string; view: NotifyUserView }) {
	const pid = view.pids[0];
	const q = usePlayerProfile(backendId, pid ?? "", !view.name && pid !== undefined);
	if (pid === undefined) return <Txt style={{ fontWeight: "600" }}>UserId {view.userId}</Txt>;
	const name = view.name ?? q.data?.name ?? undefined;
	const displayName = view.displayName ?? q.data?.displayName ?? undefined;
	return <PidLink backendId={backendId} pid={pid} uid={view.userId} {...(name ? { name } : {})} {...(displayName ? { displayName } : {})} />;
}

/** One send's debugging detail: Roblox's refusal, the request it posts, the params / data it was planned with. */
export function SendDetail({ send }: { send: NotifyUserSend }) {
	return (
		<Card style={{ gap: space.sm }}>
			<Txt style={{ fontWeight: "600" }}>{send.kind}</Txt>
			<KV label="nid" value={send.nid} mono />
			<KV label="template" value={send.template ?? "–"} mono />
			<KV label="Roblox id" value={send.robloxId ?? "–"} mono />
			{send.status === "failed" || send.status === "cancelled" ? (
				<Callout tone="critical" title={`Roblox answered ${[send.http, send.code].filter(Boolean).join(" ")}`}>
					{send.error ?? "No message kept (sends before 2026-11-08 kept only the code)."}
				</Callout>
			) : null}
			<Txt variant="label">Request body</Txt>
			<Txt variant="small">What the send posts to Roblox (the signed launch data is made per send and left out).</Txt>
			{send.request ? <JsonBlock value={send.request} max={320} /> : <Txt variant="muted">Not available.</Txt>}
			{send.data ? (
				<>
					<Txt variant="label">Launch data (signed into join_experience)</Txt>
					<JsonBlock value={send.data} max={160} />
				</>
			) : null}
		</Card>
	);
}

export function PlayerView({ backendId, view, onPick }: { backendId: string; view: NotifyUserView; onPick(uid: number): void }) {
	const pending = view.intents.filter((i) => i.status === "pending").length;
	const [picked, setPicked] = useState<string | null>(null);
	useEffect(() => setPicked(null), [view.userId]);
	const shown = view.sends.find((x) => x.nid === picked);
	return (
		<View style={{ gap: space.md }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
				<Who backendId={backendId} view={view} />
				<Txt variant="small">UserId {view.userId}</Txt>
				{!view.known ? <Badge label="no notify rows yet" /> : null}
			</View>
			{view.otherMatches?.length ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
					<Txt variant="small">Also named so:</Txt>
					{view.otherMatches.map((uid) => (
						<Button key={uid} title={String(uid)} small variant="ghost" onPress={() => onPick(uid)} />
					))}
				</View>
			) : null}
			<Consent view={view} />
			<Txt variant="label">Notifications ({fmtInt(view.sends.length)})</Txt>
			{view.sends.length ? (
				<>
					<DataTable
						id="notify-player-sends"
						label="Past notifications"
						columns={SEND_COLUMNS}
						data={view.sends}
						rowId={(r) => r.nid}
						density="compact"
						onRowPress={(r) => setPicked((x) => (x === r.nid ? null : r.nid))}
						isRowSelected={(r) => r.nid === picked}
					/>
					{shown ? <SendDetail send={shown} /> : <Txt variant="small">Tap a notification to see its payload and Roblox's answer.</Txt>}
				</>
			) : (
				<Txt variant="muted">Nothing planned or sent to this player.</Txt>
			)}
			<Opens view={view} />
			<Txt variant="label">Intents ({fmtInt(pending)} pending)</Txt>
			{view.intents.length ? (
				<DataTable id="notify-player-intents" label="Intents" columns={INTENT_COLUMNS} data={view.intents} rowId={(r) => `${r.kind}|${r.key}|${r.at ?? ""}`} density="compact" />
			) : (
				<Txt variant="muted">No intents for this player.</Txt>
			)}
			{view.eventsError ? <Txt variant="small">Event rows unavailable: {view.eventsError}</Txt> : null}
			{view.events?.more ? <Txt variant="small">Showing the newest event rows only.</Txt> : null}
		</View>
	);
}

/** One player's notifications, looked up once (the player page's Notifications view and the panel below). */
export function useNotifyUser(backendId: string, lookup: NotifyUserLookup | null) {
	return useTTQuery(backendId, ["notify", "user", lookup], (api, s) => api.notifyUser(lookup as NotifyUserLookup, s), { enabled: lookup !== null, retry: false });
}

export function PlayerPanel({ backendId }: { backendId: string }) {
	const p = useTheme();
	const [params, setParams] = usePageParams();
	const player = params.player ?? "";
	const by: LookupBy = isBy(params.by) ? params.by : "auto";
	const [text, setText] = useState(player);
	useEffect(() => setText(player), [player]);
	const [pickBy, setPickBy] = useState<LookupBy>(by);
	const [problem, setProblem] = useState<string | null>(null);
	const lookup = playerLookup(player, by);
	const q = useNotifyUser(backendId, lookup);
	const open = (value: string, nextBy: LookupBy) => setParams({ player: value || null, by: value && nextBy !== "auto" ? nextBy : null });
	const submit = () => {
		setProblem(null);
		const v = text.trim();
		if (v && !playerLookup(v, pickBy)) return setProblem(pickBy === "uid" ? "A UserId is digits only." : "Letters, digits, _ and - only (names may also have spaces and dots).");
		if (v === player && pickBy === by && lookup) void q.refetch();
		else open(v, pickBy);
	};
	const pick = (uid: number) => {
		setText(String(uid));
		setPickBy("uid");
		open(String(uid), "uid");
	};
	return (
		<Section title="Player">
			<Txt variant="small">One player's notifications: consent, every send with its opens and plays, the intents. Find them by UserId, pid or a name the server has seen.</Txt>
			<Field value={text} onChangeText={setText} placeholder="UserId, pid or username" returnKeyType="search" onSubmitEditing={submit} />
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<View style={{ flex: 1 }}>
					<Chips options={(Object.keys(BY_LABELS) as LookupBy[]).map((k) => ({ value: k, label: BY_LABELS[k] }))} value={pickBy} onChange={setPickBy} />
				</View>
				<Button title="Find" small icon="search" onPress={submit} />
			</View>
			{problem ? (
				<Txt variant="small" color={p.destructive}>
					{problem}
				</Txt>
			) : null}
			{!player ? null : !lookup ? (
				<Txt variant="small" color={p.destructive}>
					That is not a UserId, pid or name.
				</Txt>
			) : q.error ? (
				<ErrorState error={q.error} title="Could not load this player" onRetry={() => void q.refetch()} />
			) : !q.data ? (
				<Skeleton height={120} />
			) : (
				<PlayerView backendId={backendId} view={q.data} onPick={pick} />
			)}
		</Section>
	);
}
