/**
 * Compiles the app's widget HTML (src/features/live/widgets/default.html.ts) and checks it:
 *  - no compiler warnings;
 *  - the same structure as the reference spec (scripts/widgets/reference.json: the hand-written spec the HTML was ported
 *    from): the same states and size classes, the same elements, bindings and sizes, after filling in the renderer's
 *    defaults (so `color: "text"` written out and left out are the same). The chart options zero / bucket / smooth /
 *    labels and `format` are new and listed separately;
 *  - the native built-in default (WidgetSpec.kt DEFAULT_JSON) compared the same way, for information only.
 *
 * Run: `timeout 60 bun scripts/widgets/check.ts` (exit 1 on a warning or a difference).
 *   --print   print the compiled spec as JSON (for DEFAULT_JSON) and exit
 *   --update  after an intended design change: write the compiled spec as the new reference
 */
import { compileWidgetHtml } from "../../src/features/live/widgets/compile";
import { DEFAULT_WIDGET_HTML } from "../../src/features/live/widgets/default.html";

// Bun's API (run with bun; the app's tsconfig has no node / bun types, so just what is used here).
declare const Bun: { file(path: string): { text(): Promise<string> }; write(path: string, data: string): Promise<number>; argv: string[] };
declare const process: { exit(code?: number): never };

const referencePath = new URL("./reference.json", import.meta.url).pathname;
const nativePath = new URL("../../modules/typetorch-live/android/src/main/java/dev/typetorch/live/WidgetSpec.kt", import.meta.url).pathname;

const { spec, warnings } = compileWidgetHtml(DEFAULT_WIDGET_HTML);
const args = new Set(Bun.argv.slice(2));

if (args.has("--print")) {
	console.log(JSON.stringify(spec, null, 2));
	process.exit(0);
}
if (args.has("--update")) {
	await Bun.write(referencePath, JSON.stringify(spec, null, 2) + "\n");
	console.log(`reference updated: ${referencePath}`);
	process.exit(0);
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const NEW_CHART = ["zero", "bucket", "smooth", "labels"];
const WEIGHTS: Record<string, number> = { thin: 100, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, black: 900 };

function edges(v: Json | undefined): Obj {
	if (v == null) return { top: 0, bottom: 0, start: 0, end: 0 };
	if (typeof v === "number") return { top: v, bottom: v, start: v, end: v };
	const o = v as Obj;
	const n = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : undefined);
	return {
		top: n("top") ?? n("vertical") ?? 0,
		bottom: n("bottom") ?? n("vertical") ?? 0,
		start: n("start") ?? n("horizontal") ?? 0,
		end: n("end") ?? n("horizontal") ?? 0,
	};
}

/** An element with the renderer's defaults filled in (WidgetSpec.kt `node`), new chart options split off. */
function normalize(e: Obj, where: string, extras: string[]): Obj {
	const type = e.type as string;
	const o: Obj = { ...e };
	o.padding = edges(e.padding);
	o.margin = edges(e.margin);
	o.weight = (e.weight as number) ?? (type === "chart" && e.height == null ? 1 : 0);
	o.gap ??= 0;
	if (type === "text") {
		o.size ??= 12;
		o.color ??= "text";
		o.maxLines ??= 1;
		o.ellipsis ??= true;
		o.align ??= "start";
		const fw = e.fontWeight;
		o.fontWeight = typeof fw === "number" ? fw : (WEIGHTS[(fw as string) ?? "normal"] ?? 400);
	}
	if (type === "chart") {
		o.bind ??= "series";
		o.minutes ??= 360;
		o.color ??= "brand";
		o.fill = e.fill === undefined || e.fill === true ? "auto" : e.fill;
		o.stroke ??= 2;
		o.dot ??= true;
		const opts = NEW_CHART.filter((k) => k in e).map((k) => `${k}=${JSON.stringify(e[k])}`);
		if (opts.length) extras.push(`${where}: chart ${opts.join(" ")}`);
		for (const k of NEW_CHART) delete o[k];
	}
	if (type === "image") {
		o.bind ??= "game.iconUrl";
		o.size ??= 22;
		o.radius ??= 6;
		if (!("placeholder" in e)) o.placeholder = "divider";
	}
	if (type === "icon") {
		o.size ??= 16;
		o.color ??= "text2";
	}
	if (type === "divider") {
		o.color ??= "divider";
		o.thickness ??= 1;
	}
	if (type === "spacer") o.size ??= 0;
	if (Array.isArray(e.children)) o.children = e.children.map((c, i) => normalize(c as Obj, `${where}.${i}`, extras));
	return o;
}

