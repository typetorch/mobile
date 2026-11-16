/**
 * The server screen's debug tabs (ports of the web's pages/server/{StatusTab,LogsTab,PlayersTab,GameTab,StateTab,
 * DexTab,InfoTabs}.tsx): each tab is one or two read-only ops (`status`, `logs`, `player.logs`, `players`, `game.<n>`,
 * `state`, `dex.children`, `dex.props`, `modules`, `assets`, `builds`, `budget`, `errors`, `network`) and the remote
 * debug audit (GET /v1/fleet/debug/audit). Answers stay in this screen's memory; tables keep no saved view and no link.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import type {
	DebugAuditEntry,
	DexChildrenPage,
	DexPropRow,
	DexProps,
	DexRow,
	GameCommand,
	GameStream,
	LivePlayer,
	RemoteAssets,
	RemoteBudget,
	RemoteBuilds,
	RemoteErrors,
	RemoteLogEntry,
	RemoteLogs,
	RemoteModules,
	RemoteNetwork,
	RemotePlayer,
	RemotePlayerLogs,
	RemotePlayers,
	RemoteStatus,
	StateEntry,
	StateQuery,
	StateReply,
	StreamPoint,
} from "@/api/tt/types";
import { Badge, Button, Card, Chips, ErrorState, Field, Icon, KV, Segmented, Skeleton, Txt } from "@/components/ui";
import { latestValue } from "@/features/maps/live-map";
import type { StreamsState } from "@/features/maps/live-streams";
import { JsonBlock } from "@/features/typetorch/bits";
import { useTTQuery } from "@/features/typetorch/hooks";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { fmtAgo, fmtDuration, fmtInt, fmtNum, fmtPct, fmtTime, shortId } from "@/lib/format";
import { space, useTheme } from "@/theme";

import { useRemote, type Remote } from "./remote-debug";
import { Empty, LogTable, MEMORY_ONLY, RemoteBar, ToneText, useDebug, useFirstFetch } from "./shared";

function H({ children }: { children: string }) {
	return <Txt variant="label">{children}</Txt>;
}

// Status -------------------------------------------------------------------------------------------------------------

const yesNo = (v: boolean | undefined) => (v === undefined ? "–" : v ? "yes" : "no");

/** The kernel's status(), the facts the dev menu leads with; the whole answer under "Raw answer". */
export function StatusFacts({ data }: { data: RemoteStatus }) {
	const [raw, setRaw] = useState(false);
	const s = data.status ?? {};
	const g = s.generation;
	const rd = s.remoteDebug;
	const artifact = g?.artifact as { artifactId?: string; id?: string } | undefined;
	return (
		<Card style={{ gap: 0 }}>
			<KV label="Place version" value={s.placeVersion !== undefined ? String(s.placeVersion) : "–"} />
			<KV label="Server up" value={s.uptime !== undefined ? fmtDuration(s.uptime * 1000) : "–"} />
			<KV label="Players" value={`${fmtInt(s.players)} / ${fmtInt(s.maxPlayers)}`} />
			<KV label="Generation" value={g ? `${g.name ?? "?"} #${g.number ?? "?"}${g.uptime !== undefined ? `, up ${fmtDuration(g.uptime * 1000)}` : ""}` : "nothing runs"} />
			<KV label="Build" value={artifact?.artifactId ?? artifact?.id ?? "–"} mono />
			<KV label="Kernel" value={`${s.kernelVersion ?? "?"}${s.kernelBuild ? ` (${s.kernelBuild})` : ""}`} />
			<KV label="Memory" value={s.memoryMb !== undefined ? `${fmtNum(s.memoryMb, 0)} MB` : "–"} />
			<KV label="Lua heap" value={s.luaHeapKb !== undefined ? `${fmtNum(s.luaHeapKb / 1024, 1)} MB` : "–"} />
			<KV label="Health" value={s.health?.state ?? "–"} />
			<KV label="Branch" value={`${s.branch ?? "–"}${s.channel ? ` (${s.channel})` : ""}`} />
			<KV label="Rules" value={s.rules !== undefined && s.rules !== null ? String(s.rules) : "–"} />
			<KV label="Signed only" value={yesNo(s.signedOnly)} />
			<KV label="Pinned" value={yesNo(s.pinned)} />
			<KV label="Applied seq" value={s.appliedSeq !== undefined && s.appliedSeq !== null ? String(s.appliedSeq) : "–"} />
			<KV label="Remote debug" value={rd ? `${rd.state ?? "?"}: ${fmtInt(rd.commands)} commands, ${fmtInt(rd.refused)} refused${rd.redacted ? `, ${fmtInt(rd.redacted)} redacted` : ""}` : "–"} />
			<Button title={raw ? "Hide raw answer" : "Raw answer"} small variant="ghost" onPress={() => setRaw((r) => !r)} style={{ alignSelf: "flex-start" }} />
			{raw ? <JsonBlock value={data} /> : null}
		</Card>
	);
}

/** `status` is the screen's: it is fetched once as soon as the server polls (the header shows its place version). */
export function StatusTab({ status }: { status: Remote<RemoteStatus> }) {
	const run = status.run;
	return (
		<View style={{ gap: space.sm }}>
			<H>Kernel status</H>
			<RemoteBar state={status} onFetch={() => void run()} />
			{status.data ? <StatusFacts data={status.data} /> : null}
		</View>
	);
}

// Logs ---------------------------------------------------------------------------------------------------------------

/** Lines kept per view (the kernel's server ring holds about as many). */
export const LOGS_KEPT = 2000;
/** The first fetch: the newest this many lines. */
export const LOGS_FIRST = 200;

/** Adds `incoming` to `current` by index (no duplicates), oldest first, the newest `keep` only. */
export function mergeLogs(current: readonly RemoteLogEntry[], incoming: readonly RemoteLogEntry[], keep = LOGS_KEPT): RemoteLogEntry[] {
	const byIndex = new Map<number, RemoteLogEntry>();
	for (const entry of current) byIndex.set(entry.i, entry);
	for (const entry of incoming) if (entry && typeof entry.i === "number") byIndex.set(entry.i, entry);
	return [...byIndex.values()].sort((a, b) => a.i - b.i).slice(-keep);
}

function ServerLogs({ active }: { active: boolean }) {
	const { call, ready } = useDebug();
	const logs = useRemote<RemoteLogs>(call, "logs");
	const run = logs.run;
	const [entries, setEntries] = useState<RemoteLogEntry[]>([]);
	const [last, setLast] = useState<number | undefined>();
	const fetchLatest = useCallback(async () => {
		const answer = await run({ limit: LOGS_FIRST });
		if (!answer) return;
		setEntries(mergeLogs([], answer.entries ?? []));
		setLast(answer.last);
	}, [run]);
	const fetchNewer = useCallback(async () => {
		if (last === undefined) return fetchLatest();
		const answer = await run({ since: last, limit: 500 });
		if (!answer) return;
		setEntries((current) => mergeLogs(current, answer.entries ?? []));
		setLast(answer.last);
	}, [run, last, fetchLatest]);
	useFirstFetch(active && ready, fetchLatest);
	return (
		<View style={{ gap: space.sm }}>
			<RemoteBar state={logs} onFetch={() => void fetchLatest()} label={`Fetch latest ${LOGS_FIRST}`}>
				<Button title="Fetch newer" small onPress={() => void fetchNewer()} disabled={!ready || logs.status === "running" || last === undefined} />
				{entries.length ? <Txt variant="small">{fmtInt(entries.length)} lines</Txt> : null}
			</RemoteBar>
			{logs.data || entries.length ? <LogTable id="server-logs" label="Server log" entries={entries} empty={<Empty>The server log is empty.</Empty>} /> : null}
		</View>
	);
}

