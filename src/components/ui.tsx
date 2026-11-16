/**
 * The app's small design system: dense, dark-first, shadcn-like surfaces on the TypeTorch tokens (theme.tsx).
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import {
	ActivityIndicator,
	Alert,
	Animated,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
	type StyleProp,
	type TextInputProps,
	type TextStyle,
	type ViewStyle,
} from "react-native";

import { font, radius, space, toneColor, useTheme, type Tone } from "@/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({ name, size = 18, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
	const p = useTheme();
	return <Ionicons name={name} size={size} color={color ?? p.foreground} style={style} />;
}

// Text -----------------------------------------------------------------------------------------------------------------

type TextVariant = "title" | "h2" | "h3" | "body" | "muted" | "small" | "mono" | "label";

export function Txt({
	children,
	variant = "body",
	color,
	style,
	numberOfLines,
	selectable,
}: {
	children: ReactNode;
	variant?: TextVariant;
	color?: string;
	style?: StyleProp<TextStyle>;
	numberOfLines?: number;
	selectable?: boolean;
}) {
	const p = useTheme();
	const base: TextStyle = (() => {
		switch (variant) {
			case "title":
				return { fontSize: font.xxl, fontWeight: "700", color: p.foreground, letterSpacing: -0.4 };
			case "h2":
				return { fontSize: font.xl, fontWeight: "700", color: p.foreground, letterSpacing: -0.2 };
			case "h3":
				return { fontSize: font.lg, fontWeight: "600", color: p.foreground };
			case "muted":
				return { fontSize: font.md, color: p.mutedForeground };
			case "small":
				return { fontSize: font.sm, color: p.mutedForeground };
			case "label":
				return { fontSize: font.xs, fontWeight: "600", color: p.mutedForeground, textTransform: "uppercase", letterSpacing: 0.6 };
			case "mono":
				return { fontSize: font.sm, color: p.foreground, fontFamily: "monospace" };
			default:
				return { fontSize: font.md, color: p.foreground };
		}
	})();
	return (
		<Text style={[base, color ? { color } : null, style]} numberOfLines={numberOfLines} selectable={selectable}>
			{children}
		</Text>
	);
}

// Layout ---------------------------------------------------------------------------------------------------------------

export function Screen({
	children,
	refreshing,
	onRefresh,
	padded = true,
	scroll = true,
	style,
}: {
	children: ReactNode;
	refreshing?: boolean;
	onRefresh?: () => void;
	padded?: boolean;
	scroll?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const p = useTheme();
	if (!scroll) return <View style={[{ flex: 1, backgroundColor: p.background }, padded && { padding: space.lg }, style]}>{children}</View>;
	return (
		<ScrollView
			style={{ flex: 1, backgroundColor: p.background }}
			contentContainerStyle={[padded && { padding: space.lg, paddingBottom: space.xl * 2 }, { gap: space.md }, style]}
			keyboardShouldPersistTaps="handled"
			refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.mutedForeground} colors={[p.brand]} progressBackgroundColor={p.card} /> : undefined}
		>
			{children}
		</ScrollView>
	);
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
	const p = useTheme();
	const s: ViewStyle = { backgroundColor: p.card, borderColor: p.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.md };
	if (onPress)
		return (
			<Pressable onPress={onPress} style={({ pressed }) => [s, pressed && { opacity: 0.7 }, style]}>
				{children}
			</Pressable>
		);
	return <View style={[s, style]}>{children}</View>;
}

export function Section({ title, right, children, style }: { title?: string; right?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
	return (
		<View style={[{ gap: space.sm }, style]}>
			{title || right ? (
				<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 }}>
					{title ? <Txt variant="label">{title}</Txt> : <View />}
					{right}
				</View>
			) : null}
			{children}
		</View>
	);
}

export function Divider() {
	const p = useTheme();
	return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }} />;
}

/** A list: rows separated by hairlines inside one card. */
export function List({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
	const p = useTheme();
	const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
	return (
		<View style={[{ backgroundColor: p.card, borderColor: p.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: "hidden" }, style]}>
			{items.map((child, i) => (
				<View key={i}>
					{i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginLeft: space.md }} /> : null}
					{child}
				</View>
			))}
		</View>
	);
}