function normalizeSpec(s: Obj, extras: string[]): Obj {
	const layouts: Obj = {};
	for (const [state, list] of Object.entries((s.layouts as Obj) ?? {})) {
		layouts[state] = (list as Obj[]).map((l, i) => {
			const name = (l.name as string) ?? String(i);
			return {
				...l,
				refresh: l.refresh ?? "topEnd",
				background: l.background ?? { color: "bg", radius: "system" },
				root: normalize(l.root as Obj, `${state}/${name}`, extras),
			};
		});
	}
	if (s.format) extras.push(`format ${JSON.stringify(s.format)}`);
	return { version: s.version ?? 1, tokens: s.tokens ?? null, strings: s.strings ?? null, layouts };
}

function diff(a: Json | undefined, b: Json | undefined, path: string, out: string[]) {
	if (out.length > 40) return;
	if (a === b) return;
	if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
		const show = (v: Json | undefined) => {
			const t = JSON.stringify(v) ?? "undefined";
			return t.length > 80 ? `${t.slice(0, 77)}…` : t;
		};
		out.push(`${path || "(root)"}: ${show(a)} ≠ ${show(b)}`);
		return;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		const x = (Array.isArray(a) ? a : []) as Json[];
		const y = (Array.isArray(b) ? b : []) as Json[];
		if (x.length !== y.length) out.push(`${path}: ${x.length} items ≠ ${y.length}`);
		for (let i = 0; i < Math.min(x.length, y.length); i++) diff(x[i], y[i], `${path}[${i}]`, out);
		return;
	}
	const keys = new Set([...Object.keys(a as Obj), ...Object.keys(b as Obj)]);
	for (const k of keys) diff((a as Obj)[k], (b as Obj)[k], path ? `${path}.${k}` : k, out);
}

function count(e: Obj): number {
	return 1 + ((e.children as Obj[] | undefined) ?? []).reduce((n, c) => n + count(c), 0);
}

function compare(label: string, other: Obj, max = 40): string[] {
	const extrasA: string[] = [];
	const out: string[] = [];
	diff(normalizeSpec(spec as unknown as Obj, extrasA), normalizeSpec(other, []), "", out);
	console.log(out.length ? `✗ ${label}: ${out.length} difference(s)` : `✓ ${label}: same structure`);
	for (const d of out.slice(0, max)) console.log(`    ${d}`);
	if (out.length > max) console.log(`    … ${out.length - max} more`);
	return out;
}

let failed = false;
const layouts = spec.layouts as unknown as Record<string, Obj[]>;
console.log(
	"compiled: " +
		Object.entries(layouts)
			.map(([s, l]) => `${s} [${l.map((x) => `${x.name ?? "?"} ${x.minWidth}x${x.minHeight}`).join(", ")}]`)
			.join("; "),
);
const elements = Object.values(layouts).reduce((n, l) => n + l.reduce((m, x) => m + count(x.root as Obj), 0), 0);
console.log(`elements: ${elements} (the renderer allows 400), JSON: ${JSON.stringify(spec).length} chars`);

if (warnings.length) {
	failed = true;
	console.log(`✗ ${warnings.length} warning(s):`);
	for (const w of warnings) console.log(`    ${w}`);
} else console.log("✓ no compiler warnings");

const reference = JSON.parse(await Bun.file(referencePath).text()) as Obj;
if (compare("reference (scripts/widgets/reference.json)", reference).length) failed = true;

const extras: string[] = [];
normalizeSpec(spec as unknown as Obj, extras);
if (extras.length) {
	console.log("new options (not in the reference):");
	for (const x of extras) console.log(`    ${x}`);
}

// Information only: the APK's built-in default (another copy, updated with the next APK).
try {
	const kt = await Bun.file(nativePath).text();
	const m = /DEFAULT_JSON\s*=\s*"""([\s\S]*?)"""/.exec(kt);
	if (m) {
		const native = JSON.parse(m[1].replace(/\$\{'\$'\}/g, "$")) as Obj;
		const d = compare("native DEFAULT_JSON (info only)", native, 6);
		if (d.length) console.log("    → update DEFAULT_JSON at the next APK: bun scripts/widgets/check.ts --print");
	} else console.log("· native DEFAULT_JSON not found (skipped)");
} catch (e) {
	console.log(`· native DEFAULT_JSON not readable (skipped): ${String(e).slice(0, 120)}`);
}

process.exit(failed ? 1 : 0);
