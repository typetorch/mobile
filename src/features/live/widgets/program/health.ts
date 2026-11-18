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
