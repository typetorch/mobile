/**
 * One debug bundle (kernel 0.5.3, GET /v1/fleet/bundles/<id>): what a game server sent when something failed. Its content
 * comes from the game server and is shown as text only. Player logs are for owners (the backend leaves them out otherwise).
 */
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { asList, asRecord, bundlePlayers, field, logEntries, plain, playerLogOwners } from "@/api/tt/server-history";
import type { DebugBundle, RemoteLogEntry } from "@/api/tt/types";
import { Badge, Card, Chips, EmptyState, ErrorState, KV, List, Skeleton, Txt } from "@/components/ui";
import { CopyButton, JsonBlock, Note, Panel } from "@/features/typetorch/bits";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtBytes, fmtInt, fmtTime, prettyJson, shortId } from "@/lib/format";
import { space, useTheme } from "@/theme";

type Tab = "players" | "server-log" | "player-logs" | "deploy" | "raw";

export default function BundleScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const bid = String(id ?? "");
	return <TTScreen title="Debug bundle">{({ backendId, account }) => <Bundle backendId={backendId} id={bid} readOnly={account.role !== "admin"} />}</TTScreen>;
}

function Bundle({ backendId, id, readOnly }: { backendId: string; id: string; readOnly: boolean }) {
	const q = useTTQuery(backendId, ["bundle", id], (api, s) => api.debugBundle(id, s), { staleTime: 5 * 60_000, retry: false });
	if (q.error) return q.error && "status" in q.error && (q.error as { status: number }).status === 404 ? <EmptyState title="This bundle is gone" body="Bundles are kept 30 days, 20 per server." /> : <ErrorState error={q.error} title="Could not load this bundle" onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton height={240} />;
	return <BundleBody bundle={q.data} readOnly={readOnly} />;
}

function LogLines({ entries, empty }: { entries: RemoteLogEntry[]; empty: string }) {
	const p = useTheme();
	if (!entries.length) return <Txt variant="muted">{empty}</Txt>;
	const color = (k: RemoteLogEntry["kind"]) => (k === "error" ? p.destructive : k === "warning" ? p.warning : k === "info" ? p.chart[0] : p.foreground);
	return (
		<View style={{ gap: 4 }}>
			{entries.map((e) => (
				<View key={e.i} style={{ flexDirection: "row", gap: 6 }}>
					<Txt variant="small" style={{ width: 62, fontFamily: "monospace", fontSize: 10 }}>
						{e.t ? fmtTime(e.t * 1000).slice(11) : `#${e.i}`}
					</Txt>
					<Txt variant="mono" color={color(e.kind)} selectable style={{ flex: 1, fontSize: 11 }}>
						{e.text}
					</Txt>
				</View>
			))}
		</View>
	);
}

const yesNo = (v: unknown) => (v === true ? "yes" : v === false ? "no" : v === undefined || v === null ? "–" : plain(v, 200));
const unixTime = (s: number | undefined) => (s === undefined ? "–" : `${fmtTime(s * 1000).slice(11)} UTC`);

