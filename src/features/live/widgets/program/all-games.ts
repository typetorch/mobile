/**
 * All-games widgets (backend "*"; AllGames.kt view; docs/WIDGET_SPEC.md, All games): every signed-in backend's answer
 * merged into one live object, filtered to the picked game (the program state's `filter`).
 */
import { answerFor, liveRequest, metricIds } from "./answers";
import { cleanName, isObj, metric, metrics, num, rounded, text, webUrl } from "./json";
import { mergeHealth } from "./health";
import { mergeReleases } from "./releases";
import type { Backend, Json, JsonObject, Responses, Widget } from "./types";

export const ALL = "*";
export const NAME = "All games";
/** games[] holds at most this many. */
export const MAX_GAMES = 6;
/** Requests per widget per refresh (docs/WIDGET_PROGRAM.md, Limits). */
export const MAX_REQUESTS = 8;

const RELEASES = "releases";

/** The request of one backend for an all-games widget: `releases`, then the widget's slots. */
export function allRequest(widget: Widget, backend: string) {
	return liveRequest(backend, metricIds(widget.slots, RELEASES));
}

/** The game's name (emoji stripped): the answer's, else the backend's, else "All games". */
function gameName(d: JsonObject | undefined, b: Backend): string {
	const g = d && isObj(d.game) ? d.game : null;
	return cleanName(g && g.name) || cleanName(b.name) || NAME;
}

/** A non-negative whole count (as the merge counts). */
function whole(v: Json | undefined): number {
	const d = num(v);
	return d == null || d <= 0 ? 0 : Math.trunc(d);
}

/**
 * One game's own numbers for games[] (the 4x1 all-games list): prod / dev over all its days (the history the backend
 * sends, 182 days), and its last prod ("today", "1 d ago", counted from its own last day); from the totals when it has
 * no days (an older backend). Nulls when the game has no releases.
 */
function ownReleases(m: JsonObject | null): { prod: number | null; dev: number | null; lastProd: string | null } {
	if (!m) return { prod: null, dev: null, lastProd: null };
	const days = Array.isArray(m.days) ? m.days : null;
	if (!days || !days.length) {
		return { prod: m.prod != null ? whole(m.prod) : whole(m.value), dev: whole(m.dev), lastProd: text(m.lastProd) };
	}
	let prod = 0;
	let dev = 0;
	let last = -1;
	for (let i = 0; i < days.length; i++) {
		const o = days[i];
		if (!isObj(o)) continue;
		const p = whole(o.p);
		prod += p;
		dev += whole(o.d);
		if (p > 0) last = i;
	}
	const ago = days.length - 1 - last;
	return { prod, dev, lastProd: last < 0 ? null : ago === 0 ? "today" : `${ago} d ago` };
}

function iconOf(d: JsonObject | undefined): string | null {
	return d && isObj(d.game) ? webUrl(d.game.iconUrl) : null;
}

/** A game's releases: the answer's top-level `releases`, else `metrics.releases`. */
function releasesOf(d: JsonObject): JsonObject | null {
	if (isObj(d.releases)) return metric(d.releases);
	const m = isObj(d.metrics) ? d.metrics[RELEASES] : null;
	return isObj(m) ? metric(m) : null;
}

/** The sum of a top-level number over [datas]; null when none has it (each rounded first, as the cache does). */
function sum(datas: JsonObject[], key: string): number | null {
	let any = false;
	let total = 0;
	for (const d of datas) {
		const v = rounded(d[key]);
		if (v == null) continue;
		any = true;
		total += v;
	}
	return any ? Math.max(-2147483648, Math.min(2147483647, total)) : null;
}

function seriesOf(d: JsonObject | undefined): Json[] {
	const out: { t: number; ccu: number }[] = [];
	if (!d || !Array.isArray(d.series)) return out;
	for (const p of d.series) {
		if (!isObj(p)) continue;
		const t = rounded(p.t);
		const ccu = rounded(p.ccu);
		if (t == null || ccu == null) continue;
		out.push({ t, ccu });
	}
	return out.sort((a, b) => a.t - b.t);
}

