/**
 * Localization > Localization table: the experience's auto-localization table and its settings, the table's entries
 * (text captured in game) with their translations per language, edit / delete a translation, delete an entry, an
 * entry's translation history, the entry count and Roblox's limits. legacy-universe:manage.
 *
 * Roblox has no read-only "get the experience's table" for API keys: the POST autolocalizationtable answers the table
 * and settings but creates the table when there is none, so the screen asks before calling it.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Button, Card, Chips, confirm, EmptyState, Field, KV, List, notify, Row, SearchBar, Section, Skeleton, SkeletonList, Txt } from "@/components/ui";
import {
	autoLocalizationTable,
	entryTranslationHistory,
	localizationEntries,
	localizationLimits,
	localizationTable,
	localizationTableCount,
	patchLocalizationTable,
	setAutoLocalizationSettings,
	type AutoLocalizationPatch,
	type TableEntry,
} from "@/features/project/api/engagement";
import { SwitchRow, useLanguages } from "@/features/project/engagement/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { fmtTime } from "@/lib/format";
import { useTheme } from "@/theme";

const SETTINGS: { key: keyof AutoLocalizationPatch; label: string; hint?: string }[] = [
	{ key: "isAutolocalizationEnabled", label: "Capture text automatically", hint: "Roblox collects strings players see in game." },
	{ key: "isAutomaticEntriesSettingEnabled", label: "Add captured text to the table", hint: "Needs automatic capture on." },
	{ key: "isAutomaticEntriesDeletionsEnabled", label: "Remove entries no longer seen" },
	{ key: "shouldUseLocalizationTable", label: "Use translated text in experience" },
	{ key: "isAutoLocalizationForImageEnabled", label: "Capture images" },
	{ key: "shouldUseImageLocalizationTable", label: "Use translated images in experience" },
];

export function LocalizationTable({ universeId, cloud }: { universeId: number; cloud: OpenCloud }) {
	const queryClient = useQueryClient();
	const [loaded, setLoaded] = useState(false);
	const table = useQuery({ queryKey: ["oc", "i18n-table", universeId, "auto"], queryFn: () => autoLocalizationTable(cloud, universeId), enabled: loaded, retry: false, staleTime: 60_000 });
	const [draft, setDraft] = useState<AutoLocalizationPatch | null>(null);
	useEffect(() => {
		const t = table.data;
		if (t)
			setDraft({
				isAutolocalizationEnabled: !!t.isAutolocalizationEnabled,
				isAutomaticEntriesSettingEnabled: !!t.isAutomaticEntriesSettingEnabled,
				isAutomaticEntriesDeletionsEnabled: !!t.isAutomaticEntriesDeletionEnabled,
				shouldUseLocalizationTable: !!t.shouldUseLocalizationTable,
				shouldUseImageLocalizationTable: !!t.shouldUseImageLocalizationTable,
				isAutoLocalizationForImageEnabled: !!t.isAutoLocalizationForImageEnabled,
			});
	}, [table.data]);
	const save = useMutation({
		mutationFn: (s: AutoLocalizationPatch) => setAutoLocalizationSettings(cloud, universeId, s),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oc", "i18n-table", universeId, "auto"] }),
		onError: (e) => notify("Save failed", cloudErrorText(e)),
	});

	if (!loaded)
		return (
			<EmptyState
				icon="document-text-outline"
				title="Auto-localization table"
				body="Roblox's only way to read the table with an API key also creates one when the experience has none."
				action={
					<Button
						title="Open the table"
						variant="brand"
						onPress={async () => {
							if (await confirm("Open the auto-localization table?", "If the experience has no auto-localization table yet, Roblox creates an empty one.", "Open", false)) setLoaded(true);
						}}
					/>
				}
			/>
		);
	if (table.error) return <CloudError error={table.error} what="The localization table" onRetry={() => table.refetch()} />;
	if (!table.data || !draft) return <SkeletonList rows={3} />;
	const t = table.data;
	const changed = SETTINGS.some((s) => {
		const old = s.key === "isAutomaticEntriesDeletionsEnabled" ? t.isAutomaticEntriesDeletionEnabled : t[s.key as keyof typeof t];
		return !!old !== draft[s.key];
	});

	/** Every save asks first, naming the switches that delete entries or change what live players see. */
	async function onSaveSettings() {
		if (!draft) return;
		const effects: string[] = [];
		if (draft.isAutomaticEntriesDeletionsEnabled && !t.isAutomaticEntriesDeletionEnabled) effects.push("Roblox will delete table entries it no longer sees in game, with their translations.");
		if (!draft.shouldUseLocalizationTable && t.shouldUseLocalizationTable) effects.push("Live players stop seeing the table's translated text.");
		if (draft.shouldUseLocalizationTable && !t.shouldUseLocalizationTable) effects.push("Live players start seeing the table's translated text.");
		if (!draft.shouldUseImageLocalizationTable && t.shouldUseImageLocalizationTable) effects.push("Live players stop seeing translated images.");
		if (draft.shouldUseImageLocalizationTable && !t.shouldUseImageLocalizationTable) effects.push("Live players start seeing translated images.");
		const risky = effects.length > 0;
		const body = risky ? effects.join("\n") : "The auto-localization settings change for every server.";
		if (await confirm("Save the localization settings?", body, "Save", draft.isAutomaticEntriesDeletionsEnabled && !t.isAutomaticEntriesDeletionEnabled)) save.mutate(draft);
	}

	return (
		<>
			<Section title="Settings">
				<Card>
					{SETTINGS.map((s) => (
						<SwitchRow key={s.key} label={s.label} hint={s.hint} value={draft[s.key]} onChange={(v) => setDraft((d) => (d ? { ...d, [s.key]: v, ...(s.key === "isAutolocalizationEnabled" && !v ? { isAutomaticEntriesSettingEnabled: false } : {}) } : d))} />
					))}
					{changed ? <Button title="Save settings" variant="brand" small loading={save.isPending} onPress={onSaveSettings} style={{ alignSelf: "flex-start", marginTop: 6 }} /> : null}
				</Card>
			</Section>
			{t.autoLocalizationTableId ? <TableView universeId={universeId} cloud={cloud} tableId={t.autoLocalizationTableId} sourceLanguage={t.sourceLanguage} /> : <Txt variant="muted">No table id came back.</Txt>}
		</>
	);
}

