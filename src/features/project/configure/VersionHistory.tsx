/**
 * A place's version history (place-version-history-api: cursor pages, filters published / with notes / search /
 * contributor), editing a version's notes (title + description) and reverting to a version (Assets API rollback,
 * BETA; confirm first).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { hasScope, type OpenCloud } from "@/api/opencloud";
import { usersByIds } from "@/api/roblox-public";
import { Badge, Button, Card, Chips, confirm, EmptyState, Field, List, notify, Row, SearchBar, Section, Segmented, SkeletonList, Txt } from "@/components/ui";
import { fmtAgo, fmtTime } from "@/lib/format";
import { useAccounts } from "@/store/accounts";
import { useTheme } from "@/theme";

import { placeContributors, placeVersions, rollbackPlace, SCOPES, updateVersionNotes, type PlaceVersion, type VersionFilters } from "../api/configure";
import { CloudError, cloudErrorText } from "../CloudError";

type Kind = "all" | "published" | "notes";

// The OpenAPI document gives no lengths for notes; these keep the form sane and Roblox validates the rest.
const NOTE_TITLE_MAX = 100;
const NOTE_DESCRIPTION_MAX = 1000;

export function VersionHistory({ universeId, placeId, cloud, canWrite }: { universeId: number; placeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const { keyInfo } = useAccounts();
	const [kind, setKind] = useState<Kind>("all");
	const [search, setSearch] = useState("");
	const [term, setTerm] = useState("");
	const [contributor, setContributor] = useState(0);
	const filters: VersionFilters = { isPublished: kind === "published" ? true : undefined, hasNotes: kind === "notes" ? true : undefined, searchTerm: term || undefined, contributor: contributor || undefined };

	const versions = useInfiniteQuery({
		queryKey: ["oc", "place", universeId, placeId, "versions", filters],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => placeVersions(cloud, placeId, filters, pageParam),
		getNextPageParam: (last) => (last.hasMore && last.nextCursor ? last.nextCursor : undefined),
		retry: false,
	});
	const contributors = useQuery({ queryKey: ["oc", "place", universeId, placeId, "contributors"], queryFn: () => placeContributors(cloud, placeId), retry: false, staleTime: 300_000 });
	const rows = versions.data?.pages.flatMap((pg) => pg.placeVersions ?? []) ?? [];
	const ids = Array.from(new Set([...(contributors.data?.contributors ?? []), ...rows.flatMap((r) => [...(r.contributors ?? []), ...(r.createdBy ? [r.createdBy] : [])])]));
	// Own key shape: bans.tsx / server.tsx cache { names, heads } under ["users", ids], PlaceBans a user map.
	const names = useQuery({
		queryKey: ["users", "names", ids.slice().sort().join(",")],
		enabled: ids.length > 0,
		staleTime: 3600_000,
		queryFn: async () => new Map((await usersByIds(ids)).map((u) => [u.id, u.name])),
	});
	const nameOf = (id: number | null | undefined) => (id ? (names.data?.get(id) ? `@${names.data.get(id)}` : `user ${id}`) : "–");
	// asset:write is a creator-level scope (user / group), so it's checked without the universe.
	const canRevert = hasScope(keyInfo, SCOPES.assetWrite);

	return (
		<Section title="Version history">
			<Segmented
				options={[
					{ value: "all", label: "All" },
					{ value: "published", label: "Published" },
					{ value: "notes", label: "With notes" },
				]}
				value={kind}
				onChange={setKind}
			/>
			<SearchBar value={search} onChangeText={setSearch} placeholder="Search notes" onSubmit={() => setTerm(search.trim())} />
			{contributors.data?.contributors?.length ? (
				<Chips options={[{ value: 0, label: "Everyone" }, ...contributors.data.contributors.map((id) => ({ value: id, label: nameOf(id) }))]} value={contributor} onChange={setContributor} />
			) : null}
			{versions.error ? (
				<CloudError error={versions.error} what="Version history" onRetry={() => versions.refetch()} />
			) : !versions.data ? (
				<SkeletonList rows={4} />
			) : rows.length ? (
				<>
					<List>
						{rows.map((v) => (
							<VersionRow key={v.version ?? v.createdTime} universeId={universeId} placeId={placeId} cloud={cloud} v={v} canWrite={canWrite} canRevert={canRevert} nameOf={nameOf} />
						))}
					</List>
					{versions.hasNextPage ? <Button title="Load more" small loading={versions.isFetchingNextPage} onPress={() => versions.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</>
			) : (
				<EmptyState icon="time-outline" title="No versions" body={term || kind !== "all" || contributor ? "Nothing matches these filters." : "This place has no saved versions yet."} />
			)}
		</Section>
	);
}

function VersionRow({
	universeId,
	placeId,
	cloud,
	v,
	canWrite,
	canRevert,
	nameOf,
}: {
	universeId: number;
	placeId: number;
	cloud: OpenCloud;
	v: PlaceVersion;
	canWrite: boolean;
	canRevert: boolean;
	nameOf: (id: number | null | undefined) => string;
}) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState(v.title ?? "");
	const [description, setDescription] = useState(v.description ?? "");
	const notes = useMutation({
		mutationFn: () => updateVersionNotes(cloud, placeId, v.version!, { title: title.trim(), description: description.trim() }),
		onSuccess: () => {
			setOpen(false);
			queryClient.invalidateQueries({ queryKey: ["oc", "place", universeId, placeId, "versions"] });
		},
		onError: (e) => notify("Couldn't save the notes", cloudErrorText(e)),
	});
	const revert = useMutation({
		mutationFn: () => rollbackPlace(cloud, placeId, v.version!),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "place", universeId, placeId, "versions"] });
			notify("Reverted", `Version ${v.version} is the place's current version again. New servers start with it.`);
		},
		onError: (e) => notify("Couldn't revert", `${cloudErrorText(e)}\n\nThe Assets API may not support places yet; revert in Studio's version history instead.`),
	});
	const who = v.contributors?.length ? v.contributors.map(nameOf).join(", ") : nameOf(v.createdBy);
	return (
		<View>
			<Row
				onPress={() => setOpen((x) => !x)}
				title={`v${v.version ?? "?"}${v.title ? ` · ${v.title}` : ""}`}
				subtitle={`${fmtTime(v.createdTime)} (${fmtAgo(v.createdTime)}) · ${who}${v.description ? `\n${v.description}` : ""}`}
				numberOfLines={2}
				right={<Badge label={v.isPublished ? "published" : "saved"} tone={v.isPublished ? "good" : "muted"} />}
			/>
			{open ? (
				<Card style={{ gap: 8, marginHorizontal: 8, marginBottom: 8 }}>
					<Txt variant="small">
						Save type {v.saveType ?? "–"} · publish status {v.publishStatus ?? "–"}
						{v.hasNotes ? " · has notes" : ""}
					</Txt>
					{canWrite && v.version ? (
						<>
							<Field label={`Title (${title.length}/${NOTE_TITLE_MAX})`} value={title} onChangeText={setTitle} maxLength={NOTE_TITLE_MAX} autoCapitalize="sentences" />
							<Field
								label={`Notes (${description.length}/${NOTE_DESCRIPTION_MAX})`}
								value={description}
								onChangeText={setDescription}
								maxLength={NOTE_DESCRIPTION_MAX}
								multiline
								autoCapitalize="sentences"
								style={{ fontFamily: undefined, fontSize: 14 }}
							/>
							<Button title="Save notes" small variant="brand" loading={notes.isPending} disabled={title === (v.title ?? "") && description === (v.description ?? "")} onPress={() => notes.mutate()} style={{ alignSelf: "flex-start" }} />
						</>
					) : (
						<Txt variant="small">Add universe.place:write to edit notes.</Txt>
					)}
					{canRevert && v.version ? (
						<Button
							title={`Revert to v${v.version}`}
							small
							variant="destructive"
							icon="arrow-undo-outline"
							loading={revert.isPending}
							style={{ alignSelf: "flex-start" }}
							onPress={async () => {
								if (
									await confirm(
										`Revert to version ${v.version}?`,
										"It becomes the place's current version (Assets API rollback, beta; Roblox may refuse it for places). New servers start with it; running servers keep theirs until restarted.",
										"Revert",
									)
								)
									revert.mutate();
							}}
						/>
					) : (
						<Txt variant="small" color={p.mutedForeground}>
							Add asset:write (for the experience's owner) to revert to a version.
						</Txt>
					)}
				</Card>
			) : null}
		</View>
	);
}
