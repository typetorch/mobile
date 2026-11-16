/**
 * Localization > Tools: Roblox's translator (translateText, universe:write, BETA) for any text into the languages it
 * supports, and text to speech (generateSpeechAsset, universe:write + asset:read + asset:write, BETA): it creates an
 * English audio asset on the key owner's account and uses the monthly quota, so it asks first. The operation is
 * polled a bounded number of times.
 */
import { useMutation } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, Chips, confirm, Field, KV, notify, Row, List, Txt } from "@/components/ui";
import { ENG_SCOPES, generateSpeechAsset, translateText, TRANSLATE_LANGUAGES } from "@/features/project/api/engagement";
import { cloudErrorText } from "@/features/project/CloudError";
import { useTheme } from "@/theme";

export function TextTools({ universeId, cloud, can }: { universeId: number; cloud: OpenCloud; can: (scope: string) => boolean }) {
	return (
		<>
			{can(ENG_SCOPES.universeWrite) ? <Translate universeId={universeId} cloud={cloud} /> : <Txt variant="small">Add {ENG_SCOPES.universeWrite} to use Roblox's translator.</Txt>}
			{can(ENG_SCOPES.universeWrite) && can(ENG_SCOPES.assetRead) && can(ENG_SCOPES.assetWrite) ? (
				<Speech universeId={universeId} cloud={cloud} />
			) : (
				<Txt variant="small">Text to speech needs {ENG_SCOPES.universeWrite}, {ENG_SCOPES.assetRead} and {ENG_SCOPES.assetWrite} on the key.</Txt>
			)}
		</>
	);
}

function Translate({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const [text, setText] = useState("");
	const [source, setSource] = useState<string>("");
	const [targets, setTargets] = useState<string[]>(["es-es", "pt-br"]);
	const [error, setError] = useState<string | null>(null);
	const run = useMutation({
		mutationFn: () => translateText(cloud, universeId, text.trim(), targets, source || undefined),
		onError: (e) => notify("Translation failed", cloudErrorText(e)),
	});
	const toggle = (code: string) => setTargets((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">Translate text</Txt>
			<Field value={text} onChangeText={setText} placeholder="Text to translate" multiline autoCapitalize="sentences" style={{ fontFamily: undefined, minHeight: 70 }} />
			<Txt variant="label">From</Txt>
			<Chips options={[{ value: "", label: "Detect" }, ...TRANSLATE_LANGUAGES.map((l) => ({ value: l.value as string, label: l.label }))]} value={source} onChange={setSource} />
			<Txt variant="label">Into ({targets.length})</Txt>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
				{TRANSLATE_LANGUAGES.filter((l) => l.value !== source).map((l) => (
					<Button key={l.value} title={l.label} small variant={targets.includes(l.value) ? "brand" : "secondary"} onPress={() => toggle(l.value)} />
				))}
			</View>
			{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
			<Button
				title="Translate"
				icon="language-outline"
				small
				variant="brand"
				loading={run.isPending}
				onPress={() => {
					setError(!text.trim() ? "Write some text." : !targets.length ? "Pick at least one language." : null);
					if (text.trim() && targets.length) run.mutate();
				}}
				style={{ alignSelf: "flex-start" }}
			/>
			{run.data ? (
				<>
					<Txt variant="small">Source: {run.data.sourceLanguageCode ?? "?"}</Txt>
					<List>
						{Object.entries(run.data.translations ?? {}).map(([code, t]) => (
							<Row key={code} title={t} subtitle={TRANSLATE_LANGUAGES.find((l) => l.value === code)?.label ?? code} numberOfLines={4} right={<Button title="Copy" small variant="ghost" onPress={() => Clipboard.setStringAsync(t)} />} />
						))}
					</List>
				</>
			) : null}
		</Card>
	);
}

function Speech({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const p = useTheme();
	const [text, setText] = useState("");
	const [voiceId, setVoiceId] = useState("1");
	const [pitch, setPitch] = useState("");
	const [speed, setSpeed] = useState("");
	const [error, setError] = useState<string | null>(null);
	const run = useMutation({
		mutationFn: (input: { text: string; voiceId?: string; pitch?: number; speed?: number }) => generateSpeechAsset(cloud, universeId, input, { maxPolls: 15, pollMs: 1500 }),
		onError: (e) => notify("Speech generation failed", cloudErrorText(e)),
	});

	function num(textValue: string, what: string): number | undefined | Error {
		if (!textValue.trim()) return undefined;
		const n = Number(textValue);
		if (!Number.isFinite(n) || n <= 0) return new Error(`${what} must be a positive number.`);
		return n;
	}

	async function onGenerate() {
		setError(null);
		if (!text.trim()) return setError("Write the text to speak.");
		if (voiceId.trim() && !/^\d+$/.test(voiceId.trim())) return setError("The voice id is a number (see Roblox's TextToSpeech voice list).");
		const pi = num(pitch, "Pitch");
		const sp = num(speed, "Speed");
		if (pi instanceof Error) return setError(pi.message);
		if (sp instanceof Error) return setError(sp.message);
		if (await confirm("Create a speech audio asset?", `An English audio asset of “${text.trim().slice(0, 80)}${text.trim().length > 80 ? "…" : ""}” is created on your account and counts against the monthly text-to-speech quota.`, "Create", false))
			run.mutate({ text: text.trim(), voiceId: voiceId.trim() || undefined, pitch: pi, speed: sp });
	}

	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="h3">Text to speech</Txt>
			<Txt variant="small">Makes an English MP3 audio asset for NPC lines or narration.</Txt>
			<Field value={text} onChangeText={setText} placeholder="What the voice says" multiline autoCapitalize="sentences" style={{ fontFamily: undefined, minHeight: 70 }} />
			<View style={{ flexDirection: "row", gap: 8 }}>
				<View style={{ flex: 1 }}>
					<Field label="Voice id" value={voiceId} onChangeText={setVoiceId} keyboardType="number-pad" />
				</View>
				<View style={{ flex: 1 }}>
					<Field label="Pitch" value={pitch} onChangeText={setPitch} placeholder="default" keyboardType="decimal-pad" />
				</View>
				<View style={{ flex: 1 }}>
					<Field label="Speed" value={speed} onChangeText={setSpeed} placeholder="default" keyboardType="decimal-pad" />
				</View>
			</View>
			{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
			<Button title={run.isPending ? "Generating…" : "Generate asset"} icon="mic-outline" small variant="brand" loading={run.isPending} onPress={onGenerate} style={{ alignSelf: "flex-start" }} />
			{run.data ? (
				<>
					<KV label="Audio asset id" value={run.data.assetId} mono />
					{run.data.remainingQuota !== undefined ? <KV label="Quota left this month" value={String(run.data.remainingQuota)} /> : null}
					<Button title="Copy asset id" icon="copy-outline" small onPress={() => Clipboard.setStringAsync(run.data!.assetId)} style={{ alignSelf: "flex-start" }} />
				</>
			) : null}
		</Card>
	);
}
