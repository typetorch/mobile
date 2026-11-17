/**
 * Settings → Widgets (docs/WIDGET_STATS.md): the home-screen widgets placed now, each with its four stat slots, and the
 * slots new widgets start with. A change is saved natively at once (setWidgetConfig / setDefaultSlots) and the widgets
 * refresh, which fetches the new metrics from the backend.
 */
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";

import { Button, Chips, EmptyState, Field, Icon, List, notify, Row, Screen, Section, Segmented, Txt } from "@/components/ui";
import { useAccounts } from "@/store/accounts";
import { space, useTheme } from "@/theme";
import * as Live from "@modules/typetorch-live";

import {
	clampWindow,
	fourSlots,
	METRICS,
	metricKind,
	parseSlot,
	QUICK_WINDOWS,
	slotId,
	slotTitle,
	windowId,
	windowLabel,
	type WindowUnit,
} from "./widget-metrics";

/** Several quick taps → one refresh (each refresh fetches every widget's backend). */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function refreshSoon() {
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		Live.refreshWidgets();
	}, 700);
}

const METRIC_OPTIONS = [...METRICS.map((m) => ({ value: m.base, label: m.label })), { value: "", label: "None" }];
const WINDOW_OPTIONS = [...QUICK_WINDOWS.map((w) => ({ value: windowId(w), label: windowLabel(w) })), { value: "custom", label: "Custom…" }];

