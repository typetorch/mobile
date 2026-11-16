/** The Errors pages' shared bits: the windows, the server sort, and the link from the list to one kind (web pages/Errors.tsx). */
import type { ErrorParams } from "@/api/backend";

/** The web's windows (GET /v1/errors?window=). */
export const ERROR_WINDOWS = [
	{ value: "1h", label: "1 h" },
	{ value: "6h", label: "6 h" },
	{ value: "24h", label: "24 h" },
	{ value: "7d", label: "7 d" },
	{ value: "30d", label: "30 d" },
] as const;

export const DEFAULT_ERROR_WINDOW = "24h";

/** A window the backend takes, or the default. */
export function errorWindow(value: string | undefined): string {
	return ERROR_WINDOWS.some((w) => w.value === value) ? (value as string) : DEFAULT_ERROR_WINDOW;
}

export function errorWindowLabel(value: string): string {
	return ERROR_WINDOWS.find((w) => w.value === value)?.label ?? value;
}

/** The columns the server orders the list by (GET /v1/errors?sort=), as the web's KIND_SORT_COLUMNS. */
export const KIND_SORT_COLUMNS = ["count", "lastAt", "firstAt", "total", "realm"] as const;

/** "Last 10 steps of 5 min": a trend step's size. */
export function bucketLabel(bucketSeconds: number): string {
	if (bucketSeconds % 86_400 === 0) return `${bucketSeconds / 86_400} d`;
	if (bucketSeconds % 3600 === 0) return `${bucketSeconds / 3600} h`;
	return `${bucketSeconds / 60} min`;
}

/** The kind page with the list's window and filters (not the search: it only picks which kinds are listed). */
export function errorKindHref(backendId: string, fp: string, params: Pick<ErrorParams, "window" | "realm" | "branch" | "build">): string {
	const query = new URLSearchParams();
	if (params.window && params.window !== DEFAULT_ERROR_WINDOW) query.set("window", params.window);
	for (const key of ["realm", "branch", "build"] as const) {
		const v = params[key];
		if (v) query.set(key, v);
	}
	const qs = query.toString();
	return `/tt/${backendId}/error/${encodeURIComponent(fp)}${qs ? `?${qs}` : ""}`;
}
