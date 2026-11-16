/**
 * Live events (web pages/LiveEvents.tsx, lib/live-events.ts = api/tt/live-events.ts): scheduled changes to game live
 * values ("double cash, Saturday 12:00 to Sunday 23:59 UTC"), and afterwards whether each one raised playtime, revenue
 * and so on, or just moved it in time.
 *   - The signing card: the backend never signs. When servers don't hold the current schedule yet, it shows the CLI
 *     command that signs it (bash / zsh, or PowerShell with the JSON saved as a file: shared from the phone).
 *   - Owners schedule (name, the game values as JSON, start and end in UTC with the local time beside) and cancel.
 *   - Live now, Upcoming, Past (every 60 s; "Check again" = `refresh=1`); a past or live event opens its lift report:
 *     baseline weeks, days after, each metric's lift with the baseline's normal range, the net, and the verdict.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { useBackend } from "@/store/accounts";
import { compactJson, fmtAgo, fmtInt, fmtMinutes, fmtNum, fmtPct } from "@/lib/format";
import {
	LIFT_ROWS,
	NET_ROWS,
	fmtLift,
	fmtLocal,
	fmtSpread,
	fmtUtc,
	isoToUtcInput,
	parseValues,
	utcInputToIso,
	type Direction,
	type Lift,
	type LiftReport,
	type LiveEvent,
	type LiveEventsView,
	type SignedView,
	type SyncState,
} from "@/api/tt/live-events";
import { Badge, Button, confirm, ErrorState, Field, SkeletonList, Txt } from "@/components/ui";
import { Callout } from "@/features/typetorch/analytics-bits";
import { CopyButton, Note, Panel } from "@/features/typetorch/bits";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { shareTextFile } from "@/features/typetorch/table";
import { radius, space, toneColor, useTheme, type Tone } from "@/theme";

export const LIVE_EVENTS_KEY = ["live-events"] as const;

const STATUS_TONE: Record<LiveEvent["status"], Tone> = { live: "good", scheduled: "brand", ended: "muted", cancelled: "muted" };

export const SYNC_TEXT: Record<SyncState, { label: string; tone: "good" | "warn" | "muted" }> = {
	signed: { label: "Signed: servers have it", tone: "good" },
	outdated: { label: "Signed with other times or values: sign again", tone: "warn" },
	unsigned: { label: "Not signed yet: servers won't run it", tone: "warn" },
	"cancel-unsigned": { label: "Cancelled, but still signed: servers WILL run it until you sign", tone: "warn" },
	done: { label: "", tone: "muted" },
	unknown: { label: "Signed state unknown", tone: "muted" },
};

/** One line about the signed record the backend read back. */
export function signedText(s: SignedView): string {
	if (s.state === "unconfigured") return "The backend can't read the signed record (set OPENCLOUD_API_KEY with universe-datastores.objects:read and TYPETORCH_UNIVERSE_ID), so it can't tell whether servers have the schedule.";
	if (s.state === "missing") return "No signed settings record yet.";
	if (s.state === "error") return `Reading the signed record failed: ${s.error ?? "unknown error"}`;
	const by = s.verified === "sig" || s.verified === "sigF" ? `signature verified (${s.verified})` : s.verified === "no" ? "NOT signed by the game's keys: servers refuse it" : "signature not checked (no game signing keys on this backend)";
	return `Signed record #${s.seq}, written ${s.at ? fmtAgo(s.at) : "–"}, ${by}; read ${fmtAgo(s.readAt)}.`;
}

export default function LiveEventsScreen() {
	return <TTScreen title="Live events">{({ backendId, account }) => <LiveEvents backendId={backendId} canEdit={account.role === "admin"} />}</TTScreen>;
}

