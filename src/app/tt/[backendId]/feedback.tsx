/**
 * Feedback (web pages/Feedback.tsx, plans/32): what players said through `TypeTorch.feedback().submit(...)` (the
 * `feedback` rows) and the older `custom/feedback` rows (read as the faces scale). The range and the device are the
 * page's own (the filter bar is off; they write the same per-backend state), four KPIs, one distribution per scale in
 * its own shape, the trend, and the list with its filters (`rating`, `text`, `q` in the route), 50 a page.
 */
import { useEffect, useState } from "react";
import { View } from "react-native";

import type { FeedbackScaleSummary, FeedbackSummaryResult, Filters } from "@/api/tt/types";
import { Button, SearchBar, StatGrid, Stat, Txt } from "@/components/ui";
import { DevicePicker, Picker, RangePicker } from "@/features/typetorch/analytics-bits";
import { FeedbackList, Distribution, scaleName, TrendChart } from "@/features/typetorch/feedback";
import { Note, Panel, QueryState } from "@/features/typetorch/bits";
import { describeRange, rangeOnly, useTTAnalytics, useTTFilters } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { usePageParam } from "@/features/typetorch/view-link";
import { fmtInt, fmtPct } from "@/lib/format";
import { space } from "@/theme";

export const PAGE_SIZE = 50;
const ALL = "";
export const EMPTY_TEXT = "No feedback yet in this range. Games send it with TypeTorch.feedback().submit(player, { rating, text }) on the server; older custom events named feedback show here too.";

/** The rating filter's value: `<scale>:<r>`. */
export function parseRating(value: string): { scale: string; r: number } | null {
	const m = /^([A-Za-z0-9_.-]{1,64}):(\d{1,2})$/.exec(value);
	return m ? { scale: m[1] as string, r: Number(m[2]) } : null;
}

function ratingOptions(scales: FeedbackScaleSummary[]): { value: string; label: string }[] {
	return scales.flatMap((s) =>
		[...s.counts].reverse().map((c) => ({
			value: `${s.scale}:${c.r}`,
			label: `${scales.length > 1 ? `${scaleName(s)}: ` : ""}${c.label ?? (s.type === "stars" ? `${c.r} stars` : s.type === "thumbs" ? (c.r ? "Up" : "Down") : String(c.r))}`,
		})),
	);
}

export default function FeedbackScreen() {
	return <TTScreen title="Feedback">{({ backendId }) => <Feedback backendId={backendId} />}</TTScreen>;
}

function Feedback({ backendId }: { backendId: string }) {
	const { state, apiFilters } = useTTFilters(backendId);
	// Only the range and the device apply here (the filter bar is off).
	const filters: Filters = { ...rangeOnly(apiFilters), ...(state.dev ? { dev: state.dev } : {}) };
	const summary = useTTAnalytics(backendId, "feedback-summary", {}, { filters });
	return (
		<>
			<Note>
				What players told the game, {describeRange(state)}
				{state.dev ? ` on ${state.dev}` : ""}: ratings, text, and who sent it.
			</Note>
			<RangePicker backendId={backendId} />
			<DevicePicker backendId={backendId} />
			<QueryState q={summary} rows={6} isEmpty={(d) => d.total === 0} empty={EMPTY_TEXT}>
				{(s) => (
					<>
						<Overview s={s} />
						<ListSection backendId={backendId} filters={filters} summary={s} />
					</>
				)}
			</QueryState>
		</>
	);
}

function Kpis({ s }: { s: FeedbackSummaryResult }) {
	const thumbsOnly = s.scales.length > 0 && s.scales.every((x) => x.type === "thumbs");
	return (
		<StatGrid>
			<Stat label="Feedback" value={fmtInt(s.total)} sub={`from ${fmtInt(s.players)} players`} />
			<Stat label="With text" value={fmtInt(s.withText)} {...(s.total ? { sub: `${fmtPct(s.withText / s.total, 0)} of all` } : {})} />
			{thumbsOnly && s.thumbs ? (
				<Stat label="Thumbs up" value={fmtPct(s.thumbs.upShare, 0)} sub={`${fmtInt(s.thumbs.up)} up, ${fmtInt(s.thumbs.down)} down`} />
			) : (
				<Stat label="Average rating" value={s.avgNorm === null ? "–" : fmtPct(s.avgNorm, 0)} sub="of the scale's top, across scales" />
			)}
			<Stat label="Rated" value={fmtInt(s.rated)} sub={`${fmtInt(s.total - s.rated)} text only${s.legacy ? `, ${fmtInt(s.legacy)} legacy` : ""}`} />
		</StatGrid>
	);
}

