/**
 * One custom dashboard: its tiles drawn from the Analytics Query API over the chosen range (the first few load by
 * themselves, the rest on a tap, to stay under Roblox's 30 analytics queries a minute), and with
 * universe.analytics.dashboard:write: rename / describe, pin, add a chart tile, remove a tile, edit the whole document
 * as JSON, and delete. Every document change is validated by Roblox first and published with the head etag of the
 * read, so an edit made on Creator Hub in between is never overwritten silently. The caller's capabilities and limits
 * (from the list call, which the doc says matches GET .../capabilities) hide what Roblox would refuse and cap the
 * name, description and tile title lengths.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { Badge, Button, Card, Chips, confirm, EmptyState, Field, KV, notify, Section, Segmented, Skeleton, Txt } from "@/components/ui";
import {
	DASHBOARD_READ,
	DASHBOARD_WRITE,
	deleteDashboard,
	getDashboard,
	listDashboards,
	patchDashboardMetadata,
	publishDashboard,
	validateDashboardDocument,
	type CustomDashboardDocument,
	type DashboardChartType,
	type DashboardGranularity,
} from "@/features/project/api/analytics-tools";
import { ALL_METRICS, type RangeDays } from "@/features/project/analytics";
import { addChartTile, collectTiles, DASH_CHART_TYPES, DASH_GRANULARITIES, defaultRangeDays, removeTile, splitList } from "@/features/project/analytics-tools/dashboard-model";
import { DashboardTile } from "@/features/project/analytics-tools/DashboardTile";
import { CloudError, cloudErrorText } from "@/features/project/CloudError";
import { ToolScreen } from "@/features/project/tool";
import { fmtAgo, fmtTime, prettyJson } from "@/lib/format";
import { useTheme } from "@/theme";

const AUTO_LOAD = 6;
const RANGE_OPTIONS: { value: RangeDays; label: string }[] = [
	{ value: 7, label: "7 days" },
	{ value: 28, label: "28 days" },
	{ value: 90, label: "90 days" },
];

export default function DashboardScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const queryClient = useQueryClient();
	return (
		<ToolScreen title="Dashboard" scopes={[DASHBOARD_READ]} onRefresh={() => queryClient.refetchQueries({ queryKey: ["oc", "dashboard"], type: "active" })}>
			{({ universeId, cloud, can }) => <Dashboard universeId={universeId} cloud={cloud} dashboardId={String(id ?? "")} canWrite={can(DASHBOARD_WRITE)} />}
		</ToolScreen>
	);
}

function Dashboard({ universeId, cloud, dashboardId, canWrite }: { universeId: number; cloud: OpenCloud; dashboardId: string; canWrite: boolean }) {
	const p = useTheme();
	const queryClient = useQueryClient();
	const q = useQuery({ queryKey: ["oc", "dashboard", universeId, dashboardId], queryFn: () => getDashboard(cloud, universeId, dashboardId) });
	// Capabilities come with the list; while they load (or if they fail) every action is offered and Roblox decides.
	const capsQ = useQuery({ queryKey: ["oc", "dashboards", universeId, "capabilities"], queryFn: () => listDashboards(cloud, universeId).then((r) => r.capabilities ?? null), staleTime: 5 * 60_000 });
	const caps = capsQ.data ?? null;
	const limits = caps?.limits ?? null;
	const canMeta = canWrite && caps?.canEdit !== false;
	const canPublish = canWrite && caps?.canPublish !== false;
	const canDelete = canWrite && caps?.canDelete !== false;
	const dash = q.data?.dashboard ?? null;
	const meta = dash?.metadata ?? null;
	const doc = dash?.document ?? null;
	const tiles = useMemo(() => collectTiles(doc), [doc]);
	const initialDays = defaultRangeDays(doc);
	const [days, setDays] = useState<RangeDays | null>(null);
	const range: RangeDays = days ?? (initialDays && initialDays <= 7 ? 7 : initialDays && initialDays > 28 ? 90 : 28);
	const [panel, setPanel] = useState<"none" | "details" | "tile" | "json">("none");
	const [issues, setIssues] = useState<string[]>([]);

	const etag = meta?.headEtag ?? "";
	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: ["oc", "dashboard", universeId, dashboardId] });
		queryClient.invalidateQueries({ queryKey: ["oc", "dashboards", universeId] });
	};

	/** Validates, asks, publishes. */
	const publish = useMutation({
		mutationFn: async ({ next, what }: { next: CustomDashboardDocument; what: string }) => {
			setIssues([]);
			const v = await validateDashboardDocument(cloud, universeId, next);
			if (v.isValid === false) {
				const list = (v.validationIssues ?? []).map((i) => `${i.fieldPath || "document"}: ${i.message || i.reason || "invalid"}${i.rejectedValues?.length ? ` (${i.rejectedValues.join(", ")})` : ""}`);
				setIssues(list.length ? list : ["Roblox says the document is not valid."]);
				return false;
			}
			if (!(await confirm("Publish the dashboard?", `${what}. Everyone on the team sees the new version.`, "Publish", false))) return false;
			await publishDashboard(cloud, universeId, dashboardId, etag, next);
			return true;
		},
		onSuccess: (done) => {
			if (!done) return;
			setPanel("none");
			refresh();
		},
		onError: (e) => notify("Couldn't publish", cloudErrorText(e)),
	});

	const del = useMutation({
		mutationFn: () => deleteDashboard(cloud, universeId, dashboardId, etag),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["oc", "dashboards", universeId] });
			router.back();
		},
		onError: (e) => notify("Couldn't delete", cloudErrorText(e)),
	});

	const pin = useMutation({
		mutationFn: () => patchDashboardMetadata(cloud, universeId, dashboardId, etag, { isPinned: !meta?.isPinned }),
		onSuccess: refresh,
		onError: (e) => notify("Couldn't change the pin", cloudErrorText(e)),
	});

	if (q.error) return <CloudError error={q.error} what="This dashboard" onRetry={() => q.refetch()} />;
	if (!dash) return <Skeleton height={200} />;

	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Txt variant="h2" style={{ flex: 1 }}>
						{meta?.name || "Untitled"}
					</Txt>
					{meta?.isPinned ? <Badge label="pinned" tone="brand" icon="pin" /> : null}
				</View>
				{meta?.description ? <Txt variant="muted">{meta.description}</Txt> : null}
				<Txt variant="small">
					{[meta?.latestPublishedVersion && meta.latestPublishedVersion !== "0" ? `version ${meta.latestPublishedVersion}` : "nothing published yet", meta?.publishedTime ? `published ${fmtAgo(meta.publishedTime)}` : "", meta?.updatedBy?.userId ? `by user ${meta.updatedBy.userId}` : ""]
						.filter(Boolean)
						.join(" · ")}
				</Txt>
			</Card>

			<Segmented options={RANGE_OPTIONS} value={range} onChange={setDays} />

			{tiles.length ? (
				tiles.map((t, i) => (
					<DashboardTile
						key={`${t.key}-${i}`}
						tile={t}
						universeId={universeId}
						cloud={cloud}
						days={range}
						autoLoad={i < AUTO_LOAD}
						dashboardId={dashboardId}
						onRemove={
							canPublish && t.id && doc
								? () => {
										const r = removeTile(doc, t.id);
										if (!r.removed) return notify("Can't remove this tile", "It isn't found in the document; remove it on Creator Hub or with Edit JSON.");
										publish.mutate({ next: r.doc, what: `Removes the tile “${t.title}”` });
									}
								: undefined
						}
					/>
				))
			) : (
				<EmptyState icon="grid-outline" title="No tiles" body={canWrite ? "Add a chart tile below, or build the dashboard on Creator Hub." : "Build it on Creator Hub (Analytics > Custom dashboards)."} />
			)}
			{tiles.length > AUTO_LOAD ? <Txt variant="small">Tiles after the first {AUTO_LOAD} load on a tap (Roblox allows 30 analytics queries a minute).</Txt> : null}

			{issues.length ? (
				<Card style={{ gap: 4, borderColor: `${p.destructive}66` }}>
					<Txt style={{ fontWeight: "600" }}>Roblox rejected the document</Txt>
					{issues.map((s, i) => (
						<Txt key={i} variant="small" selectable>
							{s}
						</Txt>
					))}
				</Card>
			) : null}

			{canWrite && (canMeta || canPublish || canDelete) ? (
				<Section title="Edit">
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
						{canMeta ? <Button title="Name & description" icon="create-outline" small onPress={() => setPanel(panel === "details" ? "none" : "details")} /> : null}
						{canPublish ? <Button title="Add chart" icon="add" small onPress={() => setPanel(panel === "tile" ? "none" : "tile")} /> : null}
						{canPublish ? <Button title="Edit JSON" icon="code-slash-outline" small onPress={() => setPanel(panel === "json" ? "none" : "json")} /> : null}
						{canMeta ? <Button title={meta?.isPinned ? "Unpin" : "Pin"} icon="pin-outline" small loading={pin.isPending} onPress={() => pin.mutate()} /> : null}
						{canDelete ? (
						<Button
							title="Delete"
							icon="trash-outline"
							small
							variant="destructive"
							loading={del.isPending}
							onPress={async () => {
								if (await confirm(`Delete “${meta?.name || "this dashboard"}”?`, "It disappears for everyone on the team.", "Delete")) del.mutate();
							}}
						/>
						) : null}
					</View>
					{caps && (!canMeta || !canPublish || !canDelete) ? (
						<Txt variant="small">
							Roblox doesn't let this key {[!canMeta ? "rename or pin" : "", !canPublish ? "change the tiles" : "", !canDelete ? "delete" : ""].filter(Boolean).join(", ")} here.
						</Txt>
					) : null}
					{panel === "details" && canMeta ? <DetailsForm key={etag} maxName={limits?.maxDashboardNameLength || 100} maxDescription={limits?.maxDashboardDescriptionLength || 500} universeId={universeId} cloud={cloud} dashboardId={dashboardId} etag={etag} name={meta?.name ?? ""} description={meta?.description ?? ""} onDone={() => { setPanel("none"); refresh(); }} /> : null}
					{panel === "tile" && canPublish ? <TileForm busy={publish.isPending} maxTitle={limits?.maxTileTitleLength || 100} onAdd={(tile) => {
						const charts = tiles.filter((x) => x.kind !== "summary").length;
						if (limits?.maxChartTilesPerDashboard && charts >= limits.maxChartTilesPerDashboard) return notify("Can't add the chart", `This dashboard already has the most chart tiles Roblox allows (${limits.maxChartTilesPerDashboard}).`);
						try {
							publish.mutate({ next: addChartTile(doc, tile), what: `Adds the chart “${tile.title}”` });
						} catch (e) {
							notify("Can't add the chart", (e as Error).message);
						}
					}} /> : null}
					{panel === "json" && canPublish ? <JsonForm key={etag} doc={doc} busy={publish.isPending} onPublish={(next) => publish.mutate({ next, what: "Replaces the whole dashboard document with the JSON you edited" })} /> : null}
				</Section>
			) : (
				<Txt variant="small">{canWrite ? "Roblox doesn't let this key change this dashboard." : `Read only: add ${DASHBOARD_WRITE} to edit this dashboard.`}</Txt>
			)}

			<Section title="Details">
				<Card>
					<KV label="Dashboard ID" value={dashboardId} mono />
					<KV label="Created" value={meta?.createdTime ? `${fmtTime(meta.createdTime)}${meta.createdBy?.userId ? ` by ${meta.createdBy.userId}` : ""}` : "–"} />
					<KV label="Updated" value={meta?.updatedTime ? fmtTime(meta.updatedTime) : "–"} />
					<KV label="Schema" value={String(doc?.schemaVersion ?? "–")} />
					<KV label="Tiles" value={String(tiles.length)} />
				</Card>
			</Section>
		</>
	);
}

