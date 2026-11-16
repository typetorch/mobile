/**
 * Creator Hub's analytics as Analytics Query API metrics (ids, granularities, retention and breakdown dimensions from
 * create.roblox.com/docs/cloud/guides/analytics/metrics, 2026-11). Each card is one query per range / granularity /
 * breakdown / filter; Roblox allows 30 queries a minute per key owner, so at most 2 run at once, at most 28 start in
 * any minute, only the first cards of the open group load by themselves, and answers are cached for an hour.
 */
import type { Granularity } from "@/api/opencloud";

import type { MetricSeries } from "./api/analytics-query";

export type MetricFormat = "count" | "rate" | "robux" | "minutes" | "hours" | "decimal" | "bytes" | "seconds";

export interface MetricDef {
	id: string;
	/** React key when one metric has two cards in a group (e.g. a chart and a top-N table). */
	key?: string;
	title: string;
	help: string;
	format: MetricFormat;
	/** Granularities Roblox supports for it. */
	granularities: Granularity[];
	/** Breakdown / filter dimensions the metric supports (subset shown in the pickers). */
	breakdowns: string[];
	/** Days of data Roblox keeps for it (performance metrics: 28). */
	retentionDays?: number;
	/** How a period total is computed from per-bucket values (granularity None gives Roblox's own total). */
	aggregate: "sum" | "mean" | "max" | "last";
	/** Sibling metric ids sharing everything else (percentiles: Avg / P10 / P50 / P90). */
	variants?: { id: string; label: string }[];
	/** Breakdown the card opens with. */
	defaultBreakdown?: string[];
	/** "Auto" asks for the period total (granularity None) instead of a time series. */
	preferTotal?: boolean;
	/** Top N series for a total with a breakdown (Roblox's `limit`). */
	limit?: number;
	/** Order of total bars: by value (default) or by the breakdown label (funnel steps, buckets). */
	order?: "value" | "label";
}

export type GroupView = "acquisitionFunnel" | "cohorts" | "benchmarks" | "compare";

export interface MetricGroup {
	key: string;
	title: string;
	help?: string;
	metrics: MetricDef[];
	/** A dimension the whole group is filtered by, its values looked up with the dimension-values API. */
	pick?: { dimension: string; metric: string; label: string; required: boolean };
	views?: GroupView[];
}

const DAILY: Granularity[] = ["OneDay", "OneWeek", "OneMonth", "None"];
const SUBDAY: Granularity[] = ["OneMinute", "HalfHour", "OneHour", "OneDay"];
const FLEX: Granularity[] = ["OneHour", "OneDay", "OneWeek", "OneMonth", "None"];

const U6 = [
	"UserSegmentationAccountAge",
	"UserSegmentationActivationStatus",
	"UserSegmentationEngagementLevel",
	"UserSegmentationPayerStatus",
	"UserSegmentationPlatformActivationStatus",
	"UserSegmentationPlatformSpenderStatus",
];
const USER_DIMS = ["Platform", "OperatingSystem", "Country", "AgeGroupV2", "Gender", "Locale", "FirstPlayAcquisitionSource", "UserO18Eligibility", ...U6];
const MONEY_DIMS = ["Platform", "OperatingSystem", "Country", "AgeGroupV2", "Gender", "Locale", "UserO18Eligibility", ...U6];
const ACQ_DIMS = ["AcquisitionSource", "Platform", "OperatingSystem", "AgeGroupV2", "Gender", "IsNewUser", "UserSegmentationPlatformActivationStatus", "UserSegmentationPlatformSpenderStatus"];
const CLIENT_DIMS = ["Platform", "OperatingSystem", "Place", "PlaceVersion", "MemoryGroup"];
const COHORT_DIMS = ["AcquisitionSource", "FirstPlayAcquisitionSource", "Platform", "OperatingSystem", "Country", "AgeGroupV2", "Gender", "Locale", ...U6];
const EVENT_BASE = ["Platform", "OperatingSystem", "AgeGroup", "Gender", "IsNewUser", "PayerStatus", "CustomField1", "CustomField2", "CustomField3"];
const FUNNEL_DIMS = ["FunnelStep", ...EVENT_BASE];
const JOURNEY_DIMS = ["JourneyVersion", ...EVENT_BASE];
const ADS_DIMS = ["AdFormat", "AdInstanceName", "AdPlacementId", "PlacementType", "AdRewardId", "Country", "Gender", "OperatingSystem", "Platform", "AdsPublisherReportingDataVersion"];
const MM_DIMS = ["Place", "Platform", "AgeGroup", "Country", "Locale"];

const pct = (base: string, title: string, help: string, format: MetricFormat, granularities: Granularity[], breakdowns: string[], extra: Partial<MetricDef> = {}): MetricDef => ({
	id: `${base}Avg`,
	title,
	help,
	format,
	granularities,
	breakdowns,
	aggregate: "mean",
	variants: [
		{ id: `${base}Avg`, label: "Avg" },
		{ id: `${base}P10`, label: "P10" },
		{ id: `${base}P50`, label: "P50" },
		{ id: `${base}P90`, label: "P90" },
	],
	...extra,
});

const rfy = (id: string, title: string, format: MetricFormat): MetricDef => ({ id, title, help: "Users who found the experience on Home recommendations.", format, granularities: ["OneDay"], breakdowns: ["AgeGroupV2", "Gender"], aggregate: "mean" });

const ds = (id: string, title: string, help: string, breakdowns: string[], format: MetricFormat = "count"): MetricDef => ({ id, title, help, format, granularities: SUBDAY, breakdowns, retentionDays: 28, aggregate: format === "bytes" ? "last" : "sum" });

const journey = (id: string, title: string, help: string, format: MetricFormat, defaultBreakdown: string[] | undefined, extraDims: string[] = []): MetricDef => ({
	id,
	title,
	help,
	format,
	granularities: ["None"],
	breakdowns: [...extraDims, ...JOURNEY_DIMS],
	aggregate: "sum",
	...(defaultBreakdown ? { defaultBreakdown } : {}),
	// A journey's few stages read best in stage order; transitions (from × to) and nodes can be many, so they're ranked
	// by value and the biggest stay in the first bars.
	order: defaultBreakdown?.length === 1 && defaultBreakdown[0] === "FromStage" ? "label" : "value",
});

const funnel = (id: string, title: string, help: string, format: MetricFormat): MetricDef => ({ id, title, help, format, granularities: ["None"], breakdowns: FUNNEL_DIMS, aggregate: "sum", defaultBreakdown: ["FunnelStep"], order: "label" });

const event = (id: string, title: string, help: string, format: MetricFormat, aggregate: MetricDef["aggregate"]): MetricDef => ({ id, title, help, format, granularities: FLEX, breakdowns: ["CustomEventName", ...EVENT_BASE], aggregate });

