/**
 * One release: its outcome, the servers' reports by result, errors, the servers behind, its alerts (ack for admins),
 * before vs after (web pages/DeployDetail.tsx Impact: two equal windows on each side, `hours` in the route: the error
 * kinds of each (GET /v1/errors twice) and the key performance numbers (`perf-compare`, mode around)), and the releases
 * before and after. Promote / rollback are CLI operations: the backend API has no endpoint for them.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { ApiError } from "@/api/backend";
import { errorChanges, IMPACT_HOURS, impactWindows, OUTCOME_STYLE, startedByText, type DeployRecord, type ErrorChange } from "@/api/tt/deploys";
import { Badge, Button, Card, Chips, Dot, EmptyState, ErrorState, KV, List, Row, Section, Skeleton, SkeletonList, Stat, StatGrid, Txt, confirm } from "@/components/ui";
import { useTTAnalytics } from "@/features/typetorch/filters";
import { errorKindHref } from "@/features/typetorch/errors";
import { outcomeTone, useTTQuery } from "@/features/typetorch/hooks";
import { CompareTable } from "@/features/typetorch/perf-compare";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
import { usePageParam } from "@/features/typetorch/view-link";
import { fmtAgo, fmtDuration, fmtInt, fmtTime, shortId } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { useTheme } from "@/theme";

export default function DeployScreen() {
	const { seq } = useLocalSearchParams<{ seq: string }>();
	const n = Number(seq);
	return <TTScreen title={`Deploy #${n}`}>{({ backendId, account }) => <Deploy backendId={backendId} seq={n} admin={account.role === "admin"} />}</TTScreen>;
}

function Deploy({ backendId, seq, admin }: { backendId: string; seq: number; admin: boolean }) {
	const p = useTheme();
	const { api } = useBackend(backendId);
	const queryClient = useQueryClient();
	const q = useTTQuery(backendId, ["deploy", seq], (a, s) => a.fleetDeploy(seq, s), { refetchInterval: (query) => (query.state.data?.deploy.outcome === "pending" ? 5_000 : false) });
	const ack = useMutation({
		mutationFn: (id: number) => api!.ackAlert(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tt", backendId] }),
	});
	if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton height={220} />;
	const { deploy: d, report, alerts, previous, next } = q.data;
	return (
		<>
			<Card style={{ gap: 6 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<Txt variant="h3" style={{ flex: 1 }}>
						#{d.seq} {d.kind}
					</Txt>
					<Badge label={OUTCOME_STYLE[d.outcome]?.label ?? d.outcome} tone={outcomeTone(d.outcome)} />
				</View>
				<Txt variant="muted">{OUTCOME_STYLE[d.outcome]?.help}</Txt>
				{d.message ? <Txt>{d.message}</Txt> : null}
			</Card>
			<StatGrid>
				<Stat label="Reported" value={fmtInt(d.reported)} />
				<Stat label="OK" value={fmtInt(d.ok)} tone={d.ok ? "good" : undefined} />
				<Stat label="Failed" value={fmtInt(d.failed)} tone={d.failed ? "critical" : undefined} />
				<Stat label="Stuck" value={fmtInt(d.stuck)} tone={d.stuck ? "warning" : undefined} />
			</StatGrid>
			<Card>
				<KV label="Branch" value={d.branch ?? "–"} />
				<KV label="Channel" value={d.channel ?? "–"} />
				<KV label="Artifact" value={shortId(d.artifact, 8)} mono />
				<KV label="From" value={shortId(d.from, 8)} mono />
				<KV label="Started by" value={startedByText(d)} />
				<KV label="Started" value={`${fmtTime(d.startedAt)} (${fmtAgo(d.at)})`} />
				<KV label="First report" value={fmtTime(d.firstReport)} />
				<KV label="Last report" value={fmtTime(d.lastReport)} />
				<KV label="New error kinds" value={fmtInt(d.errorKinds)} />
			</Card>

			{report?.results.length ? (
				<Section title="Results">
					<List>
						{report.results.map((r) => (
							<Row
								key={r.result}
								left={<Dot tone={r.result === "ok" || r.result === "applied" ? "good" : "warning"} />}
								title={r.result}
								subtitle={`${fmtInt(r.servers)} servers · ${fmtInt(r.players)} players${r.medianSeconds !== null ? ` · median ${r.medianSeconds.toFixed(1)} s` : ""}`}
							/>
						))}
					</List>
				</Section>
			) : null}

			{d.errors.length ? (
				<Section title="Errors">
					<List>
						{d.errors.map((e, i) => (
							<Row key={i} title={e.error} subtitle={`${e.servers} servers`} numberOfLines={3} />
						))}
					</List>
				</Section>
			) : null}

			{report?.behind.length ? (
				<Section title={`Servers behind (${report.behind.length})`}>
					<List>
						{report.behind.slice(0, 30).map((s) => (
							<Row key={s.job} chevron onPress={() => router.push(`/tt/${backendId}/server/${encodeURIComponent(s.job)}`)} title={<Txt variant="mono">{shortId(s.job, 6)}</Txt>} subtitle={`${shortId(s.artifact, 6)} · ${s.players ?? 0} players`} />
						))}
					</List>
				</Section>
			) : null}

			{alerts.length ? (
				<Section title="Alerts">
					<List>
						{alerts.map((a) => (
							<Row
								key={a.id}
								left={<Dot tone={a.level === "critical" ? "critical" : a.level === "warning" ? "warning" : "muted"} />}
								title={a.message}
								subtitle={`${a.code} · ${fmtAgo(a.at)}${a.acked ? " · acknowledged" : ""}`}
								numberOfLines={3}
								right={
									admin && !a.acked ? (
										<Button
											title="Ack"
											small
											loading={ack.isPending && ack.variables === a.id}
											onPress={async () => {
												if (await confirm("Acknowledge this alert?", a.message, "Acknowledge", false)) ack.mutate(a.id);
											}}
										/>
									) : undefined
								}
							/>
						))}
					</List>
					{ack.error ? <Txt variant="small" color={p.destructive}>{(ack.error as Error).message}</Txt> : null}
				</Section>
			) : null}

			<Impact backendId={backendId} deploy={d} />

			<View style={{ flexDirection: "row", gap: 8 }}>
				{previous ? <Button title={`← #${previous.seq}`} small onPress={() => router.replace(`/tt/${backendId}/deploy/${previous.seq}`)} /> : null}
				<View style={{ flex: 1 }} />
				{next ? <Button title={`#${next.seq} →`} small onPress={() => router.replace(`/tt/${backendId}/deploy/${next.seq}`)} /> : null}
			</View>
			<Txt variant="small" style={{ textAlign: "center" }}>
				Promote and roll back with the TypeTorch CLI (they are signed releases); the backend API has no endpoint for them.
			</Txt>
		</>
	);
}

// Before vs after ---------------------------------------------------------------------------------------------------------

const ERROR_LIMIT = 200;

/** "not on this backend" for a part that is off (404) or not ready (503), else the error. */
function Unavailable({ error, what }: { error: unknown; what: string }) {
	if (error instanceof ApiError && (error.notFound || error.status === 503)) return <Txt variant="muted">{what} are not available on this backend.</Txt>;
	return <ErrorState error={error} title={`Could not load the ${what.toLowerCase()}`} />;
}

