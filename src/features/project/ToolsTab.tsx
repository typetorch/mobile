/** The Open Cloud tools for one universe; each opens when the key has its scopes for this universe. */
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";

import { Badge, Button, confirm, EmptyState, Icon, List, notify, Row, Section, Txt } from "@/components/ui";
import { FEATURES, missingScopes } from "@/lib/features";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

/** Feature key -> route under /project/<id>/ (restart is an action, analytics a tab). */
const ROUTES: Record<string, string> = {
	datastores: "datastores",
	ordered: "ordered",
	memory: "memory",
	messaging: "messaging",
	bans: "bans",
	products: "monetization",
	passes: "monetization",
};

export function ToolsTab({ universeId, name }: { universeId: number; name: string }) {
	const p = useTheme();
	const { cloud, keyInfo, hasKey } = useAccounts();
	const restart = useMutation({
		mutationFn: () => cloud!.restartServers(universeId),
		onSuccess: () => notify("Restarting servers", "Roblox is shutting down every server; players are moved to new ones on the latest version."),
		onError: (e) => notify("Couldn't restart servers", (e as Error).message),
	});
	if (!hasKey)
		return <EmptyState icon="key-outline" title="Add an Open Cloud key" body="Data stores, bans, messaging and the other tools use your Open Cloud key. Add one in Settings." action={<Button title="Open Settings" variant="brand" onPress={() => router.push("/settings")} />} />;
	const tools = FEATURES.filter((f) => f.key !== "analytics" && f.key !== "passes");
	return (
		<View style={{ gap: 12 }}>
			<Section title="Open Cloud tools">
				<List>
					{tools.map((f) => {
						const missing = missingScopes(keyInfo, f.scopes, universeId);
						const ready = missing.length === 0;
						if (f.key === "restart")
							return (
								<Row
									key={f.key}
									left={<Icon name={f.icon} size={18} color={ready ? p.foreground : p.mutedForeground} />}
									title={f.title}
									subtitle={ready ? f.description : `Needs ${missing.join(", ")}`}
									right={
										ready ? (
											<Button
												title="Restart"
												small
												variant="destructive"
												loading={restart.isPending}
												onPress={async () => {
													if (await confirm(`Restart every server of ${name}?`, "All live servers shut down and players are moved to new servers on the latest published version. This can't be undone.", "Restart all")) restart.mutate();
												}}
											/>
										) : (
											<Badge label="Missing" tone="warning" />
										)
									}
								/>
							);
						return (
							<Row
								key={f.key}
								chevron={ready || f.key === "products"}
								onPress={() => router.push(`/project/${universeId}/${ROUTES[f.key]}`)}
								left={<Icon name={f.icon} size={18} color={ready ? p.foreground : p.mutedForeground} />}
								title={f.title}
								subtitle={ready ? f.description : `Needs ${missing.join(", ")}`}
								right={ready ? undefined : <Badge label="Missing" tone="warning" />}
							/>
						);
					})}
				</List>
			</Section>
			<Txt variant="small" style={{ textAlign: "center" }}>
				Scopes are set per experience on Creator Hub → Open Cloud → API Keys. Changes and deletes always ask first.
			</Txt>
		</View>
	);
}
