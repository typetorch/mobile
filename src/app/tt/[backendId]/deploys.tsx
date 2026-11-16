/** Deploys: the release history, newest first, a page at a time (GET /v1/fleet/deploys), one branch or all (`branch`). */
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";

import type { DeployRecord } from "@/api/tt/deploys";
import { DEPLOY_OUTCOMES_ORDER, OUTCOME_STYLE, startedByText } from "@/api/tt/deploys";
import { Badge, Button, EmptyState, ErrorState, Field, Section, SkeletonList, Txt } from "@/components/ui";
import { outcomeTone } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam } from "@/features/typetorch/view-link";
import { fmtAgo, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";

export default function DeploysScreen() {
	return <TTScreen title="Deploys">{({ backendId }) => <Deploys backendId={backendId} />}</TTScreen>;
}

const DEPLOY_COLUMNS: DataColumn<DeployRecord>[] = [
	{ id: "seq", header: "#", type: "number", width: 56, accessor: (d) => d.seq, format: (_v, d) => `#${d.seq}` },
	{ id: "kind", header: "Kind", type: "enum", width: 80, accessor: (d) => d.kind },
	{ id: "branch", header: "Branch", type: "enum", width: 80, accessor: (d) => d.branch },
	{ id: "outcome", header: "Outcome", type: "enum", width: 100, order: DEPLOY_OUTCOMES_ORDER, accessor: (d) => d.outcome, format: (v) => OUTCOME_STYLE[v as DeployRecord["outcome"]]?.label ?? String(v), cell: (d) => <Badge label={OUTCOME_STYLE[d.outcome]?.label ?? d.outcome} tone={outcomeTone(d.outcome)} /> },
	{ id: "at", header: "When", type: "date", width: 96, accessor: (d) => d.at, format: (_v, d) => fmtAgo(d.at), exportValue: (d) => new Date(d.at).toISOString() },
	{ id: "ok", header: "OK / reported", type: "number", width: 90, accessor: (d) => (d.reported ? d.ok / d.reported : null), format: (_v, d) => `${d.ok}/${d.reported}` },
	{ id: "artifact", header: "Build", width: 100, mono: true, accessor: (d) => d.artifact, format: (_v, d) => shortId(d.artifact, 8) },
	{ id: "message", header: "Message", width: 200, accessor: (d) => d.message, filter: "text" },
	{ id: "startedBy", header: "Started by", type: "enum", width: 120, accessor: (d) => startedByText(d) },
	{ id: "errorKinds", header: "Error kinds", type: "number", width: 76, accessor: (d) => d.errorKinds, defaultHidden: true },
	{ id: "failed", header: "Failed", type: "number", width: 64, accessor: (d) => d.failed, defaultHidden: true },
	{ id: "stuck", header: "Stuck", type: "number", width: 60, accessor: (d) => d.stuck, defaultHidden: true },
];

function Deploys({ backendId }: { backendId: string }) {
	const { api, account } = useBackend(backendId);
	const [branch, setBranch] = usePageParam("branch");
	const [text, setText] = useState(branch);
	useEffect(() => setText(branch), [branch]);
	const q = useInfiniteQuery({
		queryKey: ["tt", backendId, "deploys", "pages", branch],
		enabled: !!api && !account?.signedOut,
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam, signal }) => api!.fleetDeploys({ limit: 50, ...(branch ? { branch } : {}), ...(pageParam ? { before: pageParam } : {}) }, signal),
		getNextPageParam: (last) => last.next ?? undefined,
	});
	const filter = (
		<Field
			label="Branch"
			value={text}
			placeholder="any branch"
			autoCapitalize="none"
			autoCorrect={false}
			onChangeText={(t) => {
				setText(t);
				if (!t) setBranch("");
			}}
			onSubmitEditing={() => setBranch(text.trim())}
			onBlur={() => setBranch(text.trim())}
			returnKeyType="done"
		/>
	);
	if (q.error) return (
		<>
			{filter}
			<ErrorState error={q.error} onRetry={() => q.refetch()} />
		</>
	);
	if (!q.data) return (
		<>
			{filter}
			<SkeletonList rows={8} />
		</>
	);
	const deploys = q.data.pages.flatMap((p) => p.deploys);
	if (!deploys.length)
		return (
			<>
				{filter}
				<EmptyState icon="rocket-outline" title={`No deploy yet${branch ? ` on ${branch}` : ""}`} body="A release shows up when the CLI posts it or its first server reports it." />
			</>
		);
	return (
		<Section title="Releases">
			{filter}
			<DataTable id="deploys" label="Releases" columns={DEPLOY_COLUMNS} data={deploys} rowId={(d) => String(d.seq)} onRowPress={(d) => router.push(`/tt/${backendId}/deploy/${d.seq}`)} defaultSort={[{ id: "seq", desc: true }]} density="compact" pageSize={50} />
			{q.hasNextPage ? <Button title="Load more" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : <Txt variant="small" style={{ textAlign: "center" }}>That's all of them.</Txt>}
		</Section>
	);
}
