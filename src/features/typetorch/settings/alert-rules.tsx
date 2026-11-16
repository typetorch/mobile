/**
 * The backend alert rules on the Settings screen (web components/BackendAlertRules.tsx, the backendAlerts runtime
 * setting): a master switch, the repeat window and the hourly cap, then each rule with its on / off, level and
 * thresholds, and what it saw on the backend's last run (GET /v1/admin/alert-rules, every 60 s). The draft keeps typed
 * numbers as text; `alertRulesChange` turns it into the value to save, or says what blocks it.
 */
import { View } from "react-native";

import type { AlertLevelName, AlertParamDef, AlertRuleDef, AlertRulesMeta, AlertRulesStatus, BackendAlertSettings } from "@/api/tt/types";
import { Badge, Card, Field, Txt } from "@/components/ui";
import { useTTQuery } from "@/features/typetorch/hooks";
import { fmtAgo, fmtInt, plural } from "@/lib/format";
import { space, useTheme, type Tone } from "@/theme";

import { ChoiceChips, OnOff } from "./controls";

export interface AlertRulesDraft {
	on: boolean;
	repeatMinutes: number | string;
	perHour: number | string;
	rules: Record<string, { on: boolean; level: AlertLevelName; params: Record<string, number | string> }>;
}

const LEVELS: AlertLevelName[] = ["critical", "warning", "info"];
const GROUP_TITLES: Record<AlertRuleDef["group"], string> = { errors: "Errors", players: "Players online", ingest: "Analytics ingest", backend: "Backend health", disk: "Disk" };

export function paramProblem(param: AlertParamDef, text: number | string): string | null {
	const t = String(text).trim();
	const range = `${fmtInt(param.min)} to ${fmtInt(param.max)}${param.zero ? ` (or 0 = ${param.zero})` : ""}`;
	if (!/^-?\d+$/.test(t)) return `a whole number from ${range}`;
	const n = Number(t);
	if (param.zero && n === 0) return null;
	return n < param.min || n > param.max ? `from ${range}` : null;
}

export function alertRulesChange(meta: AlertRulesMeta, draft: AlertRulesDraft): { value: BackendAlertSettings } | { problem: string } {
	const value: BackendAlertSettings = { on: draft.on, repeatMinutes: 0, perHour: 0, rules: {} };
	for (const g of meta.general) {
		const raw = (draft as unknown as Record<string, number | string>)[g.key] ?? "";
		const problem = paramProblem(g, raw);
		if (problem) return { problem: `${g.label}: ${problem}` };
		(value as unknown as Record<string, number>)[g.key] = Number(String(raw).trim());
	}
	for (const rule of meta.rules) {
		const d = draft.rules[rule.id];
		if (!d) continue;
		const params: Record<string, number> = {};
		for (const x of rule.params) {
			const raw = d.params[x.key] ?? "";
			const problem = paramProblem(x, raw);
			if (problem) return { problem: `${rule.label}, ${x.label}: ${problem}` };
			params[x.key] = Number(String(raw).trim());
		}
		value.rules[rule.id] = { on: d.on, level: d.level, params };
	}
	return { value };
}

const STATE_BADGE: Record<AlertRulesStatus["rules"][number]["state"], { text: string; tone: Tone }> = {
	firing: { text: "Firing", tone: "critical" },
	ok: { text: "OK", tone: "good" },
	waiting: { text: "Waiting", tone: "muted" },
	off: { text: "Off", tone: "muted" },
	unavailable: { text: "Unavailable", tone: "muted" },
};

function NumberField({ param, value, disabled, onChange }: { param: AlertParamDef; value: number | string; disabled: boolean; onChange(text: string): void }) {
	const p = useTheme();
	const problem = paramProblem(param, value);
	return (
		<View style={{ gap: 2, minWidth: 130, flexGrow: 1, flexBasis: "40%" }}>
			<Txt variant="small">
				{param.label}
				{param.unit ? ` (${param.unit})` : ""}
			</Txt>
			<Field value={String(value)} onChangeText={onChange} editable={!disabled} keyboardType="number-pad" style={problem ? { borderColor: p.destructive } : undefined} />
			<Txt variant="small" style={{ fontSize: 10 }}>
				{fmtInt(param.min)} to {fmtInt(param.max)}
				{param.zero ? `, 0 = ${param.zero}` : ""}
			</Txt>
		</View>
	);
}

