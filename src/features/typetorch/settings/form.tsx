/**
 * Runtime settings (web pages/Settings.tsx): what an owner may change without a redeploy (GET / PATCH
 * /v1/admin/settings). A value saved here wins over the environment and applies at once; "Reset to env" goes back to
 * the environment's value (the key sent as null). The alert webhook is a secret: the screen only knows whether one is
 * set; a new one goes into a password field that empties after the save, and the backend never sends it back.
 * Groups: Alerts, Backend alerts (the rules editor), Access, Rate limits, Retention and error budgets, API keys,
 * Notifications. Then Send test alert (POST /v1/admin/settings/test-alert), the environment-only list and Recent
 * changes (the view's audit, DataTable `settings-audit`).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { ApiError } from "@/api/backend";
import type { RuntimeSetting, SecretSetting, SettingsAuditEntry, SettingsView, ValueSetting } from "@/api/tt/types";
import { Badge, Button, Card, confirm, Field, Section, Txt } from "@/components/ui";
import { Callout } from "@/features/typetorch/analytics-bits";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { fmtAgo, fmtBytes, fmtInt, fmtTime, plural } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme } from "@/theme";

import { alertRulesChange, BackendAlertRules, type AlertRulesDraft } from "./alert-rules";
import { ChoiceChips, OnOff, SourceBadge } from "./controls";

export const SETTINGS_KEY = ["admin-settings"] as const;

const GROUPS: { id: RuntimeSetting["group"]; title: string; description: string }[] = [
	{ id: "alerts", title: "Alerts", description: "Where fleet alerts go, and which ones." },
	{ id: "backendAlerts", title: "Backend alerts", description: "Alerts the backend raises from its own data, checked once a minute. They show on the Fleet screen and go to the webhook like the game's." },
	{ id: "access", title: "Access", description: "Who may reach the explorer, and how owners sign in." },
	{ id: "limits", title: "Rate limits", description: "Per minute, and when ingest counts as busy. Game servers past a limit get 429 (503 when busy), keep the batch and retry." },
	{ id: "retention", title: "Retention and error budgets", description: "How long data is kept, and how much error data is stored." },
	{ id: "keys", title: "API keys", description: "Named API keys (typetorch keys): the requests a minute per key, and the events a support key may read per player." },
	{ id: "notify", title: "Notifications", description: "Experience notifications: pause, dry run, the send rate ceiling and the day clock. The Notifications screen has the per-kind switches." },
];

export type Draft = Record<string, unknown>;

export function numberProblem(setting: Pick<ValueSetting, "min" | "max" | "zero">, text: string): string | null {
	const t = text.trim();
	const range = `${fmtInt(setting.min ?? 0)} to ${fmtInt(setting.max ?? 0)}${setting.zero ? ` (or 0 = ${setting.zero})` : ""}`;
	if (!/^-?\d+$/.test(t)) return `a whole number from ${range}`;
	const n = Number(t);
	if (setting.zero && n === 0) return null;
	if (n < (setting.min ?? -Infinity) || n > (setting.max ?? Infinity)) return `from ${range}`;
	return null;
}

export function bytesHint(text: string): string {
	const t = text.trim();
	if (!/^\d+$/.test(t) || Number(t) === 0) return "";
	return `= ${fmtBytes(Number(t))}`;
}

export function splitList(text: string): string[] {
	return text
		.split(/[\s,]+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

/** The PATCH body for a draft (plus a newly typed webhook URL), and what blocks saving. */
export function buildChanges(settings: RuntimeSetting[], draft: Draft, newSecret: string): { changes: Record<string, unknown>; problems: Record<string, string> } {
	const changes: Record<string, unknown> = {};
	const problems: Record<string, string> = {};
	for (const [key, value] of Object.entries(draft)) {
		const setting = settings.find((s) => s.key === key);
		if (!setting) continue;
		if (value === null) {
			changes[key] = null;
			continue;
		}
		if (setting.kind === "number") {
			const problem = numberProblem(setting, String(value));
			if (problem) problems[key] = problem;
			else changes[key] = Number(String(value).trim());
		} else if (setting.kind === "alertRules" && setting.rules) {
			const result = alertRulesChange(setting.rules, value as AlertRulesDraft);
			if ("problem" in result) problems[key] = `a valid value (${result.problem})`;
			else changes[key] = result.value;
		} else if (setting.kind === "ips" || setting.kind === "users" || setting.kind === "names") changes[key] = splitList(String(value));
		else changes[key] = value;
	}
	const secret = newSecret.trim();
	const webhook = settings.find((s) => s.kind === "secret");
	if (secret && webhook) {
		if (!/^https:\/\/\S+$/i.test(secret)) problems[webhook.key] = "an https:// URL";
		else changes[webhook.key] = secret;
	}
	return { changes, problems };
}

