/**
 * The web explorer's live feeds (EventSource there, XHR streaming here: useEventStream in features/maps/live-streams.ts):
 *
 *   - Fleet (web pages/Fleet.tsx useFleetStream): GET /v1/fleet/stream?branch; `server`, `alert`, `alert_ack`, `report`,
 *     `deploy` events refetch what changed and go into a short log.
 *   - Errors (web pages/Errors.tsx useErrorStream): GET /v1/live?topics=error; an `error` event refetches the error lists
 *     (debounced).
 *
 * While a stream is down the screens poll instead (Fleet every 5 s, Errors every 30 s).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SseMessage } from "@/api/tt/sse";
import type { FleetAlert } from "@/api/tt/types";
import { useEventStream, type StreamStatus } from "@/features/maps/live-streams";
import { plural, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";

export interface LiveEvent {
	at: number;
	type: string;
	text: string;
}

const FLEET_TYPES = new Set(["server", "alert", "alert_ack", "report", "deploy"]);

/** One line for a fleet event (web describe). */
export function describeFleetEvent(type: string, data: Record<string, unknown>): string {
	if (type === "server") {
		const s = data.server as { job?: string; players?: number; health?: string } | undefined;
		return `server ${shortId(s?.job, 6)} ${String(data.change)} (${plural(s?.players ?? 0, "player")}, ${s?.health ?? "?"})`;
	}
	if (type === "alert") {
		const a = data.alert as FleetAlert | undefined;
		return `${a?.level ?? ""} alert ${a?.code ?? ""}: ${a?.message ?? ""}`;
	}
	if (type === "report") return `deploy #${String(data.seq)}: ${shortId(String(data.job), 6)} ${String(data.result)}`;
	if (type === "deploy") return `deploy #${String(data.seq)} started on ${String(data.branch)} (${String(data.artifact)})`;
	if (type === "alert_ack") return `alert ${String(data.id)} acknowledged`;
	return type;
}

/** Live fleet updates: refetches what changed (at most once a second per kind) and keeps the last 50 events. */
export function useFleetStream(backendId: string, branch: string): { status: StreamStatus; error?: string; log: LiveEvent[] } {
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const [log, setLog] = useState<LiveEvent[]>([]);
	const pending = useRef(new Set<string>());
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const flush = useCallback(() => {
		timer.current = undefined;
		for (const key of pending.current) void client.invalidateQueries({ queryKey: ["tt", backendId, "fleet", key] });
		pending.current.clear();
	}, [client, backendId]);
	useEffect(() => () => clearTimeout(timer.current), []);
	const onMessage = useCallback(
		(m: SseMessage) => {
			if (!FLEET_TYPES.has(m.event)) return;
			let data: Record<string, unknown> = {};
			try {
				data = JSON.parse(m.data) as Record<string, unknown>;
			} catch {
				// keep the type
			}
			setLog((current) => [{ at: Date.now(), type: m.event, text: describeFleetEvent(m.event, data) }, ...current].slice(0, 50));
			if (m.event === "server") pending.current.add("servers").add("gone");
			if (m.event === "alert" || m.event === "alert_ack") pending.current.add("alerts");
			if (m.event === "report" || m.event === "deploy") pending.current.add("report").add("reports");
			if (!timer.current) timer.current = setTimeout(flush, 1000);
		},
		[flush],
	);
	const path = `/v1/fleet/stream${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`;
	const stream = useEventStream(api, path, true, onMessage);
	return { ...stream, log };
}

/** Refetches the error lists whenever the backend says errors came in (debounced 1.5 s), polling every 30 s while the stream is down. */
export function useErrorStream(backendId: string): { status: StreamStatus; error?: string } {
	const { api } = useBackend(backendId);
	const client = useQueryClient();
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const refetch = useCallback(() => void client.invalidateQueries({ queryKey: ["tt", backendId, "errors"] }), [client, backendId]);
	const onMessage = useCallback(
		(m: SseMessage) => {
			if (m.event !== "error" || !m.data) return;
			clearTimeout(timer.current);
			timer.current = setTimeout(refetch, 1500);
		},
		[refetch],
	);
	return useEventStream(api, "/v1/live?topics=error", true, onMessage, { onPoll: refetch, pollMs: 30_000 });
}

/** The stream's state as a word and a tone (the web's Status chip). */
export function streamLabel(status: StreamStatus): { text: string; tone: "good" | "critical" | "warning" } {
	return status === "live" ? { text: "live", tone: "good" } : status === "retrying" ? { text: "stream lost, retrying", tone: "critical" } : { text: "connecting", tone: "warning" };
}
