/**
 * Notifications (web pages/Notifications.tsx, plans/29): experience notifications, from the `notify` rows and the
 * backend's live sender. A header (the live status chip with the queue in a sheet, dry run, the range, the kind, Send a
 * test), the halted banners, four KPIs and tabs (`tab` in the route):
 *
 *   - Health: a status sentence, who can get notifications, opened and back-next-day per day, Needs attention.
 *   - Funnel: prompt shown -> subscribed -> sent -> opened -> played 1 min+ -> back next day, insights, sends per day,
 *     the opt-in prompt by spot (`notify-funnel`, `notify-optin`).
 *   - Inbox (owners): the newest sends (GET /v1/notify/recent, every 15 s), filters, a sheet per send, and the Player
 *     panel (`player`, `by` in the route; GET /v1/notify/user).
 *   - Subscribers (owners): the opt-in list (GET /v1/notify/users), CSV through the share sheet.
 *   - Kinds: per kind with its switch (owners, PATCH /v1/admin/settings), by kind and day.
 *   - Queue & errors: the live queue (owners), failures, planned and skipped by why, the history per hour (`notify-queue`).
 *   - Settings (owners): `notify.*` runtime settings, a test send (POST /v1/notify/test), the kinds' config record (GET
 *     /v1/notify/config).
 *
 * The read-only `web` role sees the analytics only (the status, config, lists and controls answer it 403). Only the time
 * range applies, so the screen has its own range chips (the filter bar's range, shared with the other screens).
 */
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ApiError } from "@/api/backend";
import { change } from "@/api/tt/benchmarks";
import type { Filters, NotifyHalt, NotifyStatus } from "@/api/tt/types";
import { Badge, Button, Chips, ErrorState, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { Callout, RangePicker } from "@/features/typetorch/analytics-bits";
import { ChangeChip } from "@/features/typetorch/bits";
import { describeRange, isoDate, rangeOnly, useTTAnalytics, useTTFilters, type RangePreset } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { attentionItems, healthSentence, NOTIFY_STATUS_KEY, NOTIFY_TABS, OWNER_TABS, StatusDot, TAB_LABELS, type NotifyTab } from "@/features/typetorch/notifications/shared";
import { FunnelTab, HealthTab, InboxTab, KindsTab, QueueTab, RightNow, SettingsTab, SubscribersTab, useOptinCounts } from "@/features/typetorch/notifications/tabs";
import { isReadOnly } from "@/features/typetorch/roles";
import { TTScreen } from "@/features/typetorch/screen";
import { Sheet } from "@/features/typetorch/sheet";
import { usePageParam, usePageParams } from "@/features/typetorch/view-link";
import { fmtInt, fmtPct, fmtTime } from "@/lib/format";
import type { BackendAccount } from "@/store/accounts";
import { space, useTheme } from "@/theme";

const DAY_MS = 86_400_000;

/** The same span right before the range, for the Sent card's change (day presets only). */
function priorRange(range: RangePreset, now = Date.now()): Filters | null {
	if (range === "custom" || range === "1h" || range === "6h" || range === "deploy") return null;
	const days = Number.parseInt(range, 10);
	if (!Number.isFinite(days)) return null;
	return { from: isoDate(now - (2 * days - 1) * DAY_MS), to: isoDate(now - days * DAY_MS) };
}

function HaltedBanner({ status }: { status: NotifyStatus }) {
	const all = status.haltedAll ?? status.halted.find((h) => !h.kind) ?? null;
	const kinds = status.halted.filter((h): h is Extract<NotifyHalt, { why: "bad_template" }> => typeof h.kind === "string" && h.kind !== "");
	const templates = status.haltedTemplates ?? [];
	if (!all && !kinds.length && !templates.length) return null;
	return (
		<View style={{ gap: space.sm }}>
			{all ? (
				<Callout tone="critical" title="Every send stopped">
					<Txt variant="small" selectable>
						Notifications stopped: Roblox refused the Open Cloud key (401 / 403). Check OPENCLOUD_NOTIFY_KEY's scope (user-notifications) and universe, then turn notifications back on.
					</Txt>
					<Txt variant="small">Since {fmtTime(all.at)}.</Txt>
				</Callout>
			) : null}
			{templates.length ? (
				<Callout tone="warning" title="Templates stopped">
					<Txt variant="small">Roblox says these game-supplied templates (message ids) don't exist; sends that use them are dropped.</Txt>
					{templates.map((t) => (
						<Txt key={t.template} variant="small" selectable>
							{t.template} · since {fmtTime(t.at)}
						</Txt>
					))}
				</Callout>
			) : null}
			{kinds.map((h) => (
				<Callout key={h.kind} tone="critical" title={`Kind ${h.kind} stopped`}>
					<Txt variant="small">Kind {h.kind} stopped: its template (message id) does not exist on Roblox. Fix the template, push the config, then turn the kind back on.</Txt>
					<Txt variant="small">Since {fmtTime(h.at)}. Its pending sends wait until then.</Txt>
				</Callout>
			))}
		</View>
	);
}

/** "Sending · 5/s" (or Paused / Stopped); a tap shows the live queue (the web's popover). */
function StatusChip({ status, onQueue }: { status: NotifyStatus; onQueue(): void }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	const level = healthSentence(status, undefined).level;
	const text = status.haltedAll ? "Stopped" : !status.enabled ? "Paused" : `Sending · ${status.bucket.rate}/s`;
	return (
		<>
			<Pressable onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: p.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
				<StatusDot level={level} />
				<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
					{text}
				</Txt>
			</Pressable>
			<Sheet open={open} onClose={() => setOpen(false)} title="Right now">
				<RightNow status={status} />
				<Button
					title="Queue & errors"
					small
					variant="ghost"
					onPress={() => {
						setOpen(false);
						onQueue();
					}}
					style={{ alignSelf: "flex-start" }}
				/>
			</Sheet>
		</>
	);
}

export default function NotificationsScreen() {
	return <TTScreen title="Notifications">{({ backendId, account }) => <Notifications backendId={backendId} account={account} />}</TTScreen>;
}

function Notifications({ backendId, account }: { backendId: string; account: BackendAccount }) {
	const { state, apiFilters, pending } = useTTFilters(backendId);
	const readOnly = isReadOnly(account);
	const [kind, setKind] = usePageParam("kind");
	const [params, setParams] = usePageParams();
	const options = kind ? { kind } : {};
	const range = rangeOnly(apiFilters);
	const live = !pending;
	const funnel = useTTAnalytics(backendId, "notify-funnel", options, { filters: range, enabled: live });
	const prior = priorRange(state.range);
	const before = useTTAnalytics(backendId, "notify-funnel", options, { enabled: live && prior !== null, filters: prior ?? range });
	const optin = useTTAnalytics(backendId, "notify-optin", {}, { filters: range, enabled: live });
	const queue = useTTAnalytics(backendId, "notify-queue", options, { filters: range, enabled: live });
	const status = useTTQuery(backendId, NOTIFY_STATUS_KEY, (api, s) => api.notifyStatus(s), { enabled: !readOnly, refetchInterval: 15_000, retry: false });
	const liveStatus = status.data;
	// A viewer (or an untrusted owner) gets 403: the analytics still show.
	const forbidden = status.error instanceof ApiError && (status.error.status === 403 || status.error.status === 401);
	const owner = !readOnly && !forbidden;
	const counts = useOptinCounts(backendId, owner);
	const kinds = [...new Set([...(liveStatus?.kinds.map((k) => k.kind) ?? []), ...(funnel.data?.kinds.map((k) => k.kind).filter(Boolean) ?? [])])].sort();
	const kindItems = kind && !kinds.includes(kind) ? [kind, ...kinds] : kinds;

	const rawTab = params.tab as NotifyTab | undefined;
	const fallback: NotifyTab = params.player && owner ? "inbox" : "health";
	const visible = NOTIFY_TABS.filter((t) => owner || !OWNER_TABS.includes(t));
	const tab: NotifyTab = rawTab && visible.includes(rawTab) && (rawTab !== "settings" || owner) ? rawTab : fallback;
	const goTab = (next: NotifyTab) => setParams({ tab: next === "health" ? null : next });

	const items = attentionItems({ status: liveStatus, queue: queue.data, optin: optin.data });
	const queueIssues = items.filter((i) => i.tab === "queue").length;
	const t = funnel.data?.totals;
	const today = funnel.data?.daily.find((d) => d.date === isoDate(Date.now()))?.sent ?? 0;
	const optinCounts = owner ? counts.data : undefined;

	return (
		<>
			<Txt variant="small">Experience notifications, {describeRange(state)}: what was sent, opened and played, who can get them and the sender.</Txt>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
				{liveStatus ? <StatusChip status={liveStatus} onQueue={() => goTab("queue")} /> : null}
				{liveStatus ? <Badge label={liveStatus.dryRun ? "Dry run on" : "Dry run off"} tone={liveStatus.dryRun ? "warning" : "muted"} /> : null}
				{owner && liveStatus ? <Button title="Send a test" small variant="primary" icon="send-outline" onPress={() => goTab("settings")} /> : null}
			</View>
			<RangePicker backendId={backendId} />
			{kindItems.length ? <Chips options={[{ value: "", label: "All kinds" }, ...kindItems.map((k) => ({ value: k, label: k }))]} value={kind} onChange={setKind} /> : null}
			{liveStatus ? <HaltedBanner status={liveStatus} /> : null}
			<StatGrid>
				<Stat
					label="Subscribers (known)"
					value={optinCounts ? fmtInt(optinCounts.subscribed) : optin.data ? fmtInt(optin.data.totals.subscribed) : "–"}
					sub={optinCounts ? `+${fmtInt(optinCounts.newThisWeek)} this week` : "learned from sends in this range"}
				/>
				<Stat
					label="Sent"
					value={t ? fmtInt(t.sent) : "–"}
					sub={
						<View style={{ gap: 2 }}>
							{t && before.data && prior ? (
								<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
									<ChangeChip change={change(t.sent, before.data.totals.sent)} />
									<Txt variant="small">vs the {Number.parseInt(state.range, 10)} days before</Txt>
								</View>
							) : null}
							<Txt variant="small">
								{fmtInt(today)} today{t?.tests ? `, +${fmtInt(t.tests)} test` : ""}
							</Txt>
						</View>
					}
				/>
				<Stat label="Opened" value={t?.sent ? fmtPct(t.openRate) : "–"} sub={t ? `${fmtInt(t.opened)} opens, ${t.opened ? fmtPct(t.playedRate, 0) : "–"} played 1 min+` : undefined} />
				<Stat label="Came back next day" value={t?.players ? fmtPct(t.returnRate) : "–"} sub={t ? `+${fmtInt(t.assisted)} assisted (back without opening)` : undefined} />
			</StatGrid>

			<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
				{visible.map((id) => {
					const on = id === tab;
					return (
						<Pressable key={id} onPress={() => goTab(id)}>
							<TabChip label={TAB_LABELS[id]} on={on} badge={id === "queue" && queueIssues ? queueIssues : 0} />
						</Pressable>
					);
				})}
			</ScrollView>

			{tab === "health" ? (
				<HealthTab
					status={liveStatus}
					funnel={funnel.data}
					counts={optinCounts ?? (optin.data ? { subscribed: optin.data.totals.subscribed, notSubscribed: optin.data.totals.notSubscribed, unknown: 0 } : undefined)}
					countsNote={optinCounts ? undefined : "Answers learned in this range; the full list is for owners."}
					items={items}
					goTab={goTab}
					owner={owner}
				/>
			) : null}
			{tab === "funnel" ? (
				funnel.error ? (
					<ErrorState error={funnel.error} onRetry={() => void funnel.refetch()} />
				) : !funnel.data ? (
					<Skeleton height={240} />
				) : !funnel.data.kinds.length ? (
					<Txt variant="muted">No notification rows in this range. The game asks for notifications with TypeTorch.notifications().want(...).</Txt>
				) : (
					<FunnelTab funnel={funnel.data} optin={optin.data} />
				)
			) : null}
			{tab === "inbox" && owner ? <InboxTab backendId={backendId} kind={kind} status={liveStatus} /> : null}
			{tab === "subscribers" && owner ? <SubscribersTab backendId={backendId} /> : null}
			{tab === "kinds" ? (
				funnel.error ? (
					<ErrorState error={funnel.error} onRetry={() => void funnel.refetch()} />
				) : !funnel.data ? (
					<Skeleton height={240} />
				) : (
					<KindsTab backendId={backendId} funnel={funnel.data} queue={queue.data} status={liveStatus} canEdit={owner && Boolean(liveStatus)} />
				)
			) : null}
			{tab === "queue" ? queue.error ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : !queue.data ? <Skeleton height={200} /> : <QueueTab data={queue.data} status={liveStatus} /> : null}
			{tab === "settings" && owner ? (
				status.error ? (
					<ErrorState error={status.error} onRetry={() => void status.refetch()} />
				) : liveStatus ? (
					<SettingsTab backendId={backendId} status={liveStatus} />
				) : (
					<Skeleton height={200} />
				)
			) : null}
		</>
	);
}

function TabChip({ label, on, badge }: { label: string; on: boolean; badge: number }) {
	const p = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? p.brand : p.border, backgroundColor: on ? p.brand : p.card }}>
			<Txt variant="small" color={on ? p.brandForeground : p.foreground} style={{ fontWeight: "600" }}>
				{label}
			</Txt>
			{badge ? <Badge label={String(badge)} tone="warning" /> : null}
		</View>
	);
}
