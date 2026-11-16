/**
 * Analytics Query API and Analytics Benchmark API calls, checked against Roblox's OpenAPI document (2026-11):
 *   - POST /analytics-query-api/v1/universes/{universeId}/metrics { metric, granularity, startTime, endTime (exclusive),
 *     breakdown[], filter[{ dimension, values[], operation }], limit } -> { path, done, response?: { values[{ breakdowns[],
 *     dataPoints[{ time, value, stringValues?, status? }] }] }, error? }; a slow query answers done: false and is polled on
 *     GET /analytics-query-api/v1/universes/{universeId}/operations/metrics/{operationId}.
 *   - POST /analytics-query-api/v1/universes/{universeId}/dimension-values { metric, dimensions[], startTime, endTime,
 *     filter[], granularity, limit } (BETA) -> { response: { values[{ dimension, values[{ value, displayValue? }] }] } },
 *     polled on GET .../operations/dimension-values/{operationId}.
 *   - POST /analytics-benchmark/v1/universes/{universeId}/benchmarks { metric, startTime, endTime (inclusive, at most
 *     400 days), benchmarkType, percentiles[], filter[{ dimension, value }], benchmarkVariantId } (EXPERIMENTAL) ->
 *     { result: { values[{ breakdownValue[], dataPoints[{ time, value, metadata }] }] }, availableTypes[], objective }.
 * All three need universe.analytics:read. Metric queries and dimension lookups share Roblox's 30 a minute per key owner.
 */
import { HttpError } from "@/api/http";
import { ScopeError, type Granularity, type OpenCloud } from "@/api/opencloud";

export const ANALYTICS_SCOPES = ["universe.analytics:read"];

export type { Granularity };

export type FilterOperation = "In" | "NotIn" | "GreaterThan" | "GreaterThanOrEqual" | "LessThan" | "LessThanOrEqual" | "Match";
export const FILTER_OPERATIONS: FilterOperation[] = ["In", "NotIn", "GreaterThan", "GreaterThanOrEqual", "LessThan", "LessThanOrEqual", "Match"];

export interface QueryFilter {
	dimension: string;
	values: string[];
	operation: FilterOperation;
}

export interface MetricQuery {
	metric: string;
	granularity: Granularity;
	/** RFC 3339; start inclusive, end exclusive. */
	startTime: string;
	endTime: string;
	breakdown?: string[];
	filter?: QueryFilter[];
	/** Top N series; Roblox takes it only with granularity None and a breakdown. */
	limit?: number;
}

export type DataPointStatus = "Valid" | "Projected" | "NotStatisticallySignificant" | "InsufficientSampleSize";

export interface MetricPoint {
	time: string;
	value: number | null;
	stringValues?: string[];
	status?: DataPointStatus | string;
}

export interface MetricSeries {
	breakdowns: { dimension: string; value: string; displayValue?: string }[];
	dataPoints: MetricPoint[];
}

export interface DimensionValues {
	dimension: string;
	values: { value: string; displayValue?: string }[];
}

export type BenchmarkType = "BENCHMARK_TYPE_GENRE" | "BENCHMARK_TYPE_SIMILARITY" | "BENCHMARK_TYPE_TOP_EXPERIENCES";

export interface BenchmarkQuery {
	metric: string;
	/** RFC 3339 at midnight UTC; both ends inclusive, at most 400 days apart. */
	startTime: string;
	endTime: string;
	benchmarkType?: BenchmarkType;
	/** 0-100, at most 10. */
	percentiles?: number[];
	filter?: { dimension: string; value: string }[];
	benchmarkVariantId?: "l7_average";
}

export interface BenchmarkSeries {
	breakdownValue: { dimension: string; value: string; displayValue?: string }[];
	dataPoints: { time: string; value: number | null; metadata?: { benchmarkType?: string; genre?: string } }[];
}

export interface BenchmarkResult {
	values: BenchmarkSeries[];
	availableTypes: string[];
	objective: "BENCHMARK_OBJECTIVE_MAXIMIZE" | "BENCHMARK_OBJECTIVE_MINIMIZE" | string | null;
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map(record) : [];
}

function num(value: unknown): number | null {
	const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
	return Number.isFinite(n) ? n : null;
}

