/**
 * Activity history for a GROUP-owned experience: the group's audit log (legacy-groups, newest first) filtered to the
 * actions that concern experiences, and optionally to entries that mention this experience or one of its places.
 * User-owned experiences have no activity-history API.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Chips, EmptyState, List, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { EXPERIENCE_ACTIONS, getUniverse, groupAuditLog, type AuditEntry } from "@/features/project/api/configure";
import { useUniversePlaces } from "@/features/project/configure/shared";
import { CloudError } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtTime } from "@/lib/format";

export default function ActivityScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Activity history" scopes={["legacy-group:manage"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "audit"], type: "active" })}>
			{({ universeId, cloud }) => <Activity universeId={universeId} cloud={cloud} />}
		</ToolScreen>
	);
}

/** The audit description as short "Key: value" text. */
function describe(d: unknown): string {
	if (d === null || d === undefined) return "";
	if (typeof d !== "object") return String(d);
	return Object.entries(d as Record<string, unknown>)
		.filter(([, v]) => v !== null && v !== undefined && v !== "")
		.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
		.join(" · ");
}

function Activity({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const universe = useQuery({ queryKey: ["oc", "universe", universeId], queryFn: () => getUniverse(cloud, universeId), retry: false, staleTime: 300_000 });
	const groupId = Number((universe.data?.group ?? "").replace(/^groups\//, "")) || null;
	if (universe.error) return <CloudError error={universe.error} what="Activity history" onRetry={() => universe.refetch()} />;
	if (!universe.data) return <SkeletonList rows={4} />;
	if (!groupId) return <EmptyState icon="time-outline" title="Only for group experiences" body="Roblox keeps an activity log for group-owned experiences (the group's audit log). User-owned experiences have no activity API." />;
	return <AuditLog universeId={universeId} groupId={groupId} cloud={cloud} name={universe.data.displayName} />;
}

function AuditLog({ universeId, groupId, cloud, name }: { universeId: number; groupId: number; cloud: OpenCloud; name: string }) {
	const [action, setAction] = useState<string>("");
	const [onlyThis, setOnlyThis] = useState(true);
	const { places } = useUniversePlaces(universeId, cloud);
	const log = useInfiniteQuery({
		queryKey: ["oc", "audit", groupId, action],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => groupAuditLog(cloud, groupId, { actionType: action || undefined, cursor: pageParam }),
		getNextPageParam: (last) => last.nextPageCursor || undefined,
		retry: false,
	});
	const marks = [String(universeId), ...places.map((pl) => String(pl.id)), name].filter(Boolean);
	const all = log.data?.pages.flatMap((pg) => pg.data ?? []) ?? [];
	const relevant = (e: AuditEntry) => (EXPERIENCE_ACTIONS as readonly string[]).includes(e.actionType);
	const mentions = (e: AuditEntry) => {
		const text = JSON.stringify(e.description ?? "");
		return marks.some((m) => text.includes(m));
	};
	const rows = all.filter((e) => (action ? true : relevant(e)) && (!onlyThis || mentions(e)));

	return (
		<>
			<Chips options={[{ value: "", label: "All experience actions" }, ...EXPERIENCE_ACTIONS.map((a) => ({ value: a as string, label: a.replace(/([a-z])([A-Z])/g, "$1 $2") }))]} value={action} onChange={setAction} />
			<Segmented
				options={[
					{ value: 1, label: "This experience" },
					{ value: 0, label: "Whole group" },
				]}
				value={onlyThis ? 1 : 0}
				onChange={(v) => setOnlyThis(v === 1)}
			/>
			{log.error ? (
				<CloudError error={log.error} what="The group audit log" onRetry={() => log.refetch()} />
			) : !log.data ? (
				<SkeletonList rows={5} />
			) : (
				<Section title={`Group ${groupId}${rows.length ? ` · ${rows.length} shown of ${all.length} loaded` : ""}`}>
					{rows.length ? (
						<List>
							{rows.map((e, i) => (
								<Row
									key={`${e.created}-${i}`}
									left={<Badge label={e.actionType.replace(/([a-z])([A-Z])/g, "$1 $2")} tone="brand" />}
									title={e.actor?.user ? `@${e.actor.user.username ?? e.actor.user.userId}${e.actor.role?.name ? ` · ${e.actor.role.name}` : ""}` : "Unknown"}
									subtitle={`${fmtTime(e.created)} (${fmtAgo(e.created)})${describe(e.description) ? `\n${describe(e.description)}` : ""}`}
									numberOfLines={4}
								/>
							))}
						</List>
					) : (
						<Txt variant="muted">Nothing on the loaded pages{onlyThis ? " mentions this experience" : ""}. Load more or widen the filter.</Txt>
					)}
					{log.hasNextPage ? <Button title="Load more" small loading={log.isFetchingNextPage} onPress={() => log.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
					<Txt variant="small">Your key's owner needs audit-log rights in the group. Entries carry no universe id, so “This experience” matches its id, place ids and name.</Txt>
				</Section>
			)}
		</>
	);
}
