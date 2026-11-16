/**
 * One error kind: its stack, occurrences over the window (the list's: 1 h to 30 d, with its branch / build filters), the
 * players who hit it, and where it hits (builds, branches, realms, servers).
 */
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";

import { BarChart, ShareBars } from "@/charts/LineChart";
import type { ErrorParams } from "@/api/backend";
import { Button, Card, ErrorState, KV, List, Row, Section, Segmented, Skeleton, SkeletonList, Stat, StatGrid, Txt } from "@/components/ui";
import { NamedPlayerRow } from "@/features/typetorch/bits";
import { ERROR_WINDOWS, errorWindowOf, useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { compact, fmtAgo, fmtInt, fmtTime, shortId } from "@/lib/format";

export default function ErrorScreen() {
	const { fp, window, branch, build } = useLocalSearchParams<{ fp: string; window?: string; branch?: string; build?: string }>();
	const id = decodeURIComponent(String(fp ?? ""));
	const filters: ErrorParams = { ...(branch ? { branch: String(branch) } : {}), ...(build ? { build: String(build) } : {}) };
	return <TTScreen title="Error">{({ backendId }) => <ErrorKindView backendId={backendId} fp={id} initialWindow={errorWindowOf(window)} filters={filters} />}</TTScreen>;
}

function ErrorKindView({ backendId, fp, initialWindow, filters }: { backendId: string; fp: string; initialWindow: string; filters: ErrorParams }) {
	const [window, setWindow] = useState(initialWindow);
	const [copied, setCopied] = useState(false);
	const params: ErrorParams = { window, ...filters };
	const q = useTTQuery(backendId, ["error", fp, params], (api, s) => api.errorKind(fp, params, s));
	const players = useTTQuery(backendId, ["error", fp, "players", params], (api, s) => api.errorPlayers(fp, params, s), { staleTime: 30_000 });
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
			</Card>
			<Segmented options={ERROR_WINDOWS} value={window} onChange={setWindow} />
			{filters.branch || filters.build ? (
				<Txt variant="small">
					Only {[filters.branch ? `branch ${filters.branch}` : null, filters.build ? `build ${shortId(filters.build, 8)}` : null].filter(Boolean).join(", ")} (from the list's filters).
				</Txt>
			) : null}
			<StatGrid>
				<Stat label="In window" value={compact(d.count)} />
				<Stat label="Players" value={compact(d.players)} />
				<Stat label="All time" value={compact(d.kind.total)} />
				<Stat label="Realm" value={d.kind.realm} />
			</StatGrid>
			<Card style={{ gap: 6 }}>
				<Txt variant="label">Occurrences</Txt>
				<BarChart
					points={d.series.map((x) => ({ t: Date.parse(x.t), v: x.n }))}
					color="#e66767"
					timeLabel={(t) => (d.window.bucketSeconds < 86_400 ? new Date(t).toISOString().slice(5, 16).replace("T", " ") : new Date(t).toISOString().slice(5, 10))}
				/>
			</Card>
			<Card>
				<KV label="First seen" value={`${fmtTime(d.kind.firstAt)}`} />
				<KV label="Last seen" value={`${fmtTime(d.kind.lastAt)} (${fmtAgo(d.kind.lastAt)})`} />
				<KV label="Fingerprint" value={shortId(d.kind.fp, 8)} mono />
			</Card>
			<Section title="Players who hit it">
				{players.error ? (
					<Txt variant="small">{players.error.message}</Txt>
				) : !players.data ? (
					<SkeletonList rows={3} />
				) : players.data.players.length || players.data.withoutPlayer.length ? (
					<>
						{players.data.players.length ? (
							<List>
								{players.data.players.slice(0, 50).map((pl) => (
									<NamedPlayerRow
										key={pl.pid}
										backendId={backendId}
										row={pl}
										detail={`${compact(pl.count)}× · ${pl.days} d · ${pl.realms.join(", ")} · last ${fmtAgo(pl.lastAt)}`}
									/>
								))}
							</List>
						) : null}
						{players.data.withoutPlayer.map((w) => (
							<Txt key={w.realm} variant="small">
								{compact(w.count)}× on the {w.realm} in reports that named no player (last {fmtAgo(w.lastAt)}).
							</Txt>
						))}
						<Txt variant="small">
							{players.data.more || players.data.players.length > 50 ? `The ${fmtInt(Math.min(50, players.data.players.length))} who hit it most, of ${fmtInt(players.data.total)} players. ` : ""}
							Times counts the occurrences in each minute's report that named the player, so players who hit it in the same minute on one server share that report.
						</Txt>
					</>
				) : (
					<Txt variant="muted">No players hit it in this window.</Txt>
				)}
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
