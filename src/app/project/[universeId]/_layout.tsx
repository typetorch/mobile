/**
 * An experience's pages: one stack whose header is the project picker (the experience, the page under it), and the
 * game's bottom bar (features/project/game-nav: Overview · TypeTorch · Analytics · Roblox) under every page. The home
 * (index) is the tabs' list and gets a back arrow to your projects; the tools (Roblox tab) and their detail pages keep
 * the stack's back arrow. Each screen still sets its own `title` (the page name shown under the experience).
 */
import { router, Stack, useGlobalSearchParams, useLocalSearchParams, useSegments } from "expo-router";
import { Pressable, View } from "react-native";

import { Icon } from "@/components/ui";
import { GameBar, headerLine, useGameBackend, useHomeTab, type GameTab } from "@/features/project/game-nav";
import { ProjectPagePickerTitle } from "@/features/typetorch/nav";
import { useTheme } from "@/theme";

export default function ProjectLayout() {
	const p = useTheme();
	const { universeId } = useLocalSearchParams<{ universeId: string }>();
	const { tab: routeTab } = useGlobalSearchParams<{ tab?: GameTab }>();
	const id = Number(universeId);
	const segments = useSegments() as string[];
	const last = segments[segments.length - 1];
	const isHome = last === "[universeId]" || last === "index";
	const backend = useGameBackend(id);
	const homeTab = useHomeTab(id, isHome ? routeTab : undefined, "overview");
	const active: GameTab = isHome ? (homeTab === "typetorch" && !backend ? "overview" : homeTab) : "tools";
	return (
		<View style={{ flex: 1, backgroundColor: p.background }}>
			<Stack
				screenOptions={({ route }) => {
					const home = route.name === "index";
					return {
						headerStyle: { backgroundColor: p.background },
						headerTintColor: p.foreground,
						headerShadowVisible: false,
						headerBackground: headerLine(p, home ? active : "tools"),
						contentStyle: { backgroundColor: p.background },
						headerTitle: ({ children }: { children: string }) => <ProjectPagePickerTitle universeId={id} page={children} tab={home ? active : "tools"} />,
						headerBackVisible: !home,
						headerLeft: home
							? () => (
									<Pressable
										onPress={() => (router.canDismiss() ? router.dismissTo("/") : router.replace("/"))}
										hitSlop={10}
										accessibilityRole="button"
										accessibilityLabel="Back to your projects"
										style={{ paddingRight: 12 }}
									>
										<Icon name="chevron-back" size={24} color={p.foreground} />
									</Pressable>
								)
							: undefined,
					};
				}}
			/>
			<GameBar universeId={id} active={active} isHome={isHome} />
		</View>
	);
}
