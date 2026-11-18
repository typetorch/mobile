/**
 * Runs the built widget program (src/features/live/widgets/program.generated.ts) in a fresh V8 context, the way the
 * native side does (JSON in, JSON out), against made-up answers shaped like the backend's (3 games with 182 days of
 * releases and history starts, an older backend's 60 days, a failing backend, a live watch poll), and checks
 * plan / shape / tap: the requests, the per-game pass-through, the all-games merge (compared day by day with a
 * by-date recomputation of AllGames.kt's rule, plus "rnone" before any game's history), the filter, the toggles.
 *
 * Run: `timeout 60 bun scripts/widgets/check-program.ts` (exit 1 on a failure). Also checks that the generated file
 * is what a build makes now, and that the source parses as ES2020.
 */
import { buildProgram } from "./build-program";
import { WIDGET_PROGRAM } from "../../src/features/live/widgets/program.generated";

declare const process: { exit(code?: number): never };

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
type Vm = {
	createContext(o: object): object;
	runInContext(code: string, ctx: object, opts?: { timeout?: number }): unknown;
};

let failures = 0;
let passes = 0;
function ok(cond: boolean, what: string, detail?: unknown): void {
	if (cond) {
		passes++;
		return;
	}
	failures++;
	console.log(`✗ ${what}${detail === undefined ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function eq(actual: unknown, expected: unknown, what: string): void {
	ok(same(actual, expected), what, same(actual, expected) ? undefined : `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The program in a fresh context

const vm = (await import("node:" + "vm")) as Vm;
const ctx = vm.createContext({});
vm.runInContext(WIDGET_PROGRAM, ctx, { timeout: 2000 });
let slowest = 0;
let largest = 0;
function call(fn: "plan" | "shape" | "tap", input: unknown): Obj {
	(ctx as Record<string, unknown>).__in = JSON.stringify(input);
	const t0 = performance.now();
	const out = vm.runInContext(`JSON.stringify(${fn}(JSON.parse(__in)))`, ctx, { timeout: 2000 }) as string;
	slowest = Math.max(slowest, performance.now() - t0);
	largest = Math.max(largest, out.length);
	ok(out.length <= 256 * 1024, `${fn}: output ≤ 256 KB`, out.length);
	return JSON.parse(out) as Obj;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures

const DAY = 86400000;
const TODAY = Date.UTC(2026, 10, 18);
const NOW = TODAY + 12 * 3600000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3);

type Cell = { date: string; p: number; d: number; bg?: string; tri?: string };

/** [len] days ending [endOffset] days before today; history from index [start]; [withTokens] false: an older backend. */
function days(seed: number, len: number, start: number, endOffset: number, withTokens = true): Cell[] {
	let x = seed;
	const rnd = () => {
		x = (x * 16807) % 2147483647;
		return x / 2147483647;
	};
	const out: Cell[] = [];
	for (let i = 0; i < len; i++) {
		const date = iso(TODAY - (endOffset + len - 1 - i) * DAY);
		const h = i >= start;
		const p = h && rnd() < 0.25 ? 1 + Math.floor(rnd() * 4) : 0;
		const d = h && rnd() < 0.5 ? 1 + Math.floor(rnd() * 6) : 0;
		const cell: Cell = { date, p, d };
		if (withTokens) {
			cell.bg = !h ? "rnone" : p ? `rg${level(p)}` : d ? `rb${level(d)}` : "r0";
			cell.tri = h && p && d ? `rb${level(d)}` : "rnone";
		}
		out.push(cell);
	}
	return out;
}

function releasesMetric(cells: Cell[], lastProdLabel: string | null): Obj {
	let prod = 0;
	let dev = 0;
	let prod30 = 0;
	let dev30 = 0;
	let last = -1;
	cells.forEach((c, i) => {
		prod += c.p;
		dev += c.d;
		if (i >= cells.length - 30) {
			prod30 += c.p;
			dev30 += c.d;
		}
		if (c.p) last = i;
	});
	const n = cells.length;
	return {
		value: prod,
		prev: null,
		unit: "count",
		label: "Releases",
		prod,
		dev,
		prod30,
		dev30,
		lastProd: last < 0 ? null : last === n - 1 ? "today" : `${n - 1 - last} d ago`,
		lastProdLabel: last < 0 ? null : lastProdLabel,
		days: cells as unknown as Json,
	};
}

const series = (base: number) => Array.from({ length: 5 }, (_, i) => ({ t: NOW - (4 - i) * 60000, ccu: base + i }));

const A_DAYS = days(7, 182, 100, 0);
const B_DAYS = days(11, 182, 140, 1); // a day behind (cached yesterday)
const C_DAYS = days(13, 60, 0, 0, false); // an older backend: 60 days, no tokens

const backends = [
	{ id: "acc-gnome", name: "Gnome account", url: "https://a.example.com" },
	{ id: "acc-tower", name: "Tower account", url: "https://b.example.com" },
	{ id: "acc-old", name: "Old account", url: "https://c.example.com" },
	{ id: "acc-broken", name: "Broken account", url: "https://d.example.com" },
];

const A_REL = releasesMetric(A_DAYS, "#142 · v0.9.3");
const B_REL = releasesMetric(B_DAYS, "#12 · v1.2.0");
const C_REL = releasesMetric(C_DAYS, "#3 · v0.1.0");

const A_BODY: Obj = {
	game: { name: "Gnome Game", universeId: 111, iconUrl: "https://img.example.com/a.png" },
	ccu: 120,
	servers: 6,
	delta: 4,
	peakToday: 300,
	series: series(116),
	lastHour: { avgSessionSeconds: 600, medianSessionSeconds: 420, sessionsEnded: 40, playtimeHours: 9.5 },
	metrics: { releases: A_REL, dau: { value: 1830, prev: 1702, unit: "count", label: "DAU" }, d7: null },
	releases: A_REL,
};
const B_BODY: Obj = {
	game: { name: "Tower Run", universeId: 222, iconUrl: "https://img.example.com/b.png" },
	ccu: 30,
	servers: 2,
	delta: -3,
	peakToday: 44,
	series: series(27),
	lastHour: null,
	metrics: { releases: B_REL, "revenue:72h": { value: 2140, prev: 2350, unit: "robux", label: "Revenue 72h" } },
	releases: B_REL,
};
const C_BODY: Obj = {
	// An older backend: no icon, no name, ccu as text, releases only as a metric.
	game: { name: "", universeId: null },
	ccu: "7",
	servers: null,
	metrics: { releases: C_REL },
};

const REL_KEY = "/v1/mobile/live?minutes=360&metrics=releases";
const allResponses = {
	"acc-gnome": { [REL_KEY]: { ok: true, body: A_BODY, at: NOW - 60000 } },
	// Another parameter order: the program mustn't depend on the native side's key spelling.
	"acc-tower": { "/v1/mobile/live?metrics=releases&minutes=360": { ok: true, body: B_BODY, at: NOW - 60000 } },
	"acc-old": { [REL_KEY]: { ok: true, body: C_BODY, at: NOW - 60000 } },
	"acc-broken": { [REL_KEY]: { ok: false, status: 500, error: "http 500", at: NOW } },
};
const ALL_SLOTS = ["", "", "", "releases"];
const allWidget = (state: Obj | null) => ({ id: 7, backendId: "*", slots: ALL_SLOTS, state });

// ---------------------------------------------------------------------------------------------------------------------
// The oracle: AllGames.kt's merge recomputed by date (a different walk than the program's), with the "rnone" fix.

type Expected = { days: Obj[]; prod: number; dev: number; prod30: number; dev30: number; lastProd: Json; lastProdLabel: Json; lastProdGame: Json };

function expectedMerge(games: { name: string; cells: Cell[]; label: string | null }[]): Expected {
	let axis = games[0].cells;
	for (const g of games) if (g.cells[g.cells.length - 1].date > axis[axis.length - 1].date) axis = g.cells;
	const byDate = new Map<string, { p: number; d: number; h: boolean }>();
	for (const c of axis) byDate.set(c.date, { p: 0, d: 0, h: false });
	let best: { at: number; game: string; label: string | null } | null = null;
	const pos = new Map(axis.map((c, i) => [c.date, i]));
	for (const g of games) {
		let newest = -1;
		for (const c of g.cells) {
			const e = byDate.get(c.date);
			if (!e) continue;
			e.p += c.p;
			e.d += c.d;
			if (c.bg !== "rnone") e.h = true;
			if (c.p > 0) newest = Math.max(newest, pos.get(c.date)!);
		}
		if (newest >= 0 && (!best || newest > best.at)) best = { at: newest, game: g.name, label: g.label };
	}
	const out: Obj[] = [];
	let prod = 0;
	let dev = 0;
	let prod30 = 0;
	let dev30 = 0;
	let last = -1;
	axis.forEach((c, i) => {
		const e = byDate.get(c.date)!;
		prod += e.p;
		dev += e.d;
		if (i >= axis.length - 30) {
			prod30 += e.p;
			dev30 += e.d;
		}
		if (e.p) last = i;
		const bg = e.p ? `rg${level(e.p)}` : e.d ? `rb${level(e.d)}` : e.h ? "r0" : "rnone";
		const tri = e.p && e.d ? `rb${level(e.d)}` : "rnone";
		out.push({ date: c.date, p: e.p, d: e.d, bg, tri });
	});
	const n = axis.length;
	return {
		days: out,
		prod,
		dev,
		prod30,
		dev30,
		lastProd: last < 0 ? null : last === n - 1 ? "today" : `${n - 1 - last} d ago`,
		lastProdLabel: best ? best.label : null,
		lastProdGame: best ? best.game : null,
	};
}

function checkReleases(rel: Obj, exp: Expected, what: string): void {
	const days = rel.days as Obj[];
	eq(days.length, exp.days.length, `${what}: day count`);
	let bad = 0;
	exp.days.forEach((e, i) => {
		if (!same(days[i], e)) {
			if (bad < 3) console.log(`    day ${i}: ${JSON.stringify(days[i])} ≠ ${JSON.stringify(e)}`);
			bad++;
		}
	});
	ok(bad === 0, `${what}: every day as AllGames.kt's rule (by date) + rnone fix`, `${bad} day(s) differ`);
	for (const k of ["prod", "dev", "prod30", "dev30", "lastProd", "lastProdLabel", "lastProdGame"] as const) {
		eq(rel[k], exp[k], `${what}: ${k}`);
	}
	eq(rel.value, exp.prod, `${what}: value = prod`);
	eq([rel.unit, rel.label, rel.prev], ["count", "Releases", null], `${what}: unit / label / prev`);
}

// ---------------------------------------------------------------------------------------------------------------------
// plan

{
	const w = { id: 1, backendId: "acc-gnome", slots: ["session:1h", "dau", "", "dau"], state: null };
	eq(
		call("plan", { widget: w, backends, now: NOW }),
		{ requests: [{ backend: "acc-gnome", path: "/v1/mobile/live", query: { minutes: "360", metrics: "session:1h,dau" } }] },
		"plan: per-game = one request, the non-empty slots deduplicated",
	);
	eq(
		call("plan", { widget: { ...w, slots: ["", "", ""] }, backends, now: NOW }),
		{ requests: [{ backend: "acc-gnome", path: "/v1/mobile/live", query: { minutes: "360" } }] },
		"plan: no slots → no metrics parameter",
	);
	eq(call("plan", { widget: { ...w, backendId: "gone" }, backends, now: NOW }), { requests: [] }, "plan: signed-out backend → nothing");
	const all = call("plan", { widget: allWidget(null), backends, now: NOW }).requests as Obj[];
	eq(
		all,
		backends.map((b) => ({ backend: b.id, path: "/v1/mobile/live", query: { minutes: "360", metrics: "releases" } })),
		"plan: all games = one releases request per signed-in backend",
	);
	const withSlots = call("plan", { widget: { ...allWidget(null), slots: ["dau", "releases"] }, backends, now: NOW }).requests as Obj[];
	eq((withSlots[0].query as Obj).metrics, "releases,dau", "plan: all games with slots → releases first, then the slots");
	const many = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, url: "https://x" }));
	eq((call("plan", { widget: allWidget(null), backends: many, now: NOW }).requests as Obj[]).length, 8, "plan: at most 8 requests");
}

