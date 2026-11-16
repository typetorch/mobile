/**
 * Shared pieces of the server screen's debug session (port of the web's pages/server/shared.tsx): the debug context
 * every tab reads, the fetch bar, the first-open fetch, a dot-and-word tone, and the log table. Answers stay in component
 * state (screen memory only): every table here turns off the DataTable's saved view and link sync too (a filter or a
 * search could hold a player's name).
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";

import type { RemoteLogEntry } from "@/api/tt/types";
import { Badge, Button, Dot, Txt } from "@/components/ui";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { fmtTime, plural } from "@/lib/format";
import { useTheme, type Tone } from "@/theme";

import type { RemoteState, Runner } from "./remote-debug";

export interface DebugContextValue {
	backendId: string;
	job: string;
	/** Queues one read-only op and resolves with its answer. */
	call: Runner;
	/** The server polls for commands: fetches can go. */
	ready: boolean;
	/** Why fetches are off (shown under the disabled buttons). */
	waitReason?: string;
}

export const DebugContext = createContext<DebugContextValue | null>(null);

export function useDebug(): DebugContextValue {
	const value = useContext(DebugContext);
	if (!value) throw new Error("useDebug outside the server screen");
	return value;
}

/** DataTable props for answers: no saved view, nothing in a link. */
export const MEMORY_ONLY = { persist: false, urlSync: false } as const;

/** Runs `run` once, the first time `go` is true (a tab's first open while the server is connected). */
export function useFirstFetch(go: boolean, run: () => unknown) {
	const done = useRef(false);
	useEffect(() => {
		if (go && !done.current) {
			done.current = true;
			void run();
		}
	}, [go, run]);
}

/** "Answered 12:03:04 UTC, 35 ms on the server". */
export function answeredText(state: Pick<RemoteState<unknown>, "at" | "ms">): string {
	if (state.at === undefined) return "";
	const parts = [`${fmtTime(state.at).slice(11)} UTC`];
	if (state.ms !== undefined) parts.push(`${state.ms} ms on the server`);
	return `Answered ${parts.join(", ")}`;
}

/** A coloured dot plus the word (colour never carries the meaning alone). */
export function ToneText({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
			<Dot tone={tone} />
			{typeof children === "string" ? <Txt variant="small">{children}</Txt> : children}
		</View>
	);
}

/**
 * A fetch button with the op's state under it: waiting, when the answer came and how long it took on the server, how
 * many secrets the kernel replaced, or why it failed (the previous answer stays on screen).
 */
export function RemoteBar({ state, onFetch, label = "Fetch", disabled, children }: { state: RemoteState<unknown>; onFetch: () => void; label?: string; disabled?: boolean; children?: ReactNode }) {
	const p = useTheme();
	const { ready, waitReason } = useDebug();
	const running = state.status === "running";
	const off = !ready || running || disabled;
	return (
		<View style={{ gap: 6 }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
				<Button title={label} small icon="refresh" loading={running} disabled={off} onPress={onFetch} />
				{children}
				{state.redacted ? <Badge label={`${plural(state.redacted, "secret")} redacted`} /> : null}
			</View>
			<Txt variant="small">{!ready ? (waitReason ?? "") : running ? "Waiting for the server (up to 15 s)" : state.status === "done" || state.at !== undefined ? answeredText(state) : ""}</Txt>
			{state.status === "error" && state.error ? (
				<Txt variant="small" color={p.critical} selectable>
					{state.error}
				</Txt>
			) : null}
		</View>
	);
}

const KIND_TONE: Record<string, Tone> = { error: "critical", warning: "warning", info: "brand", output: "muted" };

const LOG_COLUMNS: DataColumn<RemoteLogEntry>[] = [
	{ id: "i", header: "#", type: "number", accessor: (e) => e.i, mono: true, width: 56 },
	{ id: "t", header: "Time (UTC)", type: "date", accessor: (e) => e.t * 1000, cell: (e) => <Txt variant="mono">{fmtTime(e.t * 1000).slice(11)}</Txt>, format: (_v, e) => fmtTime(e.t * 1000), width: 92 },
	{
		id: "kind",
		header: "Kind",
		type: "enum",
		order: ["error", "warning", "info", "output"],
		options: ["error", "warning", "info", "output"],
		accessor: (e) => e.kind,
		cell: (e) => <ToneText tone={KIND_TONE[e.kind] ?? "muted"}>{e.kind}</ToneText>,
		width: 96,
	},
	{ id: "text", header: "Message", accessor: (e) => e.text, mono: true, width: 420 },
];

/** A log ring (the server's or one player's), newest first. */
export function LogTable({ id, label, entries, empty }: { id: string; label: string; entries: readonly RemoteLogEntry[]; empty?: ReactNode }) {
	return <DataTable id={id} label={label} columns={LOG_COLUMNS} data={entries} rowId={(e) => String(e.i)} defaultSort={[{ id: "i", desc: true }]} pageSize={100} density="compact" empty={empty} {...MEMORY_ONLY} />;
}

/** "Nothing here" text for a tab. */
export function Empty({ children }: { children: ReactNode }) {
	return <Txt variant="muted">{children}</Txt>;
}
