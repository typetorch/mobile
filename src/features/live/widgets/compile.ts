/**
 * Widget HTML → widget spec (docs/WIDGET_HTML.md, docs/WIDGET_SPEC.md). A small, dependency-free HTML tokenizer and
 * the CSS subset the native renderer can draw. Never throws: anything it can't map becomes a warning (with the line)
 * and is left out, so a typo degrades one element instead of the whole widget.
 */
import {
	WIDGET_SPEC_VERSION,
	type Color,
	type ContainerElement,
	type Edges,
	type Fill,
	type Gravity,
	type RefreshCorner,
	type SizeLayout,
	type TextElement,
	type TokenMap,
	type WidgetElement,
	type WidgetSpec,
	type WidgetState,
} from "../widget-spec";

export type CompileResult = { spec: WidgetSpec; warnings: string[] };

// ---------------------------------------------------------------------------------------------------------------------
// HTML tokenizer / tree

type HtmlElement = {
	kind: "el";
	tag: string;
	attrs: Record<string, string>;
	children: HtmlNode[];
	line: number;
	/** `<svg>…</svg>` verbatim (its children are not parsed). */
	raw?: string;
};
type HtmlText = { kind: "text"; text: string; line: number };
type HtmlNode = HtmlElement | HtmlText;

const VOID = new Set(["img", "hr", "br", "input", "meta", "link", "wbr", "source", "col", "area", "base", "embed"]);
const RAW_TEXT = new Set(["style", "script", "textarea", "title"]);

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	middot: "·",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	times: "×",
	uarr: "↑",
	darr: "↓",
	larr: "←",
	rarr: "→",
	bull: "•",
	deg: "°",
};

function decodeEntities(s: string): string {
	if (!s.includes("&")) return s;
	return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === "#") {
			const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

/** Parses [html] into a tree. Lenient like a browser: stray end tags are dropped, unclosed elements closed at the end. */
function parseHtml(html: string, warn: (line: number, msg: string) => void): HtmlElement {
	const lineStarts = [0];
	for (let i = 0; i < html.length; i++) if (html.charCodeAt(i) === 10) lineStarts.push(i + 1);
	const lineAt = (pos: number) => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= pos) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};

	const root: HtmlElement = { kind: "el", tag: "#root", attrs: {}, children: [], line: 1 };
	const stack: HtmlElement[] = [root];
	const top = () => stack[stack.length - 1];
	let i = 0;
	const n = html.length;

	const pushText = (from: number, to: number) => {
		if (to <= from) return;
		top().children.push({ kind: "text", text: decodeEntities(html.slice(from, to)), line: lineAt(from) });
	};

	while (i < n) {
		const lt = html.indexOf("<", i);
		if (lt < 0) {
			pushText(i, n);
			break;
		}
		pushText(i, lt);
		i = lt;
		const next = html[i + 1] ?? "";

		if (html.startsWith("<!--", i)) {
			const end = html.indexOf("-->", i + 4);
			if (end < 0) {
				warn(lineAt(i), "unclosed comment (<!-- without -->): the rest of the file is ignored");
				i = n;
			} else i = end + 3;
			continue;
		}
		if (next === "!" || next === "?") {
			const end = html.indexOf(">", i);
			i = end < 0 ? n : end + 1;
			continue;
		}
		if (next === "/") {
			const m = /^<\/\s*([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(i, i + 200));
			if (!m) {
				pushText(i, i + 1);
				i += 1;
				continue;
			}
			const tag = m[1].toLowerCase();
			const at = stack.map((e) => e.tag).lastIndexOf(tag);
			if (at <= 0) warn(lineAt(i), `stray </${tag}> ignored`);
			else {
				for (let k = stack.length - 1; k > at; k--) warn(stack[k].line, `<${stack[k].tag}> not closed before </${tag}>`);
				stack.length = at;
			}
			i += m[0].length;
			continue;
		}
		if (!/[a-zA-Z]/.test(next)) {
			// A lone "<" is text.
			pushText(i, i + 1);
			i += 1;
			continue;
		}

		// A start tag: name, attributes, ">" or "/>".
		const line = lineAt(i);
		let j = i + 1;
		while (j < n && /[\w:-]/.test(html[j])) j++;
		const tag = html.slice(i + 1, j).toLowerCase();
		const attrs: Record<string, string> = {};
		let selfClosing = false;
		let closed = false;
		while (j < n) {
			while (j < n && /\s/.test(html[j])) j++;
			if (html[j] === ">") {
				j++;
				closed = true;
				break;
			}
			if (html.startsWith("/>", j)) {
				j += 2;
				selfClosing = true;
				closed = true;
				break;
			}
			if (html[j] === "/") {
				j++;
				continue;
			}
			const nameStart = j;
			while (j < n && !/[\s=/>]/.test(html[j])) j++;
			const name = html.slice(nameStart, j).toLowerCase();
			while (j < n && /\s/.test(html[j])) j++;
			let value = "";
			if (html[j] === "=") {
				j++;
				while (j < n && /\s/.test(html[j])) j++;
				const q = html[j];
				if (q === '"' || q === "'") {
					const end = html.indexOf(q, j + 1);
					value = html.slice(j + 1, end < 0 ? n : end);
					j = end < 0 ? n : end + 1;
				} else {
					const vs = j;
					while (j < n && !/[\s>]/.test(html[j])) j++;
					value = html.slice(vs, j);
				}
			}
			if (name) {
				if (name in attrs) warn(line, `<${tag}>: attribute "${name}" given twice (the last one wins)`);
				attrs[name] = decodeEntities(value);
			}
		}
		if (!closed) warn(line, `<${tag}> start tag not closed with ">"`);
		const el: HtmlElement = { kind: "el", tag, attrs, children: [], line };

		if (tag === "svg") {
			// Kept verbatim up to the matching </svg> (nested <svg> counted).
			let depth = selfClosing ? 0 : 1;
			let k = j;
			const re = /<\s*(\/)?\s*svg\b[^>]*?(\/)?>/gi;
			re.lastIndex = j;
			while (depth > 0) {
				const m = re.exec(html);
				if (!m) {
					warn(line, "<svg> not closed with </svg>: the rest of the file is taken as the SVG");
					k = n;
					break;
				}
				if (m[1]) depth--;
				else if (!m[2]) depth++;
				k = m.index + m[0].length;
			}
			el.raw = html.slice(i, k);
			top().children.push(el);
			i = k;
			continue;
		}

		top().children.push(el);
		i = j;
		if (RAW_TEXT.has(tag)) {
			const end = html.toLowerCase().indexOf(`</${tag}`, i);
			const stop = end < 0 ? n : end;
			el.children.push({ kind: "text", text: html.slice(i, stop), line: lineAt(i) });
			const gt = end < 0 ? n : html.indexOf(">", end);
			i = gt < 0 ? n : gt + 1;
			continue;
		}
		if (!selfClosing && !VOID.has(tag)) stack.push(el);
	}
	for (let k = stack.length - 1; k > 0; k--) warn(stack[k].line, `<${stack[k].tag}> not closed`);
	return root;
}