// ---------------------------------------------------------------------------------------------------------------------
// shape: per game

{
	const w = { id: 1, backendId: "acc-gnome", slots: ["session:1h", "dau"], state: { x: 1 } };
	const responses = { "acc-gnome": { "/v1/mobile/live?minutes=360&metrics=session%3A1h%2Cdau": { ok: true, body: A_BODY, at: NOW - 60000 } } };
	const out = call("shape", { widget: w, backends, responses, size: { w: 250, h: 110 }, night: false, now: NOW });
	eq(out.live, A_BODY, "shape: per-game passes the answer through (encoded key)");
	eq(out.state, { x: 1 }, "shape: per-game keeps the state");

	// A newer live watch poll (no metrics asked): fresh live numbers, the asked metrics and releases kept.
	const poll = { game: { name: "Gnome Game", universeId: 111 }, ccu: 125, servers: 7, delta: 5, peakToday: 300, series: [{ t: NOW + 60000, ccu: 125 }], lastHour: null, metrics: {} };
	const r2 = { "acc-gnome": { ...responses["acc-gnome"], "/v1/mobile/live?minutes=60": { ok: true, body: poll, at: NOW } } };
	const o2 = call("shape", { widget: w, backends, responses: r2, now: NOW }).live as Obj;
	eq([o2.ccu, o2.servers, o2.delta, o2.lastHour], [125, 7, 5, null], "shape: a newer watch poll's live numbers win");
	eq(o2.metrics, A_BODY.metrics, "shape: …the widget's metrics stay");
	eq(o2.releases, A_BODY.releases, "shape: …the top-level releases stay");
	eq((o2.game as Obj).iconUrl, "https://img.example.com/a.png", "shape: …the icon stays");
	eq((o2.series as Obj[]).length, 6, "shape: …the series merged");

	// Only another request's answer (the slots changed since): used rather than nothing.
	const r3 = { "acc-gnome": { [REL_KEY]: { ok: true, body: B_BODY, at: NOW } } };
	eq(call("shape", { widget: w, backends, responses: r3, now: NOW }).live, B_BODY, "shape: falls back to the same path's answer");
	eq(call("shape", { widget: w, backends, responses: {}, now: NOW }).live, null, "shape: no answer → live null");
	eq(
		call("shape", { widget: w, backends, responses: { "acc-gnome": { [REL_KEY]: { ok: false, status: 500, error: "x" } } }, now: NOW }).live,
		null,
		"shape: only a failure → live null",
	);
}

