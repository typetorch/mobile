/**
 * Events: the most logged event names per kind (query `top-events`); pick one for its newest 100 rows (query `events`).
 * `?pid=` (from a player's page) shows that player's rows.
 */
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import type { EventRow } from "@/api/tt/types";
import { Badge, Button, Chips, EmptyState, List, Txt } from "@/components/ui";
import { EventItem, Note, Panel, PidLink, QueryState, ShareRow } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtInt, shortId } from "@/lib/format";
import { space } from "@/theme";

const ALL = "all";

export default function EventsScreen() {
	return <TTScreen title="Events">{({ backendId }) => <Events backendId={backendId} />}</TTScreen>;
}

function Events({ backendId }: { backendId: string }) {
	const params = useLocalSearchParams<{ pid?: string }>();
	const [pid, setPid] = useState(typeof params.pid === "string" ? params.pid : "");
	const top = useTTAnalytics(backendId, "top-events", { limit: 500 });
	const [kind, setKind] = useState(ALL);
	const [picked, setPicked] = useState<{ kind: string; name: string } | null>(null);
	const [all, setAll] = useState(false);
	const events = useMemo(() => top.data?.events ?? [], [top.data]);
	const kinds = useMemo(() => [...new Set(events.map((e) => e.kind))].sort(), [events]);
	const shown = useMemo(() => (kind === ALL ? events : events.filter((e) => e.kind === kind)), [events, kind]);
	const max = Math.max(1, ...shown.map((e) => e.count));
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>The most logged event names per kind; tap one to see its newest rows.</Note>
			{picked || pid ? <RecentRows backendId={backendId} {...(picked ?? {})} pid={pid} onClearPid={() => setPid("")} onClearPick={() => setPicked(null)} /> : null}
			<QueryState q={top} isEmpty={(d) => d.events.length === 0} empty="No events in this range.">
				{() => (
					<Panel title={`${fmtInt(events.length)} event names`}>
						<Chips options={[{ value: ALL, label: "all" }, ...kinds.map((k) => ({ value: k, label: k }))]} value={kind} onChange={setKind} />
						{shown.length ? (
							<List>
								{(all ? shown : shown.slice(0, 60)).map((e) => (
									<ShareRow
										key={`${e.kind}/${e.name}`}
										onPress={() => setPicked({ kind: e.kind, name: e.name })}
										label={
											<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
												<Badge label={e.kind} tone={picked?.kind === e.kind && picked.name === e.name ? "brand" : "muted"} />
												<Txt numberOfLines={1} style={{ flexShrink: 1 }}>
													{e.name}
												</Txt>
											</View>
										}
										value={fmtInt(e.count)}
										share={e.count / max}
										sub={`${fmtInt(e.players)} players`}
									/>
								))}
							</List>
						) : (
							<Txt variant="muted">No events of this kind.</Txt>
						)}
						{shown.length > 60 ? <Button title={all ? "Show fewer" : `Show all ${shown.length}`} small variant="ghost" onPress={() => setAll((a) => !a)} style={{ alignSelf: "flex-start" }} /> : null}
					</Panel>
				)}
			</QueryState>
		</>
	);
}

function RecentRows({ backendId, kind, name, pid, onClearPid, onClearPick }: { backendId: string; kind?: string; name?: string; pid?: string; onClearPid(): void; onClearPick(): void }) {
	const q = useTTAnalytics(backendId, "events", { ...(kind ? { kind } : {}), ...(name ? { name } : {}), ...(pid ? { pid } : {}), limit: 100 });
	const what = kind && name ? `${kind} / ${name} rows` : "rows";
	return (
		<Panel
			title={pid ? `Newest ${what} of ${shortId(pid)}` : `Newest ${what}`}
			note="Up to 100, newest first. Fleet rows never show props (they can hold a private server's access code)."
			right={
				<View style={{ flexDirection: "row", gap: space.xs }}>
					{pid ? <Button title="All players" small variant="ghost" onPress={onClearPid} /> : null}
					{kind ? <Button title="Close" small variant="ghost" onPress={onClearPick} /> : null}
				</View>
			}
		>
			<QueryState q={q} isEmpty={(d) => d.events.length === 0} empty="No rows of this event in this range." rows={4}>
				{(data) =>
					data.events.length ? (
						<List>
							{data.events.map((e: EventRow, i) => (
								<EventItem
									key={`${e.t}-${i}`}
									e={e}
									extra={
										<View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
											{e.pid ? <PidLink backendId={backendId} pid={e.pid} /> : <Txt variant="small">server row</Txt>}
											<Txt variant="small">
												{[e.branch, e.dev, e.art, shortId(e.job, 6)].filter(Boolean).join(" · ")}
											</Txt>
										</View>
									}
								/>
							))}
						</List>
					) : (
						<EmptyState title="No rows" />
					)
				}
			</QueryState>
		</Panel>
	);
}
