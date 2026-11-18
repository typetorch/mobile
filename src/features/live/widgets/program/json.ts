/**
 * Lenient readers with the native parser's rules (LiveData.kt: numOrNull / strOrNull, Metric.fromJson), so the
 * program's output matches what the native path drew from the same answers.
 */
import type { Json, JsonObject } from "./types";

export function isObj(v: unknown): v is JsonObject {
	return v != null && typeof v === "object" && !Array.isArray(v);
}

/** A number (or a numeric string), finite; else null (LiveData.kt numOrNull). */
export function num(v: unknown): number | null {
	let d: number | null = null;
	if (typeof v === "number") d = v;
	else if (typeof v === "string" && NUMERIC.test(v)) d = Number(v);
	return d == null || !isFinite(d) ? null : d;
}

/** Kotlin's String.toDouble shape (no blanks, no hex). */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Kotlin roundToInt / roundToLong (half up). */
export function rounded(v: unknown): number | null {
	const d = num(v);
	return d == null ? null : Math.round(d);
}

/** Any non-null value as text (strOrNull: `opt(key).toString()`). */
export function str(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return JSON.stringify(v);
}

/** A non-blank text, else null. */
export function text(v: unknown): string | null {
	const s = str(v);
	return s != null && s.trim() ? s : null;
}

/** An http(s) URL (trimmed), else null (LiveData.kt: game.iconUrl). */
export function webUrl(v: unknown): string | null {
	const s = str(v);
	if (s == null) return null;
	const t = s.trim();
	return /^https?:\/\//i.test(t) ? t : null;
}

const METRIC_KNOWN = ["value", "prev", "unit", "label"];

/**
 * One `metrics` entry as the native cache keeps it (Metric.fromJson + toJson): its other fields without nulls, then
 * value / prev (numbers or null), unit / label (non-blank text or null).
 */
export function metric(o: JsonObject): JsonObject {
	const out: JsonObject = {};
	for (const k of Object.keys(o)) {
		if (METRIC_KNOWN.indexOf(k) >= 0) continue;
		const v = o[k];
		if (v != null) out[k] = v;
	}
	out.value = num(o.value);
	out.prev = num(o.prev);
	out.unit = text(o.unit);
	out.label = text(o.label);
	return out;
}

/** The answer's `metrics` as the cache keeps them (null entries, unknown ids, left out). */
export function metrics(v: Json | undefined): JsonObject {
	const out: JsonObject = {};
	if (!isObj(v)) return out;
	for (const id of Object.keys(v)) {
		const e = v[id];
		if (isObj(e)) out[id] = metric(e);
	}
	return out;
}
