/**
 * Demographics (web pages/Demographics.tsx): who plays, from two sources.
 *   - Roblox (GET /v1/roblox/demographics): age group, gender, language, country, platform and OS as daily active users
 *     over the filter bar's range, with its device, new / returning and country filters as Roblox's Platform /
 *     IsNewUser / Country; the filters Roblox has no equivalent for are listed as not applied. A 409 (or a missing
 *     scope) says how to turn it on (`universe.analytics:read`).
 *   - Our join events (the `demographics` query, every filter applies): country, language, device, account age, Premium.
 * Each card is a ranked bar list: label, bar, share; a tap on a row shows its count.
 */
import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { ApiError } from "@/api/backend";
import { ACCOUNT_AGE, countryName, languageName } from "@/api/tt/audience";
import { ACCOUNT_AGES, type DemographicDimension, type DemographicsResult, type RobloxDemographicBreakdown, type RobloxDemographics } from "@/api/tt/types";
import { Badge, EmptyState, ErrorState, SkeletonList, Txt } from "@/components/ui";
import { Note, Panel, QueryState } from "@/features/typetorch/bits";
import { FilterBar, useTTFilters, useTTRawQuery, type FilterState } from "@/features/typetorch/filters";
import { useTTQuery } from "@/features/typetorch/hooks";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtInt, fmtPct, plural } from "@/lib/format";
import { space, useTheme } from "@/theme";

export const ANALYTICS_SCOPE = "universe.analytics:read";

/** One bar of a card. */
export interface BarRow {
	key: string;
	label: string;
	share: number;
	count: number;
	/** Not sent / unknown: drawn muted. */
	muted?: boolean;
}

const capitalize = (s: string) => (s ? `${s[0]?.toUpperCase()}${s.slice(1)}` : s);
const AGE_ORDER: readonly string[] = ACCOUNT_AGES;

/** Our join events' rows as bars: names for codes, "Not sent" last, account age in age order. */
export function ownRows(dimension: DemographicDimension, r: DemographicsResult): BarRow[] {
	const rows = r.dimensions[dimension].map((x): BarRow => {
		const muted = x.value === null;
		let label = x.value ?? "Not sent";
		if (x.value !== null) {
			if (dimension === "country") label = countryName(x.value);
			else if (dimension === "language") label = languageName(x.value);
			else if (dimension === "accountAge") label = ACCOUNT_AGE[x.value as keyof typeof ACCOUNT_AGE] ?? x.value;
			else if (dimension === "premium") label = x.value === "true" ? "Premium" : "Not Premium";
			else label = capitalize(x.value);
		}
		return { key: x.value ?? "", label, share: x.share, count: x.players, ...(muted ? { muted } : {}) };
	});
	if (dimension === "accountAge") {
		const at = (k: string) => (AGE_ORDER.includes(k) ? AGE_ORDER.indexOf(k) : 99);
		rows.sort((a, b) => at(a.key) - at(b.key));
	} else rows.sort((a, b) => Number(Boolean(a.muted)) - Number(Boolean(b.muted)) || b.count - a.count);
	return rows;
}

/** Roblox's rows as bars: its display names, ISO codes turned into names when it sent none. */
export function robloxRows(breakdown: RobloxDemographicBreakdown, rows: { value: string; label: string; users: number; share: number }[]): BarRow[] {
	return rows.map((x) => {
		let label = x.label;
		if (label === x.value && breakdown === "Country") label = countryName(x.value);
		if (label === x.value && breakdown === "Locale") label = languageName(x.value);
		const muted = /^unknown$/i.test(x.value);
		return { key: x.value, label, share: x.share, count: x.users, ...(muted ? { muted } : {}) };
	});
}

