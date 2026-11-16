/** Every Creator Hub page the app has for one universe, grouped like Creator Hub's sidebar (tools.ts). */
import { router } from "expo-router";
import { View } from "react-native";

import { Badge, Button, EmptyState, Icon, List, Row, Section, Txt } from "@/components/ui";
import { missingScopes } from "@/lib/features";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

import { TOOL_SECTIONS } from "./tools";

export function ToolsTab({ universeId }: { universeId: number; name?: string }) {
	const p = useTheme();
	const { keyInfo, hasKey } = useAccounts();
	return (
		<View style={{ gap: 12 }}>
			{!hasKey ? (
				<EmptyState
					icon="key-outline"
					title="Add an Open Cloud key"
					body="Most tools use your Open Cloud key (public lists open without it). Add one in Settings."
					action={<Button title="Open Settings" variant="brand" onPress={() => router.push("/settings")} />}
				/>
			) : null}
			{TOOL_SECTIONS.map((section) => (
				<Section key={section.title} title={section.title}>
					<List>
						{section.tools.map((t) => {
							const missing = hasKey ? missingScopes(keyInfo, t.scopes, universeId) : t.scopes;
							const ready = missing.length === 0 && (hasKey || !!t.publicRead || !t.scopes.length);
							return (
								<Row
									key={t.key}
									chevron
									onPress={() => router.push(`/project/${universeId}/${t.route}`)}
									left={<Icon name={t.icon} size={18} color={ready ? p.foreground : p.mutedForeground} />}
									title={t.title}
									subtitle={missing.length ? `Needs ${missing.join(", ")}` : t.description}
									right={missing.length ? <Badge label="Missing" tone="warning" /> : undefined}
								/>
							);
						})}
					</List>
				</Section>
			))}
			<Txt variant="small" style={{ textAlign: "center" }}>
				Scopes are set per experience on Creator Hub → Open Cloud → API Keys. Changes and deletes always ask first.
			</Txt>
		</View>
	);
}
