/** Retention: new players by the day they joined, and how many came back on day 1, 3, 7, 14 and 30 (query `retention`). */
import { useMemo } from "react";

import type { RetentionResult } from "@/api/tt/types";
import { Txt } from "@/components/ui";
import { HeatCell, Note, Panel, QueryState } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { TTScreen } from "@/features/typetorch/screen";
import { DataTable, type DataColumn } from "@/features/typetorch/table";
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
	const columns = useMemo<DataColumn<CohortRow>[]>(
		() => [
			{ id: "joined", header: "Joined (UTC)", width: 100, type: "date", accessor: (r) => (r.average ? null : r.date), cell: (r) => (r.average ? "Weighted avg" : r.date), format: (_v, r) => (r.average ? "Weighted avg" : r.date) },
			{ id: "size", header: "New", width: 64, accessor: (r) => r.size, cell: (r) => fmtInt(r.size) },
			...data.days.map(
				(d): DataColumn<CohortRow> => ({
					id: `day${d}`,
					header: `Day ${d}`,
					title: `Share of the cohort that played again exactly ${d} days after joining, in percent`,
					width: 84,
					align: "center",
					type: "number",
					accessor: (r) => {
						const rate = r.rates[d];
						return rate === null || rate === undefined ? null : Math.round(rate * 10_000) / 100;
					},
					cell: (r) => <HeatCell rate={r.rates[d] ?? null} {...(r.kept ? { kept: r.kept[d] ?? null } : {})} />,
					format: (v, r) => (v === null || v === undefined ? "–" : `${String(v)}%${r.kept?.[d] !== undefined && r.kept[d] !== null ? ` (${r.kept[d]})` : ""}`),
				}),
			),
		],
		[data.days],
	);
	const average = useMemo<CohortRow[]>(() => [{ date: "", size: total, average: true, rates: data.average }], [data.average, total]);
	const rows = useMemo<CohortRow[]>(() => data.cohorts.map((c) => ({ date: c.date, size: c.size, rates: c.kept, kept: c.keptPlayers })), [data.cohorts]);
	return (
		<Panel title="Cohorts by join day" note={`${plural(data.cohorts.length, "cohort")}, ${plural(total, "new player")}. A cell = share of the cohort that played again exactly that many days after joining (players in brackets).`}>
			<DataTable id="retention-cohorts" label="Cohorts by join day" columns={columns} data={rows} rowId={(r) => r.date} pinnedRows={average} defaultSort={[{ id: "joined", desc: true }]} />
			<Txt variant="small">Swipe the table sideways for later days.</Txt>
		</Panel>
	);
}
