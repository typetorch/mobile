/**
 * The home-screen widget's look, as data (docs/WIDGET_SPEC.md). LiveSync hands it to the native module
 * (`setWidgetSpec`), which draws the widget as one bitmap from it, so a change here ships as an OTA update (`eas update`)
 * instead of a new APK. The native side keeps a built-in copy of this spec (WidgetSpec.kt, DEFAULT_JSON) for the time
 * before the app first sends one and for any spec it can't parse or draw: keep the two the same when you change the
 * default look, or the widget looks different until the app has run once.
 */

/** Spec format version the native renderer understands. A spec with a higher version is ignored (built-in default). */
export const WIDGET_SPEC_VERSION = 1;

/** Colour tokens (they follow the system's day/night mode); a colour is a token, "#RRGGBB", "#AARRGGBB" or "transparent". */
export type ColorToken = "bg" | "text" | "text2" | "brand" | "up" | "down" | "divider";
/** "delta" (text only): `up` when the delta is ≥ 0, `down` when it is negative. */
export type Color = ColorToken | "delta" | "transparent" | `#${string}`;

/**
 * Values a text can show as `{name}`, `{name:format}` or `{name|fallback}` (fallback when the value is missing).
 * Formats: count (1.2K), grouped (1,240), delta (▲12), duration (18 m 40 s), hours (1,240 h), raw.
 */
export type Binding =
	| "game" // game name (falls back to the backend's name)
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
	| "state"; // raw: "fresh" | "refreshing" | "offline" | ""

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
	| IconElement;

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

/** The app's current widget (the same as the native built-in default). */
export const WIDGET_SPEC: WidgetSpec = {
	version: WIDGET_SPEC_VERSION,
	tokens: {
		day: {
			bg: "#F7FFFFFF",
			text: "#FF1B1B1F",
			text2: "#FF5F6368",
			brand: "#FFFB7A32",
			up: "#FF2E9D57",
			down: "#FFD64545",
			divider: "#1F000000",
		},
		night: {
			bg: "#F21E1E22",
			text: "#FFECECEE",
			text2: "#FFA8A8AD",
			brand: "#FFFB7A32",
			up: "#FF4CC27A",
			down: "#FFF06A6A",
			divider: "#33FFFFFF",
		},
	},
	strings: { refreshing: "refreshing…", offline: "offline · {updated}" },
	layouts: {
		data: [
			{
				// 4x2 and up: the 6-hour line and the last hour's footer.
				name: "medium",
				minWidth: 220,
				minHeight: 95,
				refresh: "topEnd",
				description: "{game}: {ccu:grouped} playing {delta}, {serversLabel}, {status}",
				root: {
					type: "column",
					padding: { start: 14, top: 8, end: 8, bottom: 10 },
					children: [
						{
							type: "row",
							align: "center",
							children: [
								{ type: "text", text: "{game}", size: 13, fontWeight: "medium", color: "text", weight: 1 },
								{ type: "text", text: "{status}", size: 11, color: "text2", margin: { start: 6 } },
								{ type: "icon", name: "refresh", size: 18, padding: 5, color: "text2" },
							],
						},
						{
							type: "row",
							align: "baseline",
							padding: { end: 6 },
							children: [
								{ type: "text", text: "{ccu}", size: 26, fontWeight: "medium", color: "text" },
								{
									type: "text",
									text: "{delta}",
									size: 13,
									fontWeight: "bold",
									color: "delta",
									margin: { start: 6 },
									showIf: "delta",
								},
								{
									type: "text",
									text: "{serversLabel}",
									size: 12,
									color: "text2",
									align: "end",
									weight: 1,
									margin: { start: 6 },
								},
							],
						},
						{
							type: "chart",
							bind: "series",
							minutes: 360,
							color: "brand",
							fill: true,
							weight: 1,
							margin: { top: 4, end: 6, bottom: 4 },
						},
						{
							type: "text",
							text: "Last hour: avg session {lastHour.avgSessionSeconds} · {lastHour.playtimeHours} played",
							size: 11,
							color: "text2",
							padding: { end: 6 },
						},
					],
				},
			},
			{
				// 2x1: game · updated time · refresh on top; CCU + delta left, servers and avg session stacked right.
				name: "small",
				minWidth: 0,
				minHeight: 0,
				refresh: "topEnd",
				description: "{game}: {ccu:grouped} playing {delta}, {serversLabel}, {status}",
				root: {
					type: "column",
					justify: "center",
					padding: { start: 12, top: 4, end: 6, bottom: 6 },
					children: [
						{
							type: "row",
							align: "center",
							children: [
								{ type: "text", text: "{game}", size: 12, color: "text2", weight: 1 },
								{ type: "text", text: "{status}", size: 10, color: "text2", margin: { start: 6 } },
								{ type: "icon", name: "refresh", size: 16, padding: 4, color: "text2" },
							],
						},
						{
							type: "row",
							align: "center",
							padding: { end: 6 },
							children: [
								{ type: "text", text: "{ccu}", size: 22, fontWeight: "medium", color: "text" },
								{
									type: "text",
									text: "{delta}",
									size: 12,
									fontWeight: "bold",
									color: "delta",
									margin: { start: 4 },
									showIf: "delta",
								},
								{
									type: "column",
									weight: 1,
									align: "end",
									margin: { start: 8 },
									children: [
										{ type: "text", text: "{serversLabel}", size: 11, color: "text", align: "end" },
										{
											type: "text",
											text: "avg {lastHour.avgSessionSeconds} (1 h)",
											size: 11,
											color: "text2",
											align: "end",
										},
									],
								},
							],
						},
					],
				},
			},
		],
		loading: message("Loading…", true),
		unreachable: message("Can't reach {backend|the backend}", true),
		signedOut: message("Open TypeTorch to sign in", false),
		pick: message("Tap to pick a game", false),
	},
};

/** What LiveSync sends (computed once). */
export const WIDGET_SPEC_JSON = JSON.stringify(WIDGET_SPEC);
