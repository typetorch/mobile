/**
 * The web explorer's filter bar (backend/web/src/lib/filters.ts + components/FilterBar.tsx) for the phone: date range,
 * branch, artifact, device, new / returning, experiment variant. The web keeps it in the URL; the app keeps one state per
 * backend in memory, so it follows you from page to page like the web's links do (and resets when the app restarts).
 * Days are UTC, like the server's.
 */
import { keepPreviousData } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";

import { DEVICES, type Device, type Filters, type QueryName, type QueryResults } from "@/api/tt/types";
import { Button, Chips, Field, Icon, Segmented, Txt } from "@/components/ui";
import { radius, space, useTheme } from "@/theme";

import { useTTQuery } from "./hooks";

export const RANGE_PRESETS = ["1h", "6h", "1d", "7d", "30d", "90d"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number] | "custom";
export const DEFAULT_RANGE: RangePreset = "30d";
export const RANGE_LABELS: Record<RangePreset, string> = {
	"1h": "1 h",
	"6h": "6 h",
	"1d": "Today",
	"7d": "7 d",
	"30d": "30 d",
	"90d": "90 d",
	custom: "Custom",
};
export const HOUR_PRESETS: Partial<Record<RangePreset, number>> = { "1h": 1, "6h": 6 };

export interface FilterState {
	range: RangePreset;
	/** YYYY-MM-DD, for range = custom. */
	from?: string;
	/** YYYY-MM-DD, inclusive, for range = custom. */
	to?: string;
	branch?: string;
	art?: string;
	dev?: Device;
	players?: "new" | "returning";
	exp?: string;
	variant?: string;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** The server's filters (same as the web's toApiFilters): presets end now, hour presets as an ISO instant on a whole minute. */
export function toApiFilters(state: FilterState, now = Date.now()): Filters {
	const filters: Filters = {};
	const hours = HOUR_PRESETS[state.range];
	if (state.range === "custom") {
		if (state.from && DATE.test(state.from)) filters.from = state.from;
		if (state.to && DATE.test(state.to)) filters.to = state.to;
	} else if (hours) {
		filters.from = new Date(Math.floor(now / MINUTE_MS) * MINUTE_MS - hours * HOUR_MS).toISOString();
	} else {
		const days = Number.parseInt(state.range, 10);
		filters.from = isoDate(now - (days - 1) * DAY_MS);
	}
	if (state.branch) filters.branch = state.branch;
	if (state.art) filters.art = state.art;
	if (state.dev) filters.dev = state.dev;
	if (state.players) filters.players = state.players;
	if (state.exp && state.variant) filters.variant = { experiment: state.exp, variant: state.variant };
	return filters;
}

export function rangeOnly(filters: Filters): Filters {
	return { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) };
}

export function describeRange(state: FilterState): string {
	switch (state.range) {
		case "1h":
			return "the last 1 hour";
		case "6h":
			return "the last 6 hours";
		case "1d":
			return "today (UTC)";
		case "custom":
			return `${state.from ?? "start"} to ${state.to ?? "now"} (UTC)`;
		default:
			return `last ${Number.parseInt(state.range, 10)} days (UTC)`;
	}
}

export function activeFilterCount(state: FilterState): number {
	return (["branch", "art", "dev", "players"] as const).filter((k) => state[k]).length + (state.exp && state.variant ? 1 : 0);
}

// One state per backend, in memory -------------------------------------------------------------------------------------

const states = new Map<string, FilterState>();
/**
 * The "now" the presets end at, one per backend, so every hook instance on every open screen asks the same window. It
 * moves forward on pull to refresh and when a screen opens (`refreshFilterNow`), not on every render: the hour presets
 * would otherwise keep the `from` of the moment the state was made, and a refresh would show an ever-longer window.
 */
const nows = new Map<string, number>();
const listeners = new Set<() => void>();
const DEFAULT_STATE: FilterState = { range: DEFAULT_RANGE };