/** The editor under an opened slot: the metric, its hint, and for windowed metrics the window. */
function SlotEditor({ value, onChange }: { value: string; onChange: (id: string) => void }) {
	const p = useTheme();
	const { base, window } = parseSlot(value);
	const kind = metricKind(base);
	const win = kind?.window ? (window ?? kind.window) : null;
	const quick = !!win && QUICK_WINDOWS.some((q) => windowId(q) === windowId(win));
	const [custom, setCustom] = useState(false);
	const [text, setText] = useState(win ? String(win.n) : "");
	const [unit, setUnit] = useState<WindowUnit>(win?.unit ?? "h");
	const [problem, setProblem] = useState<string | null>(null);

	// Follow the saved value (another quick pick, a reload).
	useEffect(() => {
		if (!win) return;
		setText(String(win.n));
		setUnit(win.unit);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	const applyCustom = () => {
		const n = Number.parseInt(text, 10);
		if (!Number.isFinite(n) || n < 1) {
			setProblem("Type a number of hours (1–72) or days (1–90).");
			return;
		}
		const w = clampWindow({ n, unit });
		setProblem(w.n !== n ? `Set to ${w.n} ${w.unit === "h" ? "hours (72 at most)" : "days (90 at most)"}.` : null);
		setText(String(w.n));
		onChange(`${base}:${windowId(w)}`);
	};

	return (
		<View style={{ gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.md }}>
			<Chips
				options={METRIC_OPTIONS}
				value={kind || !value ? base : "\u0000"}
				onChange={(b) => {
					setCustom(false);
					setProblem(null);
					onChange(b ? slotId(b, null) : "");
				}}
			/>
			{kind ? <Txt variant="small">{kind.hint}</Txt> : value ? <Txt variant="small">Not in this app's list: {value}</Txt> : <Txt variant="small">This slot stays empty.</Txt>}
			{win ? (
				<View style={{ gap: space.sm }}>
					<Txt variant="label">Window</Txt>
					<Chips
						options={WINDOW_OPTIONS}
						value={custom || !quick ? "custom" : windowId(win)}
						onChange={(v) => {
							setProblem(null);
							if (v === "custom") setCustom(true);
							else {
								setCustom(false);
								onChange(`${base}:${v}`);
							}
						}}
					/>
					{custom || !quick ? (
						<View style={{ gap: 6 }}>
							<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
								<Field value={text} onChangeText={setText} keyboardType="number-pad" maxLength={3} placeholder="24" onSubmitEditing={applyCustom} style={{ width: 64, textAlign: "center" }} />
								<Segmented<WindowUnit>
									options={[
										{ value: "h", label: "hours" },
										{ value: "d", label: "days" },
									]}
									value={unit}
									onChange={setUnit}
									style={{ flex: 1 }}
								/>
								<Button title="Set" small variant="brand" onPress={applyCustom} />
							</View>
							<Txt variant="small">Last 1–72 hours or 1–90 days.</Txt>
						</View>
					) : null}
					{problem ? (
						<Txt variant="small" color={p.warning}>
							{problem}
						</Txt>
					) : null}
				</View>
			) : null}
		</View>
	);
}

/** Four slots in one list; one opens at a time. */
function SlotList({ slots, onChange }: { slots: string[]; onChange: (index: number, id: string) => void }) {
	const p = useTheme();
	const [open, setOpen] = useState<number | null>(null);
	return (
		<List>
			{slots.map((id, i) => (
				<View key={i}>
					<Row
						left={
							<View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
								<Txt variant="small" style={{ fontWeight: "700" }}>
									{i + 1}
								</Txt>
							</View>
						}
						title={slotTitle(id)}
						titleColor={id ? undefined : p.mutedForeground}
						subtitle={i === 3 ? "Not on the 2×1 size" : undefined}
						right={<Icon name={open === i ? "chevron-up" : "chevron-down"} size={16} color={p.mutedForeground} />}
						onPress={() => setOpen(open === i ? null : i)}
					/>
					{open === i ? <SlotEditor value={id} onChange={(next) => onChange(i, next)} /> : null}
				</View>
			))}
		</List>
	);
}

function WidgetCard({ widget, onChange }: { widget: Live.LiveWidget; onChange: (slots: string[]) => void }) {
	const p = useTheme();
	const { backends } = useAccounts();
	const backend = backends.find((b) => b.id === widget.backendId);
	const title = backend?.name ?? (widget.backendId ? "A removed backend" : "No game picked yet");
	const slots = fourSlots(widget.slots);
	return (
		<View style={{ gap: 6 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 2 }}>
				<Icon name="apps-outline" size={16} color={p.brand} />
				<Txt style={{ fontWeight: "600", flex: 1 }} numberOfLines={1}>
					{title}
				</Txt>
				{backend?.signedOut ? <Txt variant="small" color={p.warning}>signed out</Txt> : null}
			</View>
			{!widget.backendId ? <Txt variant="small">Tap the widget on the home screen to pick its game.</Txt> : null}
			<SlotList
				slots={slots}
				onChange={(i, id) => {
					const next = [...slots];
					next[i] = id;
					onChange(next);
				}}
			/>
		</View>
	);
}

export function WidgetSettings() {
	const [widgets, setWidgets] = useState<Live.LiveWidget[]>(() => Live.widgets());
	const [defaults, setDefaults] = useState<string[]>(() => fourSlots(Live.defaultSlots()));

	const reload = useCallback(() => {
		setWidgets(Live.widgets());
		setDefaults(fourSlots(Live.defaultSlots()));
	}, []);

	// Widgets get placed and removed on the home screen while the app is away.
	useFocusEffect(reload);
	useEffect(() => {
		const sub = AppState.addEventListener("change", (s) => {
			if (s === "active") reload();
		});
		return () => sub.remove();
	}, [reload]);

	const setWidgetSlots = (w: Live.LiveWidget, slots: string[]) => {
		if (!Live.setWidgetConfig(w.id, { slots })) {
			notify("Couldn't change the widget", "It may have been removed from the home screen.");
			reload();
			return;
		}
		setWidgets((ws) => ws.map((x) => (x.id === w.id ? { ...x, slots } : x)));
		refreshSoon();
	};

	const setDefault = (i: number, id: string) => {
		const next = [...defaults];
		next[i] = id;
		Live.setDefaultSlots(next);
		setDefaults(next);
	};

	const applyDefaultsToAll = () => {
		let ok = true;
		for (const w of widgets) ok = Live.setWidgetConfig(w.id, { slots: defaults }) && ok;
		reload();
		refreshSoon();
		if (!ok) notify("Some widgets didn't change", "They may have been removed from the home screen.");
	};

	if (!Live.isAvailable()) {
		return (
			<Screen>
				<Stack.Screen options={{ title: "Widgets" }} />
				<EmptyState icon="apps-outline" title="Widgets need the Android app" body="Home-screen widgets work in TypeTorch's Android build, not in Expo Go or on the web." />
			</Screen>
		);
	}

	return (
		<Screen>
			<Stack.Screen options={{ title: "Widgets" }} />
			<Section title="On the home screen">
				{widgets.length ? (
					<View style={{ gap: space.lg }}>
						{widgets.map((w) => (
							<WidgetCard key={w.id} widget={w} onChange={(slots) => setWidgetSlots(w, slots)} />
						))}
					</View>
				) : (
					<EmptyState
						icon="apps-outline"
						title="No widgets yet"
						body="Long-press the home screen → Widgets → TypeTorch, drag it out and pick the game. Then come back here to pick its stats."
					/>
				)}
			</Section>

			<Section title="Default for new widgets">
				<SlotList slots={defaults} onChange={setDefault} />
				{widgets.length ? <Button title="Use these on every widget" small icon="copy-outline" onPress={applyDefaultsToAll} style={{ alignSelf: "flex-start" }} /> : null}
			</Section>

			<Txt variant="small">
				The 2×1 size shows the first three stats, 2×2 and 4×2 all four. ▲/▼ compare with the period before. Widgets refresh about every 30 minutes; tap a
				widget's ↻ for now. A backend that doesn't know a stat yet shows “—”.
			</Txt>
		</Screen>
	);
}
