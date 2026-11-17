/**
 * Browser side of the widget preview (docs/widgets-preview.html, built by scripts/widgets/preview.ts): compiles the
 * widget HTML with the app's compiler and draws the resulting spec the way the native renderer lays it out (rows /
 * columns with weights, stacks with gravity, texts with coloured units, the CCU chart, icons), with sample data, at
 * the launcher's size classes, by day and by night. An approximation of the Android drawing (fonts and line heights
 * differ slightly), close enough to tune a design before trying it on a phone.
 */
import { compileWidgetHtml } from "../../src/features/live/widgets/compile";
import { DEFAULT_WIDGET_HTML } from "../../src/features/live/widgets/default-widget";
import type { ChartElement, Fill, SizeLayout, SvgElement, WidgetElement, WidgetSpec, WidgetState } from "../../src/features/live/widget-spec";

// ---------------------------------------------------------------------------------------------------------------------
// Sample data

/** A text segment: the text and its colour (a token name or a CSS colour); no colour = the element's. */
type Seg = { t: string; c?: string };
type Val = string | Seg[] | null;
type Sample = { label: string; values: Record<string, Val>; series: number[]; deltaUp: boolean };

const u = (t: string, c: string): Seg => ({ t, c });
const p = (t: string): Seg => ({ t });

function wave(from: number, to: number, wobble: number, seed: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < 360; i++) {
		const x = i / 359;
		const base = from + (to - from) * (x * x * 0.4 + x * 0.6);
		out.push(Math.max(0, Math.round(base + wobble * Math.sin(i / 17 + seed) + (wobble / 2) * Math.sin(i / 5.3 + seed * 2))));
	}
	return out;
}

const SAMPLES: Sample[] = [
	{
		label: "The Prison (up, four stats)",
		deltaUp: true,
		series: wave(150, 214, 9, 1),
		values: {
			game: "The Prison",
			backend: "Prison prod",
			"game.iconUrl": "sample",
			ccu: "214",
			delta: [u("▲12", "up")],
			servers: "31",
			serversLabel: "31 servers",
			peakToday: "260",
			updated: "12:04",
			status: "12:04",
			state: "fresh",
			"slot.1": "session:1h",
			"slot.1.label": "Session 1h",
			"slot.1.value": [p("18"), u("m", "unitTime"), p(" 40"), u("s", "unitTime")],
			"slot.1.value:short": [p("18"), u("m", "unitTime")],
			"slot.1.delta": [u("▲6%", "up")],
			"slot.2": "playtime:1h",
			"slot.2.label": "Played 1h",
			"slot.2.value": [p("1,240"), u(" h", "unitTime")],
			"slot.2.value:short": [p("1.2K"), u(" h", "unitTime")],
			"slot.2.delta": null,
			"slot.3": "d1",
			"slot.3.label": "D1 retention",
			"slot.3.value": [p("34.25"), u("%", "unitPercent")],
			"slot.3.value:short": [p("34"), u("%", "unitPercent")],
			"slot.3.delta": [u("▲1.12", "up")],
			"slot.4": "revenue:72h",
			"slot.4.label": "Revenue 72h",
			"slot.4.value": [u("R$", "unitRobux"), p("2,140")],
			"slot.4.value:short": [u("R$", "unitRobux"), p("2.1K")],
			"slot.4.delta": [u("▼9%", "down")],
		},
	},
	{
		label: "Zomvival (down)",
		deltaUp: false,
		series: wave(58, 37, 4, 3),
		values: {
			game: "Zomvival",
			backend: "Zomvival",
			"game.iconUrl": "sample",
			ccu: "37",
			delta: [u("▼5", "down")],
			servers: "6",
			serversLabel: "6 servers",
			peakToday: "58",
			updated: "9:41",
			status: "refreshing…",
			state: "refreshing",
			"slot.1": "session:1h",
			"slot.1.label": "Session 1h",
			"slot.1.value": [p("7"), u("m", "unitTime"), p(" 12"), u("s", "unitTime")],
			"slot.1.value:short": [p("7"), u("m", "unitTime")],
			"slot.1.delta": [u("▼14%", "down")],
			"slot.2": "playtime:1h",
			"slot.2.label": "Played 1h",
			"slot.2.value": [p("96"), u(" h", "unitTime")],
			"slot.2.value:short": [p("96"), u(" h", "unitTime")],
			"slot.2.delta": [u("±0%", "text2")],
			"slot.3": "d1",
			"slot.3.label": "D1",
			"slot.3.value": [p("18.90"), u("%", "unitPercent")],
			"slot.3.value:short": [p("19"), u("%", "unitPercent")],
			"slot.3.delta": [u("▼2.40", "down")],
			"slot.4": "revenue:72h",
			"slot.4.label": "Revenue 72h",
			"slot.4.value": [u("R$", "unitRobux"), p("312")],
			"slot.4.value:short": [u("R$", "unitRobux"), p("312")],
			"slot.4.delta": [u("▲22%", "up")],
		},
	},
	{
		label: "Sparse (offline, two slots, no icon, no line)",
		deltaUp: true,
		series: [],
		values: {
			game: "A very long game name that does not fit anywhere",
			backend: "staging",
			"game.iconUrl": null,
			ccu: "0",
			delta: null,
			servers: null,
			serversLabel: null,
			peakToday: "3",
			updated: "11:20",
			status: "offline · 11:20",
			state: "offline",
			"slot.1": "dau",
			"slot.1.label": "DAU",
			"slot.1.value": [p("1,830")],
			"slot.1.value:short": [p("1.8K")],
			"slot.1.delta": null,
			"slot.2": "mystery",
			"slot.2.label": "Mystery",
			"slot.2.value": [p("—")],
			"slot.2.value:short": [p("—")],
			"slot.2.delta": null,
			"slot.3": null,
			"slot.4": null,
		},
	},
];

