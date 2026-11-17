/**
 * The home-screen widget's look, as data (docs/WIDGET_SPEC.md). LiveSync hands it to the native module
 * (`setWidgetSpec`), which draws the widget as one bitmap from it, so a change here ships as an OTA update (`eas update`)
 * instead of a new APK. The native side keeps a built-in copy of this spec (WidgetSpec.kt, DEFAULT_JSON) for the time
 * before the app first sends one and for any spec it can't parse or draw: keep the two the same when you change the
 * default look, or the widget looks different until the app has run once.
 */

/** Spec format version the native renderer understands. A spec with a higher version is ignored (built-in default). */
export const WIDGET_SPEC_VERSION = 1;

/**
 * Colour tokens (they follow the system's day/night mode); a colour is a token, "#RRGGBB", "#AARRGGBB" or "transparent".
 * The unit tokens colour the units of metric values (rich text): time (m, s, h) `unitTime`, % `unitPercent`, R$ `unitRobux`.
 */
export type ColorToken =
	| "bg"
	| "text"
	| "text2"
	| "brand"
	| "up"
	| "down"
	| "divider"
	| "unitTime"
	| "unitPercent"
	| "unitRobux";
/** "delta" (text only): `up` when the delta is ≥ 0, `down` when it is negative. */
export type Color = ColorToken | "delta" | "transparent" | `#${string}`;

/** Slot numbers: a widget shows up to four stats, picked in the app (Settings → Widgets). */
export type SlotNumber = 1 | 2 | 3 | 4;

/**
 * Values a text can show as `{name}`, `{name:format}` or `{name|fallback}` (fallback when the value is missing).
 * Formats: count (1.2K), grouped (1,240), delta (▲12), duration (18 m 40 s), hours (1,240 h), raw; for metric values
 * also unit (the default: 18m 40s, 34.2%, R$2,140, units coloured), short (34%, R$2.1K), plain (unit without colours),
 * and on any number seconds (18m 40s), percent (0.342 → 34.2%), robux (R$2,140).
 * A name that isn't listed is a path into the live answer (`metrics.mau.value`, `metrics.revenue:72h.delta`).
 */
export type Binding =
	| "game" // game name (falls back to the backend's name)
	| "game.iconUrl" // the game's icon URL (image elements)
	| "backend" // the backend's name as saved in the app
	| "ccu" // count
	| "delta" // delta: ▲12 / ▼3 / ±0, "" when unknown
	| "servers" // grouped
	| "serversLabel" // "31 servers" / "1 server"
	| "peakToday" // grouped
	| "lastHour.avgSessionSeconds" // duration
	| "lastHour.medianSessionSeconds" // duration
	| "lastHour.sessionsEnded" // grouped
	| "lastHour.playtimeHours" // hours
	| "updated" // clock time of the last good answer ("12:04" / "12:04 PM"), "" when never
	| "status" // "refreshing…" | "offline · 12:04" | "12:04" (the wording comes from `strings`)
	| "state" // raw: "fresh" | "refreshing" | "offline" | ""
	| `slot.${SlotNumber}` // the slot's metric id; missing when the slot is empty
	| `slot.${SlotNumber}.label` // "DAU", "Session 1h" (the backend's label, else the app's)
	| `slot.${SlotNumber}.value` // formatted by its unit, units coloured ("—" when unknown)
	| `slot.${SlotNumber}.delta` // ▲6% / ▼14% (ratios in points: ▲1.1), coloured up / down; missing when unknown
	| `metrics.${string}`; // any metric of the answer (it is only fetched when some widget's slot asks for it)

/** A number (all sides) or per side, in dp. `start`/`end` are left/right (the widget is drawn left to right). */
export type Edges =
	| number
	| { top?: number; bottom?: number; start?: number; end?: number; horizontal?: number; vertical?: number };

export type Fill = Color | { color?: Color; radius?: number | "system" };

/** Where an element sits inside a `stack` (default topStart). */
export type Gravity =
	| "topStart"
	| "top"
	| "topEnd"
	| "start"
	| "center"
	| "end"
	| "bottomStart"
	| "bottom"
	| "bottomEnd"
	| "fill";

type Common = {
	/** Share of the parent row/column's leftover space (like LinearLayout's layout_weight with a 0 size). */
	weight?: number;
	/** Fixed size in dp (else the content's size). */
	width?: number;
	height?: number;
	padding?: Edges;
	margin?: Edges;
	/** Cross-axis placement inside a row/column, overriding the parent's `align`. */
	alignSelf?: "start" | "center" | "end" | "stretch";
	/** Placement inside a `stack`. */
	gravity?: Gravity;
	/** Drawn only when this binding has a value ("series": the chart has points); "!name" for the opposite. */
	showIf?: Binding | "series" | `!${Binding}` | "!series";
	background?: Fill;
};

