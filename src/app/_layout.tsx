import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Updates from "expo-updates";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { HttpError } from "@/api/http";
import { installCrashGuard } from "@/lib/crash-guard";
import { AccountsProvider, useAccounts } from "@/store/accounts";
import { ThemeProvider, useTheme } from "@/theme";

installCrashGuard();
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

/**
 * The last line of defence: an error that escaped every page's own boundary. Without it a release build shows a bare
 * background with no way out. The app's providers are gone here, so plain colours and components.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
	const button = (label: string, onPress: () => void) => (
		<Pressable onPress={onPress} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: "#fb7a32" }}>
			<Text style={{ color: "#fff", fontWeight: "600" }}>{label}</Text>
		</Pressable>
	);
	return (
		<ScrollView style={{ flex: 1, backgroundColor: "#0a0a0a" }} contentContainerStyle={{ padding: 24, paddingTop: 72, gap: 12 }}>
			<Text style={{ color: "#fafafa", fontSize: 20, fontWeight: "700" }}>TypeTorch crashed</Text>
			<Text selectable style={{ color: "#d4d4d4" }}>
				{error.message}
			</Text>
			<Text selectable style={{ color: "#8a8a8a", fontFamily: "monospace", fontSize: 10 }}>
				{(error.stack ?? "").split("\n").slice(0, 12).join("\n")}
			</Text>
			<View style={{ flexDirection: "row", gap: 10 }}>
				{button("Try again", () => void retry())}
				{button("Restart app", () => void Updates.reloadAsync().catch(() => retry()))}
			</View>
		</ScrollView>
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
