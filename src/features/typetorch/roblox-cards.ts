/**
 * The Roblox page's cards, trends and notes (pure data and text helpers, copied from backend/web/src/pages/Roblox.tsx;
 * keep in step). Colors are chart palette indexes here instead of CSS variables.
 */
import type { BenchmarkKey } from "@/api/tt/benchmarks";
import type { BenchmarkPeriod, Retention } from "@/api/tt/types";
import { fmtInt, fmtMinutes, fmtNum, fmtPct } from "@/lib/format";

/** Where a number can't match Creator Hub: a short badge on the card, and why (its tooltip). */
export interface Differs {
	label: "Estimate" | "Ours";
	why: string;
}

export interface CardSpec {
	/** The benchmark it takes; `null` for our own metrics (no Creator Hub counterpart, so no 50th / 90th to compare with). */
	key: BenchmarkKey | null;
	/** Unique id, the benchmark key when there is one. */
	id: string;
	title: string;
	/** Value in the unit the user types benchmarks in (minutes, percent, Robux). */
	value(p: BenchmarkPeriod): number | null;
	format(v: number): string;
	unit: string;
	/** Creator Hub's definition, then how this card computes it. */
	info: string;
	differs?: Differs;
}

const pct = (r: { rate: number; of: number }) => (r.of > 0 ? r.rate * 100 : null);

/**
 * `newp` is the first visit the SDK has seen: a player who first played before the SDK was added looks new on their
 * next visit (and then never again). Retention cohorts inherit it: those players come back more often than real new
 * players, so cohorts run high until every earlier player has been seen once; the install day's cohort is the worst.
 */
const NEW_USER_DIFFERS: Differs = {
	label: "Estimate",
	why: "A new user is a player's first visit since the SDK was added, so players who played before that look new on their next visit, until each has come back once. Creator Hub knows their real first play date. Cohorts from the first tracked days run highest.",
};

const REVENUE_DIFFERS: Differs = {
	label: "Estimate",
	why: "Revenue here is what players paid in game purchases times 70% (Roblox keeps 30%). Creator Hub also counts passes bought outside the game, commissions and avatar item sales, which the game never sees.",
};

