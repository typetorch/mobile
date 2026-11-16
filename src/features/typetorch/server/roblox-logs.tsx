/**
 * Roblox logs (port of the web's pages/server/RobloxLogs.tsx): the errors and warnings Roblox itself kept for this game
 * server (Open Cloud server management, through the backend: GET /v1/roblox/servers/<job>/logs). They need no debug
 * session, so they show for a live server and for one that is gone. Roblox files them under the server's place
 * version: the backend knows it from the heartbeat; for an older kernel the screen asks for it.
 *
 * The entries come from Roblox (and from the game's own messages): every value is shown as text.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { ApiError } from "@/api/backend";
import type { RobloxServerLog } from "@/api/tt/types";
import { Button, ErrorState, Field, Section, Skeleton, Txt } from "@/components/ui";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { fmtInt, fmtTime } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, type Tone } from "@/theme";

import { MEMORY_ONLY, ToneText } from "./shared";

export const ROBLOX_LOGS_OFF_TEXT = "Roblox's server logs need OPENCLOUD_API_KEY (with universe:read on the game) and TYPETORCH_UNIVERSE_ID on the backend.";
export const ROBLOX_LOGS_DESCRIPTION = "Errors and warnings Roblox kept for this server, newest first (about 3 minutes behind; Roblox folds repeats into a count).";

/** Roblox spells severities its own way: anything with "err" is an error, "warn" a warning. */
export function severityTone(severity: string | null): Tone {
	const s = (severity ?? "").toLowerCase();
	if (s.includes("err") || s.includes("crit") || s.includes("fatal")) return "critical";
	if (s.includes("warn")) return "warning";
	return "muted";
}

export function fieldsText(fields: Record<string, string | number | boolean>): string {
	return Object.entries(fields)
		.map(([k, v]) => `${k}=${String(v)}`)
		.join("  ");
}

type Row = RobloxServerLog & { n: number };

const COLUMNS: DataColumn<Row>[] = [
	{ id: "time", header: "When (UTC)", type: "date", accessor: (e) => e.time, format: (_v, e) => (e.time ? fmtTime(e.time) : "–") },
	{ id: "severity", header: "Severity", type: "enum", accessor: (e) => e.severity ?? "unknown", cell: (e) => <ToneText tone={severityTone(e.severity)}>{e.severity ?? "unknown"}</ToneText> },
	{ id: "count", header: "Count", type: "number", accessor: (e) => e.count, format: (_v, e) => (e.count === null ? "–" : fmtInt(e.count)) },
	{ id: "message", header: "Message", accessor: (e) => e.message, mono: true, width: 360 },
	{ id: "stack", header: "Stack", accessor: (e) => e.stack, defaultHidden: true, mono: true, width: 300 },
	{ id: "fields", header: "Other fields", accessor: (e) => fieldsText(e.fields) || null, defaultHidden: true, mono: true, width: 300 },
];

/** A 409 that names the missing place version (an older kernel), as opposed to the backend not being set up. */
export function needsVersion(error: unknown): boolean {
	return error instanceof ApiError && error.status === 409 && typeof error.body === "object" && error.body !== null && "placeVersion" in error.body;
}

function versionOnly(error: unknown): boolean {
	return error instanceof ApiError && typeof (error.body as { placeId?: unknown } | undefined)?.placeId === "number";
}

export function RobloxLogs({ backendId, job, placeVersion }: { backendId: string; job: string; placeVersion?: number | null | undefined }) {
	const { api, account } = useBackend(backendId);
	const [search, setSearch] = useState("");
	const [searchText, setSearchText] = useState("");
	const [order, setOrder] = useState<"desc" | "asc">("desc");
	const [version, setVersion] = useState<number | undefined>();
	const [versionText, setVersionText] = useState("");
	const asked = version ?? placeVersion ?? undefined;
	const logs = useInfiniteQuery({
		queryKey: ["tt", backendId, "roblox-logs", job, search, order, asked ?? null],
		queryFn: ({ pageParam, signal }) =>
			api!.robloxServerLogs(job, { ...(search ? { search } : {}), ...(order === "asc" ? { order } : {}), ...(pageParam ? { pageToken: pageParam } : {}), ...(asked ? { placeVersion: asked } : {}) }, signal),
		initialPageParam: "",
		getNextPageParam: (last) => last.nextPageToken ?? undefined,
		retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
		staleTime: 20_000,
		enabled: !!api && !account?.signedOut,
	});
	const rows: Row[] = (logs.data?.pages ?? []).flatMap((x) => x.logs).map((e, n) => ({ ...e, n }));
	const first = logs.data?.pages[0];
	const off = logs.error instanceof ApiError && logs.error.status === 409 && !needsVersion(logs.error);
	return (
		<Section title="Roblox logs">
			<Txt variant="small">{ROBLOX_LOGS_DESCRIPTION}</Txt>
			{off ? null : (
				<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<View style={{ flex: 1 }}>
						<Field value={searchText} onChangeText={setSearchText} placeholder="search (Enter)" maxLength={200} returnKeyType="search" onSubmitEditing={() => setSearch(searchText.trim())} />
					</View>
					<Button title={order === "desc" ? "Newest first" : "Oldest first"} small onPress={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))} />
				</View>
			)}
			{logs.isPending && !logs.error ? (
				<Skeleton height={80} />
			) : off ? (
				<Txt variant="muted">{ROBLOX_LOGS_OFF_TEXT}</Txt>
			) : needsVersion(logs.error) ? (
				<View style={{ gap: space.sm }}>
					<Txt variant="muted">
						{versionOnly(logs.error)
							? "Roblox files a server's logs under its place version, and this server's kernel doesn't report it. Which place version did it run?"
							: "The fleet no longer knows this server's place, so Roblox's logs can't be asked for."}
					</Txt>
					{versionOnly(logs.error) ? (
						<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
							<View style={{ width: 140 }}>
								<Field value={versionText} onChangeText={(t) => setVersionText(t.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="Place version" />
							</View>
							<Button
								title="Show logs"
								small
								disabled={!versionText}
								onPress={() => {
									const n = Number(versionText);
									if (Number.isSafeInteger(n) && n > 0) setVersion(n);
								}}
							/>
						</View>
					) : null}
				</View>
			) : logs.error ? (
				<ErrorState error={logs.error} title="Could not load Roblox's logs" onRetry={() => void logs.refetch()} />
			) : (
				<View style={{ gap: space.sm }}>
					<DataTable
						id="roblox-logs"
						label="Roblox logs"
						columns={COLUMNS}
						data={rows}
						rowId={(e) => String(e.n)}
						pageSize={100}
						density="compact"
						empty={<Txt variant="muted">{search ? "No log matches this search." : "Roblox has no errors or warnings for this server."}</Txt>}
						{...MEMORY_ONLY}
					/>
					<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
						<Txt variant="small" style={{ flex: 1 }}>
							{fmtInt(rows.length)} loaded{first ? `, place version ${first.placeVersion}` : ""}
							{search ? `, matching "${search}"` : ""}
						</Txt>
						{logs.hasNextPage ? <Button title={logs.isFetchingNextPage ? "Loading..." : "Load more"} small onPress={() => void logs.fetchNextPage()} disabled={logs.isFetchingNextPage} /> : null}
					</View>
				</View>
			)}
		</Section>
	);
}
