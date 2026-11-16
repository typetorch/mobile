/**
 * Players: the 100 first players in the order you pick (query `players`), searched by part of a pid or a UserId (the
 * web's `find`, in the route); extra funnel progress per player (query `funnel-progress`); the identity backfill; churn
 * risk (features/typetorch/churn.tsx, `risk`). A tap opens the player's page. A web link's `pid` (the player picked
 * on the web's Players page) opens that player's page; a link's `find` that is a pid or a known UserId does too.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import type { Api } from "@/api/backend";
import type { PlayerSummary } from "@/api/tt/types";
import { Badge, Button, Chips, List, SearchBar, Segmented, Txt } from "@/components/ui";
import { FunnelBar, Note, openPlayer, Panel, PidLink, QueryState } from "@/features/typetorch/bits";
import { ChurnRisk } from "@/features/typetorch/churn";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn, type SortSpec } from "@/features/typetorch/table";
import { usePageParam, usePageParams } from "@/features/typetorch/view-link";
import { fmtAgo, fmtInt, fmtMinutes, plural, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme } from "@/theme";

const PID = /^[A-Za-z0-9_-]{1,64}$/;
const UID = /^\d{1,16}$/;

/** The columns the server orders by (the players query's orderBy). */
const PLAYER_SORT_COLUMNS = ["pid", "lastSeen", "firstSeen", "sessions", "playtime", "robux", "events", "new"];

