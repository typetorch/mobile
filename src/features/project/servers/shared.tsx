/**
 * Pieces the Servers, Server, Restart and Bans screens share: the universe's places (public list), a multi-select chip
 * row, a switch row, the server status badge, and the log viewer (game server logs and client session logs: severity
 * and text filters, newest / oldest first, paged).
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { universePlaces, type PlaceInfo } from "@/api/roblox-public";
import { Badge, Button, Chips, EmptyState, Field, List, Segmented, SkeletonList, Txt } from "@/components/ui";
import { CloudError } from "@/features/project/CloudError";
import { fmtTime } from "@/lib/format";
import { font, useTheme, type Tone } from "@/theme";

import { LOG_SEARCH_MAX, LOG_SEVERITIES, severityLevel, type LogEntry, type LogQuery, type ServerStatus } from "../api/servers";

/** The universe's places from the public list (same query key as the Overview). */
export function usePlaces(universeId: number) {
	return useQuery({ queryKey: ["places", universeId], queryFn: () => universePlaces(universeId), staleTime: 300_000, retry: false });
}

export function placeName(places: PlaceInfo[] | undefined, placeId: number | string | null | undefined): string {
	const p = places?.find((x) => String(x.id) === String(placeId));
	return p ? p.name : `Place ${placeId ?? "?"}`;
}

/** Chips where several can be on. */
export function MultiChips<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void }) {
	const p = useTheme();
	return (
		<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
			{options.map((o) => {
				const active = value.includes(o.value);
				return (
					<Pressable
						key={String(o.value)}
						onPress={() => onChange(active ? value.filter((v) => v !== o.value) : [...value, o.value])}
						style={{
							paddingVertical: 5,
							paddingHorizontal: 10,
							borderRadius: 999,
							borderWidth: StyleSheet.hairlineWidth,
							borderColor: active ? p.brand : p.border,
							backgroundColor: active ? p.brand : p.card,
						}}
					>
						<Text style={{ color: active ? p.brandForeground : p.foreground, fontSize: font.sm, fontWeight: "500" }}>{o.label}</Text>
					</Pressable>
				);
			})}
		</ScrollView>
	);
}

export function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
			<View style={{ flex: 1, gap: 2 }}>
				<Txt>{label}</Txt>
				{hint ? <Txt variant="small">{hint}</Txt> : null}
			</View>
			<Switch value={value} onValueChange={onChange} disabled={disabled} />
		</View>
	);
}

const STATUS_TONE: Record<string, Tone> = {
	active: "good",
	pending: "brand",
	shut_down: "muted",
	restarted: "muted",
	developer_restarted: "muted",
	roblox_restarted: "warning",
	crashed: "critical",
	out_of_memory: "critical",
	moderated: "serious",
	unspecified: "muted",
};

export function ServerStatusBadge({ status }: { status: ServerStatus | string | undefined }) {
	const s = status ?? "unspecified";
	return <Badge label={s.replace(/_/g, " ")} tone={STATUS_TONE[s] ?? "muted"} />;
}

const SEVERITY_TONE: Tone[] = ["muted", "brand", "warning", "critical"];

const SEVERITY_FILTERS = [
	{ value: "all", label: "All", severities: [] as number[] },
	{ value: "errors", label: "Errors", severities: [3] },
	{ value: "warnings", label: "Warnings +", severities: [2, 3] },
	{ value: "info", label: "Info", severities: [1] },
	{ value: "output", label: "Output", severities: [0] },
] as const;

type SeverityFilter = (typeof SEVERITY_FILTERS)[number]["value"];

function logTime(t: string | number): string {
	const n = typeof t === "number" ? t : /^\d+$/.test(t) ? Number(t) : Date.parse(t);
	return Number.isFinite(n) ? `${fmtTime(n)}` : String(t);
}

