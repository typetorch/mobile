/**
 * A bottom sheet (a Modal sliding up over the page) for the phone's version of the web's popovers and menus: a table's
 * column filter, its Columns and Export menus, a row's copy menu, a player or product card, a deploy mark's card.
 */
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, Txt } from "@/components/ui";
import { radius, space, useTheme } from "@/theme";

export function Sheet({ open, onClose, title, subtitle, children, scroll = true }: { open: boolean; onClose(): void; title?: string; subtitle?: string; children: ReactNode; scroll?: boolean }) {
	const p = useTheme();
	const insets = useSafeAreaInsets();
	if (!open) return null;
	const body = <View style={{ gap: space.sm }}>{children}</View>;
	return (
		<Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
			<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
				<Pressable style={{ flex: 1, backgroundColor: "#00000066" }} onPress={onClose} accessibilityLabel="Close" />
				<View
					style={{
						maxHeight: "80%",
						backgroundColor: p.background,
						borderTopLeftRadius: radius.xl,
						borderTopRightRadius: radius.xl,
						borderTopWidth: StyleSheet.hairlineWidth,
						borderColor: p.border,
						paddingTop: space.sm,
						paddingBottom: Math.max(insets.bottom, space.md),
					}}
				>
					<View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: p.border, marginBottom: space.sm }} />
					{title ? (
						<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
							<View style={{ flex: 1 }}>
								<Txt variant="h3" numberOfLines={2}>
									{title}
								</Txt>
								{subtitle ? <Txt variant="small">{subtitle}</Txt> : null}
							</View>
							<Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
								<Icon name="close" size={20} color={p.mutedForeground} />
							</Pressable>
						</View>
					) : null}
					{scroll ? (
						<ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.sm }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
							{body}
						</ScrollView>
					) : (
						<View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, flexShrink: 1 }}>{body}</View>
					)}
				</View>
			</KeyboardAvoidingView>
		</Modal>
	);
}

/** One tappable line in a sheet menu (an icon, a label, an optional value on the right). */
export function SheetItem({ icon, label, detail, onPress, disabled, destructive }: { icon?: Parameters<typeof Icon>[0]["name"]; label: string; detail?: string; onPress(): void; disabled?: boolean; destructive?: boolean }) {
	const p = useTheme();
	const color = disabled ? p.mutedForeground : destructive ? p.destructive : p.foreground;
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			android_ripple={{ color: p.accent }}
			style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 11, paddingHorizontal: 4, borderRadius: radius.md }, pressed && { backgroundColor: p.accent }]}
		>
			{icon ? <Icon name={icon} size={18} color={color} /> : null}
			<Txt color={color} style={{ flex: 1 }} numberOfLines={1}>
				{label}
			</Txt>
			{detail ? (
				<Txt variant="mono" numberOfLines={1} style={{ maxWidth: "45%", fontSize: 11 }}>
					{detail}
				</Txt>
			) : null}
		</Pressable>
	);
}
