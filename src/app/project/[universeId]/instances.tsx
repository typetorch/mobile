/**
 * Place instances (Open Cloud Engine instances, BETA): browse a saved place's DataModel from `root` (listChildren,
 * long-running operations polled with a bound), open an instance to read its properties, and edit a Script /
 * LocalScript / ModuleScript's source or Enabled (PATCH, confirm first). Roblox only supports scripts, refuses
 * scripts open in Studio or inside packages, and needs collaborative editing on. Reads the saved place, not live servers.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, confirm, EmptyState, Field, KV, List, notify, Row, Section, SkeletonList, Txt } from "@/components/ui";
import {
	getInstance,
	instanceClass,
	instanceIdOf,
	isScriptClass,
	listInstanceChildren,
	type ChildPageParam,
	SCOPES,
	SOURCE_MAX_BYTES,
	updateScript,
	utf8Length,
	type PlaceInstance,
	type ScriptClass,
} from "@/features/project/api/configure";
import { PlacePicker, SwitchRow, useUniversePlaces } from "@/features/project/configure/shared";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtBytes, prettyJson } from "@/lib/format";
import { useTheme } from "@/theme";

export default function InstancesScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Place instances" scopes={["universe.place.instance:read"]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "instances"], type: "active" })}>
			{({ universeId, cloud, can }) => <Instances universeId={universeId} cloud={cloud} canWrite={can(SCOPES.instanceWrite)} />}
		</ToolScreen>
	);
}

interface Crumb {
	id: string;
	name: string;
}

const ROOT: Crumb = { id: "root", name: "game" };

function Instances({ universeId, cloud, canWrite }: { universeId: number; cloud: OpenCloud; canWrite: boolean }) {
	const params = useLocalSearchParams<{ placeId?: string }>();
	const { places, rootId, loading } = useUniversePlaces(universeId, cloud);
	const [placeId, setPlaceId] = useState<number | null>(params.placeId ? Number(params.placeId) : null);
	const [stack, setStack] = useState<Crumb[]>([ROOT]);
	const [selected, setSelected] = useState<string | null>(null);
	const pid = placeId ?? rootId;
	const current = stack[stack.length - 1] ?? ROOT;

	const children = useInfiniteQuery({
		queryKey: ["oc", "instances", universeId, pid, current.id, "children"],
		enabled: !!pid,
		initialPageParam: {} as ChildPageParam,
		queryFn: ({ pageParam, signal }) => listInstanceChildren(cloud, universeId, pid!, current.id, pageParam, signal),
		// The next page reuses the size that worked (smaller after a 422), as a page token needs the same parameters.
		getNextPageParam: (last): ChildPageParam | undefined => (last.nextPageToken ? { pageToken: last.nextPageToken, maxPageSize: last.maxPageSize } : undefined),
		retry: false,
		staleTime: 60_000,
	});
	const rows = (children.data?.pages.flatMap((pg) => pg.instances ?? []) ?? []).slice().sort((a, b) => (a.engineInstance?.Name ?? "").localeCompare(b.engineInstance?.Name ?? ""));

	return (
		<>
			<Section title="Place">
				<PlacePicker
					places={places}
					rootId={rootId}
					value={pid}
					loading={loading}
					onChange={(id) => {
						setPlaceId(id);
						setStack([ROOT]);
						setSelected(null);
					}}
				/>
			</Section>
			<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, alignItems: "center" }}>
				{stack.map((c, i) => (
					<View key={`${c.id}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
						{i ? <Txt variant="small">›</Txt> : null}
						<Button
							title={c.name}
							small
							variant={i === stack.length - 1 ? "secondary" : "ghost"}
							onPress={() => {
								setStack(stack.slice(0, i + 1));
								setSelected(null);
							}}
						/>
					</View>
				))}
			</ScrollView>

			{selected && pid ? <InstanceDetail key={selected} universeId={universeId} placeId={pid} instanceId={selected} cloud={cloud} canWrite={canWrite} onClose={() => setSelected(null)} /> : null}

			{!pid ? null : children.error ? (
				<CloudError error={children.error} what="Place instances" onRetry={() => children.refetch()} />
			) : !children.data ? (
				<SkeletonList rows={6} />
			) : rows.length ? (
				<Section title={`${current.name} (${rows.length}${children.hasNextPage ? "+" : ""})`}>
					<List>
						{rows.map((i) => {
							const id = instanceIdOf(i);
							const cls = instanceClass(i);
							const name = i.engineInstance?.Name ?? id;
							return (
								<Row
									key={i.path}
									title={name}
									subtitle={cls}
									chevron={!!i.hasChildren}
									right={
										<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
											{isScriptClass(cls) ? <Badge label="script" tone="brand" /> : null}
											<Button title="View" small variant="ghost" onPress={() => setSelected(id)} />
										</View>
									}
									onPress={() => {
										if (i.hasChildren) {
											setStack([...stack, { id, name }]);
											setSelected(null);
										} else setSelected(id);
									}}
								/>
							);
						})}
					</List>
					{children.hasNextPage ? <Button title="Load more" small loading={children.isFetchingNextPage} onPress={() => children.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</Section>
			) : (
				<EmptyState icon="cube-outline" title="No children" body="Nothing under this instance (Roblox only lists what the API supports)." />
			)}
			<Txt variant="small">Reads the latest saved version of the place. Roblox allows 45 calls a minute here.</Txt>
		</>
	);
}

function InstanceDetail({ universeId, placeId, instanceId, cloud, canWrite, onClose }: { universeId: number; placeId: number; instanceId: string; cloud: OpenCloud; canWrite: boolean; onClose: () => void }) {
	const inst = useQuery({
		queryKey: ["oc", "instances", universeId, placeId, instanceId, "detail"],
		queryFn: ({ signal }) => getInstance(cloud, universeId, placeId, instanceId, signal),
		retry: false,
	});
	const cls = instanceClass(inst.data);
	return (
		<Card style={{ gap: 8 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Txt variant="h3" style={{ flex: 1 }} numberOfLines={1}>
					{inst.data?.engineInstance?.Name ?? "Instance"}
				</Txt>
				<Button title="Close" small variant="ghost" icon="close" onPress={onClose} />
			</View>
			{inst.error ? (
				<CloudError error={inst.error} what="This instance" onRetry={() => inst.refetch()} />
			) : !inst.data ? (
				<SkeletonList rows={2} />
			) : (
				<>
					<KV label="Class" value={cls} />
					<KV label="Id" value={instanceIdOf(inst.data)} mono />
					{inst.data.engineInstance?.Parent ? <KV label="Parent" value={inst.data.engineInstance.Parent} mono /> : null}
					{isScriptClass(cls) ? (
						<ScriptEditor key={inst.dataUpdatedAt} universeId={universeId} placeId={placeId} instanceId={instanceId} cloud={cloud} cls={cls} inst={inst.data} canWrite={canWrite} />
					) : (
						<>
							<Txt variant="label">Properties</Txt>
							<ScrollView horizontal>
								<Txt variant="mono" selectable>
									{prettyJson(inst.data.engineInstance?.Details ?? {})}
								</Txt>
							</ScrollView>
						</>
					)}
				</>
			)}
		</Card>
	);
}

function ScriptEditor({
	universeId,
	placeId,
	instanceId,
	cloud,
	cls,
	inst,
	canWrite,
}: {
	universeId: number;
	placeId: number;
	instanceId: string;
	cloud: OpenCloud;
	cls: ScriptClass;
	inst: PlaceInstance;
	canWrite: boolean;
}) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const details = inst.engineInstance?.Details?.[cls] ?? {};
	const original = details.Source ?? "";
	const [source, setSource] = useState(original);
	const [enabled, setEnabled] = useState(details.Enabled ?? true);
	const bytes = utf8Length(source);
	const save = useMutation({
		mutationFn: (props: { Source?: string; Enabled?: boolean }) => updateScript(cloud, universeId, placeId, instanceId, cls, props),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "instances", universeId, placeId] });
			notify("Saved", "The script is updated in the saved place. New servers use it after the next publish/restart.");
		},
		onError: (e) => notify("Couldn't save", cloudErrorText(e)),
	});
	const props: { Source?: string; Enabled?: boolean } = {};
	if (source !== original) props.Source = source;
	if (cls !== "ModuleScript" && enabled !== (details.Enabled ?? true)) props.Enabled = enabled;
	const changed = Object.keys(props).length > 0;

	return (
		<>
			{cls !== "ModuleScript" ? (
				<>
					<SwitchRow label="Enabled" value={enabled} onChange={setEnabled} disabled={!canWrite} />
					{details.RunContext ? <KV label="Run context" value={details.RunContext} /> : null}
				</>
			) : null}
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
				<Txt variant="label">
					Source · {fmtBytes(bytes)}
					{bytes > SOURCE_MAX_BYTES ? " (over the 200 KB limit)" : ""}
				</Txt>
				<Button
					title="Copy"
					small
					variant="ghost"
					icon="copy-outline"
					onPress={async () => {
						await Clipboard.setStringAsync(source);
						notify("Copied");
					}}
				/>
			</View>
			<Field value={source} onChangeText={setSource} multiline editable={canWrite} style={{ minHeight: 220 }} />
			{canWrite ? (
				<View style={{ flexDirection: "row", gap: 8 }}>
					<Button
						title="Save to place"
						variant="destructive"
						small
						loading={save.isPending}
						disabled={!changed || bytes > SOURCE_MAX_BYTES}
						onPress={async () => {
							if (await confirm("Overwrite this script?", "It changes the saved place right away (no undo here; Studio's version history can restore it). Roblox refuses scripts open in Studio.", "Overwrite")) save.mutate(props);
						}}
					/>
					{changed ? (
						<Button
							title="Reset"
							small
							variant="ghost"
							onPress={() => {
								setSource(original);
								setEnabled(details.Enabled ?? true);
							}}
						/>
					) : null}
				</View>
			) : (
				<Txt variant="small" color={p.mutedForeground}>
					Read only: add universe.place.instance:write to edit scripts.
				</Txt>
			)}
		</>
	);
}