// ---------------------------------------------------------------------------------------------------------------------
// CSS values

type Warn = (msg: string) => void;

/** An inline `style` attribute, with the properties read so far tracked so the rest can be reported. */
class Style {
	private props = new Map<string, string>();
	private used = new Set<string>();
	constructor(css: string | undefined) {
		if (!css) return;
		for (const decl of splitTop(css, ";")) {
			const c = decl.indexOf(":");
			if (c < 0) {
				if (decl.trim()) this.props.set(decl.trim().toLowerCase(), "");
				continue;
			}
			const name = decl.slice(0, c).trim();
			const value = decl
				.slice(c + 1)
				.replace(/!important\s*$/i, "")
				.trim();
			// Custom properties keep their case (token names are camelCase).
			this.props.set(name.startsWith("--") ? name : name.toLowerCase(), value);
		}
	}
	has(name: string) {
		return this.props.has(name);
	}
	get(name: string): string | undefined {
		if (!this.props.has(name)) return undefined;
		this.used.add(name);
		return this.props.get(name);
	}
	/** Marks properties as read without using them (accepted and ignored). */
	skip(...names: string[]) {
		for (const n of names) if (this.props.has(n)) this.used.add(n);
	}
	entries() {
		return [...this.props.entries()];
	}
	unused(): [string, string][] {
		return [...this.props.entries()].filter(([k]) => !this.used.has(k));
	}
}

/** Splits on [sep] outside parentheses and quotes. */
function splitTop(s: string, sep: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quote = "";
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === quote) quote = "";
		} else if (c === '"' || c === "'") quote = c;
		else if (c === "(") depth++;
		else if (c === ")") depth = Math.max(0, depth - 1);
		else if (c === sep && depth === 0) {
			out.push(s.slice(start, i));
			start = i + 1;
		}
	}
	out.push(s.slice(start));
	return out;
}

/** Splits a value on whitespace outside parentheses ("1px solid rgba(0, 0, 0, .1)" → 3 parts). */
function words(s: string): string[] {
	return splitTop(s.trim().replace(/\s+/g, " "), " ").filter(Boolean);
}

/** A length in dp: "12px", "12dp", "12sp", "12", "0". Anything else (%, em, auto) is undefined. */
function length(v: string | undefined): number | undefined {
	if (v == null) return undefined;
	const m = /^(-?(?:\d+\.?\d*|\.\d+))(px|dp|sp)?$/i.exec(v.trim());
	return m ? Number(m[1]) : undefined;
}

function num(v: string | undefined): number | undefined {
	if (v == null || v.trim() === "") return undefined;
	const x = Number(v.trim());
	return Number.isFinite(x) ? x : undefined;
}

const hex2 = (x: number) =>
	Math.max(0, Math.min(255, Math.round(x)))
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();

const NAMED_COLORS: Record<string, string> = { white: "#FFFFFFFF", black: "#FF000000" };

/** A literal CSS colour as the spec's "#AARRGGBB", or undefined. */
function literalColor(v: string): string | undefined {
	const s = v.trim().toLowerCase();
	if (NAMED_COLORS[s]) return NAMED_COLORS[s];
	let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
	if (m) {
		let h = m[1];
		if (h.length <= 4) h = [...h].map((c) => c + c).join("");
		const rgb = h.slice(0, 6).toUpperCase();
		const a = h.length === 8 ? h.slice(6).toUpperCase() : "FF";
		return `#${a}${rgb}`;
	}
	m = /^rgba?\((.*)\)$/.exec(s);
	if (m) {
		const parts = m[1].split(/[\s,/]+/).filter(Boolean);
		if (parts.length !== 3 && parts.length !== 4) return undefined;
		const ch = parts.slice(0, 3).map((p) => (p.endsWith("%") ? (Number(p.slice(0, -1)) * 255) / 100 : Number(p)));
		const alpha = parts[3] == null ? 1 : parts[3].endsWith("%") ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
		if (![...ch, alpha].every(Number.isFinite)) return undefined;
		return `#${hex2(alpha * 255)}${hex2(ch[0])}${hex2(ch[1])}${hex2(ch[2])}`;
	}
	return undefined;
}

