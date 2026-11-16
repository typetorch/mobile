/** Flow: every matching player's moves merged into one graph (query `flow`): where most go next, and where they quit. */
import { useState } from "react";
import { View } from "react-native";

import type { Facet } from "@/api/tt/types";
import { Field } from "@/components/ui";
import { Note, Panel, QueryState } from "@/features/typetorch/bits";
import { FilterBar, useTTAnalytics } from "@/features/typetorch/filters";
import { GraphControls, GraphTables, MermaidButton, realStates, SparseNote, StateList } from "@/features/typetorch/graph";
import { TTScreen } from "@/features/typetorch/screen";
import { plural } from "@/lib/format";
import { space } from "@/theme";

export default function FlowScreen() {
	return <TTScreen title="Flow">{({ backendId }) => <Flow backendId={backendId} />}</TTScreen>;
}

function Flow({ backendId }: { backendId: string }) {
	const [facet, setFacet] = useState<Facet>("all");
	const [moments, setMoments] = useState(false);
	const [minText, setMinText] = useState("1");
	const minCount = Math.max(1, Math.min(1_000_000, Number.parseInt(minText, 10) || 1));
	const q = useTTAnalytics(backendId, "flow", { facet, minCount, maxEdges: 200, ...(moments ? { moments: true } : {}) }, { keepPrevious: true });
	return (
		<>
			<FilterBar backendId={backendId} />
			<Note>Every matching player's moves merged into one graph: where most go next, and where they quit.</Note>
			<GraphControls facet={facet} onFacet={setFacet} moments={moments} onMoments={setMoments} />
			<View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
				<View style={{ width: 110 }}>
					<Field label="Min moves" keyboardType="number-pad" value={minText} onChangeText={setMinText} />
				</View>
				{q.data ? <MermaidButton graph={q.data} /> : null}
			</View>
			<QueryState q={q} isEmpty={(g) => g.nodes.length === 0} empty={facet === "all" ? "No states logged in this range." : `No state in this range has a ${facet} part (try all).`}>
				{(graph) => (
					<>
						<Panel title={`${plural(realStates(graph), "state")}, ${plural(graph.edges.length, "move")}`} note={graph.hiddenEdges ? `${graph.hiddenEdges} smaller moves not shown (raise Min moves to thin it out).` : "Tap a state for where players go next."}>
							<SparseNote graph={graph} backendId={backendId} />
							<StateList graph={graph} />
						</Panel>
						<GraphTables graph={graph} />
					</>
				)}
			</QueryState>
		</>
	);
}
