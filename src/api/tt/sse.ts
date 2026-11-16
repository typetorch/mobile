/**
 * Server-Sent Events for React Native, which has no EventSource and whose fetch doesn't stream a body: an
 * XMLHttpRequest whose `onprogress` hands over the text read so far (RN sends incremental data when a progress
 * listener is set), parsed as `event:` / `data:` / `id:` lines with a blank line ending each message. It sends the
 * Bearer token in a header (the web's EventSource leans on the session cookie instead).
 *
 * One connection per call; `close()` ends it. A dropped stream is not reopened here: the hook (useEventStream in
 * src/features/maps/live-streams.ts) reopens it with a backoff and polls in the meantime.
 */

export interface SseMessage {
	/** The `event:` name ("message" when none). */
	event: string;
	data: string;
	id?: string;
}

export interface SseHandlers {
	onOpen?: () => void;
	onMessage: (message: SseMessage) => void;
	/** The stream ended or failed (`status` 0: no answer; a status: the server refused it). Called once. */
	onClose?: (reason: { status: number; message: string }) => void;
}

export interface SseConnection {
	close(): void;
}

/** Text left over after the last full message, at most this many characters (a stream that never ends a message). */
const MAX_PENDING = 1_000_000;
/** The XHR's text is cut back once it grows past this (RN keeps the whole response text otherwise). */
const MAX_TEXT = 4_000_000;

/** Splits SSE text into whole messages; returns them and how many characters were used. */
export function parseSse(text: string): { messages: SseMessage[]; used: number } {
	const messages: SseMessage[] = [];
	let used = 0;
	for (;;) {
		const end = nextBlankLine(text, used);
		if (end === null) break;
		const block = text.slice(used, end.at);
		used = end.at + end.length;
		let event = "message";
		let id: string | undefined;
		const data: string[] = [];
		for (const raw of block.split(/\r\n|\r|\n/)) {
			if (!raw || raw.startsWith(":")) continue;
			const colon = raw.indexOf(":");
			const field = colon < 0 ? raw : raw.slice(0, colon);
			let value = colon < 0 ? "" : raw.slice(colon + 1);
			if (value.startsWith(" ")) value = value.slice(1);
			if (field === "event") event = value || "message";
			else if (field === "data") data.push(value);
			else if (field === "id") id = value;
		}
		if (data.length || event !== "message") messages.push({ event, data: data.join("\n"), ...(id !== undefined ? { id } : {}) });
	}
	return { messages, used };
}

function nextBlankLine(text: string, from: number): { at: number; length: number } | null {
	const re = /\r\n\r\n|\n\n|\r\r/g;
	re.lastIndex = from;
	const m = re.exec(text);
	return m ? { at: m.index, length: m[0].length } : null;
}

/** Opens an SSE stream with headers (the Bearer token). */
export function openEventStream(url: string, headers: Record<string, string>, handlers: SseHandlers): SseConnection {
	const xhr = new XMLHttpRequest();
	let read = 0;
	let closed = false;
	let opened = false;
	const finish = (status: number, message: string) => {
		if (closed) return;
		closed = true;
		handlers.onClose?.({ status, message });
	};
	const take = () => {
		const text = xhr.responseText ?? "";
		if (text.length <= read) return;
		const { messages, used } = parseSse(text.slice(read));
		read += used;
		if (text.length - read > MAX_PENDING) read = text.length;
		for (const m of messages) {
			if (closed) return;
			handlers.onMessage(m);
		}
	};
	xhr.open("GET", url, true);
	for (const [k, v] of Object.entries({ accept: "text/event-stream", "cache-control": "no-cache", ...headers })) xhr.setRequestHeader(k, v);
	xhr.onreadystatechange = () => {
		if (closed) return;
		if (xhr.readyState >= 2 && !opened) {
			if (xhr.status >= 200 && xhr.status < 300) {
				opened = true;
				handlers.onOpen?.();
			} else if (xhr.status) {
				// read the error when the body is there (DONE)
			}
		}
		if (xhr.readyState === 3 && opened) take();
		if (xhr.readyState === 4) {
			if (opened) take();
			let message = opened ? "the stream ended" : `HTTP ${xhr.status}`;
			if (!opened) {
				try {
					const body = JSON.parse(xhr.responseText) as { error?: string };
					if (body.error) message = body.error;
				} catch {
					// not JSON
				}
			}
			finish(opened ? 0 : xhr.status, message);
		}
	};
	xhr.onprogress = () => {
		if (closed || !opened) return;
		take();
		// A long stream: the text keeps growing in memory; end it and let the hook reopen.
		if ((xhr.responseText?.length ?? 0) > MAX_TEXT) {
			xhr.abort();
			finish(0, "reopening a long stream");
		}
	};
	xhr.onerror = () => finish(0, "cannot reach the backend");
	xhr.ontimeout = () => finish(0, "timed out");
	xhr.send();
	return {
		close() {
			if (closed) return;
			closed = true;
			xhr.abort();
		},
	};
}