export const METRIC_GROUPS: MetricGroup[] = [
	{
		key: "engagement",
		title: "Engagement",
		metrics: [
			{ id: "DailyActiveUsers", title: "Daily active users", help: "Unique users per day.", format: "count", granularities: DAILY, breakdowns: ["IsNewUser", "AcquisitionSource", ...USER_DIMS], aggregate: "mean" },
			{ id: "MonthlyActiveUsers", title: "Monthly active users", help: "Unique users in the 30 days up to each day.", format: "count", granularities: ["OneDay"], breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "last" },
			{ id: "PeakConcurrentPlayers", title: "Peak concurrent users", help: "The highest number of players at once.", format: "count", granularities: SUBDAY, breakdowns: CLIENT_DIMS, retentionDays: 28, aggregate: "max" },
			{ id: "AveragePlayTimeMinutesPerDAU", title: "Average playtime", help: "Minutes per daily active user.", format: "minutes", granularities: DAILY, breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "mean" },
			{ id: "TotalPlayTimeHours", title: "Total playtime", help: "Hours played.", format: "hours", granularities: DAILY, breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "sum" },
			{ id: "Visits", title: "Sessions", help: "Play sessions.", format: "count", granularities: DAILY, breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "sum" },
			{ id: "AverageSessionLengthMinutes", title: "Average session time", help: "Minutes per session.", format: "minutes", granularities: DAILY, breakdowns: ["IsNewUser", ...USER_DIMS], aggregate: "mean" },
			{ id: "DauMauStickiness", title: "Stickiness (DAU/MAU)", help: "Share of the month's users who played that day.", format: "rate", granularities: ["OneDay"], breakdowns: USER_DIMS.filter((d) => d !== "IsNewUser"), aggregate: "mean" },
			{
				id: "TotalSessionsEndedInBucket",
				title: "New users' first session",
				help: "New users' first sessions by how long they lasted (where new players drop off).",
				format: "count",
				granularities: ["OneDay", "OneWeek", "OneMonth", "None"],
				breakdowns: ["SessionTimeBucket", "Platform", "OperatingSystem", "AgeGroupV2", "Gender", ...U6],
				aggregate: "sum",
				defaultBreakdown: ["SessionTimeBucket"],
				preferTotal: true,
				order: "label",
			},
		],
	},
	{
		key: "retention",
		title: "Retention",
		views: ["cohorts"],
		metrics: [
			{ id: "ForwardD1Retention", title: "Day 1 retention", help: "Share of a day's new users who came back the next day.", format: "rate", granularities: ["OneDay"], breakdowns: ["AcquisitionSource", ...USER_DIMS], aggregate: "mean" },
			{ id: "ForwardD7Retention", title: "Day 7 retention", help: "Share of a day's new users who came back on day 7.", format: "rate", granularities: ["OneDay"], breakdowns: ["AcquisitionSource", ...USER_DIMS], aggregate: "mean" },
			{ id: "ForwardD30Retention", title: "Day 30 retention", help: "Share of a day's new users who came back on day 30.", format: "rate", granularities: ["OneDay"], breakdowns: ["AcquisitionSource", ...USER_DIMS], aggregate: "mean" },
		],
	},
	{
		key: "monetization",
		title: "Monetization",
		metrics: [
			{ id: "DailyRevenue", title: "Revenue", help: "Robux earned.", format: "robux", granularities: DAILY, breakdowns: ["RevenueSource", "BalanceType", ...MONEY_DIMS], aggregate: "sum" },
			{
				id: "ItemMonetizationRevenue",
				key: "ItemMonetizationRevenue:top",
				title: "Robux spent per product (realtime)",
				help: "Top passes, developer products and items by Robux spent in the range.",
				format: "robux",
				granularities: ["OneHour", "OneDay", "None"],
				breakdowns: ["ProductKey", "ProductType", "SalesLocation", "CollectibleItemType", "CollectibleItemTargetType", "CollectibleItemTargetTypeId"],
				aggregate: "sum",
				defaultBreakdown: ["ProductKey"],
				preferTotal: true,
				limit: 25,
			},
			{ id: "ItemMonetizationRevenue", title: "Robux spent (realtime)", help: "Robux spent in the experience, hourly or daily.", format: "robux", granularities: ["OneHour", "OneDay", "None"], breakdowns: ["ProductType", "SalesLocation", "ProductKey", "CollectibleItemType"], aggregate: "sum" },
			{ id: "AverageRevenuePerUser", title: "ARPDAU", help: "Average revenue per daily active user.", format: "decimal", granularities: DAILY, breakdowns: MONEY_DIMS, aggregate: "mean" },
			{ id: "PayingUsers", title: "Paying users", help: "Users who spent Robux.", format: "count", granularities: DAILY, breakdowns: MONEY_DIMS, aggregate: "sum" },
			{ id: "PayingUsersCVR", title: "Payer conversion", help: "Share of users who paid.", format: "rate", granularities: DAILY, breakdowns: MONEY_DIMS, aggregate: "mean" },
			{ id: "AverageRevenuePerPayingUser", title: "ARPPU", help: "Average revenue per paying user.", format: "decimal", granularities: DAILY, breakdowns: MONEY_DIMS, aggregate: "mean" },
		],
	},
	{
		key: "acquisition",
		title: "Acquisition",
		views: ["acquisitionFunnel"],
		metrics: [
			{ id: "UniqueUsersWithImpressions", title: "Users with impressions", help: "Users who saw the experience's tile.", format: "count", granularities: ["OneDay", "None"], breakdowns: ACQ_DIMS, aggregate: "sum" },
			{ id: "UniqueUsersWithClicks", title: "Users who clicked", help: "Users who opened the experience's page from a tile.", format: "count", granularities: ["OneDay", "None"], breakdowns: ACQ_DIMS, aggregate: "sum" },
			{ id: "UniqueUsersWithPlaySessions", title: "Users who played", help: "Users with a play session.", format: "count", granularities: ["OneDay", "OneWeek", "None"], breakdowns: ["FunnelSource", ...ACQ_DIMS], aggregate: "sum" },
			{ id: "QualifiedUniqueUsersWithPlaySessions", title: "Users with qualified plays", help: "Users with a qualified play session.", format: "count", granularities: ["OneDay", "OneWeek", "None"], breakdowns: ["FunnelSource", ...ACQ_DIMS], aggregate: "sum" },
			{ id: "ImpressionCVR", title: "Impression conversion", help: "Clicks per user who saw the tile.", format: "rate", granularities: ["OneDay", "None"], breakdowns: ACQ_DIMS, aggregate: "mean" },
			{ id: "ClickCVR", title: "Click conversion", help: "Plays per user who clicked.", format: "rate", granularities: ["OneDay", "None"], breakdowns: ACQ_DIMS, aggregate: "mean" },
			{ id: "EndToEndCVR", title: "Play-through rate", help: "Plays per user who saw the tile.", format: "rate", granularities: ["OneDay", "None"], breakdowns: ACQ_DIMS, aggregate: "mean" },
			{ id: "QualifiedEndToEndCVR", title: "Qualified play-through rate", help: "Qualified plays per user who saw the tile.", format: "rate", granularities: ["OneDay", "None"], breakdowns: ACQ_DIMS, aggregate: "mean" },
		],
	},
	{
		key: "home",
		title: "Home recs",
		help: "Signals Roblox's Home recommendations use: what users who found the experience on Home did next.",
		metrics: [
			rfy("RFYPlayThroughRate", "Play-through rate (Home)", "rate"),
			rfy("RFYDuration0To60", "Sessions under 60 s", "decimal"),
			rfy("RFYDuration61To180", "Sessions of 61-180 s", "decimal"),
			rfy("RFYD1Playtime", "Day 1 playtime", "decimal"),
			rfy("RFYD2To7Playtime", "Day 2-7 playtime", "decimal"),
			rfy("RFYD8To28Playtime", "Day 8-28 playtime", "decimal"),
			rfy("RFYD1CoplayDays", "Day 1 co-play days", "decimal"),
			rfy("RFYD2To7CoplayDays", "Day 2-7 co-play days", "decimal"),
			rfy("RFYD8To28CoplayDays", "Day 8-28 co-play days", "decimal"),
			rfy("RFYD2To7PlayDays", "Day 2-7 play days", "decimal"),
			rfy("RFYD8To28PlayDays", "Day 8-28 play days", "decimal"),
			rfy("RFYD1QualifiedPlaySessions", "Day 1 qualified sessions", "decimal"),
			rfy("RFYD2To7QualifiedPlaySessions", "Day 2-7 qualified sessions", "decimal"),
			rfy("RFYD8To28QualifiedPlaySessions", "Day 8-28 qualified sessions", "decimal"),
			rfy("RFYD1SpendDay", "Day 1 spend day", "decimal"),
			rfy("RFYD2To7SpendDays", "Day 2-7 spend days", "decimal"),
			rfy("RFYD8To28SpendDays", "Day 8-28 spend days", "decimal"),
			rfy("RFYD1RobuxSpend", "Day 1 Robux spend", "decimal"),
			rfy("RFYD2To7RobuxSpend", "Day 2-7 Robux spend", "decimal"),
			rfy("RFYD8To28RobuxSpend", "Day 8-28 Robux spend", "decimal"),
		],
	},
	{
		key: "performance",
		title: "Performance",
		help: "Roblox keeps performance data for 28 days.",
		metrics: [
			pct("ServerFrameRate", "Server frame rate", "Server heartbeat rate.", "decimal", SUBDAY, ["Place"], { retentionDays: 28, id: "ServerFrameRateP50" }),
			pct("ClientFps", "Client FPS", "Client frame rate.", "decimal", SUBDAY, CLIENT_DIMS, { retentionDays: 28, id: "ClientFpsP50" }),
			{ id: "ClientCrashRate15m", title: "Client crash rate", help: "Crashes per 15 minutes of play.", format: "rate", granularities: SUBDAY, breakdowns: CLIENT_DIMS, retentionDays: 28, aggregate: "mean" },
			{ id: "ServerCrashCount", title: "Server crashes", help: "Server crashes.", format: "count", granularities: SUBDAY, breakdowns: ["CrashType", "Place"], retentionDays: 28, aggregate: "sum" },
			{ id: "ClientCrashCount", title: "Client crashes", help: "Client crashes.", format: "count", granularities: SUBDAY, breakdowns: CLIENT_DIMS, retentionDays: 28, aggregate: "sum" },
			{ id: "OomUnexpectedExits", title: "Out-of-memory exits", help: "Clients that quit unexpectedly out of memory.", format: "count", granularities: SUBDAY, breakdowns: CLIENT_DIMS, retentionDays: 28, aggregate: "sum" },
			pct("ClientMemoryUsage", "Client memory", "Client memory use.", "decimal", SUBDAY, CLIENT_DIMS, { retentionDays: 28 }),
			pct("ClientMemoryUsagePercentage", "Client memory (% of device)", "Client memory use as a share of the device's memory.", "rate", SUBDAY, CLIENT_DIMS, { retentionDays: 28 }),
			{ id: "ClientCpuTimeAvg", title: "Client CPU time", help: "Average client CPU time; break down by category to find the costly systems.", format: "decimal", granularities: SUBDAY, breakdowns: ["ClientCpuTimeCategory", "ClientCpuTimeSubCategory", ...CLIENT_DIMS], retentionDays: 28, aggregate: "mean" },
			pct("SessionDurationSeconds", "Session duration", "How long client sessions last.", "seconds", SUBDAY, CLIENT_DIMS, { retentionDays: 28 }),
			pct("CpuTime", "Server CPU time", "Server CPU time; break down by category to find the costly systems.", "decimal", SUBDAY, ["CpuTimeCategory", "CpuTimeSubCategory", "Place"], { retentionDays: 28 }),
			{ id: "CpuCoreUtilization", title: "Server CPU core use", help: "Server CPU core utilization.", format: "decimal", granularities: SUBDAY, breakdowns: ["Place"], retentionDays: 28, aggregate: "mean" },
			pct("MemoryUsage", "Server memory", "Server memory use; break down by category or server age.", "decimal", [...SUBDAY, "None"], ["MemoryUsageCategory", "MemoryUsageSubCategory", "ServerAgeBucket", "Place"], { retentionDays: 28 }),
			{ id: "RotraceTotalCalls", title: "HTTP / API calls", help: "Outgoing calls by URL (Roblox keeps 365 days).", format: "count", granularities: ["OneHour", "OneDay", "None"], breakdowns: ["SimplifiedUrl"], retentionDays: 365, aggregate: "sum" },
		],
	},
	{
		key: "economy",
		title: "Economy",
		help: "Needs the experience to log AnalyticsService economy events.",
		pick: { dimension: "CurrencyType", metric: "EconomyTransactionAmount", label: "Currency", required: false },
		metrics: [
			{ id: "EconomyTransactionAmount", key: "EconomyTransactionAmount:flow", title: "Sources and sinks", help: "Currency earned (sources) and spent (sinks).", format: "count", granularities: FLEX, breakdowns: ["FlowType", "TransactionType", "ItemSku", "CurrencyType", ...EVENT_BASE], aggregate: "sum", defaultBreakdown: ["FlowType"] },
			{ id: "EconomyAverageWalletBalance", title: "Average wallet balance", help: "Average balance per user.", format: "decimal", granularities: FLEX, breakdowns: ["CurrencyType", ...EVENT_BASE], aggregate: "mean" },
			{ id: "EconomyTransactionCount", title: "Transactions", help: "Number of economy transactions.", format: "count", granularities: FLEX, breakdowns: ["FlowType", "TransactionType", "ItemSku", "CurrencyType", ...EVENT_BASE], aggregate: "sum" },
			{ id: "EconomyTransactionAmount", key: "EconomyTransactionAmount:sku", title: "Top items by amount", help: "Items (SKUs) by currency amount in the range.", format: "count", granularities: FLEX, breakdowns: ["ItemSku", "TransactionType", "FlowType", ...EVENT_BASE], aggregate: "sum", defaultBreakdown: ["ItemSku"], preferTotal: true, limit: 25 },
		],
	},
	{
		key: "funnels",
		title: "Funnels",
		help: "Needs the experience to log AnalyticsService funnel steps.",
		pick: { dimension: "FunnelName", metric: "FunnelStepTotalCount", label: "Funnel", required: true },
		metrics: [
			funnel("FunnelUserTotalCount", "Users per step", "Users who reached each step.", "count"),
			funnel("FunnelUserStepCompletionRate", "Step conversion (users)", "Share of the previous step's users who reached this one.", "rate"),
			funnel("FunnelUserOverallCompletionRate", "Overall conversion (users)", "Share of the funnel's users who reached each step.", "rate"),
			funnel("FunnelUserChurnRate", "Drop-off (users)", "Share of users who stopped at each step.", "rate"),
			funnel("FunnelStepTotalCount", "Step completions", "Times each step was completed.", "count"),
			funnel("FunnelStepCompletionRate", "Step conversion", "Completions per previous step.", "rate"),
			funnel("FunnelStepOverallCompletionRate", "Overall conversion", "Completions per funnel start.", "rate"),
			funnel("FunnelStepChurnRate", "Drop-off", "Share that stopped at each step.", "rate"),
			{ id: "FunnelCohortCompletionRate", title: "Completion by start day", help: "Share of each day's starters who finished.", format: "rate", granularities: ["OneDay"], breakdowns: FUNNEL_DIMS, aggregate: "mean" },
			{ id: "FunnelCohortSessionCompletionRate", title: "Same-session completion", help: "Share of each day's starters who finished in the same session.", format: "rate", granularities: ["OneDay"], breakdowns: FUNNEL_DIMS, aggregate: "mean" },
		],
	},
	{
		key: "journeys",
		title: "Journeys",
		help: "Needs the experience to log journey stages. Transitions read from → to.",
		pick: { dimension: "JourneyName", metric: "JourneyTotalUsers", label: "Journey", required: true },
		metrics: [
			journey("JourneyTotalUsers", "Users", "Users who entered the journey.", "count", undefined),
			journey("JourneyCompletionUsers", "Completions", "Users who completed the journey.", "count", undefined),
			journey("JourneyTransitionCountUser", "Transitions (users)", "Users per stage-to-stage transition.", "count", ["FromStage", "ToStage"], ["FromStage", "ToStage", "FromNode", "ToNode"]),
			journey("JourneyStageUserCount", "Users by stage", "Users at each stage.", "count", ["FromStage"], ["FromStage"]),
			journey("JourneyStageChurnRate", "Churn by stage", "Share of users who left at each stage.", "rate", ["FromStage"], ["FromStage"]),
			journey("JourneyStageSkipRate", "Skips by stage", "Share of users who skipped each stage.", "rate", ["FromStage"], ["FromStage"]),
			journey("JourneyNodeUserCount", "Users by node", "Users at each node.", "count", ["FromNode"], ["FromNode", "FromStage"]),
			journey("JourneyNodeUserChurnRate", "Churn by node", "Share of users who left at each node.", "rate", ["FromNode"], ["FromNode", "FromStage"]),
			journey("JourneyEntryTransitions", "Entries", "Transitions into the journey.", "count", undefined),
			journey("JourneyLastStageTransitions", "Last-stage transitions", "Transitions into the last stage.", "count", undefined),
			journey("JourneyTransitionCount", "Transitions", "Stage-to-stage transitions.", "count", ["FromStage", "ToStage"], ["FromStage", "ToStage", "FromNode", "ToNode"]),
			journey("JourneyUserPctOfSource", "Users, % of source", "Users per transition as a share of the source stage.", "rate", ["FromStage", "ToStage"], ["FromStage", "ToStage", "FromNode", "ToNode"]),
			journey("JourneyUserPctOfStart", "Users, % of start", "Users per transition as a share of the journey's start.", "rate", ["FromStage", "ToStage"], ["FromStage", "ToStage", "FromNode", "ToNode"]),
			journey("JourneyTransitionPctOfSource", "Transitions, % of source", "Transitions as a share of the source stage.", "rate", ["FromStage", "ToStage"], ["FromStage", "ToStage", "FromNode", "ToNode"]),
			journey("JourneyTransitionPctOfStart", "Transitions, % of start", "Transitions as a share of the journey's start.", "rate", ["FromStage", "ToStage"], ["FromStage", "ToStage", "FromNode", "ToNode"]),
			journey("JourneyStageTransitionCount", "Transitions by stage", "Transitions out of each stage.", "count", ["FromStage"], ["FromStage"]),
			journey("JourneyStageTransitionChurnRate", "Transition churn by stage", "Share of transitions that ended at each stage.", "rate", ["FromStage"], ["FromStage"]),
			journey("JourneyStageSkipUserCount", "Users who skipped", "Users who skipped each stage.", "count", ["FromStage"], ["FromStage"]),
			journey("JourneyStageSkipTransitionCount", "Skipped transitions", "Transitions that skipped each stage.", "count", ["FromStage"], ["FromStage"]),
			journey("JourneyStageSkipTransitionRate", "Skip rate (transitions)", "Share of transitions that skipped each stage.", "rate", ["FromStage"], ["FromStage"]),
			journey("JourneyNodeTransitionCount", "Transitions by node", "Transitions out of each node.", "count", ["FromNode"], ["FromNode", "FromStage"]),
			journey("JourneyNodeUserChurnCount", "Users who left by node", "Users who left at each node.", "count", ["FromNode"], ["FromNode", "FromStage"]),
			journey("JourneyNodeTransitionChurnCount", "Transitions that ended by node", "Transitions that ended at each node.", "count", ["FromNode"], ["FromNode", "FromStage"]),
			journey("JourneyNodeTransitionChurnRate", "Transition churn by node", "Share of transitions that ended at each node.", "rate", ["FromNode"], ["FromNode", "FromStage"]),
		],
	},
	{
		key: "events",
		title: "Custom events",
		help: "Needs the experience to log AnalyticsService custom events. Pick an event, or break down by event name.",
		pick: { dimension: "CustomEventName", metric: "CustomEventCount", label: "Event", required: false },
		metrics: [
			event("CustomEventCount", "Event count", "Times the event fired.", "count", "sum"),
			event("CustomEventCountUser", "Users", "Users who fired the event.", "count", "sum"),
			event("CustomEventSumValue", "Sum of values", "Total of the event's values.", "decimal", "sum"),
			event("CustomEventAvgValue", "Average value", "Average of the event's values.", "decimal", "mean"),
			event("CustomEventAvgPerUserValue", "Average per user", "Average total value per user.", "decimal", "mean"),
			event("CustomEventMinValue", "Minimum value", "Smallest value.", "decimal", "mean"),
			event("CustomEventMaxValue", "Maximum value", "Largest value.", "decimal", "max"),
		],
	},
	{
		key: "thumbnails",
		title: "Thumbnails",
		help: "Thumbnail personalization results per thumbnail (Roblox keeps 30 days).",
		metrics: [
			{ id: "ThumbnailImpressions", title: "Impressions", help: "Impressions per thumbnail.", format: "count", granularities: ["OneHour", "OneDay", "None"], breakdowns: ["ThumbnailAsset", "ThumbnailList"], retentionDays: 30, aggregate: "sum", defaultBreakdown: ["ThumbnailAsset"] },
			{ id: "ThumbnailQualifiedPTR", title: "Qualified play-through rate", help: "Qualified plays per impression.", format: "rate", granularities: ["OneHour", "OneDay", "None"], breakdowns: ["ThumbnailAsset", "ThumbnailList"], retentionDays: 30, aggregate: "mean", defaultBreakdown: ["ThumbnailAsset"] },
			{ id: "ThumbnailQualifiedPlays", title: "Qualified plays", help: "Qualified plays per thumbnail.", format: "count", granularities: ["OneHour", "OneDay", "None"], breakdowns: ["ThumbnailAsset", "ThumbnailList"], retentionDays: 30, aggregate: "sum", defaultBreakdown: ["ThumbnailAsset"] },
			{ id: "ThumbnailWinningSegments", title: "Winning segments", help: "Segments where each thumbnail won.", format: "count", granularities: ["OneHour", "OneDay", "None"], breakdowns: ["ThumbnailAsset", "ThumbnailList"], retentionDays: 30, aggregate: "sum", defaultBreakdown: ["ThumbnailAsset"], preferTotal: true },
			{ id: "ThumbnailL7QualifiedPTR", title: "7-day qualified play-through", help: "Rolling 7-day qualified play-through rate.", format: "rate", granularities: ["OneHour", "OneDay", "None"], breakdowns: ["ThumbnailAsset", "ThumbnailList"], retentionDays: 30, aggregate: "mean", defaultBreakdown: ["ThumbnailAsset"] },
			{ id: "ThumbnailAverageSessionLengthMinutes", title: "Average session time", help: "Minutes per session per thumbnail.", format: "minutes", granularities: ["OneHour", "OneDay", "None"], breakdowns: ["ThumbnailAsset", "ThumbnailList"], retentionDays: 30, aggregate: "mean", defaultBreakdown: ["ThumbnailAsset"] },
		],
	},
	{
		key: "datastores",
		title: "Data stores",
		help: "Data store traffic against its limits (Roblox keeps 28 days).",
		metrics: [
			ds("DataStoreRequests", "Requests", "All data store requests.", ["DataStoreOperation", "DataStoreStatus", "DataStoreTypeV2"]),
			ds("DataStoreRequestsByStatus", "Requests by status", "Successes, throttles and errors.", ["DataStoreStatus", "DataStoreTypeV2"]),
			ds("DataStoreStorageUsageBytes", "Storage used", "Bytes stored.", [], "bytes"),
			ds("DataStoreRequestsByEndpoint", "Requests by API", "Requests per data store API.", ["DataStoreOperation", "DataStoreTypeV2"]),
			ds("DataStoreReadRequests", "Reads", "Read requests.", ["DataStoreTypeV2"]),
			ds("DataStoreWriteRequests", "Writes", "Write requests.", ["DataStoreTypeV2"]),
			ds("DataStoreListRequests", "Lists", "List requests.", ["DataStoreTypeV2"]),
			ds("DataStoreRemoveRequests", "Removes", "Remove requests.", ["DataStoreTypeV2"]),
			ds("DataStoreConsumedReadRequests", "Read budget used", "Read requests counted against the budget, by source.", ["DataStoreRequestSource", "DataStoreTypeV2"]),
			ds("DataStoreConsumedWriteRequests", "Write budget used", "Write requests counted against the budget, by source.", ["DataStoreRequestSource", "DataStoreTypeV2"]),
			ds("DataStoreConsumedListRequests", "List budget used", "List requests counted against the budget, by source.", ["DataStoreRequestSource", "DataStoreTypeV2"]),
			ds("DataStoreConsumedRemoveRequests", "Remove budget used", "Remove requests counted against the budget, by source.", ["DataStoreRequestSource", "DataStoreTypeV2"]),
			ds("DataStoreReadRequestsByEndpoint", "Reads by API", "Read requests per API.", ["DataStoreOperation", "DataStoreTypeV2"]),
			ds("DataStoreWriteRequestsByEndpoint", "Writes by API", "Write requests per API.", ["DataStoreOperation", "DataStoreTypeV2"]),
			ds("DataStoreListRequestsByEndpoint", "Lists by API", "List requests per API.", ["DataStoreOperation", "DataStoreTypeV2"]),
			ds("DataStoreRemoveRequestsByEndpoint", "Removes by API", "Remove requests per API.", ["DataStoreOperation", "DataStoreTypeV2"]),
		],
	},
	{
		key: "memorystores",
		title: "Memory stores",
		help: "Memory store use against its quota (Roblox keeps 28 days).",
		metrics: [
			ds("MemoryStoreMemoryUsageBytes", "Memory used", "Bytes in memory stores.", [], "bytes"),
			ds("MemoryStoreRequests", "Requests", "All memory store requests.", ["MemoryStoreOperation", "MemoryStoreStatus"]),
			ds("MemoryStoreRequestsByStatus", "Requests by status", "Successes, throttles and errors.", ["MemoryStoreStatus"]),
			ds("MemoryStoreRequestUnitsByEndpoint", "Request units by API", "Request units used per API.", ["MemoryStoreOperation"]),
			ds("MemoryStoreRequestsByEndpoint", "Requests by API", "Requests per API.", ["MemoryStoreOperation"]),
		],
	},
	{
		key: "matchmaking",
		title: "Matchmaking",
		help: "How well matchmaking signals match players (Roblox keeps 90 days).",
		metrics: [
			pct("MatchmakingSignalsEstimatePing", "Estimated ping", "Estimated ping of the chosen server.", "decimal", ["OneHour", "OneDay"], MM_DIMS, { retentionDays: 90 }),
			pct("MatchmakingSignalsOccupancyRatio", "Occupancy", "How full the chosen servers were.", "rate", ["OneHour", "OneDay"], MM_DIMS, { retentionDays: 90 }),
			pct("MatchmakingSignalsAgeDifference", "Age difference", "Age difference to the server's players.", "decimal", ["OneHour", "OneDay"], MM_DIMS, { retentionDays: 90 }),
			pct("MatchmakingSignalsCommonLanguageRatio", "Common language", "Share of players with the same language.", "rate", ["OneHour", "OneDay"], MM_DIMS, { retentionDays: 90 }),
			pct("MatchmakingSignalsCommonDeviceTypeRatio", "Common device type", "Share of players on the same device type.", "rate", ["OneHour", "OneDay"], MM_DIMS, { retentionDays: 90 }),
			pct("MatchmakingSignalsCommonChatGroupRatio", "Common chat group", "Share of players with chat in common.", "rate", ["OneHour", "OneDay"], MM_DIMS, { retentionDays: 90 }),
			pct("MatchmakingSignalsVoiceChatRatio", "Voice chat", "Share of players with voice chat.", "rate", ["OneHour", "OneDay"], MM_DIMS, { retentionDays: 90 }),
			pct("MatchmakingSignalsPlayHistoryDifference", "Play history difference", "Play history difference to the server's players.", "decimal", ["OneHour", "OneDay"], MM_DIMS, { retentionDays: 90 }),
			{ id: "MatchmakingSignalsPreferredPlayerMatchRatioAvg", title: "Preferred player match", help: "Share of joins with a preferred player.", format: "rate", granularities: ["OneHour", "OneDay"], breakdowns: MM_DIMS, retentionDays: 90, aggregate: "mean" },
			pct("MatchmakingCategoricalCustomSignalsSimilarityRatio", "Custom categorical signals", "Similarity of your categorical custom signals.", "rate", ["OneHour", "OneDay", "None"], ["MatchmakingCategoricalCustomSignal", "Place", "Platform", "AgeGroup", "Locale"], { retentionDays: 90 }),
			pct("MatchmakingNumericCustomSignalsDifference", "Custom numeric signals", "Difference of your numeric custom signals.", "decimal", ["OneHour", "OneDay", "None"], ["MatchmakingNumericCustomSignal", "Place", "Platform", "AgeGroup", "Locale"], { retentionDays: 90 }),
		],
	},
	{
		key: "safety",
		title: "Safety",
		metrics: [
			{ id: "TotalAbuseReports", title: "Abuse reports", help: "Abuse reports filed in the experience.", format: "count", granularities: ["OneDay"], breakdowns: ["AbuseCategory", "AbuseChannel"], aggregate: "sum" },
			{ id: "UniqueAbuseReportSubmittersPer1000PlaytimeHours", title: "Reporters per 1,000 hours", help: "Users who filed reports per 1,000 playtime hours.", format: "decimal", granularities: ["OneDay"], breakdowns: ["AbuseCategory", "AbuseChannel"], aggregate: "mean" },
		],
	},
	{
		key: "ads",
		title: "Ads",
		help: "In-experience ads you show (rewarded video and other publisher ads).",
		metrics: [
			{ id: "AdsPublisherReportingTotalRevenueRobux", title: "Ad revenue", help: "Robux earned from ads.", format: "robux", granularities: ["OneHour", "OneDay", "None"], breakdowns: ADS_DIMS.filter((d) => d !== "PlacementType" && d !== "AdRewardId"), aggregate: "sum" },
			{ id: "AdsPublisherReportingTotalImpressions", title: "Ad impressions", help: "Ads shown.", format: "count", granularities: ["OneHour", "OneDay", "None"], breakdowns: ADS_DIMS.filter((d) => d !== "PlacementType" && d !== "AdRewardId"), aggregate: "sum" },
			{ id: "AdsPublisherReportingVideo2DRevenueRobux", title: "Video ad revenue", help: "Robux from video ads.", format: "robux", granularities: ["OneHour", "OneDay", "None"], breakdowns: ADS_DIMS, aggregate: "sum" },
			{ id: "AdsPublisherReportingVideo2DImpressions", title: "Video ad impressions", help: "Video ads shown.", format: "count", granularities: ["OneHour", "OneDay", "None"], breakdowns: ADS_DIMS, aggregate: "sum" },
			{ id: "AdsPublisherReportingVideo2DEpmNoUnvalidatedPc", title: "Video eCPM", help: "Robux per 1,000 video impressions.", format: "decimal", granularities: ["OneHour", "OneDay", "None"], breakdowns: ADS_DIMS, aggregate: "mean" },
			{ id: "AdsPublisherReportingVideo2DDailyUniqueViewer", title: "Daily video viewers", help: "Unique users who watched a video ad.", format: "count", granularities: ["OneDay", "None"], breakdowns: ADS_DIMS.filter((d) => d !== "AdRewardId"), aggregate: "mean" },
		],
	},
	{
		key: "voice",
		title: "Voice",
		help: "Speech-to-text and text-to-speech use (Roblox keeps 28 days).",
		metrics: [
			ds("SpeechToTextTranscriptionUsage", "Speech-to-text use", "Transcription use.", ["SpeechToTextTranscriptionStatus"]),
			ds("SpeechToTextTranscriptionStatuses", "Speech-to-text results", "Transcriptions by result.", ["SpeechToTextTranscriptionStatus"]),
			ds("TextToSpeechAssetSuccesses", "Text-to-speech assets", "Text-to-speech assets made.", []),
			ds("TextToSpeechRawAudioSuccesses", "Text-to-speech audio", "Raw audio generated.", ["TextToSpeechRawAudioStatus"]),
			ds("TextToSpeechRawAudioErrors", "Text-to-speech errors", "Raw audio requests that failed.", ["TextToSpeechRawAudioStatus"]),
		],
	},
	{ key: "benchmarks", title: "Benchmarks", help: "Your metric against similar, same-genre or top experiences.", metrics: [], views: ["benchmarks"] },
	{ key: "compare", title: "Compare", help: "This experience next to your others: totals for the range.", metrics: [], views: ["compare"] },
];

