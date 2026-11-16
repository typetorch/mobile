/**
 * An experience's pages: one stack whose header is the project picker (the experience, the page under it), with the
 * sidebar and home on top-level pages and a back arrow on detail pages (one item of a list), like the dashboard's.
 * Each screen still sets its own `title` (the page name shown under the experience).
 */
import { Stack, useLocalSearchParams } from "expo-router";

import { PROJECT_DETAIL, ProjectNavLeft, ProjectPagePickerTitle } from "@/features/typetorch/nav";
import { useTheme } from "@/theme";

export default function ProjectLayout() {
	const p = useTheme();
	const { universeId } = useLocalSearchParams<{ universeId: string }>();
	const id = Number(universeId);
	return (
		<Stack
			screenOptions={({ route }) => {
				const detail = route.name in PROJECT_DETAIL;
				return {
					headerStyle: { backgroundColor: p.background },
					headerTintColor: p.foreground,
					headerShadowVisible: false,
					contentStyle: { backgroundColor: p.background },
					headerTitle: ({ children }: { children: string }) => <ProjectPagePickerTitle universeId={id} page={children} />,
					headerBackVisible: detail,
					headerLeft: detail ? undefined : () => <ProjectNavLeft universeId={id} />,
				};
			}}
		/>
	);
}