function changeColumns(backendId: string, p: ReturnType<typeof useTheme>): DataColumn<ErrorChange>[] {
	return [
		{
			id: "template",
			header: "Error",
			width: 230,
			accessor: (c) => c.template,
			cell: (c) => (
				<Txt variant="mono" color={p.brand} numberOfLines={3} style={{ fontSize: 11 }}>
					{c.template}
				</Txt>
			),
		},
		{ id: "realm", header: "Side", type: "enum", width: 70, accessor: (c) => c.realm },
		{ id: "before", header: "Before", type: "number", width: 70, accessor: (c) => c.before, format: (_v, c) => fmtInt(c.before) },
		{ id: "after", header: "After", type: "number", width: 70, accessor: (c) => c.after, format: (_v, c) => fmtInt(c.after) },
		{ id: "isNew", header: "New", type: "boolean", width: 60, title: "Seen after the deploy and not in the window before it", accessor: (c) => c.isNew, cell: (c) => (c.isNew ? <Badge label="new" tone="critical" /> : null) },
	];
}

function ErrorsAround({ backendId, windows, branch }: { backendId: string; windows: NonNullable<ReturnType<typeof impactWindows>>; branch: string | null }) {
	const p = useTheme();
	const params = (w: { from: number; to: number }) => ({ from: w.from, to: w.to, limit: ERROR_LIMIT, ...(branch ? { branch } : {}) });
	const before = useTTQuery(backendId, ["errors", "list", "deploy", params(windows.before)], (api, signal) => api.errors(params(windows.before), signal), { retry: false });
	const after = useTTQuery(backendId, ["errors", "list", "deploy", params(windows.after)], (api, signal) => api.errors(params(windows.after), signal), { retry: false });
	const columns = useMemo(() => changeColumns(backendId, p), [backendId, p]);
	if (before.error || after.error) return <Unavailable error={before.error ?? after.error} what="Error logs" />;
	if (!before.data || !after.data) return <SkeletonList rows={3} />;
	const changes = errorChanges(before.data, after.data);
	const fresh = changes.filter((c) => c.isNew).length;
	return (
		<View style={{ gap: 8 }}>
			<StatGrid>
				<Stat label="Errors before" value={fmtInt(before.data.totals.count)} sub={`${fmtInt(before.data.totals.kinds)} kinds`} />
				<Stat label="Errors after" value={fmtInt(after.data.totals.count)} sub={`${fmtInt(after.data.totals.kinds)} kinds`} />
				<Stat label="New kinds after" value={fmtInt(fresh)} tone={fresh ? "critical" : undefined} />
				<Stat label="Players affected after" value={fmtInt(after.data.totals.players)} sub={`${fmtInt(before.data.totals.players)} before`} />
			</StatGrid>
			<DataTable
				id="deploy-error-changes"
				label="Error kinds before vs after"
				columns={columns}
				data={changes}
				rowId={(c) => c.fp}
				onRowPress={(c) => router.push(errorKindHref(backendId, c.fp, branch ? { branch } : {}) as never)}
				empty={<Txt variant="muted">No errors in either window.</Txt>}
			/>
		</View>
	);
}