function LiveEvents({ backendId, canEdit }: { backendId: string; canEdit: boolean }) {
	const client = useQueryClient();
	const { api } = useBackend(backendId);
	const [refreshing, setRefreshing] = useState(false);
	const view = useTTQuery(backendId, LIVE_EVENTS_KEY, (a, signal) => a.liveEvents(false, signal), { refetchInterval: 60_000 });
	const changed = () => {
		void client.invalidateQueries({ queryKey: ["tt", backendId, ...LIVE_EVENTS_KEY] });
	};
	const data = view.data;
	const live = data?.events.filter((e) => e.status === "live") ?? [];
	const upcoming = (data?.events.filter((e) => e.status === "scheduled") ?? []).sort((a, b) => a.start.localeCompare(b.start));
	const past = data?.events.filter((e) => e.status === "ended" || e.status === "cancelled") ?? [];
	return (
		<>
			<Note>Scheduled changes to game live values (liveConfig keys), switched on and off by every server at the times; afterwards, whether each one raised playtime and revenue or only moved them in time.</Note>
			{view.isPending && !view.error ? <SkeletonList rows={4} /> : null}
			{view.error && !data ? <ErrorState error={view.error} onRetry={() => view.refetch()} /> : null}
			{data ? (
				<>
					<SigningCard
						view={data}
						canEdit={canEdit}
						refreshing={refreshing}
						onRefresh={() => {
							if (!api) return;
							setRefreshing(true);
							api
								.liveEvents(true)
								.then((fresh) => client.setQueryData(["tt", backendId, ...LIVE_EVENTS_KEY], fresh))
								.catch(() => undefined)
								.finally(() => setRefreshing(false));
						}}
					/>
					{canEdit ? (
						<Panel title="Schedule an event" note="The game reads these keys with TypeTorch.liveConfig (its parse still checks the values); two events can't set one key at the same time.">
							<CreateForm backendId={backendId} onDone={changed} />
						</Panel>
					) : null}
					<EventList backendId={backendId} title="Live now" events={live} empty="Nothing running." canEdit={canEdit} onChanged={changed} />
					<EventList backendId={backendId} title="Upcoming" events={upcoming} empty="Nothing scheduled." canEdit={canEdit} onChanged={changed} />
					<EventList backendId={backendId} title="Past" events={past} empty="No past events yet." canEdit={canEdit} onChanged={changed} />
				</>
			) : null}
		</>
	);
}

function Copyable({ label, text }: { label: string; text: string }) {
	const p = useTheme();
	return (
		<View style={{ gap: 4 }}>
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
				<Txt variant="small" style={{ fontWeight: "600" }}>
					{label}
				</Txt>
				<CopyButton text={text} />
			</View>
			<View style={{ backgroundColor: p.muted, borderRadius: radius.sm, padding: space.sm, maxHeight: 160 }}>
				<Txt variant="mono" selectable style={{ fontSize: 11 }}>
					{text}
				</Txt>
			</View>
		</View>
	);
}

function SigningCard({ view, canEdit, refreshing, onRefresh }: { view: LiveEventsView; canEdit: boolean; refreshing: boolean; onRefresh(): void }) {
	const refresh = <Button title="Check again" small icon="refresh" loading={refreshing} onPress={onRefresh} style={{ alignSelf: "flex-start" }} />;
	if (!view.needsSigning) {
		return (
			<Panel title="Servers' schedule" note={signedText(view.signed)}>
				<Txt variant="muted">
					{view.signed.state === "ok" ? "Servers hold the current schedule: each event switches on and off at its times on its own." : "Sign the schedule with the CLI after every change (below when one is needed)."}
				</Txt>
				{refresh}
			</Panel>
		);
	}
	return (
		<Callout tone="warning" title="Sign the schedule: servers don't have the latest changes">
			<View style={{ gap: space.sm }}>
				<Txt variant="small">
					The backend can't sign (it never holds the game's key). {canEdit ? "Run this where your signing keys are" : "An owner runs this where the signing keys are"}; servers pick it up within seconds and then switch each event on and off at its times on their own, even if the backend is down. {signedText(view.signed)}
				</Txt>
				{canEdit ? (
					<>
						<Copyable label="bash / zsh" text={view.commands.bash} />
						<Copyable label="PowerShell (after Download JSON)" text={view.commands.powershell} />
						<Button title="Download JSON" small icon="download-outline" onPress={() => void shareTextFile("live-events.json", view.commands.json, "application/json", false)} style={{ alignSelf: "flex-start" }} />
					</>
				) : null}
				{refresh}
			</View>
		</Callout>
	);
}