export function Row({
	title,
	subtitle,
	left,
	right,
	onPress,
	onLongPress,
	chevron,
	disabled,
	titleColor,
	numberOfLines = 1,
}: {
	title: ReactNode;
	subtitle?: ReactNode;
	left?: ReactNode;
	right?: ReactNode;
	onPress?: () => void;
	onLongPress?: () => void;
	chevron?: boolean;
	disabled?: boolean;
	titleColor?: string;
	numberOfLines?: number;
}) {
	const p = useTheme();
	const content = (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 10, paddingHorizontal: space.md, opacity: disabled ? 0.45 : 1 }}>
			{left}
			<View style={{ flex: 1, gap: 2 }}>
				{typeof title === "string" ? (
					<Txt numberOfLines={numberOfLines} color={titleColor} style={{ fontWeight: "500" }}>
						{title}
					</Txt>
				) : (
					title
				)}
				{typeof subtitle === "string" ? (
					<Txt variant="small" numberOfLines={2}>
						{subtitle}
					</Txt>
				) : (
					subtitle
				)}
			</View>
			{right}
			{chevron ? <Icon name="chevron-forward" size={16} color={p.mutedForeground} /> : null}
		</View>
	);
	if (!onPress || disabled) return content;
	return (
		<Pressable onPress={onPress} onLongPress={onLongPress} android_ripple={{ color: p.accent }} style={({ pressed }) => [pressed && { backgroundColor: p.accent }]}>
			{content}
		</Pressable>
	);
}

export function KV({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
	return (
		<View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: 6 }}>
			<Txt variant="muted">{label}</Txt>
			{typeof value === "string" || typeof value === "number" ? (
				<Txt variant={mono ? "mono" : "body"} style={{ flexShrink: 1, textAlign: "right" }} selectable>
					{value}
				</Txt>
			) : (
				value
			)}
		</View>
	);
}

// Controls -------------------------------------------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost" | "brand";

export function Button({
	title,
	onPress,
	variant = "secondary",
	icon,
	loading,
	disabled,
	small,
	style,
}: {
	title: string;
	onPress?: () => void;
	variant?: ButtonVariant;
	icon?: IconName;
	loading?: boolean;
	disabled?: boolean;
	small?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const p = useTheme();
	const colors: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
		primary: { bg: p.primary, fg: p.primaryForeground },
		brand: { bg: p.brand, fg: p.brandForeground },
		secondary: { bg: p.secondary, fg: p.foreground, border: p.border },
		destructive: { bg: p.destructive, fg: "#ffffff" },
		ghost: { bg: "transparent", fg: p.foreground },
	};
	const c = colors[variant];
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled || loading}
			style={({ pressed }) => [
				{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "center",
					gap: 6,
					backgroundColor: c.bg,
					borderRadius: radius.md,
					paddingVertical: small ? 6 : 10,
					paddingHorizontal: small ? 10 : 14,
					borderWidth: c.border ? StyleSheet.hairlineWidth : 0,
					borderColor: c.border,
					opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
				},
				style,
			]}
		>
			{loading ? <ActivityIndicator size="small" color={c.fg} /> : icon ? <Icon name={icon} size={small ? 14 : 16} color={c.fg} /> : null}
			<Text style={{ color: c.fg, fontWeight: "600", fontSize: small ? font.sm : font.md }}>{title}</Text>
		</Pressable>
	);
}

export function Field({ label, hint, style, ...props }: TextInputProps & { label?: string; hint?: string }) {
	const p = useTheme();
	return (
		<View style={{ gap: 6 }}>
			{label ? <Txt variant="label">{label}</Txt> : null}
			<TextInput
				placeholderTextColor={p.mutedForeground}
				autoCapitalize="none"
				autoCorrect={false}
				{...props}
				style={[
					{
						backgroundColor: p.background,
						color: p.foreground,
						borderColor: p.input,
						borderWidth: 1,
						borderRadius: radius.md,
						paddingHorizontal: space.md,
						paddingVertical: 9,
						fontSize: font.md,
					},
					props.multiline && { minHeight: 100, textAlignVertical: "top", fontFamily: "monospace", fontSize: font.sm },
					style,
				]}
			/>
			{hint ? <Txt variant="small">{hint}</Txt> : null}
		</View>
	);
}