function auditWhat(e: SettingsAuditEntry): string {
	if (e.action === "test-alert") return `Test alert: ${e.result ?? ""}`;
	return [e.set?.length ? `Set ${e.set.join(", ")}` : "", e.reset?.length ? `Reset ${e.reset.join(", ")}` : ""].filter(Boolean).join("; ");
}

const AUDIT_COLUMNS: DataColumn<SettingsAuditEntry>[] = [
	{ id: "at", header: "When", type: "date", accessor: (e) => e.at, format: (_v, e) => fmtAgo(e.at), exportValue: (e) => fmtTime(e.at) },
	{ id: "who", header: "Who", accessor: (e) => e.who, format: (_v, e) => `${e.who} (${e.via === "bearer" ? "CLI token" : "explorer"})`, width: 180 },
	{ id: "via", header: "Via", type: "enum", accessor: (e) => (e.via === "bearer" ? "CLI token" : "explorer"), defaultHidden: true },
	{ id: "action", header: "Action", type: "enum", accessor: (e) => e.action, defaultHidden: true },
	{ id: "what", header: "What", accessor: auditWhat, width: 260 },
];

/** One setting: its name, env variable and source; the control, help and state under it. */
function SettingField({
	setting,
	draft,
	onReset,
	onUndo,
	disabled,
	problem,
	children,
	note,
	typed = false,
}: {
	setting: RuntimeSetting;
	draft: Draft;
	onReset(): void;
	onUndo(): void;
	disabled: boolean;
	problem?: string | undefined;
	children: ReactNode;
	note?: ReactNode;
	typed?: boolean;
}) {
	const p = useTheme();
	const pending = Object.hasOwn(draft, setting.key);
	const resetting = pending && draft[setting.key] === null;
	const bounds = setting.kind === "number" ? `${fmtInt(setting.min ?? 0)} to ${fmtInt(setting.max ?? 0)} ${setting.unit ?? ""}${setting.zero ? `; 0 = ${setting.zero}` : ""}`.trim() : null;
	return (
		<Card style={{ gap: 6 }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
				<Txt style={{ fontWeight: "600" }}>{setting.label}</Txt>
				<SourceBadge source={setting.source} />
				{pending || typed ? <Badge label="Unsaved" tone="warning" /> : null}
			</View>
			<Txt variant="mono" style={{ fontSize: 10 }} color={p.mutedForeground}>
				{setting.env}
			</Txt>
			{children}
			<Txt variant="small">
				{setting.help}
				{bounds ? ` (${bounds})` : ""}
			</Txt>
			{note}
			{problem ? (
				<Txt variant="small" color={p.destructive}>
					Must be {problem}.
				</Txt>
			) : null}
			{resetting ? <Txt variant="small">Goes back to the environment's value when you save.</Txt> : null}
			<View style={{ flexDirection: "row", gap: 6 }}>
				{pending ? <Button title="Undo" small variant="ghost" icon="arrow-undo-outline" onPress={onUndo} disabled={disabled} /> : null}
				{setting.source === "dashboard" && !resetting ? <Button title="Reset to env" small variant="ghost" icon="refresh-outline" onPress={onReset} disabled={disabled} /> : null}
			</View>
		</Card>
	);
}

export function SettingsForm({ backendId, data }: { backendId: string; data: SettingsView }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const [draft, setDraft] = useState<Draft>({});
	const [secret, setSecret] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const disabled = !data.enabled;
	const { changes, problems } = buildChanges(data.settings, draft, secret);
	const dirty = Object.keys(changes).length > 0 || Object.keys(problems).length > 0;
	const set = (key: string, value: unknown) => {
		setNotice(null);
		setDraft((d) => ({ ...d, [key]: value }));
	};
	const undo = (key: string) =>
		setDraft((d) => {
			const next = { ...d };
			delete next[key];
			return next;
		});
	const save = useMutation({
		mutationFn: (body: Record<string, unknown>) => api!.saveSettings(body),
		onSuccess: (view) => {
			client.setQueryData(["tt", backendId, ...SETTINGS_KEY], view);
			setDraft({});
			setSecret("");
			const n = view.changed?.length ?? 0;
			setNotice(`${n ? `Saved ${plural(n, "setting")}; in effect now.` : "Nothing changed."}${view.sessionsEnded ? ` ${plural(view.sessionsEnded, "browser session")} made with the admin token signed out.` : ""}`);
			// Notification kinds, drop rules and alert rules are read elsewhere too.
			void client.invalidateQueries({ queryKey: ["tt", backendId, "notify"] });
			void client.invalidateQueries({ queryKey: ["tt", backendId, "drop-rules"] });
			void client.invalidateQueries({ queryKey: ["tt", backendId, "alert-rules"] });
		},
	});
	const test = useMutation({ mutationFn: () => api!.testAlert(), onSettled: () => void client.invalidateQueries({ queryKey: ["tt", backendId, ...SETTINGS_KEY] }) });
	const dashboardKeys = data.settings.filter((s) => s.source === "dashboard").map((s) => s.key);
	const resetAll = () => {
		setNotice(null);
		setSecret("");
		setDraft(Object.fromEntries(dashboardKeys.map((k) => [k, null])));
	};
	const webhook = data.settings.find((s): s is SecretSetting => s.kind === "secret");
	const webhookPending = Boolean(secret.trim()) || (webhook ? Object.hasOwn(draft, webhook.key) : false);
	const doSave = async () => {
		const resets = Object.values(changes).filter((v) => v === null).length;
		const n = Object.keys(changes).length;
		if (!(await confirm("Save these settings?", `${plural(n, "setting")} change${n === 1 ? "s" : ""} at once on the backend${resets ? `, ${resets} back to the environment's value` : ""}.`, "Save", false))) return;
		save.mutate(changes);
	};

	function control(setting: RuntimeSetting): ReactNode {
		if (setting.kind === "secret") {
			const pending = Object.hasOwn(draft, setting.key) ? draft[setting.key] : undefined;
			return (
				<View style={{ gap: 6 }}>
					<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
						<Badge label={setting.set ? "Set" : "Not set"} tone={setting.set ? "good" : "muted"} />
						{pending === "" ? <Txt variant="small">Cleared when you save: no alerts go out.</Txt> : null}
						{pending === null ? <Txt variant="small">{setting.fallbackSet ? "The environment's webhook again when you save." : "None when you save (the environment has none)."}</Txt> : null}
					</View>
					<Field
						value={secret}
						secureTextEntry
						editable={!disabled}
						placeholder={setting.set ? "Paste a new URL to replace it" : "https://discord.com/api/webhooks/..."}
						onChangeText={(v) => {
							setNotice(null);
							setSecret(v);
							if (v) undo(setting.key);
						}}
					/>
					{setting.set && pending !== "" ? (
						<Button
							title="Clear"
							small
							style={{ alignSelf: "flex-start" }}
							disabled={disabled}
							onPress={() => {
								setSecret("");
								set(setting.key, "");
							}}
						/>
					) : null}
				</View>
			);
		}
		const shown = Object.hasOwn(draft, setting.key) ? (draft[setting.key] === null ? setting.fallback : draft[setting.key]) : setting.value;
		switch (setting.kind) {
			case "alertRules":
				return setting.rules ? <BackendAlertRules backendId={backendId} meta={setting.rules} value={shown as AlertRulesDraft} disabled={disabled} onChange={(v) => set(setting.key, v)} /> : null;
			case "number":
				return <Field value={String(shown ?? "")} keyboardType="number-pad" editable={!disabled} onChangeText={(t) => set(setting.key, t)} style={problems[setting.key] ? { borderColor: p.destructive } : undefined} />;
			case "ips":
			case "users":
			case "names": {
				const text = Array.isArray(shown) ? (shown as (string | number)[]).join("\n") : String(shown ?? "");
				return (
					<Field
						value={text}
						multiline
						numberOfLines={3}
						editable={!disabled}
						placeholder={setting.kind === "users" ? "One Roblox UserId per line (empty: no viewers)" : setting.kind === "names" ? "One event name per line" : "Empty: any address"}
						onChangeText={(t) => set(setting.key, t)}
						style={{ fontFamily: "monospace", fontSize: 12, minHeight: 72, textAlignVertical: "top" }}
					/>
				);
			}
			case "choice":
				return <ChoiceChips options={(setting.options ?? []).map((o) => ({ value: o, label: o }))} value={[String(shown)]} disabled={disabled} onChange={(v) => set(setting.key, v)} />;
			case "levels": {
				const order = setting.options ?? [];
				const current = (shown as string[]) ?? [];
				return (
					<ChoiceChips
						options={order.map((o) => ({ value: o, label: o }))}
						value={current}
						disabled={disabled}
						onChange={(v) => {
							const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
							if (next.length) set(setting.key, order.filter((o) => next.includes(o)));
						}}
					/>
				);
			}
			case "dropRules": {
				const rules = Array.isArray(shown) ? (shown as { on: boolean }[]) : [];
				return (
					<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
						<Txt variant="small">{rules.length ? `${rules.filter((r) => r.on).length} on, ${rules.length} in all` : "None"}</Txt>
						<Button title="Edit on the Errors screen" small variant="ghost" onPress={() => router.push(`/tt/${backendId}/errors?drop=1`)} />
					</View>
				);
			}
			case "kindSwitches": {
				const off = Object.entries((shown ?? {}) as Record<string, boolean>)
					.filter(([, v]) => v === false)
					.map(([k]) => k);
				return (
					<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
						<Txt variant="small">{off.length ? `Off: ${off.join(", ")}` : "All kinds on"}</Txt>
						<Button title="Per kind on Notifications" small variant="ghost" onPress={() => router.push(`/tt/${backendId}/notifications?tab=kinds`)} />
					</View>
				);
			}
			case "switch": {
				const offBlocked = setting.key === "tokenLogin" && setting.value === true && !(data.robloxSignIn && data.you.roblox);
				return <OnOff on={shown === true} disabled={disabled} offDisabled={offBlocked} onChange={(on) => set(setting.key, on)} />;
			}
		}
		return null;
	}

	function noteFor(setting: RuntimeSetting): ReactNode {
		if (setting.kind === "number" && setting.unit === "bytes") {
			const shown = Object.hasOwn(draft, setting.key) ? (draft[setting.key] === null ? setting.fallback : draft[setting.key]) : setting.value;
			const hint = bytesHint(String(shown ?? ""));
			return hint ? <Txt variant="small">{hint}</Txt> : null;
		}
		if (setting.key === "adminAllowIps")
			return (
				<Txt variant="small">
					Your address as the backend sees it: <Txt variant="mono">{data.you.ip || "unknown"}</Txt>. A list without it is refused.
				</Txt>
			);
		if (setting.key === "tokenLogin" && setting.kind === "switch" && setting.value === true && !(data.robloxSignIn && data.you.roblox))
			return <Txt variant="small">{data.robloxSignIn ? "To turn it off, sign in with Roblox first." : "Turning it off needs Sign in with Roblox on this backend."}</Txt>;
		if (setting.kind === "secret" && setting.set)
			return (
				<View style={{ gap: 4 }}>
					<Button title="Send test alert" small icon="send-outline" loading={test.isPending} disabled={test.isPending || webhookPending} onPress={() => test.mutate()} style={{ alignSelf: "flex-start" }} />
					{webhookPending ? <Txt variant="small">Save first: the test uses the saved webhook.</Txt> : null}
					{test.isSuccess ? <Txt variant="small">Test alert sent{test.data.status ? ` (HTTP ${test.data.status})` : ""}.</Txt> : null}
					{test.error ? (
						<Txt variant="small" color={p.destructive}>
							{test.error instanceof ApiError && test.error.status === 429 ? "Too many test alerts: wait a minute." : test.error.message}
						</Txt>
					) : null}
				</View>
			);
		return null;
	}

	return (
		<View style={{ gap: space.md }}>
			<Txt variant="small">Changes apply at once, no redeploy. A value saved here wins over the environment.</Txt>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				<Button title={save.isPending ? "Saving" : "Save"} small variant="primary" icon="save-outline" disabled={disabled || !dirty || Object.keys(problems).length > 0 || save.isPending} onPress={() => void doSave()} />
				{dirty ? (
					<Button
						title="Discard"
						small
						variant="ghost"
						onPress={() => {
							setDraft({});
							setSecret("");
						}}
					/>
				) : null}
				{dashboardKeys.length ? <Button title="Reset all to env" small icon="refresh-outline" disabled={disabled} onPress={resetAll} /> : null}
			</View>
			{disabled ? <Callout tone="muted" title="Read only">TYPETORCH_RUNTIME_SETTINGS=off on this backend: the environment's values apply and nothing here can be changed.</Callout> : null}
			{save.error ? <Callout tone="critical" title="Not saved">{save.error.message}</Callout> : null}
			{notice ? <Txt variant="small">{notice}</Txt> : null}
			{Object.keys(problems).length ? (
				<Txt variant="small" color={p.destructive}>
					{plural(Object.keys(problems).length, "setting")} can't be saved yet (see below).
				</Txt>
			) : null}
			{GROUPS.map((group) => {
				const items = data.settings.filter((s) => s.group === group.id);
				if (!items.length) return null;
				return (
					<Section key={group.id} title={group.title}>
						<Txt variant="small">{group.description}</Txt>
						{items.map((setting) => (
							<SettingField
								key={setting.key}
								setting={setting}
								draft={draft}
								disabled={disabled}
								problem={problems[setting.key]}
								onReset={() => set(setting.key, null)}
								onUndo={() => undo(setting.key)}
								note={noteFor(setting)}
								typed={setting.kind === "secret" && Boolean(secret.trim())}
							>
								{control(setting)}
							</SettingField>
						))}
					</Section>
				);
			})}
			{dirty ? (
				<Button title={save.isPending ? "Saving" : "Save"} variant="primary" icon="save-outline" disabled={disabled || Object.keys(problems).length > 0 || save.isPending} onPress={() => void doSave()} />
			) : null}
		</View>
	);
}

export function SettingsAudit({ entries, envOnly }: { entries: SettingsAuditEntry[]; envOnly: string[] }) {
	return (
		<>
			<Txt variant="small">Environment only (change these on Coolify and redeploy): {envOnly.join(", ")}.</Txt>
			<Section title="Recent changes">
				<Txt variant="small">Who changed which settings, and test alerts. Values are never recorded.</Txt>
				<DataTable
					id="settings-audit"
					label="Settings changes"
					columns={AUDIT_COLUMNS}
					data={entries}
					defaultSort={[{ id: "at", desc: true }]}
					empty={<Txt variant="muted">No changes yet. Each save and test alert is listed here (who and which settings, never the values).</Txt>}
				/>
			</Section>
		</>
	);
}