/** Waits `ms`, or throws when `signal` aborts first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((done, fail) => {
		if (signal?.aborted) return fail(new HttpError(0, "cancelled", "analytics"));
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			done();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			fail(new HttpError(0, "cancelled", "analytics"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Roblox's error text out of a failed call (`{ error: { code, message } }` or `{ message }`), keeping ScopeError as is.
 * `limit` names the endpoint's own rate limit for a 429 (metric queries and dimension lookups 30 a minute per key
 * owner, operation polls 3000, benchmarks 300).
 */
function explain(error: unknown, what: string, limit: string): unknown {
	if (error instanceof ScopeError || !(error instanceof HttpError)) return error;
	const body = record(error.body);
	const e = record(body.error);
	const message = typeof e.message === "string" ? e.message : typeof body.message === "string" ? body.message : error.message;
	const hint =
		error.status === 429
			? ` Roblox allows ${limit} a minute per key owner; wait a minute and try again.`
			: typeof e.code === "number" && e.code === 2001
				? " (this metric doesn't support that granularity, breakdown or filter)"
				: "";
	return new HttpError(error.status, `${what}: ${message}${hint}`, error.where, error.body);
}

/**
 * POST a long-running analytics operation and poll it until done: at most `maxPolls` polls `pollMs` apart (so the wait
 * is bounded), each with requestJson's 30 s deadline.
 */
