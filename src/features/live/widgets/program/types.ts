/**
 * The widget program's inputs and outputs (docs/WIDGET_PROGRAM.md, The program). Types only: nothing here is in the
 * bundle.
 */

export type Json = null | boolean | number | string | Json[] | JsonObject;
export type JsonObject = { [key: string]: Json };

/** A signed-in backend (the program never sees tokens). */
export type Backend = { id: string; name: string; url: string };

export type Widget = {
	id: number;
	/** A backend id, or "*" (all games). */
	backendId: string;
	/** Metric ids, "" = an empty slot. */
	slots: string[];
	/** The program's own JSON (from taps and shape), null / absent at first. */
	state?: JsonObject | null;
};

export type Request = { backend: string; path: string; query: Record<string, string> };

/** One cached answer. `at`: when it was fetched (ms), when the native side says. */
export type Answer = {
	ok: boolean;
	body?: Json;
	status?: number;
	error?: string;
	at?: number;
	okAt?: number;
	time?: number;
	fetchedAt?: number;
};

/** backend id → "<path>?<query>" → the newest answer of that request. */
export type Responses = { [backendId: string]: { [key: string]: Answer } | null | undefined };

export type PlanInput = { widget: Widget; backends: Backend[]; now?: number };
export type ShapeInput = {
	widget: Widget;
	backends: Backend[];
	responses: Responses;
	size?: { w: number; h: number };
	night?: boolean;
	now?: number;
};
/** `backends` isn't in the doc's signature; used when the native side passes it (index taps without state). */
export type TapInput = { widget: Widget; action: string; now?: number; backends?: Backend[] };

export type PlanOutput = { requests: Request[] };
/** live null: no answer with data yet (the native side draws loading / unreachable / signedOut from the cache). */
export type ShapeOutput = { live: JsonObject | null; state: JsonObject };
export type TapOutput = { state: JsonObject };
