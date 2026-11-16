/**
 * The move from another server (GET /v1/admin/migrate) and ingest pressure: the plain helpers the history-importing
 * banner and the Overview's busy note use (copied from backend/web/src/lib/migrate.ts).
 */
import type { IngestPressure, MigrateAction, MigrateDay, MigrateState, MigrateStatus } from "./types";

/** States in which a move is under way (the banner shows). */
const ACTIVE: ReadonlySet<MigrateState> = new Set(["running", "paused", "waiting"]);

/** Day states that are finished (checked against the source, whatever the outcome). */
const DAY_DONE: ReadonlySet<MigrateDay["state"]> = new Set(["match", "missing", "differs", "duplicates", "sent"]);

export function dayDone(day: Pick<MigrateDay, "state">): boolean {
	return DAY_DONE.has(day.state);
}

/** The source's host for a sentence ("old.example.com", "Basin"), or "the old server" when the URL doesn't parse. */
export function sourceHost(status: Pick<MigrateStatus, "source">): string {
	const source = status.source;
	if (source?.kind === "basin") return "Basin";
	const url = source?.kind === "backend" ? source.url : undefined;
	if (!url) return "the old server";
	const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)?.[1];
	return host || "the old server";
}

/**
 * The analytics pages' banner while a move still imports event history: "History before <day> still importing" (the
 * oldest events day already done), else "History is still importing from <host>". Null when nothing is importing.
 */
export function historyBannerText(status: MigrateStatus | null | undefined): string | null {
	// A move to Basin empties nothing here: this server's charts stay whole.
	if (!status || !ACTIVE.has(status.state) || status.direction === "to-basin") return null;
	const events = (status.days ?? []).filter((d) => d.table === "events");
	if (!events.some((d) => !dayDone(d))) return null;
	const done = events
		.filter(dayDone)
		.map((d) => d.day)
		.sort();
	return done.length ? `History before ${done[0]} still importing` : `History is still importing from ${sourceHost(status)}`;
}

/** Whether the backend answered busy (503) to ingest in the minute before its own clock. */
export function recentlyBusy(ingest: IngestPressure | null | undefined, now: number, withinMs = 60_000): boolean {
	const at = ingest?.lastBusyAt;
	return typeof at === "number" && at <= now + 1_000 && now - at <= withinMs;
}

/** Days not checked yet (pending or importing). */
export function daysLeft(days: readonly Pick<MigrateDay, "state">[]): number {
	return days.filter((d) => !dayDone(d)).length;
}

/** How often the Settings card asks: every 5 s while the move runs or waits, else every minute. */
export function migratePollMs(state: MigrateState | undefined): number {
	return state === "running" || state === "waiting" ? 5_000 : 60_000;
}

/** The buttons a state offers (the backend answers 409 when one doesn't apply after all). */
export function migrateActions(state: MigrateState): MigrateAction[] {
	switch (state) {
		case "running":
		case "waiting":
			return ["pause", "cancel"];
		case "paused":
		case "failed":
			return ["resume", "cancel"];
		case "needs_decision":
			return ["cancel"];
		default:
			return [];
	}
}
