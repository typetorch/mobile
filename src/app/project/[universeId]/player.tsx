/**
 * Player lookup (`?user=<name or id>` to open on someone): ban status here, which passes and badges they have, one
 * item check, a subscription's state, their Open Cloud profile and past usernames. Works without a key for the public
 * parts; the key-only parts name the scope they need.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { PlayerLookup } from "@/features/project/monetization/PlayerLookup";
import { ToolScreen } from "@/features/project/tool";
import { useAccounts } from "@/store/accounts";

export default function PlayerScreen() {
	const queryClient = useQueryClient();
	const { user } = useLocalSearchParams<{ user?: string }>();
	const { hasKey } = useAccounts();
	return (
		<ToolScreen
			title="Player lookup"
			scopes={[]}
			onRefresh={() => {
				queryClient.refetchQueries({ queryKey: ["player"], type: "active" });
				queryClient.refetchQueries({ queryKey: ["oc", "bans"], type: "active" });
			}}
		>
			{({ universeId, cloud, can }) => <PlayerLookup universeId={universeId} cloud={cloud} can={can} hasKey={hasKey} initial={user} />}
		</ToolScreen>
	);
}