function Overview({ s }: { s: FeedbackSummaryResult }) {
	return (
		<>
			<Kpis s={s} />
			{s.scales.length > 1 ? <Note>The scale changed in this range: one distribution per scale (newest first). The trend uses the normalised rating, so it reads across scales.</Note> : null}
			{s.scales.map((scale) => (
				<Panel
					key={`${scale.scale}-${scale.type}-${scale.steps}`}
					title={scaleName(scale)}
					note={`${scale.type === "thumbs" ? "Thumbs" : scale.type === "stars" ? `${scale.steps} stars` : `${scale.steps}-step scale`}, ${fmtInt(scale.rated)} rated${scale.textOnly ? `, ${fmtInt(scale.textOnly)} text only` : ""}`}
				>
					<Distribution scale={scale} />
				</Panel>
			))}
			<Panel title="Trend" note={`Feedback per ${s.bucket} and the average rating (% of the scale's top).`}>
				<TrendChart summary={s} />
			</Panel>
		</>
	);
}

function ListSection({ backendId, filters, summary }: { backendId: string; filters: Filters; summary: FeedbackSummaryResult | undefined }) {
	const [rating, setRating] = usePageParam("rating");
	const [text, setText] = usePageParam("text");
	const [q, setQ] = usePageParam("q");
	const [draft, setDraft] = useState(q);
	const [offset, setOffset] = useState(0);
	useEffect(() => setDraft(q), [q]);
	// The search applies 300 ms after the last key.
	useEffect(() => {
		if (draft.trim() === q) return;
		const id = setTimeout(() => setQ(draft.trim().slice(0, 100)), 300);
		return () => clearTimeout(id);
	}, [draft, q, setQ]);
	const picked = parseRating(rating);
	const options = {
		limit: PAGE_SIZE,
		offset,
		...(picked ? { scale: picked.scale, r: picked.r } : {}),
		...(text === "yes" ? { hasText: true } : text === "no" ? { hasText: false } : {}),
		...(q ? { q } : {}),
	};
	// Back to the first page whenever a filter or the range changes.
	const key = JSON.stringify([filters, rating, text, q]);
	const [seen, setSeen] = useState(key);
	if (seen !== key) {
		setSeen(key);
		setOffset(0);
	}
	const list = useTTAnalytics(backendId, "feedback-list", options, { filters, keepPrevious: true });
	const choices = ratingOptions(summary?.scales ?? []);
	return (
		<Panel title="Feedback" note="Newest first. A player's name opens their player page (long-press for their card).">
			<Picker label="Rating" value={picked ? rating : ALL} onChange={(v) => setRating(v)} options={[{ value: ALL, label: "All ratings" }, ...choices]} />
			<Picker
				label="Text"
				value={text === "yes" || text === "no" ? text : "all"}
				onChange={(v) => setText(v === "all" ? "" : v)}
				options={[
					{ value: "all", label: "All" },
					{ value: "yes", label: "With text" },
					{ value: "no", label: "No text" },
				]}
			/>
			<SearchBar value={draft} onChangeText={(t) => setDraft(t.slice(0, 100))} placeholder="Search the text" />
			<QueryState q={list} rows={5} isEmpty={(d) => d.rows.length === 0} empty={rating || text || q ? "No feedback matches these filters." : EMPTY_TEXT}>
				{(data) => (
					<View style={{ gap: space.sm }}>
						<FeedbackList backendId={backendId} rows={data.rows} />
						<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
							<Txt variant="small" style={{ flex: 1 }}>
								{fmtInt(data.offset + 1)}-{fmtInt(data.offset + data.rows.length)} of {fmtInt(data.total)}
							</Txt>
							<Button title="Newer" small icon="chevron-back" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))} />
							<Button title="Older" small icon="chevron-forward" disabled={!data.more || offset + PAGE_SIZE > 5000} onPress={() => setOffset(offset + PAGE_SIZE)} />
						</View>
					</View>
				)}
			</QueryState>
		</Panel>
	);
}
