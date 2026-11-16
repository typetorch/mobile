/** Deploys: the release history, newest first, a page at a time (GET /v1/fleet/deploys). */
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";

import type { DeployRecord } from "@/api/tt/deploys";
import { OUTCOME_STYLE, startedByText } from "@/api/tt/deploys";
import { Badge, Button, EmptyState, ErrorState, List, Row, Section, SkeletonList, Txt } from "@/components/ui";
import { outcomeTone } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtAgo, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";

export default function DeploysScreen() {
	return <TTScreen title="Deploys">{({ backendId }) => <Deploys backendId={backendId} />}</TTScreen>;
}

function DeployRow({ d, backendId }: { d: DeployRecord; backendId: string }) {
	return (
		<Row
			chevron
			onPress={() => router.push(`/tt/${backendId}/deploy/${d.seq}`)}
			title={`#${d.seq} ${d.kind}${d.branch ? ` · ${d.branch}` : ""}`}
			subtitle={`${d.message ? `${d.message} · ` : ""}${shortId(d.artifact, 6)} · ${startedByText(d)} · ${fmtAgo(d.at)} · ${d.ok}/${d.reported} ok`}
			right={<Badge label={OUTCOME_STYLE[d.outcome]?.label ?? d.outcome} tone={outcomeTone(d.outcome)} />}
		/>
	);
}

function Deploys({ backendId }: { backendId: string }) {
	const { api, account } = useBackend(backendId);
	const q = useInfiniteQuery({
		queryKey: ["tt", backendId, "deploys", "pages"],
		enabled: !!api && !account?.signedOut,
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam, signal }) => api!.fleetDeploys({ limit: 30, ...(pageParam ? { before: pageParam } : {}) }, signal),
		getNextPageParam: (last) => last.next ?? undefined,
	});
	if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data) return <SkeletonList rows={8} />;
	const deploys = q.data.pages.flatMap((p) => p.deploys);
	if (!deploys.length) return <EmptyState icon="rocket-outline" title="No deploys yet" body="Releases made with the TypeTorch CLI show up here with their rollout outcome." />;
	return (
		<Section title="Releases">
			<List>
				{deploys.map((d) => (
					<DeployRow key={d.seq} d={d} backendId={backendId} />
				))}
			</List>
			{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : <Txt variant="small" style={{ textAlign: "center" }}>That's all of them.</Txt>}
		</Section>
	);
}