/** A colour for an element: `var(--token)`, a literal, or `transparent`. */
function color(v: string | undefined, warn: Warn, what: string): Color | undefined {
	if (v == null) return undefined;
	const s = v.trim();
	const t = /^var\(\s*--([\w-]+)\s*(?:,.*)?\)$/.exec(s);
	if (t) return t[1] as Color;
	if (s.toLowerCase() === "transparent") return "transparent";
	const lit = literalColor(s);
	if (lit) return lit as Color;
	warn(`${what}: "${v}" is not a colour the widget knows (var(--token), #rgb[a], #rrggbb[aa], rgb(), rgba(), transparent)`);
	return undefined;
}

/** CSS box shorthand + longhands (padding / margin) → the spec's edges (start = left, end = right). */
function edges(style: Style, prop: "padding" | "margin", warn: Warn): Edges | undefined {
	const box = { top: 0, right: 0, bottom: 0, left: 0 };
	let any = false;
	const one = (v: string | undefined, name: string): number | undefined => {
		if (v == null) return undefined;
		const x = length(v);
		if (x == null) {
			warn(
				`${name}: "${v}" is not a length in px` +
					(v.trim() === "auto" ? " (auto margins aren't supported: use a spacer, an empty <div style=\"flex:1\">)" : ""),
			);
		}
		return x;
	};
	const short = style.get(prop);
	if (short != null) {
		const parts = words(short).map((p) => one(p, prop) ?? 0);
		if (parts.length >= 1 && parts.length <= 4) {
			const [t, r = t, b = t, l = r] = parts;
			Object.assign(box, { top: t, right: r, bottom: b, left: l });
			any = true;
		} else warn(`${prop}: "${short}" has more than four values`);
	}
	const pair = (name: string, a: "top" | "left", b: "bottom" | "right") => {
		const v = style.get(name);
		if (v == null) return;
		const parts = words(v).map((p) => one(p, name) ?? 0);
		box[a] = parts[0] ?? 0;
		box[b] = parts[1] ?? parts[0] ?? 0;
		any = true;
	};
	pair(`${prop}-block`, "top", "bottom");
	pair(`${prop}-inline`, "left", "right");
	const sides: [string, keyof typeof box][] = [
		["top", "top"],
		["right", "right"],
		["bottom", "bottom"],
		["left", "left"],
		["block-start", "top"],
		["block-end", "bottom"],
		["inline-start", "left"],
		["inline-end", "right"],
	];
	for (const [suffix, side] of sides) {
		const x = one(style.get(`${prop}-${suffix}`), `${prop}-${suffix}`);
		if (x != null) {
			box[side] = x;
			any = true;
		}
	}
	if (!any) return undefined;
	const { top, right, bottom, left } = box;
	if (top === right && right === bottom && bottom === left) return top === 0 ? undefined : top;
	const out: { top?: number; bottom?: number; start?: number; end?: number } = {};
	if (top) out.top = top;
	if (bottom) out.bottom = bottom;
	if (left) out.start = left;
	if (right) out.end = right;
	return out;
}

const FONT_WEIGHTS: Record<string, TextElement["fontWeight"]> = {
	normal: "normal",
	"400": "normal",
	"500": "medium",
	medium: "medium",
	"600": "semibold",
	semibold: "semibold",
	"700": "bold",
	bold: "bold",
};

function fontWeight(v: string | undefined, warn: Warn): TextElement["fontWeight"] | undefined {
	if (v == null) return undefined;
	const s = v.trim().toLowerCase();
	if (FONT_WEIGHTS[s]) return FONT_WEIGHTS[s];
	const x = num(s);
	if (x != null && x >= 100 && x <= 900) return x;
	warn(`font-weight: "${v}" (use 100..900, normal or bold)`);
	return undefined;
}

