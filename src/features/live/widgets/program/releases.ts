/**
 * The `releases` metrics of several games as one (AllGames.kt mergeReleases; docs/WIDGET_RELEASES.md): per-day `p` / `d`
 * summed by date on the newest game's days, the counts recomputed from those days, `lastProd` from the newest prod day,
 * `lastProdLabel` / `lastProdGame` from the game that made it, the cell tokens by the backend's rule.
 *
 * One change from the native merge: a day no game has history for (every game's cell "rnone", or no game has that day)
 * stays "rnone" (nothing drawn) instead of "r0".
 */
import { isObj, num, str } from "./json";
import type { Json, JsonObject } from "./types";

/** At most this many days are merged. */
const MAX_DAYS = 400;
/** A day's count is capped here. */
const MAX_COUNT = 1000000;

/** 0 for 0, 1 for 1, 2 for 2–3, 3 for 4+. */
function level(n: number): number {
	return n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3;
}

/** A count field: a number or numeric text, ≤ 0 / bad → 0, capped, truncated (AllGames.kt count). */
function count(o: JsonObject | null, key: string): number {
	if (o == null) return 0;
	const d = num(o[key]);
	if (d == null || d <= 0) return 0;
	return d > MAX_COUNT ? MAX_COUNT : Math.trunc(d);
}

/** A day's key: its date, else its position from the end (`#0` = the last day). */
function dayKey(o: Json | undefined, i: number, n: number): string {
	// org.json optString: a JSON null reads "null", a number its text.
	const raw = isObj(o) ? (o.date === null ? "null" : str(o.date)) : null;
	const date = raw == null ? "" : raw.trim();
	return date !== "" && date !== "null" ? date : "#" + (n - 1 - i);
}

function daysOf(m: JsonObject): Json[] | null {
	return Array.isArray(m.days) ? m.days : null;
}

/**
 * [inputs]: [game name, the game's `releases` metric (as metric() keeps it)]. Null when there are none. The result is
 * the metric's JSON: prod, dev, prod30, dev30, lastProd, lastProdLabel, lastProdGame, days, value, prev, unit, label.
 */
export function mergeReleases(inputs: [string, JsonObject][]): JsonObject | null {
	if (!inputs.length) return null;
	// The axis: the days of the game whose last day is the newest (string order works for ISO dates).
	let ax: Json[] | null = null;
	let axisLast = "";
	for (const [, m] of inputs) {
		const days = daysOf(m);
		if (!days || !days.length) continue;
		const last = dayKey(days[days.length - 1], days.length - 1, days.length);
		if (ax == null || last > axisLast) {
			ax = days;
			axisLast = last;
		}
	}
	let label = "Releases";
	for (const [, m] of inputs) {
		if (typeof m.label === "string") {
			label = m.label;
			break;
		}
	}
	if (ax == null) {
		// No game sends days (an older backend): the totals summed, nothing per day.
		let prod = 0;
		let dev = 0;
		let prod30 = 0;
		let dev30 = 0;
		for (const [, m] of inputs) {
			const v = num(m.value);
			prod += m.prod != null ? count(m, "prod") : Math.max(0, Math.trunc(v == null ? 0 : v));
			dev += count(m, "dev");
			prod30 += count(m, "prod30");
			dev30 += count(m, "dev30");
		}
		const one = inputs.length === 1 ? inputs[0][1] : null;
		return {
			prod,
			dev,
			prod30,
			dev30,
			lastProd: one && one.lastProd != null ? one.lastProd : null,
			lastProdLabel: one && one.lastProdLabel != null ? one.lastProdLabel : null,
			days: [],
			value: prod,
			prev: null,
			unit: "count",
			label,
		};
	}
	const axis: Json[] = ax;
	const n = Math.min(axis.length, MAX_DAYS);
	const start = axis.length - n;
	const dates: (string | null)[] = [];
	const index: Record<string, number> = {};
	for (let i = start; i < axis.length; i++) {
		const key = dayKey(axis[i], i, axis.length);
		index[key] = dates.length;
		dates.push(key.charAt(0) === "#" ? null : key);
	}
	const p: number[] = [];
	const d: number[] = [];
	/** Some game has history that day (a cell of its own that isn't "rnone"). */
	const hist: boolean[] = [];
	for (let i = 0; i < n; i++) {
		p.push(0);
		d.push(0);
		hist.push(false);
	}
	let bestAt = -1;
	let bestLabel: Json = null;
	let bestGame: string | null = null;
	for (const [game, m] of inputs) {
		const days = daysOf(m);
		if (!days) continue;
		let newest = -1;
		for (let i = 0; i < days.length; i++) {
			const o = days[i];
			if (!isObj(o)) continue;
			const key = dayKey(o, i, days.length);
			if (!Object.prototype.hasOwnProperty.call(index, key)) continue;
			const at = index[key];
			const dp = count(o, "p");
			p[at] += dp;
			d[at] += count(o, "d");
			if (o.bg !== "rnone") hist[at] = true;
			if (dp > 0 && at > newest) newest = at;
		}
		if (newest > bestAt) {
			bestAt = newest;
			bestLabel = m.lastProdLabel != null ? m.lastProdLabel : null;
			bestGame = game;
		}
	}
	const daysOut: Json[] = [];
	let prod = 0;
	let dev = 0;
	let prod30 = 0;
	let dev30 = 0;
	let lastProdAt = -1;
	for (let i = 0; i < n; i++) {
		const pi = p[i];
		const di = d[i];
		prod += pi;
		dev += di;
		if (i >= n - 30) {
			prod30 += pi;
			dev30 += di;
		}
		if (pi > 0) lastProdAt = i;
		let bg: string;
		let tri: string;
		if (pi > 0) {
			bg = "rg" + level(pi);
			tri = di > 0 ? "rb" + level(di) : "rnone";
		} else if (di > 0) {
			bg = "rb" + level(di);
			tri = "rnone";
		} else {
			bg = hist[i] ? "r0" : "rnone";
			tri = "rnone";
		}
		const day: JsonObject = {};
		const date = dates[i];
		if (date != null) day.date = date;
		day.p = pi;
		day.d = di;
		day.bg = bg;
		day.tri = tri;
		daysOut.push(day);
	}
	const lastProd = lastProdAt < 0 ? null : lastProdAt === n - 1 ? "today" : n - 1 - lastProdAt + " d ago";
	return {
		prod,
		dev,
		prod30,
		dev30,
		lastProd,
		lastProdLabel: bestAt >= 0 && bestLabel != null ? bestLabel : null,
		lastProdGame: bestAt >= 0 ? bestGame : null,
		days: daysOut,
		value: prod,
		prev: null,
		unit: "count",
		label,
	};
}