function DetailsForm({
	universeId,
	cloud,
	dashboardId,
	etag,
	name: name0,
	description: desc0,
	maxName,
	maxDescription,
	onDone,
}: {
	universeId: number;
	cloud: OpenCloud;
	dashboardId: string;
	etag: string;
	name: string;
	description: string;
	maxName: number;
	maxDescription: number;
	onDone: () => void;
}) {
	const p = useTheme();
	const [name, setName] = useState(name0);
	const [description, setDescription] = useState(desc0);
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: () => patchDashboardMetadata(cloud, universeId, dashboardId, etag, { name: name.trim(), description: description.trim() }),
		onSuccess: onDone,
		onError: (e) => notify("Couldn't save", cloudErrorText(e)),
	});
	return (
		<Card style={{ gap: 8 }}>
			<Field label="Name" value={name} onChangeText={setName} maxLength={maxName} autoCapitalize="sentences" hint={`At most ${maxName} characters.`} />
			<Field label="Description" value={description} onChangeText={setDescription} maxLength={maxDescription} autoCapitalize="sentences" hint={`At most ${maxDescription} characters.`} />
			<Button
				title="Save"
				variant="primary"
				small
				loading={save.isPending}
				onPress={() => {
					if (!name.trim()) return setError("The name can't be empty.");
					if (name.trim().length > maxName) return setError(`The name is at most ${maxName} characters.`);
					if (description.trim().length > maxDescription) return setError(`The description is at most ${maxDescription} characters.`);
					setError(null);
					save.mutate();
				}}
				style={{ alignSelf: "flex-start" }}
			/>
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : null}
		</Card>
	);
}