function LogRow({ entry }: { entry: LogEntry }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	const level = severityLevel(entry.severity);
	const repeats = (entry.skippedCount ?? 0) + (entry.rateLimitedCount ?? 0);
	const stack = entry.structuredStackTrace?.length
		? entry.structuredStackTrace.map((f) => `${f.scriptPath ?? "?"}:${f.line}${f.function ? ` ${f.function}` : ""}`).join("\n")
		: entry.stackTrace;
	return (
		<Pressable onPress={() => setOpen(!open)} style={{ paddingVertical: 8, paddingHorizontal: 12, gap: 4 }}>
			<View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
				<Badge label={LOG_SEVERITIES[level]?.label ?? String(entry.severity)} tone={SEVERITY_TONE[level] ?? "muted"} />
				<Txt variant="small">{logTime(entry.messageTimestampMs)}</Txt>
				{entry.placeVersion ? <Txt variant="small">v{entry.placeVersion}</Txt> : null}
				{repeats ? <Txt variant="small">+{repeats} repeats</Txt> : null}
			</View>
			<Txt variant="mono" numberOfLines={open ? undefined : 4} selectable={open} color={level === 3 ? p.destructive : undefined}>
				{entry.message ?? ""}
			</Txt>
			{open && stack ? (
				<Txt variant="mono" selectable style={{ color: p.mutedForeground }}>
					{stack}
				</Txt>
			) : null}
			{open && entry.loggerFullPath ? <Txt variant="small">Logger: {entry.loggerFullPath}</Txt> : null}
			{open && entry.context ? <Txt variant="small" selectable>Context: {entry.context}</Txt> : null}
		</Pressable>
	);
}

/** A paged log viewer. `fetchPage` gets the query and a page token. */
export function LogsPanel({
	queryKey,
	what,
	fetchPage,
	emptyBody,
}: {
	queryKey: readonly unknown[];
	what: string;
	fetchPage: (q: LogQuery, pageToken: string | undefined) => Promise<{ entries: LogEntry[]; next?: string | null }>;
	emptyBody?: string;
}) {
	const [severity, setSeverity] = useState<SeverityFilter>("all");
	const [newestFirst, setNewestFirst] = useState(true);
	const [searchText, setSearchText] = useState("");
	const [search, setSearch] = useState("");
	const q: LogQuery = { severities: [...(SEVERITY_FILTERS.find((s) => s.value === severity)?.severities ?? [])], search, newestFirst };
	const logs = useInfiniteQuery({
		queryKey: [...queryKey, severity, search, newestFirst],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) => fetchPage(q, pageParam),
		getNextPageParam: (last) => last.next || undefined,
		retry: false,
	});
	const rows = logs.data?.pages.flatMap((pg) => pg.entries) ?? [];
	return (
		<View style={{ gap: 8 }}>
			<Chips options={SEVERITY_FILTERS.map((s) => ({ value: s.value, label: s.label }))} value={severity} onChange={setSeverity} />
			<View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
				<View style={{ flex: 1 }}>
					<Field value={searchText} onChangeText={setSearchText} placeholder="Search the text" maxLength={LOG_SEARCH_MAX} returnKeyType="search" onSubmitEditing={() => setSearch(searchText.trim())} />
				</View>
				<Button title="Search" small onPress={() => setSearch(searchText.trim())} />
			</View>
			<Segmented options={[{ value: 1, label: "Newest first" }, { value: 0, label: "Oldest first" }]} value={newestFirst ? 1 : 0} onChange={(v) => setNewestFirst(v === 1)} />
			{logs.error ? (
				<CloudError error={logs.error} what={what} onRetry={() => logs.refetch()} />
			) : !logs.data ? (
				<SkeletonList rows={4} />
			) : rows.length ? (
				<>
					<List>
						{rows.map((e, i) => (
							<LogRow key={i} entry={e} />
						))}
					</List>
					{logs.hasNextPage ? <Button title="Load more" small loading={logs.isFetchingNextPage} onPress={() => logs.fetchNextPage()} style={{ alignSelf: "center" }} /> : null}
				</>
			) : (
				<EmptyState icon="document-text-outline" title="No log lines" body={emptyBody ?? (search || severity !== "all" ? "Nothing matches these filters." : "Nothing was logged.")} />
			)}
		</View>
	);
}

/** A labelled row of small facts (for list rows). */
export function Facts({ items }: { items: (string | null | undefined | false)[] }) {
	return <Txt variant="small" numberOfLines={2}>{items.filter(Boolean).join(" · ")}</Txt>;
}