export const CARDS: CardSpec[] = [
	{
		key: "dau",
		id: "dau",
		title: "Daily active users",
		value: (p) => p.dau,
		format: (v) => fmtNum(v, 1),
		unit: "players",
		info: "Creator Hub: the distinct users who played on a day. Here the players who started a session that UTC day (a session running past midnight counts for its first day only), averaged over the period's days.",
	},
	{
		key: "mau",
		id: "mau",
		title: "Monthly active users",
		value: (p) => p.mau,
		format: (v) => fmtInt(v),
		unit: "players",
		info: "Creator Hub: the distinct users who played in the last 30 days. Here the distinct players with a session in the 30 UTC days ending on the period's last day (so the two periods' 30-day windows overlap).",
	},
	{
		key: "newUsers",
		id: "newUsers",
		title: "New users",
		value: (p) => p.newUsers,
		format: (v) => fmtInt(v),
		unit: "players",
		info: "Creator Hub: users who played the experience for the first time. Here the players whose first-ever session started in the period (the SDK marks a player's first join), summed over its days.",
		differs: NEW_USER_DIFFERS,
	},
	{
		key: "sessionTime",
		id: "sessionTime",
		title: "Average session time",
		value: (p) => p.avgSessionMinutes,
		format: (v) => fmtMinutes(v),
		unit: "minutes",
		info: "Creator Hub: total playtime divided by the number of sessions, each day. Here the same, per UTC day, averaged over the period's days. A session runs from its first to its last event and counts on the day it started.",
	},
	{
		key: "d1",
		id: "d1",
		title: "Day 1 retention",
		value: (p) => pct(p.d1Retention),
		format: (v) => `${fmtNum(v, 1)}%`,
		unit: "%",
		info: "Creator Hub: new users who played again the day after their first play date, by that date. Here the same: a new session must start the next UTC day (a first session running past midnight isn't a return), for the latest join days whose next day is over, averaged over those days.",
		differs: NEW_USER_DIFFERS,
	},
	{
		key: "d7",
		id: "d7",
		title: "Day 7 retention",
		value: (p) => pct(p.d7Retention),
		format: (v) => `${fmtNum(v, 1)}%`,
		unit: "%",
		info: "Creator Hub: new users who played again on day 7 (the 8th day) after their first play date. Here the same rule as day 1, 7 days on, for the latest join days whose day 7 is over.",
		differs: NEW_USER_DIFFERS,
	},
	{
		key: "d30",
		id: "d30",
		title: "Day 30 retention",
		value: (p) => pct(p.d30Retention),
		format: (v) => `${fmtNum(v, 1)}%`,
		unit: "%",
		info: "Creator Hub: new users who played again on day 30 after their first play date. Here the same rule as day 1, 30 days on, for the latest join days whose day 30 is over.",
		differs: NEW_USER_DIFFERS,
	},
	{
		key: "payer",
		id: "payer",
		title: "Payer conversion",
		value: (p) => pct(p.payerConversion),
		format: (v) => `${fmtNum(v, 2)}%`,
		unit: "%",
		info: "Creator Hub: the share of daily active users who are also paying users. Here the same per UTC day, averaged over the period's days (not payers over the whole period).",
		differs: { label: "Estimate", why: "Only purchases the game server logs count: a pass bought on the website, outside the game, isn't seen." },
	},
	{
		key: "arppu",
		id: "arppu",
		title: "ARPPU",
		value: (p) => p.arppu,
		format: (v) => `${fmtNum(v, 1)} R$`,
		unit: "Robux",
		info: "Creator Hub: average revenue per paying user. Here revenue / paying users per UTC day, averaged over the days with a payer.",
		differs: REVENUE_DIFFERS,
	},
	{
		key: "arpdau",
		id: "arpdau",
		title: "ARPDAU",
		value: (p) => p.arpdau,
		format: (v) => `${fmtNum(v, 2)} R$`,
		unit: "Robux",
		info: "Creator Hub: average revenue per daily active user. Here revenue / DAU per UTC day, averaged over the period's days.",
		differs: REVENUE_DIFFERS,
	},
	{
		key: "playtime",
		id: "playtime",
		title: "Average playtime",
		value: (p) => p.avgPlaytimeMinutes,
		format: (v) => fmtMinutes(v),
		unit: "minutes",
		info: "Creator Hub: playtime per daily active user. Here all playtime of a UTC day divided by that day's players, averaged over the period's days.",
	},
	{
		key: null,
		id: "qualifiedFirstSessions",
		title: "Qualified first sessions",
		value: (p) => pct(p.playThrough),
		format: (v) => `${fmtNum(v, 1)}%`,
		unit: "%",
		info: "Ours, not a Creator Hub number: the share of new players' first sessions (that are over) lasting at least 5 minutes. Creator Hub's play-through rate is something else (impressions that led to a play), so this card takes no benchmark.",
		differs: { label: "Ours", why: "Creator Hub's play-through rate starts at the home-page impression (seen, then played), which games can't see; its percentiles don't apply to this number, so there is nothing to compare it with." },
	},
];

/** "Oct 1" for a UTC day ("2026-10-01"). */
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A retention card's second line: the counts, or why there are none when the data doesn't reach the cohort days. */
export function retentionSub(r: Retention): string {
	if (r.history === "none") {
		return `not enough history: cohorts ${fmtDay(r.cohortFrom)} - ${fmtDay(r.cohortTo)}, ${r.dataFrom ? `events start ${fmtDay(r.dataFrom)}` : "no events yet"}`;
	}
	const counts = `${fmtInt(r.count)} of ${fmtInt(r.of)} new players`;
	return r.history === "partial" && r.dataFrom ? `${counts} (cohorts from ${fmtDay(r.dataFrom)}: events start then)` : counts;
}

