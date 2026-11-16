/** Shared plumbing for the TypeTorch screens: the backend's API client, its queries, ranges. */
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import type { Api } from "@/api/backend";
import type { DeployOutcome } from "@/api/tt/deploys";
import type { Filters } from "@/api/tt/types";
import { useBackend } from "@/store/accounts";

/**
 * A query against one backend: keyed ["tt", backendId, ...key] (removed when the backend is disconnected), with
 * the API client handed in. Disabled until the account is loaded, and while it is signed out.
 */
export function useTTQuery<T>(
	backendId: string,
	key: readonly unknown[],
	fn: (api: Api, signal: AbortSignal) => Promise<T>,
	options: Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn"> = {},
) {
	const { api, account } = useBackend(backendId);
	return useQuery<T, Error, T, readonly unknown[]>({
		queryKey: ["tt", backendId, ...key],
		queryFn: ({ signal }) => fn(api as Api, signal),
		...options,
		// A signed-out backend's token is dead: don't ask again until the person signs in.
		enabled: !!api && !account?.signedOut && (options.enabled ?? true),
	});
}

const DAY_MS = 86_400_000;

/** The web filter bar's day presets: "7d" = today and the 6 days before (UTC). */
export function dayRange(days: number, now = Date.now()): Filters {
	return { from: new Date(now - (days - 1) * DAY_MS).toISOString().slice(0, 10) };
}

/** A fleet server's health as a tone. */
export function healthTone(health: string | null | undefined): "good" | "warning" | "critical" | "muted" {
	if (!health) return "muted";
	const h = health.toLowerCase();
	if (h === "ok" || h === "healthy" || h === "good") return "good";
	if (h === "critical" || h === "failed" || h === "error" || h === "down") return "critical";
	return "warning";
}

export function outcomeTone(o: DeployOutcome): "good" | "critical" | "muted" | "warning" {
	return o === "ok" ? "good" : o === "failed" ? "critical" : o === "no_reports" ? "muted" : "warning";
}

/** The Errors windows (the web's), shared by the list and one kind's page so a kind opens with the list's window. */
export const ERROR_WINDOWS = [
	{ value: "1h", label: "1 h" },
	{ value: "6h", label: "6 h" },
	{ value: "24h", label: "24 h" },
	{ value: "7d", label: "7 d" },
	{ value: "30d", label: "30 d" },
];

export function errorWindowOf(value: string | undefined, fallback = "24h"): string {
	return value && ERROR_WINDOWS.some((w) => w.value === value) ? value : fallback;
}
