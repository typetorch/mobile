import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router/js-tabs";

import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

export default function TabsLayout() {
	const p = useTheme();
	const { backends } = useAccounts();
	const signedOut = backends.filter((b) => b.signedOut).length;
	return (
		<Tabs
			screenOptions={{
				headerStyle: { backgroundColor: p.background },
				headerTintColor: p.foreground,
				headerShadowVisible: false,
				headerTitleStyle: { fontWeight: "700", fontSize: 20 },
				tabBarStyle: { backgroundColor: p.background, borderTopColor: p.border },
				tabBarActiveTintColor: p.foreground,
				tabBarInactiveTintColor: p.mutedForeground,
				tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
				sceneStyle: { backgroundColor: p.background },
			}}
		>
			<Tabs.Screen
				name="index"
				options={{ title: "Projects", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "grid" : "grid-outline"} size={size - 2} color={color as string} /> }}
			/>
			<Tabs.Screen
				name="backends"
				options={{
					title: "Backends",
					tabBarBadge: signedOut ? signedOut : undefined,
					tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "flame" : "flame-outline"} size={size - 2} color={color as string} />,
				}}
			/>
			<Tabs.Screen
				name="settings"
				options={{ title: "Settings", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "settings" : "settings-outline"} size={size - 2} color={color as string} /> }}
			/>
		</Tabs>
	);
}
