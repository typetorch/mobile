/**
 * Projects list kept on the phone (AsyncStorage): the experiences the person added (the home list shows only these,
 * so it loads only their details), the pinned ones among them (shown first) and the list order (latest updated by
 * default).
 */
import { useSyncExternalStore } from "react";

import { storedValue } from "@/features/typetorch/persist";

import type { Project } from "./projects";

export type ProjectSort = "updated" | "playing" | "visits" | "name";

export const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
	{ value: "updated", label: "Latest updated" },
	{ value: "playing", label: "Playing" },
	{ value: "visits", label: "Visits" },
	{ value: "name", label: "Name" },
];

const pins = storedValue<number[]>(
	"projects.pins.v1",
	[],
	(text) => {
		try {
			const v = JSON.parse(text) as unknown;
			return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0) : undefined;
		} catch {
			return undefined;
		}
	},
	(v) => (v.length ? JSON.stringify(v) : null),
);

const sort = storedValue<ProjectSort>(
	"projects.sort.v1",
	"updated",
	(text) => (SORT_OPTIONS.some((o) => o.value === text) ? (text as ProjectSort) : undefined),
	(v) => (v === "updated" ? null : v),
);

const parseIds = (text: string): number[] | undefined => {
	try {
		const v = JSON.parse(text) as unknown;
		return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0) : undefined;
	} catch {
		return undefined;
	}
};

/** null until the first save (then seeded once from older pins and hand-added ids). */
const added = storedValue<number[] | null>("projects.added.v1", null, parseIds, (v) => (v === null ? null : JSON.stringify(v)));

/** The added universe ids (newest first); null while not loaded or never saved. */
export function useAddedIds(): { ids: number[]; loaded: boolean; unset: boolean } {
	const value = useSyncExternalStore(added.subscribe, added.get, added.get);
	const loaded = useSyncExternalStore(added.subscribe, added.loaded, added.loaded);
	return { ids: value ?? [], loaded, unset: value === null };
}

/** First run of this version: older pins and hand-added ids become the list. */
export function seedAdded(ids: number[]): void {
	if (added.get() !== null) return;
	added.set([...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))]);
}

export function isAdded(universeId: number): boolean {
	return (added.get() ?? []).includes(universeId);
}

export function addProject(universeId: number): void {
	const now = added.get() ?? [];
	if (!now.includes(universeId)) added.set([universeId, ...now]);
}

/** Takes it off the list (and unpins it). */
export function removeProject(universeId: number): void {
	added.set((added.get() ?? []).filter((id) => id !== universeId));
	if (pins.get().includes(universeId)) pins.set(pins.get().filter((id) => id !== universeId));
}

/** Pinned universe ids, most recently pinned first. */
export function usePins(): number[] {
	return useSyncExternalStore(pins.subscribe, pins.get, pins.get);
}

export function isPinned(list: readonly number[], universeId: number): boolean {
	return list.includes(universeId);
}

/** Pins (pinning an experience also adds it to the list) or unpins. */
export function togglePin(universeId: number): boolean {
	const now = pins.get();
	if (!now.includes(universeId)) addProject(universeId);
	const pinned = now.includes(universeId);
	pins.set(pinned ? now.filter((id) => id !== universeId) : [universeId, ...now]);
	return !pinned;
}

export function useProjectSort(): [ProjectSort, (s: ProjectSort) => void] {
	const value = useSyncExternalStore(sort.subscribe, sort.get, sort.get);
	return [value, sort.set];
}

const updatedMs = (p: Project) => {
	const t = Date.parse(p.updated);
	return Number.isNaN(t) ? 0 : t;
};

/** Archived last, then by the chosen order (ties: name). */
export function compareProjects(by: ProjectSort): (a: Project, b: Project) => number {
	return (a, b) => {
		const archived = Number(a.archived) - Number(b.archived);
		if (archived) return archived;
		const main =
			by === "updated" ? updatedMs(b) - updatedMs(a) : by === "playing" ? b.playing - a.playing || b.visits - a.visits : by === "visits" ? b.visits - a.visits : 0;
		return main || a.name.localeCompare(b.name);
	};
}

/** A section's key for ordering sections the same way as their rows (its first row after sorting). */
export function sectionRank(by: ProjectSort, projects: readonly Project[]): (number | string) {
	if (by === "name") return projects[0]?.name ?? "";
	if (by === "playing") return -projects.reduce((n, p) => n + p.playing, 0);
	if (by === "visits") return -projects.reduce((n, p) => n + p.visits, 0);
	return -Math.max(0, ...projects.map(updatedMs));
}
