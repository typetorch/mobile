/**
 * The web explorer's filter bar (backend/web/src/lib/filters.ts + components/FilterBar.tsx) for the phone: date range,
 * branch, artifact, device, new / returning, experiment variant, audience. The web keeps it in the URL; the app keeps
 * one state per backend that follows you from page to page like the web's links do, saved on the phone (AsyncStorage)
 * so it survives a restart, and written into "Copy link to this view" links with the web's keys (`range`, `from`, `to`,
 * `branch`, `art`, `dev`, `players`, `exp`, `variant`, `country`, `lang`, `age`, `prem`, `source`). A link opened on
 * the phone (typetorch://…?range=7d&branch=dev) sets the bar to its values. Days are UTC, like the server's.
 */
import { keepPreviousData } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";

import { ACCOUNT_AGES, DEVICES, type AccountAge, type Device, type Filters, type QueryName, type QueryResults } from "@/api/tt/types";
import { Button, Chips, Field, Icon, Segmented, Txt } from "@/components/ui";
import { radius, space, useTheme } from "@/theme";

import { useTTQuery } from "./hooks";
import { readStored, writeStored } from "./persist";

export const RANGE_PRESETS = ["1h", "6h", "1d", "3d", "7d", "30d", "90d", "deploy"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number] | "custom";
export const DEFAULT_RANGE: RangePreset = "30d";
export const RANGE_LABELS: Record<RangePreset, string> = {
	"1h": "1 h",
	"6h": "6 h",
	"1d": "Today",
	"3d": "3 d",
	"7d": "7 d",
	"30d": "30 d",
	"90d": "90 d",
	deploy: "Since deploy",
	custom: "Custom",
};
export const HOUR_PRESETS: Partial<Record<RangePreset, number>> = { "1h": 1, "6h": 6 };
/** The branch "Since last prod deploy" reads its release from (the deploy history). */
export const PROD_BRANCH = "prod";

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
	/** Audience (player-level, matched on their join rows): ISO country code, upper case. */
	country?: string;
	/** Language code, lower case ("en"). */
	lang?: string;
	/** Roblox account-age bucket. */
	age?: AccountAge;
	/** Premium at the join. */
	prem?: "true" | "false";
	/** Join source (direct, teleport, referral, ...). */
	source?: string;
	/** range = deploy: when the last prod release started (unix ms), looked up by useTTFilters (never saved or linked). */
	sinceMs?: number;
}

/** The keys the filter bar owns in a link; pages keep their own (pid, funnel, ...) alongside. */
export const FILTER_KEYS = ["range", "from", "to", "branch", "art", "dev", "players", "exp", "variant", "country", "lang", "age", "prem", "source"] as const;
/** The audience filters (player-level: a player matches when one of their join rows in the range has the value). */
export const AUDIENCE_KEYS = ["country", "lang", "age", "prem", "source"] as const;
export type AudienceKey = (typeof AUDIENCE_KEYS)[number];

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** The filter state a link's (or the saved) parameters describe; anything the backend wouldn't take is dropped. */
export function readFilters(get: (key: string) => string | null | undefined): FilterState {
	const read = (key: string) => {
		const v = get(key)?.trim();
		return v ? v : undefined;
	};
	const rawRange = read("range");
	const range: RangePreset = rawRange === "custom" || (RANGE_PRESETS as readonly string[]).includes(rawRange ?? "") ? (rawRange as RangePreset) : DEFAULT_RANGE;
	const state: FilterState = { range };
	const from = read("from");
	const to = read("to");
	if (range === "custom") {
		if (from && DATE.test(from)) state.from = from;
		if (to && DATE.test(to)) state.to = to;
	}
	for (const key of ["branch", "art", "exp", "variant"] as const) {
		const v = read(key);
		if (v) state[key] = v;
	}
	const dev = read("dev");
	if (dev && (DEVICES as string[]).includes(dev)) state.dev = dev as Device;
	const players = read("players");
	if (players === "new" || players === "returning") state.players = players;
	const country = read("country");
	if (country && /^[A-Za-z]{2}$/.test(country)) state.country = country.toUpperCase();
	const lang = read("lang");
	if (lang && /^[A-Za-z]{2,3}$/.test(lang)) state.lang = lang.toLowerCase();
	const age = read("age");
	if (age && (ACCOUNT_AGES as readonly string[]).includes(age)) state.age = age as AccountAge;
	const prem = read("prem");
	if (prem === "true" || prem === "false") state.prem = prem;
	const source = read("source");
	if (source && /^[a-z][a-z0-9_]{0,31}$/.test(source)) state.source = source;
	return state;
}