function TileForm({
	busy,
	maxTitle,
	onAdd,
}: {
	busy: boolean;
	maxTitle: number;
	onAdd: (tile: { title: string; metricKey: string; granularity: DashboardGranularity; chartType: DashboardChartType; breakdown: string[]; filters: { dimensionKey: string; values: string[] }[] }) => void;
}) {
	const p = useTheme();
	const [title, setTitle] = useState("");
	const [metric, setMetric] = useState("");
	const [granularity, setGranularity] = useState<DashboardGranularity>("DASHBOARD_GRANULARITY_DAY");
	const [chartType, setChartType] = useState<DashboardChartType>("DASHBOARD_CHART_TYPE_SPLINE");
	const [breakdown, setBreakdown] = useState("");
	const [filterDim, setFilterDim] = useState("");
	const [filterValues, setFilterValues] = useState("");
	const [error, setError] = useState<string | null>(null);
	const suggestions = useMemo(() => {
		const t = metric.trim().toLowerCase();
		return ALL_METRICS.filter((m) => !t || m.id.toLowerCase().includes(t) || m.title.toLowerCase().includes(t))
			.filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
			.slice(0, 12);
	}, [metric]);
	return (
		<Card style={{ gap: 8 }}>
			<Field label="Title" value={title} onChangeText={setTitle} placeholder="Daily active users" maxLength={maxTitle} autoCapitalize="sentences" />
			<Field label="Metric" value={metric} onChangeText={setMetric} placeholder="Metric id, e.g. DailyActiveUsers" />
			<Chips options={suggestions.map((m) => ({ value: m.id, label: m.title }))} value={metric} onChange={(id) => setMetric(id)} />
			<Txt variant="label">Granularity</Txt>
			<Chips options={DASH_GRANULARITIES} value={granularity} onChange={setGranularity} />
			<Txt variant="label">Chart</Txt>
			<Chips options={DASH_CHART_TYPES} value={chartType} onChange={setChartType} />
			<Field label="Breakdown (optional)" value={breakdown} onChangeText={setBreakdown} placeholder="Platform, AgeGroup" />
			<Field label="Filter dimension (optional)" value={filterDim} onChangeText={setFilterDim} placeholder="Platform" />
			{filterDim.trim() ? <Field label="Filter values" value={filterValues} onChangeText={setFilterValues} placeholder="Comma separated" /> : null}
			<Button
				title="Add & publish"
				variant="primary"
				icon="add"
				small
				loading={busy}
				onPress={() => {
					const t = title.trim();
					const m = metric.trim();
					if (!t) return setError("Give the tile a title.");
					if (t.length > maxTitle) return setError(`The title is at most ${maxTitle} characters.`);
					if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(m)) return setError("Pick a metric id (letters, digits and _).");
					const values = splitList(filterValues);
					if (filterDim.trim() && !values.length) return setError("Give at least one filter value.");
					setError(null);
					onAdd({ title: t, metricKey: m, granularity, chartType, breakdown: splitList(breakdown), filters: filterDim.trim() ? [{ dimensionKey: filterDim.trim(), values }] : [] });
				}}
				style={{ alignSelf: "flex-start" }}
			/>
			<Txt variant="small">Roblox checks the tile before it is published; it names what it rejects.</Txt>
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : null}
		</Card>
	);
}

