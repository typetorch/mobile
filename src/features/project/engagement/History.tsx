/** Translation history of a name or description in one language (POST name-description translation-history, newest first). */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Button, List, Row, SkeletonList, Txt } from "@/components/ui";
import { nameDescriptionHistory, type HistoryContentType } from "@/features/project/api/engagement";
import { CloudError } from "@/features/project/CloudError";
import { fmtTime } from "@/lib/format";

export function TranslationHistory({ cloud, contentId, contentType, languageCode, label }: { cloud: OpenCloud; contentId: number; contentType: HistoryContentType; languageCode: string; label: string }) {
	const [open, setOpen] = useState(false);
	const q = useInfiniteQuery({
		queryKey: ["oc", "i18n-history", contentId, contentType, languageCode],
		enabled: open,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => nameDescriptionHistory(cloud, { contentId, contentType, languageCode, cursor: pageParam, count: 25 }),
		getNextPageParam: (last) => ((last.history?.length ?? 0) >= 25 && last.lastEvaluatedId ? last.lastEvaluatedId : undefined),
		retry: false,
	});
	if (!open) return <Button title={`${label} history`} icon="time-outline" small variant="ghost" onPress={() => setOpen(true)} style={{ alignSelf: "flex-start" }} />;
	const rows = q.data?.pages.flatMap((p) => p.history ?? []) ?? [];
	return (
		<>
			<Txt variant="label">{label} history</Txt>
			{q.error ? (
				<CloudError error={q.error} what="Translation history" onRetry={() => q.refetch()} />
			) : !q.data ? (
				<SkeletonList rows={2} />
			) : rows.length ? (
				<List>
					{rows.map((h, i) => (
						<Row key={i} title={h.translationText || "(empty)"} subtitle={`${fmtTime(h.created)} · ${h.translator?.agentType === "Automation" ? "automatic" : `user ${h.translator?.id ?? "?"}`}`} numberOfLines={3} />
					))}
				</List>
			) : (
				<Txt variant="muted">No history.</Txt>
			)}
			{q.hasNextPage ? <Button title="Older" small loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
		</>
	);
}