export type ContainerElement = Common & {
	type: "column" | "row" | "stack";
	children: WidgetElement[];
	/** Space between children in dp (row/column). */
	gap?: number;
	/** Cross axis. Column default "stretch", row default "center"; "baseline" (rows) lines up the texts' first baselines. */
	align?: "start" | "center" | "end" | "stretch" | "baseline";
	/** Main axis, when no child has a weight. */
	justify?: "start" | "center" | "end" | "spaceBetween";
};

export type TextElement = Common & {
	type: "text";
	/** Literal text with `{binding}` placeholders; `{{` and `}}` for braces. An empty result hides the element. */
	text: string;
	/** sp (follows the system font scale, clamped to 0.8..1.3). Default 12. */
	size?: number;
	fontWeight?: "normal" | "medium" | "semibold" | "bold" | number;
	/** Default "text". */
	color?: Color;
	/** Default "start". */
	align?: "start" | "center" | "end";
	/** Default 1. */
	maxLines?: number;
	/** "…" at the end of the last line when it doesn't fit. Default true. */
	ellipsis?: boolean;
};

export type ChartElement = Common & {
	type: "chart";
	/** The CCU line ("series" is the only one). */
	bind?: "series";
	/** Window in minutes, 1..360 (the widget keeps 6 hours). Default 360. */
	minutes?: number;
	/** Default "brand". */
	color?: Color;
	/** true: the line colour fading down; a colour: that colour fading down; false: no fill. Default true. */
	fill?: boolean | Color;
	/** Line width in dp. Default 2. */
	stroke?: number;
	/** A dot on the newest point. Default true. */
	dot?: boolean;
};

export type SpacerElement = Common & { type: "spacer"; /** dp along the parent's axis. */ size?: number };

export type DividerElement = Common & { type: "divider"; color?: Color; /** dp. Default 1. */ thickness?: number };

/**
 * A picture by URL, centre-cropped into a square of `size` (or `width` x `height`) with rounded corners. Downloaded by
 * the widget's background refresh, cached on disk for a day; the `placeholder` colour shows until it is there.
 */
export type ImageElement = Common & {
	type: "image";
	/** The binding holding the URL. Default "game.iconUrl". */
	bind?: Binding;
	/** dp. Default 22. */
	size?: number;
	/** Corner radius in dp. Default 6. */
	radius?: number;
	/** Drawn while the picture is missing; null draws nothing. Default "divider". */
	placeholder?: Color | null;
};

export type IconElement = Common & {
	type: "icon";
	name: "flame" | "refresh" | "people" | "server" | "clock";
	/** dp. Default 16. */
	size?: number;
	/** Default "text2". */
	color?: Color;
};

export type WidgetElement =
	| ContainerElement
	| TextElement
	| ChartElement
	| SpacerElement
	| DividerElement
	| IconElement
	| ImageElement;

/** Where the (invisible, fixed 36 dp) refresh hit area sits. Draw a refresh icon there yourself. */
export type RefreshCorner = "topEnd" | "topStart" | "bottomEnd" | "bottomStart" | "none";

/**
 * One size class of one state. The renderer picks, among the entries whose minimums fit the widget's size in dp, the
 * one with the largest minWidth × minHeight (none fits: the smallest one).
 */
export type SizeLayout = {
	name?: string;
	minWidth: number;
	minHeight: number;
	/** Default { color: "bg", radius: "system" } (the launcher's corner radius on Android 12+, else 16 dp). */
	background?: Fill;
	/** Default "topEnd" (ignored in the signedOut and pick states, which have no refresh). */
	refresh?: RefreshCorner;
	/** TalkBack text (template); default: the drawn texts joined with ", ". */
	description?: string;
	root: WidgetElement;
};

export type WidgetState = "data" | "loading" | "unreachable" | "signedOut" | "pick";

export type WidgetSpec = {
	version: number;
	/** Overrides of the built-in colour tokens, per mode ("#RRGGBB" / "#AARRGGBB"). */
	tokens?: { day?: Partial<Record<ColorToken, string>>; night?: Partial<Record<ColorToken, string>> };
	/** Wording of the `status` binding; `offline` is a template ({updated} is the clock time). */
	strings?: { refreshing?: string; offline?: string };
	/** `data` is required; a missing state uses the built-in default's. */
	layouts: { data: SizeLayout[] } & Partial<Record<Exclude<WidgetState, "data">, SizeLayout[]>>;
};