// ---------------------------------------------------------------------------------------------------------------------
// Colours

type Mode = "day" | "night";
const BASE: Record<Mode, Record<string, string>> = {
	day: {
		bg: "#F7FFFFFF",
		text: "#FF1B1B1F",
		text2: "#FF5F6368",
		brand: "#FFFB7A32",
		up: "#FF2E9D57",
		down: "#FFD64545",
		divider: "#1F000000",
		unitTime: "#FFE2700F",
		unitPercent: "#FF1F6FD1",
		unitRobux: "#FF1F8A4C",
	},
	night: {
		bg: "#F21E1E22",
		text: "#FFECECEE",
		text2: "#FFA8A8AD",
		brand: "#FFFB7A32",
		up: "#FF4CC27A",
		down: "#FFF06A6A",
		divider: "#33FFFFFF",
		unitTime: "#FFFB923C",
		unitPercent: "#FF5AA9FF",
		unitRobux: "#FF4CC27A",
	},
};

/** "#AARRGGBB" / "#RRGGBB" → CSS rgba(). */
function argb(hex: string): string {
	const h = hex.replace("#", "");
	const a = h.length === 8 ? Number.parseInt(h.slice(0, 2), 16) / 255 : 1;
	const rgb = h.length === 8 ? h.slice(2) : h;
	const n = (i: number) => Number.parseInt(rgb.slice(i, i + 2), 16);
	return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${Math.round(a * 1000) / 1000})`;
}

class Ctx {
	tokens: Record<string, string>;
	constructor(
		spec: WidgetSpec,
		readonly mode: Mode,
		readonly sample: Sample,
	) {
		this.tokens = { ...BASE[mode] };
		for (const [k, v] of Object.entries(spec.tokens?.[mode] ?? {})) if (v) this.tokens[k] = v;
	}
	color(c: string | undefined, fallback: string): string {
		const name = c ?? fallback;
		if (name === "transparent") return "transparent";
		if (name === "delta") return this.color(this.sample.deltaUp ? "up" : "down", "up");
		if (name.startsWith("#")) return argb(name);
		const t = this.tokens[name];
		return t ? argb(t) : "magenta";
	}
	has(name: string): boolean {
		if (name === "series") return this.sample.series.length > 0;
		const v = this.sample.values[name];
		return v != null && (typeof v === "string" ? v !== "" : v.some((s) => s.t !== ""));
	}
	showIf(cond: string | undefined): boolean {
		if (!cond) return true;
		return cond.startsWith("!") ? !this.has(cond.slice(1)) : this.has(cond);
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Templates

const FORMATS = new Set(["count", "grouped", "delta", "duration", "hours", "raw", "seconds", "percent", "robux", "unit", "short", "plain"]);
const TEXTY = /^(game|backend|status|updated|state|serversLabel|slot\.\d|slot\.\d\.label)$/;

/** Fills a text template: `{name}`, `{name:format}`, `{name|fallback}`, `{{` / `}}`. */
function fill(template: string, ctx: Ctx, plain = false): Seg[] {
	const out: Seg[] = [];
	let lit = "";
	for (let i = 0; i < template.length; i++) {
		const c = template[i];
		if ((c === "{" || c === "}") && template[i + 1] === c) {
			lit += c;
			i++;
			continue;
		}
		if (c !== "{") {
			lit += c;
			continue;
		}
		const end = template.indexOf("}", i);
		if (end < 0) {
			lit += template.slice(i);
			break;
		}
		const inner = template.slice(i + 1, end);
		i = end;
		const bar = inner.indexOf("|");
		const key = bar < 0 ? inner : inner.slice(0, bar);
		const fallback = bar < 0 ? null : inner.slice(bar + 1);
		const colon = key.lastIndexOf(":");
		const fmt = colon > 0 && FORMATS.has(key.slice(colon + 1)) ? key.slice(colon + 1) : null;
		const name = fmt ? key.slice(0, colon) : key;
		const v = (fmt ? ctx.sample.values[`${name}:${fmt}`] : undefined) ?? ctx.sample.values[name] ?? null;
		const missing = v == null || (typeof v === "string" ? v === "" : v.every((s) => !s.t));
		if (lit) out.push({ t: lit });
		lit = "";
		if (missing) {
			if (fallback != null) out.push({ t: fallback });
			else if (!/delta$/.test(name) && !TEXTY.test(name)) out.push({ t: "—" });
		} else if (typeof v === "string") out.push({ t: v });
		else out.push(...(plain || fmt === "plain" ? v.map((s) => ({ t: s.t })) : v));
	}
	if (lit) out.push({ t: lit });
	return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout → DOM

const ICON_PATHS: Record<string, string> = {
	refresh: "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
	flame: "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z",
	people: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
	server: "M4 3h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm0 10h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zm3-7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
	clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FLEX: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };

function edges(v: WidgetElement["padding"]): string {
	if (v == null) return "0";
	if (typeof v === "number") return `${v}px`;
	const top = v.top ?? v.vertical ?? 0;
	const bottom = v.bottom ?? v.vertical ?? 0;
	const start = v.start ?? v.horizontal ?? 0;
	const end = v.end ?? v.horizontal ?? 0;
	return `${top}px ${end}px ${bottom}px ${start}px`;
}

function background(f: Fill | undefined, ctx: Ctx, systemRadius: number): string {
	if (f == null) return "";
	const color = typeof f === "string" ? f : f.color;
	const radius = typeof f === "string" ? 0 : f.radius === "system" ? systemRadius : (f.radius ?? 0);
	return `background:${ctx.color(color, "bg")};border-radius:${radius}px;`;
}

type Parent = "row" | "column" | "stack";
const GRAVITY: Record<string, [string, string]> = {
	topStart: ["start", "start"],
	top: ["start", "center"],
	topEnd: ["start", "end"],
	start: ["center", "start"],
	center: ["center", "center"],
	end: ["center", "end"],
	bottomStart: ["end", "start"],
	bottom: ["end", "center"],
	bottomEnd: ["end", "end"],
	fill: ["stretch", "stretch"],
};

function render(e: WidgetElement, parent: Parent, ctx: Ctx): HTMLElement | null {
	if (!ctx.showIf(e.showIf)) return null;
	const el = document.createElement("div");
	let css = `box-sizing:border-box;padding:${edges(e.padding)};margin:${edges(e.margin)};${background(e.background, ctx, 16)}`;
	const weight = e.weight ?? (e.type === "chart" && e.height == null ? 1 : 0);
	if (weight > 0 && parent !== "stack") css += `flex:${weight} 1 0px;min-width:0;min-height:0;`;
	else css += e.type === "text" ? "flex:0 1 auto;min-width:0;" : "flex:0 0 auto;";
	// The native layout measures a column's children at most as wide as the column (also when aligned start / end).
	if (parent === "column" && e.width == null) css += "max-width:100%;";
	if (e.width != null) css += `width:${e.width}px;`;
	if (e.height != null) css += `height:${e.height}px;`;
	if (parent === "stack") {
		const [v, h] = GRAVITY[e.gravity ?? "topStart"] ?? GRAVITY.topStart;
		css += `grid-area:1/1;align-self:${v};justify-self:${h};`;
	} else if (e.alignSelf) css += `align-self:${FLEX[e.alignSelf]};`;

	switch (e.type) {
		case "row":
		case "column":
		case "stack": {
			if (e.type === "stack") css += "display:grid;grid-template:1fr/1fr;";
			else {
				const align = e.align ?? (e.type === "row" ? "center" : "stretch");
				css += `display:flex;flex-direction:${e.type};align-items:${FLEX[align]};gap:${e.gap ?? 0}px;`;
				if (e.justify) css += `justify-content:${e.justify === "spaceBetween" ? "space-between" : FLEX[e.justify]};`;
			}
			for (const c of e.children) {
				const k = render(c, e.type, ctx);
				if (k) el.appendChild(k);
			}
			break;
		}
		case "text": {
			const segs = fill(e.text, ctx);
			if (!segs.some((s) => s.t.trim())) return null;
			const lines = e.maxLines ?? 1;
			const fw = typeof e.fontWeight === "number" ? e.fontWeight : { normal: 400, medium: 500, semibold: 600, bold: 700 }[e.fontWeight ?? "normal"];
			css += `font-size:${e.size ?? 12}px;font-weight:${fw};color:${ctx.color(e.color, "text")};text-align:${
				e.align === "end" ? "right" : (e.align ?? "left")
			};line-height:1.17;overflow:hidden;`;
			css +=
				lines === 1
					? `white-space:pre;text-overflow:${e.ellipsis === false ? "clip" : "ellipsis"};`
					: `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};white-space:pre-wrap;`;
			el.innerHTML = segs.map((s) => (s.c ? `<span style="color:${ctx.color(s.c, "text")}">${esc(s.t)}</span>` : esc(s.t))).join("");
			break;
		}
		case "spacer": {
			if (e.size) css += parent === "row" ? `width:${e.size}px;` : `height:${e.size}px;`;
			break;
		}
		case "divider": {
			const t = e.thickness ?? 1;
			css += `background:${ctx.color(e.color, "divider")};align-self:stretch;` + (parent === "row" ? `width:${t}px;` : `height:${t}px;`);
			break;
		}
		case "icon": {
			const s = e.size ?? 16;
			const path = ICON_PATHS[e.name];
			el.innerHTML = path
				? `<svg viewBox="0 0 24 24" width="${s}" height="${s}" style="display:block"><path d="${path}" fill="${ctx.color(e.color, "text2")}"/></svg>`
				: "";
			break;
		}
		case "image": {
			const w = e.width ?? e.size ?? 22;
			const h = e.height ?? e.size ?? 22;
			const r = e.radius ?? 6;
			const has = ctx.has(e.bind ?? "game.iconUrl");
			const ph = e.placeholder === null ? "transparent" : ctx.color(e.placeholder, "divider");
			const initials = String(ctx.sample.values.game ?? "?")
				.split(/\s+/)
				.slice(0, 2)
				.map((x) => x[0])
				.join("");
			css += `width:${w}px;height:${h}px;border-radius:${r}px;overflow:hidden;`;
			el.innerHTML = has
				? `<div style="width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(135deg,#5b6b7f,#2b3340);color:#fff;font:700 ${Math.round(
						Math.min(w, h) * 0.42,
					)}px/1 sans-serif">${esc(initials)}</div>`
				: `<div style="width:100%;height:100%;background:${ph}"></div>`;
			break;
		}
		case "chart":
			el.dataset.chart = JSON.stringify(e);
			break;
		case "svg":
			el.dataset.svg = JSON.stringify(e);
			break;
		default:
			return null;
	}
	el.setAttribute("style", css);
	return el;
}