// ---------------------------------------------------------------------------------------------------------------------
// shape: all games, no filter

const GAMES = [
	{ name: "Gnome Game", cells: A_DAYS, label: "#142 · v0.9.3" },
	{ name: "Tower Run", cells: B_DAYS, label: "#12 · v1.2.0" },
	{ name: "Old account", cells: C_DAYS, label: (C_REL.lastProdLabel as string | null) ?? null },
];

let gameIds: Json = null;
{
	const out = call("shape", { widget: allWidget(null), backends, responses: allResponses, size: { w: 250, h: 110 }, night: true, now: NOW });
	const live = out.live as Obj;
	gameIds = (out.state as Obj).games;
	eq(gameIds, backends.map((b) => b.id), "all: state.games = games[] ids in order");
	eq(live.allGames, "1", "all: allGames");
	eq(live.game, { name: "All games", universeId: null, iconUrl: null }, "all: game");
	ok(!("filter" in live), "all: no filter");
	eq([live.ccu, live.servers, live.delta], [157, 8, 1], "all: ccu / servers / delta summed");
	eq([live.peakToday, live.series, live.lastHour], [null, [], null], "all: no peak / series / lastHour unpicked");
	eq(
		live.games,
		[
			{ id: "acc-gnome", name: "Gnome Game", iconUrl: "https://img.example.com/a.png", picked: "", alpha: "1" },
			{ id: "acc-tower", name: "Tower Run", iconUrl: "https://img.example.com/b.png", picked: "", alpha: "1" },
			{ id: "acc-old", name: "Old account", iconUrl: null, picked: "", alpha: "1" },
			{ id: "acc-broken", name: "Broken account", iconUrl: null, picked: "", alpha: "1" },
		],
		"all: games[]",
	);
	eq(Object.keys(live.metrics as Obj), ["releases"], "all: metrics = releases only (unpicked)");
	eq((live.metrics as Obj).releases, live.releases, "all: metrics.releases = releases");
	const rel = live.releases as Obj;
	checkReleases(rel, expectedMerge(GAMES), "all");
	const ds = rel.days as Obj[];
	ok(ds.slice(0, 100).every((d) => d.bg === "rnone" && d.tri === "rnone"), "all: days before every game's history stay rnone");
	ok(ds[100].bg !== "rnone", "all: the first history day (game A) isn't rnone");
	ok(ds.slice(100).every((d) => d.bg !== "rnone"), "all: no rnone inside the history");
	eq(ds[181].date, iso(TODAY), "all: the axis ends today (the newest game's days)");
}