export function SearchBar({ value, onChangeText, placeholder, onSubmit }: { value: string; onChangeText: (t: string) => void; placeholder?: string; onSubmit?: () => void }) {
	const p = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				backgroundColor: p.card,
				borderColor: p.border,
				borderWidth: StyleSheet.hairlineWidth,
				borderRadius: radius.md,
				paddingHorizontal: space.md,
			}}
		>
			<Icon name="search" size={16} color={p.mutedForeground} />
			<TextInput
				value={value}
				onChangeText={onChangeText}
				placeholder={placeholder ?? "Search"}
				placeholderTextColor={p.mutedForeground}
				autoCapitalize="none"
				autoCorrect={false}
				returnKeyType={onSubmit ? "search" : "done"}
				onSubmitEditing={onSubmit}
				style={{ flex: 1, color: p.foreground, paddingVertical: 9, fontSize: font.md }}
			/>
			{value ? (
				<Pressable onPress={() => onChangeText("")} hitSlop={8}>
					<Icon name="close-circle" size={16} color={p.mutedForeground} />
				</Pressable>
			) : null}
		</View>
	);
}

export function Segmented<T extends string | number>({
	options,
	value,
	onChange,
	style,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (v: T) => void;
	style?: StyleProp<ViewStyle>;
}) {
	const p = useTheme();
	return (
		<View style={[{ flexDirection: "row", backgroundColor: p.muted, borderRadius: radius.md, padding: 3, gap: 3 }, style]}>
			{options.map((o) => {
				const active = o.value === value;
				return (
					<Pressable
						key={String(o.value)}
						onPress={() => onChange(o.value)}
						style={{ flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: radius.sm, backgroundColor: active ? p.background : "transparent" }}
					>
						<Text style={{ color: active ? p.foreground : p.mutedForeground, fontWeight: active ? "600" : "500", fontSize: font.sm }}>{o.label}</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/** Horizontally scrolling chips (a picker with many options). */
export function Chips<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
	const p = useTheme();
	return (
		<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
			{options.map((o) => {
				const active = o.value === value;
				return (
					<Pressable
						key={String(o.value)}
						onPress={() => onChange(o.value)}
						style={{
							paddingVertical: 5,
							paddingHorizontal: 10,
							borderRadius: 999,
							borderWidth: StyleSheet.hairlineWidth,
							borderColor: active ? p.brand : p.border,
							backgroundColor: active ? p.brand : p.card,
						}}
					>
						<Text style={{ color: active ? p.brandForeground : p.foreground, fontSize: font.sm, fontWeight: "500" }}>{o.label}</Text>
					</Pressable>
				);
			})}
		</ScrollView>
	);
}

// Status ---------------------------------------------------------------------------------------------------------------

export function Badge({ label, tone = "muted", icon }: { label: string; tone?: Tone; icon?: IconName }) {
	const p = useTheme();
	const c = toneColor(p, tone);
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: `${c}22`, borderWidth: StyleSheet.hairlineWidth, borderColor: `${c}66` }}>
			{icon ? <Icon name={icon} size={11} color={c} /> : null}
			<Text style={{ color: tone === "muted" ? p.mutedForeground : c, fontSize: font.xs, fontWeight: "600" }}>{label}</Text>
		</View>
	);
}

export function Dot({ tone = "muted", size = 8 }: { tone?: Tone; size?: number }) {
	const p = useTheme();
	return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: toneColor(p, tone) }} />;
}

