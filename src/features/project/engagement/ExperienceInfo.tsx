/**
 * Localization > Experience info: the experience's name and description in every language (public), edit a
 * translation (legacy-universe:manage; Roblox may accept one field and refuse the other, so each failure is shown),
 * its translation history, and a "Translate" pre-fill from Roblox's translator (universe:write). The source-language
 * name and description are changed in Experience settings (the root place).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, ErrorState, Field, notify, SkeletonList, Txt } from "@/components/ui";
import { ENG_SCOPES, EXPERIENCE_DESCRIPTION_MAX, EXPERIENCE_NAME_MAX, experienceNameDescriptions, translateText, TRANSLATE_LANGUAGES, updateExperienceNameDescription } from "@/features/project/api/engagement";
import { TranslationHistory } from "@/features/project/engagement/History";
import { LanguageChips, useLanguages } from "@/features/project/engagement/shared";
import { cloudErrorText } from "@/features/project/CloudError";
import { useTheme } from "@/theme";

/** A supported-language code ("fr") to a translateText code ("fr-fr"), when translateText supports it. */
export function translateCode(code: string): string | null {
	const lower = code.toLowerCase();
	const exact = TRANSLATE_LANGUAGES.find((l) => l.value === lower);
	if (exact) return exact.value;
	if (lower === "zh-hans") return "zh-cn";
	if (lower === "zh-hant") return "zh-tw";
	return TRANSLATE_LANGUAGES.find((l) => l.value.split("-")[0] === lower.split("-")[0] && !l.value.startsWith("zh"))?.value ?? null;
}

