/**
 * Audit log (owners only, GET /v1/admin/audit): who did what on the admin side, newest first, a page at a time; filters
 * by actor, action and outcome. The backend redacts secrets before anything is stored.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { Api } from "@/api/backend";
import type { AuditEntry, AuditFilters, AuditPage } from "@/api/tt/types";
import { Badge, Button, Chips, EmptyState, ErrorState, List, SkeletonList, Txt } from "@/components/ui";
import { JsonBlock, Note } from "@/features/typetorch/bits";
import { TTScreen } from "@/features/typetorch/screen";
import { compactJson, fmtAgo, fmtInt, fmtTime } from "@/lib/format";
import { useBackend } from "@/store/accounts";
import { space, useTheme, type Tone } from "@/theme";

const PAGE = 100;
const OUTCOMES: AuditEntry["outcome"][] = ["ok", "failed", "refused"];
const OUTCOME_TONE: Record<AuditEntry["outcome"], Tone> = { ok: "muted", failed: "critical", refused: "warning" };

const shown = (v: unknown) => (Array.isArray(v) ? v.join(", ") || "none" : typeof v === "string" ? v || '""' : JSON.stringify(v));

/** One line about what an entry changed (the web's auditSummary). */
function auditSummary(e: Pick<AuditEntry, "action" | "details">): string {
	const d = e.details ?? {};
	if (e.action === "settings.change" && Array.isArray(d.changes)) {
		return (d.changes as Record<string, unknown>[])
			.map((c) => {
				if (Array.isArray(c.added) || Array.isArray(c.removed)) {
					const added = (c.added as unknown[] | undefined) ?? [];
					const removed = (c.removed as unknown[] | undefined) ?? [];
					return `${String(c.key)}: ${[added.length ? `+${added.join(", +")}` : "", removed.length ? `-${removed.join(", -")}` : ""].filter(Boolean).join(" ") || "reordered"}`;
				}
				return `${String(c.key)}: ${shown(c.from)} -> ${shown(c.to)}`;
			})
			.join("; ");
	}
	if (e.action === "access.owners" && (Array.isArray(d.added) || Array.isArray(d.removed))) {
		const added = (d.added as unknown[]) ?? [];
		const removed = (d.removed as unknown[]) ?? [];
		return [`seq ${String(d.seq ?? "?")}`, added.length ? `added ${added.join(", ")}` : "", removed.length ? `removed ${removed.join(", ")}` : "", !added.length && !removed.length ? "no change" : ""].filter(Boolean).join("; ");
	}
	if (!Object.keys(d).length) return "";
	return compactJson(d, 240);
}

export default function AuditScreen() {
	return <TTScreen title="Audit log">{({ backendId, account }) => (account.role === "admin" ? <Audit backendId={backendId} /> : <EmptyState icon="lock-closed-outline" title="Owners only" body="The audit log is for the backend's owners (the admin role)." />)}</TTScreen>;
}

