/**
 * Events: the most logged event names per kind (query `top-events`); pick one for its newest 100 rows (query `events`).
 * `?pid=` (from a player's page) shows that player's rows.
 */
import { useMemo } from "react";
import { View } from "react-native";

import type { EventRow } from "@/api/tt/types";
import { Badge, Button, Chips, EmptyState, List, Txt } from "@/components/ui";
import { Note, Panel, PidLink, QueryState, ShareBar } from "@/features/typetorch/bits";
import { EventTable } from "@/features/typetorch/event-table";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { usePageParam } from "@/features/typetorch/view-link";
import { fmtInt, shortId } from "@/lib/format";
import { space } from "@/theme";

const ALL = "all";

export default function EventsScreen() {
	return <TTScreen title="Events">{({ backendId }) => <Events backendId={backendId} />}</TTScreen>;
}

function Events({ backendId }: { backendId: string }) {
	// The web's URL parameters: kind, event ("<kind>/<name>"), pid.
	const [pid, setPid] = usePageParam("pid");
	const top = useTTAnalytics(backendId, "top-events", { limit: 500 });
	const [kind, setKind] = usePageParam("kind", ALL);
	const [event, setEvent] = usePageParam("event");
	const at = event.indexOf("/");
	const picked = at > 0 ? { kind: event.slice(0, at), name: event.slice(at + 1) } : null;
	const setPicked = (e: { kind: string; name: string } | null) => setEvent(e ? `${e.kind}/${e.name}` : "");
	const events = useMemo(() => top.data?.events ?? [], [top.data]);
	const kinds = useMemo(() => [...new Set(events.map((e) => e.kind))].sort(), [events]);
	const shown = useMemo(() => (kind === ALL ? events : events.filter((e) => e.kind === kind)), [events, kind]);
	const max = Math.max(1, ...shown.map((e) => e.count));
	const nameColumns = useMemo<DataColumn<(typeof events)[number]>[]>(
		() => [
			{ id: "kind", header: "Kind", type: "enum", width: 90, accessor: (e) => e.kind, cell: (e) => <Badge label={e.kind} /> },
			{ id: "name", header: "Event", width: 170, accessor: (e) => e.name },
			{ id: "count", header: "Count", type: "number", width: 76, accessor: (e) => e.count, cell: (e) => fmtInt(e.count) },
			{
				id: "share",
				header: "Share of the most",
				type: "number",
				width: 110,
				filter: false,
				accessor: (e) => e.count / max,
				format: (v) => `${Math.round((v as number) * 100)}%`,
				cell: (e) => <ShareBar share={e.count / max} />,
			},
			{ id: "players", header: "Players", title: "Distinct pids; server rows have none", type: "number", width: 72, accessor: (e) => e.players, cell: (e) => fmtInt(e.players) },
		],
		[max],
	);
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
							<DataTable
								id="events-names"
								label="Event names"
								columns={nameColumns}
								data={shown}
								rowId={(e) => `${e.kind}/${e.name}`}
								onRowPress={(e) => setPicked({ kind: e.kind, name: e.name })}
								isRowSelected={(e) => picked?.kind === e.kind && picked.name === e.name}
								defaultSort={[{ id: "count", desc: true }]}
								density="compact"
							/>
						) : (
							<Txt variant="muted">No events of this kind.</Txt>
						)}
					</Panel>
				)}
			</QueryState>
		</>
	);
}

function RecentRows({ backendId, kind, name, pid, onClearPid, onClearPick }: { backendId: string; kind?: string; name?: string; pid?: string; onClearPid(): void; onClearPick(): void }) {
	const q = useTTAnalytics(backendId, "events", { ...(kind ? { kind } : {}), ...(name ? { name } : {}), ...(pid ? { pid } : {}), limit: 100 });
	const what = kind && name ? `${kind} / ${name} rows` : "rows";
	const rowColumns = useMemo<DataColumn<EventRow>[]>(
		() => [
			{ id: "pid", header: "Player", width: 120, accessor: (e) => e.pid, cell: (e) => (e.pid ? <PidLink backendId={backendId} pid={e.pid} /> : "server row") },
			{ id: "branch", header: "Branch", type: "enum", width: 80, accessor: (e) => e.branch },
			{ id: "dev", header: "Device", type: "enum", width: 80, accessor: (e) => e.dev },
			{ id: "art", header: "Artifact", type: "enum", width: 100, mono: true, accessor: (e) => e.art },
			{ id: "job", header: "Job", width: 90, mono: true, accessor: (e) => e.job, format: (_v, e) => shortId(e.job, 6) },
		],
		[backendId],
	);
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
						<EventTable backendId={backendId} id="events-rows" label="Newest event rows" events={data.events} dateToo extra={rowColumns} rowId={(e, i) => `${e.t}-${i}`} defaultSort={[{ id: "time", desc: true }]} />
					) : (
						<EmptyState title="No rows" />
					)
				}
			</QueryState>
		</Panel>
	);
}
