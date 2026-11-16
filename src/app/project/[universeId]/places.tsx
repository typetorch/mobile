/**
 * Every place of the experience (develop v1's public list; the root place from Open Cloud when the list is empty, e.g.
 * a private experience). Each opens the place screen: details, edit, version history, notes, place bans.
 * Open Cloud has no create / delete for places (Studio or Creator Hub only).
 */
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { Badge, EmptyState, List, Row, Section, SkeletonList, Txt } from "@/components/ui";
import { useUniversePlaces } from "@/features/project/configure/shared";
import { CloudError } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { useAccounts } from "@/store/accounts";

export default function PlacesScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen
			title="Places"
			scopes={[]}
			onRefresh={() => Promise.all([queryClient.refetchQueries({ queryKey: ["places"], type: "active" }), queryClient.refetchQueries({ queryKey: ["oc", "universe"], type: "active" })])}
		>
			{({ universeId }) => <Places universeId={universeId} />}
		</ToolScreen>
	);
}

function Places({ universeId }: { universeId: number }) {
	const { cloud } = useAccounts();
	const { places, rootId, loading, error, refetch } = useUniversePlaces(universeId, cloud);
	if (loading) return <SkeletonList rows={4} />;
	if (error) return <CloudError error={error} what="Places" onRetry={refetch} />;
	if (!places.length) return <EmptyState icon="map-outline" title="No places listed" body="Roblox didn't list places for this experience. Add an Open Cloud key to find the start place." />;
	return (
		<>
			<Section title={`Places (${places.length})`}>
				<List>
					{places.map((pl) => (
						<Row
							key={pl.id}
							chevron
							title={pl.name}
							subtitle={`${pl.id}${pl.id === rootId ? " · start place" : ""}`}
							right={pl.id === rootId ? <Badge label="root" tone="brand" /> : undefined}
							onPress={() => router.push(`/project/${universeId}/place?placeId=${pl.id}`)}
						/>
					))}
				</List>
			</Section>
			<Txt variant="small">New places are added in Studio or on Creator Hub; Open Cloud can't create or delete them.</Txt>
		</>
	);
}