/** The schedule form (owners). Times are UTC ("2026-11-21T12:00"); the phone's local time shows under each. */
function CreateForm({ backendId, onDone }: { backendId: string; onDone(): void }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const [name, setName] = useState("");
	const [values, setValues] = useState('{ "cash.multiplier": 2 }');
	const [start, setStart] = useState("");
	const [end, setEnd] = useState("");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const startIso = utcInputToIso(start.trim().replace(" ", "T"));
	const endIso = utcInputToIso(end.trim().replace(" ", "T"));

	async function submit() {
		setError(null);
		let parsed: Record<string, unknown>;
		try {
			parsed = parseValues(values);
		} catch (err) {
			setError((err as Error).message);
			return;
		}
		if (!startIso || !endIso) {
			setError("Pick the start and the end (UTC, YYYY-MM-DDTHH:MM).");
			return;
		}
		if (!api) return;
		setBusy(true);
		try {
			await api.createLiveEvent({ name: name.trim(), values: parsed, start: startIso, end: endIso, ...(note.trim() ? { note: note.trim() } : {}) });
			setName("");
			setNote("");
			onDone();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<View style={{ gap: space.sm }}>
			<Field label="Name" value={name} onChangeText={setName} placeholder="Double cash weekend" maxLength={80} />
			<Field label="Game values while it runs (JSON: the liveConfig keys)" value={values} onChangeText={setValues} multiline autoCapitalize="none" autoCorrect={false} style={{ fontFamily: "monospace", fontSize: 12 }} />
			<Field label="Start (UTC)" value={start} onChangeText={setStart} placeholder="2026-11-21T12:00" autoCapitalize="none" autoCorrect={false} hint={startIso ? fmtLocal(startIso) : undefined} />
			<Button title="Start now" small variant="ghost" onPress={() => setStart(isoToUtcInput(Date.now()))} style={{ alignSelf: "flex-start" }} />
			<Field label="End (UTC)" value={end} onChangeText={setEnd} placeholder="2026-11-22T23:59" autoCapitalize="none" autoCorrect={false} hint={endIso ? fmtLocal(endIso) : undefined} />
			<Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} />
			<Button title="Schedule" variant="primary" loading={busy} disabled={busy || !name.trim()} onPress={() => void submit()} />
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : (
				<Txt variant="small">Then sign the schedule with the CLI (the card above shows the command).</Txt>
			)}
		</View>
	);
}

function directionColor(p: ReturnType<typeof useTheme>, d: Direction): string {
	return d === "up" ? p.good : d === "down" ? p.critical : p.mutedForeground;
}

function fmtLiftMetric(kind: (typeof LIFT_ROWS)[number]["kind"], v: number | null): string {
	if (v === null) return "–";
	if (kind === "count") return fmtInt(v);
	if (kind === "minutes") return fmtMinutes(v);
	if (kind === "share") return fmtPct(v);
	return fmtNum(v);
}

function LiftText({ l }: { l: Lift | undefined }) {
	const p = useTheme();
	if (!l) return <Txt variant="small">–</Txt>;
	return (
		<Txt variant="small">
			<Txt variant="small" color={directionColor(p, l.direction)} style={{ fontWeight: "700" }}>
				{fmtLift(l.lift)}
			</Txt>{" "}
			({fmtSpread(l.spread)})
		</Txt>
	);
}

export function LiftReportView({ report }: { report: LiftReport }) {
	const p = useTheme();
	const plan = report.plan;
	return (
		<View style={{ gap: space.sm }}>
			<Txt style={{ fontWeight: "700" }} color={directionColor(p, report.headline)}>
				{report.verdict}
			</Txt>
			<View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md }}>
				{LIFT_ROWS.map((row, i) => (
					<View key={row.key} style={{ padding: space.sm, gap: 2, borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
						<View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
							<Txt style={{ fontWeight: "600" }}>{row.label}</Txt>
							<Txt>
								{fmtLiftMetric(row.kind, report.event[row.key].value)}
								<Txt variant="small"> vs {fmtLiftMetric(row.kind, report.event[row.key].baseline)}</Txt>
							</Txt>
						</View>
						<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
							<Txt variant="small">Lift (normal range):</Txt>
							<LiftText l={report.event[row.key]} />
						</View>
						<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
							<Txt variant="small">{plan.after ? `${plan.afterDays} day${plan.afterDays === 1 ? "" : "s"} after:` : "After:"}</Txt>
							<LiftText l={report.after?.[row.key]} />
						</View>
					</View>
				))}
			</View>
			{report.net ? <Note>Net over the event and the days after: {NET_ROWS.map((r) => `${r.label} ${fmtLift(report.net?.[r.key].lift)}`).join(", ")}.</Note> : null}
			<Note>
				Baseline: the same weekdays and hours {report.weeksUsed.length ? report.weeksUsed.map((w) => `${w * (plan.stepDays / 7)}`).join(", ") : "–"} week(s) earlier (the mean; the range is how much each of those weeks moved against the others).
				{plan.skipped.length ? ` Skipped: ${plan.skipped.map((s) => `${s.weeksBack * (plan.stepDays / 7)} weeks back (${s.reason})`).join("; ")}.` : ""}
				{report.weeksEmpty.length ? ` No data ${report.weeksEmpty.map((w) => w * (plan.stepDays / 7)).join(", ")} weeks back.` : ""}
				{plan.partial ? " The event is still running: the windows are cut at now." : ""}
				{!plan.partial && plan.afterPartial && plan.afterDays > 0 ? " The days after aren't over yet." : ""}
			</Note>
		</View>
	);
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange(v: number): void }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
			<Txt variant="small">{label}</Txt>
			<Button title="−" small disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} />
			<Txt style={{ fontWeight: "600", minWidth: 18, textAlign: "center" }}>{value}</Txt>
			<Button title="+" small disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} />
		</View>
	);
}

