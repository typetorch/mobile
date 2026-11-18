/**
 * The default widget program (docs/WIDGET_PROGRAM.md): what today's native path does, as plan / shape / tap.
 * Bundled by scripts/widgets/build-program.ts into one self-contained script (program.generated.ts); ES2020, no
 * imports at run time, no I/O.
 *
 *  - per-game widgets: one `/v1/mobile/live` request (360 minutes, the slots' metrics), the answer passed through (the
 *    game's name without emoji, its `health` with the Stats widgets' trend and colour flags: health.ts gameHealth);
 *  - all-games widgets ("*"): one request per signed-in backend (`releases` + the slots), merged (all-games.ts);
 *  - taps: `action:toggle:<backend id>` picks a game of an all-games widget, or clears the pick when it's picked.
 */
import { ALL, MAX_REQUESTS, allGames, allRequest } from "./all-games";
import { answerFor, liveRequest, metricIds } from "./answers";
import { gameHealth } from "./health";
import { cleanName, isObj } from "./json";
import type { Backend, JsonObject, PlanInput, PlanOutput, ShapeInput, ShapeOutput, TapInput, TapOutput, Widget } from "./types";

function stateOf(widget: Widget): JsonObject {
	const out: JsonObject = {};
	const s = widget && widget.state;
	if (isObj(s)) for (const k of Object.keys(s)) out[k] = s[k];
	return out;
}

function backendsOf(v: unknown): Backend[] {
	if (!Array.isArray(v)) return [];
	const out: Backend[] = [];
	for (const b of v) if (isObj(b) && typeof b.id === "string" && b.id) out.push(b as unknown as Backend);
	return out;
}

export function plan(input: PlanInput): PlanOutput {
	const widget = input.widget;
	const backends = backendsOf(input.backends);
	if (widget.backendId === ALL) {
		return { requests: backends.slice(0, MAX_REQUESTS).map((b) => allRequest(widget, b.id)) };
	}
	if (!backends.some((b) => b.id === widget.backendId)) return { requests: [] };
	return { requests: [liveRequest(widget.backendId, metricIds(widget.slots))] };
}

/** The answer with its game's name stripped of emoji (a copy, only when that changes anything). */
function withCleanName(live: JsonObject | null): JsonObject | null {
	if (!live || !isObj(live.game) || typeof live.game.name !== "string") return live;
	const name = cleanName(live.game.name);
	if (name == null || name === live.game.name) return live;
	return { ...live, game: { ...live.game, name } };
}

/** The answer with its `health` as the per-game widgets bind it (gameHealth; left out when it isn't an object). */
function withGameHealth(live: JsonObject | null): JsonObject | null {
	if (!live || !("health" in live)) return live;
	const health = gameHealth(live.health);
	const out: JsonObject = { ...live };
	if (health) out.health = health;
	else delete out.health;
	return out;
}

export function shape(input: ShapeInput): ShapeOutput {
	const widget = input.widget;
	const backends = backendsOf(input.backends);
	const responses = isObj(input.responses) ? input.responses : {};
	const state = stateOf(widget);
	const now = typeof input.now === "number" && isFinite(input.now) ? input.now : Date.now();
	if (widget.backendId === ALL) return allGames(widget, backends, responses, state, now);
	if (!backends.some((b) => b.id === widget.backendId)) return { live: null, state };
	const live = answerFor(responses[widget.backendId], liveRequest(widget.backendId, metricIds(widget.slots)));
	return { live: withGameHealth(withCleanName(live)), state };
}

/**
 * The game a toggle names: `<backend id>`, or by its place in games[] (`games.N`, `{games.N.id}` when the native side
 * didn't fill the template, or `N`), "" to clear. Null: no such game (nothing changes).
 */
function toggleTarget(arg: string, state: JsonObject, backends: Backend[]): string | null {
	const x = arg.trim();
	if (x === "") return "";
	const ids: string[] = [];
	if (Array.isArray(state.games)) {
		for (const id of state.games) if (typeof id === "string") ids.push(id);
	} else {
		for (const b of backends.slice(0, 6)) ids.push(b.id);
	}
	if (ids.indexOf(x) >= 0 || backends.some((b) => b.id === x)) return x;
	const m = /^\{?\s*games\.(\d{1,2})(?:\.id)?\s*\}?$/.exec(x) || /^(\d{1,2})$/.exec(x);
	if (m) {
		const n = Number(m[1]);
		return n < ids.length ? ids[n] : null;
	}
	// An id the program hasn't seen yet (no games listed): taken as it is.
	return ids.length || backends.length ? null : x;
}

export function tap(input: TapInput): TapOutput {
	const state = stateOf(input.widget);
	let action = typeof input.action === "string" ? input.action.trim() : "";
	if (action.indexOf("action:") === 0) action = action.slice("action:".length);
	if (action.indexOf("toggle:") === 0) {
		const target = toggleTarget(action.slice("toggle:".length), state, backendsOf(input.backends));
		if (target == null) return { state };
		// Picks it, or clears the pick when it is already picked (Store.kt toggleWidgetFilter).
		if (target === "" || state.filter === target) delete state.filter;
		else state.filter = target;
	}
	return { state };
}
