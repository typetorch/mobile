/**
 * One error kind (the web's Errors side sheet, `fp`): its stack, occurrences over the window, the players who hit it
 * (DataTable `errors-players`, GET /v1/errors/<fp>/players), and where it hits (builds, branches, realms, servers). The
 * window and the list's realm, branch and build come from the route, so the list's filters carry over and travel in a link.
 */
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import type { ErrorParams } from "@/api/backend";
import type { ErrorPlayer, ErrorPlayers } from "@/api/tt/types";

import { BarChart, ShareBars } from "@/charts/LineChart";
import { Badge, Button, Card, ErrorState, KV, List, Row, Section, Segmented, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { Note, QueryState } from "@/features/typetorch/bits";
import { PlayerHover } from "@/features/typetorch/cards";
import { ERROR_WINDOWS, errorWindow } from "@/features/typetorch/errors";
import { useTTQuery } from "@/features/typetorch/hooks";
import { chartMarks, DeployMarksToggle, useDeployMarks, useMarkCard } from "@/features/typetorch/marks";
import { DropRulesSheet, exactRuleFor } from "@/features/typetorch/drop-rules";
import { isReadOnly } from "@/features/typetorch/roles";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam } from "@/features/typetorch/view-link";
import { compact, fmtAgo, fmtInt, fmtTime, shortId } from "@/lib/format";
import { useTheme } from "@/theme";

export default function ErrorScreen() {
	const { fp } = useLocalSearchParams<{ fp: string }>();
	const id = decodeURIComponent(String(fp ?? ""));
	return <TTScreen title="Error">{({ backendId, account }) => <ErrorKindView backendId={backendId} fp={id} canEdit={!isReadOnly(account)} />}</TTScreen>;
}