export const ALL_METRICS: MetricDef[] = METRIC_GROUPS.flatMap((g) => g.metrics);

// Range and granularity ------------------------------------------------------------------------------------------------

export const DAY = 86_400_000;
export const RANGES = [1, 7, 28, 90, 365] as const;
export type RangeDays = (typeof RANGES)[number];

/** A preset (the last N days) or a custom span of whole UTC days (YYYY-MM-DD, both inclusive). */
export type RangeSpec = { kind: "preset"; days: RangeDays } | { kind: "custom"; start: string; end: string };

export type GranularityChoice = "Auto" | Granularity;
export const GRANULARITY_CHOICES: { value: GranularityChoice; label: string }[] = [
	{ value: "Auto", label: "Auto" },
	{ value: "OneMinute", label: "Minute" },
	{ value: "HalfHour", label: "30 min" },
	{ value: "OneHour", label: "Hourly" },
	{ value: "OneDay", label: "Daily" },
	{ value: "OneWeek", label: "Weekly" },
	{ value: "OneMonth", label: "Monthly" },
	{ value: "None", label: "Total" },
];
export const GRANULARITY_LABEL: Record<Granularity, string> = { OneMinute: "per minute", HalfHour: "per 30 min", OneHour: "hourly", OneDay: "daily", OneWeek: "weekly", OneMonth: "monthly", None: "total" };

