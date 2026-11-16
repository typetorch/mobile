/**
 * The Errors screen's drop rules (web components/ErrorDropRules.tsx; backend src/errors/drop-rules.ts, runtime setting
 * `errorDropRules`): filter expressions whose matching error logs are dropped when they arrive, never stored. The list
 * shows each rule's drops since the server started (GET /v1/errors/drop-rules, every 30 s); the editor previews, as you
 * type, which stored error kinds a rule would have caught (POST /v1/errors/drop-rules/preview). Saving goes through
 * PATCH /v1/admin/settings (owners; a delete asks first); the read-only role sees the list only.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { DropPreview, ErrorDropRule, ErrorDropRules as RulesView } from "@/api/tt/types";
import { Badge, Button, Card, confirm, ErrorState, Field, Skeleton, Txt } from "@/components/ui";
import { fmtAgo, fmtInt, plural } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme } from "@/theme";

import { useTTQuery } from "./hooks";
import { Sheet } from "./sheet";

export const DROP_RULES_KEY = ["drop-rules"] as const;

/** `message = "<the template>"`, quotes and backslashes escaped: a rule for exactly this error. */
export function exactRuleFor(template: string): string {
	return `message = "${template.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function newRuleId(existing: { id: string }[]): string {
	for (let n = existing.length + 1; ; n++) {
		const id = `r${n}`;
		if (!existing.some((r) => r.id === id)) return id;
	}
}

export const DROP_EXAMPLES = [
	'message contains "Failed to load mesh"',
	'(message contains "asset" or message contains "mesh") and realm = "client"',
	"any matches /Content failed to load|HTTP 4\\d\\d/i",
	'message startswith "Infinite yield possible" and not branch = "dev"',
];

/** The active rules' count for the Errors screen's button. */
export function useDropRules(backendId: string) {
	return useTTQuery(backendId, DROP_RULES_KEY, (api, s) => api.errorDropRules(s), { refetchInterval: 30_000 });
}

function Syntax() {
	const [open, setOpen] = useState(false);
	return (
		<View style={{ gap: 4 }}>
			<Button title={open ? "Hide how to write one" : "How to write one"} small variant="ghost" onPress={() => setOpen((o) => !o)} style={{ alignSelf: "flex-start" }} />
			{open ? (
				<View style={{ gap: 4 }}>
					<Txt variant="small">`field op value`, joined with and / or (and first), not, and parentheses. Text ignores case.</Txt>
					<Txt variant="small">Fields: message (names and ids already replaced), stack, any (message or stack), realm (server / client), branch, build, fp.</Txt>
					<Txt variant="small">Operators: contains, startswith, endswith, is / =, != with "text"; matches with /regex/ or /regex/i.</Txt>
					{DROP_EXAMPLES.map((e) => (
						<Txt key={e} variant="mono" selectable style={{ fontSize: 11 }}>
							{e}
						</Txt>
					))}
				</View>
			) : null}
		</View>
	);
}

/** The preview of an expression against what is stored, a moment after the typing stops. */
function Preview({ backendId, expr }: { backendId: string; expr: string }) {
	const p = useTheme();
	const [settled, setSettled] = useState(expr);
	useEffect(() => {
		const t = setTimeout(() => setSettled(expr), 350);
		return () => clearTimeout(t);
	}, [expr]);
	const q = useTTQuery(backendId, ["errors", "drop-preview", settled], (api, s) => api.previewDropRule(settled, s), { enabled: settled.trim() !== "", staleTime: 30_000, retry: false });
	if (!settled.trim()) return null;
	if (q.error) return <ErrorState error={q.error} title="Couldn't preview" />;
	if (!q.data) return <Txt variant="small">Checking...</Txt>;
	const d: DropPreview = q.data;
	if (!d.ok)
		return (
			<Txt variant="small" color={p.critical}>
				{d.error}
			</Txt>
		);
	return (
		<View style={{ gap: 4 }}>
			<Txt variant="small" color={d.matchedKinds ? p.foreground : p.mutedForeground}>
				Would drop {plural(d.matchedKinds, "kind")} of the {fmtInt(d.kinds)} stored: {plural(d.matchedOccurrences, "error")} of {fmtInt(d.allOccurrences)} in the last {d.days} days.
			</Txt>
			{d.matches.length ? (
				<Card style={{ gap: 4, padding: 8 }}>
					{d.matches.slice(0, 50).map((m) => (
						<View key={m.fp} style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
							<Txt variant="mono" numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
								{m.template}
							</Txt>
							<Txt variant="small">
								{fmtInt(m.occurrences)} · {m.realm}
							</Txt>
						</View>
					))}
				</Card>
			) : null}
		</View>
	);
}

/** The rules and the editor. `draft` prefills a new rule (from an error's "Drop errors like this"). */
export function ErrorDropRules({ backendId, canEdit, draft }: { backendId: string; canEdit: boolean; draft?: string | undefined }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const q = useDropRules(backendId);
	const [expr, setExpr] = useState(draft ?? "");
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	useEffect(() => {
		if (draft !== undefined) setExpr(draft);
	}, [draft]);
	const save = async (rules: ErrorDropRule[]) => {
		setSaving(true);
		setProblem(null);
		try {
			await api!.saveSettings({ errorDropRules: rules });
			await client.invalidateQueries({ queryKey: ["tt", backendId, ...DROP_RULES_KEY] });
			void client.invalidateQueries({ queryKey: ["tt", backendId, "admin-settings"] });
			return true;
		} catch (error) {
			setProblem((error as Error).message);
			return false;
		} finally {
			setSaving(false);
		}
	};
	if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton height={100} />;
	const view: RulesView = q.data;
	const rules = view.rules.map(({ error: _error, ...r }) => r);
	const add = async () => {
		if (await save([...rules, { id: newRuleId(rules), expr: expr.trim(), ...(note.trim() ? { note: note.trim() } : {}), on: true }])) {
			setExpr("");
			setNote("");
		}
	};
	return (
		<View style={{ gap: space.md }}>
			<Txt variant="small">Error logs a rule matches are dropped when they arrive and never stored (asset and mesh load failures, other noise). Saving a rule doesn't delete what is already stored; it stops new ones.</Txt>
			{canEdit ? (
				<Card style={{ gap: space.sm }}>
					<Txt style={{ fontWeight: "600" }}>New rule</Txt>
					<Field value={expr} onChangeText={setExpr} multiline placeholder={DROP_EXAMPLES[0]} style={{ fontFamily: "monospace", fontSize: 12, minHeight: 56, textAlignVertical: "top" }} />
					<Field value={note} onChangeText={setNote} maxLength={120} placeholder="Note (optional): why it is dropped" />
					<Preview backendId={backendId} expr={expr} />
					<Button title="Add rule" small variant="primary" disabled={saving || !expr.trim()} loading={saving} onPress={() => void add()} style={{ alignSelf: "flex-start" }} />
					{problem ? (
						<Txt variant="small" color={p.critical}>
							{problem}
						</Txt>
					) : null}
					<Syntax />
				</Card>
			) : null}
			{rules.length === 0 ? (
				<Txt variant="muted">No drop rules: every error log is stored.</Txt>
			) : (
				view.rules.map((r) => {
					const count = view.counts[r.id];
					return (
						<Card key={r.id} style={{ gap: 6, opacity: r.on ? 1 : 0.6 }}>
							<View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
								<Txt variant="mono" selectable style={{ flex: 1, fontSize: 12 }}>
									{r.expr}
								</Txt>
								<Badge label={r.on ? "on" : "off"} tone={r.on ? "brand" : "muted"} />
							</View>
							{r.note ? <Txt variant="small">{r.note}</Txt> : null}
							{r.error ? (
								<Txt variant="small" color={p.critical}>
									Not applied: {r.error}
								</Txt>
							) : null}
							<Txt variant="small">
								{count ? `Dropped ${plural(count.items, "report")} (${plural(count.occurrences, "error")}), last ${fmtAgo(count.lastAt ?? undefined)}` : "Nothing dropped"} since the server started {fmtAgo(view.since)}.
							</Txt>
							{canEdit ? (
								<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
									<Button title={r.on ? "Turn off" : "Turn on"} small disabled={saving} onPress={() => void save(rules.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))} />
									<Button title="Edit copy" small disabled={saving} onPress={() => setExpr(r.expr)} />
									<Button
										title="Delete"
										small
										variant="destructive"
										disabled={saving}
										onPress={async () => {
											if (await confirm("Delete this rule?", `${r.expr}\n\nMatching error logs are stored again from now on.`, "Delete")) void save(rules.filter((x) => x.id !== r.id));
										}}
									/>
								</View>
							) : null}
						</Card>
					);
				})
			)}
			{view.source === "env" ? <Txt variant="small">These come from TYPETORCH_ERROR_DROP_RULES; saving here overrides it.</Txt> : null}
		</View>
	);
}

/** The drop rules in a sheet (the web's side sheet on the Errors page). */
export function DropRulesSheet({ backendId, open, onClose, canEdit, draft }: { backendId: string; open: boolean; onClose(): void; canEdit: boolean; draft?: string | undefined }) {
	return (
		<Sheet open={open} onClose={onClose} title="Drop rules" subtitle="Filter expressions for error logs that shouldn't be stored.">
			<ErrorDropRules backendId={backendId} canEdit={canEdit} draft={draft} />
		</Sheet>
	);
}