function BundleBody({ bundle, readOnly }: { bundle: DebugBundle; readOnly: boolean }) {
	const p = useTheme();
	const body = bundle.body ?? {};
	const failure = asRecord(body.failure);
	const players = useMemo(() => bundlePlayers(body.players), [body.players]);
	const owners = useMemo(() => playerLogOwners(body.playerLogs, players), [body.playerLogs, players]);
	const ownersOnly = readOnly || bundle.playerLogsHidden === true;
	const [tab, setTab] = useState<Tab>("players");
	const [owner, setOwner] = useState(owners[0]?.userId ?? "");
	const error = plain(failure.error) || bundle.error || "";
	const stage = plain(failure.stage) || bundle.stage || "";
	const triggers = asList(failure.triggers)
		.map((t) => (typeof t === "string" ? t : plain(asRecord(t).code, 64) || plain(t, 120)))
		.filter(Boolean);
	const deploy = body.deploy;
	const history = asList(field(deploy, "history")).map((raw) => asRecord(raw));
	const tabs: { value: Tab; label: string }[] = [
		{ value: "players", label: `Players (${fmtInt(players.length)})` },
		{ value: "server-log", label: "Server log" },
		...(ownersOnly ? [] : [{ value: "player-logs" as const, label: "Player logs" }]),
		{ value: "deploy", label: "Deploy and swaps" },
		{ value: "raw", label: "Raw" },
	];
	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
					<Badge label={bundle.level} tone={bundle.level === "critical" ? "critical" : bundle.level === "warning" ? "warning" : "muted"} />
					<Txt variant="mono">{bundle.code}</Txt>
					{bundle.closing ? <Badge label="sent on close" /> : null}
				</View>
				<Txt style={{ fontWeight: "600" }} selectable>
					{bundle.message || "(no message)"}
				</Txt>
				<KV label="Stage" value={stage || "–"} />
				{triggers.length ? <KV label="Triggers" value={triggers.join(", ")} /> : null}
				<KV label="Sent" value={`${fmtTime(bundle.at)} UTC`} />
				<KV label="Kernel" value={bundle.kernel ?? "–"} />
				<KV label="Branch" value={bundle.branch ?? "–"} />
				<KV label="Build" value={bundle.artifact ?? "–"} mono />
				<KV label="Seq" value={bundle.seq === null ? "–" : String(bundle.seq)} />
				<KV label="Generation" value={bundle.generation === null ? "–" : String(bundle.generation)} />
				<KV label="Size" value={fmtBytes(bundle.size)} />
				<KV label="Id" value={shortId(bundle.id, 6)} mono />
				<KV label="Server" value={shortId(bundle.job, 6)} mono />
			</Card>
			{error ? (
				<Panel title="Error">
					<Txt variant="mono" color={p.destructive} selectable style={{ fontSize: 11 }}>
						{error}
					</Txt>
					<CopyButton text={error} />
				</Panel>
			) : null}
			{failure.report !== undefined ? (
				<Panel title="Failure report">
					<JsonBlock value={failure.report} max={240} />
				</Panel>
			) : null}
			<Chips options={tabs} value={tab} onChange={setTab} />
			{tab === "players" ? (
				players.length ? (
					<List>
						{players.map((x, i) => (
							<View key={`${x.userId}-${i}`} style={{ paddingVertical: 8, paddingHorizontal: space.md, gap: 2 }}>
								<Txt style={{ fontWeight: "600" }}>{x.name || "–"}</Txt>
								<Txt variant="small">
									UserId {x.userId} · joined {unixTime(x.joinedAt)} · {x.leftAt === undefined ? "still in" : `left ${unixTime(x.leftAt)}`}
									{x.ping !== undefined ? ` · ${x.ping} ms` : ""}
								</Txt>
								{x.client ? (
									<Txt variant="mono" style={{ fontSize: 11 }} selectable>
										{x.client}
									</Txt>
								) : null}
							</View>
						))}
					</List>
				) : (
					<Txt variant="muted">Nobody was in the server.</Txt>
				)
			) : tab === "server-log" ? (
				<Card>
					<LogLines entries={logEntries(body.serverLog)} empty="No server log in this bundle." />
				</Card>
			) : tab === "player-logs" ? (
				owners.length ? (
					<>
						<Chips options={owners.map((o) => ({ value: o.userId, label: o.label }))} value={owner || (owners[0]?.userId ?? "")} onChange={setOwner} />
						<Card>
							<LogLines entries={logEntries(asRecord(body.playerLogs)[owner || (owners[0]?.userId ?? "")])} empty="No lines from this client." />
						</Card>
					</>
				) : (
					<Txt variant="muted">No player logs in this bundle.</Txt>
				)
			) : tab === "deploy" ? (
				deploy === undefined && body.fallback === undefined ? (
					<Txt variant="muted">No deploy state in this bundle.</Txt>
				) : (
					<>
						<Card>
							<KV label="Applied seq" value={plain(field(deploy, "appliedSeq"), 32) || "–"} />
							<KV label="Failing" value={yesNo(field(deploy, "failing"))} />
							<KV label="Pending" value={yesNo(field(deploy, "pending"))} />
							<KV label="Wanted" value={yesNo(field(deploy, "wanted"))} />
							<KV label="Busy" value={yesNo(field(deploy, "busy"))} />
							<KV label="Restoring" value={yesNo(field(deploy, "restoring"))} />
						</Card>
						<Panel title="Generation history">
							{history.length ? (
								<List>
									{history.map((e, i) => (
										<View key={i} style={{ paddingVertical: 6, paddingHorizontal: space.md, gap: 2 }}>
											<Txt variant="mono">
												{plain(e.name, 64) || "?"} · {plain(e.artifactId, 64) || "–"}
											</Txt>
											<Txt variant="small">
												{[plain(e.at, 40), plain(e.branch, 64), plain(e.reason, 32), e.loadSeconds !== undefined ? `load ${plain(e.loadSeconds, 16)} s` : "", e.swapSeconds !== undefined ? `swap ${plain(e.swapSeconds, 16)} s` : ""].filter(Boolean).join(" · ")}
											</Txt>
										</View>
									))}
								</List>
							) : (
								<Txt variant="muted">No generation history.</Txt>
							)}
						</Panel>
						{field(deploy, "failedHere") !== undefined ? (
							<Panel title="Failed here">
								<JsonBlock value={field(deploy, "failedHere")} max={240} />
							</Panel>
						) : null}
						<Panel title={`Swap reports (${fmtInt(asList(field(deploy, "reports")).length)})`}>{asList(field(deploy, "reports")).length ? <JsonBlock value={field(deploy, "reports")} max={240} /> : <Txt variant="muted">None.</Txt>}</Panel>
						<Panel title={`Refusals (${fmtInt(asList(field(deploy, "refusals")).length)})`}>{asList(field(deploy, "refusals")).length ? <JsonBlock value={field(deploy, "refusals")} max={240} /> : <Txt variant="muted">None.</Txt>}</Panel>
						{field(deploy, "heads") !== undefined ? (
							<Panel title="Heads">
								<JsonBlock value={field(deploy, "heads")} max={240} />
							</Panel>
						) : null}
						<Panel title="Fallback">{body.fallback !== undefined && body.fallback !== null ? <JsonBlock value={body.fallback} max={240} /> : <Txt variant="muted">No Fallback state.</Txt>}</Panel>
					</>
				)
			) : (
				<Panel title="Server, alerts and the raw bundle">
					<JsonBlock value={{ server: body.server ?? null, alerts: body.alerts ?? [] }} max={240} />
					<JsonBlock value={body} />
					<CopyButton text={prettyJson(body)} title="Copy raw JSON" />
				</Panel>
			)}
			{ownersOnly ? <Note>Player logs are for owners: this session is read-only.</Note> : null}
		</>
	);
}