function lastHourOf(d: JsonObject | undefined): Json {
	const l = d && isObj(d.lastHour) ? d.lastHour : null;
	if (!l) return null;
	return {
		avgSessionSeconds: num(l.avgSessionSeconds),
		medianSessionSeconds: num(l.medianSessionSeconds),
		sessionsEnded: rounded(l.sessionsEnded),
		playtimeHours: num(l.playtimeHours),
	};
}

/**
 * The merged live object (null when no backend has answered yet) and the state to keep: [state] with `games` (the
 * games[] ids in order, so a tap by index finds its game).
 */
export function allGames(
	widget: Widget,
	backends: Backend[],
	responses: Responses,
	state: JsonObject,
	now: number = Date.now(),
): { live: JsonObject | null; state: JsonObject } {
	const filterId = typeof state.filter === "string" && state.filter ? state.filter : null;
	const datas: Record<string, JsonObject> = {};
	for (const b of backends.slice(0, MAX_REQUESTS)) {
		const body = answerFor(responses ? responses[b.id] : null, allRequest(widget, b.id));
		if (body) datas[b.id] = body;
	}
	const has = (id: string) => Object.prototype.hasOwnProperty.call(datas, id);
	let picked: Backend | null = null;
	if (filterId != null) for (const b of backends) if (b.id === filterId && picked == null) picked = b;
	const games = backends.slice(0, MAX_GAMES);
	const nextState: JsonObject = {};
	for (const k of Object.keys(state)) nextState[k] = state[k];
	nextState.games = games.map((g) => g.id);

	const withData = backends.filter((b) => has(b.id));
	if (!withData.length) return { live: null, state: nextState };
	const scope = picked ? [picked] : withData;
	const scopeDatas = scope.filter((b) => has(b.id)).map((b) => datas[b.id]);
	const pickedData = picked && has(picked.id) ? datas[picked.id] : undefined;

	const arr: Json[] = games.map((g) => {
		const d = has(g.id) ? datas[g.id] : undefined;
		const on = picked != null && picked.id === g.id;
		const own = ownReleases(d ? releasesOf(d) : null);
		return {
			id: g.id,
			name: gameName(d, g),
			iconUrl: iconOf(d),
			picked: on ? "1" : "",
			alpha: picked == null || on ? "1" : "0.4",
			prod: own.prod,
			dev: own.dev,
			lastProd: own.lastProd,
		};
	});

	// metrics: the picked game's, with `releases` merged (recomputed) in either case.
	const ms = pickedData ? metrics(pickedData.metrics) : {};
	const inputs: [string, JsonObject][] = [];
	for (const b of scope) {
		if (!has(b.id)) continue;
		const m = releasesOf(datas[b.id]);
		if (m) inputs.push([gameName(datas[b.id], b), m]);
	}
	const releases = mergeReleases(inputs);
	if (releases) ms[RELEASES] = releases;
	else delete ms[RELEASES];

	const pg = pickedData && isObj(pickedData.game) ? pickedData.game : null;
	const live: JsonObject = {
		games: arr,
		allGames: "1",
		game: {
			name: picked ? gameName(pickedData, picked) : NAME,
			universeId: pg ? rounded(pg.universeId) : null,
			iconUrl: iconOf(pickedData),
		},
		ccu: sum(scopeDatas, "ccu"),
		servers: sum(scopeDatas, "servers"),
		delta: sum(scopeDatas, "delta"),
		peakToday: pickedData ? rounded(pickedData.peakToday) : null,
		series: seriesOf(pickedData),
		lastHour: lastHourOf(pickedData),
		metrics: ms,
	};
	if (picked) live.filter = picked.id;
	// The top-level `releases` too (what the widget HTML reads).
	if (releases) live.releases = releases;
	// Health merged over the shown games (absent when none has it: an older backend).
	const health = mergeHealth(
		scope.filter((b) => has(b.id)).map((b): [string, Json | undefined] => [gameName(datas[b.id], b), datas[b.id].health]),
		now,
	);
	if (health) live.health = health;
	return { live, state: nextState };
}