/**
 * The longest span (days) each granularity is asked for: finer buckets over long spans are slow or rejected, and
 * Roblox takes only week / month / total over more than 2 years (730 days).
 */
const MAX_SPAN: Record<Granularity, number> = { OneMinute: 1, HalfHour: 7, OneHour: 31, OneDay: 730, OneWeek: Infinity, OneMonth: Infinity, None: Infinity };

/** Roblox's standard retention (1468 days) for metrics without their own. */
export const STANDARD_RETENTION_DAYS = 1468;

/** A YYYY-MM-DD as a UTC midnight, or null. */
export function parseDay(text: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
	if (!m) return null;
	const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	const d = new Date(t);
	return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? t : null;
}

export function dayString(t: number): string {
	return new Date(t).toISOString().slice(0, 10);
}

/** Why a custom range can't be used, or null when it can. */
export function customRangeError(start: string, end: string, now = Date.now()): string | null {
	const s = parseDay(start);
	const e = parseDay(end);
	if (s === null || e === null) return "Use YYYY-MM-DD dates.";
	if (s > e) return "The start is after the end.";
	if (e > Math.floor(now / DAY) * DAY) return "The end is in the future.";
	if (s < Math.floor(now / DAY) * DAY - STANDARD_RETENTION_DAYS * DAY) return `Roblox keeps at most ${STANDARD_RETENTION_DAYS} days.`;
	return null;
}

