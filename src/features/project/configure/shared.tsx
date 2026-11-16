/** Pieces the Configure screens share: the place list (public, with the root place as the fallback), a place picker and a switch row. */
import { useQuery } from "@tanstack/react-query";
import { Switch, View } from "react-native";

import type { OpenCloud } from "@/api/opencloud";
import { universePlaces, type PlaceInfo } from "@/api/roblox-public";
import { Chips, Skeleton, Txt } from "@/components/ui";
import { useTheme } from "@/theme";

import { getUniverse, placeIdOf } from "../api/configure";

/**
 * The universe's places: develop v1's public list (same query key as the Overview), else the root place from the
 * Open Cloud universe (private universes may not be listed publicly).
 */
export function useUniversePlaces(universeId: number, cloud: OpenCloud | null) {
	const listed = useQuery({ queryKey: ["places", universeId], queryFn: () => universePlaces(universeId), staleTime: 300_000, retry: false });
	const universe = useQuery({
		queryKey: ["oc", "universe", universeId],
		queryFn: () => getUniverse(cloud!, universeId),
		enabled: !!cloud,
		retry: false,
		staleTime: 300_000,
	});
	const rootId = placeIdOf(universe.data?.rootPlace);
	let places: PlaceInfo[] = listed.data ?? [];
	if (!places.length && rootId) places = [{ id: rootId, universeId, name: universe.data?.displayName ?? `Place ${rootId}` }];
	return {
		places,
		rootId: rootId ?? places[0]?.id ?? null,
		loading: listed.isLoading && (!cloud || universe.isLoading),
		error: !places.length ? ((listed.error as Error | null) ?? (universe.error as Error | null)) : null,
		refetch: () => Promise.all([listed.refetch(), cloud ? universe.refetch() : null]),
	};
}

/** Chips to pick one place (the root first). */
export function PlacePicker({ places, rootId, value, onChange, loading }: { places: PlaceInfo[]; rootId: number | null; value: number | null; onChange: (id: number) => void; loading?: boolean }) {
	if (loading) return <Skeleton height={30} />;
	if (!places.length) return <Txt variant="muted">No places found for this experience.</Txt>;
	const sorted = [...places].sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : 0));
	return <Chips options={sorted.map((p) => ({ value: p.id, label: `${p.name}${p.id === rootId ? " (start)" : ""}` }))} value={value ?? sorted[0]!.id} onChange={onChange} />;
}

export function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
	const p = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6, opacity: disabled ? 0.5 : 1 }}>
			<View style={{ flex: 1, gap: 2 }}>
				<Txt>{label}</Txt>
				{hint ? <Txt variant="small">{hint}</Txt> : null}
			</View>
			<Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: p.brand, false: p.muted }} />
		</View>
	);
}
