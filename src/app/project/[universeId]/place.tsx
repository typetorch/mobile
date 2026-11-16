/**
 * One place (?placeId=): details (Open Cloud Get Place), edit name / description / server size (PATCH with an
 * updateMask of the changed fields; Roblox answers 409 while it's open in Team Create), version history with notes
 * and revert, place-level bans, shortcuts to Run Luau / Place instances for this place, and publishing or saving a
 * new version from an .rbxl / .rbxlx file picked with the system file picker (universe-places:write; publishing
 * replaces what new servers run, so it asks first, naming the place, the file and its size).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { File } from "expo-file-system";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, EmptyState, Field, KV, notify, Section, SkeletonList, Txt } from "@/components/ui";
import {
	detectPlaceKind,
	fileLabel,
	fmtBytes,
	getPlace,
	PLACE_LIMITS,
	publishPlaceFile,
	SCOPES,
	updatePlace,
	UPLOAD_LIMITS,
	validatePlacePatch,
	type PlaceFileKind,
	type PlaceFull,
	type PlacePatch,
	type PlaceVersionType,
} from "@/features/project/api/configure";
import { PlaceBans } from "@/features/project/configure/PlaceBans";
import { pickOneFile } from "@/features/project/configure/pickFile";
import { VersionHistory } from "@/features/project/configure/VersionHistory";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtDate } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

export default function PlaceScreen() {
	const { placeId } = useLocalSearchParams<{ placeId: string }>();
	const queryClient = useQueryClient();
	const id = Number(placeId);
	return (
		<ToolScreen title="Place" scopes={[]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "place"], type: "active" })}>
			{({ universeId, cloud, can }) =>
				Number.isInteger(id) && id > 0 ? <Place universeId={universeId} placeId={id} cloud={cloud} can={can} /> : <EmptyState icon="alert-circle-outline" title="No place" body="This link has no place id." />
			}
		</ToolScreen>
	);
}

function Place({ universeId, placeId, cloud, can }: { universeId: number; placeId: number; cloud: OpenCloud; can: (scope: string) => boolean }) {
	const { hasKey } = useAccounts();
	const place = useQuery({ queryKey: ["oc", "place", universeId, placeId], queryFn: () => getPlace(cloud, universeId, placeId), enabled: hasKey, retry: false });
	const title = place.data?.displayName ?? `Place ${placeId}`;
	if (!hasKey)
		return (
			<>
				<Stack.Screen options={{ title }} />
				<EmptyState
					icon="key-outline"
					title="Add an Open Cloud key"
					body="Place details, edits and version history use your Open Cloud key."
					action={<Button title="Open on Creator Hub" icon="open-outline" onPress={() => WebBrowser.openBrowserAsync(`https://create.roblox.com/dashboard/creations/experiences/${universeId}/places/${placeId}/configure`)} />}
				/>
			</>
		);
	return (
		<>
			<Stack.Screen options={{ title }} />
			{place.error ? (
				<CloudError error={place.error} what="Place details" onRetry={() => place.refetch()} />
			) : !place.data ? (
				<SkeletonList rows={3} />
			) : (
				<>
					<Details place={place.data} placeId={placeId} />
					<EditPlace key={place.data.updateTime} universeId={universeId} placeId={placeId} cloud={cloud} place={place.data} canWrite={can(SCOPES.placeWrite)} />
				</>
			)}
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				<Button title="Run Luau" small icon="code-slash-outline" onPress={() => router.push(`/project/${universeId}/luau?placeId=${placeId}`)} />
				<Button title="Instances" small icon="git-network-outline" onPress={() => router.push(`/project/${universeId}/instances?placeId=${placeId}`)} />
				<Button title="Creator Hub" small icon="open-outline" onPress={() => WebBrowser.openBrowserAsync(`https://create.roblox.com/dashboard/creations/experiences/${universeId}/places/${placeId}/configure`)} />
			</View>
			{can(SCOPES.placeRead) ? <VersionHistory universeId={universeId} placeId={placeId} cloud={cloud} canWrite={can(SCOPES.placeWrite)} /> : <Txt variant="small">Add universe.place:read to see the version history.</Txt>}
			{can(SCOPES.restrictionRead) ? <PlaceBans universeId={universeId} placeId={placeId} cloud={cloud} canWrite={can(SCOPES.restrictionWrite)} /> : <Txt variant="small">Add universe.user-restriction:read to see bans for this place.</Txt>}
			{can(SCOPES.placePublish) ? (
				<PublishFile universeId={universeId} placeId={placeId} cloud={cloud} placeName={place.data?.displayName ?? `place ${placeId}`} />
			) : (
				<Txt variant="small">Add universe-places:write to publish or save a new version from an .rbxl / .rbxlx file.</Txt>
			)}
		</>
	);
}

function Details({ place, placeId }: { place: PlaceFull; placeId: number }) {
	return (
		<Section title="Details">
			<Card>
				<KV label="Place ID" value={String(placeId)} mono />
				<KV label="Start place" value={place.root ? <Badge label="root" tone="brand" /> : "no"} />
				<KV label="Server size" value={String(place.serverSize ?? "–")} />
				{place.universeRuntimeCreation ? <KV label="Origin" value="made in game (CreatePlaceAsync)" /> : null}
				<KV label="Created" value={fmtDate(place.createTime)} />
				<KV label="Updated" value={`${fmtDate(place.updateTime)} (${fmtAgo(place.updateTime)})`} />
			</Card>
		</Section>
	);
}

function EditPlace({ universeId, placeId, cloud, place, canWrite }: { universeId: number; placeId: number; cloud: OpenCloud; place: PlaceFull; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [name, setName] = useState(place.displayName ?? "");
	const [description, setDescription] = useState(place.description ?? "");
	const [size, setSize] = useState(String(place.serverSize ?? ""));
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (patch: PlacePatch) => updatePlace(cloud, universeId, placeId, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "place", universeId, placeId] });
			queryClient.invalidateQueries({ queryKey: ["places", universeId] });
			if (place.root) {
				queryClient.invalidateQueries({ queryKey: ["oc", "universe", universeId] });
				queryClient.invalidateQueries({ queryKey: ["project", universeId] });
			}
			notify("Saved", "The place is updated.");
		},
		onError: (e) => notify("Couldn't save", cloudErrorText(e)),
	});

	const patch: PlacePatch = {};
	if (name !== (place.displayName ?? "")) patch.displayName = name.trim();
	if (description !== (place.description ?? "")) patch.description = description;
	if (size.trim() !== String(place.serverSize ?? "")) patch.serverSize = /^\d+$/.test(size.trim()) ? Number(size.trim()) : Number.NaN;
	const changed = Object.keys(patch).length > 0;

	if (!canWrite) return <Txt variant="small">Read only: add universe.place:write to edit the name, description and server size.</Txt>;
	return (
		<Section title="Edit">
			<Card style={{ gap: 8 }}>
				<Field label={`Name (${name.length}/${PLACE_LIMITS.name})`} value={name} onChangeText={setName} maxLength={PLACE_LIMITS.name} autoCapitalize="sentences" />
				<Field
					label={`Description (${description.length}/${PLACE_LIMITS.description})`}
					value={description}
					onChangeText={setDescription}
					maxLength={PLACE_LIMITS.description}
					multiline
					autoCapitalize="sentences"
					style={{ fontFamily: undefined, fontSize: 14 }}
				/>
				<Field label={`Server size (${PLACE_LIMITS.serverSizeMin}–${PLACE_LIMITS.serverSizeMax})`} value={size} onChangeText={setSize} keyboardType="number-pad" maxLength={3} />
				{place.root ? <Txt variant="small">This is the start place: its name and description are the experience's.</Txt> : null}
				{error ? <Txt variant="small" color={p.destructive}>{error}</Txt> : null}
				<Button
					title="Save"
					variant="brand"
					small
					loading={save.isPending}
					disabled={!changed}
					style={{ alignSelf: "flex-start" }}
					onPress={() => {
						const v = validatePlacePatch(patch);
						setError(v);
						if (!v) save.mutate(patch);
					}}
				/>
			</Card>
		</Section>
	);
}

/** Publish or save a new version from a picked .rbxl / .rbxlx file (POST /universes/v1/.../versions). */
function PublishFile({ universeId, placeId, cloud, placeName }: { universeId: number; placeId: number; cloud: OpenCloud; placeName: string }) {
	const queryClient = useQueryClient();
	const [picked, setPicked] = useState<{ file: File; kind: PlaceFileKind } | null>(null);
	const file = picked?.file ?? null;
	// Android names are often document ids with no extension: the header tells the kind, and the label falls back.
	const label = picked ? fileLabel(picked.file, `Picked place file (.${picked.kind})`) : "";
	const send = useMutation({
		mutationFn: (args: { file: File; versionType: PlaceVersionType }) => publishPlaceFile(cloud, universeId, placeId, args.file, args.versionType),
		onSuccess: (r, args) => {
			queryClient.invalidateQueries({ queryKey: ["oc", "place", universeId, placeId, "versions"] });
			queryClient.invalidateQueries({ queryKey: ["oc", "place", universeId, placeId] });
			setPicked(null);
			const v = r.versionNumber ? `Version ${r.versionNumber}` : "The new version";
			notify(args.versionType === "Published" ? "Published" : "Saved", args.versionType === "Published" ? `${v} of ${placeName} is live: new servers run it.` : `${v} of ${placeName} is saved (not published).`);
		},
		onError: (e, args) => notify(args.versionType === "Published" ? "Couldn't publish" : "Couldn't save", cloudErrorText(e)),
	});

	async function choose() {
		// The header (not the name, often an extensionless document id on Android) decides whether it's a place file.
		const found: { kind?: PlaceFileKind } = {};
		const f = await pickOneFile({
			maxBytes: UPLOAD_LIMITS.placeBytes,
			check: async (candidate) => {
				found.kind = (await detectPlaceKind(candidate)) ?? undefined;
				return found.kind ? null : `${fileLabel(candidate, "This file")} isn't a Roblox place file: pick an .rbxl or .rbxlx file.`;
			},
		});
		if (f && found.kind) setPicked({ file: f, kind: found.kind });
	}

	async function go(versionType: PlaceVersionType) {
		if (!file) return;
		const what = `${label} (${fmtBytes(file.size)})`;
		const ok =
			versionType === "Published"
				? await confirm(
						`Publish to ${placeName}?`,
						`${what} replaces the live version of ${placeName}: new servers run it right away, running servers keep the old one until they restart.`,
						"Publish",
						true,
					)
				: await confirm(`Save to ${placeName}?`, `${what} is saved as a new version of ${placeName} without publishing it: players keep the current version.`, "Save", false);
		if (ok) send.mutate({ file, versionType });
	}

	const busy = send.isPending ? send.variables?.versionType : undefined;
	return (
		<Section title="New version from a file">
			<Card style={{ gap: 8 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
					<View style={{ flex: 1, gap: 2 }}>
						<Txt numberOfLines={1}>{file ? label : "No file chosen"}</Txt>
						<Txt variant="small">{file ? fmtBytes(file.size) : `.rbxl or .rbxlx, up to ${fmtBytes(UPLOAD_LIMITS.placeBytes)}`}</Txt>
					</View>
					<Button title={file ? "Change" : "Choose file"} icon="document-outline" small disabled={send.isPending} onPress={choose} />
				</View>
				<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
					<Button title="Publish a new version" icon="cloud-upload-outline" variant="brand" small disabled={!file || send.isPending} loading={busy === "Published"} onPress={() => go("Published")} />
					<Button title="Save a new version" icon="save-outline" small disabled={!file || send.isPending} loading={busy === "Saved"} onPress={() => go("Saved")} />
				</View>
				<Txt variant="small">Save keeps it unpublished (like Save to Roblox in Studio); Publish makes it the version players join.</Txt>
			</Card>
		</Section>
	);
}