export function Stat({ label, value, sub, tone, style }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; style?: StyleProp<ViewStyle> }) {
	const p = useTheme();
	return (
		<Card style={[{ flexGrow: 1, flexBasis: "45%", gap: 4 }, style]}>
			<Txt variant="label">{label}</Txt>
			<Text style={{ color: tone ? toneColor(p, tone) : p.foreground, fontSize: font.xl, fontWeight: "700", letterSpacing: -0.3 }} numberOfLines={1} adjustsFontSizeToFit>
				{value}
			</Text>
			{sub ? typeof sub === "string" ? <Txt variant="small">{sub}</Txt> : sub : null}
		</Card>
	);
}

export function StatGrid({ children }: { children: ReactNode }) {
	return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{children}</View>;
}

export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
	const p = useTheme();
	const opacity = useRef(new Animated.Value(0.5)).current;
	useEffect(() => {
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
				Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [opacity]);
	return <Animated.View style={[{ height, width, borderRadius: radius.sm, backgroundColor: p.muted, opacity }, style]} />;
}

/** A few skeleton rows inside a card (list loading). */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
	return (
		<Card style={{ gap: 14 }}>
			{Array.from({ length: rows }, (_, i) => (
				<View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
					<Skeleton width={36} height={36} />
					<View style={{ flex: 1, gap: 6 }}>
						<Skeleton width="60%" height={12} />
						<Skeleton width="35%" height={10} />
					</View>
				</View>
			))}
		</Card>
	);
}

export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; title?: string }) {
	const p = useTheme();
	const message = error instanceof Error ? error.message : String(error ?? "unknown error");
	return (
		<Card style={{ gap: 8, borderColor: `${p.destructive}66` }}>
			<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				<Icon name="alert-circle" size={18} color={p.destructive} />
				<Txt style={{ fontWeight: "600" }}>{title}</Txt>
			</View>
			<Txt variant="muted" selectable>
				{message}
			</Txt>
			{onRetry ? <Button title="Try again" icon="refresh" small onPress={onRetry} style={{ alignSelf: "flex-start" }} /> : null}
		</Card>
	);
}

export function EmptyState({ icon = "file-tray-outline", title, body, action }: { icon?: IconName; title: string; body?: ReactNode; action?: ReactNode }) {
	const p = useTheme();
	return (
		<Card style={{ alignItems: "center", gap: 8, paddingVertical: space.xl }}>
			<View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
				<Icon name={icon} size={22} color={p.mutedForeground} />
			</View>
			<Txt variant="h3" style={{ textAlign: "center" }}>
				{title}
			</Txt>
			{body ? typeof body === "string" ? <Txt variant="muted" style={{ textAlign: "center" }}>{body}</Txt> : body : null}
			{action}
		</Card>
	);
}

/** A notice for a feature the key can't use yet: which scope to add. */
export function ScopeNotice({ scopes, what }: { scopes: string[]; what: string }) {
	const p = useTheme();
	return (
		<Card style={{ gap: 6, borderColor: `${p.warning}66` }}>
			<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				<Icon name="key-outline" size={16} color={p.warning} />
				<Txt style={{ fontWeight: "600" }}>{what} needs more Open Cloud access</Txt>
			</View>
			<Txt variant="muted">Add {scopes.length > 1 ? "these scopes" : "this scope"} for this experience to your API key on Creator Hub, then pull to refresh Settings:</Txt>
			{scopes.map((s) => (
				<Txt key={s} variant="mono">
					{s}
				</Txt>
			))}
		</Card>
	);
}

export function Loading() {
	const p = useTheme();
	return (
		<View style={{ padding: space.xl, alignItems: "center" }}>
			<ActivityIndicator color={p.mutedForeground} />
		</View>
	);
}

/** Alert.alert as a promise: true when the person pressed the confirm button. */
export function confirm(title: string, message: string, confirmText = "Confirm", destructive = true): Promise<boolean> {
	return new Promise((resolve) => {
		Alert.alert(
			title,
			message,
			[
				{ text: "Cancel", style: "cancel", onPress: () => resolve(false) },
				{ text: confirmText, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
			],
			{ cancelable: true, onDismiss: () => resolve(false) },
		);
	});
}

export function notify(title: string, message?: string) {
	Alert.alert(title, message);
}