export interface PlayerLogRequest {
	userId: number;
	/** A new request for the same player fetches again. */
	n: number;
}

function PlayerLogs({ players, request }: { players: Remote<RemotePlayers>; request?: PlayerLogRequest | undefined }) {
	const { call, ready } = useDebug();
	const logs = useRemote<RemotePlayerLogs>(call, "player.logs");
	const run = logs.run;
	const [userId, setUserId] = useState<number | undefined>();
	const [entries, setEntries] = useState<RemoteLogEntry[]>([]);
	const [last, setLast] = useState<number | undefined>();
	// The player the lines on screen belong to: a slow answer for the previous pick is dropped.
	const shown = useRef<number | undefined>(undefined);
	const fetchFor = useCallback(
		async (id: number, since?: number) => {
			const answer = await run({ userId: id, ...(since !== undefined ? { since } : {}) });
			if (!answer || shown.current !== id || answer.userId !== id) return;
			const incoming = answer.entries ?? [];
			setEntries((current) => mergeLogs(since === undefined ? [] : current, incoming));
			setLast((previous) => (incoming.length ? (incoming[incoming.length - 1] as RemoteLogEntry).i : (previous ?? since)));
		},
		[run],
	);
	const pick = useCallback(
		(id: number) => {
			shown.current = id;
			setUserId(id);
			setEntries([]);
			setLast(undefined);
			void fetchFor(id);
		},
		[fetchFor],
	);
	useEffect(() => {
		if (request) pick(request.userId);
	}, [request, pick]);
	const list = players.data?.players ?? [];
	const current = list.find((x) => x.userId === userId);
	const who = current ? `${current.displayName ?? current.name} (@${current.name})` : userId !== undefined ? `UserId ${userId}` : "";
	return (
		<View style={{ gap: space.sm }}>
			<Button title={players.data ? "Refresh players" : "Load players"} small onPress={() => void players.run()} disabled={!ready || players.status === "running"} style={{ alignSelf: "flex-start" }} />
			{players.data ? (
				list.length ? (
					<Chips options={list.map((x) => ({ value: x.userId, label: `${x.displayName ?? x.name} (@${x.name})` }))} value={userId ?? -1} onChange={(v) => (ready ? pick(v) : undefined)} />
				) : (
					<Empty>Nobody is in this server.</Empty>
				)
			) : null}
			{userId !== undefined ? (
				<>
					<RemoteBar state={logs} onFetch={() => void fetchFor(userId)} label="Fetch client logs">
						<Button title="Fetch newer" small onPress={() => void fetchFor(userId, last)} disabled={!ready || logs.status === "running" || last === undefined} />
					</RemoteBar>
					<Txt variant="small">{who}</Txt>
					{logs.data || entries.length ? <LogTable id="server-player-logs" label={`Client log of ${who}`} entries={entries} empty={<Empty>No log lines from this client yet.</Empty>} /> : null}
				</>
			) : (
				<Empty>Pick a player to read their client log (asked from their client, at most 200 lines).</Empty>
			)}
		</View>
	);
}

export function LogsTab({ active, players, request }: { active: boolean; players: Remote<RemotePlayers>; request?: PlayerLogRequest | undefined }) {
	const [view, setView] = useState<"server" | "player">(request ? "player" : "server");
	const [handled, setHandled] = useState(request?.n);
	if (request && request.n !== handled) {
		setHandled(request.n);
		setView("player");
	}
	return (
		<View style={{ gap: space.sm }}>
			<Segmented
				options={[
					{ value: "server", label: "Server" },
					{ value: "player", label: "Player" },
				]}
				value={view}
				onChange={setView}
			/>
			<View style={{ display: view === "server" ? "flex" : "none" }}>
				<ServerLogs active={active && view === "server"} />
			</View>
			<View style={{ display: view === "player" ? "flex" : "none" }}>
				<PlayerLogs players={players} request={request} />
			</View>
		</View>
	);
}

// Players ------------------------------------------------------------------------------------------------------------

/** How a player's client start went: ok, failed (with why), or no report yet. */
export function clientState(x: RemotePlayer): "ok" | "failed" | "waiting" {
	if (!x.client || x.client.ok === undefined) return "waiting";
	return x.client.ok ? "ok" : "failed";
}

const CLIENT_TONE = { ok: "good", failed: "critical", waiting: "muted" } as const;

function remotePlayerColumns(onLogs: (userId: number) => void, ready: boolean): DataColumn<RemotePlayer>[] {
	return [
		{
			id: "name",
			header: "Player",
			accessor: (x) => x.displayName ?? x.name,
			searchText: (x) => `${x.name} ${x.displayName ?? ""}`,
			cell: (x) => (
				<View>
					<Txt style={{ fontWeight: "600" }} numberOfLines={1}>
						{x.displayName ?? x.name}
					</Txt>
					{x.displayName && x.displayName !== x.name ? <Txt variant="small">@{x.name}</Txt> : null}
				</View>
			),
			width: 150,
		},
		{
			id: "actions",
			header: "Logs",
			accessor: () => null,
			sortable: false,
			filter: false,
			searchable: false,
			hideable: false,
			cell: (x) => <Button title="Logs" small variant="ghost" icon="document-text-outline" disabled={!ready} onPress={() => onLogs(x.userId)} />,
			width: 86,
		},
		{ id: "userId", header: "UserId", type: "text", accessor: (x) => String(x.userId), mono: true },
		{ id: "dev", header: "Access", type: "enum", accessor: (x) => (x.dev ? (x.role ?? "dev") : "player"), title: "Dev or player by the kernel's rule (the reason is in the row's JSON)" },
		{ id: "ping", header: "Ping", hint: "ms", type: "number", firstSort: "desc", accessor: (x) => x.pingMs ?? null, cell: (x) => <Txt>{fmtInt(x.pingMs)}</Txt> },
		{ id: "accountAge", header: "Account age", hint: "days", type: "number", accessor: (x) => x.accountAge ?? null, cell: (x) => <Txt>{fmtInt(x.accountAge)}</Txt> },
		{
			id: "client",
			header: "Client start",
			type: "enum",
			order: ["failed", "waiting", "ok"],
			options: ["failed", "waiting", "ok"],
			accessor: (x) => clientState(x),
			cell: (x) => (
				<View>
					<ToneText tone={CLIENT_TONE[clientState(x)]}>{clientState(x)}</ToneText>
					{x.client?.error ? (
						<Txt variant="small" numberOfLines={2}>
							{x.client.error}
						</Txt>
					) : null}
				</View>
			),
			width: 140,
		},
	];
}