/** A ranked bar list: label, bar scaled to the biggest share, share; the first `top` rows, then a toggle. A tap on a row shows its count. */
export function BarList({ rows, top = 8, unit }: { rows: BarRow[]; top?: number; unit: string }) {
	const p = useTheme();
	const [all, setAll] = useState(false);
	const [picked, setPicked] = useState<string | null>(null);
	if (rows.length === 0) return <Txt variant="muted">Nothing in this range.</Txt>;
	const max = Math.max(...rows.map((r) => r.share), 0.0001);
	const shown = all ? rows : rows.slice(0, top);
	return (
		<View style={{ gap: 8 }}>
			{shown.map((r) => (
				<Pressable key={r.key} onPress={() => setPicked(picked === r.key ? null : r.key)} hitSlop={2} style={{ gap: 3 }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						<Txt variant="small" numberOfLines={1} color={r.muted ? p.mutedForeground : p.foreground} style={{ width: 118, textAlign: "right", fontStyle: r.muted ? "italic" : "normal" }}>
							{r.label}
						</Txt>
						<View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
							<View style={{ height: 10, borderRadius: 5, width: `${Math.max(1.5, (r.share / max) * 78)}%`, backgroundColor: r.muted ? p.mutedForeground : p.chart[0], opacity: r.muted ? 0.4 : 1 }} />
							<Txt variant="small">{fmtPct(r.share, 1)}</Txt>
						</View>
					</View>
					{picked === r.key ? (
						<Txt variant="small" style={{ marginLeft: 126 }}>
							{r.label}: {plural(r.count, unit)} ({fmtPct(r.share, 1)})
						</Txt>
					) : null}
				</Pressable>
			))}
			{rows.length > top ? (
				<Pressable onPress={() => setAll(!all)} hitSlop={6}>
					<Txt variant="small" color={p.brand}>
						{all ? "Show fewer" : `Show all ${rows.length}`}
					</Txt>
				</Pressable>
			) : null}
		</View>
	);
}

const ROBLOX_CARDS: { key: RobloxDemographicBreakdown; title: string; top?: number }[] = [
	{ key: "AgeGroupV2", title: "Age" },
	{ key: "Gender", title: "Gender" },
	{ key: "Locale", title: "Language" },
	{ key: "Country", title: "Country", top: 10 },
	{ key: "Platform", title: "Platform" },
	{ key: "OperatingSystem", title: "Operating system" },
];

/** The filter bar's filters Roblox has no equivalent for (device, new / returning and country map to Roblox's dimensions). */
export function filtersRobloxCannotTake(state: FilterState): string[] {
	const out: string[] = [];
	if (state.branch) out.push("branch");
	if (state.art) out.push("artifact");
	if (state.exp && state.variant) out.push("experiment variant");
	if (state.lang) out.push("language");
	if (state.age) out.push("account age");
	if (state.prem) out.push("Premium");
	if (state.source) out.push("join source");
	return out;
}

const day = (iso: string) => iso.slice(0, 10);

/** "2026-10-18 - 2026-11-14 (28 days, UTC)" from Roblox's window (its end is exclusive). */
export function windowLabel(w: { from: string; to: string; days: number }): string {
	const last = new Date(Date.parse(w.to) - 1).toISOString();
	return w.days === 1 ? `${day(w.from)} (UTC)` : `${day(w.from)} - ${day(last)} (${w.days} days, UTC)`;
}

export default function DemographicsScreen() {
	return <TTScreen title="Demographics">{({ backendId }) => <Demographics backendId={backendId} />}</TTScreen>;
}

function Demographics({ backendId }: { backendId: string }) {
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Who plays: Roblox's own breakdowns (age, gender, language, country, platform), and what our join events say (country, language, device, account age, Premium).</Note>
			<RobloxSection backendId={backendId} />
			<OwnSection backendId={backendId} />
		</>
	);
}

function SourceHeading({ title, source }: { title: string; source: string }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm }}>
			<Txt variant="h3">{title}</Txt>
			<Badge label={`source: ${source}`} />
		</View>
	);
}