function LiftPanel({ backendId, event }: { backendId: string; event: LiveEvent }) {
	const p = useTheme();
	const [weeks, setWeeks] = useState(3);
	const [afterDays, setAfterDays] = useState(3);
	const lift = useTTQuery(backendId, ["live-event-lift", event.id, weeks, afterDays], (api, signal) => api.liveEventLift(event.id, { weeks, afterDays }, signal), { staleTime: 5 * 60_000 });
	return (
		<View style={{ gap: space.sm, borderWidth: 1, borderColor: p.border, borderRadius: radius.md, padding: space.sm }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
				<Stepper label="Baseline weeks" value={weeks} min={1} max={8} onChange={setWeeks} />
				<Stepper label="Days after" value={afterDays} min={0} max={7} onChange={setAfterDays} />
			</View>
			{lift.isPending && !lift.error ? <SkeletonList rows={3} /> : lift.error ? <ErrorState error={lift.error} title="Could not build the report" onRetry={() => lift.refetch()} /> : lift.data ? <LiftReportView report={lift.data.report} /> : null}
		</View>
	);
}

function EventRow({ backendId, event, canEdit, onChanged, first }: { backendId: string; event: LiveEvent; canEdit: boolean; onChanged(): void; first: boolean }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sync = event.sync ? SYNC_TEXT[event.sync] : undefined;
	const ran = event.status === "live" || event.status === "ended" || (event.status === "cancelled" && event.cancelledAt !== null && event.cancelledAt > event.start);
	const cancel = async () => {
		if (!api || !(await confirm("Cancel this event?", `Cancel "${event.name}"? Servers drop it once you sign the new schedule.`, "Cancel event"))) return;
		setBusy(true);
		setError(null);
		api
			.cancelLiveEvent(event.id)
			.then(onChanged)
			.catch((e: Error) => setError(e.message))
			.finally(() => setBusy(false));
	};
	return (
		<View style={{ gap: 6, paddingVertical: space.sm, borderTopWidth: first ? 0 : 1, borderColor: p.border }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
				<Txt style={{ fontWeight: "600", textDecorationLine: event.status === "cancelled" ? "line-through" : "none" }}>{event.name}</Txt>
				<Badge label={event.status} tone={STATUS_TONE[event.status]} />
			</View>
			{sync?.label ? (
				<Txt variant="small" color={sync.tone === "good" ? p.good : sync.tone === "warn" ? toneColor(p, "warning") : p.mutedForeground} style={sync.tone === "warn" ? { fontWeight: "600" } : undefined}>
					{sync.label}
				</Txt>
			) : null}
			<Txt variant="small">
				{fmtUtc(event.start)} to {fmtUtc(event.end)}
			</Txt>
			<Txt variant="small">
				{fmtLocal(event.start)} to {fmtLocal(event.end)}
			</Txt>
			<Txt variant="mono" style={{ fontSize: 11 }}>
				{compactJson(event.values, 200)}
			</Txt>
			{event.note ? <Txt variant="small">{event.note}</Txt> : null}
			<Txt variant="small">
				by {event.createdBy}
				{event.cancelledAt ? ` · cancelled ${fmtAgo(event.cancelledAt)} by ${event.cancelledBy ?? "–"}` : ""}
			</Txt>
			<View style={{ flexDirection: "row", gap: space.sm }}>
				{ran ? <Button title={open ? "Hide report" : "Lift report"} small icon="analytics-outline" onPress={() => setOpen((o) => !o)} /> : null}
				{canEdit && (event.status === "scheduled" || event.status === "live") ? <Button title="Cancel" small variant="ghost" loading={busy} onPress={() => void cancel()} /> : null}
			</View>
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : null}
			{open ? <LiftPanel backendId={backendId} event={event} /> : null}
		</View>
	);
}

function EventList({ backendId, title, events, empty, canEdit, onChanged }: { backendId: string; title: string; events: LiveEvent[]; empty: string; canEdit: boolean; onChanged(): void }) {
	return (
		<Panel title={title}>
			{events.length ? events.map((e, i) => <EventRow key={e.id} backendId={backendId} event={e} canEdit={canEdit} onChanged={onChanged} first={i === 0} />) : <Txt variant="muted">{empty}</Txt>}
		</Panel>
	);
}