/** The span's length in days. */
export function spanDays(range: RangeSpec, now = Date.now()): number {
	if (range.kind === "preset") return range.days;
	const s = parseDay(range.start);
	const e = parseDay(range.end);
	return s === null || e === null ? 28 : Math.max(1, Math.round((e - s) / DAY) + 1);
}

const COARSENESS: Granularity[] = ["OneMinute", "HalfHour", "OneHour", "OneDay", "OneWeek", "OneMonth", "None"];

/**
 * The days a metric's query really covers: the range after the metric's retention cap (a 28-day metric over a 3-year
 * custom range covers 28 days, so its granularity is chosen for 28).
 */
export function effectiveSpanDays(range: RangeSpec, metric: Pick<MetricDef, "retentionDays">, now = Date.now()): number {
	const tr = timeRange(range, metric, "OneDay", { now });
	return Math.max(1, Math.round((Date.parse(tr.endTime) - Date.parse(tr.startTime)) / DAY));
}

/**
 * The granularity a card asks for: the person's pick when the metric has it and it fits the span, else the closest the
 * metric supports (Roblox answers 400 for a granularity a metric lacks). Spans over two years only take week / month /
 * total (MAX_SPAN). `span` is the span after the retention cap (effectiveSpanDays). When none of the metric's
 * granularities covers the span (a daily-only metric over 3 years), the metric's coarsest one is used and `maxDays`
 * says how many of the range's last days to ask for (pass it to timeRange).
 */
