import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { HttpError } from "@/api/http";
import { AccountsProvider, useAccounts } from "@/store/accounts";
import { ThemeProvider, useTheme } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// React Query refetches when the app comes back to the foreground.
focusManager.setEventListener((setFocused) => {
	const sub = AppState.addEventListener("change", (state) => {
		if (Platform.OS !== "web") setFocused(state === "active");
	});
	return () => sub.remove();
});

function makeClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				// Don't retry what won't change by retrying (auth, missing scope, not found, rate limit).
				retry: (count, error) => {
					if (error instanceof HttpError && [400, 401, 403, 404, 409, 429].includes(error.status)) return false;
					if (error && typeof error === "object" && "status" in error && [400, 401, 403, 404, 409].includes(Number((error as { status: unknown }).status))) return false;
					return count < 1;
				},
				staleTime: 30_000,
			},
		},
	});
}

function Navigation() {
	const p = useTheme();
	const { ready } = useAccounts();
	useEffect(() => {
		if (ready) SplashScreen.hideAsync().catch(() => undefined);
	}, [ready]);
	const base = p.scheme === "dark" ? DarkTheme : DefaultTheme;
	const navTheme = {
		...base,
		colors: { ...base.colors, background: p.background, card: p.background, text: p.foreground, border: p.border, primary: p.brand, notification: p.destructive },
	};
	return (
		<NavThemeProvider value={navTheme}>
			<StatusBar style={p.scheme === "dark" ? "light" : "dark"} />
			<Stack
				screenOptions={{
					headerStyle: { backgroundColor: p.background },
					headerTintColor: p.foreground,
					headerTitleStyle: { fontWeight: "600", fontSize: 17 },
					headerShadowVisible: false,
					contentStyle: { backgroundColor: p.background },
				}}
			>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="auth" options={{ headerShown: false }} />
				{/* An experience's pages have their own stack (project/[universeId]/_layout: sidebar and project picker). */}
				<Stack.Screen name="project/[universeId]" options={{ headerShown: false }} />
			</Stack>
		</NavThemeProvider>
	);
}

function Themed() {
	const { prefs } = useAccounts();
	return (
		<ThemeProvider appearance={prefs.appearance}>
			<Navigation />
		</ThemeProvider>
	);
}

export default function RootLayout() {
	const [client] = useState(makeClient);
	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<SafeAreaProvider>
				<QueryClientProvider client={client}>
					<AccountsProvider>
						<Themed />
					</AccountsProvider>
				</QueryClientProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