/** The player list: pid with its UserId under it, then when, how often, how long and how much Robux. Sorts by the numbers, not the text. */
function playerListColumns(backendId: string): DataColumn<PlayerSummary>[] {
	return [
		{
			id: "pid",
			header: "Player",
			width: 130,
			accessor: (x) => x.pid,
			searchText: (x) => (x.uid !== undefined ? `UserId ${x.uid}` : ""),
			cell: (x) => (
				<View style={{ gap: 2 }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
						<PidLink backendId={backendId} pid={x.pid} keep={10} {...(x.uid !== undefined ? { uid: x.uid } : {})} />
						{x.newInRange ? <Badge label="new" tone="brand" /> : null}
					</View>
					{x.uid !== undefined ? <Txt variant="small" style={{ fontSize: 10 }}>UserId {x.uid}</Txt> : null}
				</View>
			),
		},
		{ id: "lastSeen", header: "Seen", type: "date", width: 90, accessor: (x) => x.lastSeen, format: (_v, x) => fmtAgo(x.lastSeen) },
		{ id: "sessions", header: "Sessions", type: "number", width: 74, accessor: (x) => x.sessions, cell: (x) => fmtInt(x.sessions) },
		{ id: "playtime", header: "Playtime", type: "number", width: 80, accessor: (x) => x.playtimeMinutes, format: (_v, x) => fmtMinutes(x.playtimeMinutes) },
		{ id: "robux", header: "Robux spent", type: "number", width: 84, accessor: (x) => x.robux ?? 0, cell: (x) => fmtInt(x.robux ?? 0) },
		{ id: "events", header: "Events", type: "number", width: 70, accessor: (x) => x.events, defaultHidden: true },
		{ id: "firstSeen", header: "First seen", type: "date", width: 100, accessor: (x) => x.firstSeen, defaultHidden: true },
		{ id: "new", header: "New", type: "boolean", width: 60, accessor: (x) => x.newInRange, defaultHidden: true },
		{ id: "uid", header: "UserId", type: "text", width: 100, accessor: (x) => (x.uid === undefined ? null : String(x.uid)), defaultHidden: true },
	];
}

/** A pid, or a UserId mapped to its most recently seen pid. */
async function pidFor(api: Api, text: string): Promise<string | undefined> {
	if (UID.test(text)) {
		const known = await api.identity({ uid: text }).catch(() => []);
		if (known.length) return known[0]?.pid;
	}
	return PID.test(text) && text.length >= 8 ? text : undefined;
}

export default function PlayersScreen() {
	return <TTScreen title="Players">{({ backendId, api }) => <Players backendId={backendId} api={api} />}</TTScreen>;
}

function Players({ backendId, api }: { backendId: string; api: Api }) {
	const p = useTheme();
	// The web's `find`: the search text, in the route so it travels in a link.
	const [find, setFind] = usePageParam("find");
	const [pidParam] = usePageParam("pid");
	const [, setPage] = usePageParams();
	const [text, setText] = useState(find);
	const [search, setSearch] = useState(find.trim());
	const [missing, setMissing] = useState("");
	const [sort, setSort] = useState<SortSpec | undefined>(undefined);
	// The web's URL parameter `funnels` (the progress columns, comma separated).
	const [funnelsParam, setFunnelsParam] = usePageParam("funnels");
	const funnels = useMemo(() => funnelsParam.split(",").filter(Boolean).slice(0, 8), [funnelsParam]);
	const setFunnels = (next: string[]) => setFunnelsParam(next.join(","));
	const [pickFunnels, setPickFunnels] = useState(false);
	const written = useRef(find);
	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(text.trim());
			if (text.trim() !== written.current) {
				written.current = text.trim();
				setFind(text.trim());
			}
		}, 400);
		return () => clearTimeout(timer);
	}, [text, setFind]);
	// The route changed `find` on its own (a link): the box follows; our own writes don't move it.
	useEffect(() => {
		if (find === written.current) return;
		written.current = find;
		setText(find);
		setSearch(find.trim());
	}, [find]);
	// Arriving with a link: `pid` opens that player; `find` that is a pid or a known UserId does too (the web's top-bar
	// "Find player"). Once, on arrival, so typing in the box never jumps away.
	const arrival = useRef<{ pid: string; find: string } | null>({ pid: pidParam, find });
	useEffect(() => {
		if (!arrival.current) return;
		const { pid, find: found } = arrival.current;
		arrival.current = null;
		if (pid && PID.test(pid)) {
			setPage({ pid: null, sid: null });
			router.push(`/tt/${backendId}/player/${encodeURIComponent(pid)}`);
			return;
		}
		if (found)
			void pidFor(api, found).then((x) => {
				if (x) openPlayer(backendId, x);
			});
	}, [api, backendId, setPage]);
	const valid = search === "" || PID.test(search);
	const q = useTTAnalytics(backendId, "players", { limit: 100, ...(search ? { search } : {}), ...(sort ? { orderBy: sort.id, desc: sort.desc } : {}) }, { enabled: valid, keepPrevious: true });
	const pids = useMemo(() => (q.data?.players ?? []).map((x) => x.pid), [q.data]);
	const progress = useTTAnalytics(backendId, "funnel-progress", { ...(funnels.length === 1 ? { funnel: funnels[0] } : {}), pids }, { enabled: funnels.length > 0 && pids.length > 0 });
	const byKey = useMemo(() => new Map((progress.data?.progress ?? []).map((x) => [`${x.pid}\n${x.funnel}`, x])), [progress.data]);
	const columns = useMemo<DataColumn<PlayerSummary>[]>(
		() => [
			...playerListColumns(backendId),
			...funnels.map(
				(f): DataColumn<PlayerSummary> => ({
					id: `funnel:${f}`,
					header: f,
					title: `Furthest step in ${f}`,
					type: "number",
					width: 110,
					filter: false,
					accessor: (x) => byKey.get(`${x.pid}\n${f}`)?.share ?? null,
					format: (v) => (v === null || v === undefined ? "not started" : `${Math.round((v as number) * 100)}%`),
					cell: (x) => (progress.data ? <FunnelBar progress={byKey.get(`${x.pid}\n${f}`)} /> : progress.error ? "–" : "…"),
				}),
			),
		],
		[backendId, funnels, byKey, progress.data, progress.error],
	);
	const canOpen = (PID.test(text.trim()) && text.trim().length >= 8) || UID.test(text.trim());
	const open = async () => {
		const pid = await pidFor(api, text.trim());
		if (pid) {
			setMissing("");
			openPlayer(backendId, pid);
		} else setMissing(text.trim());
	};

	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Find a player by pid (random ids, never a UserId) or UserId, then read their spending, playtime, sessions and timeline.</Note>
			<SearchBar value={text} onChangeText={setText} placeholder="pid, part of one, or a UserId" onSubmit={canOpen ? open : undefined} />
			{canOpen ? <Button title={`Open ${UID.test(text.trim()) ? "UserId" : "pid"} ${text.trim()}`} small icon="person-outline" onPress={open} style={{ alignSelf: "flex-start" }} /> : null}
			{!valid ? <Note>A pid has only letters, digits, _ and -.</Note> : null}
			{missing ? <Note>No player found for UserId {missing}.</Note> : null}
			<View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
				<Button title={funnels.length ? `Funnels (${funnels.length})` : "Add funnel progress"} small icon="funnel-outline" onPress={() => setPickFunnels((x) => !x)} />
			</View>
			{pickFunnels ? <FunnelChoices backendId={backendId} chosen={funnels} onChange={setFunnels} /> : null}
			<QueryState q={q} isEmpty={(d) => d.players.length === 0} empty={search ? "No pid matches." : "No players in this range."}>
				{(data) => (
					<Panel title={plural(data.players.length, "player")} note="The server sends the first 100 in the order you pick: tap a header to order by it.">
						<DataTable
							id="players-list"
							label="Players"
							columns={columns}
							data={data.players}
							serverSort={{ columns: PLAYER_SORT_COLUMNS, onChange: setSort }}
							rowId={(x) => x.pid}
							density="compact"
							onRowPress={(x) => openPlayer(backendId, x.pid)}
							columnsMenu={<FunnelChoices backendId={backendId} chosen={funnels} onChange={setFunnels} />}
						/>
					</Panel>
				)}
			</QueryState>
			<IdentityStatus backendId={backendId} />
			<ChurnRisk backendId={backendId} />
		</>
	);
}

