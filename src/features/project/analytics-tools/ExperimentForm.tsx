/**
 * The experiment editor (create, and edit while a draft): name, description, the config key every variant overrides,
 * the variants (label, weight, value; exactly one baseline), exposure, duration and goal metric. Matchmaking
 * experiments keep their configuration as it is (edit it on Creator Hub); targeting is kept as it is.
 */
import { useState } from "react";
import { View } from "react-native";

import { Button, Card, Chips, Field, Txt } from "@/components/ui";
import { useTheme } from "@/theme";

import { EXPERIMENT_METRICS, type ExperimentInput, type ProductExperiment, type UniverseExperimentMetric } from "../api/analytics-tools";

interface VariantDraft {
	label: string;
	weight: string;
	value: string;
	variantId?: string | null;
}

const LABEL = /^[A-Za-z][A-Za-z0-9 _-]{0,49}$/;

function valueText(v: unknown): string {
	if (v === undefined) return "";
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}

export function ExperimentForm({ initial, busy, submitTitle, onSubmit }: { initial?: ProductExperiment | null; busy: boolean; submitTitle: string; onSubmit: (input: ExperimentInput) => void }) {
	const p = useTheme();
	const config = initial?.experimentConfiguration ?? null;
	const matchmaking = config?.productType === "EXPERIMENT_PRODUCT_TYPE_MATCHMAKING";
	const inGame = config?.inGameConfigExperimentConfiguration?.variants ?? [];
	const baselineFirst = inGame.slice().sort((a, b) => Number(!!b.variantMeta?.isBaseline) - Number(!!a.variantMeta?.isBaseline));

	const [name, setName] = useState(initial?.name ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [key, setKey] = useState(inGame.find((v) => v.configEntry?.key)?.configEntry?.key ?? "");
	const [variants, setVariants] = useState<VariantDraft[]>(
		baselineFirst.length
			? baselineFirst.map((v) => ({ label: v.variantMeta?.label ?? "", weight: String(v.variantMeta?.weight ?? 50), value: v.configEntry ? valueText(v.configEntry.entryValue) : "", variantId: v.variantMeta?.variantId }))
			: [
					{ label: "Control", weight: "50", value: "" },
					{ label: "Treatment A", weight: "50", value: "" },
				],
	);
	const [exposure, setExposure] = useState(String(initial?.exposurePercent ?? 100));
	const [days, setDays] = useState(String(initial?.durationSeconds ? Math.max(1, Math.round(initial.durationSeconds / 86_400)) : 14));
	const [goal, setGoal] = useState<UniverseExperimentMetric>(initial?.universeMetricConfiguration?.goalMetric ?? "UNIVERSE_EXPERIMENT_METRIC_AVERAGE_SESSION_TIME");
	const [error, setError] = useState<string | null>(null);

	const setVariant = (i: number, patch: Partial<VariantDraft>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));

	function submit() {
		const n = name.trim();
		if (!n) return setError("Give the experiment a name.");
		const exp = Number(exposure);
		if (!Number.isInteger(exp) || exp < 1 || exp > 100) return setError("Exposure is a whole percent from 1 to 100.");
		const d = Number(days);
		if (!Number.isInteger(d) || d < 1 || d > 365) return setError("Duration is a whole number of days (1-365).");
		let configuration = config ?? undefined;
		if (!matchmaking) {
			const k = key.trim();
			if (!k) return setError("Name the config key the variants override.");
			if (variants.length < 2) return setError("An experiment needs a baseline and at least one variant.");
			if (variants.length > 10) return setError("At most 10 variants.");
			const labels = new Set<string>();
			const out: NonNullable<NonNullable<ExperimentInput["experimentConfiguration"]["inGameConfigExperimentConfiguration"]>["variants"]> = [];
			for (const [i, v] of variants.entries()) {
				const label = v.label.trim();
				if (!LABEL.test(label)) return setError(`Variant ${i + 1}: a label starts with a letter, at most 50 letters, digits, spaces, _ or -.`);
				if (labels.has(label.toLowerCase())) return setError(`Two variants are called “${label}”.`);
				labels.add(label.toLowerCase());
				const w = Number(v.weight);
				if (!Number.isInteger(w) || w < 1 || w > 100) return setError(`${label}: the weight is a whole number from 1 to 100.`);
				let entryValue: unknown = undefined;
				if (v.value.trim()) {
					try {
						entryValue = JSON.parse(v.value);
					} catch {
						return setError(`${label}: the value is JSON (strings in "quotes").`);
					}
				} else if (i > 0) return setError(`${label}: give the value this variant sets.`);
				out.push({
					variantMeta: { label, weight: w, isBaseline: i === 0, ...(v.variantId ? { variantId: v.variantId } : {}) },
					...(entryValue !== undefined ? { configEntry: { key: k, entryValue } } : {}),
				});
			}
			configuration = { productType: "EXPERIMENT_PRODUCT_TYPE_IN_GAME_CONFIGS", inGameConfigExperimentConfiguration: { variants: out } };
		}
		if (!configuration) return setError("This experiment has no configuration to keep.");
		setError(null);
		onSubmit({
			name: n,
			description: description.trim(),
			experimentConfiguration: configuration,
			exposurePercent: exp,
			targetingCriteria: initial?.targetingCriteria ?? null,
			durationSeconds: d * 86_400,
			universeGoalMetric: goal,
		});
	}

	return (
		<Card style={{ gap: 8 }}>
			<Field label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" />
			<Field label="Description" value={description} onChangeText={setDescription} autoCapitalize="sentences" />
			{matchmaking ? (
				<Txt variant="small">Matchmaking experiment: its variants stay as they are (edit them on Creator Hub).</Txt>
			) : (
				<>
					<Field label="Config key" value={key} onChangeText={setKey} placeholder="ShopPriceMultiplier" hint="An entry of the In-experience config repository; read it in game with ConfigService." />
					<Txt variant="label">Variants (the first is the baseline)</Txt>
					{variants.map((v, i) => (
						<View key={i} style={{ gap: 6, paddingVertical: 4 }}>
							<View style={{ flexDirection: "row", gap: 8 }}>
								<View style={{ flex: 2 }}>
									<Field value={v.label} onChangeText={(t) => setVariant(i, { label: t })} placeholder={i === 0 ? "Control" : `Treatment ${String.fromCharCode(64 + i)}`} maxLength={50} autoCapitalize="words" />
								</View>
								<View style={{ flex: 1 }}>
									<Field value={v.weight} onChangeText={(t) => setVariant(i, { weight: t })} keyboardType="number-pad" placeholder="Weight" />
								</View>
								{i >= 2 ? <Button title="" icon="close" small variant="ghost" onPress={() => setVariants((vs) => vs.filter((_, j) => j !== i))} /> : null}
							</View>
							<Field value={v.value} onChangeText={(t) => setVariant(i, { value: t })} placeholder={i === 0 ? "Value (optional: the published value when empty)" : "Value as JSON, e.g. 1.5 or \"blue\""} />
						</View>
					))}
					{variants.length < 10 ? <Button title="Add variant" icon="add" small onPress={() => setVariants((vs) => [...vs, { label: `Treatment ${String.fromCharCode(64 + vs.length)}`, weight: "50", value: "" }])} style={{ alignSelf: "flex-start" }} /> : null}
				</>
			)}
			<View style={{ flexDirection: "row", gap: 8 }}>
				<View style={{ flex: 1 }}>
					<Field label="Exposure %" value={exposure} onChangeText={setExposure} keyboardType="number-pad" />
				</View>
				<View style={{ flex: 1 }}>
					<Field label="Duration (days)" value={days} onChangeText={setDays} keyboardType="number-pad" />
				</View>
			</View>
			<Txt variant="label">Goal metric</Txt>
			<Chips options={EXPERIMENT_METRICS} value={goal} onChange={setGoal} />
			<Button title={submitTitle} variant="primary" icon="checkmark" small loading={busy} onPress={submit} style={{ alignSelf: "flex-start" }} />
			{busy ? <Txt variant="small">Roblox applies experiment changes in the background; waiting for it (up to 30 s)…</Txt> : null}
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : null}
		</Card>
	);
}