export function resolveGranularity(metric: MetricDef, wanted: GranularityChoice, span: number): { granularity: Granularity; note: string | null; maxDays: number | null } {
	const fits = (g: Granularity) => metric.granularities.includes(g) && span <= MAX_SPAN[g];
	if (wanted !== "Auto" && fits(wanted)) return { granularity: wanted, note: null, maxDays: null };
	const order: Granularity[] =
		wanted === "Auto"
			? metric.preferTotal
				? ["None", "OneDay", "OneHour"]
				: span <= 1
					? ["OneHour", "HalfHour", "OneDay", "None"]
					: span > 730
						? ["OneWeek", "OneMonth", "None"]
						: ["OneDay", "OneHour", "OneWeek", "None"]
			: // the nearest coarser one, then finer
				COARSENESS.slice(Math.max(0, COARSENESS.indexOf(wanted)));
	const pick = order.find(fits) ?? metric.granularities.find(fits);
	if (pick) {
		const note = wanted !== "Auto" && pick !== wanted ? `Shown ${GRANULARITY_LABEL[pick]}: this metric has no ${GRANULARITY_LABEL[wanted]} data for this range.` : null;
		return { granularity: pick, note, maxDays: null };
	}
	// Nothing covers the whole span: the coarsest bucket the metric has, over the last days that bucket allows.
	const coarsest = [...metric.granularities].sort((a, b) => COARSENESS.indexOf(a) - COARSENESS.indexOf(b)).pop() ?? "OneDay";
	const maxDays = MAX_SPAN[coarsest];
	return {
		granularity: coarsest,
		note: `Shown ${GRANULARITY_LABEL[coarsest]} for the last ${maxDays} ${maxDays === 1 ? "day" : "days"} of the range: this metric has nothing coarser${span > 730 ? ", and Roblox takes only weekly, monthly or total data over more than 2 years" : ""}.`,
		maxDays,
	};
}

