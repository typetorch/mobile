/**
 * One game pass (`?id=<gamePassId>`) or a new one (`?id=new`): details, price, sale state, price optimization and
 * regional pricing. Reading needs game-pass:read, creating and editing game-pass:write.
 */
import { useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/ui";
import { ItemEditor } from "@/features/project/monetization/ItemEditor";
import { useItemIdParam } from "@/features/project/monetization/shared";
import { ToolScreen } from "@/features/project/tool";

export default function PassScreen() {
	const queryClient = useQueryClient();
	const id = useItemIdParam();
	return (
		<ToolScreen title={id === "new" ? "New game pass" : "Game pass"} scopes={[]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["monetization", "pass"], type: "active" })}>
			{({ universeId, cloud, can }) =>
				id === null ? (
					<EmptyState icon="alert-circle-outline" title="Bad game pass link" />
				) : (
					<ItemEditor kind="pass" universeId={universeId} cloud={cloud} id={id} canRead={can("game-pass:read")} canWrite={can("game-pass:write")} />
				)
			}
		</ToolScreen>
	);
}
