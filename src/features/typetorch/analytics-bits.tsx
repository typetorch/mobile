/**
 * Small pieces the analytics pages share (Session time, Feedback, Live events, Overview, Explain): a stat tile with an
 * info text (the web's Metric + InfoTip: a tap shows the text) and a change chip, a labelled picker row (the web's
 * Select controls as chips), a collapsible block (the web's <details>), and the range / device pickers of pages whose
 * filter bar is off (web components/RangePicker.tsx; Feedback): they write the same per-backend filter state.
 */
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { DEVICES, type Device } from "@/api/tt/types";
import { Card, Chips, Field, Icon, Txt } from "@/components/ui";
import { font, radius, space, toneColor, useTheme, type Tone } from "@/theme";

import { ChangeChip } from "./bits";
import { isoDate, RANGE_LABELS, RANGE_PRESETS, useTTFilters, type RangePreset } from "./filters";

type Change = { relative: number | null; direction: "up" | "down" | "flat"; good: boolean | null };

/** A tile: label (tap the i for its explanation), value, an optional change chip and sub line, an optional action. */
export function InfoStat({ label, value, info, change, sub, tone, action }: { label: string; value: ReactNode; info?: string; change?: Change | null; sub?: ReactNode; tone?: Tone; action?: ReactNode }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	return (
		<Card style={{ flexGrow: 1, flexBasis: "45%", gap: 4 }}>
			<Pressable onPress={info ? () => setOpen((o) => !o) : undefined} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
				<Txt variant="label" style={{ flexShrink: 1 }}>
					{label}
				</Txt>
				{info ? <Icon name="information-circle-outline" size={13} color={p.mutedForeground} /> : null}
			</Pressable>
			<Txt style={{ fontSize: font.xl, fontWeight: "700", letterSpacing: -0.3, ...(tone ? { color: toneColor(p, tone) } : {}) }} numberOfLines={1}>
				{value}
			</Txt>
			{change ? (
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
					<ChangeChip change={change} />
					<Txt variant="small">vs before</Txt>
				</View>
			) : null}
			{sub ? typeof sub === "string" ? <Txt variant="small">{sub}</Txt> : sub : null}
			{open && info ? <Txt variant="small">{info}</Txt> : null}
			{action}
		</Card>
	);
}

/** A picker with its label (the web's Select / ToggleGroup controls). */
export function Picker<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange(v: T): void; options: { value: T; label: string; disabled?: boolean }[] }) {
	const enabled = options.filter((o) => !o.disabled);
	return (
		<View style={{ gap: 4 }}>
			<Txt variant="small">{label}</Txt>
			<Chips options={enabled} value={value} onChange={onChange} />
		</View>
	);
}

/** A collapsible block with a title row (the web's <details>). */
export function Collapsible({ title, right, open: initial = false, children }: { title: ReactNode; right?: ReactNode; open?: boolean; children: ReactNode }) {
	const p = useTheme();
	const [open, setOpen] = useState(initial);
	return (
		<View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md, backgroundColor: `${p.muted}66` }}>
			<Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: space.sm, flexWrap: "wrap" }}>
				<Icon name={open ? "chevron-down" : "chevron-forward"} size={14} color={p.mutedForeground} />
				{typeof title === "string" ? (
					<Txt variant="small" color={p.foreground} style={{ fontWeight: "600" }}>
						{title}
					</Txt>
				) : (
					title
				)}
				{right}
			</Pressable>
			{open ? <View style={{ borderTopWidth: 1, borderColor: p.border, padding: space.sm }}>{children}</View> : null}
		</View>
	);
}

/** A colored callout (warnings, verdicts). */
export function Callout({ tone = "warning", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
	const p = useTheme();
	const c = toneColor(p, tone);
	return (
		<View style={{ borderWidth: 1, borderColor: `${c}88`, backgroundColor: `${c}18`, borderRadius: radius.md, padding: space.md, gap: 4 }}>
			{title ? (
				<Txt style={{ fontWeight: "700" }} color={c}>
					{title}
				</Txt>
			) : null}
			{typeof children === "string" ? <Txt variant="small" color={p.foreground}>{children}</Txt> : children}
		</View>
	);
}

const DAY_MS = 86_400_000;

/** The date range alone (a preset, or Custom with two UTC dates), for pages whose filter bar is off. */
export function RangePicker({ backendId }: { backendId: string }) {
	const { state, set } = useTTFilters(backendId);
	const today = isoDate(Date.now());
	return (
		<View style={{ gap: space.sm }}>
			<Chips
				options={[...RANGE_PRESETS, "custom" as const].map((r) => ({ value: r as RangePreset, label: RANGE_LABELS[r] }))}
				value={state.range}
				onChange={(next) => {
					if (next === "custom") set({ range: "custom", from: state.from ?? isoDate(Date.now() - 29 * DAY_MS), to: state.to ?? today });
					else set({ range: next });
				}}
			/>
			{state.range === "custom" ? (
				<View style={{ flexDirection: "row", gap: space.sm }}>
					<View style={{ flex: 1 }}>
						<Field label="From (UTC)" value={state.from ?? ""} placeholder="YYYY-MM-DD" onChangeText={(t) => set({ from: t.trim() || undefined })} />
					</View>
					<View style={{ flex: 1 }}>
						<Field label="To (UTC, inclusive)" value={state.to ?? ""} placeholder={today} onChangeText={(t) => set({ to: t.trim() || undefined })} />
					</View>
				</View>
			) : null}
		</View>
	);
}

/** The device alone ("All devices" or one), in the backend's filter state. */
export function DevicePicker({ backendId }: { backendId: string }) {
	const { state, set } = useTTFilters(backendId);
	return <Chips options={[{ value: "", label: "All devices" }, ...DEVICES.map((d) => ({ value: d as string, label: d }))]} value={state.dev ?? ""} onChange={(v) => set({ dev: (v || undefined) as Device | undefined })} />;
}
