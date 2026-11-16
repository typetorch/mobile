/**
 * The Analytics tab's query options: the date range (presets or a custom span), the granularity, a card's filters
 * (Roblox's In / NotIn / comparison / Match operations) and the dimension-value lookups that fill them.
 */
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { Badge, Button, Chips, Field, Icon, Segmented, Skeleton, Txt } from "@/components/ui";
import { CloudError } from "@/features/project/CloudError";
import { useTheme } from "@/theme";

import { customRangeError, DAY, dayString, dimLabel, GRANULARITY_CHOICES, RANGES, type GranularityChoice, type RangeDays, type RangeSpec } from "../analytics";
import { FILTER_OPERATIONS, type FilterOperation, type QueryFilter } from "../api/analytics-query";
import { useDimensionValues } from "./shared";

const RANGE_LABEL: Record<RangeDays, string> = { 1: "24 h", 7: "7 d", 28: "28 d", 90: "90 d", 365: "1 y" };

/** Presets plus a custom span of whole UTC days (validated before it is used). */
export function RangeControls({ range, onChange }: { range: RangeSpec; onChange: (r: RangeSpec) => void }) {
	const today = Math.floor(Date.now() / DAY) * DAY;
	const [custom, setCustom] = useState(range.kind === "custom");
	const [start, setStart] = useState(range.kind === "custom" ? range.start : dayString(today - 28 * DAY));
	const [end, setEnd] = useState(range.kind === "custom" ? range.end : dayString(today - DAY));
	const error = customRangeError(start, end);
	const value: RangeDays | "custom" = custom ? "custom" : range.kind === "preset" ? range.days : "custom";
	return (
		<View style={{ gap: 8 }}>
			<Segmented
				options={[...RANGES.map((d) => ({ value: d as RangeDays | "custom", label: RANGE_LABEL[d] })), { value: "custom" as const, label: "Custom" }]}
				value={value}
				onChange={(v) => {
					if (v === "custom") return setCustom(true);
					setCustom(false);
					onChange({ kind: "preset", days: v });
				}}
			/>
			{custom ? (
				<View style={{ gap: 6 }}>
					<View style={{ flexDirection: "row", gap: 8 }}>
						<View style={{ flex: 1 }}>
							<Field label="From (UTC)" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" maxLength={10} />
						</View>
						<View style={{ flex: 1 }}>
							<Field label="To (UTC, inclusive)" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" maxLength={10} />
						</View>
					</View>
					{error ? <Txt variant="small">{error}</Txt> : null}
					<Button
						title={range.kind === "custom" && range.start === start && range.end === end ? "Showing this range" : "Show this range"}
						icon="calendar-outline"
						small
						disabled={!!error || (range.kind === "custom" && range.start === start && range.end === end)}
						onPress={() => onChange({ kind: "custom", start, end })}
						style={{ alignSelf: "flex-start" }}
					/>
				</View>
			) : null}
		</View>
	);
}

export function GranularityControls({ value, onChange }: { value: GranularityChoice; onChange: (g: GranularityChoice) => void }) {
	return <Chips options={GRANULARITY_CHOICES} value={value} onChange={onChange} />;
}

/** Tappable values of a dimension for a metric (the dimension-values API), toggled into a selection. */
export function DimensionValueList({
	universeId,
	metric,
	dimension,
	startTime,
	endTime,
	selected,
	onToggle,
	filter,
}: {
	universeId: number;
	metric: string;
	dimension: string;
	startTime: string;
	endTime: string;
	selected: string[];
	onToggle: (value: string) => void;
	filter?: QueryFilter[];
}) {
	const p = useTheme();
	const q = useDimensionValues(universeId, { metric, dimension, startTime, endTime, filter });
	if (q.isLoading) return <Skeleton height={28} />;
	if (q.error) return <CloudError error={q.error} what="Dimension values" onRetry={() => q.refetch()} />;
	if (!q.data?.length) return <Txt variant="small">No {dimLabel(dimension).toLowerCase()} values in this range.</Txt>;
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
			{q.data.map((v) => {
				const on = selected.includes(v.value);
				return (
					<Pressable
						key={v.value}
						onPress={() => onToggle(v.value)}
						style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1, borderColor: on ? p.brand : p.border, backgroundColor: on ? `${p.brand}33` : p.card }}
					>
						<Txt variant="small" color={on ? p.foreground : undefined} numberOfLines={1}>
							{v.displayValue && v.displayValue !== v.value ? `${v.displayValue} (${v.value})` : v.value}
						</Txt>
					</Pressable>
				);
			})}
		</View>
	);
}

const OP_LABEL: Record<FilterOperation, string> = { In: "is", NotIn: "is not", GreaterThan: ">", GreaterThanOrEqual: "≥", LessThan: "<", LessThanOrEqual: "≤", Match: "matches" };
const MAX_FILTERS = 5;
const MAX_VALUE_LENGTH = 200;

interface DraftFilter {
	dimension: string;
	operation: FilterOperation;
	values: string;
}

function splitValues(text: string): string[] {
	return text
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}

/** Why a filter can't be sent, or null. Values are case-sensitive; comparisons and Match take one value. */
function filterError(f: DraftFilter): string | null {
	const values = splitValues(f.values);
	if (!f.dimension) return "Pick a dimension.";
	if (!values.length) return `Add a ${dimLabel(f.dimension).toLowerCase()} value.`;
	if (values.some((v) => v.length > MAX_VALUE_LENGTH)) return `Values are at most ${MAX_VALUE_LENGTH} characters.`;
	if (f.operation !== "In" && f.operation !== "NotIn" && values.length !== 1) return `"${OP_LABEL[f.operation]}" takes one value.`;
	return null;
}