function getState(backendId: string): FilterState {
	return states.get(backendId) ?? DEFAULT_STATE;
}

function setState(backendId: string, next: FilterState) {
	states.set(backendId, next);
	for (const l of listeners) l();
}

function getNow(backendId: string): number {
	let now = nows.get(backendId);
	if (now === undefined) {
		now = Date.now();
		nows.set(backendId, now);
	}
	return now;
}

/** Moves a backend's "now" forward (pull to refresh; a screen opening once it is older than `olderThanMs`). */
export function refreshFilterNow(backendId: string, olderThanMs = 0) {
	const now = Date.now();
	const last = nows.get(backendId);
	if (last !== undefined && now - last < olderThanMs) return;
	nows.set(backendId, now);
	for (const l of listeners) l();
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** The filter bar's state for a backend, its server filters, a setter and a reset (keeps the range). */
export function useTTFilters(backendId: string) {
	const state = useSyncExternalStore(subscribe, () => getState(backendId));
	const now = useSyncExternalStore(subscribe, () => getNow(backendId));
	// Recomputed when the state or the backend's "now" changes (presets end then).
	const apiFilters = useMemo(() => toApiFilters(state, now), [state, now]);
	const set = useCallback((patch: Partial<FilterState>) => setState(backendId, { ...getState(backendId), ...patch }), [backendId]);
	const reset = useCallback(() => setState(backendId, { range: getState(backendId).range }), [backendId]);
	return { state, apiFilters, set, reset };
}

export interface AnalyticsOptions {
	enabled?: boolean;
	/** Use these filters instead of the filter bar's. */
	filters?: Filters;
	/** Keep showing the last answer while new options load. */
	keepPrevious?: boolean;
	staleTime?: number;
}

/** A named query with the filter bar's filters (or `opts.filters`), cached by name + filters + options (the web's useAnalytics). */
export function useTTAnalytics<N extends QueryName>(backendId: string, name: N, options: object = {}, opts: AnalyticsOptions = {}) {
	const { apiFilters } = useTTFilters(backendId);
	const filters = opts.filters ?? apiFilters;
	return useTTQuery<QueryResults[N]>(backendId, ["query", name, filters, options], (api, signal) => api.query(name, filters, options, signal), {
		enabled: opts.enabled ?? true,
		staleTime: opts.staleTime ?? 30_000,
		...(opts.keepPrevious ? { placeholderData: keepPreviousData } : {}),
	});
}

// The bar ---------------------------------------------------------------------------------------------------------------

const ANY = "";
const SEP = "|";

/** Range chips on top (`ranges={[]}`: a page with its own period hides them); a "Filters" button opens branch, artifact, device, new / returning and variant. */
export function FilterBar({ backendId, ranges }: { backendId: string; ranges?: RangePreset[] }) {
	const p = useTheme();
	const { state, apiFilters, set, reset } = useTTFilters(backendId);
	const [open, setOpen] = useState(false);
	const range = rangeOnly(apiFilters);
	const values = useTTAnalytics(backendId, "values", {}, { filters: range, enabled: open, staleTime: 120_000 });
	const experiments = useTTAnalytics(backendId, "experiment", {}, { filters: range, enabled: open, staleTime: 120_000 });
	const pairs = experiments.data && experiments.data.experiment === null ? experiments.data.experiments.filter((e) => e.variant) : [];
	const count = activeFilterCount(state);
	const today = isoDate(Date.now());

	const setRange = (next: RangePreset) => {
		if (next === "custom") set({ range: "custom", from: state.from ?? isoDate(Date.now() - 29 * DAY_MS), to: state.to ?? today });
		else set({ range: next });
	};
	const variantValue = state.exp && state.variant ? `${state.exp}${SEP}${state.variant}` : ANY;
	const pick = (options: { value: string }[] | undefined, current: string | undefined) => {
		const list = (options ?? []).map((o) => ({ value: o.value, label: o.value }));
		if (current && !list.some((o) => o.value === current)) list.unshift({ value: current, label: current });
		return [{ value: ANY, label: "any" }, ...list];
	};

	return (
		<View style={{ gap: space.sm }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
				<View style={{ flex: 1 }}>
					{ranges && ranges.length === 0 ? (
						<Txt variant="small">The date range doesn't apply here; the other filters do.</Txt>
					) : (
						<Chips options={(ranges ?? [...RANGE_PRESETS, "custom"]).map((r) => ({ value: r, label: RANGE_LABELS[r] }))} value={state.range} onChange={setRange} />
					)}
				</View>
				<Pressable
					onPress={() => setOpen((o) => !o)}
					hitSlop={6}
					style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 5, paddingHorizontal: 9, borderRadius: radius.md, borderWidth: 1, borderColor: count ? p.brand : p.border }}
				>
					<Icon name="options-outline" size={15} color={count ? p.brand : p.foreground} />
					<Txt variant="small" color={count ? p.brand : p.foreground}>
						{count ? `${count}` : "Filters"}
					</Txt>
				</Pressable>
			</View>
			{state.range === "custom" && !(ranges && ranges.length === 0) ? (
				<View style={{ flexDirection: "row", gap: space.sm }}>
					<View style={{ flex: 1 }}>
						<Field label="From (UTC)" value={state.from ?? ""} placeholder="YYYY-MM-DD" onChangeText={(t) => set({ from: t.trim() || undefined })} />
					</View>
					<View style={{ flex: 1 }}>
						<Field label="To (UTC, inclusive)" value={state.to ?? ""} placeholder={today} onChangeText={(t) => set({ to: t.trim() || undefined })} />
					</View>
				</View>
			) : null}
			{open ? (
				<View style={{ gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: p.border, backgroundColor: p.card }}>
					<Txt variant="label">Branch</Txt>
					<Chips options={pick(values.data?.branch, state.branch)} value={state.branch ?? ANY} onChange={(v) => set({ branch: v || undefined })} />
					<Txt variant="label">Artifact</Txt>
					<Chips options={pick(values.data?.art, state.art)} value={state.art ?? ANY} onChange={(v) => set({ art: v || undefined })} />
					<Txt variant="label">Device</Txt>
					<Chips options={[{ value: ANY, label: "any" }, ...DEVICES.map((d) => ({ value: d as string, label: d }))]} value={state.dev ?? ANY} onChange={(v) => set({ dev: (v || undefined) as Device | undefined })} />
					<Txt variant="label">Players</Txt>
					<Segmented
						options={[
							{ value: ANY, label: "All sessions" },
							{ value: "new", label: "New" },
							{ value: "returning", label: "Returning" },
						]}
						value={state.players ?? ANY}
						onChange={(v) => set({ players: (v || undefined) as FilterState["players"] })}
					/>
					<Txt variant="label">Experiment variant</Txt>
					<Chips
						options={[
							{ value: ANY, label: "any" },
							...(variantValue && !pairs.some((x) => `${x.experiment}${SEP}${x.variant}` === variantValue) ? [{ value: variantValue, label: `${state.exp}: ${state.variant}` }] : []),
							...pairs.map((x) => ({ value: `${x.experiment}${SEP}${x.variant}`, label: `${x.experiment}: ${x.variant} (${x.players})` })),
						]}
						value={variantValue}
						onChange={(v) => {
							if (!v) return set({ exp: undefined, variant: undefined });
							const at = v.indexOf(SEP);
							set({ exp: v.slice(0, at), variant: v.slice(at + 1) });
						}}
					/>
					{values.error ? <Txt variant="small">Couldn't load the branches and artifacts: {values.error.message}</Txt> : null}
					<View style={{ flexDirection: "row", gap: space.sm }}>
						{count ? <Button title="Clear" small icon="refresh" onPress={reset} /> : null}
						<Button title="Done" small variant="ghost" onPress={() => setOpen(false)} />
					</View>
				</View>
			) : null}
		</View>
	);
}