export function PlayersTab({ active, players, onLogs }: { active: boolean; players: Remote<RemotePlayers>; onLogs: (userId: number) => void }) {
	const { ready } = useDebug();
	const run = players.run;
	useFirstFetch(active && ready, run);
	const columns = useMemo(() => remotePlayerColumns(onLogs, ready), [onLogs, ready]);
	const list = players.data?.players ?? [];
	return (
		<View style={{ gap: space.sm }}>
			<RemoteBar state={players} onFetch={() => void run()}>
				{players.data ? (
					<Txt variant="small">
						{fmtInt(list.length)} / {fmtInt(players.data.max)} players
					</Txt>
				) : null}
			</RemoteBar>
			{players.data ? (
				<DataTable id="server-players" label="Players in this server" columns={columns} data={list} rowId={(x) => String(x.userId)} defaultSort={[{ id: "name", desc: false }]} empty={<Empty>Nobody is in this server.</Empty>} {...MEMORY_ONLY} />
			) : null}
		</View>
	);
}

// Game ---------------------------------------------------------------------------------------------------------------

export const GAME_DEFINED_TEXT = "Game-defined: the game promises these are read-only; the kernel can't check it.";
export const NO_DECLARATIONS_TEXT = "This server's game declares no commands or streams (framework 0.7.1+ with kernel 0.5.7: remoteDebug.command / remoteDebug.stream).";