export function describeFilter(f: QueryFilter): string {
	return `${dimLabel(f.dimension)} ${OP_LABEL[f.operation]} ${f.values.join(", ")}`;
}

/** A card's filters: edited as drafts, sent only when applied (so typing doesn't spend queries). */
export function FilterEditor({
	universeId,
	metric,
	dimensions,
	startTime,
	endTime,
	filters,
	onApply,
}: {
	universeId: number;
	metric: string;
	dimensions: string[];
	startTime: string;
	endTime: string;
	filters: QueryFilter[];
	onApply: (filters: QueryFilter[]) => void;
}) {
	const p = useTheme();
	const [drafts, setDrafts] = useState<DraftFilter[]>(() => filters.map((f) => ({ dimension: f.dimension, operation: f.operation, values: f.values.join(", ") })));
	const [lookup, setLookup] = useState<number | null>(null);
	const errors = drafts.map(filterError);
	const set = (i: number, patch: Partial<DraftFilter>) => setDrafts((d) => d.map((f, j) => (j === i ? { ...f, ...patch } : f)));
	if (!dimensions.length) return <Txt variant="small">This metric has no dimensions to filter on.</Txt>;
	return (
		<View style={{ gap: 10 }}>
			{drafts.map((f, i) => (
				<View key={i} style={{ gap: 6, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: p.border }}>
					<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
						<Txt variant="label">Filter {i + 1}</Txt>
						<Pressable onPress={() => setDrafts((d) => d.filter((_, j) => j !== i))} hitSlop={8}>
							<Icon name="close-circle-outline" color={p.mutedForeground} />
						</Pressable>
					</View>
					<Chips options={dimensions.map((d) => ({ value: d, label: dimLabel(d) }))} value={f.dimension} onChange={(dimension) => set(i, { dimension, values: "" })} />
					<Chips options={FILTER_OPERATIONS.map((o) => ({ value: o, label: OP_LABEL[o] }))} value={f.operation} onChange={(operation) => set(i, { operation })} />
					<Field
						value={f.values}
						onChangeText={(values) => set(i, { values })}
						placeholder={f.operation === "In" || f.operation === "NotIn" ? "Values, comma separated (case-sensitive)" : "One value"}
						autoCapitalize="none"
						autoCorrect={false}
					/>
					<Button title={lookup === i ? "Hide values" : "Look up values"} icon="search-outline" small onPress={() => setLookup(lookup === i ? null : i)} style={{ alignSelf: "flex-start" }} />
					{lookup === i ? (
						<DimensionValueList
							universeId={universeId}
							metric={metric}
							dimension={f.dimension}
							startTime={startTime}
							endTime={endTime}
							selected={splitValues(f.values)}
							onToggle={(v) => {
								const cur = splitValues(f.values);
								const single = f.operation !== "In" && f.operation !== "NotIn";
								const next = cur.includes(v) ? cur.filter((x) => x !== v) : single ? [v] : [...cur, v];
								set(i, { values: next.join(", ") });
							}}
						/>
					) : null}
					{errors[i] ? <Txt variant="small">{errors[i]}</Txt> : null}
				</View>
			))}
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				{drafts.length < MAX_FILTERS ? (
					<Button title="Add filter" icon="add" small onPress={() => setDrafts((d) => [...d, { dimension: dimensions[0]!, operation: "In", values: "" }])} />
				) : null}
				<Button
					title="Apply filters"
					icon="checkmark"
					variant="primary"
					small
					disabled={errors.some(Boolean)}
					onPress={() => onApply(drafts.map((f) => ({ dimension: f.dimension, operation: f.operation, values: splitValues(f.values) })))}
				/>
			</View>
			{filters.length ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
					{filters.map((f, i) => (
						<Badge key={i} label={describeFilter(f)} tone="brand" icon="funnel-outline" />
					))}
				</View>
			) : null}
		</View>
	);
}

/** The group-wide pick (a funnel, journey, event or currency) from the dimension-values API. */
export function GroupPick({
	universeId,
	metric,
	dimension,
	label,
	required,
	startTime,
	endTime,
	value,
	onChange,
}: {
	universeId: number;
	metric: string;
	dimension: string;
	label: string;
	required: boolean;
	startTime: string;
	endTime: string;
	value: string | null;
	onChange: (v: string | null) => void;
}) {
	const q = useDimensionValues(universeId, { metric, dimension, startTime, endTime });
	const values = q.data ?? [];
	const first = values[0]?.value ?? null;
	// A required pick (a funnel, a journey) starts on the first one Roblox lists.
	useEffect(() => {
		if (required && value === null && first !== null) onChange(first);
	}, [required, value, first, onChange]);
	return (
		<View style={{ gap: 6 }}>
			<Txt variant="label">{label}</Txt>
			{q.isLoading ? <Skeleton height={28} /> : null}
			{q.error ? <CloudError error={q.error} what={`${label} list`} onRetry={() => q.refetch()} /> : null}
			{q.data && !values.length ? <Txt variant="small">No {label.toLowerCase()} data in this range. The experience has to log it with AnalyticsService first.</Txt> : null}
			{values.length ? (
				<Chips
					options={[...(required ? [] : [{ value: "", label: "All" }]), ...values.map((v) => ({ value: v.value, label: v.displayValue || v.value }))]}
					value={value ?? ""}
					onChange={(v) => onChange(v === "" ? null : v)}
				/>
			) : null}
		</View>
	);
}
