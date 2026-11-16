/**
 * Small controls of the Settings screen (the web's ToggleGroup and Badge): one-of and many-of chip groups, and the
 * source badge (Dashboard / Env / Default).
 */
import { Pressable, StyleSheet, View } from "react-native";

import type { SettingSource } from "@/api/tt/types";
import { Badge, Txt } from "@/components/ui";
import { useTheme } from "@/theme";

/** A row of chips where the picked ones stand out (one or many). */
export function ChoiceChips<T extends string>({
	options,
	value,
	onChange,
	disabled,
	disabledOptions = [],
}: {
	options: readonly { value: T; label: string }[];
	value: readonly T[];
	onChange: (v: T) => void;
	disabled?: boolean;
	disabledOptions?: readonly T[];
}) {
	const p = useTheme();
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
			{options.map((o) => {
				const on = value.includes(o.value);
				const off = disabled || disabledOptions.includes(o.value);
				return (
					<Pressable
						key={o.value}
						disabled={off}
						onPress={() => onChange(o.value)}
						style={{
							paddingVertical: 5,
							paddingHorizontal: 11,
							borderRadius: 6,
							borderWidth: StyleSheet.hairlineWidth,
							borderColor: on ? p.primary : p.border,
							backgroundColor: on ? p.primary : p.card,
							opacity: off ? 0.5 : 1,
						}}
					>
						<Txt variant="small" color={on ? p.primaryForeground : p.foreground} style={{ fontWeight: "600" }}>
							{o.label}
						</Txt>
					</Pressable>
				);
			})}
		</View>
	);
}

export function OnOff({ on, disabled, onChange, offDisabled }: { on: boolean; disabled?: boolean; onChange(on: boolean): void; offDisabled?: boolean }) {
	return (
		<ChoiceChips
			options={[
				{ value: "on", label: "On" },
				{ value: "off", label: "Off" },
			]}
			value={[on ? "on" : "off"]}
			disabled={disabled}
			disabledOptions={offDisabled ? ["off"] : []}
			onChange={(v) => onChange(v === "on")}
		/>
	);
}

const SOURCE_TEXT: Record<SettingSource, string> = { dashboard: "Dashboard", env: "Env", default: "Default" };

export function SourceBadge({ source }: { source: SettingSource }) {
	return <Badge label={SOURCE_TEXT[source]} tone={source === "dashboard" ? "brand" : "muted"} />;
}