function FunnelChoices({ backendId, chosen, onChange }: { backendId: string; chosen: string[]; onChange(next: string[]): void }) {
	const list = useTTAnalytics(backendId, "funnel", {});
	const found = list.data && list.data.funnel === null ? list.data.funnels : [];
	const names = [...found.map((f) => f.name), ...chosen.filter((c) => !found.some((f) => f.name === c))];
	return (
		<Panel title="Funnel progress columns" note="Tick a funnel to see each player's furthest step in it.">
			{list.error ? <Note>Couldn't load the funnels: {list.error.message}</Note> : !list.data ? <Note>Loading funnels…</Note> : !names.length ? <Note>No funnels in this range.</Note> : null}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
				{names.map((name) => {
					const on = chosen.includes(name);
					const players = found.find((f) => f.name === name)?.players;
					return <Button key={name} small variant={on ? "brand" : "secondary"} icon={on ? "checkmark" : "add"} title={players !== undefined ? `${name} · ${fmtInt(players)}` : name} onPress={() => onChange(on ? chosen.filter((c) => c !== name) : [...chosen, name])} />;
				})}
			</View>
			{chosen.length ? <Button title="Remove all funnel columns" small variant="ghost" onPress={() => onChange([])} style={{ alignSelf: "flex-start" }} /> : null}
		</Panel>
	);
}

/** The identity backfill from the game's DataStore links, when the server can read them. */
function IdentityStatus({ backendId }: { backendId: string }) {
	const client = useQueryClient();
	const { api } = useBackend(backendId);
	const summary = useTTQuery(backendId, ["identity", "summary"], (a, s) => a.identitySummary(s), { retry: false });
	const [progress, setProgress] = useState<{ added: number; scanned: number } | null>(null);
	const backfill = useMutation({
		mutationFn: async () => {
			let total = { added: 0, scanned: 0 };
			let token: string | undefined;
			do {
				const r = await (api as Api).backfillIdentities(token);
				total = { added: total.added + r.added, scanned: total.scanned + r.scanned };
				setProgress(total);
				token = r.nextPageToken;
			} while (token);
			return total;
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: ["tt", backendId, "identity"] });
			void client.invalidateQueries({ queryKey: ["tt", backendId, "query", "players"] });
		},
	});
	if (!summary.data) return null;
	return (
		<View style={{ gap: 6 }}>
			<Note>{fmtInt(summary.data.count)} pids are linked to a UserId.</Note>
			{summary.data.backfill ? (
				<Button
					title={backfill.isPending ? `Backfilling… ${progress ? `${progress.added} added of ${progress.scanned}` : ""}` : "Backfill identities"}
					small
					icon="link-outline"
					loading={backfill.isPending}
					onPress={() => backfill.mutate()}
					style={{ alignSelf: "flex-start" }}
				/>
			) : null}
			{backfill.isSuccess ? <Note>Backfill done: {fmtInt(backfill.data.added)} added, {fmtInt(backfill.data.scanned)} links read.</Note> : null}
			{backfill.isError ? <Note>{backfill.error.message}</Note> : null}
		</View>
	);
}

