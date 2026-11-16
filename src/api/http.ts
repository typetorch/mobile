/**
 * One fetch helper for every API the app calls: a 30 s deadline (never a hanging spinner), JSON in and out, and an
 * HttpError that carries the server's own message. Secrets go only into the headers the caller passes; they are never
 * put into an error message.
 */

export const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpError extends Error {
	override name = "HttpError";
	constructor(
		readonly status: number,
		message: string,
		/** The path or host the request went to (no query string, no secrets). */
		readonly where: string,
		readonly body?: unknown,
	) {
		super(message);
	}
	get unauthorized(): boolean {
		return this.status === 401;
	}
	get forbidden(): boolean {
		return this.status === 403;
	}
	get notFound(): boolean {
		return this.status === 404;
	}
}

export interface RequestOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/** A signal that aborts after `ms` or when `outer` aborts, plus a cleanup. */
export function deadline(ms: number, outer?: AbortSignal): { signal: AbortSignal; done: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error(`timed out after ${Math.round(ms / 1000)} s`)), ms);
	const onAbort = () => controller.abort(outer?.reason);
	if (outer) {
		if (outer.aborted) controller.abort(outer.reason);
		else outer.addEventListener("abort", onAbort);
	}
	return {
		signal: controller.signal,
		done: () => {
			clearTimeout(timer);
			outer?.removeEventListener("abort", onAbort);
		},
	};
}

function where(url: string): string {
	try {
		const u = new URL(url);
		return `${u.host}${u.pathname}`;
	} catch {
		return url.split("?")[0] ?? url;
	}
}

/** The best human message in an error body (Roblox, Open Cloud and TypeTorch shapes). */
export function errorMessage(body: unknown, status: number): string {
	if (body && typeof body === "object") {
		const b = body as Record<string, unknown>;
		if (typeof b.error === "string") return typeof b.detail === "string" ? `${b.error}: ${b.detail}` : b.error;
		if (b.error && typeof b.error === "object") {
			const e = b.error as Record<string, unknown>;
			if (typeof e.message === "string") return e.message;
		}
		if (typeof b.message === "string" && b.message) return b.message;
		if (typeof b.errorMessage === "string") return b.errorMessage;
		if (Array.isArray(b.errors) && b.errors.length) {
			const first = b.errors[0] as Record<string, unknown>;
			if (typeof first?.message === "string") return first.message;
		}
	}
	if (status === 401) return "not signed in (401)";
	if (status === 403) return "not allowed (403)";
	if (status === 404) return "not found (404)";
	if (status === 429) return "rate limited (429): wait a minute and pull to refresh";
	if (status === 502 || status === 504) return `the server is not answering (${status})`;
	return `HTTP ${status}`;
}

/** Fetches JSON. A 2xx with an empty body answers `undefined`. Throws HttpError. */
export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
	const method = options.method ?? (options.body === undefined ? "GET" : "POST");
	const headers: Record<string, string> = { accept: "application/json", ...options.headers };
	if (options.body !== undefined) headers["content-type"] = headers["content-type"] ?? "application/json";
	const { signal, done } = deadline(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal);
	let response: Response;
	try {
		response = await fetch(url, {
			method,
			headers,
			body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
			signal,
		});
	} catch (error) {
		done();
		const reason = signal.aborted ? (signal.reason as Error | undefined)?.message ?? "aborted" : (error as Error).message;
		throw new HttpError(0, `cannot reach ${where(url)}: ${reason}`, where(url));
	}
	let text = "";
	try {
		text = await response.text();
	} finally {
		done();
	}
	let body: unknown = undefined;
	try {
		body = text ? JSON.parse(text) : undefined;
	} catch {
		body = undefined;
	}
	if (!response.ok) {
		const fallback = body === undefined && text && text.length < 300 && !text.trimStart().startsWith("<") ? text.trim() : undefined;
		throw new HttpError(response.status, fallback ?? errorMessage(body, response.status), where(url), body);
	}
	if (text && body === undefined) throw new HttpError(response.status, "the answer is not JSON", where(url));
	return body as T;
}

/** Runs `tasks` with at most `limit` at a time, keeping their order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			out[index] = await task(items[index] as T, index);
		}
	});
	await Promise.all(workers);
	return out;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
	const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
	if (!entries.length) return "";
	return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}`;
}