function RobloxSection({ backendId }: { backendId: string }) {
	const p = useTheme();
	const { state, apiFilters, pending } = useTTFilters(backendId);
	const params = {
		...(apiFilters.from !== undefined ? { from: String(apiFilters.from) } : {}),
		...(apiFilters.to !== undefined ? { to: String(apiFilters.to) } : {}),
		...(state.dev ? { dev: state.dev } : {}),
		...(state.players ? { players: state.players } : {}),
		...(state.country ? { country: state.country } : {}),
	};
	const q = useTTQuery(backendId, ["roblox", "demographics", params], (api, signal) => api.robloxDemographics(params, signal), {
		enabled: !pending,
		staleTime: 300_000,
		retry: false,
		placeholderData: keepPreviousData,
	});
	const off = q.error instanceof ApiError && q.error.status === 409;
	const noScope = q.error instanceof ApiError && q.error.message.includes(ANALYTICS_SCOPE);
	const cannot = filtersRobloxCannotTake(state);
	return (
		<>
			<SourceHeading title="From Roblox" source="Roblox" />
			{q.data === undefined && !q.error ? (
				<SkeletonList rows={3} />
			) : off || noScope ? (
				<EmptyState
					icon="key-outline"
					title="Off"
					body={`Give OPENCLOUD_API_KEY the ${ANALYTICS_SCOPE} permission (API system universe-analytics, this experience) in Creator Hub${off ? " and set TYPETORCH_UNIVERSE_ID, then restart the backend" : ""}. Age group and gender only come from here: Roblox doesn't give them to game servers.`}
				/>
			) : q.error && !q.data ? (
				<ErrorState error={q.error} title="Roblox didn't answer" onRetry={() => q.refetch()} />
			) : q.data ? (
				<>
					<Note>
						Creator Hub's Demographics: daily active users, {windowLabel(q.data.window)}
						{q.data.window.note ? ` (${q.data.window.note})` : ""}. Cached an hour.
					</Note>
					{q.data.applied.length ? <Note>Filtered at Roblox: {q.data.applied.map((a) => `${a.filter} as ${a.dimension} ${a.values.join(" / ")}`).join("; ")}.</Note> : null}
					{q.data.notApplied.length || cannot.length ? (
						<Txt variant="small" color={p.warning}>
							Not applied here: {[...q.data.notApplied.map((n) => `${n.filter} (${n.reason})`), ...cannot.map((c) => `${c} (Roblox doesn't know it)`)].join("; ")}.
						</Txt>
					) : null}
					<RobloxCards r={q.data} />
				</>
			) : null}
		</>
	);
}

function RobloxCards({ r }: { r: RobloxDemographics }) {
	return (
		<>
			{ROBLOX_CARDS.map((c) => {
				const card = r.breakdowns[c.key];
				if (!card) return null;
				return (
					<Panel key={c.key} title={c.title} {...("error" in card ? {} : { note: `${fmtInt(card.total)} daily active users` })}>
						{"error" in card ? <Txt variant="muted">Roblox refused this card: {card.error}</Txt> : <BarList rows={robloxRows(c.key, card.rows)} unit="daily active user" {...(c.top ? { top: c.top } : {})} />}
					</Panel>
				);
			})}
		</>
	);
}

const OWN_CARDS: { key: DemographicDimension; title: string; info: string; top?: number }[] = [
	{ key: "country", title: "Country", info: "From LocalizationService on the game server at join.", top: 10 },
	{ key: "language", title: "Language", info: "The player's Roblox language setting (Player.LocaleId). Sent by the framework from 2026-11-15; players who only joined on older payloads show as Not sent." },
	{ key: "device", title: "Device", info: "The device of the player's sessions." },
	{ key: "accountAge", title: "Roblox account age", info: "How old the player's Roblox account was at join (not the player's age)." },
	{ key: "premium", title: "Premium", info: "Whether the player had Roblox Premium at join." },
];

function OwnSection({ backendId }: { backendId: string }) {
	const q = useTTRawQuery<DemographicsResult>(backendId, "demographics", {}, { keepPrevious: true });
	return (
		<>
			<SourceHeading title="From our events" source="join events" />
			<QueryState q={q} isEmpty={(d) => d.players === 0} empty="No player joined in this range.">
				{(d) => (
					<>
						<Note>{plural(d.players, "player")} with a join; every filter applies, and each player counts once per card.</Note>
						{OWN_CARDS.map((c) => (
							<Panel key={c.key} title={c.title} note={c.info}>
								<BarList rows={ownRows(c.key, d)} unit="player" {...(c.top ? { top: c.top } : {})} />
							</Panel>
						))}
					</>
				)}
			</QueryState>
		</>
	);
}
