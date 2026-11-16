/** The frame of every TypeTorch screen: the title, pull to refresh (refetches this backend's queries), missing backend. */
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";

import { Button, EmptyState, Screen } from "@/components/ui";
import { useBackend, type BackendAccount } from "@/store/accounts";
import type { Api } from "@/api/backend";

import { SignedOutNotice } from "./components";

export function useBackendParam(): string {
	const { backendId } = useLocalSearchParams<{ backendId: string }>();
	return String(backendId ?? "");
}

export function TTScreen({
	title,
	children,
	refreshKeys,
	scroll = true,
	notice = true,
}: {
	title: string | ((account: BackendAccount) => string);
	children: (ctx: { account: BackendAccount; api: Api; backendId: string }) => ReactNode;
	/** Which of this backend's queries a pull refreshes (default: all of them). */
	refreshKeys?: readonly unknown[];
	scroll?: boolean;
	/** Show the signed-out notice (off where the body shows it itself). */
	notice?: boolean;
}) {
	const backendId = useBackendParam();
	const { account, api } = useBackend(backendId);
	const queryClient = useQueryClient();
	const [refreshing, setRefreshing] = useState(false);
	if (!account || !api) {
		return (
			<Screen>
				<Stack.Screen options={{ title: "Backend" }} />
				<EmptyState icon="flame-outline" title="This backend isn't connected" body="It was removed from this phone." action={<Button title="Backends" onPress={() => router.replace("/backends")} />} />
			</Screen>
		);
	}
	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await queryClient.refetchQueries({ queryKey: ["tt", backendId, ...(refreshKeys ?? [])], type: "active" });
		} finally {
			setRefreshing(false);
		}
	};
	return (
		<Screen refreshing={refreshing} onRefresh={scroll ? onRefresh : undefined} scroll={scroll}>
			<Stack.Screen options={{ title: typeof title === "function" ? title(account) : title }} />
			{notice ? <SignedOutNotice account={account} /> : null}
			{children({ account, api, backendId })}
		</Screen>
	);
}