function ErrorKindView({ backendId, fp, canEdit }: { backendId: string; fp: string; canEdit: boolean }) {
	const p = useTheme();
	const [dropDraft, setDropDraft] = useState<string | undefined>();
	// The web's parameters: window (every window of the list) and the list's realm, branch and build, so they travel in a link.
	const [windowParam, setWindow] = usePageParam("window", "24h");
	const window = errorWindow(windowParam);
	const [realm, setRealm] = usePageParam("realm");
	const [branch, setBranch] = usePageParam("branch");
	const [build, setBuild] = usePageParam("build");
	const params: ErrorParams = { window, ...(realm ? { realm } : {}), ...(branch ? { branch } : {}), ...(build ? { build } : {}) };
	const [copied, setCopied] = useState(false);
	const q = useTTQuery(backendId, ["errors", "kind", fp, params], (api, s) => api.errorKind(fp, params, s), { refetchInterval: 30_000 });
	// Deploy marks on the bar each release falls in (a tap opens its card and deploy).
	const markRange = useMemo(() => (q.data ? { from: Date.parse(q.data.window.from), to: Date.parse(q.data.window.to) } : null), [q.data]);
	const deploys = useDeployMarks(backendId, markRange, branch || undefined);
	const card = useMarkCard(backendId);
	if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton height={240} />;
	const d = q.data;
	const text = `${d.kind.template}\n${d.kind.stack ?? ""}`;
	return (
		<>
			<Card style={{ gap: 8 }}>
				<Txt style={{ fontWeight: "600" }} selectable>
					{d.kind.template}
				</Txt>
				{d.kind.stack ? (
					<ScrollView horizontal style={{ maxHeight: 220 }}>
						<Txt variant="mono" selectable>
							{d.kind.stack}
						</Txt>
					</ScrollView>
				) : null}
				<Button
					title={copied ? "Copied" : "Copy"}
					small
					icon="copy-outline"
					onPress={async () => {
						await Clipboard.setStringAsync(text);
						setCopied(true);
					}}
					style={{ alignSelf: "flex-start" }}
				/>
				{canEdit ? <Button title="Drop errors like this" small icon="funnel-outline" onPress={() => setDropDraft(exactRuleFor(d.kind.template))} style={{ alignSelf: "flex-start" }} /> : null}
				<DropRulesSheet backendId={backendId} open={dropDraft !== undefined} onClose={() => setDropDraft(undefined)} canEdit={canEdit} draft={dropDraft} />
			</Card>
			<Segmented options={[...ERROR_WINDOWS]} value={window} onChange={setWindow} />
			{realm || branch || build ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
					<Txt variant="small">Under the list's filters:</Txt>
					{realm ? <Button title={`${realm} ✕`} small variant="secondary" onPress={() => setRealm("")} /> : null}
					{branch ? <Button title={`branch ${branch} ✕`} small variant="secondary" onPress={() => setBranch("")} /> : null}
					{build ? <Button title={`build ${shortId(build, 8)} ✕`} small variant="secondary" onPress={() => setBuild("")} /> : null}
				</View>
			) : null}
			<StatGrid>
				<Stat label="In window" value={compact(d.count)} />
				<Stat label="Players" value={compact(d.players)} />
				<Stat label="All time" value={compact(d.kind.total)} />
				<Stat label="Realm" value={d.kind.realm} />
			</StatGrid>
			<Card style={{ gap: 6 }}>
				<Txt variant="label">Occurrences</Txt>
				<DeployMarksToggle {...deploys} />
				<BarChart
					points={d.series.map((x) => ({ t: Date.parse(x.t), v: x.n }))}
					marks={chartMarks(p, deploys.marks)}
					onMarkPress={card.open}
					color="#e66767"
					timeLabel={(t) => (d.window.bucketSeconds < 86_400 ? new Date(t).toISOString().slice(5, 16).replace("T", " ") : new Date(t).toISOString().slice(5, 10))}
				/>
				{card.sheet}
			</Card>
			<Card>
				<KV label="First seen" value={`${fmtTime(d.kind.firstAt)}`} />
				<KV label="Last seen" value={`${fmtTime(d.kind.lastAt)} (${fmtAgo(d.kind.lastAt)})`} />
				<KV label="Fingerprint" value={shortId(d.kind.fp, 8)} mono />
			</Card>
			<Section title="Players who hit it">
				<KindPlayers backendId={backendId} fp={fp} params={params} />
			</Section>
			{d.byBuild.length ? (
				<Section title="By build">
					<Card>
						<ShareBars rows={d.byBuild.slice(0, 8).map((b) => ({ label: shortId(b.build, 8), value: b.n }))} />
					</Card>
				</Section>
			) : null}
			{d.byBranch.length > 1 ? (
				<Section title="By branch">
					<Card>
						<ShareBars rows={d.byBranch.map((b) => ({ label: b.branch, value: b.n }))} />
					</Card>
				</Section>
			) : null}
			{d.byJob?.length ? (
				<Section title="Servers">
					<List>
						{d.byJob.map((j) => (
							<Row key={j.job} chevron onPress={() => router.push(`/tt/${backendId}/server/${encodeURIComponent(j.job)}`)} title={<Txt variant="mono">{shortId(j.job, 6)}</Txt>} subtitle={`${j.n}× · ${j.branch} · ${shortId(j.build, 6)} · ${fmtAgo(j.lastAt)}`} />
						))}
					</List>
				</Section>
			) : null}
		</>
	);
}

/** A row of the players list: a player, or the occurrences on one side that named nobody (the web's PlayerRow). */
type PlayerRow = ({ kind: "player" } & ErrorPlayer) | { kind: "none"; realm: string; count: number; firstAt: string; lastAt: string };

function playerRows(data: ErrorPlayers): PlayerRow[] {
	return [...data.players.map((x): PlayerRow => ({ kind: "player", ...x })), ...data.withoutPlayer.map((w): PlayerRow => ({ kind: "none", ...w }))];
}