/**
 * The query's [start, end) for a metric: whole UTC days for daily and coarser buckets, up to the last half hour for
 * finer ones; capped to the metric's retention (`capped`) and, with `maxDays`, to the range's last that many days
 * (`clipped`).
 */
export function timeRange(
	range: RangeSpec,
	metric: Pick<MetricDef, "retentionDays">,
	granularity: Granularity,
	options: { maxDays?: number | null; now?: number } = {},
): { startTime: string; endTime: string; capped: boolean; clipped: boolean } {
	const now = options.now ?? Date.now();
	const subDay = granularity === "OneMinute" || granularity === "HalfHour" || granularity === "OneHour";
	const today = Math.floor(now / DAY) * DAY;
	const latest = subDay ? Math.floor(now / 1_800_000) * 1_800_000 : today;
	let start: number;
	let end: number;
	if (range.kind === "preset") {
		end = latest;
		start = end - range.days * DAY;
	} else {
		start = parseDay(range.start) ?? today - 28 * DAY;
		end = Math.min(latest, (parseDay(range.end) ?? today - DAY) + DAY);
	}
	const oldest = today - (metric.retentionDays ?? STANDARD_RETENTION_DAYS) * DAY;
	const capped = start < oldest;
	if (capped) start = oldest;
	if (end <= start) end = start + (subDay ? 3_600_000 : DAY);
	const clipped = !!options.maxDays && end - start > options.maxDays * DAY;
	if (clipped) start = end - options.maxDays! * DAY;
	return { startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), capped, clipped };
}