function PerfAround({ backendId, at, hours, branch }: { backendId: string; at: number; hours: number; branch: string | null }) {
	const q = useTTAnalytics(backendId, "perf-compare", { mode: "around", at, hours }, { filters: branch ? { branch } : {} });
	if (q.error) return <Unavailable error={q.error} what="Performance numbers" />;
	if (!q.data) return <SkeletonList rows={4} />;
	return <CompareTable result={q.data} />;
}

function Impact({ backendId, deploy }: { backendId: string; deploy: DeployRecord }) {
	const [hoursParam, setHours] = usePageParam("hours", "24");
	const hours = IMPACT_HOURS.includes(Number(hoursParam)) ? Number(hoursParam) : 24;
	const windows = impactWindows(deploy.at, hours, Date.now());
	return (
		<Section title="Before vs after">
			<Txt variant="small">
				{windows ? `Two equal windows of ${fmtDuration(windows.ms)} on each side of the deploy${deploy.branch ? `, branch ${deploy.branch} only` : ""}.` : "Wait at least 5 minutes after the deploy to compare."}
			</Txt>
			<Chips options={IMPACT_HOURS.map((h) => ({ value: String(h), label: `${h < 24 ? `${h} h` : `${h / 24} d`} each` }))} value={String(hours)} onChange={setHours} />
			{windows ? (
				<View style={{ gap: 12 }}>
					<Txt variant="h3">Errors</Txt>
					<ErrorsAround backendId={backendId} windows={windows} branch={deploy.branch} />
					<Txt variant="h3">Performance</Txt>
					<PerfAround backendId={backendId} at={deploy.at} hours={hours} branch={deploy.branch} />
				</View>
			) : (
				<EmptyState icon="time-outline" title="Too soon after the deploy to compare." />
			)}
		</Section>
	);
}