function Audit({ backendId }: { backendId: string }) {
	const { api, account } = useBackend(backendId);
	const [filters, setFilters] = useState<AuditFilters>({});
	const [open, setOpen] = useState<number | null>(null);
	const query = useInfiniteQuery({
		queryKey: ["tt", backendId, "audit", filters],
		queryFn: ({ pageParam, signal }) => (api as Api).audit({ ...filters, limit: PAGE, ...(pageParam ? { before: pageParam } : { facets: true }) }, signal),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (last: AuditPage) => last.next ?? undefined,
		refetchInterval: 30_000,
		enabled: !!api && !account?.signedOut,
	});
	const pages = query.data?.pages ?? [];
	const entries = useMemo(() => pages.flatMap((p) => p.entries), [pages]);
	const facets = pages[0]?.facets;
	const keepDays = pages[0]?.keepDays;
	const set = (key: keyof AuditFilters, value: string) => setFilters((f) => ({ ...f, [key]: value || undefined }));
	const withCurrent = (opts: { value: string; label: string }[], current: string | undefined) => [{ value: "", label: "every" }, ...(current && !opts.some((o) => o.value === current) ? [{ value: current, label: current }] : []), ...opts];
	const any = !!(filters.actor || filters.action || filters.outcome);
	return (
		<>
			<Note>Who did what on the admin side: sign-ins, settings, owners and viewers, trusted browsers, alert acks, erasure, backups.{keepDays ? ` Kept ${fmtInt(keepDays)} days.` : ""} Secrets are never recorded.</Note>
			<Txt variant="label">Actor</Txt>
			<Chips options={withCurrent((facets?.actors ?? []).map((a) => ({ value: a.actor, label: `${a.actor} (${fmtInt(a.entries)})` })), filters.actor)} value={filters.actor ?? ""} onChange={(v) => set("actor", v)} />
			<Txt variant="label">Action</Txt>
			<Chips options={withCurrent((facets?.actions ?? []).map((a) => ({ value: a.action, label: `${a.action} (${fmtInt(a.entries)})` })), filters.action)} value={filters.action ?? ""} onChange={(v) => set("action", v)} />
			<Txt variant="label">Outcome</Txt>
			<Chips options={[{ value: "", label: "every" }, ...OUTCOMES.map((o) => ({ value: o, label: o }))]} value={filters.outcome ?? ""} onChange={(v) => set("outcome", v)} />
			{any ? <Button title="Clear filters" small variant="ghost" onPress={() => setFilters({})} style={{ alignSelf: "flex-start" }} /> : null}
			{query.isPending ? (
				<SkeletonList rows={6} />
			) : query.isError ? (
				<ErrorState error={query.error} onRetry={() => query.refetch()} />
			) : entries.length ? (
				<>
					<List>
						{entries.map((e) => (
							<Entry key={e.id} e={e} open={open === e.id} onPress={() => setOpen(open === e.id ? null : e.id)} />
						))}
					</List>
					{query.hasNextPage ? (
						<Button title={query.isFetchingNextPage ? "Loading" : "Load older entries"} small loading={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} style={{ alignSelf: "flex-start" }} />
					) : (
						<Note>That is everything kept{keepDays ? ` (the last ${fmtInt(keepDays)} days)` : ""}.</Note>
					)}
				</>
			) : (
				<EmptyState icon="document-text-outline" title={any ? "No entries match these filters." : "Nothing recorded yet."} body={any ? undefined : "Sign-ins and every change on the admin side show up here."} />
			)}
		</>
	);
}

function Entry({ e, open, onPress }: { e: AuditEntry; open: boolean; onPress(): void }) {
	const p = useTheme();
	const summary = auditSummary(e);
	return (
		<Pressable onPress={onPress} android_ripple={{ color: p.accent }} style={{ paddingVertical: 8, paddingHorizontal: space.md, gap: 3 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
				<Txt variant="mono" style={{ flex: 1 }} numberOfLines={1}>
					{e.action}
				</Txt>
				<Badge label={`${e.outcome}${e.status && e.status >= 400 ? ` ${e.status}` : ""}`} tone={OUTCOME_TONE[e.outcome]} />
			</View>
			<Txt variant="small" numberOfLines={open ? undefined : 1}>
				{e.actor}
				{e.role !== "none" ? ` (${e.role}${e.via === "bearer" ? ", CLI token / app" : e.via === "cookie" ? ", explorer" : ""})` : ""} · {fmtAgo(e.at)}
				{e.ip ? ` · ${e.ip}` : ""}
			</Txt>
			{summary ? (
				<Txt variant="small" color={p.foreground} numberOfLines={open ? undefined : 2}>
					{summary}
				</Txt>
			) : null}
			{open ? (
				<View style={{ gap: 4 }}>
					<Txt variant="small">
						{fmtTime(e.at)} UTC · id {e.id}
					</Txt>
					{e.details ? <JsonBlock value={e.details} max={260} /> : null}
				</View>
			) : null}
		</Pressable>
	);
}