function RuleBlock({ rule, draft, status, disabled, onChange }: { rule: AlertRuleDef; draft: AlertRulesDraft["rules"][string]; status?: AlertRulesStatus["rules"][number] | undefined; disabled: boolean; onChange(next: AlertRulesDraft["rules"][string]): void }) {
	const badge = status ? STATE_BADGE[status.state] : null;
	return (
		<Card style={{ gap: space.sm }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
				<Txt style={{ fontWeight: "600" }}>{rule.label}</Txt>
				{badge ? <Badge label={badge.text} tone={badge.tone} /> : null}
				{rule.needs.includes("analytics") ? <Badge label="needs analytics" /> : null}
			</View>
			<Txt variant="mono" style={{ fontSize: 10 }}>
				{rule.env}
			</Txt>
			<Txt variant="small">{rule.help}</Txt>
			<OnOff on={draft.on} disabled={disabled} onChange={(on) => onChange({ ...draft, on })} />
			<ChoiceChips options={LEVELS.map((l) => ({ value: l, label: l }))} value={[draft.level]} disabled={disabled} onChange={(level) => onChange({ ...draft, level })} />
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				{rule.params.map((x) => (
					<NumberField key={x.key} param={x} value={draft.params[x.key] ?? ""} disabled={disabled} onChange={(text) => onChange({ ...draft, params: { ...draft.params, [x.key]: text } })} />
				))}
			</View>
			{status && status.state !== "off" ? (
				<Txt variant="small">
					Last run: {status.note}
					{status.lastRaisedAt ? `; last raised ${fmtAgo(status.lastRaisedAt)}` : ""}
				</Txt>
			) : null}
		</Card>
	);
}

export function BackendAlertRules({ backendId, meta, value, disabled, onChange }: { backendId: string; meta: AlertRulesMeta; value: AlertRulesDraft; disabled: boolean; onChange(next: AlertRulesDraft): void }) {
	const status = useTTQuery(backendId, ["alert-rules"], (api, s) => api.alertRules(s), { refetchInterval: 60_000, retry: false });
	const byId = new Map((status.data?.rules ?? []).map((r) => [r.id, r]));
	const groups = [...new Set(meta.rules.map((r) => r.group))];
	return (
		<View style={{ gap: space.sm }}>
			<OnOff on={value.on} disabled={disabled} onChange={(on) => onChange({ ...value, on })} />
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				{meta.general.map((g) => (
					<NumberField key={g.key} param={g} value={(value as unknown as Record<string, number | string>)[g.key] ?? ""} disabled={disabled} onChange={(text) => onChange({ ...value, [g.key]: text })} />
				))}
			</View>
			{status.data ? (
				<Txt variant="small">
					{status.data.lastRunAt ? `Checked ${fmtAgo(status.data.lastRunAt)} (every ${status.data.tickSeconds} s)` : "Not checked yet"}: {plural(status.data.raised, "alert")} raised
					{status.data.throttled ? `, ${fmtInt(status.data.throttled)} over the hourly cap` : ""} since the start.
				</Txt>
			) : status.error ? (
				<Txt variant="small">The rules' state is not available here (backend alerts need the fleet part).</Txt>
			) : null}
			{groups.map((group) => (
				<View key={group} style={{ gap: space.sm }}>
					<Txt variant="label">{GROUP_TITLES[group]}</Txt>
					{meta.rules
						.filter((r) => r.group === group)
						.map((rule) => {
							const draft = value.rules[rule.id];
							if (!draft) return null;
							return <RuleBlock key={rule.id} rule={rule} draft={draft} status={byId.get(rule.id)} disabled={disabled} onChange={(next) => onChange({ ...value, rules: { ...value.rules, [rule.id]: next } })} />;
						})}
				</View>
			))}
		</View>
	);
}