function TableView({ universeId, cloud, tableId, sourceLanguage }: { universeId: number; cloud: OpenCloud; tableId: string; sourceLanguage?: string }) {
	const queryClient = useQueryClient();
	const langs = useLanguages(universeId);
	const info = useQuery({ queryKey: ["oc", "i18n-table", tableId, "info"], queryFn: () => localizationTable(cloud, tableId), retry: false });
	const count = useQuery({ queryKey: ["oc", "i18n-table", tableId, "count"], queryFn: () => localizationTableCount(cloud, tableId, universeId), retry: false });
	const limits = useQuery({ queryKey: ["oc", "i18n-limits"], queryFn: () => localizationLimits(cloud), retry: false, staleTime: 3600_000 });
	const entries = useInfiniteQuery({
		queryKey: ["oc", "i18n-table", tableId, "entries"],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => localizationEntries(cloud, tableId, universeId, pageParam),
		getNextPageParam: (last) => last.nextPageCursor || undefined,
		retry: false,
	});
	const rows = entries.data?.pages.flatMap((p) => p.data ?? []) ?? [];
	const locales = [...new Set([...rows.flatMap((r) => (r.translations ?? []).map((x) => x.locale)), ...langs.codes.filter((c) => c !== langs.sourceCode)])];
	const [locale, setLocale] = useState("");
	const active = locale || locales[0] || "";
	const [search, setSearch] = useState("");
	const [open, setOpen] = useState<number | null>(null);
	const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !search.trim() || `${r.identifier.key ?? ""} ${r.identifier.source ?? ""} ${r.identifier.context ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));

	return (
		<>
			<Card>
				<KV label="Table" value={info.data?.name ?? (info.error ? "–" : "…")} />
				<KV label="Table id" value={tableId} mono />
				{info.data ? <KV label="Asset id" value={String(info.data.assetId)} mono /> : null}
				<KV label="Entries" value={count.data ? count.data.entryCount.toLocaleString() : count.error ? "–" : "…"} />
				{sourceLanguage ? <KV label="Source language" value={sourceLanguage} /> : null}
				{limits.data?.tableOperationLimits?.maxEntriesPerUpdate ? <KV label="Max entries per update" value={String(limits.data.tableOperationLimits.maxEntriesPerUpdate)} /> : null}
				{limits.data?.entryOperationLimits?.maxSourceLength ? <KV label="Max source length" value={String(limits.data.entryOperationLimits.maxSourceLength)} /> : null}
			</Card>
			<Section title="Entries">
				{locales.length ? <Chips options={locales.map((l) => ({ value: l, label: langs.nameOf(l) }))} value={active} onChange={setLocale} /> : null}
				<SearchBar value={search} onChangeText={setSearch} placeholder="Search loaded entries" />
				{entries.error ? (
					<CloudError error={entries.error} what="Table entries" onRetry={() => entries.refetch()} />
				) : !entries.data ? (
					<SkeletonList rows={4} />
				) : shown.length ? (
					<List>
						{shown.map(({ r, i }) => {
							const tr = r.translations?.find((x) => x.locale === active);
							return (
								<View key={i}>
									<Row
										title={r.identifier.source || r.identifier.key || "(empty)"}
										subtitle={`${tr ? `→ ${tr.translationText}` : "not translated"}${r.identifier.context ? ` · ${r.identifier.context}` : ""}${r.identifier.key ? ` · key ${r.identifier.key}` : ""}`}
										numberOfLines={3}
										chevron
										onPress={() => setOpen(open === i ? null : i)}
									/>
									{open === i && active ? (
										<EntryEditor
											universeId={universeId}
											cloud={cloud}
											tableId={tableId}
											entry={r}
											locale={active}
											localeName={langs.nameOf(active)}
											onChanged={() => {
												queryClient.invalidateQueries({ queryKey: ["oc", "i18n-table", tableId] });
											}}
										/>
									) : null}
								</View>
							);
						})}
					</List>
				) : (
					<Txt variant="muted">{rows.length ? "No loaded entry matches." : "The table is empty."}</Txt>
				)}
				{entries.hasNextPage ? <Button title="Load more" small loading={entries.isFetchingNextPage} onPress={() => entries.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
			</Section>
		</>
	);
}

function EntryEditor({ universeId, cloud, tableId, entry, locale, localeName, onChanged }: { universeId: number; cloud: OpenCloud; tableId: string; entry: TableEntry; locale: string; localeName: string; onChanged: () => void }) {
	const p = useTheme();
	const current = entry.translations?.find((x) => x.locale === locale);
	const [text, setText] = useState(current?.translationText ?? "");
	const [showHistory, setShowHistory] = useState(false);
	useEffect(() => setText(current?.translationText ?? ""), [current?.translationText, locale]);
	const identifier = entry.identifier;

	const patch = useMutation({
		mutationFn: (kind: "save" | "deleteTranslation" | "deleteEntry") =>
			patchLocalizationTable(cloud, tableId, universeId, [
				kind === "deleteEntry" ? { identifier, delete: true } : { identifier, translations: [kind === "save" ? { locale, translationText: text.trim() } : { locale, delete: true }] },
			]),
		onSuccess: (r) => {
			const failed = r?.failedEntriesAndTranslations ?? [];
			if (failed.length) notify("Roblox refused it", failed.map((f) => f.error?.errorMessage ?? `error ${f.error?.errorCode}`).join("\n"));
			onChanged();
		},
		onError: (e) => notify("Save failed", cloudErrorText(e)),
	});
	const history = useQuery({ queryKey: ["oc", "i18n-table", tableId, "history", identifier, locale], queryFn: () => entryTranslationHistory(cloud, tableId, universeId, locale, identifier), enabled: showHistory, retry: false });
	const items = history.data?.entries?.[0]?.history ?? [];

	return (
		<Card style={{ gap: 8, marginHorizontal: 8, marginBottom: 8 }}>
			<Txt variant="small" selectable>
				Source: {identifier.source}
				{entry.metadata?.example ? `\nExample: ${entry.metadata.example}` : ""}
				{entry.metadata?.gameLocations?.length ? `\nSeen at: ${entry.metadata.gameLocations.map((g) => g.path).join(", ")}` : ""}
				{entry.createdTime ? `\nAdded ${fmtTime(entry.createdTime)}` : ""}
			</Txt>
			<Field label={`${localeName} translation`} value={text} onChangeText={setText} autoCapitalize="sentences" />
			<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
				<Button title="Save" small variant="brand" disabled={!text.trim() || text.trim() === (current?.translationText ?? "")} loading={patch.isPending && patch.variables === "save"} onPress={() => patch.mutate("save")} />
				{current ? (
					<Button
						title="Delete translation"
						small
						variant="destructive"
						loading={patch.isPending && patch.variables === "deleteTranslation"}
						onPress={async () => {
							if (await confirm(`Delete the ${localeName} translation?`, "Players see the source text (or an automatic translation) instead.", "Delete")) patch.mutate("deleteTranslation");
						}}
					/>
				) : null}
				<Button
					title="Delete entry"
					small
					variant="destructive"
					loading={patch.isPending && patch.variables === "deleteEntry"}
					onPress={async () => {
						if (await confirm("Delete this entry?", "The entry and all its translations are removed from the table.", "Delete")) patch.mutate("deleteEntry");
					}}
				/>
				<Button title="History" small variant="ghost" onPress={() => setShowHistory((v) => !v)} />
			</View>
			{showHistory ? (
				history.error ? (
					<CloudError error={history.error} what="Translation history" onRetry={() => history.refetch()} />
				) : !history.data ? (
					<Skeleton height={40} />
				) : items.length ? (
					items.map((h, i) => (
						<Txt key={i} variant="small" color={i === 0 ? p.foreground : undefined}>
							{fmtTime(h.created)} · {h.translator?.agentType === "Automation" ? "automatic" : `user ${h.translator?.id ?? "?"}`}: {h.translationText}
						</Txt>
					))
				) : (
					<Txt variant="small">No history for {localeName}.</Txt>
				)
			) : null}
		</Card>
	);
}