function PlayerCell({ backendId, row }: { backendId: string; row: PlayerRow }) {
	const p = useTheme();
	if (row.kind !== "player")
		return (
			<View style={{ gap: 2, alignItems: "flex-start" }}>
				<Badge label={row.realm} tone="muted" />
				<Txt variant="small" style={{ fontSize: 10 }}>
					{row.realm === "server" ? "no player named" : "no analytics id yet"}
				</Txt>
			</View>
		);
	const label = row.name ? (row.displayName && row.displayName !== row.name ? `${row.displayName} (@${row.name})` : `@${row.name}`) : shortId(row.pid, 10);
	return (
		<PlayerHover backendId={backendId} pid={row.pid} {...(row.uid !== undefined ? { uid: row.uid } : {})} {...(row.name ? { name: row.name } : {})} {...(row.displayName ? { displayName: row.displayName } : {})}>
			<View>
				<Txt variant="small" color={p.brand} numberOfLines={1} style={{ fontWeight: "600" }}>
					{label}
				</Txt>
				{row.name ? (
					<Txt variant="mono" numberOfLines={1} style={{ fontSize: 10, color: p.mutedForeground }}>
						{shortId(row.pid, 10)}
					</Txt>
				) : null}
			</View>
		</PlayerHover>
	);
}

/** The players who hit one kind in the window, under the list's filters: most occurrences first, at most 200 (web KindPlayers). */
function KindPlayers({ backendId, fp, params }: { backendId: string; fp: string; params: ErrorParams }) {
	const q = useTTQuery(backendId, ["errors", "players", fp, params], (api, s) => api.errorPlayers(fp, params, s), { refetchInterval: 30_000 });
	const columns = useMemo<DataColumn<PlayerRow>[]>(
		() => [
			{
				id: "player",
				header: "Player",
				width: 150,
				accessor: (r) => (r.kind === "player" ? (r.name ?? r.pid) : r.realm),
				searchText: (r) => (r.kind === "player" ? `${r.pid} ${r.displayName ?? ""} ${r.uid ?? ""}` : ""),
				cell: (r) => <PlayerCell backendId={backendId} row={r} />,
			},
			{
				id: "uid",
				header: "UserId",
				type: "text",
				width: 100,
				accessor: (r) => (r.kind === "player" && r.uid !== undefined ? String(r.uid) : null),
				format: (v, r) => (r.kind !== "player" ? "" : v === null || v === undefined ? "not linked" : String(v)),
				exportValue: (r) => (r.kind === "player" && r.uid !== undefined ? String(r.uid) : ""),
			},
			{ id: "count", header: "Times", title: "Occurrences in the reports that named the player (a report is one minute of one server)", type: "number", width: 66, accessor: (r) => r.count, cell: (r) => fmtInt(r.count) },
			{ id: "days", header: "Days", title: "UTC days they hit it in the window", type: "number", width: 60, accessor: (r) => (r.kind === "player" ? r.days : null), defaultHidden: true },
			{ id: "firstAt", header: "First seen", type: "date", width: 90, accessor: (r) => r.firstAt, format: (_v, r) => fmtAgo(r.firstAt) },
			{ id: "lastAt", header: "Last seen", type: "date", width: 90, accessor: (r) => r.lastAt, format: (_v, r) => fmtAgo(r.lastAt) },
			{ id: "side", header: "Side", type: "enum", width: 90, accessor: (r) => (r.kind === "player" ? r.realms.join(", ") : r.realm), defaultHidden: true },
		],
		[backendId],
	);
	return (
		<QueryState q={q} isEmpty={(d) => playerRows(d).length === 0} empty="No players hit it in this window.">
			{(d) => (
				<>
					<DataTable
						id="errors-players"
						label="Players who hit this error"
						columns={columns}
						data={playerRows(d)}
						rowId={(r) => (r.kind === "player" ? `p:${r.pid}` : `none:${r.realm}`)}
						defaultSort={[{ id: "count", desc: true }]}
						density="compact"
					/>
					<Note>
						{d.more ? `The ${fmtInt(d.players.length)} who hit it most, of ${fmtInt(d.total)} players. ` : ""}
						Times counts the occurrences in each minute's report that named the player, so players who hit it in the same minute on one server share that report.
					</Note>
				</>
			)}
		</QueryState>
	);
}