/** A state without numbers: a centred message, plus the refresh icon in the top-end corner when [refresh]. */
function message(text: string, refresh: boolean): SizeLayout[] {
	const children: WidgetElement[] = [
		{
			type: "text",
			text,
			size: 13,
			color: "text",
			align: "center",
			maxLines: 2,
			gravity: "center",
			margin: { horizontal: 20 },
		},
	];
	if (refresh) children.push({ type: "icon", name: "refresh", size: 18, padding: 3, color: "text2", gravity: "topEnd" });
	return [
		{
			name: "message",
			minWidth: 0,
			minHeight: 0,
			refresh: refresh ? "topEnd" : "none",
			root: { type: "stack", padding: 8, children },
		},
	];
}

/** The game's icon, name, the status time (optional) and the refresh icon in the top-end corner (its hit area). */
function header(o: { icon: number; nameColor: Color; status: boolean }): WidgetElement {
	const children: WidgetElement[] = [
		{ type: "image", bind: "game.iconUrl", size: o.icon, radius: 6, placeholder: "divider", margin: { end: 7 } },
		{ type: "text", text: "{game}", size: 12, fontWeight: "medium", color: o.nameColor, weight: 1 },
	];
	if (o.status) children.push({ type: "text", text: "{status}", size: 10, color: "text2", margin: { start: 6 } });
	children.push({ type: "icon", name: "refresh", size: 15, padding: 4, color: "text2" });
	return { type: "row", align: "center", children };
}

/** The big CCU with its delta (▲12 / ▼3). */
function ccu(size: number, deltaSize: number): WidgetElement[] {
	return [
		{ type: "text", text: "{ccu}", size, fontWeight: "semibold", color: "text" },
		{ type: "text", text: "{delta}", size: deltaSize, fontWeight: "bold", color: "delta", margin: { start: 4 }, showIf: "delta" },
	];
}

/** 2x1: one line per slot, "label value" right-aligned, the value short (34%, R$2.1K). */
function shortLine(n: SlotNumber): WidgetElement {
	return {
		type: "row",
		align: "baseline",
		showIf: `slot.${n}`,
		children: [
			{ type: "text", text: `{slot.${n}.label}`, size: 10, color: "text2", align: "end", weight: 1 },
			{ type: "text", text: `{slot.${n}.value:short}`, size: 11, fontWeight: "semibold", color: "text", margin: { start: 4 } },
		],
	};
}

/** 2x2: a grid cell, the label over the value and its delta. */
function cell(n: SlotNumber): WidgetElement {
	return {
		type: "column",
		weight: 1,
		showIf: `slot.${n}`,
		children: [
			{ type: "text", text: `{slot.${n}.label}`, size: 10, color: "text2" },
			{
				type: "row",
				align: "baseline",
				children: [
					{ type: "text", text: `{slot.${n}.value}`, size: 12, fontWeight: "semibold", color: "text" },
					{ type: "text", text: `{slot.${n}.delta}`, size: 8.5, fontWeight: "bold", margin: { start: 3 }, showIf: `slot.${n}.delta` },
				],
			},
		],
	};
}

/** 4x2: a stat row, the label left, the value and its delta right. */
function statRow(n: SlotNumber): WidgetElement {
	return {
		type: "row",
		align: "baseline",
		showIf: `slot.${n}`,
		children: [
			{ type: "text", text: `{slot.${n}.label}`, size: 10.5, color: "text2", weight: 1 },
			{ type: "text", text: `{slot.${n}.value}`, size: 12, fontWeight: "semibold", color: "text", margin: { start: 8 } },
			{ type: "text", text: `{slot.${n}.delta}`, size: 9.5, fontWeight: "bold", margin: { start: 4 }, showIf: `slot.${n}.delta` },
		],
	};
}

/** 2x1 (and anything short): the header, the CCU left and the first [lines] slots right. */
function small(name: string, minWidth: number, minHeight: number, lines: SlotNumber[]): SizeLayout {
	return {
		name,
		minWidth,
		minHeight,
		refresh: "topEnd",
		root: {
			type: "column",
			padding: { start: 12, top: 4, end: 6, bottom: 8 },
			children: [
				header({ icon: 18, nameColor: "text2", status: true }),
				{ type: "spacer", weight: 1 },
				{
					type: "row",
					align: "center",
					padding: { end: 6 },
					children: [
						...ccu(22, 12),
						{ type: "column", weight: 1, align: "end", gap: 1, margin: { start: 8 }, children: lines.map(shortLine) },
					],
				},
				{ type: "spacer", weight: 1 },
			],
		},
	};
}

/**
 * The app's current widget (the same as the native built-in default). The look agreed on 2026-11-17
 * (docs/WIDGET_STATS.md): the game's icon in the header, values in `text` with coloured units, ▲/▼ against the period
 * before; 2x1 (three stats, short), 2x2 (CCU and a grid of four), 4x2 (CCU, the 6-hour line and four stat rows).
 */