// ---------------------------------------------------------------------------------------------------------------------
// shape: all games, filtered

{
	const out = call("shape", { widget: allWidget({ filter: "acc-tower" }), backends, responses: allResponses, now: NOW });
	const live = out.live as Obj;
	eq(live.filter, "acc-tower", "filter: filter");
	eq(live.game, { name: "Tower Run", universeId: 222, iconUrl: "https://img.example.com/b.png" }, "filter: game");
	eq([live.ccu, live.servers, live.delta, live.peakToday], [30, 2, -3, 44], "filter: the picked game's numbers");
	eq(live.series, B_BODY.series, "filter: the picked game's series");
	eq(
		(live.games as Obj[]).map((g) => [g.picked, g.alpha]),
		[["", "0.4"], ["1", "1"], ["", "0.4"], ["", "0.4"]],
		"filter: picked / alpha",
	);
	eq(Object.keys(live.metrics as Obj).sort(), ["releases", "revenue:72h"], "filter: the picked game's metrics");
	const rel = live.releases as Obj;
	checkReleases(rel, expectedMerge([GAMES[1]]), "filter");
	const ds = rel.days as Obj[];
	ok(ds.slice(0, 140).every((d) => d.bg === "rnone") && ds.slice(140).every((d) => d.bg !== "rnone"), "filter: the game's own history start");
	eq((out.state as Obj).filter, "acc-tower", "filter: kept in state");

	const gone = call("shape", { widget: allWidget({ filter: "signed-out" }), backends, responses: allResponses, now: NOW });
	ok(!("filter" in (gone.live as Obj)) && (gone.live as Obj).ccu === 157, "filter: a signed-out pick shows all games");
	eq((gone.state as Obj).filter, "signed-out", "filter: …and stays in state");

	const noData = call("shape", { widget: allWidget({ filter: "acc-broken" }), backends, responses: allResponses, now: NOW }).live as Obj;
	eq(
		[(noData.game as Obj).name, noData.ccu, noData.metrics, "releases" in noData],
		["Broken account", null, {}, false],
		"filter: a picked game without an answer: its name, no numbers",
	);

	const none = call("shape", { widget: allWidget(null), backends, responses: { "acc-broken": allResponses["acc-broken"] }, now: NOW });
	eq(none.live, null, "all: no answer with data → live null");
	eq(call("shape", { widget: allWidget(null), backends: [], responses: {}, now: NOW }).live, null, "all: no backends → live null");
}

