/** Deploy marks (GET /v1/fleet/marks) for the phone charts: the dashed lines' times and a list of the releases in a window. */
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import type { DeployMark } from "@/api/tt/perf";
import { Dot, Icon, Txt } from "@/components/ui";
import { fmtTime, shortId } from "@/lib/format";
import { space, useTheme } from "@/theme";

import { useTTQuery } from "./hooks";

/** The marks in a window (to the minute, so the cache holds still), every branch unless one is given. */
export function useDeployMarks(backendId: string, from: number, to: number, branch?: string, enabled = true) {
	const f = Math.floor(from / 60_000) * 60_000;
	const t = Math.ceil(to / 60_000) * 60_000;
	return useTTQuery(backendId, ["marks", f, t, branch ?? ""], (api, s) => api.fleetMarks({ since: f, until: t, ...(branch ? { branch } : {}), limit: 200 }, s), { staleTime: 60_000, retry: false, enabled });
}

export function markLabel(m: DeployMark): string {
	const what = m.kind === "kernel" ? `kernel ${m.kernel ?? ""}`.trim() : `${m.kind}${m.seq !== null ? ` #${m.seq}` : ""}`;
	return [what, m.branch, m.artifact ? shortId(m.artifact, 6) : null].filter(Boolean).join(" · ");
}

/** The marks as a short list under charts; one with a deploy seq opens it. */
export function MarkList({ backendId, marks }: { backendId: string; marks: DeployMark[] | undefined }) {
	const p = useTheme();
	if (!marks?.length) return null;
	return (
		<View style={{ gap: 4 }}>
			<Txt variant="label">Deploys in this window (dashed lines)</Txt>
			{marks.slice(-12).map((m) => {
				const line = (
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
						<Dot tone={m.kind === "rollback" ? "critical" : "warning"} size={6} />
						<Txt variant="small" style={{ flex: 1 }} numberOfLines={1} color={m.seq !== null && m.kind !== "kernel" && m.kind !== "backup" ? p.foreground : undefined}>
							{fmtTime(m.at).slice(5, 16)} · {markLabel(m)}
						</Txt>
						{m.seq !== null && m.kind !== "kernel" && m.kind !== "backup" ? <Icon name="chevron-forward" size={12} color={p.mutedForeground} /> : null}
					</View>
				);
				return m.seq !== null && m.kind !== "kernel" && m.kind !== "backup" ? (
					<Pressable key={m.id} onPress={() => router.push(`/tt/${backendId}/deploy/${m.seq}`)} hitSlop={4}>
						{line}
					</Pressable>
				) : (
					<View key={m.id}>{line}</View>
				);
			})}
		</View>
	);
}
