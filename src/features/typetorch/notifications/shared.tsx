/**
 * Pieces the Notifications screen's tabs share (ports of the web's pages/notifications/{shared.tsx,attention.ts} and
 * HealthTab's healthSentence): the "Needs attention" rules, the status sentence, the subscriber bar, a stat strip, text
 * previews, and the runtime-settings saver the switches use (PATCH /v1/admin/settings, then the status again).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { NotifyFunnelResult, NotifyOptinResult, NotifyOptinTotals, NotifyQueueResult, NotifyStatus } from "@/api/tt/types";
import { Card, Dot, Txt } from "@/components/ui";
import { isoDate } from "@/features/typetorch/filters";
import { fmtInt, fmtPct } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme } from "@/theme";

export const NOTIFY_STATUS_KEY = ["notify", "status"] as const;
export const NOTIFY_CONFIG_KEY = ["notify", "config"] as const;
export const NOTIFY_USERS_COUNTS_KEY = ["notify", "users", "counts"] as const;

export type NotifyTab = "health" | "funnel" | "inbox" | "subscribers" | "kinds" | "queue" | "settings";
export const NOTIFY_TABS: readonly NotifyTab[] = ["health", "funnel", "inbox", "subscribers", "kinds", "queue", "settings"];
export const OWNER_TABS: readonly NotifyTab[] = ["inbox", "subscribers", "settings"];
export const TAB_LABELS: Record<NotifyTab, string> = { health: "Health", funnel: "Funnel", inbox: "Inbox", subscribers: "Subscribers", kinds: "Kinds", queue: "Queue & errors", settings: "Settings" };

export interface AttentionItem {
	id: string;
	level: "error" | "warn" | "info";
	title: string;
	detail: string;
	tab: NotifyTab;
}

const DAY_MS = 86_400_000;
export const SPOT_MIN_SHOWN = 20;
const notOptedIn = (code: string) => /PRECONDITION|NOT_SUBSCRIBED|not_subscribed/i.test(code);

/** The "Needs attention" list from the live status, the queue and the opt-in rows (web attention.ts). */
export function attentionItems(input: { status?: NotifyStatus | undefined; queue?: NotifyQueueResult | undefined; optin?: NotifyOptinResult | undefined; now?: number }): AttentionItem[] {
	const { status, queue, optin } = input;
	const now = input.now ?? Date.now();
	const out: AttentionItem[] = [];
	if (status) {
		if (status.haltedAll) out.push({ id: "halted-all", level: "error", title: "Every send stopped", detail: "Roblox refused the Open Cloud key (401 / 403). Fix the key, then turn sending back on.", tab: "settings" });
		for (const h of status.halted) {
			if (typeof h.kind === "string" && h.kind)
				out.push({ id: `halted-${h.kind}`, level: "error", title: `Kind ${h.kind} stopped`, detail: "Its template (message id) does not exist on Roblox. Fix it, push the config, then turn the kind back on.", tab: "kinds" });
		}
		if (status.haltedTemplates?.length)
			out.push({
				id: "halted-templates",
				level: "warn",
				title: `${status.haltedTemplates.length} game-supplied ${status.haltedTemplates.length === 1 ? "template" : "templates"} stopped`,
				detail: "Roblox says they don't exist; sends that use them are dropped.",
				tab: "queue",
			});
		if (!status.enabled && !status.haltedAll) out.push({ id: "paused", level: "warn", title: "Sending is paused", detail: "Nothing is planned or sent until it is turned back on.", tab: "settings" });
		if (status.dryRun) out.push({ id: "dry-run", level: "info", title: "Dry run is on", detail: "Sends are planned and logged, never posted to Roblox.", tab: "settings" });
		const missing = [!status.configured.universe && "universe", !status.configured.apiKey && "API key", !status.keys.current && "signing key", !status.config && "pushed config"].filter(Boolean);
		if (missing.length) out.push({ id: "setup", level: "error", title: `Missing ${missing.join(", ")}`, detail: "Sends can't go out until the backend has it.", tab: "settings" });
	}
	if (queue) {
		const recent = queue.failures.filter((f) => f.lastAt && now - Date.parse(f.lastAt) < DAY_MS);
		const groups = new Map<string, { http: number | null; code: string; n: number }>();
		let limited = 0;
		for (const f of recent) {
			if (f.http === 429) {
				limited += f.failures;
				continue;
			}
			const key = `${f.http ?? "network"}|${f.code}`;
			const g = groups.get(key) ?? { http: f.http, code: f.code, n: 0 };
			g.n += f.failures;
			groups.set(key, g);
		}
		for (const [key, g] of groups) {
			const what = `${g.http ?? "network"}${g.code ? ` ${g.code}` : ""}`;
			out.push({
				id: `fail-${key}`,
				level: "warn",
				title: `${g.n} ${g.n === 1 ? "send" : "sends"} failed (${what}) in the last 24 h`,
				detail: notOptedIn(g.code) ? "Players who aren't opted in: they are muted 7 days automatically." : "See the failures table for the kinds and Roblox's answer.",
				tab: "queue",
			});
		}
		if (limited) out.push({ id: "rate-limited", level: "info", title: `${limited} rate-limited ${limited === 1 ? "send" : "sends"} (429) in the last 24 h`, detail: "Retried automatically; the sender slows down.", tab: "queue" });
	}
	if (optin) {
		const spots = optin.byWhere.filter((w) => (w.shownPlayers ?? 0) > 0);
		const shown = spots.reduce((a, w) => a + (w.shownPlayers ?? 0), 0);
		const subscribed = spots.reduce((a, w) => a + (w.subscribed ?? 0), 0);
		const average = shown ? subscribed / shown : 0;
		if (spots.length > 1 && average > 0) {
			for (const w of spots) {
				const rate = w.subscribedRate ?? 0;
				if ((w.shownPlayers ?? 0) >= SPOT_MIN_SHOWN && rate < average / 2)
					out.push({
						id: `spot-${w.where}`,
						level: "warn",
						title: `${w.where || "(no spot name)"} prompt converts ${Math.round(rate * 100)}%`,
						detail: `The spots average ${Math.round(average * 100)}%. Consider moving or dropping it.`,
						tab: "funnel",
					});
			}
		}
	}
	const order = { error: 0, warn: 1, info: 2 } as const;
	return out.sort((a, b) => order[a.level] - order[b.level]);
}