// Older backends without days: totals summed, no days.
{
	const old = (prod: number, lastProd: string) => ({ ok: true, body: { game: { name: "G" }, ccu: 1, metrics: { releases: { value: prod, unit: "count", label: "Releases", dev: 2, lastProd } } } });
	const responses = { "acc-gnome": { [REL_KEY]: old(3, "2 d ago") }, "acc-tower": { [REL_KEY]: old(4, "today") } };
	const rel = (call("shape", { widget: allWidget(null), backends: backends.slice(0, 2), responses, now: NOW }).live as Obj).releases as Obj;
	eq([rel.prod, rel.dev, rel.lastProd, rel.days], [7, 4, null, []], "old backends: totals summed, no days");
	const one = (call("shape", { widget: allWidget({ filter: "acc-tower" }), backends: backends.slice(0, 2), responses, now: NOW }).live as Obj).releases as Obj;
	eq([one.prod, one.lastProd], [4, "today"], "old backend, one game: its lastProd");
}

// ---------------------------------------------------------------------------------------------------------------------
// tap

{
	const t = (state: Obj | null, action: string, extra: Obj = {}) => call("tap", { widget: allWidget(state), action, now: NOW, ...extra }).state as Obj;
	const st = { games: gameIds, keep: "x" };
	eq(t(st, "action:toggle:acc-tower"), { ...st, filter: "acc-tower" }, "tap: action:toggle:<id> picks");
	eq(t({ ...st, filter: "acc-tower" }, "action:toggle:acc-tower"), st, "tap: …again clears");
	eq(t({ ...st, filter: "acc-gnome" }, "toggle:acc-tower"), { ...st, filter: "acc-tower" }, "tap: toggle:<id> (prefix stripped natively) switches");
	eq(t(st, "action:toggle:{games.2.id}"), { ...st, filter: "acc-old" }, "tap: an unfilled {games.N.id} → games[N]");
	eq(t(st, "toggle:games.0"), { ...st, filter: "acc-gnome" }, "tap: toggle:games.N (the native path's) → games[N]");
	eq(t(st, "action:toggle:1"), { ...st, filter: "acc-tower" }, "tap: action:toggle:N → games[N]");
	eq(t(st, "action:toggle:{games.5.id}"), st, "tap: no such game → unchanged");
	eq(t(st, "action:toggle:nope"), st, "tap: unknown id → unchanged");
	eq(t({ ...st, filter: "acc-old" }, "action:toggle:"), st, "tap: toggle: (empty) clears");
	eq(t(st, "action:something-else"), st, "tap: another action → unchanged");
	eq(t(null, "action:toggle:{games.1.id}", { backends }), { filter: "acc-tower" }, "tap: no state.games → the backends' order");
	eq(t(null, "action:toggle:acc-gnome"), { filter: "acc-gnome" }, "tap: no state at all → the id as is");

	// A round: shape → tap → shape.
	const s1 = call("shape", { widget: allWidget(null), backends, responses: allResponses, now: NOW }).state as Obj;
	const s2 = t(s1, "action:toggle:{games.1.id}");
	const live = call("shape", { widget: allWidget(s2), backends, responses: allResponses, now: NOW }).live as Obj;
	eq((live.game as Obj).name, "Tower Run", "tap: shape → tap → shape picks the game");
	ok(JSON.stringify(s2).length <= 4096, "tap: state ≤ 4 KB");
}

// ---------------------------------------------------------------------------------------------------------------------
// The build

const fresh = await buildProgram();
ok(fresh === WIDGET_PROGRAM, "program.generated.ts is current", "run `timeout 60 bun scripts/widgets/build-program.ts`");
try {
	const spec = "acorn";
	const acorn = (await import(spec)) as { parse(code: string, o: { ecmaVersion: number; sourceType: string }): unknown };
	try {
		acorn.parse(WIDGET_PROGRAM, { ecmaVersion: 2020, sourceType: "script" });
		ok(true, "ES2020");
	} catch (e) {
		ok(false, "the program parses as an ES2020 script", String(e));
	}
} catch {
	console.log("(acorn not found: ES2020 syntax not checked)");
}
ok(slowest < 2000, "each call < 2 s", slowest);

console.log(
	`${failures ? "✗" : "✓"} ${passes} passed, ${failures} failed · program ${WIDGET_PROGRAM.length} chars · slowest call ${slowest.toFixed(1)} ms · largest output ${largest} chars`,
);
process.exit(failures ? 1 : 0);