// ---------------------------------------------------------------------------------------------------------------------
// Chart

function compact(n: number): string {
	if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
	if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
	if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
	return String(Math.round(n));
}

function niceCeil(x: number): number {
	if (x <= 0) return 1;
	const p = 10 ** Math.floor(Math.log10(x));
	for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x) return m * p;
	return 10 * p;
}

type ChartOpts = { minutes: number; bucket: number; zero: boolean; smooth: boolean };

/** The series as points in a w × h box, plus the axis values. */
function chartPoints(series: number[], o: ChartOpts, w: number, h: number) {
	let pts = series.slice(-o.minutes);
	if (o.bucket > 1 && pts.length) {
		const out: number[] = [];
		for (let end = pts.length; end > 0; end -= o.bucket) {
			const part = pts.slice(Math.max(0, end - o.bucket), end);
			out.unshift(part.reduce((a, b) => a + b, 0) / part.length);
		}
		pts = out;
	}
	const hi = pts.length ? Math.max(...pts) : 0;
	const lo = pts.length ? Math.min(...pts) : 0;
	const max = o.zero ? niceCeil(hi) : hi === lo ? hi + 1 : hi;
	const min = o.zero ? 0 : hi === lo ? lo - 1 : lo;
	const xy = pts.map((v, i) => [pts.length === 1 ? w : (i / (pts.length - 1)) * w, h - ((v - min) / (max - min)) * h] as const);
	return { xy, max, min, mid: (max + min) / 2 };
}

