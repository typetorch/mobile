/**
 * The frame of an Open Cloud tool screen: the universe from the route, the scope check, the title. With `exportAs` the
 * screen also gets the header's Export button (PDF report, PNG / CSV per chart, numbers and table: features/export).
 */
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, type ReactNode } from "react";

import { OpenCloud } from "@/api/opencloud";
import { Screen, ScopeNotice } from "@/components/ui";
import { createExportRegistry, ExportProvider } from "@/features/export/context";
import { ExportButton, slug } from "@/features/export/ExportButton";
import { useProject } from "@/features/project/projects";
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
	exportAs,
}: {
	title: string;
	/** The export's name ("Ads", "Campaign …"): turns the Export button on. */
	exportAs?: string;
	scopes: string[];
	children: (ctx: { universeId: number; cloud: OpenCloud; can: (scope: string) => boolean }) => ReactNode;
	refreshing?: boolean;
	onRefresh?: () => void;
}) {
	const universeId = useUniverseParam();
	const { cloud, keyInfo } = useAccounts();
	const missing = missingScopes(keyInfo, scopes, universeId);
	const exports = useMemo(() => createExportRegistry(), []);
	const projectName = useProject(universeId).data?.name ?? `Universe ${universeId}`;
	const blocked = (!cloud && scopes.length > 0) || missing.length > 0;
	return (
		<Screen refreshing={refreshing} onRefresh={onRefresh}>
			<Stack.Screen
				options={{
					title,
					headerRight:
						exportAs && !blocked
							? () => (
									<ExportButton
										registry={exports}
										fileBase={() => `${slug(projectName)}-${slug(exportAs)}`}
										header={() => ({
											title: `${exportAs} · ${projectName}`,
											lines: [`Universe ${universeId} · exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, ...exports.lines()],
										})}
									/>
								)
							: undefined,
				}}
			/>
			{/* Screens with no required scope (public data) also open without a key; their key-only parts check can(). */}
			{blocked ? (
				<ScopeNotice what={title} scopes={cloud ? missing : scopes} />
			) : (
				<ExportProvider registry={exports}>
					{children({ universeId, cloud: cloud ?? NO_KEY, can: (scope) => !!cloud && missingScopes(keyInfo, [scope], universeId).length === 0 })}
				</ExportProvider>
			)}
		</Screen>
	);
}
