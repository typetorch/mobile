/**
 * Requests and the cached answers to them: `GET /v1/mobile/live?minutes=360[&metrics=…]` (LiveApi.kt), and the answer
 * a widget reads for one backend (Store.kt saveSuccess: a newer answer of another request of the same path, e.g. a live
 * watch poll, brings fresh live numbers while the asked metrics stay).
 */
import { isObj, num } from "./json";
import type { Answer, Json, JsonObject, Request } from "./types";

export const LIVE_PATH = "/v1/mobile/live";
/** The cache's series window (the spec's charts show up to 6 hours). */
export const MINUTES = "360";
/** Metric ids per request (the backend answers at most 12). */
export const MAX_METRICS = 12;
/** A metric id: letters, digits and `: _ -`, at most 40 characters (Store.kt METRIC_ID). */
const METRIC_ID = /^[A-Za-z0-9:_-]{1,40}$/;
/** Store.kt SERIES_WINDOW_MS: 6 h and a minute. */
const SERIES_WINDOW_MS = 6 * 60 * 60 * 1000 + 60000;

/** [first] (when given) then the widget's non-empty slots, deduplicated, at most MAX_METRICS (Store.kt metricsFor). */
export function metricIds(slots: unknown, first?: string): string[] {
	const out: string[] = [];
	if (first) out.push(first);
	if (Array.isArray(slots)) {
		for (const s of slots) {
			const id = typeof s === "string" ? s.trim() : "";
			if (id && METRIC_ID.test(id) && out.indexOf(id) < 0) out.push(id);
		}
	}
	return out.slice(0, MAX_METRICS);
}

/** The live request; no `metrics` parameter when there are none (LiveApi.kt). */
export function liveRequest(backend: string, metrics: string[]): Request {
	const query: Record<string, string> = { minutes: MINUTES };
	if (metrics.length) query.metrics = metrics.join(",");
	return { backend, path: LIVE_PATH, query };
}

function decode(s: string): string {
	try {
		return decodeURIComponent(s.replace(/\+/g, " "));
	} catch (e) {
		return s;
	}
}

/** "<path>?<query>" → path and parameters (any order, encoded or not). */
function parseKey(key: string): { path: string; params: Record<string, string> } {
	const q = key.indexOf("?");
	const path = q < 0 ? key : key.slice(0, q);
	const params: Record<string, string> = {};
	if (q >= 0) {
		for (const part of key.slice(q + 1).split("&")) {
			if (!part) continue;
			const eq = part.indexOf("=");
			params[decode(eq < 0 ? part : part.slice(0, eq))] = eq < 0 ? "" : decode(part.slice(eq + 1));
		}
	}
	return { path, params };
}

function sameQuery(a: Record<string, string>, b: Record<string, string>): boolean {
	const ka = Object.keys(a);
	if (ka.length !== Object.keys(b).length) return false;
	for (const k of ka) if (!(k in b) || a[k] !== b[k]) return false;
	return true;
}

/** When the answer was fetched (ms), or -1 when the native side doesn't say. */
function timeOf(a: Answer): number {
	const t = num(a.at != null ? a.at : a.okAt != null ? a.okAt : a.time != null ? a.time : a.fetchedAt);
	return t == null ? -1 : t;
}

type Found = { key: string; body: JsonObject; at: number; ok: boolean };

/**
 * What a widget reads for [req] from its backend's cached answers: the answer to that request (else the newest answer
 * of the same path), with newer answers of other requests of the same path laid over it. Null: no answer with data.
 */
export function answerFor(answers: { [key: string]: Answer } | null | undefined, req: Request): JsonObject | null {
	if (!isObj(answers)) return null;
	const want = req.query;
	let exact: Found | null = null;
	const others: Found[] = [];
	for (const key of Object.keys(answers)) {
		const a = (answers as unknown as Record<string, Answer>)[key];
		if (!isObj(a) || !isObj(a.body)) continue;
		const { path, params } = parseKey(key);
		if (path !== req.path) continue;
		const f: Found = { key, body: a.body, at: timeOf(a), ok: a.ok === true };
		if (exact == null && sameQuery(params, want)) exact = f;
		else others.push(f);
	}
	let base = exact;
	if (base == null) {
		for (const f of others) if (base == null || f.at > base.at) base = f;
	}
	if (base == null) return null;
	const b = base;
	const newer = others.filter((f) => f !== b && f.ok && b.at >= 0 && f.at > b.at).sort((x, y) => x.at - y.at);
	let out = b.body;
	for (const f of newer) out = overlay(out, f.body);
	return out;
}

/**
 * [newer] over [older] like Store.kt saveSuccess for an answer that asked no metrics: the newer live fields, the series
 * merged, the older metrics kept, the icon and the top-level `releases` kept when the newer answer has none.
 */
function overlay(older: JsonObject, newer: JsonObject): JsonObject {
	const out: JsonObject = {};
	for (const k of Object.keys(newer)) out[k] = newer[k];
	if ("metrics" in older) out.metrics = older.metrics;
	const og = isObj(older.game) ? older.game : null;
	const ng = isObj(newer.game) ? newer.game : null;
	if (og || ng) {
		const g: JsonObject = {};
		if (ng) for (const k of Object.keys(ng)) g[k] = ng[k];
		if (g.iconUrl == null && og && og.iconUrl != null) g.iconUrl = og.iconUrl;
		out.game = g;
	}
	if (newer.releases == null && older.releases != null) out.releases = older.releases;
	out.series = mergeSeries(older.series, newer.series);
	return out;
}

/** Points by time (newer wins), trimmed to the window before the newest one (LiveData.kt mergeSeries). */
function mergeSeries(older: Json | undefined, newer: Json | undefined): Json[] {
	const byTime: Record<string, number> = {};
	const add = (arr: Json | undefined) => {
		if (!Array.isArray(arr)) return;
		for (const p of arr) {
			if (!isObj(p)) continue;
			const t = num(p.t);
			const ccu = num(p.ccu);
			if (t == null || ccu == null) continue;
			byTime[String(Math.round(t))] = Math.round(ccu);
		}
	};
	add(older);
	add(newer);
	const times = Object.keys(byTime)
		.map(Number)
		.sort((a, b) => a - b);
	if (!times.length) return [];
	const cutoff = times[times.length - 1] - SERIES_WINDOW_MS;
	return times.filter((t) => t >= cutoff).map((t) => ({ t, ccu: byTime[String(t)] }));
}