function pathOf(xy: readonly (readonly [number, number])[], smooth: boolean): string {
	if (!xy.length) return "";
	const f = (n: number) => Math.round(n * 100) / 100;
	let d = `M${f(xy[0][0])},${f(xy[0][1])}`;
	for (let i = 1; i < xy.length; i++) {
		if (!smooth) {
			d += ` L${f(xy[i][0])},${f(xy[i][1])}`;
			continue;
		}
		// Catmull-Rom as cubic Béziers.
		const p0 = xy[i - 2] ?? xy[i - 1];
		const p1 = xy[i - 1];
		const p2 = xy[i];
		const p3 = xy[i + 1] ?? p2;
		const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
		const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
		d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
	}
	return d;
}

function drawChart(host: HTMLElement, e: ChartElement, ctx: Ctx) {
	const r = host.getBoundingClientRect();
	const scale = host.offsetWidth ? r.width / host.offsetWidth : 1;
	const W = r.width / scale;
	const H = r.height / scale;
	if (W < 2 || H < 2 || !ctx.sample.series.length) return;
	const stroke = e.stroke ?? 2;
	const color = ctx.color(e.color, "brand");
	const o: ChartOpts = { minutes: e.minutes ?? 360, bucket: e.bucket ?? 5, zero: e.zero ?? true, smooth: e.smooth ?? true };
	const labels = e.labels ?? true;
	const pad = stroke + 1;
	const font = 8;
	const first = chartPoints(ctx.sample.series, o, 1, 1);
	const labelW = labels ? Math.max(compact(first.max).length, compact(first.mid).length) * font * 0.62 + 4 : 0;
	const w = W - labelW - pad;
	const h = H - pad * 2;
	const { xy, max, mid } = chartPoints(ctx.sample.series, o, w, h);
	const pts = xy.map(([x, y]) => [x + labelW, y + pad] as const);
	const line = pathOf(pts, o.smooth);
	const last = pts[pts.length - 1];
	const id = `g${Math.random().toString(36).slice(2)}`;
	const fillColor = e.fill === false ? null : typeof e.fill === "string" ? ctx.color(e.fill, "brand") : color;
	let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">`;
	if (fillColor) {
		svg += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fillColor}" stop-opacity=".32"/><stop offset="1" stop-color="${fillColor}" stop-opacity="0"/></linearGradient></defs>`;
	}
	if (labels) {
		const grid = ctx.color("divider", "divider");
		const text = ctx.color("text2", "text2");
		for (const [v, y] of [
			[max, pad],
			[mid, pad + h / 2],
		] as const) {
			svg += `<line x1="${labelW}" y1="${y}" x2="${W}" y2="${y}" stroke="${grid}" stroke-width="1" stroke-dasharray="2 3"/>`;
			svg += `<text x="0" y="${y + font * 0.35}" font-size="${font}" fill="${text}" font-family="inherit">${compact(v)}</text>`;
		}
	}
	if (fillColor) svg += `<path d="${line} L${last[0]},${H} L${pts[0][0]},${H} Z" fill="url(#${id})"/>`;
	svg += `<path d="${line}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`;
	if (e.dot ?? true) svg += `<circle cx="${last[0]}" cy="${last[1]}" r="${stroke * 1.6}" fill="${color}"/>`;
	host.innerHTML = `${svg}</svg>`;
}