async function longRunning(
	cloud: OpenCloud,
	universeId: number,
	kind: "metrics" | "dimension-values",
	body: unknown,
	what: string,
	options: { signal?: AbortSignal; pollMs?: number; maxPolls?: number },
): Promise<Record<string, unknown>> {
	const path = `/analytics-query-api/v1/universes/${universeId}/${kind}`;
	let res: Record<string, unknown>;
	try {
		res = record(await cloud.request<unknown>("POST", path, body, options.signal, ANALYTICS_SCOPES));
	} catch (error) {
		throw explain(error, what, "30 analytics queries");
	}
	const maxPolls = options.maxPolls ?? 20;
	for (let polls = 0; res.done !== true && !res.error; polls++) {
		if (polls >= maxPolls) throw new HttpError(504, `${what}: Roblox didn't finish the query in time; try again in a minute`, path);
		const op = /operations\/(?:(?:metrics|dimension-values)\/)?([^/?#]+)\/?$/.exec(typeof res.path === "string" ? res.path : "");
		if (!op) throw new HttpError(502, `${what}: Roblox answered without an operation to poll`, path);
		await sleep(Math.min(5000, (options.pollMs ?? 1000) * (polls < 3 ? 1 : 2)), options.signal);
		try {
			res = record(
				await cloud.request<unknown>("GET", `/analytics-query-api/v1/universes/${universeId}/operations/${kind}/${encodeURIComponent(op[1]!)}`, undefined, options.signal, ANALYTICS_SCOPES),
			);
		} catch (error) {
			throw explain(error, what, "3000 analytics status checks");
		}
	}
	const error = record(res.error);
	if (typeof error.message === "string" || typeof error.code === "number") {
		const hint = error.code === 2001 ? " (this metric doesn't support that granularity, breakdown or filter)" : "";
		throw new HttpError(400, `${what}: ${String(error.message ?? "query failed")}${hint}`, path, res);
	}
	return record(res.response);
}

/** A metric's series (one per breakdown value), points sorted by time. Keeps each point's status and stringValues. */
export async function queryMetrics(
	cloud: OpenCloud,
	universeId: number,
	query: MetricQuery,
	options: { signal?: AbortSignal; pollMs?: number; maxPolls?: number } = {},
): Promise<MetricSeries[]> {
	const body: MetricQuery = { metric: query.metric, granularity: query.granularity, startTime: query.startTime, endTime: query.endTime };
	if (query.breakdown?.length) body.breakdown = query.breakdown;
	if (query.filter?.length) body.filter = query.filter;
	if (query.limit && query.granularity === "None" && query.breakdown?.length) body.limit = Math.max(1, Math.min(2_147_483_647, Math.round(query.limit)));
	const response = await longRunning(cloud, universeId, "metrics", body, query.metric, options);
	return list(response.values).map((s) => ({
		breakdowns: list(s.breakdowns)
			.filter((b) => typeof b.dimension === "string" && typeof b.value === "string")
			.map((b) => ({ dimension: b.dimension as string, value: b.value as string, ...(typeof b.displayValue === "string" ? { displayValue: b.displayValue } : {}) })),
		dataPoints: list(s.dataPoints)
			.filter((p) => typeof p.time === "string" && Number.isFinite(Date.parse(p.time)))
			.map(
				(p): MetricPoint => ({
					time: p.time as string,
					value: num(p.value),
					...(Array.isArray(p.stringValues) ? { stringValues: p.stringValues.map((v) => String(v)) } : {}),
					...(typeof p.status === "string" ? { status: p.status } : {}),
				}),
			)
			.sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
	}));
}

/** The values a dimension takes for a metric in a range (filter pickers: funnels, events, currencies, places). BETA. */
export async function queryDimensionValues(
	cloud: OpenCloud,
	universeId: number,
	query: { metric: string; dimensions: string[]; startTime: string; endTime: string; filter?: QueryFilter[]; granularity?: Granularity; limit?: number },
	options: { signal?: AbortSignal; maxPolls?: number } = {},
): Promise<DimensionValues[]> {
	const body: Record<string, unknown> = { metric: query.metric, dimensions: query.dimensions, startTime: query.startTime, endTime: query.endTime };
	if (query.filter?.length) body.filter = query.filter;
	if (query.granularity) body.granularity = query.granularity;
	if (query.limit) body.limit = Math.max(1, Math.round(query.limit));
	const response = await longRunning(cloud, universeId, "dimension-values", body, `${query.dimensions.join(", ")} values`, options);
	return list(response.values)
		.filter((d) => typeof d.dimension === "string")
		.map((d) => ({
			dimension: d.dimension as string,
			values: list(d.values)
				.filter((v) => typeof v.value === "string")
				.map((v) => ({ value: v.value as string, ...(typeof v.displayValue === "string" && v.displayValue ? { displayValue: v.displayValue } : {}) })),
		}));
}

/** Daily benchmark percentiles for a metric (genre, similar or top experiences). EXPERIMENTAL; 300 a minute. */
export async function queryBenchmarks(cloud: OpenCloud, universeId: number, query: BenchmarkQuery, signal?: AbortSignal): Promise<BenchmarkResult> {
	const body: Record<string, unknown> = { metric: query.metric, startTime: query.startTime, endTime: query.endTime };
	if (query.benchmarkType) body.benchmarkType = query.benchmarkType;
	if (query.percentiles?.length) body.percentiles = query.percentiles.slice(0, 10).map((p) => Math.max(0, Math.min(100, Math.round(p))));
	if (query.filter?.length) body.filter = query.filter;
	if (query.benchmarkVariantId) body.benchmarkVariantId = query.benchmarkVariantId;
	let res: Record<string, unknown>;
	try {
		res = record(await cloud.request<unknown>("POST", `/analytics-benchmark/v1/universes/${universeId}/benchmarks`, body, signal, ANALYTICS_SCOPES));
	} catch (error) {
		throw explain(error, `${query.metric} benchmarks`, "300 benchmark queries");
	}
	const result = record(res.result);
	return {
		values: list(result.values).map((s) => ({
			breakdownValue: list(s.breakdownValue)
				.filter((b) => typeof b.dimension === "string")
				.map((b) => ({ dimension: b.dimension as string, value: String(b.value ?? ""), ...(typeof b.displayValue === "string" ? { displayValue: b.displayValue } : {}) })),
			dataPoints: list(s.dataPoints)
				.filter((p) => typeof p.time === "string" && Number.isFinite(Date.parse(p.time)))
				.map((p) => {
					const m = record(p.metadata);
					return {
						time: p.time as string,
						value: num(p.value),
						metadata: { ...(typeof m.benchmarkType === "string" ? { benchmarkType: m.benchmarkType } : {}), ...(typeof m.genre === "string" ? { genre: m.genre } : {}) },
					};
				})
				.sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
		})),
		availableTypes: Array.isArray(res.availableTypes) ? res.availableTypes.map((t) => String(t)).filter((t) => t !== "BENCHMARK_TYPE_INVALID") : [],
		objective: typeof res.objective === "string" ? res.objective : null,
	};
}
