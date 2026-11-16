/**
 * Players: the 100 first players in the order you pick (query `players`), searched by part of a pid or a UserId; extra
 * funnel progress per player (query `funnel-progress`); the identity backfill. A tap opens the player's page.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { Api } from "@/api/backend";
import type { PlayerSummary } from "@/api/tt/types";
import { Badge, Button, Chips, List, SearchBar, Segmented, Txt } from "@/components/ui";
import { FunnelBar, Note, openPlayer, Panel, QueryState } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, fmtInt, fmtMinutes, plural, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme } from "@/theme";

const PID = /^[A-Za-z0-9_-]{1,64}$/;
const UID = /^\d{1,16}$/;

const SORTS = [
	{ value: "lastSeen", label: "Last seen" },
	{ value: "firstSeen", label: "First seen" },
	{ value: "sessions", label: "Sessions" },
	{ value: "playtime", label: "Playtime" },
	{ value: "robux", label: "Robux spent" },
	{ value: "events", label: "Events" },
	{ value: "new", label: "New" },
	{ value: "pid", label: "pid" },
];

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
	const [text, setText] = useState("");
	const [search, setSearch] = useState("");
	const [missing, setMissing] = useState("");
	const [sort, setSort] = useState("lastSeen");
	const [desc, setDesc] = useState(true);
	const [funnels, setFunnels] = useState<string[]>([]);
	const [pickFunnels, setPickFunnels] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setSearch(text.trim()), 400);
		return () => clearTimeout(timer);
	}, [text]);
	const valid = search === "" || PID.test(search);
	const q = useTTAnalytics(backendId, "players", { limit: 100, ...(search ? { search } : {}), orderBy: sort, desc }, { enabled: valid, keepPrevious: true });
	const pids = useMemo(() => (q.data?.players ?? []).map((x) => x.pid), [q.data]);
	const progress = useTTAnalytics(backendId, "funnel-progress", { ...(funnels.length === 1 ? { funnel: funnels[0] } : {}), pids }, { enabled: funnels.length > 0 && pids.length > 0 });
	const byKey = useMemo(() => new Map((progress.data?.progress ?? []).map((x) => [`${x.pid}\n${x.funnel}`, x])), [progress.data]);
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
			<View style={{ gap: space.sm }}>
				<Txt variant="label">Order (the server sends the first 100 in it)</Txt>
				<Chips options={SORTS} value={sort} onChange={setSort} />
				<Segmented
					options={[
						{ value: "desc", label: "Largest / newest first" },
						{ value: "asc", label: "Smallest / oldest first" },
					]}
					value={desc ? "desc" : "asc"}
					onChange={(v) => setDesc(v === "desc")}
				/>
			</View>
			<View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
				<Button title={funnels.length ? `Funnels (${funnels.length})` : "Add funnel progress"} small icon="funnel-outline" onPress={() => setPickFunnels((x) => !x)} />
			</View>
			{pickFunnels ? <FunnelChoices backendId={backendId} chosen={funnels} onChange={setFunnels} /> : null}
			<QueryState q={q} isEmpty={(d) => d.players.length === 0} empty={search ? "No pid matches." : "No players in this range."}>
				{(data) => (
					<Panel title={plural(data.players.length, "player")}>
						<List>
							{data.players.map((x: PlayerSummary) => (
								<Pressable key={x.pid} onPress={() => openPlayer(backendId, x.pid)} android_ripple={{ color: p.accent }} style={({ pressed }) => [{ paddingVertical: 9, paddingHorizontal: space.md, gap: 4 }, pressed && { backgroundColor: p.accent }]}>
									<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
										<Txt variant="mono" style={{ flexShrink: 1 }} numberOfLines={1}>
											{shortId(x.pid, 10)}
										</Txt>
										{x.newInRange ? <Badge label="new" tone="brand" /> : null}
										<View style={{ flex: 1 }} />
										<Txt variant="small">{fmtAgo(x.lastSeen)}</Txt>
									</View>
									<Txt variant="small">
										{[x.uid !== undefined ? `UserId ${x.uid}` : null, plural(x.sessions, "session"), fmtMinutes(x.playtimeMinutes), `${fmtInt(x.robux ?? 0)} Robux`, sort === "events" ? plural(x.events, "event") : null, sort === "firstSeen" ? `first ${fmtAgo(x.firstSeen)}` : null]
											.filter(Boolean)
											.join(" · ")}
									</Txt>
									{funnels.map((f) => (
										<View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
											<Txt variant="small" numberOfLines={1} style={{ width: 96 }}>
												{f}
											</Txt>
											<View style={{ flex: 1 }}>{progress.data ? <FunnelBar progress={byKey.get(`${x.pid}\n${f}`)} /> : <Txt variant="small">{progress.error ? "–" : "…"}</Txt>}</View>
										</View>
									))}
								</Pressable>
							))}
						</List>
					</Panel>
				)}
			</QueryState>
			<IdentityStatus backendId={backendId} />
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