export function sub(spec: CardSpec, p: BenchmarkPeriod): string {
	switch (spec.id) {
		case "dau":
			return `${fmtInt(p.players)} players in the period`;
		case "mau":
			return `30 days to ${new Date(Date.parse(p.to) - 1).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
		case "newUsers":
			return `${fmtNum(p.newUsers / Math.max(1, Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000)), 1)} per day`;
		case "sessionTime":
			return `${fmtInt(p.sessions)} sessions`;
		case "playtime":
			return `${fmtNum(p.dau, 1)} daily active users`;
		case "d1":
			return retentionSub(p.d1Retention);
		case "d7":
			return retentionSub(p.d7Retention);
		case "d30":
			return retentionSub(p.d30Retention);
		case "payer":
			return `${fmtInt(p.payerConversion.count)} payer-days of ${fmtInt(p.payerConversion.of)} player-days`;
		case "arppu":
			return `${fmtInt(p.revenue)} Robux revenue (${fmtInt(p.robux)} spent)`;
		case "arpdau":
			return `${fmtNum(p.dau, 1)} daily active users`;
		case "qualifiedFirstSessions":
			return `${fmtInt(p.playThrough.count)} of ${fmtInt(p.playThrough.of)} first sessions, ${p.playThrough.minutes} min or longer`;
		default:
			return "";
	}
}

/** The cards with a Creator Hub counterpart: the ones that take a benchmark. */
type BenchmarkedCard = CardSpec & { key: BenchmarkKey };
export const BENCHMARKED_CARDS = CARDS.filter((c): c is BenchmarkedCard => c.key !== null);

/** The editor's rows: the benchmarked cards, then Roblox's own play-through rate (the Acquisition, from Roblox section). */
export const BENCHMARK_ROWS: { key: BenchmarkKey; title: string; unit: string }[] = [
	...BENCHMARKED_CARDS.map((c) => ({ key: c.key, title: c.title, unit: c.unit })),
	{ key: "playThrough", title: "Play-through rate, from Roblox", unit: "%" },
];

export type TrendKey = "d1" | "newUsers" | "sessionMinutes" | "playtimeMinutes" | "dau" | "revenue";

export const TRENDS: { key: TrendKey; label: string; format(v: number): string }[] = [
	{ key: "d1", label: "D1 retention", format: (v) => fmtPct(v) },
	{ key: "newUsers", label: "New users", format: (v) => fmtNum(v, 1) },
	{ key: "sessionMinutes", label: "Average session time", format: (v) => fmtMinutes(v) },
	{ key: "playtimeMinutes", label: "Average playtime", format: (v) => fmtMinutes(v) },
	{ key: "dau", label: "Daily active users", format: (v) => fmtNum(v, 1) },
	{ key: "revenue", label: "Daily revenue (est., Robux)", format: (v) => fmtNum(v, 0) },
];

/** Each join source keeps its color whatever the filters (the order of the categorical palette). */
export const SOURCE_COLORS: Record<string, number> = {
	direct: 0,
	teleport: 1,
	teleport_game: 2,
	referral: 3,
	share: 4,
	follow: 5,
	unknown: 6,
	other: 7,
};

export const JOIN_SOURCES_DIFFER =
	"The join sources are the game's own (direct, teleport, link, followed a friend). Creator Hub splits by discovery surface (Home recommendations, Search, Friends, Teleport from another game, ads...), which games can't see: those all count as direct here.";

export const SOURCE_LABELS: Record<string, string> = {
	direct: "Direct",
	teleport: "Teleport (same game)",
	teleport_game: "From another game",
	referral: "Referral link",
	share: "Share link",
	follow: "Followed a friend",
	unknown: "Unknown",
	other: "Other",
};

/** The rules the page's numbers follow (Creator Hub's definitions, create.roblox.com/docs/production/analytics). */
export const CALCULATION_NOTES: { title: string; text: string }[] = [
	{ title: "Days", text: "UTC, midnight to midnight, as Creator Hub's daily numbers. Only full days count: the cards and charts end yesterday, since today isn't over." },
	{ title: "Sessions", text: "One session per join, from its first to its last event, with no minimum length. It counts on the day it started, so a player active past midnight is a daily active user of the first day only." },
	{ title: "Who counts", text: "Players on public, private and reserved servers. Studio play tests don't count (Creator Hub only sees published games)." },
	{ title: "Active users", text: "Daily active users are the distinct players who started a session that UTC day, averaged over the period. Monthly active users are the distinct players of the 30 days ending on the period's last day." },
	{ title: "New users and retention", text: "A new user is a player's first session since the SDK was added (players from before it look new once more). Day 1 / 7 / 30 retention is by first play date: the share of that day's new users who start a new session exactly 1 / 7 / 30 days later, over the latest join days whose day N is over. A card says \"not enough history\" when the events don't reach its cohort days yet." },
	{ title: "Averages", text: "A card is the average of its daily values over the period: average session time and playtime per DAU, payer conversion, ARPPU and ARPDAU are computed each day, then averaged, as Creator Hub's 7-day averages." },
	{ title: "Revenue", text: "Robux players paid in purchases the game server logged, times 70% (Roblox keeps 30% of developer product and pass sales). An estimate: Creator Hub also counts sales outside the game." },
	{ title: "Concurrent users", text: "Players per minute from the servers' heartbeats, summed over servers (Studio left out): the peak minute and the average of the minutes, per hour and over the last 24 h. An estimate: a heartbeat is about once a minute." },
	{ title: "Data delay", text: "None here: events arrive within seconds. Creator Hub's daily numbers settle a day or more after the day ends, and its last days can be marked as estimates." },
];

/** "Oct 1 - Oct 7 (UTC)" for a period's [from, to). */
export function periodLabel(p: { from: string; to: string }): string {
	const fmt = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
	return `${fmt(Date.parse(p.from))} - ${fmt(Date.parse(p.to) - 1)} (UTC)`;
}

export function ordinal(n: number): string {
	const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
	return `${n}${s}`;
}

