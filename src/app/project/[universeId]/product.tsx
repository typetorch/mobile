/**
 * One developer product (`?id=<productId>`) or a new one (`?id=new`): details, price, sale state, store page, price
 * optimization and regional pricing. Reading needs developer-product:read, creating and editing developer-product:write.
 */
import { useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/ui";
import { ItemEditor } from "@/features/project/monetization/ItemEditor";
import { useItemIdParam } from "@/features/project/monetization/shared";
import { ToolScreen } from "@/features/project/tool";

export default function ProductScreen() {
	const queryClient = useQueryClient();
	const id = useItemIdParam();
	return (
		<ToolScreen title={id === "new" ? "New developer product" : "Developer product"} scopes={[]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["monetization", "product"], type: "active" })}>
			{({ universeId, cloud, can }) =>
				id === null ? (
					<EmptyState icon="alert-circle-outline" title="Bad developer product link" />
				) : (
					<ItemEditor kind="product" universeId={universeId} cloud={cloud} id={id} canRead={can("developer-product:read")} canWrite={can("developer-product:write")} />
				)
			}
		</ToolScreen>
	);
}
