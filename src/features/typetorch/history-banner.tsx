/**
 * Above the analytics pages while a move from another server still imports event history (web
 * components/HistoryImportingBanner.tsx, GET /v1/admin/migrate): the charts are missing those days, so a half-empty chart
 * is not a traffic drop. Owners only (a read-only session can't read the status, so it doesn't ask); nothing on an error
 * or an older server. The filter bar renders it, so every page with the bar has it (the web shows it above every page
 * with filters).
 */
import { View } from "react-native";

import { historyBannerText } from "@/api/tt/migrate";
import { Icon, Txt } from "@/components/ui";
import { useBackend } from "@/store/accounts";
import { radius, space, useTheme } from "@/theme";

import { useTTQuery } from "./hooks";

export const MIGRATE_KEY = ["admin-migrate"] as const;

export function HistoryImportingBanner({ backendId }: { backendId: string }) {
	const p = useTheme();
	const owner = useBackend(backendId).account?.role === "admin";
	const q = useTTQuery(backendId, MIGRATE_KEY, (api, signal) => api.migrateStatus(signal), { enabled: owner, retry: false, staleTime: 60_000 });
	const text = !owner || q.isError ? null : historyBannerText(q.data);
	if (!text) return null;
	return (
		<View style={{ flexDirection: "row", gap: space.sm, borderWidth: 1, borderColor: `${p.brand}88`, backgroundColor: `${p.brand}18`, borderRadius: radius.md, padding: space.md }}>
			<Icon name="time-outline" size={16} color={p.brand} />
			<View style={{ flex: 1, gap: 2 }}>
				<Txt style={{ fontWeight: "700" }}>{text}</Txt>
				<Txt variant="small">This backend is moving its history in from another server. Days not imported yet are missing from the charts: a half-empty chart is not a traffic drop. Settings shows the progress.</Txt>
			</View>
		</View>
	);
}
