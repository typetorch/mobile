/** Shared plumbing for the TypeTorch screens: the backend's API client, its queries, ranges. */
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import type { Api } from "@/api/backend";
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