/** The state as link parameters (the web's writeFilters): defaults left out. */
export function filtersToParams(state: FilterState): Record<string, string> {
	const out: Record<string, string> = {};
	if (state.range !== DEFAULT_RANGE) out.range = state.range;
	if (state.range === "custom") {
		if (state.from) out.from = state.from;
		if (state.to) out.to = state.to;
	}
	for (const key of ["branch", "art", "dev", "players", "exp", "variant", ...AUDIENCE_KEYS] as const) {
		const v = state[key];
		if (v) out[key] = v;
	}
	return out;
}

/** Does a link carry any filter key? (Then it sets the bar.) */
export function hasFilterParams(params: Record<string, unknown>): boolean {
	return FILTER_KEYS.some((k) => typeof params[k] === "string" && params[k] !== "");
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
	} else if (state.range === "deploy") {
		filters.from = state.sinceMs !== undefined && state.sinceMs < now ? new Date(Math.floor(state.sinceMs / MINUTE_MS) * MINUTE_MS).toISOString() : isoDate(now);
	} else {
		const days = Number.parseInt(state.range, 10);
		filters.from = isoDate(now - (days - 1) * DAY_MS);
	}
	if (state.branch) filters.branch = state.branch;
	if (state.art) filters.art = state.art;
	if (state.dev) filters.dev = state.dev;
	if (state.players) filters.players = state.players;
	if (state.exp && state.variant) filters.variant = { experiment: state.exp, variant: state.variant };
	if (state.country) filters.country = state.country;
	if (state.lang) filters.lang = state.lang;
	if (state.age) filters.age = state.age;
	if (state.prem) filters.prem = state.prem === "true";
	if (state.source) filters.source = state.source;
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
		case "deploy":
			return state.sinceMs !== undefined ? `since the last prod deploy (${new Date(state.sinceMs).toISOString().slice(0, 16).replace("T", " ")} UTC)` : "since the last prod deploy";
		case "custom":
			return `${state.from ?? "start"} to ${state.to ?? "now"} (UTC)`;
		default:
			return `last ${Number.parseInt(state.range, 10)} days (UTC)`;
	}
}

export function activeFilterCount(state: FilterState): number {
	return (["branch", "art", "dev", "players", ...AUDIENCE_KEYS] as const).filter((k) => state[k]).length + (state.exp && state.variant ? 1 : 0);
}

/** How many audience filters are set. */
export function audienceFilterCount(state: FilterState): number {
	return AUDIENCE_KEYS.filter((k) => state[k]).length;
}

// One state per backend, kept on the phone ------------------------------------------------------------------------------

const STORAGE_PREFIX = "tt.filters.v1.";
const states = new Map<string, FilterState>();
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const DEFAULT_STATE: FilterState = { range: DEFAULT_RANGE };

function emit() {
	for (const l of listeners) l();
}

function getState(backendId: string): FilterState {
	return states.get(backendId) ?? DEFAULT_STATE;
}

/** Loads the saved bar of a backend once (a link applied before the load wins over it). */
function ensureLoaded(backendId: string): Promise<void> {
	if (loaded.has(backendId)) return Promise.resolve();
	const running = loading.get(backendId);
	if (running) return running;
	const p = readStored(STORAGE_PREFIX + backendId).then((text) => {
		if (!loaded.has(backendId) && text) {
			try {
				const saved = JSON.parse(text) as Record<string, string>;
				states.set(backendId, readFilters((k) => (typeof saved[k] === "string" ? saved[k] : undefined)));
			} catch {
				// a bad save: the defaults
			}
		}
		loaded.add(backendId);
		loading.delete(backendId);
		emit();
	});
	loading.set(backendId, p);
	return p;
}

