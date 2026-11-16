/**
 * One virtual event: view, edit (a JSON-merge PATCH of the fields that changed), delete (confirm), or create one
 * (`?new=1`). Times are typed in local time ("YYYY-MM-DD HH:mm"). Event thumbnails are picked from the experience's
 * own thumbnails (their image ids): the virtual-events API takes media ids only and has no media upload (new images
 * go into the experience's thumbnails first, in Icon & thumbnails or on Creator Hub).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { gameDetails, universePlaces } from "@/api/roblox-public";
import { Badge, Button, Card, Chips, confirm, Field, KV, notify, Section, Segmented, Skeleton, Txt } from "@/components/ui";
import {
	categoryLabel,
	createEvent,
	deleteEvent,
	ENG_SCOPES,
	EVENT_CATEGORIES,
	gameMedia,
	gameThumbnailUrls,
	getEvent,
	parseLocalDateTime,
	toLocalDateTime,
	updateEvent,
	type EventCategory,
	type GameEvent,
	type GameEventFields,
} from "@/features/project/api/engagement";
import { SwitchRow } from "@/features/project/engagement/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtTime } from "@/lib/format";
import { useTheme } from "@/theme";

export default function EventScreen() {
	const { id, new: isNew } = useLocalSearchParams<{ id?: string; new?: string }>();
	const queryClient = useQueryClient();
	return (
		<ToolScreen title={isNew ? "New event" : "Event"} scopes={[ENG_SCOPES.eventRead]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "event"], type: "active" })}>
			{({ universeId, cloud, can }) => <EventView universeId={universeId} cloud={cloud} eventId={isNew ? null : String(id ?? "")} canWrite={can(ENG_SCOPES.eventWrite)} />}
		</ToolScreen>
	);
}

interface Draft {
	title: string;
	subtitle: string;
	description: string;
	start: string;
	end: string;
	visibility: "public" | "private";
	placeId: number | null;
	primary: EventCategory | "";
	secondary: EventCategory | "";
	thumbs: number[];
	featuring: boolean;
	tagline: string;
	asGroup: boolean;
}

function draftOf(e: GameEvent | null): Draft {
	const cats = [...(e?.categories ?? [])].sort((a, b) => a.rank - b.rank);
	const hour = 3_600_000;
	const nextHour = Math.ceil(Date.now() / hour) * hour;
	return {
		title: e?.title ?? "",
		subtitle: e?.subtitle ?? "",
		description: e?.description ?? "",
		start: e ? toLocalDateTime(e.startTime) : toLocalDateTime(new Date(nextHour + 24 * hour).toISOString()),
		end: e ? toLocalDateTime(e.endTime) : toLocalDateTime(new Date(nextHour + 26 * hour).toISOString()),
		visibility: e?.visibility === "private" ? "private" : "public",
		placeId: e?.placeId ?? null,
		primary: cats[0]?.category ?? "",
		secondary: cats[1]?.category ?? "",
		thumbs: [...(e?.thumbnails ?? [])].sort((a, b) => a.rank - b.rank).map((t) => t.mediaId),
		featuring: e?.featuringStatus === "enabled",
		tagline: e?.tagline ?? "",
		asGroup: true,
	};
}

function sameList(a: unknown[], b: unknown[]) {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}

function EventView({ universeId, cloud, eventId, canWrite }: { universeId: number; cloud: OpenCloud; eventId: string | null; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const creating = eventId === null;
	const [editing, setEditing] = useState(creating);
	const [draft, setDraft] = useState<Draft>(() => draftOf(null));
	const [formError, setFormError] = useState<string | null>(null);

	const event = useQuery({ queryKey: ["oc", "event", eventId], enabled: !creating && !!eventId, queryFn: () => getEvent(cloud, eventId!), retry: false });
	const places = useQuery({ queryKey: ["places", universeId], queryFn: () => universePlaces(universeId), staleTime: 300_000, retry: false });
	const game = useQuery({ queryKey: ["gameDetails", universeId], queryFn: async () => (await gameDetails([universeId]))[0] ?? null, staleTime: 300_000, retry: false });
	const media = useQuery({
		queryKey: ["gameMedia", universeId],
		queryFn: async () => {
			const items = (await gameMedia(universeId)).filter((m) => m.assetType === "Image" && m.imageId);
			const urls = await gameThumbnailUrls(universeId, items.map((m) => m.imageId!), "256x144").catch(() => ({}) as Record<number, string>);
			return { items, urls };
		},
		enabled: editing,
		staleTime: 300_000,
		retry: false,
	});

	useEffect(() => {
		if (event.data && !editing) setDraft(draftOf(event.data));
	}, [event.data, editing]);

	const groupId = game.data?.creator?.type === "Group" ? game.data.creator.id : null;

	const save = useMutation({
		mutationFn: async (fields: GameEventFields & { groupId?: number }) => {
			if (creating) return createEvent(cloud, universeId, fields as Parameters<typeof createEvent>[2]);
			return updateEvent(cloud, eventId!, fields);
		},
		onSuccess: (saved) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "events", universeId] });
			queryClient.invalidateQueries({ queryKey: ["oc", "event"] });
			if (creating) {
				if (saved?.id) router.replace(`/project/${universeId}/event?id=${encodeURIComponent(saved.id)}`);
				else router.back();
				if (saved?.allThumbnailsCreated === false) notify("Event created", "Some thumbnails weren't saved; edit the event to pick them again.");
			} else {
				setEditing(false);
				if (saved?.allThumbnailsCreated === false) notify("Saved", "Some thumbnails weren't saved.");
			}
		},
		onError: (e) => notify(creating ? "Couldn't create the event" : "Save failed", cloudErrorText(e)),
	});
	const remove = useMutation({
		mutationFn: () => deleteEvent(cloud, eventId!),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "events", universeId] });
			router.back();
		},
		onError: (e) => notify("Delete failed", cloudErrorText(e)),
	});

	const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

	async function onSave() {
		setFormError(null);
		const d = draft;
		const start = parseLocalDateTime(d.start);
		const end = parseLocalDateTime(d.end);
		if (!d.title.trim()) return setFormError("The title can't be empty.");
		if (!d.subtitle.trim()) return setFormError("The subtitle can't be empty.");
		if (!start) return setFormError("Start time: use YYYY-MM-DD HH:mm.");
		if (!end) return setFormError("End time: use YYYY-MM-DD HH:mm.");
		if (Date.parse(end) <= Date.parse(start)) return setFormError("The event must end after it starts.");
		if (!d.primary) return setFormError("Pick a category.");
		if (d.featuring && !d.tagline.trim()) return setFormError("Featuring needs a tagline.");
		const categories = [d.primary, d.secondary].filter((c, i, all): c is EventCategory => !!c && all.indexOf(c) === i).map((category, i) => ({ category, rank: i + 1 }));
		const thumbnails = d.thumbs.map((mediaId, i) => ({ mediaId, rank: i + 1 }));
		const fields: GameEventFields & { groupId?: number } = {};
		const old = event.data;
		if (creating) {
			Object.assign(fields, {
				title: d.title.trim(),
				subtitle: d.subtitle.trim(),
				description: d.description.trim() || undefined,
				startTime: start,
				endTime: end,
				visibility: d.visibility,
				categories,
				featuringStatus: d.featuring ? "enabled" : "disabled",
				...(d.featuring ? { tagline: d.tagline.trim() } : {}),
				...(d.placeId ? { placeId: d.placeId } : {}),
				...(thumbnails.length ? { thumbnails } : {}),
				...(groupId && d.asGroup ? { groupId } : {}),
			});
		} else if (old) {
			if (d.title.trim() !== (old.title ?? "")) fields.title = d.title.trim();
			if (d.subtitle.trim() !== (old.subtitle ?? "")) fields.subtitle = d.subtitle.trim();
			if (d.description.trim() !== (old.description ?? "")) fields.description = d.description.trim();
			// Compared in the minute-precision form the fields show, so an untouched time is never resent.
			if (d.start !== toLocalDateTime(old.startTime)) fields.startTime = start;
			if (d.end !== toLocalDateTime(old.endTime)) fields.endTime = end;
			if (d.visibility !== old.visibility && old.visibility !== "moderated") fields.visibility = d.visibility;
			// PATCH reads null as "no change", so moving the event back to the start place sends the root place id.
			if (d.placeId && d.placeId !== old.placeId) fields.placeId = d.placeId;
			else if (!d.placeId && old.placeId) {
				const rootPlaceId = game.data?.rootPlaceId;
				if (!rootPlaceId) return setFormError("Couldn't look up the start place; pick the place by name or try again.");
				if (old.placeId !== rootPlaceId) fields.placeId = rootPlaceId;
			}
			const oldCats = [...(old.categories ?? [])].sort((a, b) => a.rank - b.rank).map((c) => c.category);
			if (!sameList(oldCats, categories.map((c) => c.category))) fields.categories = categories;
			const oldThumbs = [...(old.thumbnails ?? [])].sort((a, b) => a.rank - b.rank).map((t) => t.mediaId);
			if (!sameList(oldThumbs, d.thumbs)) fields.thumbnails = thumbnails;
			const featuring = d.featuring ? "enabled" : "disabled";
			if (featuring !== old.featuringStatus) fields.featuringStatus = featuring;
			if (d.featuring && d.tagline.trim() !== (old.tagline ?? "")) fields.tagline = d.tagline.trim();
			if (!Object.keys(fields).length) {
				setEditing(false);
				return;
			}
		}
		if (creating) {
			const when = `${d.start} → ${d.end} (your time)`;
			if (await confirm("Create this event?", `“${d.title.trim()}”, ${when}, ${d.visibility}. ${d.visibility === "public" ? "Players can see it on the experience page once Roblox approves it." : ""}`, "Create", false)) save.mutate(fields);
		} else save.mutate(fields);
	}

	async function onDelete() {
		const e = event.data;
		if (await confirm("Delete this event?", `“${e?.title ?? eventId}” is deleted for good, with its RSVPs. This can't be undone.`, "Delete")) remove.mutate();
	}

	if (!creating) {
		if (event.error) return <CloudError error={event.error} what="This event" onRetry={() => event.refetch()} />;
		if (!event.data) return <Skeleton height={200} />;
	}
	const e = event.data;

	if (!editing && e) {
		return (
			<>
				<Card style={{ gap: 6 }}>
					<Txt variant="h2">{e.title || e.displayTitle || "Untitled event"}</Txt>
					{e.subtitle ? <Txt variant="muted">{e.subtitle}</Txt> : null}
					<View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
						<Badge label={e.visibility ?? "?"} tone={e.visibility === "public" ? "good" : e.visibility === "moderated" ? "critical" : "muted"} />
						<Badge label={e.featuringStatus === "enabled" ? "featuring on" : "featuring off"} />
						{(e.categories ?? []).map((c) => (
							<Badge key={c.category} label={categoryLabel(c.category)} />
						))}
					</View>
					{e.description ? <Txt selectable>{e.description}</Txt> : null}
				</Card>
				<Card>
					<KV label="Starts" value={`${toLocalDateTime(e.startTime)} (${fmtTime(e.startTime)} UTC)`} />
					<KV label="Ends" value={`${toLocalDateTime(e.endTime)} (${fmtTime(e.endTime)} UTC)`} />
					<KV label="Place" value={e.placeId ? String(places.data?.find((pl) => pl.id === e.placeId)?.name ?? e.placeId) : "Start place"} />
					<KV label="Host" value={e.host ? `${e.host.hostName ?? e.host.hostId} (${e.host.hostType})` : "–"} />
					{e.tagline ? <KV label="Tagline" value={e.tagline} /> : null}
					<KV label="Thumbnails" value={e.thumbnails?.length ? e.thumbnails.map((t) => t.mediaId).join(", ") : "none"} mono />
					<KV label="Event id" value={e.id} mono />
					<KV label="Created" value={fmtTime(e.createTime)} />
					<KV label="Updated" value={fmtTime(e.updateTime)} />
				</Card>
				{canWrite ? (
					<View style={{ flexDirection: "row", gap: 8 }}>
						<Button title="Edit" icon="create-outline" onPress={() => { setDraft(draftOf(e)); setEditing(true); }} />
						<Button title="Delete" icon="trash-outline" variant="destructive" loading={remove.isPending} onPress={onDelete} />
					</View>
				) : (
					<Txt variant="small">Read only: add {ENG_SCOPES.eventWrite} to edit or delete.</Txt>
				)}
			</>
		);
	}

	if (!canWrite) return <Txt variant="muted">Creating events needs {ENG_SCOPES.eventWrite} on your API key.</Txt>;

	const mediaItems = media.data?.items ?? [];
	return (
		<>
			<Card style={{ gap: 10 }}>
				<Field label="Title" value={draft.title} onChangeText={(t) => set("title", t)} placeholder="Double XP weekend" autoCapitalize="sentences" />
				<Field label="Subtitle" value={draft.subtitle} onChangeText={(t) => set("subtitle", t)} placeholder="A short line under the title" autoCapitalize="sentences" />
				<Field label="Description" value={draft.description} onChangeText={(t) => set("description", t)} placeholder="Optional" multiline autoCapitalize="sentences" style={{ fontFamily: undefined }} />
				<Field label="Starts (your time)" value={draft.start} onChangeText={(t) => set("start", t)} placeholder="YYYY-MM-DD HH:mm" />
				<Field label="Ends (your time)" value={draft.end} onChangeText={(t) => set("end", t)} placeholder="YYYY-MM-DD HH:mm" />
				<Txt variant="label">Visibility</Txt>
				{e?.visibility === "moderated" ? (
					<Txt variant="small">Roblox moderated this event; its visibility can't be changed here.</Txt>
				) : (
					<Segmented options={[{ value: "public", label: "Public" }, { value: "private", label: "Private (draft)" }]} value={draft.visibility} onChange={(v) => set("visibility", v)} />
				)}
				<Txt variant="label">Category</Txt>
				<Chips options={EVENT_CATEGORIES.map((c) => ({ value: c.value as EventCategory | "", label: c.label }))} value={draft.primary} onChange={(v) => set("primary", v)} />
				<Txt variant="label">Second category (optional)</Txt>
				<Chips options={[{ value: "" as EventCategory | "", label: "None" }, ...EVENT_CATEGORIES.filter((c) => c.value !== draft.primary).map((c) => ({ value: c.value as EventCategory | "", label: c.label }))]} value={draft.secondary} onChange={(v) => set("secondary", v)} />
				<Txt variant="label">Place</Txt>
				{places.data?.length ? (
					<Chips options={[{ value: 0, label: "Start place" }, ...places.data.map((pl) => ({ value: pl.id, label: pl.name }))]} value={draft.placeId ?? 0} onChange={(v) => set("placeId", v || null)} />
				) : (
					<Field value={draft.placeId ? String(draft.placeId) : ""} onChangeText={(t) => set("placeId", /^\d+$/.test(t) ? Number(t) : null)} placeholder="Place id (empty = start place)" keyboardType="number-pad" />
				)}
				<SwitchRow label="Ask Roblox to feature it" hint="Needs a tagline for the curators." value={draft.featuring} onChange={(v) => set("featuring", v)} />
				{draft.featuring ? <Field label="Tagline" value={draft.tagline} onChangeText={(t) => set("tagline", t)} placeholder="Why players should come" autoCapitalize="sentences" /> : null}
				{creating && groupId ? <SwitchRow label={`Host as the group (${game.data?.creator.name})`} hint="Off: you host it." value={draft.asGroup} onChange={(v) => set("asGroup", v)} /> : null}
			</Card>

			<Section title={`Thumbnails (${draft.thumbs.length} picked, in order)`}>
				{media.isLoading ? (
					<Skeleton height={90} />
				) : mediaItems.length ? (
					<ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
						{mediaItems.map((m) => {
							const idx = draft.thumbs.indexOf(m.imageId!);
							const url = media.data?.urls[m.imageId!];
							return (
								<Pressable
									key={m.imageId}
									onPress={() => set("thumbs", idx >= 0 ? draft.thumbs.filter((x) => x !== m.imageId) : [...draft.thumbs, m.imageId!])}
									style={{ borderWidth: 2, borderColor: idx >= 0 ? p.brand : "transparent", borderRadius: 8, overflow: "hidden" }}
								>
									{url ? <Image source={{ uri: url }} style={{ width: 128, height: 72 }} /> : <View style={{ width: 128, height: 72, backgroundColor: p.muted }} />}
									{idx >= 0 ? (
										<View style={{ position: "absolute", top: 4, left: 4 }}>
											<Badge label={`#${idx + 1}`} tone="good" />
										</View>
									) : null}
								</Pressable>
							);
						})}
					</ScrollView>
				) : (
					<Txt variant="small">The experience has no image thumbnails to pick from.</Txt>
				)}
				<Txt variant="small">Tap to pick the experience's own thumbnails. Roblox's events API takes existing image ids only; add new images to the experience's thumbnails first.</Txt>
			</Section>

			{formError ? <Txt color={p.destructive}>{formError}</Txt> : null}
			<View style={{ flexDirection: "row", gap: 8 }}>
				<Button title={creating ? "Create event" : "Save"} variant="brand" icon="checkmark" loading={save.isPending} onPress={onSave} />
				<Button title="Cancel" onPress={() => (creating ? router.back() : setEditing(false))} />
			</View>
		</>
	);
}
