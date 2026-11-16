/** Retention: new players by the day they joined, and how many came back on day 1, 3, 7, 14 and 30 (query `retention`). */
import { useMemo } from "react";

import type { RetentionResult } from "@/api/tt/types";
import { Txt } from "@/components/ui";
import { HeatCell, MiniTable, Note, Panel, QueryState, type Column } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { fmtInt, plural } from "@/lib/format";

interface CohortRow {
	date: string;
	size: number;
	average?: boolean;
	rates: Record<string, number | null>;
	kept?: Record<string, number | null>;
}

export default function RetentionScreen() {
	return <TTScreen title="Retention">{({ backendId }) => <Retention backendId={backendId} />}</TTScreen>;
}

function Retention({ backendId }: { backendId: string }) {
	const q = useTTAnalytics(backendId, "retention", { days: [1, 3, 7, 14, 30] });
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>New players by the day they joined, and how many came back on day 1, 3, 7, 14 and 30. Days not over yet show –.</Note>
			<QueryState q={q} isEmpty={(d) => d.cohorts.length === 0} empty="No new players joined in this range.">
				{(data) => <Body data={data} />}
			</QueryState>
		</>
	);
}

function Body({ data }: { data: RetentionResult }) {
	const total = data.cohorts.reduce((s, c) => s + c.size, 0);
	const columns = useMemo<Column<CohortRow>[]>(
		() => [
			{ key: "joined", header: "Joined (UTC)", width: 96, render: (r) => (r.average ? "Weighted avg" : r.date) },
			{ key: "size", header: "New", width: 60, align: "right", render: (r) => fmtInt(r.size) },
			...data.days.map(
				(d): Column<CohortRow> => ({
					key: `d${d}`,
					header: `Day ${d}`,
					width: 84,
					align: "center",
					render: (r) => <HeatCell rate={r.rates[d] ?? null} {...(r.kept ? { kept: r.kept[d] ?? null } : {})} />,
				}),
			),
		],
		[data.days],
	);
	const rows = useMemo<CohortRow[]>(() => [...data.cohorts].sort((a, b) => b.date.localeCompare(a.date)).map((c) => ({ date: c.date, size: c.size, rates: c.kept, kept: c.keptPlayers })), [data.cohorts]);
	return (
		<Panel title="Cohorts by join day" note={`${plural(data.cohorts.length, "cohort")}, ${plural(total, "new player")}. A cell = share of the cohort that played again exactly that many days after joining (players in brackets).`}>
			<MiniTable columns={columns} rows={rows} rowKey={(r) => r.date} pinned={[{ date: "", size: total, average: true, rates: data.average }]} max={40} />
			<Txt variant="small">Swipe the table sideways for later days.</Txt>
		</Panel>
	);
}
