/**
 * One error (by message hash): the message, where it happens (platform / OS), severity and source, when and in which
 * place version it was first seen, and the stack trace when Roblox has one; copy buttons for both.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, EmptyState, KV, Section, Skeleton, Txt } from "@/components/ui";
import { ERRORS_READ, logDetails } from "@/features/project/api/analytics-tools";
import { logSeverityTone } from "@/features/project/analytics-tools/errors-model";
import { CloudError } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtTime } from "@/lib/format";

export default function ErrorScreen() {
	const { id, placeId, days } = useLocalSearchParams<{ id: string; placeId?: string; days?: string }>();
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Error" scopes={[ERRORS_READ]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "errors"], type: "active" })}>
			{({ universeId, cloud }) => (
				<ErrorDetail universeId={universeId} cloud={cloud} hash={String(id ?? "")} placeId={placeId && /^\d+$/.test(placeId) ? Number(placeId) : undefined} days={Math.min(28, Math.max(1, Number(days) || 7))} />
			)}
		</ToolScreen>
	);
}

const DAY = 86_400_000;

function ErrorDetail({ universeId, cloud, hash, placeId, days }: { universeId: number; cloud: OpenCloud; hash: string; placeId?: number; days: number }) {
	const q = useQuery({
		queryKey: ["oc", "errors", universeId, "one", hash, placeId, days],
		enabled: !!hash,
		queryFn: () => {
			const end = Date.now();
			return logDetails(cloud, universeId, { messageHashIds: [hash], placeId, startTime: new Date(end - days * DAY).toISOString(), endTime: new Date(end).toISOString() });
		},
	});
	if (q.error) return <CloudError error={q.error} what="This error" onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton height={200} />;
	const rows = q.data.values ?? [];
	if (!rows.length) return <EmptyState icon="bug-outline" title="Not found" body={`No log with this hash in the last ${days} days.`} />;
	const first = rows[0]!;
	const stack = rows.find((r) => r.stacktrace)?.stacktrace ?? null;
	return (
		<>
			<Card style={{ gap: 8 }}>
				<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
					<Badge label={first.logSeverity || "log"} tone={logSeverityTone(first.logSeverity)} />
					{first.logSource ? <Badge label={first.logSource} /> : null}
				</View>
				<Txt variant="mono" selectable>
					{first.message || "(no message)"}
				</Txt>
				<Button title="Copy message" icon="copy-outline" small onPress={() => void Clipboard.setStringAsync(first.message ?? "")} style={{ alignSelf: "flex-start" }} />
			</Card>

			<Section title="Stack trace">
				<Card style={{ gap: 8 }}>
					{stack ? (
						<>
							<Txt variant="mono" selectable>
								{stack}
							</Txt>
							<Button title="Copy stack trace" icon="copy-outline" small onPress={() => void Clipboard.setStringAsync(stack)} style={{ alignSelf: "flex-start" }} />
						</>
					) : (
						<Txt variant="muted">Roblox has no stack trace for this error.</Txt>
					)}
				</Card>
			</Section>

			<Section title={`Seen on (${rows.length})`}>
				<Card>
					{rows.map((r, i) => (
						<KV key={i} label={[r.platform, r.os].filter(Boolean).join(" / ") || "unknown"} value={[r.firstSeenUtc ? `first ${fmtTime(r.firstSeenUtc)}` : "", r.firstSeenPlaceVersion ? `v${r.firstSeenPlaceVersion}` : ""].filter(Boolean).join(" · ") || "–"} />
					))}
				</Card>
			</Section>

			<Section title="Details">
				<Card>
					<KV label="Message hash" value={hash} mono />
					{placeId ? <KV label="Place" value={String(placeId)} mono /> : null}
					<Txt variant="small">First-seen place versions appear only when a place ID was given in the search.</Txt>
				</Card>
			</Section>
		</>
	);
}