export const WIDGET_SPEC: WidgetSpec = {
	version: WIDGET_SPEC_VERSION,
	tokens: {
		day: {
			bg: "#EFFFFFFF",
			text: "#FF17171B",
			text2: "#FF62606A",
			brand: "#FFFB7A32",
			up: "#FF1F8A4C",
			down: "#FFC93C3C",
			divider: "#1F000000",
			unitTime: "#FFE2700F",
			unitPercent: "#FF1F6FD1",
			unitRobux: "#FF1F8A4C",
		},
		night: {
			bg: "#FF1C1C20",
			text: "#FFF2F0F5",
			text2: "#FFA7A3AD",
			brand: "#FFFB7A32",
			up: "#FF4CC27A",
			down: "#FFEF6B6B",
			divider: "#33FFFFFF",
			unitTime: "#FFFB923C",
			unitPercent: "#FF5AA9FF",
			unitRobux: "#FF4CC27A",
		},
	},
	strings: { refreshing: "refreshing…", offline: "offline · {updated}" },
	layouts: {
		data: [
			{
				// 4x2 and up: the CCU and its 6-hour line left, the four stats right.
				name: "medium",
				minWidth: 240,
				minHeight: 120,
				refresh: "topEnd",
				root: {
					type: "column",
					padding: { start: 14, top: 4, end: 6, bottom: 10 },
					children: [
						header({ icon: 22, nameColor: "text", status: true }),
						{
							type: "row",
							weight: 1,
							align: "stretch",
							margin: { top: 4 },
							padding: { end: 8 },
							children: [
								{
									type: "column",
									weight: 1,
									children: [
										{ type: "row", align: "baseline", children: ccu(34, 13) },
										{ type: "chart", bind: "series", minutes: 360, color: "brand", fill: true, weight: 1, margin: { top: 2, bottom: 3 } },
										{ type: "text", text: "last 6 h · {serversLabel|no servers} · peak {peakToday}", size: 10, color: "text2" },
									],
								},
								{ type: "column", weight: 1, justify: "center", gap: 6, margin: { start: 12 }, children: [statRow(1), statRow(2), statRow(3), statRow(4)] },
							],
						},
					],
				},
			},
			{
				// 2x2: the CCU, then a 2x2 grid of the stats at the bottom.
				name: "grid",
				minWidth: 100,
				minHeight: 115,
				refresh: "topEnd",
				root: {
					type: "column",
					padding: { start: 12, top: 4, end: 6, bottom: 10 },
					children: [
						header({ icon: 20, nameColor: "text2", status: false }),
						{
							type: "row",
							align: "baseline",
							margin: { top: 4 },
							children: [
								...ccu(22, 12),
								{ type: "text", text: "· {serversLabel}", size: 10, color: "text2", margin: { start: 4 }, weight: 1, showIf: "servers" },
							],
						},
						{ type: "spacer", weight: 1 },
						{ type: "row", align: "start", gap: 6, padding: { end: 6 }, margin: { bottom: 7 }, children: [cell(1), cell(2)] },
						{ type: "row", align: "start", gap: 6, padding: { end: 6 }, children: [cell(3), cell(4)] },
					],
				},
			},
			{
				// 4x1 (wide and short): the CCU left, the 6-hour line in the middle, the stats right.
				name: "wide",
				minWidth: 240,
				minHeight: 60,
				refresh: "topEnd",
				root: {
					type: "column",
					padding: { start: 12, top: 4, end: 6, bottom: 8 },
					children: [
						header({ icon: 18, nameColor: "text2", status: true }),
						{
							type: "row",
							weight: 1,
							align: "center",
							padding: { end: 6 },
							children: [
								{ type: "row", align: "baseline", children: ccu(24, 12) },
								{ type: "chart", bind: "series", minutes: 360, color: "brand", fill: true, weight: 1, height: 34, margin: { start: 10, end: 10 } },
								{ type: "column", weight: 0.9, align: "end", gap: 1, children: [shortLine(1), shortLine(2), shortLine(3), shortLine(4)] },
							],
						},
					],
				},
			},
			// 2x1: four stats when it's tall enough, three from 72 dp, two below that.
			small("small4", 100, 90, [1, 2, 3, 4]),
			small("small", 100, 72, [1, 2, 3]),
			small("tiny", 0, 0, [1, 2]),
		],
		loading: message("Loading…", true),
		unreachable: message("Can't reach {backend|the backend}", true),
		signedOut: message("Open TypeTorch to sign in", false),
		pick: message("Tap to pick a game", false),
	},
};

/** What LiveSync sends (computed once). */
export const WIDGET_SPEC_JSON = JSON.stringify(WIDGET_SPEC);
