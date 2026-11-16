/**
 * Plans/30 (web components/player-detail/JoinData.tsx): the raw join data `jd` the framework stores on a `session` /
 * `join` row (a privacy-safe copy of Roblox's GetJoinData(): launch data cut to 200 bytes, teleport data as size and
 * keys only, pids instead of UserIds). Pretty JSON, collapsed by default, monospace; `trunc` (the copy was cut to its
 * 1 KB cap) as a badge. Nothing without a `jd`.
 */
import { Badge, Txt } from "@/components/ui";

import { Collapsible } from "./analytics-bits";
import { JsonBlock } from "./bits";

/** The `jd` object of a join row's props, or undefined (absent, or not an object). */
export function joinDataOf(props: unknown): Record<string, unknown> | undefined {
	if (!props || typeof props !== "object" || Array.isArray(props)) return undefined;
	const jd = (props as { jd?: unknown }).jd;
	return jd && typeof jd === "object" && !Array.isArray(jd) ? (jd as Record<string, unknown>) : undefined;
}

export function JoinData({ jd, label = "Join data", open = false }: { jd: Record<string, unknown> | null | undefined; label?: string; open?: boolean }) {
	if (!jd) return null;
	const keys = Array.isArray(jd.keys) ? jd.keys.filter((k): k is string => typeof k === "string") : [];
	return (
		<Collapsible
			open={open}
			title={label}
			right={
				<>
					{keys.length ? (
						<Txt variant="small" numberOfLines={2} style={{ flexShrink: 1 }}>
							{keys.join(", ")}
						</Txt>
					) : null}
					{jd.trunc === true ? <Badge label="truncated" /> : null}
				</>
			}
		>
			<JsonBlock value={jd} max={320} />
		</Collapsible>
	);
}