export type HealthLevel = "ok" | "warn" | "error";

/** The status line: stopped / paused / dry run / normal, then today's sends, the open rate and the next-day return. */
export function healthSentence(status: NotifyStatus | undefined, funnel: NotifyFunnelResult | undefined, now = Date.now()): { level: HealthLevel; lead: string; rest: string } {
	const lead = !status
		? "Sending status is for owners."
		: status.haltedAll
			? "Every send stopped: Roblox refused the Open Cloud key."
			: !status.enabled
				? "Sending is paused."
				: status.dryRun
					? "Dry run: sends are planned and logged, never posted."
					: status.halted.some((h) => h.kind)
						? "Sending, with a kind stopped."
						: "Sending normally.";
	const level: HealthLevel = !status ? "ok" : status.haltedAll || status.halted.some((h) => h.kind) ? "error" : !status.enabled || status.dryRun ? "warn" : "ok";
	if (!funnel) return { level, lead, rest: "" };
	const today = funnel.daily.find((d) => d.date === isoDate(now))?.sent ?? 0;
	const t = funnel.totals;
	const parts = [`${fmtInt(today)} sent today`];
	if (t.sent) parts.push(`${fmtPct(t.openRate, 0)} opened`);
	if (t.players && t.returnRate > 0) parts.push(`1 in ${Math.max(1, Math.round(1 / t.returnRate))} players notified came back the next day`);
	return { level, lead, rest: `${parts.join(", ")}.` };
}

const LEVEL_TONE = { ok: "good", warn: "warning", error: "critical" } as const;
export function StatusDot({ level }: { level: HealthLevel }) {
	return <Dot tone={LEVEL_TONE[level]} />;
}

/** A row of small numbers in one bordered strip (wraps to two columns on a phone). */
export function StatStrip({ items }: { items: { label: string; value: string; sub?: string }[] }) {
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
			{items.map((item) => (
				<Card key={item.label} style={{ flexGrow: 1, flexBasis: "45%", gap: 2, padding: 10 }}>
					<Txt variant="small">{item.label}</Txt>
					<Txt style={{ fontSize: 18, fontWeight: "700" }}>{item.value}</Txt>
					{item.sub ? <Txt variant="small">{item.sub}</Txt> : null}
				</Card>
			))}
		</View>
	);
}

/** Subscribed / not subscribed / unknown as one bar with a legend (the opt-in the backend learned from its sends). */
export function SubscriberBar({ counts }: { counts: Pick<NotifyOptinTotals, "subscribed" | "notSubscribed" | "unknown"> }) {
	const p = useTheme();
	const total = counts.subscribed + counts.notSubscribed + counts.unknown;
	const parts = [
		{ key: "subscribed", n: counts.subscribed, label: "subscribed", color: p.good, opacity: 1 },
		{ key: "not", n: counts.notSubscribed, label: "not subscribed", color: p.critical, opacity: 1 },
		{ key: "unknown", n: counts.unknown, label: "unknown (never sent to)", color: p.mutedForeground, opacity: 0.3 },
	];
	return (
		<View style={{ gap: 6 }}>
			<View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: p.muted }}>
				{total ? parts.map((x) => (x.n ? <View key={x.key} style={{ width: `${(x.n / total) * 100}%`, backgroundColor: x.color, opacity: x.opacity }} /> : null)) : null}
			</View>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
				{parts.map((x) => (
					<View key={x.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
						<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.color, opacity: x.opacity }} />
						<Txt variant="small">
							<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
								{fmtInt(x.n)}
							</Txt>{" "}
							{x.label}
						</Txt>
					</View>
				))}
			</View>
		</View>
	);
}

/** A kind's text with the send's params filled in (placeholders without a value stay as they are). */
export function fillText(text: string | undefined, params: unknown): string | undefined {
	if (!text) return undefined;
	const q = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
	return text.replace(/\{([A-Za-z0-9_-]{1,32})\}/g, (whole, name: string) => (typeof q[name] === "string" ? (q[name] as string) : whole));
}

/** Two letters for an avatar circle: the name's first two, or the UserId's last two digits. */
export function initials(name: string | null | undefined, userId: number): string {
	return name
		? name
				.replace(/[^A-Za-z0-9]/g, "")
				.slice(0, 2)
				.toUpperCase() || "?"
		: String(userId).slice(-2);
}

/** Saves runtime settings (`notify.*`) and refreshes the status; `notice` says it took effect. */
export function useNotifySettings(backendId: string) {
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const [notice, setNotice] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (changes: Record<string, unknown>) => api!.saveSettings(changes),
		onSuccess: () => setNotice("Saved; in effect now."),
		onSettled: () => {
			void client.invalidateQueries({ queryKey: ["tt", backendId, ...NOTIFY_STATUS_KEY] });
			void client.invalidateQueries({ queryKey: ["tt", backendId, "admin-settings"] });
		},
	});
	const set = (key: string, value: unknown) => {
		setNotice(null);
		save.mutate({ [key]: value });
	};
	return { set, busy: save.isPending, error: save.error, notice };
}
