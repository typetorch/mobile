/**
 * The widget's stat catalog (docs/WIDGET_STATS.md, "Metric ids"): what a widget slot can show, how its id is built
 * (`dau`, `revenue:72h`) and how the app names it. The backend computes the numbers; the native widget asks for the
 * ids in its slots.
 */

export type WindowUnit = "h" | "d";
export type MetricWindow = { n: number; unit: WindowUnit };

export type MetricKind = {
	/** The id, or its prefix before ":" for windowed metrics. */
	base: string;
	/** Picker label. */
	label: string;
	/** What it counts (picker hint). */
	hint: string;
	/** Windowed metrics take "<n>h" (1..72) or "<n>d" (1..90). */
	window?: MetricWindow;
};

export const METRICS: MetricKind[] = [
	{ base: "dau", label: "DAU", hint: "Unique players, last 24 hours" },
	{ base: "wau", label: "WAU", hint: "Unique players, last 7 days" },
	{ base: "mau", label: "MAU", hint: "Unique players, last 30 days" },
	{ base: "new", label: "New players", hint: "First-time players in the window", window: { n: 24, unit: "h" } },
	{ base: "d1", label: "D1", hint: "D1 retention of the latest complete cohort" },
	{ base: "d7", label: "D7", hint: "D7 retention of the latest complete cohort" },
	{ base: "session", label: "Session length", hint: "Mean length of the sessions that ended in the window", window: { n: 1, unit: "h" } },
	{ base: "playtime", label: "Playtime", hint: "Total time played in the window", window: { n: 1, unit: "h" } },
	{ base: "sessions", label: "Sessions", hint: "Sessions that ended in the window", window: { n: 24, unit: "h" } },
	{ base: "revenue", label: "Revenue", hint: "Robux spent in the window", window: { n: 72, unit: "h" } },
	{ base: "payers", label: "Payers", hint: "Unique paying players in the window", window: { n: 24, unit: "h" } },
	{ base: "ccu", label: "CCU", hint: "Players on live servers now" },
	{ base: "servers", label: "Servers", hint: "Live servers now" },
	{ base: "peakToday", label: "Peak today", hint: "Highest CCU since 00:00 UTC" },
];

export const WINDOW_LIMITS: Record<WindowUnit, number> = { h: 72, d: 90 };

/** Quick picks of the window picker. */
export const QUICK_WINDOWS: MetricWindow[] = [
	{ n: 1, unit: "h" },
	{ n: 24, unit: "h" },
	{ n: 72, unit: "h" },
	{ n: 7, unit: "d" },
	{ n: 30, unit: "d" },
];

export function metricKind(base: string): MetricKind | undefined {
	return METRICS.find((m) => m.base === base);
}

export function clampWindow(w: MetricWindow): MetricWindow {
	const n = Math.round(Number.isFinite(w.n) ? w.n : 1);
	return { n: Math.min(Math.max(n, 1), WINDOW_LIMITS[w.unit]), unit: w.unit };
}

export function windowId(w: MetricWindow): string {
	const c = clampWindow(w);
	return `${c.n}${c.unit}`;
}

/** "1 h", "7 d". */
export function windowLabel(w: MetricWindow): string {
	return `${w.n} ${w.unit}`;
}

/** "last 24 hours", "last 7 days", "last hour". */
export function windowLong(w: MetricWindow): string {
	if (w.n === 1) return w.unit === "h" ? "last hour" : "last day";
	return `last ${w.n} ${w.unit === "h" ? "hours" : "days"}`;
}

/** A slot id split: `revenue:72h` → { base: "revenue", window: { n: 72, unit: "h" } }. Null window when none / bad. */
export function parseSlot(id: string): { base: string; window: MetricWindow | null } {
	const [base = "", rest] = id.split(":", 2);
	const m = rest ? /^(\d{1,3})([hd])$/.exec(rest) : null;
	return { base, window: m ? clampWindow({ n: Number(m[1]), unit: m[2] as WindowUnit }) : null };
}

/** The id of [base] with [w] (windowed metrics; their default window when [w] is null), or the plain id. */
export function slotId(base: string, w: MetricWindow | null): string {
	const kind = metricKind(base);
	if (!kind?.window) return base;
	return `${base}:${windowId(w ?? kind.window)}`;
}

/** How the app names a slot: "Revenue · last 72 hours", "DAU"; "Empty" for "". */
export function slotTitle(id: string): string {
	if (!id) return "Empty";
	const { base, window } = parseSlot(id);
	const kind = metricKind(base);
	if (!kind) return id;
	if (!kind.window) return kind.label;
	return `${kind.label} · ${windowLong(window ?? kind.window)}`;
}

/** Four slots (missing ones ""), for the pickers. */
export function fourSlots(slots: readonly string[]): string[] {
	return [0, 1, 2, 3].map((i) => slots[i] ?? "");
}

/**
 * A widget's style (docs/WIDGET_RELEASES.md): Stats (the four slots above) or Releases, the release garden. Releases is
 * stored as the slots ["", "", "", "releases"]: slot 1 empty is the marker the widget HTML shows the garden on
 * (`!slot.1`), slot 4 makes the native side fetch the `releases` metric. `releases` is therefore not in METRICS (it
 * isn't a stat a slot shows).
 */
export type WidgetStyle = "stats" | "releases";

export const RELEASES_METRIC = "releases";
export const RELEASES_SLOTS: readonly string[] = ["", "", "", RELEASES_METRIC];

/** What the widget draws: the garden whenever slot 1 is empty (as the widget HTML decides). */
export function widgetStyle(slots: readonly string[]): WidgetStyle {
	return slots[0] ? "stats" : "releases";
}