/** Replaces a backend's bar (and saves it). */
export function setTTFilters(backendId: string, next: FilterState) {
	const { sinceMs: _since, ...keep } = next;
	states.set(backendId, keep);
	loaded.add(backendId);
	const params = filtersToParams(keep);
	writeStored(STORAGE_PREFIX + backendId, Object.keys(params).length ? JSON.stringify(params) : null);
	emit();
}

/** The current bar of a backend without subscribing (links). */
export function currentTTFilters(backendId: string): FilterState {
	return getState(backendId);
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => {
		listeners.delete(l);
	};
}

/** When the last prod release started (unix ms), null when there is none (or no access); for range = deploy. */
export function useLastProdDeploy(backendId: string, enabled = true) {
	return useTTQuery(backendId, ["last-prod-deploy"], (api, signal) => api.fleetDeploys({ branch: PROD_BRANCH, limit: 1 }, signal).then((page) => page.deploys[0]?.at ?? null), {
		enabled,
		staleTime: 60_000,
		retry: false,
	});
}

/**
 * The filter bar's state for a backend, its server filters, a setter and a reset (keeps the range). `pending` while the
 * saved bar loads or "since deploy" looks its release up: queries wait instead of loading the wrong range first.
 */
export function useTTFilters(backendId: string) {
	const stored = useSyncExternalStore(subscribe, () => getState(backendId));
	const isLoaded = useSyncExternalStore(subscribe, () => loaded.has(backendId));
	useEffect(() => {
		void ensureLoaded(backendId);
	}, [backendId]);
	const sinceDeploy = stored.range === "deploy";
	const lastDeploy = useLastProdDeploy(backendId, sinceDeploy);
	const sinceMs = sinceDeploy ? (lastDeploy.data ?? undefined) : undefined;
	const state = useMemo(() => (sinceMs !== undefined ? { ...stored, sinceMs } : stored), [stored, sinceMs]);
	// Recomputed when the state changes: presets end "now".
	const apiFilters = useMemo(() => toApiFilters(state), [state]);
	const set = useCallback((patch: Partial<FilterState>) => setTTFilters(backendId, { ...getState(backendId), ...patch }), [backendId]);
	const reset = useCallback(() => setTTFilters(backendId, { range: getState(backendId).range }), [backendId]);
	const pending = !isLoaded || (sinceDeploy && lastDeploy.isPending && lastDeploy.fetchStatus !== "idle");
	return { state, apiFilters, set, reset, pending };
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
	const { apiFilters, pending } = useTTFilters(backendId);
	const filters = opts.filters ?? apiFilters;
	return useTTQuery<QueryResults[N]>(backendId, ["query", name, filters, options], (api, signal) => api.query(name, filters, options, signal), {
		enabled: (opts.enabled ?? true) && (!!opts.filters || !pending),
		staleTime: opts.staleTime ?? 30_000,
		...(opts.keepPrevious ? { placeholderData: keepPreviousData } : {}),
	});
}

// The bar ---------------------------------------------------------------------------------------------------------------

const ANY = "";
const SEP = "|";
const AUDIENCE_LABELS: Record<AudienceKey, string> = { country: "Country", lang: "Language", age: "Account age", prem: "Premium", source: "Join source" };

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
			{state.range === "deploy" && !(ranges && ranges.length === 0) ? <Txt variant="small">{describeRange(state)[0]?.toUpperCase()}{describeRange(state).slice(1)}</Txt> : null}
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
					{audienceFilterCount(state) ? (
						<>
							<Txt variant="label">Audience</Txt>
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
								{AUDIENCE_KEYS.filter((k) => state[k]).map((k) => (
									<Pressable key={k} onPress={() => set({ [k]: undefined })} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.muted }}>
										<Txt variant="small" color={p.foreground}>
											{AUDIENCE_LABELS[k]}: {state[k]}
										</Txt>
										<Icon name="close" size={12} color={p.mutedForeground} />
									</Pressable>
								))}
							</View>
						</>
					) : null}
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