export function ExperienceInfo({ universeId, cloud, canManage, canTranslate }: { universeId: number; cloud: OpenCloud; canManage: boolean; canTranslate: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const langs = useLanguages(universeId);
	const q = useQuery({ queryKey: ["i18n", universeId, "nameDescription"], queryFn: () => experienceNameDescriptions(universeId), retry: false });
	const [lang, setLang] = useState("");
	const active = lang || langs.codes[0] || "";
	const row = q.data?.find((r) => r.languageCode === active);
	const source = q.data?.find((r) => r.languageCode === langs.sourceCode);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [editing, setEditing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// A language switch closes the form; a refetch only refreshes the fields while the form is closed, so a partly
	// saved edit keeps the draft of the field Roblox refused.
	useEffect(() => {
		setEditing(false);
	}, [active]);
	useEffect(() => {
		if (editing) return;
		setName(row?.name ?? "");
		setDescription(row?.description ?? "");
	}, [active, row?.name, row?.description, editing]);

	const save = useMutation({
		mutationFn: () => updateExperienceNameDescription(cloud, universeId, active, { ...(name !== (row?.name ?? "") ? { name } : {}), ...(description !== (row?.description ?? "") ? { description } : {}) }),
		onSuccess: (r) => {
			queryClient.invalidateQueries({ queryKey: ["i18n", universeId, "nameDescription"] });
			const failed = r?.failedOperations ?? [];
			if (failed.length) {
				// The accepted field now matches the server; the refused one keeps the user's draft (the form stays open).
				const saved = r?.successOperations ?? [];
				if (saved.some((s) => s.updateType === "Name")) setName(saved.find((s) => s.updateType === "Name")?.name ?? name);
				if (saved.some((s) => s.updateType === "Description")) setDescription(saved.find((s) => s.updateType === "Description")?.description ?? description);
				notify("Partly saved", failed.map((f) => `${f.languageCode}: error ${f.errorCode}${f.errorCode === 20 ? " (moderated)" : f.errorCode === 19 ? " (empty or too long)" : ""}`).join("\n"));
			} else setEditing(false);
		},
		onError: (e) => notify("Save failed", cloudErrorText(e)),
	});
	const translate = useMutation({
		mutationFn: async () => {
			const target = translateCode(active);
			if (!target) throw new Error(`Roblox's translator doesn't support ${active}.`);
			const src = langs.sourceCode ? translateCode(langs.sourceCode) ?? undefined : undefined;
			const [n, d] = await Promise.all([
				source?.name ? translateText(cloud, universeId, source.name, [target], src) : null,
				source?.description ? translateText(cloud, universeId, source.description, [target], src) : null,
			]);
			return { name: n?.translations?.[target], description: d?.translations?.[target] };
		},
		onSuccess: (r) => {
			if (r.name !== undefined) setName(r.name.slice(0, EXPERIENCE_NAME_MAX));
			if (r.description !== undefined) setDescription(r.description.slice(0, EXPERIENCE_DESCRIPTION_MAX));
		},
		onError: (e) => notify("Translation failed", cloudErrorText(e)),
	});

	function onSave() {
		setError(null);
		if (!name.trim()) return setError("The name can't be empty.");
		if (name.length > EXPERIENCE_NAME_MAX) return setError(`The name is ${name.length} characters; the limit is ${EXPERIENCE_NAME_MAX}.`);
		if (description.length > EXPERIENCE_DESCRIPTION_MAX) return setError(`The description is ${description.length} characters; the limit is ${EXPERIENCE_DESCRIPTION_MAX}.`);
		if (name === (row?.name ?? "") && description === (row?.description ?? "")) return setEditing(false);
		save.mutate();
	}

	if (q.error || langs.error) return <ErrorState error={q.error ?? langs.error} onRetry={() => Promise.all([q.refetch(), langs.refetch()])} />;
	if (!q.data || langs.loading) return <SkeletonList rows={2} />;
	const isSource = active === langs.sourceCode;

	return (
		<>
			<LanguageChips codes={langs.codes} value={active} onChange={setLang} nameOf={langs.nameOf} sourceCode={langs.sourceCode} />
			{editing ? (
				<Card style={{ gap: 8 }}>
					<Field label={`Name (${langs.nameOf(active)})`} value={name} onChangeText={setName} maxLength={EXPERIENCE_NAME_MAX} autoCapitalize="sentences" hint={`${name.length} / ${EXPERIENCE_NAME_MAX}`} />
					<Field label="Description" value={description} onChangeText={setDescription} multiline maxLength={EXPERIENCE_DESCRIPTION_MAX} autoCapitalize="sentences" hint={`${description.length} / ${EXPERIENCE_DESCRIPTION_MAX}`} style={{ fontFamily: undefined }} />
					{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
					<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
						<Button title="Save" variant="brand" small loading={save.isPending} onPress={onSave} />
						{canTranslate ? <Button title="Translate from source" icon="language-outline" small loading={translate.isPending} onPress={() => translate.mutate()} /> : null}
						<Button title="Cancel" small onPress={() => setEditing(false)} />
					</View>
				</Card>
			) : (
				<Card style={{ gap: 6 }}>
					<Txt variant="h3">{row?.name || "(not translated)"}</Txt>
					<Txt selectable variant={row?.description ? "body" : "muted"}>
						{row?.description || "No description in this language."}
					</Txt>
					{isSource ? (
						<Txt variant="small">The source language is edited in Experience settings.</Txt>
					) : canManage ? (
						<Button title="Edit translation" icon="create-outline" small onPress={() => setEditing(true)} style={{ alignSelf: "flex-start" }} />
					) : (
						<Txt variant="small">Add {ENG_SCOPES.legacyUniverse} to edit translations.</Txt>
					)}
				</Card>
			)}
			{canManage && !isSource && active ? (
				<>
					<TranslationHistory key={`n-${active}`} cloud={cloud} contentId={universeId} contentType="UniverseDisplayNames" languageCode={active} label="Name" />
					<TranslationHistory key={`d-${active}`} cloud={cloud} contentId={universeId} contentType="UniverseDisplayDescriptions" languageCode={active} label="Description" />
				</>
			) : null}
		</>
	);
}
