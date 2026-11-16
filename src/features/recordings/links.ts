/**
 * Links into the Recordings screen from elsewhere (web lib/commands.ts replayHref). The web puts the filters in the URL;
 * here the filter bar is one state per backend, so a replay link sets the bar to a custom range over the UTC days the
 * session spans (keeping the other filters, like the web's keptFilters) and opens the replay with { tab: "replay", sid }.
 */
import { router } from "expo-router";

import { currentTTFilters, setTTFilters } from "@/features/typetorch/filters";

/** The custom range (YYYY-MM-DD, inclusive) of the UTC days a session spans (web replayHref). */
export function replayRange(session: { start: string; end?: string | null }): { from: string; to: string } {
	const day = (iso: string) => iso.slice(0, 10);
	return { from: day(session.start), to: day(session.end && session.end > session.start ? session.end : session.start) };
}

/** Opens a session's replay on the Recordings screen, the filter bar's range set to the session's days. */
export function openSessionReplay(backendId: string, session: { sid: string; start: string; end?: string | null }) {
	setTTFilters(backendId, { ...currentTTFilters(backendId), range: "custom", ...replayRange(session) });
	router.push({ pathname: "/tt/[backendId]/recordings", params: { backendId, tab: "replay", sid: session.sid } });
}