export const DIMENSION_LABELS: Record<string, string> = {
	IsNewUser: "New / returning",
	AcquisitionSource: "Source",
	FirstPlayAcquisitionSource: "First-play source",
	FunnelSource: "Funnel source",
	Platform: "Platform",
	OperatingSystem: "OS",
	Country: "Country",
	AgeGroupV2: "Age",
	AgeGroup: "Age",
	Gender: "Gender",
	Locale: "Locale",
	UserO18Eligibility: "18+ eligible",
	UserSegmentationAccountAge: "Account age",
	UserSegmentationActivationStatus: "Activation",
	UserSegmentationEngagementLevel: "Engagement level",
	UserSegmentationPayerStatus: "Payer status",
	UserSegmentationPlatformActivationStatus: "Platform activation",
	UserSegmentationPlatformSpenderStatus: "Platform spender",
	PayerStatus: "Payer status",
	RevenueSource: "Revenue source",
	BalanceType: "Balance type",
	Place: "Place",
	PlaceVersion: "Place version",
	MemoryGroup: "Device memory",
	CrashType: "Crash type",
	SessionTimeBucket: "Session length",
	CohortDay: "Day",
	CohortWeek: "Week",
	ProductKey: "Product",
	ProductType: "Product type",
	SalesLocation: "Sold in",
	CollectibleItemType: "Collectible type",
	CollectibleItemTargetType: "Collectible target",
	CollectibleItemTargetTypeId: "Collectible target id",
	CurrencyType: "Currency",
	FlowType: "Source / sink",
	TransactionType: "Transaction type",
	ItemSku: "Item",
	CustomField1: "Custom field 1",
	CustomField2: "Custom field 2",
	CustomField3: "Custom field 3",
	CustomEventName: "Event",
	FunnelName: "Funnel",
	FunnelStep: "Step",
	JourneyName: "Journey",
	JourneyVersion: "Version",
	FromStage: "From stage",
	ToStage: "To stage",
	FromNode: "From node",
	ToNode: "To node",
	ThumbnailAsset: "Thumbnail",
	ThumbnailList: "Thumbnail set",
	ClientCpuTimeCategory: "CPU category",
	ClientCpuTimeSubCategory: "CPU subcategory",
	CpuTimeCategory: "CPU category",
	CpuTimeSubCategory: "CPU subcategory",
	MemoryUsageCategory: "Memory category",
	MemoryUsageSubCategory: "Memory subcategory",
	ServerAgeBucket: "Server age",
	SimplifiedUrl: "URL",
	DataStoreOperation: "API",
	DataStoreStatus: "Status",
	DataStoreTypeV2: "Store type",
	DataStoreRequestSource: "Source",
	MemoryStoreOperation: "API",
	MemoryStoreStatus: "Status",
	MatchmakingCategoricalCustomSignal: "Signal",
	MatchmakingNumericCustomSignal: "Signal",
	AbuseCategory: "Category",
	AbuseChannel: "Channel",
	AdFormat: "Ad format",
	AdInstanceName: "Ad instance",
	AdPlacementId: "Placement",
	PlacementType: "Placement type",
	AdRewardId: "Reward",
	AdsPublisherReportingDataVersion: "Data version",
	SpeechToTextTranscriptionStatus: "Status",
	TextToSpeechRawAudioStatus: "Status",
};

export function dimLabel(d: string): string {
	return DIMENSION_LABELS[d] ?? d;
}

// Values -----------------------------------------------------------------------------------------------------------------

/** Roblox doesn't document a rate's scale: a fraction unless a value is above 1 (then percent). Answers fractions. */
export function normalizeRates(series: MetricSeries[], format: MetricFormat): MetricSeries[] {
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

/** "Mobile · US", or "Lobby → Shop" for a from / to pair. */
export function seriesLabel(s: MetricSeries): string {
	if (!s.breakdowns.length) return "All";
	const label = (b: MetricSeries["breakdowns"][number]) => b.displayValue || b.value || "(none)";
	const from = s.breakdowns.find((b) => b.dimension.startsWith("From"));
	const to = s.breakdowns.find((b) => b.dimension.startsWith("To"));
	if (from && to) {
		const rest = s.breakdowns.filter((b) => b !== from && b !== to).map(label);
		return [`${label(from)} → ${label(to)}`, ...rest].join(" · ");
	}
	return s.breakdowns.map(label).join(" · ");
}

/** Natural order for labels like "1", "2", "10" or "0-30s", "30-60s". */
export function naturalCompare(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** The biggest `n` series by their total (a breakdown can answer dozens of countries). */
export function topSeries(series: MetricSeries[], n: number): MetricSeries[] {
	const total = (s: MetricSeries) => s.dataPoints.reduce((a, p) => a + (p.value ?? 0), 0);
	return [...series].sort((a, b) => total(b) - total(a)).slice(0, n);
}

// Rate limit -------------------------------------------------------------------------------------------------------------

/**
 * At most `n` analytics queries in flight across the app, and (with `perMinute`) at most that many started in any 60 s
 * window: Roblox allows 30 queries a minute per key owner, so the app keeps a little headroom. Waits are bounded (a
 * queued task waits at most one window per attempt, 3 attempts).
 */
function limiter(n: number, perMinute?: number) {
	let active = 0;
	const waiting: (() => void)[] = [];
	const starts: number[] = [];
	return async function run<T>(task: () => Promise<T>): Promise<T> {
		// A finishing task hands its slot straight to the next waiter (active stays the same), so a call arriving
		// between the wake-up and the waiter resuming can't slip in and make it n + 1 in flight.
		if (active >= n) await new Promise<void>((go) => waiting.push(go));
		else active++;
		try {
			for (let attempt = 0; perMinute && attempt < 3; attempt++) {
				const now = Date.now();
				while (starts.length && now - starts[0]! >= 60_000) starts.shift();
				if (starts.length < perMinute) break;
				await new Promise<void>((go) => setTimeout(go, Math.min(60_000, 60_000 - (now - starts[0]!) + 50)));
			}
			if (perMinute) starts.push(Date.now());
			return await task();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}

/** Metric and dimension-value queries (30 a minute per key owner). */
export const analyticsSlot = limiter(2, 28);
/** Benchmark queries (300 a minute; still few at once). */
export const benchmarkSlot = limiter(2);
