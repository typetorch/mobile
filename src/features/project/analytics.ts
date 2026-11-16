/**
 * Creator Hub's main charts as Analytics Query API metrics (ids, granularities and breakdown dimensions from
 * create.roblox.com/docs/cloud/guides/analytics/metrics, 2026-11). Each card is one query per range / breakdown;
 * Roblox allows 30 queries a minute per key owner, so at most 2 run at once and answers are cached for an hour.
 */
import type { AnalyticsSeries, Granularity } from "@/api/opencloud";

export type MetricFormat = "count" | "rate" | "robux" | "minutes" | "hours" | "decimal";

export interface MetricDef {
	id: string;
	title: string;
	help: string;
	format: MetricFormat;
	granularity: Granularity;
	/** Breakdown dimensions the metric supports (subset shown in the picker). */
	breakdowns: string[];
	/** Days of data Roblox keeps for it (performance metrics: 28). */
	retentionDays?: number;
	/** How a period total is computed from daily values. */
	aggregate: "sum" | "mean" | "max" | "last";
}

const USER_DIMS = ["Platform", "OperatingSystem", "Country", "AgeGroupV2", "Gender", "Locale"];
const MONEY_DIMS = ["Platform", "OperatingSystem", "Country", "AgeGroupV2", "Gender", "Locale"];

export const METRIC_GROUPS: { title: string; metrics: MetricDef[] }[] = [
	{
		title: "Engagement",
		metrics: [
			{ id: "DailyActiveUsers", title: "Daily active users", help: "Unique users per day.", format: "count", granularity: "OneDay", breakdowns: ["IsNewUser", "AcquisitionSource", ...USER_DIMS], aggregate: "mean" },
			{ id: "MonthlyActiveUsers", title: "Monthly active users", help: "Unique users in the 30 days up to each day.", format: "count", granularity: "OneDay", breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "last" },
			{ id: "PeakConcurrentPlayers", title: "Peak concurrent users", help: "The day's highest number of players at once.", format: "count", granularity: "OneDay", breakdowns: ["Platform", "OperatingSystem", "Place"], retentionDays: 28, aggregate: "max" },
			{ id: "AveragePlayTimeMinutesPerDAU", title: "Average playtime", help: "Minutes per daily active user.", format: "minutes", granularity: "OneDay", breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "mean" },
			{ id: "TotalPlayTimeHours", title: "Total playtime", help: "Hours played per day.", format: "hours", granularity: "OneDay", breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "sum" },
			{ id: "Visits", title: "Sessions", help: "Play sessions per day.", format: "count", granularity: "OneDay", breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "sum" },
			{ id: "AverageSessionLengthMinutes", title: "Average session time", help: "Minutes per session.", format: "minutes", granularity: "OneDay", breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "mean" },
			{ id: "DauMauStickiness", title: "Stickiness (DAU/MAU)", help: "Share of the month's users who played that day.", format: "rate", granularity: "OneDay", breakdowns: USER_DIMS, aggregate: "mean" },
		],
	},
	{
		title: "Retention",
		metrics: [
			{ id: "ForwardD1Retention", title: "Day 1 retention", help: "Share of a day's new users who came back the next day.", format: "rate", granularity: "OneDay", breakdowns: ["AcquisitionSource", ...USER_DIMS], aggregate: "mean" },
			{ id: "ForwardD7Retention", title: "Day 7 retention", help: "Share of a day's new users who came back on day 7.", format: "rate", granularity: "OneDay", breakdowns: ["AcquisitionSource", ...USER_DIMS], aggregate: "mean" },
			{ id: "ForwardD30Retention", title: "Day 30 retention", help: "Share of a day's new users who came back on day 30.", format: "rate", granularity: "OneDay", breakdowns: ["AcquisitionSource", ...USER_DIMS], aggregate: "mean" },
		],
	},
	{
		title: "Monetization",
		metrics: [
			{ id: "DailyRevenue", title: "Revenue", help: "Robux earned per day.", format: "robux", granularity: "OneDay", breakdowns: ["RevenueSource", ...MONEY_DIMS], aggregate: "sum" },
			{ id: "AverageRevenuePerUser", title: "ARPDAU", help: "Average revenue per daily active user.", format: "decimal", granularity: "OneDay", breakdowns: MONEY_DIMS, aggregate: "mean" },
			{ id: "PayingUsers", title: "Paying users", help: "Users who spent Robux that day.", format: "count", granularity: "OneDay", breakdowns: MONEY_DIMS, aggregate: "sum" },
			{ id: "PayingUsersCVR", title: "Payer conversion", help: "Share of daily users who paid.", format: "rate", granularity: "OneDay", breakdowns: MONEY_DIMS, aggregate: "mean" },
			{ id: "AverageRevenuePerPayingUser", title: "ARPPU", help: "Average revenue per paying user.", format: "decimal", granularity: "OneDay", breakdowns: MONEY_DIMS, aggregate: "mean" },
		],
	},
	{
		title: "Acquisition",
		metrics: [
			{ id: "UniqueUsersWithImpressions", title: "Users with impressions", help: "Users who saw the experience's tile.", format: "count", granularity: "OneDay", breakdowns: ["AcquisitionSource", "Platform", "AgeGroupV2", "IsNewUser"], aggregate: "sum" },
			{ id: "QualifiedUniqueUsersWithPlaySessions", title: "Users with qualified plays", help: "Users with a qualified play session.", format: "count", granularity: "OneDay", breakdowns: ["AcquisitionSource", "Platform", "AgeGroupV2", "IsNewUser"], aggregate: "sum" },
			{ id: "QualifiedEndToEndCVR", title: "Qualified play-through rate", help: "Qualified plays per user who saw the tile.", format: "rate", granularity: "OneDay", breakdowns: ["AcquisitionSource", "Platform", "AgeGroupV2", "IsNewUser"], aggregate: "mean" },
			{ id: "RFYPlayThroughRate", title: "Play-through rate (Home)", help: "Home recommendations' play-through rate.", format: "rate", granularity: "OneDay", breakdowns: ["AgeGroupV2", "Gender"], aggregate: "mean" },
		],
	},
	{
		title: "Performance",
		metrics: [
			{ id: "ServerFrameRateP50", title: "Server frame rate (p50)", help: "Median server heartbeat rate.", format: "decimal", granularity: "OneDay", breakdowns: ["Place"], retentionDays: 28, aggregate: "mean" },
			{ id: "ClientFpsP50", title: "Client FPS (p50)", help: "Median client frame rate.", format: "decimal", granularity: "OneDay", breakdowns: ["Platform", "OperatingSystem", "Place"], retentionDays: 28, aggregate: "mean" },
			{ id: "ClientCrashRate15m", title: "Client crash rate", help: "Crashes per 15 minutes of play.", format: "rate", granularity: "OneDay", breakdowns: ["Platform", "OperatingSystem", "Place"], retentionDays: 28, aggregate: "mean" },
			{ id: "ServerCrashCount", title: "Server crashes", help: "Server crashes per day.", format: "count", granularity: "OneDay", breakdowns: ["CrashType", "Place"], retentionDays: 28, aggregate: "sum" },
		],
	},
];

