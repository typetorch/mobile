/** The frame of an Open Cloud tool screen: the universe from the route, the scope check, the title. */
import { Stack, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";

import { OpenCloud } from "@/api/opencloud";
import { Screen, ScopeNotice } from "@/components/ui";
import { missingScopes } from "@/lib/features";
import { useAccounts } from "@/store/accounts";

const NO_KEY = new OpenCloud("");

export function useUniverseParam(): number {
	const { universeId } = useLocalSearchParams<{ universeId: string }>();
	return Number(universeId);
}

export function ToolScreen({
	title,
	scopes,
	children,
	refreshing,
	onRefresh,
}: {
	title: string;
	scopes: string[];
	children: (ctx: { universeId: number; cloud: OpenCloud; can: (scope: string) => boolean }) => ReactNode;
	refreshing?: boolean;
	onRefresh?: () => void;
}) {
	const universeId = useUniverseParam();
	const { cloud, keyInfo } = useAccounts();
	const missing = missingScopes(keyInfo, scopes, universeId);
	return (
		<Screen refreshing={refreshing} onRefresh={onRefresh}>
			<Stack.Screen options={{ title }} />
			{/* Screens with no required scope (public data) also open without a key; their key-only parts check can(). */}
			{(!cloud && scopes.length) || missing.length ? (
				<ScopeNotice what={title} scopes={cloud ? missing : scopes} />
			) : (
				children({ universeId, cloud: cloud ?? NO_KEY, can: (scope) => !!cloud && missingScopes(keyInfo, [scope], universeId).length === 0 })
			)}
		</Screen>
	);
}
