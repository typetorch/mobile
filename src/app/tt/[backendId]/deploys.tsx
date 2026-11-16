/** Deploys: the release history, newest first, a page at a time, all branches or one (GET /v1/fleet/deploys?branch=). */
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";

import type { DeployRecord } from "@/api/tt/deploys";
import { OUTCOME_STYLE, startedByText } from "@/api/tt/deploys";
import { Badge, Button, Chips, EmptyState, ErrorState, List, Row, Section, SkeletonList, Txt } from "@/components/ui";
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
	const [branch, setBranch] = useState("");
	const q = useInfiniteQuery({
		queryKey: ["tt", backendId, "deploys", "pages", branch],
		enabled: !!api && !account?.signedOut,
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam, signal }) => api!.fleetDeploys({ limit: 30, ...(branch ? { branch } : {}), ...(pageParam ? { before: pageParam } : {}) }, signal),
		getNextPageParam: (last) => last.next ?? undefined,
	});
	// The branches seen on any loaded page (kept while one is picked, so the chips stay).
	const seen = useRef(new Set<string>());
	for (const page of q.data?.pages ?? []) for (const d of page.deploys) if (d.branch) seen.current.add(d.branch);
	const branches = [...seen.current].sort();
	const chips =
		branches.length > 1 || branch ? (
			<View>
				<Chips options={[{ value: "", label: "All branches" }, ...branches.map((b) => ({ value: b, label: b }))]} value={branch} onChange={setBranch} />
			</View>
		) : null;
	if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data) return <SkeletonList rows={8} />;
	const deploys = q.data.pages.flatMap((p) => p.deploys);
	if (!deploys.length)
		return (
			<>
				{chips}
				<EmptyState icon="rocket-outline" title={branch ? `No deploys on ${branch}` : "No deploys yet"} body="Releases made with the TypeTorch CLI show up here with their rollout outcome." />
			</>
		);
	return (
		<Section title={branch ? `Releases · ${branch}` : "Releases"}>
			{chips}
			<List>
				{deploys.map((d) => (
					<DeployRow key={d.seq} d={d} backendId={backendId} />
				))}
			</List>
			{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : <Txt variant="small" style={{ textAlign: "center" }}>That's all of them.</Txt>}
		</Section>
	);
}