export const ALL_METRICS: MetricDef[] = METRIC_GROUPS.flatMap((g) => g.metrics);

export const RANGES = [7, 28, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export const DIMENSION_LABELS: Record<string, string> = {
	IsNewUser: "New / returning",
	AcquisitionSource: "Source",
	Platform: "Platform",
	OperatingSystem: "OS",
	Country: "Country",
	AgeGroupV2: "Age",
	Gender: "Gender",
	Locale: "Locale",
	RevenueSource: "Revenue source",
	Place: "Place",
	CrashType: "Crash type",
};

/** The last `days` full UTC days (Roblox's buckets), capped to the metric's retention. */
export function rangeFor(days: number, metric: MetricDef, now = Date.now()): { startTime: string; endTime: string } {
	const DAY = 86_400_000;
	const end = Math.floor(now / DAY) * DAY;
	const span = Math.min(days, metric.retentionDays ?? days);
	return { startTime: new Date(end - span * DAY).toISOString(), endTime: new Date(end).toISOString() };
}

/** Roblox doesn't document a rate's scale: a fraction unless a value is above 1 (then percent). Answers fractions. */
export function normalizeRates(series: AnalyticsSeries[], format: MetricFormat): AnalyticsSeries[] {
	if (format !== "rate") return series;
	const percent = series.some((s) => s.dataPoints.some((p) => (p.value ?? 0) > 1));
	if (!percent) return series;
	return series.map((s) => ({ ...s, dataPoints: s.dataPoints.map((p) => ({ ...p, value: p.value === null ? null : p.value / 100 })) }));
}

export function aggregate(values: (number | null)[], how: MetricDef["aggregate"]): number | null {
	const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
	if (!v.length) return null;
	switch (how) {
		case "sum":
			return v.reduce((a, b) => a + b, 0);
		case "max":
			return Math.max(...v);
		case "last":
			return v[v.length - 1] ?? null;
		default:
			return v.reduce((a, b) => a + b, 0) / v.length;
	}
}

export function seriesLabel(s: AnalyticsSeries): string {
	if (!s.breakdowns.length) return "All";
	return s.breakdowns.map((b) => b.displayValue ?? b.value).join(" · ");
}

/** The biggest `n` series by their total (a breakdown can answer dozens of countries). */
export function topSeries(series: AnalyticsSeries[], n: number): AnalyticsSeries[] {
	const total = (s: AnalyticsSeries) => s.dataPoints.reduce((a, p) => a + (p.value ?? 0), 0);
	return [...series].sort((a, b) => total(b) - total(a)).slice(0, n);
}
