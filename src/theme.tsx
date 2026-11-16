/**
 * TypeTorch colors and spacing, from the explorer web app's tokens (backend/web/src/index.css: the shadcn neutral
 * palette in oklch, converted to hex here, plus the chart and status colors). Dark first; the system setting decides
 * unless the person picks one in Settings.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";

export interface Palette {
	scheme: "dark" | "light";
	background: string;
	foreground: string;
	card: string;
	cardForeground: string;
	primary: string;
	primaryForeground: string;
	secondary: string;
	muted: string;
	mutedForeground: string;
	accent: string;
	destructive: string;
	border: string;
	input: string;
	ring: string;
	brand: string;
	brandForeground: string;
	chart: string[];
	good: string;
	warning: string;
	serious: string;
	critical: string;
}

const dark: Palette = {
	scheme: "dark",
	background: "#0a0a0a",
	foreground: "#fafafa",
	card: "#171717",
	cardForeground: "#fafafa",
	primary: "#e5e5e5",
	primaryForeground: "#171717",
	secondary: "#262626",
	muted: "#262626",
	mutedForeground: "#a1a1a1",
	accent: "#262626",
	destructive: "#ff6467",
	border: "rgba(255,255,255,0.10)",
	input: "rgba(255,255,255,0.15)",
	ring: "#737373",
	brand: "#3987e5",
	brandForeground: "#fafafa",
	chart: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
	good: "#0ca30c",
	warning: "#fab219",
	serious: "#ec835a",
	critical: "#d03b3b",
};

const light: Palette = {
	scheme: "light",
	background: "#ffffff",
	foreground: "#0a0a0a",
	card: "#ffffff",
	cardForeground: "#0a0a0a",
	primary: "#171717",
	primaryForeground: "#fafafa",
	secondary: "#f5f5f5",
	muted: "#f5f5f5",
	mutedForeground: "#737373",
	accent: "#f5f5f5",
	destructive: "#e7000b",
	border: "#e5e5e5",
	input: "#e5e5e5",
	ring: "#a1a1a1",
	brand: "#2a78d6",
	brandForeground: "#fafafa",
	chart: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
	good: "#0ca30c",
	warning: "#fab219",
	serious: "#ec835a",
	critical: "#d03b3b",
};

export type Appearance = "system" | "dark" | "light";

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 8, lg: 10, xl: 14 } as const;
export const font = { xs: 11, sm: 12, md: 14, lg: 16, xl: 20, xxl: 26 } as const;

const ThemeContext = createContext<Palette>(dark);

export function ThemeProvider({ appearance, children }: { appearance: Appearance; children: ReactNode }) {
	const system = useColorScheme();
	const palette = useMemo(() => {
		if (appearance === "dark") return dark;
		if (appearance === "light") return light;
		// Dark unless the system asks for light.
		return system === "light" ? light : dark;
	}, [appearance, system]);
	return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
	return useContext(ThemeContext);
}

/** A tone name to a palette color (status chips, health dots). */
export type Tone = "good" | "warning" | "serious" | "critical" | "muted" | "brand";
export function toneColor(p: Palette, tone: Tone): string {
	switch (tone) {
		case "good":
			return p.good;
		case "warning":
			return p.warning;
		case "serious":
			return p.serious;
		case "critical":
			return p.critical;
		case "brand":
			return p.brand;
		default:
			return p.mutedForeground;
	}
}
