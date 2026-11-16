/** Error report helpers shared by the list and the detail screen. */

/** A badge tone for a log severity ("Error", "Warning", "Info"…). */
export function logSeverityTone(s: string | null | undefined): "critical" | "warning" | "muted" {
	const v = (s ?? "").toLowerCase();
	return v.includes("error") ? "critical" : v.includes("warn") ? "warning" : "muted";
}
