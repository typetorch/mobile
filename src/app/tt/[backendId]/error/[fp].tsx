/** One error kind: its stack, occurrences over the window, and where it hits (builds, branches, realms, servers). */
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";

import { BarChart, ShareBars } from "@/charts/LineChart";
import { Button, Card, ErrorState, KV, List, Row, Section, Segmented, Skeleton, Stat, StatGrid, Txt } from "@/components/ui";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { compact, fmtAgo, fmtTime, shortId } from "@/lib/format";

const WINDOWS = [
	{ value: "24h", label: "24 h" },
	{ value: "7d", label: "7 d" },
	{ value: "30d", label: "30 d" },
];

export default function ErrorScreen() {
	const { fp, window } = useLocalSearchParams<{ fp: string; window?: string }>();
	const id = decodeURIComponent(String(fp ?? ""));
	return <TTScreen title="Error">{({ backendId }) => <ErrorKindView backendId={backendId} fp={id} initialWindow={window && ["24h", "7d", "30d"].includes(window) ? window : "24h"} />}</TTScreen>;
}

function ErrorKindView({ backendId, fp, initialWindow }: { backendId: string; fp: string; initialWindow: string }) {
	const [window, setWindow] = useState(initialWindow);
	const [copied, setCopied] = useState(false);
	const q = useTTQuery(backendId, ["error", fp, window], (api, s) => api.errorKind(fp, { window }, s));
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
			<Segmented options={WINDOWS} value={window} onChange={setWindow} />
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