/** The `svg` element: its template filled ({w}, {h}, bindings, chart helpers, var(--token)). */
function drawSvg(host: HTMLElement, e: SvgElement, ctx: Ctx) {
	const W = host.offsetWidth;
	const H = host.offsetHeight;
	const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
	let s = e.svg.replace(/\{(chart\.\w+):([^}]*)\}/g, (_m, what: string, args: string) => {
		const a = args.split(",").map((x) => Number(x.trim()));
		const [w, h, minutes = 360, bucket = 5, zero = 1, smooth = 1] = a;
		const c = chartPoints(ctx.sample.series, { minutes, bucket, zero: !!zero, smooth: !!smooth }, w, h);
		const last = c.xy[c.xy.length - 1] ?? [0, h];
		switch (what) {
			case "chart.path":
				return pathOf(c.xy, !!smooth);
			case "chart.area":
				return c.xy.length ? `${pathOf(c.xy, !!smooth)} L${last[0]},${h} L${c.xy[0][0]},${h} Z` : "";
			case "chart.max":
				return compact(c.max);
			case "chart.mid":
				return compact(c.mid);
			case "chart.min":
				return compact(c.min);
			case "chart.lastX":
				return String(last[0]);
			case "chart.lastY":
				return String(last[1]);
			default:
				return "";
		}
	});
	s = s.replace(/\{w\}/g, String(W)).replace(/\{h\}/g, String(H));
	s = s.replace(/\{(slot\.\d)\.(number|unit|unitToken)\}/g, (_m, slot: string, part: string) => {
		const v = ctx.sample.values[`${slot}.value`];
		const segs = Array.isArray(v) ? v : [];
		if (part === "number") return xml(segs.filter((x) => !x.c).map((x) => x.t).join("").trim());
		const unit = segs.find((x) => x.c);
		return xml(part === "unit" ? (unit?.t.trim() ?? "") : (unit?.c ?? ""));
	});
	s = s.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (m) => xml(fill(m, ctx, true).map((x) => x.t).join("")));
	s = s.replace(/var\(\s*--([\w-]+)\s*\)/g, (_m, t: string) => ctx.color(t, "text"));
	host.innerHTML = s;
	const svg = host.querySelector("svg");
	if (svg) {
		svg.setAttribute("width", "100%");
		svg.setAttribute("height", "100%");
		svg.style.display = "block";
		svg.setAttribute("preserveAspectRatio", e.fit === "contain" ? "xMidYMid meet" : e.fit === "cover" ? "xMidYMid slice" : "none");
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Widgets

/** The renderer's pick: of the layouts whose minimums fit, the largest minWidth × minHeight; none fits: the smallest. */
function pick(list: SizeLayout[], w: number, h: number): SizeLayout | undefined {
	const fits = list.filter((l) => l.minWidth <= w && l.minHeight <= h);
	const area = (l: SizeLayout) => l.minWidth * l.minHeight;
	if (fits.length) return fits.reduce((a, b) => (area(b) > area(a) ? b : a));
	return list.reduce<SizeLayout | undefined>((a, b) => (!a || area(b) < area(a) ? b : a), undefined);
}

const SYSTEM_RADIUS = 22;

function widget(spec: WidgetSpec, state: WidgetState, w: number, h: number, mode: Mode, sample: Sample, hit: boolean): HTMLElement {
	const ctx = new Ctx(spec, mode, sample);
	const box = document.createElement("div");
	box.className = "widget";
	const layout = pick(spec.layouts[state] ?? [], w, h);
	const bg = layout?.background ?? { color: "bg", radius: "system" as const };
	box.setAttribute(
		"style",
		`width:${w}px;height:${h}px;position:relative;overflow:hidden;display:flex;flex-direction:column;${background(bg, ctx, SYSTEM_RADIUS)}`,
	);
	box.title = layout ? `${state} · ${layout.name ?? "unnamed"} (from ${layout.minWidth}×${layout.minHeight})` : `${state}: no layout`;
	if (layout) {
		const root = render(layout.root, "column", ctx);
		if (root) {
			root.style.flex = "1 1 0px";
			root.style.minHeight = "0";
			box.appendChild(root);
		}
		const corner = state === "signedOut" || state === "pick" ? "none" : (layout.refresh ?? "topEnd");
		if (hit && corner !== "none") {
			const a = document.createElement("div");
			const v = corner.startsWith("top") ? "top:0" : "bottom:0";
			const s = corner.endsWith("End") ? "right:0" : "left:0";
			a.setAttribute("style", `position:absolute;${v};${s};width:36px;height:36px;outline:1px dashed rgba(255,0,128,.8);outline-offset:-1px;pointer-events:none`);
			box.appendChild(a);
		}
	}
	(box as HTMLElement & { _ctx?: Ctx })._ctx = ctx;
	return box;
}

/** Second pass, after layout: charts and SVGs need their box size. */
function paint(container: HTMLElement) {
	for (const box of container.querySelectorAll<HTMLElement>(".widget")) {
		const ctx = (box as HTMLElement & { _ctx?: Ctx })._ctx;
		if (!ctx) continue;
		for (const c of box.querySelectorAll<HTMLElement>("[data-chart]")) drawChart(c, JSON.parse(c.dataset.chart ?? "{}") as ChartElement, ctx);
		for (const c of box.querySelectorAll<HTMLElement>("[data-svg]")) drawSvg(c, JSON.parse(c.dataset.svg ?? "{}") as SvgElement, ctx);
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Page

const SIZES: { label: string; w: number; h: number }[] = [
	{ label: "4×2", w: 330, h: 160 },
	{ label: "4×1", w: 330, h: 78 },
	{ label: "2×2", w: 168, h: 156 },
	{ label: "2×1", w: 200, h: 78 },
	{ label: "2×1 tall", w: 168, h: 96 },
	{ label: "2×1 short", w: 168, h: 64 },
];
const MESSAGE_STATES: WidgetState[] = ["loading", "unreachable", "signedOut", "pick"];

function load(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function save(key: string, v: string | null) {
	try {
		if (v == null) localStorage.removeItem(key);
		else localStorage.setItem(key, v);
	} catch {
		// private window: no memory
	}
}

export function mount(app: HTMLElement) {
	const $ = <T extends HTMLElement>(sel: string) => app.querySelector(sel) as T;
	const source = $<HTMLTextAreaElement>("#source");
	const sampleSel = $<HTMLSelectElement>("#sample");
	const hit = $<HTMLInputElement>("#hit");
	const zoom = $<HTMLSelectElement>("#zoom");
	const customW = $<HTMLInputElement>("#cw");
	const customH = $<HTMLInputElement>("#ch");
	const out = $<HTMLElement>("#out");
	const warn = $<HTMLElement>("#warnings");
	const json = $<HTMLElement>("#json");

	SAMPLES.forEach((s, i) => sampleSel.add(new Option(s.label, String(i))));
	const edited = load("tt-widget-html");
	source.value = edited ?? DEFAULT_WIDGET_HTML.trim();
	$<HTMLElement>("#edited").hidden = edited == null;

	let spec: WidgetSpec | null = null;
	const draw = () => {
		const r = compileWidgetHtml(source.value);
		spec = r.spec;
		warn.innerHTML = r.warnings.length
			? `<b>${r.warnings.length} warning(s)</b><ul>${r.warnings.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
			: "No warnings.";
		warn.className = r.warnings.length ? "warn bad" : "warn ok";
		json.textContent = JSON.stringify(r.spec, null, 2);
		const sample = SAMPLES[Number(sampleSel.value) || 0];
		const sizes = [...SIZES];
		const cw = Number(customW.value);
		const ch = Number(customH.value);
		if (cw > 0 && ch > 0) sizes.push({ label: "custom", w: cw, h: ch });
		out.innerHTML = "";
		out.style.setProperty("zoom", zoom.value);
		for (const mode of ["day", "night"] as Mode[]) {
			const home = document.createElement("section");
			home.className = `home ${mode}`;
			home.innerHTML = `<h2>${mode === "day" ? "Day" : "Night"}</h2>`;
			const row = document.createElement("div");
			row.className = "row";
			for (const s of sizes) {
				const cell = document.createElement("figure");
				const wdg = widget(r.spec, "data", s.w, s.h, mode, sample, hit.checked);
				cell.appendChild(wdg);
				const cap = document.createElement("figcaption");
				cap.textContent = `${s.label} · ${s.w}×${s.h} dp · ${pick(r.spec.layouts.data, s.w, s.h)?.name ?? "—"}`;
				cell.appendChild(cap);
				row.appendChild(cell);
			}
			home.appendChild(row);
			const msgs = document.createElement("div");
			msgs.className = "row";
			for (const st of MESSAGE_STATES) {
				const cell = document.createElement("figure");
				cell.appendChild(widget(r.spec, st, 200, 78, mode, sample, hit.checked));
				const cap = document.createElement("figcaption");
				cap.textContent = st;
				cell.appendChild(cap);
				msgs.appendChild(cell);
			}
			home.appendChild(msgs);
			out.appendChild(home);
		}
		requestAnimationFrame(() => paint(out));
	};

	let t: ReturnType<typeof setTimeout> | undefined;
	source.addEventListener("input", () => {
		clearTimeout(t);
		t = setTimeout(() => {
			save("tt-widget-html", source.value);
			$<HTMLElement>("#edited").hidden = false;
			draw();
		}, 250);
	});
	for (const c of [sampleSel, hit, zoom, customW, customH]) c.addEventListener("input", draw);
	$<HTMLButtonElement>("#reset").addEventListener("click", () => {
		source.value = DEFAULT_WIDGET_HTML.trim();
		save("tt-widget-html", null);
		$<HTMLElement>("#edited").hidden = true;
		draw();
	});
	$<HTMLButtonElement>("#copy").addEventListener("click", () => {
		void navigator.clipboard?.writeText(source.value);
	});
	$<HTMLButtonElement>("#copyJson").addEventListener("click", () => {
		if (spec) void navigator.clipboard?.writeText(JSON.stringify(spec, null, 2));
	});
	draw();
}
