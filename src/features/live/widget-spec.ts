/**
 * The home-screen widget spec's types (docs/WIDGET_SPEC.md): the JSON the native module draws the widget from as one
 * bitmap. The app's widget itself is authored in HTML (`widgets/default.html.ts`, docs/WIDGET_HTML.md) and compiled to
 * this spec by `widgets/compile.ts`; LiveSync sends the result (`setWidgetSpec`), so a look change ships as an OTA
 * update (`eas update`) instead of a new APK. The native side keeps a built-in copy (WidgetSpec.kt, DEFAULT_JSON) for the
 * time before the app first sends one and for any spec it can't parse or draw: keep the two the same when you change the
 * default look (`bun scripts/widgets/check.ts --print` prints the compiled JSON).
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
	| `slot.${SlotNumber}.number` // svg only: the formatted number part of the value ("18m 40s" → "18", "34.2%" → "34.2")
	| `slot.${SlotNumber}.unit` // svg only: the unit part ("%", "R$")
	| `slot.${SlotNumber}.unitToken` // svg only: the unit's colour token name ("unitPercent")
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
	/** The value axis starts at 0 (else it fits the low and high values). Default true. */
	zero?: boolean;
	/** Points averaged into buckets of this many minutes (0 / 1: every point), 0..60. Default 5. */
	bucket?: number;
	/** A curve through the points instead of straight segments. Default true. */
	smooth?: boolean;
	/** Value labels and light grid lines (top and middle) on the left. Default true. */
	labels?: boolean;
};

/**
 * An SVG drawn by the renderer (docs/WIDGET_HTML.md: the supported SVG subset). `svg` is a template: `{binding}`
 * placeholders as in texts, plus `{w}` / `{h}` (the element's box in dp) and the chart helpers
 * (`{chart.path:W,H[,minutes][,bucket][,zero][,smooth]}`, `{chart.area:…}`, `{chart.max:…}`, `{chart.mid:…}`,
 * `{chart.min:…}`, `{chart.lastX:…}`, `{chart.lastY:…}`). Colours may be `var(--token)`.
 */
export type SvgElement = Common & {
	type: "svg";
	svg: string;
	/** fill (default): the viewBox stretched to the box; contain / cover: preserveAspectRatio meet / slice. */
	fit?: "fill" | "contain" | "cover";
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
	| ImageElement
	| SvgElement;

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

/** Colour token values ("#RRGGBB" / "#AARRGGBB"); names beyond the built-in ones add new tokens. */
export type TokenMap = Partial<Record<ColorToken, string>> & { [token: string]: string | undefined };

export type WidgetSpec = {
	version: number;
	/** Overrides of the built-in colour tokens, per mode. */
	tokens?: { day?: TokenMap; night?: TokenMap };
	/** Wording of the `status` binding; `offline` is a template ({updated} is the clock time). */
	strings?: { refreshing?: string; offline?: string };
	/** Number formatting. `ratioDecimals` (0..4, default 2): decimals of ratios as a percent and of their change in points. */
	format?: { ratioDecimals?: number };
	/** `data` is required; a missing state uses the built-in default's. */
	layouts: { data: SizeLayout[] } & Partial<Record<Exclude<WidgetState, "data">, SizeLayout[]>>;
};
