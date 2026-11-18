/**
 * Health of all-games widgets (the 4x2's variant C): each answer's top-level `health` (backend: { errors1h,
 * errorsPrev1h, servers, serversOk, alertsOpen, alerts: [{ level, title, at }] } or null) merged over the shown games,
 * with the colour tokens the widget HTML can't compute itself (no conditionals in templates).
 */
import { cleanName, isObj, num, text } from "./json";
import type { Json, JsonObject } from "./types";

const HOUR = 3600000;
/** Alerts listed in the widget. */
export const MAX_ALERTS = 3;

function whole(v: Json | undefined): number {
	const d = num(v);
	return d == null || d <= 0 ? 0 : Math.trunc(d);
}

/** "now", "4m", "2h", "3d" from [at] (ISO) to [now] (ms); "" when unknown. */
export function age(at: number | null, now: number): string {
	if (at == null || !isFinite(now)) return "";
	const ms = Math.max(0, now - at);
	if (ms < 60000) return "now";
	if (ms < HOUR) return `${Math.floor(ms / 60000)}m`;
	if (ms < 24 * HOUR) return `${Math.floor(ms / HOUR)}h`;
	return `${Math.floor(ms / (24 * HOUR))}d`;
}

const LEVEL_DOT: Record<string, string> = { critical: "bad", warning: "warn", info: "text2" };

/**
 * [inputs]: (game name, its answer's `health`) for the shown games. Null when none has health (an older backend: the
 * widget hides the health parts). Rules: errors high (red, ▲) when errors1h > 0 and ≥ 2 × errorsPrev1h; today's ring
 * `bad` when errors are high or a critical alert came in the last hour, `warn` when an alert is open, else `rnone`.
 */
export function mergeHealth(inputs: [string, Json | undefined][], now: number): JsonObject | null {
	let any = false;
	let errors = 0;
	let prev = 0;
	let servers = 0;
	let serversOk = 0;
	let open = 0;
	const alerts: { at: number | null; level: string; text: string }[] = [];
	for (const [game, h] of inputs) {
		if (!isObj(h)) continue;
		any = true;
		errors += whole(h.errors1h);
		prev += whole(h.errorsPrev1h);
		servers += whole(h.servers);
		serversOk += whole(h.serversOk);
		open += whole(h.alertsOpen);
		if (!Array.isArray(h.alerts)) continue;
		for (const a of h.alerts) {
			if (!isObj(a)) continue;
			const title = text(a.title);
			if (!title) continue;
			const t = typeof a.at === "string" ? Date.parse(a.at) : NaN;
			const level = typeof a.level === "string" && LEVEL_DOT[a.level] ? a.level : "info";
			alerts.push({ at: isFinite(t) ? t : null, level, text: `${cleanName(game) || game} · ${title.trim()}` });
		}
	}
	if (!any) return null;
	alerts.sort((a, b) => (b.at == null ? -Infinity : b.at) - (a.at == null ? -Infinity : a.at));
	const shown = alerts.slice(0, MAX_ALERTS);
	const high = errors > 0 && errors >= 2 * prev;
	const criticalNow = alerts.some((a) => a.level === "critical" && a.at != null && now - a.at <= HOUR);
	return {
		errors1h: errors,
		errorsPrev1h: prev,
		errorsHigh: high ? "1" : "",
		errorsArrow: high ? "▲" : "",
		servers,
		serversOk,
		serversAllOk: servers > 0 && serversOk >= servers ? "1" : "",
		alertsOpen: open,
		hasAlertsOpen: open > 0 ? "1" : "",
		alerts: shown.map((a) => ({ level: a.level, dot: LEVEL_DOT[a.level], text: a.text, age: age(a.at, now) })),
		todayRing: high || criticalNow ? "bad" : open > 0 ? "warn" : "rnone",
	};
}

/**
 * The error trend of one game, last hour against the hour before: "▲4×" when errors1h ≥ 1 and ≥ 2 × errorsPrev1h (just
 * "▲" when the hour before had none), "▲38%" for a smaller rise over 10%, "▼61%" for a fall over 10%, "" within ±10%.
 * [dir]: 1 up (red), -1 down (green), 0 none.
 */
export function errorTrend(errors: number, prev: number): { text: string; dir: number } {
	if (errors >= 1 && errors >= 2 * prev) {
		if (prev <= 0) return { text: "▲", dir: 1 };
		const f = errors / prev;
		const shown = f >= 10 ? String(Math.round(f)) : String(Math.round(f * 10) / 10);
		return { text: `▲${shown}×`, dir: 1 };
	}
	if (prev <= 0) return { text: "", dir: 0 };
	const change = (errors - prev) / prev;
	if (change > 0.1) return { text: `▲${Math.round(change * 100)}%`, dir: 1 };
	if (change < -0.1) return { text: `▼${Math.round(-change * 100)}%`, dir: -1 };
	return { text: "", dir: 0 };
}

/**
 * A per-game widget's health (the Stats widgets' health line): the answer's own `health` with what the widget HTML can't
 * compute itself (no conditionals in templates; colours only as token names in an svg, or as pairs of elements with
 * opposite flags). Null when the answer has no health (an older backend: the widget hides the health parts).
 *  - `on`: "1" (the widget shows the health parts only with it, so the native path without the program hides them);
 *  - `errorsTrend` ("▲4×", "▲38%", "▼61%", ""), `errorsArrow` (its arrow only), `errorsUp` / `errorsDown` ("1" / "");
 *  - tokens: `errorsTone` (`bad` when up, else `text`), `trendTone` (`bad` up, `up` down), `serversTone` (`text2` when
 *    every server is ok, else `warn`), `alertsTone` (`warn` when an alert is open, else `text2`);
 *  - `serversAllOk`, `hasAlertsOpen` ("1" / ""), like the all-games merge. No servers counts as all ok.
 * The alert list isn't passed on (it stays in the release widget).
 */
export function gameHealth(h: Json | undefined): JsonObject | null {
	if (!isObj(h)) return null;
	const errors = whole(h.errors1h);
	const prev = whole(h.errorsPrev1h);
	const servers = whole(h.servers);
	const serversOk = whole(h.serversOk);
	const open = whole(h.alertsOpen);
	const trend = errorTrend(errors, prev);
	const allOk = serversOk >= servers;
	return {
		on: "1",
		errors1h: errors,
		errorsPrev1h: prev,
		errorsTrend: trend.text,
		errorsArrow: trend.text.slice(0, 1),
		errorsUp: trend.dir > 0 ? "1" : "",
		errorsDown: trend.dir < 0 ? "1" : "",
		errorsTone: trend.dir > 0 ? "bad" : "text",
		trendTone: trend.dir > 0 ? "bad" : "up",
		servers,
		serversOk,
		serversAllOk: allOk ? "1" : "",
		serversTone: allOk ? "text2" : "warn",
		alertsOpen: open,
		hasAlertsOpen: open > 0 ? "1" : "",
		alertsTone: open > 0 ? "warn" : "text2",
	};
}
