/**
 * The alert editor (create and edit): metric, condition, interval, consecutive periods, severity, the filter list, the
 * breakdown list and webhook receivers, checked against the API's rules (name 1-128 characters, consecutive
 * occurrences at least 1, a finite threshold, a period offset only for PeriodOverPeriod, receivers as unique UUIDs).
 *
 * Editing keeps every filter and breakdown entry the alert already has (Creator Hub can make several), and an alert
 * on a metric this app doesn't list keeps that metric and its dimensions as they are. The caller PATCHes only what
 * changed (see alertPatch), because the API replaces the filter and breakdown lists entirely when they are sent.
 */
import { useMemo, useState } from "react";
import { View } from "react-native";

import { Button, Card, Chips, Field, Segmented, Txt } from "@/components/ui";
import { useTheme } from "@/theme";

import type { AlertDetail, AlertEvaluationMode, AlertInput, AlertInterval, AlertOperator, AlertSeverity } from "../api/analytics-tools";
import { ALERT_METRIC_GROUPS, alertGroupOf, INTERVALS, OPERATORS, SEVERITIES, UUID, type AlertMetricGroup } from "./alerts-model";
import { splitList } from "./dashboard-model";

const CURRENT = "Current metric";

export function AlertForm({ initial, busy, submitTitle, onSubmit }: { initial?: AlertDetail | null; busy: boolean; submitTitle: string; onSubmit: (input: AlertInput) => void }) {
	const p = useTheme();
	// The alert's own dimensions are always allowed for its own metric, even when the guide list doesn't name them.
	const initialDims = useMemo(
		() => [...(initial?.breakdown ?? []).flatMap((b) => b.dimensions), ...(initial?.filter ?? []).map((f) => f.dimension)],
		[initial],
	);
	// A metric the app doesn't list gets its own group, with no dimension whitelist.
	const groups: (AlertMetricGroup & { free?: boolean })[] = useMemo(
		() => (initial && !alertGroupOf(initial.metric) ? [{ title: CURRENT, metrics: [initial.metric], dimensions: [], filterOnly: [], free: true }, ...ALERT_METRIC_GROUPS] : ALERT_METRIC_GROUPS),
		[initial],
	);
	const [name, setName] = useState(initial?.name ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [group, setGroup] = useState(initial ? (alertGroupOf(initial.metric)?.title ?? CURRENT) : ALERT_METRIC_GROUPS[0]!.title);
	const [metric, setMetric] = useState(initial?.metric ?? ALERT_METRIC_GROUPS[0]!.metrics[0]!);
	const [operator, setOperator] = useState<AlertOperator>(initial?.condition.operator ?? "Gt");
	const [threshold, setThreshold] = useState(initial ? String(initial.condition.threshold) : "");
	const [mode, setMode] = useState<AlertEvaluationMode>(initial?.condition.evaluationMode ?? "Absolute");
	const [offset, setOffset] = useState(String(initial?.condition.periodOffsetMultiplier ?? 1));
	const [interval, setInterval_] = useState<AlertInterval>(initial?.interval ?? "OneHour");
	const [occurrences, setOccurrences] = useState(String(initial?.consecutiveOccurrences ?? 1));
	const [severity, setSeverity] = useState<AlertSeverity>(initial?.severity ?? "SEV_1");
	const [filters, setFilters] = useState<{ dimension: string; values: string }[]>(() => (initial?.filter ?? []).map((f) => ({ dimension: f.dimension, values: f.values.join(", ") })));
	const [breakdowns, setBreakdowns] = useState<string[]>(() => (initial?.breakdown ?? []).map((b) => b.dimensions.join(", ")));
	const [receivers, setReceivers] = useState((initial?.webhookReceiverConfig?.receivers ?? []).map((r) => r.webhookConfigurationId).join(", "));
	const [error, setError] = useState<string | null>(null);

	const g = groups.find((x) => x.title === group) ?? groups[0]!;
	const metricInGroup = g.metrics.includes(metric);
	const free = !!g.free;
	const sameMetric = !!initial && metric === initial.metric;
	const breakdownDims = free ? [] : [...new Set([...g.dimensions, ...(sameMetric ? initialDims : [])])];
	const filterDims = free ? [] : [...new Set([...g.dimensions, ...g.filterOnly, ...(sameMetric ? initialDims : [])])];
	const canBreakDown = free || breakdownDims.length > 0;
	const canFilter = free || filterDims.length > 0;

	function submit() {
		const n = name.trim();
		if (!n) return setError("Give the alert a name.");
		if (n.length > 128) return setError("The name is at most 128 characters.");
		if (!metricInGroup) return setError("Pick a metric.");
		const t = Number(threshold.trim());
		if (!threshold.trim() || !Number.isFinite(t)) return setError("The threshold is a number.");
		const occ = Number(occurrences.trim());
		if (!Number.isInteger(occ) || occ < 1 || occ > 1000) return setError("Consecutive periods is a whole number from 1.");
		let periodOffset: number | null = null;
		if (mode === "PeriodOverPeriod") {
			periodOffset = Number(offset.trim());
			if (!Number.isInteger(periodOffset) || periodOffset < 1 || periodOffset > 1000) return setError("The comparison offset is a whole number of intervals from 1.");
		}
		const breakdown: { dimensions: string[] }[] = [];
		for (const entry of breakdowns) {
			const dims = splitList(entry);
			if (!dims.length) continue;
			const bad = free ? undefined : dims.find((d) => !breakdownDims.includes(d));
			if (bad) return setError(`“${bad}” can't break down ${metric}${breakdownDims.length ? ` (use ${breakdownDims.join(", ")})` : ""}.`);
			breakdown.push({ dimensions: dims });
		}
		const filter: { dimension: string; values: string[] }[] = [];
		for (const f of filters) {
			const fd = f.dimension.trim();
			const values = splitList(f.values);
			if (!fd && !values.length) continue;
			if (!fd) return setError("A filter needs a dimension.");
			if (!free && !filterDims.includes(fd)) return setError(`“${fd}” can't filter ${metric}${filterDims.length ? ` (use ${filterDims.join(", ")})` : ""}.`);
			if (!values.length) return setError(`Give at least one value for the ${fd} filter.`);
			filter.push({ dimension: fd, values });
		}
		const ids = splitList(receivers);
		const notUuid = ids.find((id) => !UUID.test(id));
		if (notUuid) return setError(`“${notUuid}” is not a webhook configuration ID (a UUID).`);
		if (new Set(ids.map((i) => i.toLowerCase())).size !== ids.length) return setError("A webhook is listed twice.");
		setError(null);
		onSubmit({
			name: n,
			metric,
			description: description.trim() || null,
			severity,
			interval,
			consecutiveOccurrences: occ,
			breakdown,
			filter,
			condition: { operator, threshold: t, evaluationMode: mode, periodOffsetMultiplier: mode === "PeriodOverPeriod" ? periodOffset : null },
			webhookReceiverConfig: ids.length ? { receivers: ids.map((webhookConfigurationId) => ({ webhookConfigurationId })) } : null,
		});
	}

	return (
		<Card style={{ gap: 8 }}>
			<Field label="Name" value={name} onChangeText={setName} maxLength={128} placeholder="Server FPS dropped" autoCapitalize="sentences" />
			<Field label="Description (optional)" value={description} onChangeText={setDescription} autoCapitalize="sentences" />
			<Txt variant="label">Metric</Txt>
			<Chips
				options={groups.map((x) => ({ value: x.title, label: x.title }))}
				value={group}
				onChange={(v) => {
					setGroup(v);
					const next = groups.find((x) => x.title === v);
					if (next && !next.metrics.includes(metric)) setMetric(next.metrics[0]!);
				}}
			/>
			{g.metrics.length > 1 ? <Chips options={g.metrics.map((m) => ({ value: m, label: m }))} value={metric} onChange={setMetric} /> : <Txt variant="mono">{metric}</Txt>}
			{free ? <Txt variant="small">This metric isn't in the app's list, so its dimensions aren't checked here; Roblox checks them on save.</Txt> : null}
			<Txt variant="label">Fires when</Txt>
			<Segmented options={[{ value: "Absolute", label: "Value" }, { value: "PeriodOverPeriod", label: "Change vs before" }]} value={mode} onChange={setMode} />
			<View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
				<Segmented options={OPERATORS} value={operator} onChange={setOperator} style={{ flex: 1 }} />
				<View style={{ flex: 1 }}>
					<Field value={threshold} onChangeText={setThreshold} keyboardType="numbers-and-punctuation" placeholder={mode === "Absolute" ? "Threshold" : "Change (e.g. 0.2)"} />
				</View>
			</View>
			{mode === "PeriodOverPeriod" ? <Field label="Compare with how many intervals back" value={offset} onChangeText={setOffset} keyboardType="number-pad" hint="1 = the interval before; 7 with a 1-day interval = the same day last week." /> : null}
			<Txt variant="label">Checked every</Txt>
			<Segmented options={INTERVALS} value={interval} onChange={setInterval_} />
			<Field label="For this many periods in a row" value={occurrences} onChangeText={setOccurrences} keyboardType="number-pad" />
			<Txt variant="label">Severity</Txt>
			<Segmented options={SEVERITIES} value={severity} onChange={setSeverity} />

			<Txt variant="label">Breakdowns (optional)</Txt>
			<Txt variant="small">Each combination of values is checked on its own; the alert fires if any breaches. {canBreakDown ? "" : "This metric has no breakdowns."}</Txt>
			{breakdowns.map((b, i) => (
				<View key={`b${i}`} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<View style={{ flex: 1 }}>
						<Field value={b} onChangeText={(v) => setBreakdowns(breakdowns.map((x, j) => (j === i ? v : x)))} placeholder={free ? "Dimensions, comma separated" : breakdownDims.join(", ")} />
					</View>
					<Button title="Remove" icon="close" small onPress={() => setBreakdowns(breakdowns.filter((_, j) => j !== i))} />
				</View>
			))}
			{canBreakDown ? <Button title="Add breakdown" icon="add" small onPress={() => setBreakdowns([...breakdowns, ""])} style={{ alignSelf: "flex-start" }} /> : null}

			<Txt variant="label">Filters (optional)</Txt>
			{filters.map((f, i) => (
				<View key={`f${i}`} style={{ gap: 6, borderLeftWidth: 2, borderLeftColor: p.border, paddingLeft: 8 }}>
					<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<View style={{ flex: 1 }}>
							<Field
								value={f.dimension}
								onChangeText={(v) => setFilters(filters.map((x, j) => (j === i ? { ...x, dimension: v } : x)))}
								placeholder={free ? "Dimension" : filterDims.join(", ")}
							/>
						</View>
						<Button title="Remove" icon="close" small onPress={() => setFilters(filters.filter((_, j) => j !== i))} />
					</View>
					<Field value={f.values} onChangeText={(v) => setFilters(filters.map((x, j) => (j === i ? { ...x, values: v } : x)))} placeholder="Values, comma separated, e.g. Mobile, Desktop" />
				</View>
			))}
			{canFilter ? (
				<Button title="Add filter" icon="add" small onPress={() => setFilters([...filters, { dimension: "", values: "" }])} style={{ alignSelf: "flex-start" }} />
			) : (
				<Txt variant="small">This metric has no filters.</Txt>
			)}

			<Field label="Webhook configuration IDs (optional)" value={receivers} onChangeText={setReceivers} placeholder="UUIDs, comma separated" hint="Webhooks are set up on Creator Hub (there is no API to create them)." />
			<Button title={submitTitle} variant="primary" icon="checkmark" small loading={busy} onPress={submit} style={{ alignSelf: "flex-start" }} />
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : null}
		</Card>
	);
}
