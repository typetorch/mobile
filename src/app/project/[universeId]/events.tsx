/**
 * Events (virtual events v3): upcoming and live events, or past ones, with time, visibility, featuring and
 * categories. Tap one to view, edit or delete it; "New event" opens the create form (universe.event:write).
 */
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, EmptyState, List, Row, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { categoryLabel, ENG_SCOPES, listEvents, type GameEvent } from "@/features/project/api/engagement";
import { CloudError } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtTime } from "@/lib/format";

export default function EventsScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Events" scopes={[ENG_SCOPES.eventRead]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "events"], type: "active" })}>
			{({ universeId, cloud, can }) => <Events universeId={universeId} cloud={cloud} canWrite={can(ENG_SCOPES.eventWrite)} />}
		</ToolScreen>
	);
}

function eventState(e: GameEvent): { label: string; tone: "good" | "warning" | "muted" } {
	const now = Date.now();
	const start = e.startTime ? Date.parse(e.startTime) : NaN;
	const end = e.endTime ? Date.parse(e.endTime) : NaN;
	if (end < now) return { label: "ended", tone: "muted" };
	if (start <= now) return { label: "live", tone: "good" };
	return { label: "upcoming", tone: "warning" };
}

function Events({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
	const list = useInfiniteQuery({
		queryKey: ["oc", "events", universeId, when],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => listEvents(cloud, universeId, { when, pageToken: pageParam }),
		getNextPageParam: (last) => last.nextPageToken || undefined,
		retry: false,
	});
	const events = list.data?.pages.flatMap((p) => p.gameEvents ?? []) ?? [];

	return (
		<>
			{canWrite ? (
				<Button title="New event" icon="add" variant="brand" onPress={() => router.push(`/project/${universeId}/event?new=1`)} style={{ alignSelf: "flex-start" }} />
			) : (
				<Txt variant="small">Read only: add {ENG_SCOPES.eventWrite} to create, edit and delete events.</Txt>
			)}
			<Segmented options={[{ value: "upcoming", label: "Upcoming & live" }, { value: "past", label: "Past" }]} value={when} onChange={setWhen} />
			{list.error ? (
				<CloudError error={list.error} what="Events" onRetry={() => list.refetch()} />
			) : !list.data ? (
				<SkeletonList rows={4} />
			) : events.length ? (
				<Section>
					<List>
						{events.map((e) => {
							const s = eventState(e);
							return (
								<Row
									key={e.id}
									title={e.title || e.displayTitle || `Event ${e.id}`}
									subtitle={`${fmtTime(e.startTime)} → ${fmtTime(e.endTime)}${e.subtitle ? ` · ${e.subtitle}` : ""}${e.categories?.length ? ` · ${e.categories.map((c) => categoryLabel(c.category)).join(", ")}` : ""}`}
									numberOfLines={2}
									right={<Badge label={e.visibility === "private" ? `${s.label}, private` : s.label} tone={s.tone} />}
									chevron
									onPress={() => router.push(`/project/${universeId}/event?id=${encodeURIComponent(e.id)}`)}
								/>
							);
						})}
					</List>
					{list.hasNextPage ? <Button title="Load more" small loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</Section>
			) : (
				<EmptyState icon="calendar-outline" title={when === "past" ? "No past events" : "No upcoming events"} body="Events made here or on Creator Hub show up here (times in UTC)." />
			)}
		</>
	);
}