/** flex-start / start / self-start / left / top → start, etc. */
function axisValue(v: string | undefined): "start" | "center" | "end" | "stretch" | "baseline" | undefined {
	if (v == null) return undefined;
	const s = v.trim().toLowerCase().replace(/^(safe|unsafe)\s+/, "");
	if (["flex-start", "start", "self-start", "left", "top", "normal"].includes(s)) return "start";
	if (["flex-end", "end", "self-end", "right", "bottom"].includes(s)) return "end";
	if (s === "center") return "center";
	if (s === "stretch") return "stretch";
	if (s === "baseline" || s === "first baseline") return "baseline";
	return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Elements

/** Inherited text style (CSS inheritance: a container's color / font-size / font-weight / text-align reach its texts). */
type Inherit = { color?: Color; size?: number; fontWeight?: TextElement["fontWeight"]; align?: TextElement["align"] };

type Parent = "row" | "column" | "stack";

const ICONS = new Set(["flame", "refresh", "people", "server", "clock"]);
const STATES: WidgetState[] = ["data", "loading", "unreachable", "signedOut", "pick"];
const CORNERS: RefreshCorner[] = ["topEnd", "topStart", "bottomEnd", "bottomStart", "none"];
/** Accepted and ignored without a warning (layout hints a browser needs and the renderer doesn't). */
const QUIET = new Set([
	"overflow",
	"overflow-x",
	"overflow-y",
	"min-width",
	"min-height",
	"box-sizing",
	"display",
	"-webkit-box-orient",
	"flex-shrink",
	"flex-basis",
	"text-overflow",
	"white-space",
	"word-break",
	"overflow-wrap",
]);
/** Inline elements whose text is taken into the surrounding text (their own styling is not). */
const INLINE = new Set(["b", "strong", "i", "em", "small", "u", "s", "sup", "sub", "mark", "code", "a", "label", "span"]);

class Compiler {
	warnings: string[] = [];
	nodes = 0;

	warnAt(line: number, msg: string) {
		this.warnings.push(`line ${line}: ${msg}`);
	}

	private reportUnused(el: HtmlElement, style: Style) {
		for (const [k, v] of style.unused()) {
			if (QUIET.has(k)) continue;
			this.warnAt(el.line, `<${el.tag}>: unsupported CSS "${k}: ${v}" ignored`);
		}
	}

	private reportAttrs(el: HtmlElement, known: string[]) {
		for (const k of Object.keys(el.attrs)) {
			if (k === "style" || k === "data-show-if" || k === "data-tap" || k === "class" || k === "id" || k === "title" || known.includes(k)) continue;
			this.warnAt(el.line, `<${el.tag}>: unknown attribute "${k}" ignored`);
		}
		if (el.attrs.class != null) this.warnAt(el.line, `<${el.tag}>: class="…" has no effect (only inline style is read)`);
	}

	/** The fields every element takes (Common), read from [style] after the element's own ones. */
	private common(el: HtmlElement, style: Style, parent: Parent | null, out: Record<string, unknown>) {
		const w: Warn = (m) => this.warnAt(el.line, `<${el.tag}> ${m}`);
		const flex = style.get("flex");
		if (flex != null) {
			const first = words(flex)[0]?.toLowerCase();
			const x = num(first);
			if (x != null) {
				if (x > 0) out.weight = x;
			} else if (first !== "none" && first !== "initial" && first !== "0") w(`flex: "${flex}" (use a number: flex: 1)`);
		}
		const grow = num(style.get("flex-grow"));
		if (grow != null && grow > 0) out.weight = grow;

		if (out.width === undefined) {
			const v = style.get("width");
			const x = length(v);
			if (v != null && x == null) w(`width: "${v}" (only px; use flex: 1 to fill)`);
			if (x != null) out.width = x;
		}
		if (out.height === undefined) {
			const v = style.get("height");
			const x = length(v);
			if (v != null && x == null) w(`height: "${v}" (only px; use flex: 1 to fill)`);
			if (x != null) out.height = x;
		}
		const padding = edges(style, "padding", w);
		if (padding !== undefined) out.padding = padding;
		const margin = edges(style, "margin", w);
		if (margin !== undefined) out.margin = margin;

		// Placement: align-self in a row/column; align-self / justify-self / place-self (→ gravity) in a stack.
		let alignSelf = style.get("align-self");
		let justifySelf = style.get("justify-self");
		const place = style.get("place-self");
		if (place != null) {
			const p = words(place);
			alignSelf = p[0];
			justifySelf = p[1] ?? p[0];
		}
		if (parent === "stack") {
			if (alignSelf != null || justifySelf != null) {
				const v = alignSelf == null ? "start" : axisValue(alignSelf);
				const h = justifySelf == null ? "start" : axisValue(justifySelf);
				const g = v && h ? gravity(v, h) : undefined;
				if (g) {
					if (g !== "topStart") out.gravity = g;
				} else w(`place-self: "${alignSelf ?? ""} ${justifySelf ?? ""}" (use start / center / end, or stretch on both)`);
			}
		} else {
			if (alignSelf != null) {
				const a = axisValue(alignSelf);
				if (a && a !== "baseline") out.alignSelf = a;
				else w(`align-self: "${alignSelf}" (start, center, end or stretch)`);
			}
			if (justifySelf != null || place != null) w("justify-self / place-self only place children of a stack (display: grid)");
		}

		if (out.background === undefined) {
			const bg = style.get("background") ?? style.get("background-color");
			const radius = style.get("border-radius");
			if (bg != null) {
				const c = color(bg, w, "background");
				if (c) {
					const r = radius == null ? undefined : radius.trim() === "system" ? "system" : length(radius);
					if (radius != null && r == null) w(`border-radius: "${radius}" (px or system)`);
					out.background = r == null ? c : ({ color: c, radius: r } satisfies Fill);
				}
			} else if (radius != null) w("border-radius without a background has no effect");
		}

		const showIf = el.attrs["data-show-if"];
		if (showIf != null && showIf.trim()) out.showIf = showIf.trim();

		const tap = el.attrs["data-tap"];
		if (tap != null) {
			const t = tap.trim();
			// action:<anything>: the widget program's tap (docs/WIDGET_PROGRAM.md; `{bindings}` in it allowed).
			if (/^(open|refresh|toggle:games\.\d{1,2}|action:\S{1,200})$/.test(t)) out.tap = t;
			else w(`data-tap="${tap}" (open, refresh, toggle:games.N or action:…): left out`);
		}
	}

	/** Inherited properties read from a container's style. */
	private inherit(el: HtmlElement, style: Style, from: Inherit): Inherit {
		const w: Warn = (m) => this.warnAt(el.line, `<${el.tag}> ${m}`);
		const next = { ...from };
		const c = color(style.get("color"), w, "color");
		if (c) next.color = c;
		const size = style.get("font-size");
		if (size != null) {
			const x = length(size);
			if (x == null) w(`font-size: "${size}" (px)`);
			else next.size = x;
		}
		const fw = fontWeight(style.get("font-weight"), w);
		if (fw != null) next.fontWeight = fw;
		const ta = style.get("text-align");
		if (ta != null) {
			const a = axisValue(ta);
			if (a === "start" || a === "center" || a === "end") next.align = a;
			else w(`text-align: "${ta}" (left, center or right)`);
		}
		return next;
	}

	element(node: HtmlElement, parent: Parent | null, inh: Inherit, depth: number): WidgetElement | null {
		if (depth > 24) {
			this.warnAt(node.line, `<${node.tag}> nested too deep (the renderer allows 24 levels): left out`);
			return null;
		}
		const style = new Style(node.attrs.style);
		const disp = style.has("display") ? style.get("display")?.trim().toLowerCase() : undefined;
		if (disp === "none") return null;
		let out: WidgetElement | null;
		switch (node.tag) {
			case "div":
				out = this.container(node, style, parent, inh, depth, disp);
				break;
			case "span":
			case "p":
				out = this.text(node, style, parent, inh);
				break;
			case "img":
				out = this.image(node, style, parent);
				break;
			case "hr":
				out = this.divider(node, style, parent);
				break;
			case "tt-icon":
				out = this.icon(node, style, parent, inh);
				break;
			case "tt-chart":
				out = this.chart(node, style, parent);
				break;
			case "svg":
				out = this.svg(node, style, parent);
				break;
			case "br":
				this.warnAt(node.line, "<br> isn't supported: use two texts, or -webkit-line-clamp for wrapping");
				return null;
			default:
				this.warnAt(node.line, `<${node.tag}> isn't a widget element (div, span, p, img, hr, svg, tt-icon, tt-chart): left out`);
				return null;
		}
		if (out) {
			this.nodes++;
			this.reportUnused(node, style);
		}
		return out;
	}

	private children(node: HtmlElement, type: Parent, inh: Inherit, depth: number): WidgetElement[] {
		const out: WidgetElement[] = [];
		for (const c of node.children) {
			if (c.kind === "text") {
				const text = collapse(c.text);
				if (!text) continue;
				// Bare text in a container: an anonymous text with the inherited style.
				const t: TextElement = { type: "text", text };
				applyInherit(t, inh);
				checkTemplate(text, (m) => this.warnAt(c.line, m));
				this.nodes++;
				out.push(t);
				continue;
			}
			const e = this.element(c, type, inh, depth + 1);
			if (e) out.push(e);
		}
		return out;
	}

	private container(node: HtmlElement, style: Style, parent: Parent | null, inh: Inherit, depth: number, disp: string | undefined): WidgetElement {
		const w: Warn = (m) => this.warnAt(node.line, `<div> ${m}`);
		let type: ContainerElement["type"] = "column";
		if (disp === "flex" || disp === "inline-flex") {
			const dir = style.get("flex-direction")?.trim().toLowerCase();
			type = dir === "column" || dir === "column-reverse" ? "column" : "row";
			if (dir?.endsWith("-reverse")) w(`flex-direction: ${dir} (reverse isn't supported; reorder the children)`);
		} else if (disp === "grid" || disp === "inline-grid") {
			type = "stack";
			style.skip("grid-template-areas", "grid-template-columns", "grid-template-rows");
		} else if (disp != null && disp !== "block") {
			w(`display: ${disp} (block → column, flex → row/column, grid → stack)`);
		} else if (style.has("flex-direction")) {
			const dir = style.get("flex-direction")?.trim().toLowerCase();
			if (dir === "row") w("flex-direction: row needs display: flex (laid out as a column)");
		}
		if (style.has("flex-wrap") && style.get("flex-wrap")?.trim() !== "nowrap") w("flex-wrap isn't supported");

		const childInh = this.inherit(node, style, inh);
		const kids = node.children.filter((c) => c.kind === "el" || collapse(c.text));
		const hasBg = style.has("background") || style.has("background-color");

		// An empty div without a background is a spacer (flex: N → its weight; width / height → its size).
		if (!kids.length && !hasBg && type !== "stack" && parent !== "stack" && parent !== null) {
			const sp: Record<string, unknown> = { type: "spacer" };
			const along = parent === "row" ? "width" : "height";
			const size = length(style.get(along));
			if (size != null) sp.size = size;
			sp[along] = size == null ? undefined : null; // consumed: don't also set the fixed size
			this.common(node, style, parent, sp);
			if (sp[along] === null) delete sp[along];
			this.inheritUnused(node, style);
			return clean(sp) as WidgetElement;
		}

		const out: Record<string, unknown> = { type };
		const gapV = style.get("gap");
		const rowGap = style.get("row-gap");
		const colGap = style.get("column-gap");
		if (gapV != null || rowGap != null || colGap != null) {
			const parts = gapV != null ? words(gapV) : [];
			const v = type === "row" ? (colGap ?? parts[1] ?? parts[0]) : (rowGap ?? parts[0]);
			const x = length(v);
			if (v != null && x == null) w(`gap: "${v}" (px)`);
			if (x) out.gap = x;
		}
		const ai = style.get("align-items");
		if (ai != null) {
			if (type === "stack") w("align-items in a stack: place each child with place-self");
			else {
				const a = axisValue(ai);
				if (!a || (a === "baseline" && type !== "row")) w(`align-items: "${ai}" (start, center, end, stretch; rows also baseline)`);
				else out.align = a;
			}
		}
		const jc = style.get("justify-content");
		if (jc != null) {
			const s = jc.trim().toLowerCase();
			const a = s === "space-between" ? "spaceBetween" : axisValue(s);
			if (type === "stack") w("justify-content in a stack: place each child with place-self");
			else if (a === "start" || a === "center" || a === "end" || a === "spaceBetween") out.justify = a;
			else w(`justify-content: "${jc}" (start, center, end or space-between)`);
		}
		if (type === "stack") style.skip("place-items", "justify-items");
		this.common(node, style, parent, out);
		this.reportAttrs(node, []);
		out.children = this.children(node, type, childInh, depth);
		return clean(out) as WidgetElement;
	}

	/** Container text properties that reach no text (an empty div) are fine: nothing to report. */
	private inheritUnused(_node: HtmlElement, style: Style) {
		style.skip("color", "font-size", "font-weight", "text-align");
	}

	private text(node: HtmlElement, style: Style, parent: Parent | null, inh: Inherit): TextElement {
		const t: Record<string, unknown> = { type: "text" };
		const own = this.inherit(node, style, inh);
		let text = "";
		const nested = new Set<string>();
		const walk = (n: HtmlNode) => {
			if (n.kind === "text") text += n.text;
			else {
				if (!INLINE.has(n.tag)) this.warnAt(n.line, `<${n.tag}> inside a text: only its text is kept`);
				else nested.add(n.tag);
				n.children.forEach(walk);
			}
		};
		node.children.forEach(walk);
		if (nested.size) {
			this.warnAt(
				node.line,
				`<${[...nested].join(">, <")}> inside <${node.tag}>: one text has one style (inner styling ignored; units are coloured by the renderer)`,
			);
		}
		text = collapse(text);
		if (!text) this.warnAt(node.line, `<${node.tag}> has no text (an empty text is hidden)`);
		checkTemplate(text, (m) => this.warnAt(node.line, m));
		t.text = text;
		applyInherit(t as TextElement, own);
		const clampV = style.get("-webkit-line-clamp") ?? style.get("line-clamp");
		if (clampV != null) {
			const x = num(clampV);
			if (x != null && x >= 1 && x <= 20) {
				if (x !== 1) t.maxLines = Math.round(x);
			} else this.warnAt(node.line, `<${node.tag}> line-clamp: "${clampV}" (1..20)`);
		}
		const ws = style.get("white-space")?.trim().toLowerCase();
		if (ws && ws !== "nowrap" && clampV == null) {
			this.warnAt(node.line, `<${node.tag}> white-space: ${ws}: texts are one line unless -webkit-line-clamp says more`);
		}
		const to = style.get("text-overflow")?.trim().toLowerCase();
		if (to === "clip") t.ellipsis = false;
		this.common(node, style, parent, t);
		this.reportAttrs(node, []);
		return clean(t) as TextElement;
	}

	private image(node: HtmlElement, style: Style, parent: Parent | null): WidgetElement {
		const w: Warn = (m) => this.warnAt(node.line, `<img> ${m}`);
		const out: Record<string, unknown> = { type: "image" };
		const src = (node.attrs.src ?? "").trim();
		const b = /^\{([^{}|:]+)\}$/.exec(src);
		if (b) out.bind = b[1].trim();
		else w(`src="${src}": the picture comes from a binding, e.g. src="{game.iconUrl}" (a literal URL isn't supported)`);
		const wd = length(style.get("width") ?? node.attrs.width);
		const ht = length(style.get("height") ?? node.attrs.height);
		if (wd != null && ht != null && wd === ht) out.size = wd;
		else {
			if (wd != null) out.width = wd;
			if (ht != null) out.height = ht;
		}
		// Handled here: common() must not read them again (null is dropped by clean()).
		out.width ??= null;
		out.height ??= null;
		const r = style.get("border-radius");
		if (r != null) {
			const x = length(r);
			if (x == null) w(`border-radius: "${r}" (px)`);
			else out.radius = x;
		}
		const bg = style.get("background") ?? style.get("background-color");
		if (bg != null) out.placeholder = bg.trim() === "none" ? null : color(bg, w, "background (the placeholder)");
		style.skip("object-fit");
		out.background = null; // the background is the placeholder here
		this.common(node, style, parent, out);
		delete out.background;
		this.reportAttrs(node, ["src", "alt", "width", "height"]);
		return clean(out) as WidgetElement;
	}

	private divider(node: HtmlElement, style: Style, parent: Parent | null): WidgetElement {
		const w: Warn = (m) => this.warnAt(node.line, `<hr> ${m}`);
		const out: Record<string, unknown> = { type: "divider" };
		const border = style.get("border-top") ?? style.get("border");
		if (border != null) {
			for (const part of words(border)) {
				const x = length(part);
				if (x != null) out.thickness = x;
				else if (!["solid", "none", "dashed", "dotted"].includes(part)) {
					const c = color(part, w, "border colour");
					if (c) out.color = c;
				}
			}
		}
		style.skip("border-bottom", "border-left", "border-right", "border-style");
		const c = style.get("background") ?? style.get("background-color") ?? style.get("border-color") ?? style.get("color");
		if (c != null) out.color = color(c, w, "colour");
		const th = style.get("height") ?? style.get("border-width") ?? style.get("border-top-width");
		if (th != null) {
			const x = length(th);
			if (x == null) w(`thickness: "${th}" (px)`);
			else out.thickness = x;
		}
		out.background = null;
		out.height = null;
		this.common(node, style, parent, out);
		delete out.background;
		delete out.height;
		this.reportAttrs(node, []);
		return clean(out) as WidgetElement;
	}

	private icon(node: HtmlElement, style: Style, parent: Parent | null, inh: Inherit): WidgetElement {
		const w: Warn = (m) => this.warnAt(node.line, `<tt-icon> ${m}`);
		const name = (node.attrs.name ?? "").trim();
		if (!ICONS.has(name)) w(`name="${name}" (one of ${[...ICONS].join(", ")}; an unknown icon draws nothing)`);
		const out: Record<string, unknown> = { type: "icon", name };
		const size = num(node.attrs.size) ?? length(style.get("width")) ?? length(style.get("height")) ?? length(style.get("font-size"));
		style.skip("width", "height", "font-size");
		if (size != null) out.size = size;
		const c = color(style.get("color") ?? node.attrs.color, w, "color") ?? inh.color;
		if (c) out.color = c;
		out.width = null;
		out.height = null;
		this.common(node, style, parent, out);
		delete out.width;
		delete out.height;
		this.reportAttrs(node, ["name", "size", "color"]);
		return clean(out) as WidgetElement;
	}

	private chart(node: HtmlElement, style: Style, parent: Parent | null): WidgetElement {
		const w: Warn = (m) => this.warnAt(node.line, `<tt-chart> ${m}`);
		const a = node.attrs;
		const out: Record<string, unknown> = { type: "chart", bind: "series" };
		const bind = a.bind?.trim();
		if (bind && bind !== "series") w(`bind="${bind}" (only "series", the CCU line)`);
		const intAttr = (name: string, lo: number, hi: number) => {
			if (a[name] == null) return undefined;
			const x = num(a[name]);
			if (x == null || x < lo || x > hi) {
				w(`${name}="${a[name]}" (${lo}..${hi})`);
				return undefined;
			}
			return x;
		};
		const minutes = intAttr("minutes", 1, 360);
		if (minutes != null) out.minutes = Math.round(minutes);
		const bucket = intAttr("bucket", 0, 60);
		if (bucket != null) out.bucket = Math.round(bucket);
		const stroke = intAttr("stroke", 0.5, 12);
		if (stroke != null) out.stroke = stroke;
		const c = color(style.get("color") ?? a.color, w, "color");
		if (c) out.color = c;
		if (a.fill != null) {
			const f = a.fill.trim();
			if (f === "" || f === "true") out.fill = true;
			else if (f === "none" || f === "false") out.fill = false;
			else {
				const fc = color(f, w, "fill");
				if (fc) out.fill = fc;
			}
		}
		// HTML boolean attributes: present (or ="true") → on, absent or ="false" → off.
		for (const flag of ["dot", "zero", "smooth", "labels"] as const) {
			const v = a[flag];
			out[flag] = v != null && v.trim().toLowerCase() !== "false" && v.trim() !== "0";
		}
		this.common(node, style, parent, out);
		this.reportAttrs(node, ["bind", "minutes", "bucket", "stroke", "color", "fill", "dot", "zero", "smooth", "labels"]);
		if (node.children.some((ch) => ch.kind === "el" || collapse(ch.text))) w("content inside <tt-chart> is ignored");
		return clean(out) as WidgetElement;
	}

	private svg(node: HtmlElement, style: Style, parent: Parent | null): WidgetElement {
		const w: Warn = (m) => this.warnAt(node.line, `<svg> ${m}`);
		const out: Record<string, unknown> = { type: "svg" };
		// The layout comes from the style (and numeric width / height attributes); the SVG is sent without them.
		let raw = node.raw ?? "";
		const openEnd = raw.indexOf(">");
		if (openEnd > 0) {
			const open = raw
				.slice(0, openEnd)
				.replace(/\s(style|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
				.replace(/\s(data-[\w-]+)(?=[\s/>]|$)/gi, "");
			raw = open + raw.slice(openEnd);
		}
		out.svg = raw;
		const fit = (node.attrs["data-fit"] ?? "").trim();
		if (fit) {
			if (fit === "fill" || fit === "contain" || fit === "cover") out.fit = fit;
			else w(`data-fit="${fit}" (fill, contain or cover)`);
		}
		const aw = length(node.attrs.width);
		const ah = length(node.attrs.height);
		if (aw != null && !style.has("width")) out.width = aw;
		if (ah != null && !style.has("height")) out.height = ah;
		if (!/viewBox\s*=/i.test(raw.slice(0, openEnd))) w("has no viewBox (the renderer needs one to scale it)");
		this.common(node, style, parent, out);
		return clean(out) as WidgetElement;
	}

	/** One `<widget>`. */
	layout(node: HtmlElement): { state: WidgetState; layout: SizeLayout } | null {
		const a = node.attrs;
		const w = (m: string) => this.warnAt(node.line, `<widget> ${m}`);
		const state = (a.state ?? "data").trim() as WidgetState;
		if (!STATES.includes(state)) {
			w(`state="${a.state}" (one of ${STATES.join(", ")}): left out`);
			return null;
		}
		const roots = node.children.filter((c) => c.kind === "el" || collapse(c.text));
		if (!roots.length) {
			w("is empty: left out");
			return null;
		}
		const style = new Style(a.style);
		const inh = this.inherit(node, style, {});
		let root: WidgetElement | null;
		if (roots.length === 1 && roots[0].kind === "el") root = this.element(roots[0], null, inh, 0);
		else {
			w("has more than one root element: they are put in a column");
			root = { type: "column", children: this.children(node, "column", inh, 0) };
		}
		if (!root) return null;
		const layout: SizeLayout = {
			minWidth: num(a["min-width"]) ?? 0,
			minHeight: num(a["min-height"]) ?? 0,
			root,
		};
		if (a.name) layout.name = a.name;
		if (a.refresh != null) {
			const r = a.refresh.trim() as RefreshCorner;
			if (CORNERS.includes(r)) layout.refresh = r;
			else w(`refresh="${a.refresh}" (one of ${CORNERS.join(", ")})`);
		}
		const bg = a.background ?? style.get("background") ?? style.get("background-color");
		const radius = a.radius ?? style.get("border-radius");
		if (bg != null) {
			const c = color(bg, w, "background");
			if (c) {
				const r = radius == null ? undefined : radius.trim() === "system" ? "system" : length(radius);
				layout.background = r == null ? c : { color: c, radius: r };
			}
		} else if (radius != null) {
			const r = radius.trim() === "system" ? "system" : length(radius);
			if (r != null) layout.background = { color: "bg", radius: r };
		}
		if (a.description) layout.description = collapse(a.description);
		for (const [k, v] of style.unused()) w(`unsupported CSS "${k}: ${v}" ignored`);
		for (const k of Object.keys(a)) {
			if (!["state", "name", "min-width", "min-height", "refresh", "background", "radius", "description", "style"].includes(k)) {
				w(`unknown attribute "${k}" ignored`);
			}
		}
		return { state, layout };
	}
}

function gravity(v: string, h: string): Gravity | undefined {
	if (v === "stretch" && h === "stretch") return "fill";
	const vs = v === "start" ? "top" : v === "end" ? "bottom" : v === "center" ? "" : null;
	const hs = h === "start" ? "Start" : h === "end" ? "End" : h === "center" ? "" : null;
	if (vs == null || hs == null) return undefined;
	if (!vs && !hs) return "center";
	if (!vs) return (hs === "Start" ? "start" : "end") as Gravity;
	return (vs + hs) as Gravity;
}

function collapse(s: string): string {
	return s.replace(/[ \t\r\n\f]+/g, " ").trim();
}

function applyInherit(t: TextElement, inh: Inherit) {
	if (inh.size != null) t.size = inh.size;
	if (inh.fontWeight != null) t.fontWeight = inh.fontWeight;
	if (inh.color != null) t.color = inh.color;
	if (inh.align != null && inh.align !== "start") t.align = inh.align;
}

/** Unbalanced braces in a text template (`{{` / `}}` are literal braces). */
function checkTemplate(text: string, warn: (m: string) => void) {
	const s = text.replace(/\{\{|\}\}/g, "");
	let depth = 0;
	for (const c of s) {
		if (c === "{") depth++;
		else if (c === "}") depth--;
		if (depth < 0 || depth > 1) {
			warn(`unbalanced braces in "${text}" (use {{ and }} for literal braces)`);
			return;
		}
	}
	if (depth !== 0) warn(`unbalanced braces in "${text}" (use {{ and }} for literal braces)`);
}

/** Drops undefined / null fields (null marks a field an element handled itself). */
function clean(o: Record<string, unknown>): Record<string, unknown> {
	for (const k of Object.keys(o)) if (o[k] === undefined || (o[k] === null && k !== "placeholder")) delete o[k];
	return o;
}

/** `--name: value; …` → token map ("#AARRGGBB"). */
function tokens(el: HtmlElement, c: Compiler): TokenMap {
	const style = new Style(el.attrs.style);
	const out: TokenMap = {};
	for (const [k, v] of style.entries()) {
		if (!k.startsWith("--")) {
			c.warnAt(el.line, `<widget-tokens>: "${k}" isn't a token (write --name: #rrggbb)`);
			continue;
		}
		const lit = literalColor(v);
		if (lit) out[k.slice(2)] = lit;
		else c.warnAt(el.line, `<widget-tokens>: ${k}: "${v}" (a token is a literal colour: #rgb[a], #rrggbb[aa], rgb(), rgba())`);
	}
	return out;
}

/**
 * Compiles widget HTML (docs/WIDGET_HTML.md) into a widget spec. Never throws; problems are in `warnings`
 * ("line N: …"). A result without any `<widget state="data">` has an empty `layouts.data` (the renderer rejects it).
 */
export function compileWidgetHtml(html: string): CompileResult {
	const c = new Compiler();
	const spec: WidgetSpec = { version: WIDGET_SPEC_VERSION, layouts: { data: [] } };
	let tree: HtmlElement;
	try {
		tree = parseHtml(html, (line, msg) => c.warnAt(line, msg));
	} catch (e) {
		return { spec, warnings: [`could not read the HTML: ${String(e)}`] };
	}
	for (const node of tree.children) {
		if (node.kind === "text") {
			if (collapse(node.text)) c.warnAt(node.line, `text outside a <widget> ignored: "${collapse(node.text).slice(0, 40)}"`);
			continue;
		}
		try {
			switch (node.tag) {
				case "widget": {
					const r = c.layout(node);
					if (r) (spec.layouts[r.state] ??= []).push(r.layout);
					break;
				}
				case "widget-tokens": {
					const mode = (node.attrs.mode ?? "").trim();
					const map = tokens(node, c);
					spec.tokens ??= {};
					if (mode === "day" || mode === "night") spec.tokens[mode] = { ...spec.tokens[mode], ...map };
					else if (!mode) {
						spec.tokens.day = { ...spec.tokens.day, ...map };
						spec.tokens.night = { ...spec.tokens.night, ...map };
					} else c.warnAt(node.line, `<widget-tokens mode="${mode}"> (day, night, or none for both)`);
					break;
				}
				case "widget-strings": {
					const s: NonNullable<WidgetSpec["strings"]> = { ...spec.strings };
					for (const [k, v] of Object.entries(node.attrs)) {
						if (k === "refreshing" || k === "offline") s[k] = v;
						else c.warnAt(node.line, `<widget-strings>: unknown string "${k}" (refreshing, offline)`);
					}
					spec.strings = s;
					break;
				}
				case "widget-format": {
					const f: NonNullable<WidgetSpec["format"]> = { ...spec.format };
					for (const [k, v] of Object.entries(node.attrs)) {
						if (k === "ratio-decimals") {
							const x = num(v);
							if (x != null && Number.isInteger(x) && x >= 0 && x <= 4) f.ratioDecimals = x;
							else c.warnAt(node.line, `<widget-format ratio-decimals="${v}"> (0..4)`);
						} else c.warnAt(node.line, `<widget-format>: unknown option "${k}" (ratio-decimals)`);
					}
					if (Object.keys(f).length) spec.format = f;
					break;
				}
				default:
					c.warnAt(node.line, `<${node.tag}> at the top level ignored (widget, widget-tokens, widget-strings, widget-format)`);
			}
		} catch (e) {
			// A compiler bug must not take the widget down: report and go on.
			c.warnAt(node.line, `<${node.tag}> could not be compiled: ${String(e)}`);
		}
	}
	if (!spec.layouts.data.length) c.warnings.push('no <widget state="data">: the spec has no layouts and would be rejected');
	if (c.nodes > 400) c.warnings.push(`${c.nodes} elements: the renderer accepts at most 400 and would reject the spec`);
	const size = JSON.stringify(spec).length;
	if (size > 200_000) c.warnings.push(`the spec is ${size} characters: the renderer accepts at most 200,000`);
	// By line ("line N: …"; the summary lines last).
	const lineOf = (w: string) => Number(/^line (\d+):/.exec(w)?.[1] ?? Number.MAX_SAFE_INTEGER);
	const warnings = c.warnings.map((w, i) => ({ w, i })).sort((a, b) => lineOf(a.w) - lineOf(b.w) || a.i - b.i).map((x) => x.w);
	return { spec, warnings };
}