function JsonForm({ doc, busy, onPublish }: { doc: CustomDashboardDocument | null; busy: boolean; onPublish: (next: CustomDashboardDocument) => void }) {
	const p = useTheme();
	const [text, setText] = useState(() => prettyJson(doc ?? { schemaVersion: 3, config: { page: { untabbed: { surface: { bodyNodes: [] } } } } }));
	const [error, setError] = useState<string | null>(null);
	return (
		<Card style={{ gap: 8 }}>
			<Txt variant="small">The dashboard document (CustomDashboardDocument). Publishing replaces the whole document.</Txt>
			<Field value={text} onChangeText={setText} multiline style={{ minHeight: 220 }} />
			<Button
				title="Validate & publish"
				variant="primary"
				icon="cloud-upload-outline"
				small
				loading={busy}
				onPress={() => {
					let parsed: unknown;
					try {
						parsed = JSON.parse(text);
					} catch (e) {
						return setError(`Not valid JSON: ${(e as Error).message}`);
					}
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return setError("The document is a JSON object.");
					setError(null);
					onPublish(parsed as CustomDashboardDocument);
				}}
				style={{ alignSelf: "flex-start" }}
			/>
			{error ? (
				<Txt variant="small" color={p.destructive}>
					{error}
				</Txt>
			) : null}
		</Card>
	);
}
