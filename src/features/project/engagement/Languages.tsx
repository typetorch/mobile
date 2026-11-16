/**
 * Localization > Languages: the source language and supported languages (public), add / remove a language, set the
 * source language, and per language the automatic translation, image translation and "translate experience info"
 * switches (legacy-universe:manage). Roblox's translation quota and counts are cookie-only, so they aren't shown.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, confirm, ErrorState, KV, List, notify, Row, SearchBar, Section, SkeletonList, Txt } from "@/components/ui";
import {
	automaticTranslationStatus,
	creatorLanguages,
	displayInfoAutoTranslation,
	editSupportedLanguages,
	ENG_SCOPES,
	setSourceLanguage,
	setTranslationSwitch,
	type TranslationSwitch,
} from "@/features/project/api/engagement";
import { SwitchRow, useLanguages } from "@/features/project/engagement/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";

export function Languages({ universeId, cloud, canManage }: { universeId: number; cloud: OpenCloud; canManage: boolean }) {
	const queryClient = useQueryClient();
	const langs = useLanguages(universeId);
	const [adding, setAdding] = useState(false);
	const [search, setSearch] = useState("");

	const auto = useQuery({ queryKey: ["oc", "i18n", universeId, "auto"], queryFn: () => automaticTranslationStatus(cloud, universeId), enabled: canManage, retry: false });
	const display = useQuery({ queryKey: ["oc", "i18n", universeId, "displayAuto"], queryFn: () => displayInfoAutoTranslation(cloud, universeId), enabled: canManage, retry: false });
	const all = useQuery({ queryKey: ["creatorLanguages"], queryFn: creatorLanguages, enabled: adding, staleTime: 3600_000, retry: false });

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: ["i18n", universeId] });
		queryClient.invalidateQueries({ queryKey: ["oc", "i18n", universeId] });
	};
	const edit = useMutation({
		mutationFn: (args: { languageCode: string; languageCodeType?: "Language" | "Locale"; delete: boolean }) => editSupportedLanguages(cloud, universeId, [args]),
		onSuccess: invalidate,
		onError: (e) => notify("Couldn't change languages", cloudErrorText(e)),
	});
	const source = useMutation({
		mutationFn: (code: string) => setSourceLanguage(cloud, universeId, code),
		onSuccess: invalidate,
		onError: (e) => notify("Couldn't set the source language", cloudErrorText(e)),
	});
	const flip = useMutation({
		mutationFn: (args: { code: string; which: TranslationSwitch; on: boolean }) => setTranslationSwitch(cloud, universeId, args.code, args.which, args.on),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oc", "i18n", universeId] }),
		onError: (e) => notify("Couldn't change the setting", cloudErrorText(e)),
	});

	if (langs.error) return <ErrorState error={langs.error} onRetry={() => langs.refetch()} />;
	if (langs.loading) return <SkeletonList rows={3} />;

	const autoBy = new Map((auto.data ?? []).map((a) => [a.languageCode, a]));
	const displayBy = new Map((display.data ?? []).map((d) => [d.languageCode, d.isUniverseDisplayInfoAutomaticTranslationEnabled]));
	const others = langs.codes.filter((c) => c !== langs.sourceCode);
	const busy = (code: string, which: TranslationSwitch) => flip.isPending && flip.variables?.code === code && flip.variables.which === which;
	const candidates = (all.data ?? []).filter((l) => !langs.codes.includes(l.languageCode)).filter((l) => !search.trim() || `${l.name} ${l.nativeName} ${l.languageCode}`.toLowerCase().includes(search.trim().toLowerCase()));

	return (
		<>
			<Card>
				<KV label="Source language" value={langs.source.data ? `${langs.source.data.name} (${langs.source.data.languageCode})` : "–"} />
				<KV label="Supported languages" value={String(langs.codes.length)} />
			</Card>
			{canManage && (auto.error || display.error) ? <CloudError error={auto.error ?? display.error} what="Automatic translation" onRetry={() => Promise.all([auto.refetch(), display.refetch()])} /> : null}
			<Section title="Languages">
				{others.length ? (
					others.map((code) => {
						const a = autoBy.get(code);
						return (
							<Card key={code} style={{ gap: 4 }}>
								<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
									<Txt style={{ fontWeight: "600" }}>
										{langs.nameOf(code)} <Txt variant="small">{code}</Txt>
									</Txt>
									{canManage ? (
										<View style={{ flexDirection: "row", gap: 6 }}>
											<Button
												title="Make source"
												small
												loading={source.isPending && source.variables === code}
												onPress={async () => {
													if (await confirm(`Make ${langs.nameOf(code)} the source language?`, "Your name, description and strings are then treated as written in it. Roblox turns automatic translation off for languages where it no longer applies.", "Change")) source.mutate(code);
												}}
											/>
											<Button
												title="Remove"
												small
												variant="destructive"
												loading={edit.isPending && edit.variables?.languageCode === code && edit.variables.delete}
												onPress={async () => {
													if (await confirm(`Remove ${langs.nameOf(code)}?`, "Players with that language see the source language. Its translations stop showing.", "Remove")) {
														// Remove under the entry's own type: a Locale entry sent as "Language" isn't the same entry.
														const type = langs.supported.data?.find((l) => l.languageCode === code)?.languageCodeType;
														edit.mutate({ languageCode: code, languageCodeType: type, delete: true });
													}
												}}
											/>
										</View>
									) : null}
								</View>
								{canManage && a ? (
									<>
										<SwitchRow label="Automatic translation" hint="Roblox translates in-game text." value={a.isAutomaticTranslationEnabled} disabled={busy(code, "automatic-translation-status")} onChange={(on) => flip.mutate({ code, which: "automatic-translation-status", on })} />
										<SwitchRow label="Image translation" value={!!a.isImageTranslationEnabled} disabled={busy(code, "image-translation-status")} onChange={(on) => flip.mutate({ code, which: "image-translation-status", on })} />
									</>
								) : null}
								{canManage && displayBy.has(code) ? (
									<SwitchRow
										label="Translate experience info"
										hint="Name, description and place info."
										value={!!displayBy.get(code)}
										disabled={busy(code, "universe-display-info-automatic-translation-settings")}
										onChange={(on) => flip.mutate({ code, which: "universe-display-info-automatic-translation-settings", on })}
									/>
								) : null}
							</Card>
						);
					})
				) : (
					<Txt variant="muted">Only the source language so far.</Txt>
				)}
				{!canManage ? <Txt variant="small">Add {ENG_SCOPES.legacyUniverse} to add or remove languages and switch automatic translation.</Txt> : null}
			</Section>
			{canManage ? (
				adding ? (
					<Section title="Add a language" right={<Button title="Done" small variant="ghost" onPress={() => setAdding(false)} />}>
						<SearchBar value={search} onChangeText={setSearch} placeholder="Search languages" />
						{all.error ? (
							<ErrorState error={all.error} onRetry={() => all.refetch()} />
						) : !all.data ? (
							<SkeletonList rows={3} />
						) : (
							<List>
								{candidates.slice(0, 40).map((l) => (
									<Row
										key={l.languageCode}
										title={`${l.name} · ${l.nativeName}`}
										subtitle={l.languageCode}
										right={<Button title="Add" small loading={edit.isPending && edit.variables?.languageCode === l.languageCode} onPress={() => edit.mutate({ languageCode: l.languageCode, delete: false })} />}
									/>
								))}
							</List>
						)}
					</Section>
				) : (
					<Button title="Add a language" icon="add" onPress={() => setAdding(true)} style={{ alignSelf: "flex-start" }} />
				)
			) : null}
		</>
	);
}
