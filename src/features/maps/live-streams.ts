/**
 * Plans/34 hooks (port of the web explorer's lib/live-streams.ts): the server live map's stream poll (GET
 * /v1/fleet/servers/<job>/streams about every second while the screen is open and the app in front; the screen's server
 * watch makes the kernel post them), the Live map screen's fleet-wide watch (POST /v1/fleet/live-map/watch every 20 s)
 * and its poll (GET /v1/fleet/live-map every ~3 s), a ticker for the interpolated dots; and the SSE streams the web reads
 * with EventSource (Fleet: GET /v1/fleet/stream, Errors: GET /v1/live?topics=error), here over XHR streaming with the
 * Bearer token, reopened with a backoff, with a poll while it is down.
 *
 * Frames hold player names and positions: they live in this component state only (never the query cache, storage or a
 * link) and go with the screen.
 */
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { Api } from "@/api/backend";
import type { SseMessage } from "@/api/tt/sse";
import type { LiveMapServer, ServerStreams, StreamFrame } from "@/api/tt/types";

import { colorFor, isPlaced, LIVE_DELAY_MS, mergeFrames, playersAt, renderTime, type LiveDot } from "./live-map";

export const STREAMS_POLL_MS = 1_000;
export const LIVE_MAP_POLL_MS = 3_000;
export const LIVE_MAP_WATCH_EVERY_MS = 20_000;
/** The server watch (remote debug): the kernel posts streams while it holds (lapses after 60 s). */
export const SERVER_WATCH_EVERY_MS = 20_000;
/** The interpolation's redraw rate (10 a second: smooth enough, cheap for the renderer). */
export const TICK_MS = 100;

const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
/** The app is in the background (the web's document.hidden). */
const hidden = () => AppState.currentState !== "active";

export interface StreamsState {
	declared?: ServerStreams["declared"];
	frames: StreamFrame[];
	/** When the newest frame arrived (this phone's clock, ms). */
	arrivedAt: number;
	error?: string;
	/** At least one answer came. */
	loaded: boolean;
}

/** Polls one server's streams while `enabled` (a live server, an owner's session). */
export function useServerStreams(api: Pick<Api, "serverStreams"> | null, job: string, enabled: boolean, every = STREAMS_POLL_MS): StreamsState {
	const [state, setState] = useState<StreamsState>({ frames: [], arrivedAt: 0, loaded: false });
	useEffect(() => {
		if (!enabled || !api) return;
		const controller = new AbortController();
		let since: number | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		const tick = async () => {
			if (!hidden()) {
				try {
					const answer = await api.serverStreams(job, since, controller.signal);
					if (stopped) return;
					const last = answer.frames[answer.frames.length - 1];
					if (last) since = Math.max(since ?? 0, last.t);
					setState((s) => {
						const frames = answer.frames.length ? mergeFrames(s.frames, answer.frames) : s.frames;
						const grew = frames[frames.length - 1]?.t !== s.frames[s.frames.length - 1]?.t;
						return { declared: answer.declared, frames, arrivedAt: grew ? Date.now() : s.arrivedAt, loaded: true };
					});
				} catch (error) {
					if (stopped || isAbort(error)) return;
					setState((s) => ({ ...s, error: error instanceof Error ? error.message : String(error), loaded: true }));
				}
			}
			if (!stopped) timer = setTimeout(tick, every);
		};
		void tick();
		return () => {
			stopped = true;
			controller.abort();
			if (timer) clearTimeout(timer);
		};
	}, [api, job, enabled, every]);
	return state;
}

/**
 * Holds a server watch while `enabled` (POST /v1/fleet/servers/<job>/watch every 20 s, and when the app comes back): the
 * kernel then polls the backend and posts its streams. The web's server page holds it for its whole session.
 */
export function useServerWatch(api: Pick<Api, "watchServer"> | null, job: string, enabled: boolean): { error?: string; watching: boolean } {
	const [state, setState] = useState<{ error?: string; watching: boolean }>({ watching: false });
	useEffect(() => {
		if (!enabled || !api) return;
		const controller = new AbortController();
		const watch = () => {
			if (hidden()) return;
			api.watchServer(job, controller.signal).then(
				() => setState({ watching: true }),
				(e: unknown) => {
					if (!isAbort(e)) setState({ watching: false, error: e instanceof Error ? e.message : String(e) });
				},
			);
		};
		watch();
		const timer = setInterval(watch, SERVER_WATCH_EVERY_MS);
		const sub = AppState.addEventListener("change", (s) => {
			if (s === "active") watch();
		});
		return () => {
			controller.abort();
			clearInterval(timer);
			sub.remove();
		};
	}, [api, job, enabled]);
	return state;
}

/** Date.now(), refreshed every `ms` while `on` (the dots' interpolation). */
export function useTicker(on: boolean, ms = TICK_MS): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!on) return;
		const timer = setInterval(() => setNow(Date.now()), ms);
		return () => clearInterval(timer);
	}, [on, ms]);
	return now;
}

/** One server on the Live map: its two latest frames (to move between) and when the newest arrived. */
export interface LiveServer extends Omit<LiveMapServer, "players" | "at"> {
	frames: StreamFrame[];
	arrivedAt: number;
}

export interface LiveMapState {
	servers: LiveServer[];
	error?: string;
	loaded: boolean;
	/** The watch was refused (the read-only role: owners only). */
	watchError?: string;
}

