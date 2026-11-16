/** Formatting: the web app's helpers (src/api/tt/format.ts) plus the app's own. */
import type { MetricFormat } from "@/features/project/analytics";
import { fmtInt, fmtMinutes, fmtNum, fmtPct } from "@/api/tt/format";
import { shortNumber } from "@/charts/LineChart";

export * from "@/api/tt/format";

/** 1234567 -> "1.2M" (counts in tight spots). */
export function compact(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return "–";
	return Math.abs(n) < 10_000 ? fmtInt(n) : shortNumber(n);
}

export function fmtRobux(n: number | null | undefined): string {
	return n === null || n === undefined ? "–" : `R$ ${compact(n)}`;
}

export function fmtMetric(format: MetricFormat, v: number | null | undefined): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return "–";
	switch (format) {
		case "rate":
			return fmtPct(v, v < 0.1 ? 2 : 1);
		case "robux":
			return fmtRobux(v);
		case "minutes":
			return fmtMinutes(v);
		case "hours":
			return `${compact(v)} h`;
		case "decimal":
			return fmtNum(v, 2);
		default:
			return compact(v);
	}
}

/** "Nov 16, 2026" */
export function fmtDate(iso: string | number | null | undefined): string {
	if (iso === null || iso === undefined || iso === "") return "–";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return String(iso);
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Days left until a time (rounded down; negative when past). */
export function daysLeft(ms: number, now = Date.now()): number {
	return Math.floor((ms - now) / 86_400_000);
}

/** "86400s" or seconds -> "1 d", "3 h", "permanent". */
export function fmtSeconds(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined) return "permanent";
	if (seconds >= 86_400) return `${+(seconds / 86_400).toFixed(1)} d`;
	if (seconds >= 3600) return `${+(seconds / 3600).toFixed(1)} h`;
	if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
	return `${seconds}s`;
}

export function prettyJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? "undefined";
	} catch {
		return String(value);
	}
}
