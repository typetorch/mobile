/**
 * The audience and churn pieces the phone needs from the web (backend/web/src/lib/audience.ts, components/ChurnRisk.tsx
 * and their types in lib/types.ts): names for the join data's codes (country, language, account age, join source), the
 * `demographics` and `churn` query answers. Kept apart from types.ts; the queries go through `api.raw` (useTTRawQuery).
 */
import { COUNTRY_NAMES, LANGUAGE_NAMES } from "./locale-names";
import { ACCOUNT_AGES, type AccountAge, type Filters } from "./types";

// The `demographics` query ------------------------------------------------------------------------------------------------

export type DemographicDimension = "country" | "language" | "accountAge" | "premium" | "device";

export interface DemographicRow {
	/** ISO country code, language code, account-age bucket, "true"/"false", device; null = the join didn't say. */
	value: string | null;
	players: number;
	share: number;
}

/** The `demographics` query: who plays, from our own join events. */
export interface DemographicsResult {
	from: string;
	to: string;
	players: number;
	dimensions: Record<DemographicDimension, DemographicRow[]>;
}

// Names ----------------------------------------------------------------------------------------------------------------------

function displayNames(type: "region" | "language"): { of(code: string): string | undefined } | undefined {
	try {
		// Hermes (Expo Go) may not have Intl.DisplayNames; then the static English tables in locale-names.ts name them.
		const Ctor = (Intl as unknown as { DisplayNames?: new (locales: string[], options: { type: string }) => { of(code: string): string | undefined } }).DisplayNames;
		return Ctor ? new Ctor(["en"], { type }) : undefined;
	} catch {
		return undefined;
	}
}

const regionNames = displayNames("region");
const languageNames = displayNames("language");

/** Intl's name when it has a real one (not the code back), else undefined. */
function intlName(names: { of(code: string): string | undefined } | undefined, code: string): string | undefined {
	try {
		const name = names?.of(code);
		return name && name.toLowerCase() !== code.toLowerCase() ? name : undefined;
	} catch {
		return undefined;
	}
}

/** "US" -> "United States"; anything neither Intl nor the static table knows stays as it is. */
export function countryName(code: string): string {
	if (!/^[A-Za-z]{2}$/.test(code)) return code;
	const upper = code.toUpperCase();
	return intlName(regionNames, upper) ?? COUNTRY_NAMES[upper] ?? code;
}

/** "en" / "en-us" -> "English" (the language without the region). */
export function languageName(code: string): string {
	const base = code.split(/[-_]/)[0]?.toLowerCase() ?? "";
	if (!/^[a-z]{2,3}$/.test(base)) return code;
	return intlName(languageNames, base) ?? LANGUAGE_NAMES[base] ?? code;
}

export const ACCOUNT_AGE: Record<AccountAge, string> = {
	"<1d": "Under a day",
	"1-7d": "1-7 days",
	"7-30d": "1-4 weeks",
	"30-90d": "1-3 months",
	"90-365d": "3-12 months",
	"1-3y": "1-3 years",
	"3y+": "3+ years",
};
export { ACCOUNT_AGES };

/** The join sources the framework sends (`from` of session/join). */
export const JOIN_SOURCES: Record<string, string> = {
	direct: "Direct (home, search, sorts)",
	teleport: "Teleport (this game)",
	teleport_game: "Teleport (another game)",
	referral: "Referral / invite link",
	share: "Share link (launch data)",
	follow: "Followed someone",
};

export function joinSourceName(source: string): string {
	return JOIN_SOURCES[source] ?? source;
}

export interface Choice {
	value: string;
	label: string;
}

/**
 * The country and language choices: the values the demographics query saw in the range, most players first, named; the
 * value picked now is kept even when the range doesn't have it.
 */
export function audienceChoices(r: DemographicsResult | undefined, picked: { country?: string | undefined; lang?: string | undefined } = {}): { countries: Choice[]; languages: Choice[] } {
	const of = (dimension: "country" | "language", name: (v: string) => string, keep?: string): Choice[] => {
		const out: Choice[] = (r?.dimensions[dimension] ?? []).flatMap((x) => (x.value ? [{ value: x.value, label: name(x.value) === x.value ? x.value : `${name(x.value)} (${x.value})` }] : []));
		if (keep && !out.some((c) => c.value === keep)) out.unshift({ value: keep, label: name(keep) === keep ? keep : `${name(keep)} (${keep})` });
		return out;
	};
	return { countries: of("country", countryName, picked.country), languages: of("language", languageName, picked.lang) };
}

// The `churn` query ------------------------------------------------------------------------------------------------------------

export type ChurnBucket = "active" | "at_risk" | "lapsing" | "churned";

/** One player of the `churn` query. */
export interface ChurnPlayer {
	pid: string;
	bucket: ChurnBucket;
	firstPlayed: string;
	lastPlayed: string;
	daysSince: number;
	/** Median days between play days; null with one play day. */
	usualGap: number | null;
	playDays: number;
	/** Play days in the last 14 days, and in the 14 before. */
	recentDays: number;
	priorDays: number;
	uid?: number;
	name?: string;
	displayName?: string;
	/** Owners only: the notification opt-in the backend learned (subscribed / not_subscribed), null when unknown. */
	optin?: string | null;
}

/** The `churn` query: churn risk from play patterns. */
export interface ChurnResult {
	from: string;
	to: string;
	asOf: string;
	players: number;
	buckets: { bucket: ChurnBucket; players: number; share: number }[];
	payers: Record<ChurnBucket, number>;
	bucket: ChurnBucket | null;
	list: ChurnPlayer[];
	total: number;
	more: number;
}

/** Churn is measured over the last 90 days to today, whatever the range (a 1-day range can't say who lapsed). */
export const CHURN_DAYS = 90;

/** The filter bar's filters with the range replaced by the last 90 days. */
export function churnFilters(filters: Filters, now = Date.now()): Filters {
	const { from: _from, to: _to, ...rest } = filters;
	return { ...rest, from: new Date(now - (CHURN_DAYS - 1) * 86_400_000).toISOString().slice(0, 10) };
}