/** Holds the fleet-wide live map watch and polls every server's latest positions while `enabled`. */
export function useLiveMap(api: Pick<Api, "watchLiveMap" | "liveMap"> | null, enabled: boolean, every = LIVE_MAP_POLL_MS): LiveMapState {
	const [state, setState] = useState<LiveMapState>({ servers: [], loaded: false });
	useEffect(() => {
		if (!enabled || !api) return;
		const controller = new AbortController();
		const watch = () => {
			if (hidden()) return;
			api.watchLiveMap(controller.signal).then(
				() => setState((s) => (s.watchError ? { ...s, watchError: undefined } : s)),
				(e: unknown) => {
					if (!isAbort(e)) setState((s) => ({ ...s, watchError: e instanceof Error ? e.message : String(e) }));
				},
			);
		};
		watch();
		const watchTimer = setInterval(watch, LIVE_MAP_WATCH_EVERY_MS);
		const sub = AppState.addEventListener("change", (s) => {
			if (s === "active") watch();
		});
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		const tick = async () => {
			if (!hidden()) {
				try {
					const answer = await api.liveMap(controller.signal);
					if (stopped) return;
					setState((s) => {
						const held = new Map(s.servers.map((x) => [x.job, x]));
						const servers = answer.servers.map((x): LiveServer => {
							const before = held.get(x.job);
							const frame: StreamFrame = { t: x.at, s: { positions: { players: x.players } } };
							const last = before?.frames[before.frames.length - 1];
							if (before && last && last.t === x.at) return { ...before, branch: x.branch, artifact: x.artifact };
							return { job: x.job, branch: x.branch, artifact: x.artifact, frames: [...(last ? [last] : []), frame], arrivedAt: Date.now() };
						});
						return { ...s, servers, loaded: true, error: undefined };
					});
				} catch (error) {
					if (stopped || isAbort(error)) return;
					setState((s) => ({ ...s, error: error instanceof Error ? error.message : String(error), loaded: true }));
				}
			}
			if (!stopped) timer = setTimeout(tick, every);
		};
		void tick();
		return () => {
			stopped = true;
			controller.abort();
			clearInterval(watchTimer);
			if (timer) clearTimeout(timer);
			sub.remove();
		};
	}, [api, enabled, every]);
	return state;
}

/** Every server's dots at the screen's clock `now`, coloured per server (web pages/Live.tsx liveDots). */
export function liveDots(servers: readonly LiveServer[], now: number): LiveDot[] {
	const out: LiveDot[] = [];
	for (const s of servers) {
		const newest = s.frames[s.frames.length - 1];
		if (!newest) continue;
		const at = renderTime(newest.t, now - s.arrivedAt, LIVE_DELAY_MS);
		for (const p of playersAt(s.frames, at)) {
			if (isPlaced(p)) out.push({ key: `${s.job}:${p.u}`, name: p.n, x: p.x, y: p.y, z: p.z, color: colorFor(s.job), group: s.job });
		}
	}
	return out;
}

// SSE ---------------------------------------------------------------------------------------------------------------------

export type StreamStatus = "connecting" | "live" | "retrying";

/** Waits before reopening a dropped stream (then the last one, again and again). */
export const SSE_RETRY_MS = [1_000, 3_000, 10_000, 30_000] as const;

/**
 * Holds an SSE stream (`api.eventStream`) while `enabled` and the app is in front: each message goes to `onMessage`; a
 * dropped or refused stream is reopened after SSE_RETRY_MS, and `onPoll` runs every `pollMs` while it is not live (the
 * fallback: the screen refetches what the stream would have told it). A 401 / 403 / 404 stops reopening (the poll goes on).
 */
export function useEventStream(
	api: Pick<Api, "eventStream"> | null,
	path: string,
	enabled: boolean,
	onMessage: (message: SseMessage) => void,
	options: { onPoll?: () => void; pollMs?: number } = {},
): { status: StreamStatus; error?: string } {
	const [state, setState] = useState<{ status: StreamStatus; error?: string }>({ status: "connecting" });
	const handlers = useRef({ onMessage, onPoll: options.onPoll });
	handlers.current = { onMessage, onPoll: options.onPoll };
	const pollMs = options.pollMs ?? 5_000;
	useEffect(() => {
		if (!enabled || !api) return;
		let stopped = false;
		let live = false;
		let tries = 0;
		let given = false;
		let connection: { close(): void } | null = null;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const open = () => {
			if (stopped || hidden() || connection) return;
			setState((s) => (s.status === "live" ? { status: "connecting" } : s));
			connection = api.eventStream(path, {
				onOpen: () => {
					tries = 0;
					live = true;
					setState({ status: "live" });
				},
				onMessage: (m) => {
					if (m.event === "hello") {
						live = true;
						setState({ status: "live" });
					}
					handlers.current.onMessage(m);
				},
				onClose: ({ status, message }) => {
					connection = null;
					live = false;
					if (stopped) return;
					setState({ status: "retrying", error: message });
					if (status === 401 || status === 403 || status === 404) {
						given = true;
						return;
					}
					const wait = SSE_RETRY_MS[Math.min(tries, SSE_RETRY_MS.length - 1)] as number;
					tries++;
					retry = setTimeout(open, wait);
				},
			});
		};
		open();
		const poll = setInterval(() => {
			if (!live && !hidden()) handlers.current.onPoll?.();
		}, pollMs);
		const sub = AppState.addEventListener("change", (s) => {
			if (s === "active") {
				if (!given) open();
			} else {
				// Backgrounded: close it (the OS would anyway); reopened when the app comes back.
				if (retry) clearTimeout(retry);
				connection?.close();
				connection = null;
				live = false;
			}
		});
		return () => {
			stopped = true;
			if (retry) clearTimeout(retry);
			clearInterval(poll);
			sub.remove();
			connection?.close();
		};
	}, [api, path, enabled, pollMs]);
	return state;
}