const cellText = (v: unknown) => (v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** A command's answer: a table, key-value pairs, or JSON. */
export function GameAnswer({ value }: { value: unknown }) {
	const v = value as { kind?: unknown; columns?: unknown; rows?: unknown; items?: unknown } | null;
	if (v && v.kind === "table" && Array.isArray(v.columns) && Array.isArray(v.rows)) {
		const columns: DataColumn<unknown[]>[] = v.columns.map((c, i) => ({
			id: `c${i}`,
			header: cellText(c),
			accessor: (row: unknown[]) => row[i] ?? null,
			format: (x: unknown) => cellText(x),
			align: typeof (v.rows as unknown[][])[0]?.[i] === "number" ? "right" : "left",
		}));
		const rows = (v.rows as unknown[]).map((row) => (Array.isArray(row) ? row : [row]));
		return <DataTable id="server-game-answer" label="Answer" columns={columns} data={rows} density="compact" {...MEMORY_ONLY} />;
	}
	if (v && v.kind === "kv" && typeof v.items === "object" && v.items !== null && !Array.isArray(v.items)) {
		return (
			<Card style={{ gap: 0 }}>
				{Object.entries(v.items as Record<string, unknown>).map(([k, item]) => (
					<KV key={k} label={k} value={cellText(item)} mono />
				))}
			</Card>
		);
	}
	return <JsonBlock value={value} />;
}

/** One declared command: its button, optional JSON args, its last answer. */
function CommandRow({ command }: { command: GameCommand }) {
	const p = useTheme();
	const { call } = useDebug();
	const remote = useRemote<unknown>(call, `game.${command.n}`);
	const [args, setArgs] = useState("");
	const [argsError, setArgsError] = useState<string | null>(null);
	const run = () => {
		let parsed: Record<string, unknown> | undefined;
		if (args.trim()) {
			try {
				const value: unknown = JSON.parse(args);
				if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
				parsed = value as Record<string, unknown>;
			} catch {
				setArgsError('Args must be a JSON object, e.g. {"team": "red"}.');
				return;
			}
		}
		setArgsError(null);
		void remote.run(parsed);
	};
	return (
		<Card style={{ gap: space.sm }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
				<Txt style={{ fontWeight: "600" }}>{command.l ?? command.n}</Txt>
				<Txt variant="mono" color={p.mutedForeground}>
					game.{command.n}
				</Txt>
				<Badge label="game-defined" />
			</View>
			{command.d ? <Txt variant="small">{command.d}</Txt> : null}
			<Field value={args} onChangeText={setArgs} placeholder="args (JSON, optional)" style={{ fontFamily: "monospace", fontSize: 12 }} />
			<RemoteBar state={remote} onFetch={run} label="Run" />
			{argsError ? (
				<Txt variant="small" color={p.critical}>
					{argsError}
				</Txt>
			) : null}
			{remote.data !== undefined ? <GameAnswer value={remote.data} /> : null}
		</Card>
	);
}

const POSITION_COLUMNS: DataColumn<LivePlayer>[] = [
	{ id: "n", header: "Player", accessor: (x) => x.n },
	{ id: "st", header: "State", type: "enum", accessor: (x) => x.st },
	...(["x", "y", "z", "hp"] as const).map(
		(k): DataColumn<LivePlayer> => ({ id: k, header: k === "hp" ? "HP" : k, type: "number", accessor: (x) => x[k] ?? null, format: (v) => (typeof v === "number" ? v.toFixed(1) : "–"), width: 70 }),
	),
];

function StreamPanel({ stream, value, at }: { stream: GameStream; value: unknown; at?: number | undefined }) {
	const p = useTheme();
	const points = stream.k === "points" ? (value as { points?: StreamPoint[] } | undefined)?.points : undefined;
	return (
		<View style={{ gap: 4 }}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
				<Txt style={{ fontWeight: "600" }}>{stream.l ?? stream.n}</Txt>
				<Txt variant="mono" color={p.mutedForeground}>
					game.{stream.n}
				</Txt>
			</View>
			<Txt variant="small">
				{stream.hz} Hz{stream.k === "points" ? ", points (drawn on the Live map)" : ""}
				{at !== undefined ? ` · ${fmtTime(at).slice(11)} UTC` : ""}
			</Txt>
			{value === undefined ? (
				<Empty>No sample yet.</Empty>
			) : points ? (
				<Txt>
					{points.length} point{points.length === 1 ? "" : "s"}
					{points.some((x) => x.label)
						? `: ${points
								.filter((x) => x.label)
								.slice(0, 12)
								.map((x) => x.label)
								.join(", ")}`
						: ""}
				</Txt>
			) : (
				<JsonBlock value={value} max={260} />
			)}
		</View>
	);
}

export function GameTab({ streams }: { streams: StreamsState }) {
	const p = useTheme();
	const declared = streams.declared;
	const positions = latestValue(streams.frames, "positions");
	const players = (positions?.value as { players?: LivePlayer[] } | undefined)?.players ?? [];
	if (!streams.loaded) return <Empty>Reading what this server's game declared...</Empty>;
	return (
		<View style={{ gap: space.md }}>
			{streams.error ? (
				<Txt variant="small" color={p.critical}>
					{streams.error}
				</Txt>
			) : null}
			<H>Game commands</H>
			<Txt variant="small">{GAME_DEFINED_TEXT}</Txt>
			{declared?.commands.length ? declared.commands.map((c) => <CommandRow key={c.n} command={c} />) : <Empty>{NO_DECLARATIONS_TEXT}</Empty>}
			<H>Streams</H>
			<Txt variant="small">The latest samples while this screen is open (the kernel posts them every second; kept 2 minutes, in memory only).</Txt>
			<View style={{ gap: 4 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Txt style={{ fontWeight: "600" }}>Positions</Txt>
					<Txt variant="mono" color={p.mutedForeground}>
						positions
					</Txt>
				</View>
				<Txt variant="small">2 Hz, built in{positions ? ` · ${fmtTime(positions.t).slice(11)} UTC` : ""}</Txt>
				{positions ? (
					players.length ? (
						<DataTable id="server-game-positions" label="Positions" columns={POSITION_COLUMNS} data={players} rowId={(x) => String(x.u)} density="compact" bare {...MEMORY_ONLY} />
					) : (
						<Empty>Nobody in the server.</Empty>
					)
				) : (
					<Empty>No sample yet (kernel 0.5.7+ sends them while this screen is open).</Empty>
				)}
			</View>
			{(declared?.streams ?? []).map((s) => {
				const latest = latestValue(streams.frames, `game.${s.n}`);
				return <StreamPanel key={s.n} stream={s} value={latest?.value} at={latest?.t} />;
			})}
		</View>
	);
}

// State --------------------------------------------------------------------------------------------------------------

/** Where the browser is: no root = the list of roots; `segs` = the steps below the root (segment + the key shown). */
export interface StatePlace {
	root: string;
	label: string;
	segs: { seg: string; key: string }[];
}

export function stateQuery(place: StatePlace | undefined, page: number, filter: string): StateQuery {
	return { root: place?.root ?? "", path: place?.segs.map((s) => s.seg) ?? [], page, ...(filter ? { filter } : {}) };
}

export function openEntry(place: StatePlace | undefined, entry: StateEntry): StatePlace {
	if (!place) return { root: entry.seg, label: entry.key, segs: [] };
	return { ...place, segs: [...place.segs, { seg: entry.seg, key: entry.key }] };
}

const STATE_COLUMNS: DataColumn<StateEntry>[] = [
	{
		id: "key",
		header: "Key",
		accessor: (e) => e.key,
		cell: (e) => (
			<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
				{e.expandable && !e.cycle ? <Icon name="chevron-forward" size={12} /> : <View style={{ width: 12 }} />}
				<Txt variant="mono" style={{ flexShrink: 1 }}>
					{e.key}
				</Txt>
			</View>
		),
		width: 170,
	},
	{ id: "type", header: "Type", type: "enum", accessor: (e) => e.type, width: 90 },
	{ id: "preview", header: "Value", accessor: (e) => e.preview, cell: (e) => <Txt variant="mono">{e.cycle ? `cycle: ${e.preview}` : e.preview}</Txt>, width: 260 },
];

function Breadcrumb({ place, onGo }: { place?: StatePlace | undefined; onGo: (place: StatePlace | undefined) => void }) {
	const p = useTheme();
	const steps: { label: string; to: StatePlace | undefined }[] = [{ label: "Roots", to: undefined }];
	if (place) {
		steps.push({ label: place.label, to: { ...place, segs: [] } });
		place.segs.forEach((s, i) => steps.push({ label: s.key, to: { ...place, segs: place.segs.slice(0, i + 1) } }));
	}
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
			{steps.map((step, i) => (
				<View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
					{i > 0 ? <Icon name="chevron-forward" size={12} color={p.mutedForeground} /> : null}
					{i === steps.length - 1 ? (
						<Txt variant="mono" style={{ fontWeight: "600" }}>
							{step.label}
						</Txt>
					) : (
						<Pressable onPress={() => onGo(step.to)} hitSlop={6}>
							<Txt variant="mono" color={p.brand}>
								{step.label}
							</Txt>
						</Pressable>
					)}
				</View>
			))}
		</View>
	);
}

export function StateTab({ active }: { active: boolean }) {
	const { call, ready } = useDebug();
	const state = useRemote<StateReply[]>(call, "state");
	const run = state.run;
	const [place, setPlace] = useState<StatePlace | undefined>();
	const [page, setPage] = useState(0);
	const [filter, setFilter] = useState("");
	const [filterText, setFilterText] = useState("");
	const [reply, setReply] = useState<StateReply | undefined>();
	const load = useCallback(
		async (to: StatePlace | undefined, toPage: number, toFilter: string) => {
			const answer = await run({ queries: [stateQuery(to, toPage, toFilter)] });
			const first = Array.isArray(answer) ? answer[0] : undefined;
			if (!first) return;
			setPlace(to);
			setPage(first.page ?? toPage);
			setFilter(toFilter);
			setFilterText(toFilter);
			setReply(first);
		},
		[run],
	);
	const loadRoots = useCallback(() => load(undefined, 0, ""), [load]);
	useFirstFetch(active && ready, loadRoots);
	const busy = !ready || state.status === "running";
	const go = (to: StatePlace | undefined) => void load(to, 0, "");
	return (
		<View style={{ gap: space.sm }}>
			<RemoteBar state={state} onFetch={() => void load(place, page, filter)} label="Refresh">
				<Button title="Roots" small onPress={() => go(undefined)} disabled={busy} />
			</RemoteBar>
			{reply ? (
				<>
					<Breadcrumb place={place} onGo={go} />
					<Txt variant="small">
						{place ? `${reply.type} ${reply.preview} · ` : ""}
						{fmtInt(reply.size)}
						{reply.capped ? "+" : ""} entries{filter ? `, ${fmtInt(reply.matched)} match` : ""}
						{reply.pages > 1 ? ` · page ${reply.page + 1} of ${fmtInt(reply.pages)}` : ""}
						{reply.truncated ? " · only the first 20,000 keys are listed (in table order)" : ""}
					</Txt>
					<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<View style={{ flex: 1 }}>
							<Field value={filterText} onChangeText={setFilterText} placeholder="filter keys" maxLength={64} returnKeyType="search" onSubmitEditing={() => void load(place, 0, filterText.trim())} />
						</View>
						<Button title="Filter" small disabled={busy} onPress={() => void load(place, 0, filterText.trim())} />
						{filter ? <Button title="Clear" small variant="ghost" disabled={busy} onPress={() => void load(place, 0, "")} /> : null}
					</View>
					{reply.missing ? (
						<Empty>This path doesn't exist any more (the module reloaded, or the key went). Go back up.</Empty>
					) : reply.tooDeep ? (
						<Empty>Too deep: the server reads at most 24 steps below a root.</Empty>
					) : (
						<DataTable
							id="server-state"
							label={place ? `State of ${place.label}` : "State roots"}
							columns={STATE_COLUMNS}
							data={reply.entries ?? []}
							rowId={(e) => e.seg}
							pageSize={100}
							search={false}
							density="compact"
							onRowPress={(e) => {
								if (e.expandable && !e.cycle && !busy) void load(openEntry(place, e), 0, "");
							}}
							empty={<Empty>{filter ? "No key matches the filter." : place ? "This table is empty." : "No roots: nothing runs, or this build has no state to read."}</Empty>}
							{...MEMORY_ONLY}
						/>
					)}
					{reply.pages > 1 ? (
						<View style={{ flexDirection: "row", gap: 8 }}>
							<Button title="Prev" small onPress={() => void load(place, page - 1, filter)} disabled={busy || page <= 0} />
							<Button title="Next" small onPress={() => void load(place, page + 1, filter)} disabled={busy || !reply.hasMore} />
						</View>
					) : null}
				</>
			) : null}
		</View>
	);
}

// Dex ----------------------------------------------------------------------------------------------------------------

/** Rows a node loads per request (the framework's REMOTE_DEX_ROWS). */
export const DEX_PAGE = 200;

export interface DexNode {
	row: DexRow;
	children?: number[];
	total?: number;
	gone?: boolean;
}

export const GAME_ROW: DexRow = { id: 0, name: "game", className: "DataModel", childCount: -1, parent: -1 };

/** Applies a dex.children answer to the node map (a page at offset 0 replaces a node's children; later pages append). */
export function applyChildren(nodes: ReadonlyMap<number, DexNode>, pages: readonly DexChildrenPage[]): Map<number, DexNode> {
	const next = new Map(nodes);
	for (const page of pages) {
		const node = next.get(page.id) ?? { row: { ...GAME_ROW, id: page.id, name: `#${page.id}` } };
		if (page.gone) {
			next.set(page.id, { ...node, gone: true, children: [], total: 0 });
			continue;
		}
		const ids = (page.rows ?? []).map((row) => {
			const existing = next.get(row.id);
			next.set(row.id, { ...existing, row, gone: false });
			return row.id;
		});
		const kept = page.offset > 0 ? (node.children ?? []).slice(0, page.offset) : [];
		next.set(page.id, { ...node, gone: false, children: [...kept, ...ids.filter((id) => !kept.includes(id))], total: page.total });
	}
	return next;
}

interface TreeLine {
	kind: "node" | "more";
	id: number;
	depth: number;
	left?: number;
}

export function treeLines(nodes: ReadonlyMap<number, DexNode>, open: ReadonlySet<number>, root = 0): TreeLine[] {
	const out: TreeLine[] = [];
	const walk = (id: number, depth: number, seen: Set<number>) => {
		if (seen.has(id)) return;
		seen.add(id);
		out.push({ kind: "node", id, depth });
		const node = nodes.get(id);
		if (!open.has(id) || !node?.children) return;
		for (const child of node.children) walk(child, depth + 1, seen);
		const left = (node.total ?? 0) - node.children.length;
		if (left > 0) out.push({ kind: "more", id, depth: depth + 1, left });
	};
	walk(root, 0, new Set());
	return out;
}

function propColumns(onRef: (id: number) => void): DataColumn<DexPropRow>[] {
	return [
		{ id: "name", header: "Name", accessor: (x) => x.name, cell: (x) => <Txt variant="mono" style={x.deprecated ? { textDecorationLine: "line-through" } : undefined}>{x.name}</Txt>, width: 150 },
		{ id: "category", header: "Category", type: "enum", accessor: (x) => x.category, width: 100 },
		{
			id: "value",
			header: "Value",
			accessor: (x) => x.text,
			cell: (x) =>
				x.ref !== undefined ? (
					<Pressable onPress={() => onRef(x.ref as number)} hitSlop={4}>
						<Txt variant="mono" style={{ textDecorationLine: "underline" }}>
							{x.text}
						</Txt>
					</Pressable>
				) : (
					<Txt variant="mono">{x.text}</Txt>
				),
			width: 220,
		},
		{ id: "kind", header: "Kind", type: "enum", accessor: (x) => x.kind, defaultHidden: true },
	];
}

export function DexTab({ active }: { active: boolean }) {
	const p = useTheme();
	const { call, ready } = useDebug();
	const children = useRemote<DexChildrenPage[]>(call, "dex.children");
	const props = useRemote<DexProps>(call, "dex.props");
	const loadChildrenOp = children.run;
	const loadPropsOp = props.run;
	const [nodes, setNodes] = useState<Map<number, DexNode>>(() => new Map([[0, { row: GAME_ROW }]]));
	const [open, setOpen] = useState<Set<number>>(() => new Set());
	const [selected, setSelected] = useState<number | undefined>();
	const [loading, setLoading] = useState<number | undefined>();
	const loadChildren = useCallback(
		async (id: number, offset = 0) => {
			setLoading(id);
			try {
				const answer = await loadChildrenOp({ nodes: [{ id, offset, limit: DEX_PAGE }] });
				if (!Array.isArray(answer)) return;
				setNodes((current) => applyChildren(current, answer));
				setOpen((current) => new Set(current).add(id));
			} finally {
				setLoading(undefined);
			}
		},
		[loadChildrenOp],
	);
	const expandRoot = useCallback(() => loadChildren(0), [loadChildren]);
	useFirstFetch(active && ready, expandRoot);
	const select = useCallback(
		(id: number) => {
			setSelected(id);
			void loadPropsOp({ id });
		},
		[loadPropsOp],
	);
	const toggle = (id: number) => {
		if (open.has(id)) {
			setOpen((current) => {
				const next = new Set(current);
				next.delete(id);
				return next;
			});
		} else if (nodes.get(id)?.children) setOpen((current) => new Set(current).add(id));
		else void loadChildren(id);
	};
	const lines = useMemo(() => treeLines(nodes, open), [nodes, open]);
	const columns = useMemo(() => propColumns(select), [select]);
	const busy = !ready || children.status === "running";
	const shown = props.data;
	return (
		<View style={{ gap: space.sm }}>
			<RemoteBar state={children} onFetch={() => void loadChildren(selected !== undefined && open.has(selected) ? selected : 0)} label="Refresh" />
			<Txt variant="small">Read only. Refresh reloads the open node you selected (or game). Tap ▸ to open a node, its name for its properties.</Txt>
			<Card style={{ padding: 4, gap: 0 }}>
				{lines.slice(0, 1500).map((line) => {
					if (line.kind === "more")
						return (
							<Pressable key={`more-${line.id}`} disabled={busy} onPress={() => void loadChildren(line.id, nodes.get(line.id)?.children?.length ?? 0)} style={{ paddingLeft: line.depth * 14 + 26, paddingVertical: 6 }}>
								<Txt variant="small" color={p.brand}>
									Load more ({fmtInt(line.left)} left)
								</Txt>
							</Pressable>
						);
					const node = nodes.get(line.id);
					if (!node) return null;
					const { row } = node;
					const hasChildren = row.childCount !== 0 && !node.gone;
					const isOpen = open.has(line.id);
					return (
						<View key={line.id} style={{ flexDirection: "row", alignItems: "center", paddingLeft: line.depth * 14, backgroundColor: selected === line.id ? p.muted : undefined, borderRadius: 6 }}>
							{hasChildren ? (
								<Pressable onPress={() => toggle(line.id)} disabled={busy && !isOpen} hitSlop={6} style={{ width: 26, alignItems: "center", paddingVertical: 6 }}>
									<Icon name={loading === line.id ? "hourglass-outline" : isOpen ? "chevron-down" : "chevron-forward"} size={14} />
								</Pressable>
							) : (
								<View style={{ width: 26 }} />
							)}
							<Pressable onPress={() => select(line.id)} style={{ flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6, paddingVertical: 6 }}>
								<Txt numberOfLines={1} style={[{ flexShrink: 1 }, node.gone ? { textDecorationLine: "line-through", color: p.mutedForeground } : null]}>
									{row.name}
								</Txt>
								<Txt variant="small">{row.className}</Txt>
								{row.childCount > 0 ? <Txt variant="small">{fmtInt(row.childCount)}</Txt> : null}
							</Pressable>
						</View>
					);
				})}
				{lines.length > 1500 ? <Txt variant="small">Only the first 1,500 lines are drawn: close some nodes.</Txt> : null}
			</Card>
			{selected === undefined ? (
				<Empty>Select an instance to read its properties.</Empty>
			) : (
				<>
					<RemoteBar state={props} onFetch={() => select(selected)} label="Reload properties" />
					{shown ? (
						<View style={{ gap: space.sm }}>
							<Txt style={{ fontWeight: "600" }}>
								{shown.name} <Txt variant="small">{shown.className}</Txt>
							</Txt>
							<Txt variant="mono" selectable color={p.mutedForeground}>
								{shown.path}
							</Txt>
							<DataTable id="server-dex-props" label={`Properties of ${shown.name}`} columns={columns} data={shown.props ?? []} rowId={(x) => x.name} pageSize={100} density="compact" {...MEMORY_ONLY} />
							{shown.attrs?.length ? <DataTable id="server-dex-attrs" label={`Attributes of ${shown.name}`} columns={columns} data={shown.attrs} rowId={(x) => x.name} density="compact" {...MEMORY_ONLY} /> : null}
							{shown.tags?.length ? (
								<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
									<Txt variant="small">Tags</Txt>
									{shown.tags.map((t) => (
										<Badge key={t} label={t} />
									))}
								</View>
							) : null}
						</View>
					) : props.status !== "running" ? (
						<Empty>No properties read yet.</Empty>
					) : null}
				</>
			)}
		</View>
	);
}

// Modules, Builds, Budget, Errors, Network ---------------------------------------------------------------------------

/** Kernel times are unix seconds; a few older fields are ms. Either way: epoch ms, or null. */
export function epochMs(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
	return value < 1e12 ? value * 1000 : value;
}

const list = (values: readonly string[] | undefined) => (values?.length ? values.join(", ") : "–");

type ModuleRow = NonNullable<NonNullable<RemoteModules["state"]>["modules"]>[number];
type PersistRow = NonNullable<NonNullable<RemoteModules["state"]>["persist"]>[number];
type AssetRow = NonNullable<RemoteAssets["entries"]>[number];

const MODULE_COLUMNS: DataColumn<ModuleRow>[] = [
	{ id: "name", header: "Module", accessor: (m) => m.name, mono: true },
	{ id: "loadOrder", header: "Load order", type: "number", firstSort: "asc", accessor: (m) => m.loadOrder ?? null },
	{ id: "initMs", header: "Init", hint: "ms", type: "number", accessor: (m) => m.initMs ?? null, format: (v) => fmtInt(v as number | null) },
	{ id: "dependencies", header: "Depends on", accessor: (m) => list(m.dependencies), width: 220 },
	{ id: "hooks", header: "Hooks", accessor: (m) => list(m.hooks), width: 180 },
];

const PERSIST_COLUMNS: DataColumn<PersistRow>[] = [
	{ id: "key", header: "Store", accessor: (x) => x.key, mono: true },
	{ id: "kind", header: "Kind", type: "enum", accessor: (x) => x.kind },
	{ id: "entries", header: "Entries", type: "number", accessor: (x) => x.entries },
	{ id: "preview", header: "Preview", accessor: (x) => x.preview, mono: true, width: 260 },
];

const assetState = (a: AssetRow) => (a.error ? (a.live ? "old copy" : "failed") : "live");

const ASSET_COLUMNS: DataColumn<AssetRow>[] = [
	{ id: "key", header: "Asset", accessor: (a) => a.key, mono: true },
	{
		id: "live",
		header: "State",
		type: "enum",
		order: ["failed", "old copy", "live"],
		accessor: (a) => assetState(a),
		cell: (a) => <ToneText tone={a.error ? (a.live ? "warning" : "critical") : "good"}>{assetState(a)}</ToneText>,
	},
	{ id: "version", header: "Version", type: "number", accessor: (a) => a.n ?? null, format: (v) => (typeof v === "number" ? `v${v}` : "–") },
	{ id: "source", header: "Source", type: "enum", accessor: (a) => a.source ?? null },
	{ id: "ms", header: "Load", hint: "ms", type: "number", accessor: (a) => a.ms ?? null, format: (v) => fmtInt(v as number | null) },
	{ id: "id", header: "Asset id", type: "text", accessor: (a) => String(a.id), mono: true, defaultHidden: true },
	{ id: "error", header: "Error", accessor: (a) => a.error ?? null, width: 220 },
];

export function ModulesTab({ active }: { active: boolean }) {
	const p = useTheme();
	const { call, ready } = useDebug();
	const modules = useRemote<RemoteModules>(call, "modules");
	const assets = useRemote<RemoteAssets>(call, "assets");
	const runModules = modules.run;
	useFirstFetch(active && ready, runModules);
	const rows = modules.data?.state?.modules ?? modules.data?.modules ?? [];
	const persist = modules.data?.state?.persist ?? [];
	const a = assets.data;
	return (
		<View style={{ gap: space.md }}>
			<H>Running modules</H>
			<RemoteBar state={modules} onFetch={() => void runModules()} />
			{modules.data ? (
				<>
					<DataTable id="server-modules" label="Running modules" columns={MODULE_COLUMNS} data={rows} rowId={(m) => m.name} defaultSort={[{ id: "loadOrder", desc: false }]} empty={<Empty>No modules run.</Empty>} {...MEMORY_ONLY} />
					{persist.length ? <DataTable id="server-persist" label="Persist store" columns={PERSIST_COLUMNS} data={persist} rowId={(x) => x.key} {...MEMORY_ONLY} /> : null}
				</>
			) : null}
			<H>Assets (the last hot-asset sync)</H>
			<RemoteBar state={assets} onFetch={() => void assets.run()} />
			{a ? (
				<>
					<Card style={{ gap: 0 }}>
						<KV label="Manifest" value={`${a.manifest ?? "?"}${a.from ? ` (${a.from})` : ""}`} />
						<KV label="Sync" value={a.running ? "running" : a.timedOut ? "timed out (late loads still swap in)" : "done"} />
						<KV label="Took" value={a.ms !== undefined ? `${fmtInt(a.ms)} ms` : "–"} />
						<KV label="Unmanaged" value={fmtInt(a.unmanaged?.length ?? 0)} />
					</Card>
					{a.errors?.length ? (
						<Txt variant="small" color={p.critical}>
							{a.errors.join("; ")}
						</Txt>
					) : null}
					<DataTable id="server-assets" label="Assets" columns={ASSET_COLUMNS} data={a.entries ?? []} rowId={(e) => e.key} empty={<Empty>This build has no managed assets.</Empty>} {...MEMORY_ONLY} />
				</>
			) : null}
		</View>
	);
}

type BranchRow = NonNullable<RemoteBuilds["branches"]>[number];
type ArtifactRow = NonNullable<RemoteBuilds["artifacts"]>[number];
type ReportRow = NonNullable<RemoteBuilds["reports"]>[number];

const yes = (v: unknown) => (v ? "yes" : "no");

const BRANCH_COLUMNS: DataColumn<BranchRow>[] = [
	{ id: "name", header: "Branch", accessor: (b) => b.name, mono: true },
	{ id: "channel", header: "Channel", type: "enum", accessor: (b) => b.channel ?? null },
	{ id: "artifact", header: "Build", accessor: (b) => b.artifactId ?? null, mono: true },
	{ id: "seq", header: "Seq", type: "number", accessor: (b) => b.seq ?? null },
	{ id: "commit", header: "Commit", accessor: (b) => b.commit ?? null, format: (v) => shortId(v as string | null, 4), mono: true },
	{ id: "deployedAt", header: "Deployed", type: "date", accessor: (b) => epochMs(b.deployedAt), format: (v) => fmtAgo(v as number | null) },
];

const ARTIFACT_COLUMNS: DataColumn<ArtifactRow>[] = [
	{ id: "branch", header: "Branch", type: "enum", accessor: (a) => a.branch ?? null },
	{ id: "artifact", header: "Build", accessor: (a) => a.artifactId ?? null, mono: true },
	{ id: "seq", header: "Seq", type: "number", accessor: (a) => a.seq ?? null },
	{ id: "at", header: "Deployed", type: "date", accessor: (a) => epochMs(a.at), format: (v) => fmtAgo(v as number | null) },
	{ id: "live", header: "Live head", type: "boolean", accessor: (a) => a.live === true, format: (v) => yes(v) },
	{ id: "running", header: "Running here", type: "boolean", accessor: (a) => a.running === true, cell: (a) => (a.running ? <Badge label="running" tone="brand" /> : <Txt>no</Txt>) },
	{ id: "verified", header: "Signed", type: "boolean", accessor: (a) => Boolean(a.verified), format: (v) => yes(v) },
	{ id: "commit", header: "Commit", accessor: (a) => a.commit ?? null, format: (v) => shortId(v as string | null, 4), mono: true, defaultHidden: true },
	{ id: "channel", header: "Channel", type: "enum", accessor: (a) => a.channel ?? null, defaultHidden: true },
];

const FAILED = new Set(["failed", "rolled_back"]);

const REPORT_COLUMNS: DataColumn<ReportRow>[] = [
	{ id: "at", header: "When (UTC)", type: "date", accessor: (r) => epochMs(r.t), format: (v) => fmtTime(v as number | null) },
	{ id: "seq", header: "Seq", type: "number", accessor: (r) => r.s ?? null },
	{ id: "branch", header: "Branch", type: "enum", accessor: (r) => r.b ?? null },
	{ id: "artifact", header: "Build", accessor: (r) => r.a ?? null, mono: true },
	{ id: "result", header: "Result", type: "enum", accessor: (r) => r.r ?? null, cell: (r) => <Badge label={r.r ?? "?"} tone={FAILED.has(r.r ?? "") ? "critical" : "muted"} /> },
	{ id: "seconds", header: "Took", hint: "s", type: "number", accessor: (r) => r.d ?? null, format: (v) => fmtNum(v as number | null, 1) },
	{ id: "error", header: "Error", accessor: (r) => r.e ?? null, width: 220 },
	{ id: "kernel", header: "Kernel", type: "enum", accessor: (r) => r.k ?? null, defaultHidden: true },
];

export function BuildsTab({ active }: { active: boolean }) {
	const p = useTheme();
	const { call, ready } = useDebug();
	const builds = useRemote<RemoteBuilds>(call, "builds");
	const run = builds.run;
	useFirstFetch(active && ready, run);
	const d = builds.data;
	return (
		<View style={{ gap: space.sm }}>
			<RemoteBar state={builds} onFetch={() => void run()} />
			<Txt variant="small">One DataStore read on the server, like the dev menu.</Txt>
			{d ? (
				<>
					<H>Branch heads</H>
					<DataTable id="server-branches" label="Branch heads" columns={BRANCH_COLUMNS} data={d.branches ?? []} rowId={(b) => b.name} empty={<Empty>No branch heads.</Empty>} {...MEMORY_ONLY} />
					<H>Known builds</H>
					{d.artifactsError ? (
						<Txt variant="small" color={p.critical}>
							Could not read the builds: {d.artifactsError}
						</Txt>
					) : null}
					<DataTable
						id="server-artifacts"
						label="Known builds"
						columns={ARTIFACT_COLUMNS}
						data={d.artifacts ?? []}
						rowId={(a, i) => `${a.branch}-${a.artifactId}-${a.seq}-${i}`}
						defaultSort={[{ id: "at", desc: true }]}
						empty={<Empty>No builds known.</Empty>}
						{...MEMORY_ONLY}
					/>
					<H>This server's deploy reports</H>
					<DataTable
						id="server-reports"
						label="This server's deploy reports"
						columns={REPORT_COLUMNS}
						data={d.reports ?? []}
						rowId={(r, i) => `${r.s}-${r.t}-${i}`}
						defaultSort={[{ id: "at", desc: true }]}
						empty={<Empty>No deploy reported here yet.</Empty>}
						{...MEMORY_ONLY}
					/>
				</>
			) : null}
		</View>
	);
}

interface LimitRow {
	kind: string;
	name: string;
	used: number;
	limit: number;
	left?: number;
}

/** The budget's per-kind rows as one list (DataStore read, write...; HTTP requests; ...). */
export function limitRows(b: RemoteBudget | undefined): LimitRow[] {
	const out: LimitRow[] = [];
	for (const [kind, entry] of Object.entries(b?.kinds ?? {})) for (const row of entry.rows ?? []) out.push({ kind, ...row });
	return out;
}

const LIMIT_COLUMNS: DataColumn<LimitRow>[] = [
	{ id: "kind", header: "Service", type: "enum", accessor: (r) => r.kind },
	{ id: "name", header: "Request", accessor: (r) => r.name },
	{ id: "used", header: "Used", hint: "/ min", type: "number", accessor: (r) => r.used, format: (v) => fmtNum(v as number, 1) },
	{ id: "limit", header: "Limit", hint: "/ min", type: "number", accessor: (r) => r.limit, format: (v) => fmtInt(v as number) },
	{
		id: "share",
		header: "Share",
		type: "number",
		accessor: (r) => (r.limit > 0 ? r.used / r.limit : null),
		cell: (r) => {
			const share = r.limit > 0 ? r.used / r.limit : null;
			return share !== null && share >= 0.8 ? <ToneText tone="warning">{fmtPct(share, 0)}</ToneText> : <Txt>{fmtPct(share, 0)}</Txt>;
		},
	},
	{ id: "left", header: "Budget left", type: "number", accessor: (r) => r.left ?? null, format: (v) => fmtInt(v as number | null), title: "DataStore request budget left (shared with the game)" },
];

type DetailRow = NonNullable<RemoteBudget["detail"]>[number];
const DETAIL_COLUMNS: DataColumn<DetailRow>[] = [
	{ id: "caller", header: "Caller", type: "enum", accessor: (d) => d.caller },
	{ id: "kind", header: "Service", type: "enum", accessor: (d) => d.kind },
	{ id: "op", header: "Request", accessor: (d) => d.op, mono: true },
	{ id: "perMinute", header: "Per minute", type: "number", accessor: (d) => d.perMinute, format: (v) => fmtNum(v as number, 1) },
	{ id: "total", header: "Total", type: "number", accessor: (d) => d.total },
];

type TagRow = { name: string; mb: number };
const TAG_COLUMNS: DataColumn<TagRow>[] = [
	{ id: "name", header: "Memory tag", accessor: (t) => t.name },
	{ id: "mb", header: "MB", type: "number", accessor: (t) => t.mb, format: (v) => fmtNum(v as number, 1) },
];

export function BudgetTab({ active }: { active: boolean }) {
	const { call, ready } = useDebug();
	const budget = useRemote<RemoteBudget>(call, "budget");
	const run = budget.run;
	useFirstFetch(active && ready, run);
	const b = budget.data;
	return (
		<View style={{ gap: space.sm }}>
			<RemoteBar state={budget} onFetch={() => void run()} />
			{b?.missing ? <Empty>This server's kernel has no budget view (kernel 0.4.0+).</Empty> : null}
			{b && !b.missing ? (
				<>
					<Card style={{ gap: 0 }}>
						<KV label="Players" value={fmtInt(b.players)} />
						<KV label="Window" value={b.window !== undefined ? `${b.window} s` : "–"} />
						<KV label="Memory" value={b.memory?.total !== undefined ? `${fmtNum(b.memory.total, 0)} MB` : "–"} />
						<KV label="Lua heap" value={b.memory?.luaHeap !== undefined ? `${fmtNum(b.memory.luaHeap, 1)} MB` : b.memory?.heapKb !== undefined ? `${fmtNum(b.memory.heapKb / 1024, 1)} MB` : "–"} />
						<KV label="Refused" value={fmtInt(b.refused ?? 0)} />
					</Card>
					<DataTable id="server-budget" label="Requests against Roblox's limits" columns={LIMIT_COLUMNS} data={limitRows(b)} rowId={(r) => `${r.kind}-${r.name}`} {...MEMORY_ONLY} />
					<H>By caller</H>
					<DataTable
						id="server-budget-detail"
						label="Requests by caller"
						columns={DETAIL_COLUMNS}
						data={b.detail ?? []}
						rowId={(d) => `${d.caller}-${d.kind}-${d.op}`}
						defaultSort={[{ id: "perMinute", desc: true }]}
						empty={<Empty>No requests in the window.</Empty>}
						{...MEMORY_ONLY}
					/>
					{b.memory?.tags?.length ? (
						<>
							<H>Memory by tag</H>
							<DataTable id="server-memory-tags" label="Memory by tag" columns={TAG_COLUMNS} data={b.memory.tags} rowId={(t) => t.name} defaultSort={[{ id: "mb", desc: true }]} {...MEMORY_ONLY} />
						</>
					) : null}
				</>
			) : null}
		</View>
	);
}

type TopRow = NonNullable<RemoteErrors["top"]>[number];
const TOP_COLUMNS: DataColumn<TopRow>[] = [
	{ id: "template", header: "Error", accessor: (t) => t.template, mono: true, width: 300 },
	{ id: "realm", header: "Where", type: "enum", options: ["server", "client"], accessor: (t) => t.realm },
	{ id: "total", header: "Count", type: "number", accessor: (t) => t.total },
	{ id: "fp", header: "Fingerprint", accessor: (t) => t.fp, mono: true, defaultHidden: true },
];

export function ErrorsTab({ active }: { active: boolean }) {
	const { call, ready } = useDebug();
	const errors = useRemote<RemoteErrors>(call, "errors");
	const run = errors.run;
	useFirstFetch(active && ready, run);
	const e = errors.data;
	return (
		<View style={{ gap: space.sm }}>
			<RemoteBar state={errors} onFetch={() => void run()} />
			<Txt variant="small">Counters and the busiest templates since the server started (never a raw message).</Txt>
			{e?.missing ? <Empty>This server's kernel has no error reports (kernel 0.4.0+).</Empty> : null}
			{e && !e.missing ? (
				<>
					<Card style={{ gap: 0 }}>
						<KV label="Reports" value={e.enabled ? "on" : "off"} />
						<KV label="Seen" value={`${fmtInt(e.seen?.server ?? 0)} server, ${fmtInt(e.seen?.client ?? 0)} client`} />
						<KV label="Kinds" value={fmtInt(e.kinds)} />
						<KV label="Waiting" value={fmtInt(e.waiting)} />
						<KV label="Sent" value={fmtInt(e.sent)} />
						<KV label="Failed posts" value={fmtInt(e.failed)} />
						<KV label="Last sent" value={e.lastOkAt ? fmtAgo(epochMs(e.lastOkAt)) : "–"} />
					</Card>
					{e.lastError ? <Txt variant="small">Last post error: {e.lastError}</Txt> : null}
					<DataTable id="server-errors" label="Busiest errors" columns={TOP_COLUMNS} data={e.top ?? []} rowId={(t) => t.fp} defaultSort={[{ id: "total", desc: true }]} empty={<Empty>No errors on this server.</Empty>} {...MEMORY_ONLY} />
				</>
			) : null}
		</View>
	);
}

type RemoteRow = RemoteNetwork["remotes"][number];
const NETWORK_COLUMNS: DataColumn<RemoteRow>[] = [
	{ id: "path", header: "Remote", accessor: (r) => r.path, mono: true, width: 200 },
	{ id: "inbound", header: "In", type: "number", accessor: (r) => r.inbound },
	{ id: "outbound", header: "Out", type: "number", accessor: (r) => r.outbound },
	{ id: "rejected", header: "Rejected", type: "number", accessor: (r) => r.rejected },
	{ id: "errors", header: "Errors", type: "number", accessor: (r) => r.errors },
];

export function NetworkTab({ active }: { active: boolean }) {
	const { call, ready } = useDebug();
	const network = useRemote<RemoteNetwork>(call, "network");
	const run = network.run;
	useFirstFetch(active && ready, run);
	const n = network.data;
	return (
		<View style={{ gap: space.sm }}>
			<RemoteBar state={network} onFetch={() => void run()} />
			<Txt variant="small">Counters per remote since the generation started (no packet capture).</Txt>
			{n && !n.supported ? <Empty>This build doesn't count its remotes.</Empty> : null}
			{n?.supported ? (
				<DataTable id="server-network" label="Remotes" columns={NETWORK_COLUMNS} data={n.remotes ?? []} rowId={(r) => r.path} defaultSort={[{ id: "inbound", desc: true }]} empty={<Empty>No remote traffic yet.</Empty>} {...MEMORY_ONLY} />
			) : null}
		</View>
	);
}

// Audit --------------------------------------------------------------------------------------------------------------

const AUDIT_COLUMNS: DataColumn<DebugAuditEntry>[] = [
	{ id: "at", header: "When (UTC)", type: "date", accessor: (a) => a.at, format: (v) => fmtTime(v as number) },
	{ id: "who", header: "Who", type: "enum", accessor: (a) => a.who, format: (v) => (v === "token" ? "admin token" : String(v)), mono: true },
	{ id: "op", header: "Op", type: "enum", accessor: (a) => a.op, mono: true },
	{ id: "args", header: "Args", accessor: (a) => a.args || null },
	{ id: "ip", header: "From", accessor: (a) => a.ip || null, mono: true },
	{ id: "id", header: "Command", accessor: (a) => a.id, mono: true, defaultHidden: true },
];

/** The remote debug commands sent to this server (the backend's audit: who, op, an args summary; never an answer). */
export function AuditTab({ backendId, active, job }: { backendId: string; active: boolean; job: string }) {
	const audit = useTTQuery(backendId, ["fleet", "debug-audit"], (api, signal) => api.debugAudit(500, signal), { enabled: active, refetchInterval: active ? 30_000 : false });
	const rows = (audit.data ?? []).filter((a) => a.job === job);
	return (
		<View style={{ gap: space.sm }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Button title="Refresh" small icon="refresh" loading={audit.isFetching} onPress={() => void audit.refetch()} />
			</View>
			<Txt variant="small">Every command queued for this server (kept in the backend's audit file; the last 500 in memory).</Txt>
			{audit.isPending && active ? (
				<Skeleton height={80} />
			) : audit.error ? (
				<ErrorState error={audit.error} title="Could not load the audit" onRetry={() => void audit.refetch()} />
			) : audit.data ? (
				<DataTable id="server-audit" label="Remote debug audit" columns={AUDIT_COLUMNS} data={rows} rowId={(a) => a.id} defaultSort={[{ id: "at", desc: true }]} empty={<Empty>No commands for this server yet.</Empty>} />
			) : null}
		</View>
	);
}
