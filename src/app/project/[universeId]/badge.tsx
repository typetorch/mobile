/**
 * One badge (`?id=<badgeId>`, public badges v1) or a new one (`?id=new`). Editing needs legacy-universe.badge:write;
 * creating needs legacy-universe.badge:manage-and-spend-robux and may spend Robux (asks with the cost first); replacing
 * the icon needs legacy-badge:manage.
 */
import { useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/ui";
import { BadgeEditor } from "@/features/project/monetization/BadgeEditor";
import { useItemIdParam } from "@/features/project/monetization/shared";
import { ToolScreen } from "@/features/project/tool";

export default function BadgeScreen() {
	const queryClient = useQueryClient();
	const id = useItemIdParam();
	return (
		<ToolScreen title={id === "new" ? "New badge" : "Badge"} scopes={[]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["monetization", "badge"], type: "active" })}>
			{({ universeId, cloud, can }) =>
				id === null ? (
					<EmptyState icon="alert-circle-outline" title="Bad badge link" />
				) : (
					<BadgeEditor
						universeId={universeId}
						cloud={cloud}
						id={id}
						canCreate={can("legacy-universe.badge:manage-and-spend-robux")}
						canWrite={can("legacy-universe.badge:write") || can("legacy-universe.badge:manage-and-spend-robux")}
						canIcon={can("legacy-badge:manage")}
					/>
				)
			}
		</ToolScreen>
	);
}
