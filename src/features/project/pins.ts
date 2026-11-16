/**
 * Projects list preferences kept on the phone (AsyncStorage): pinned experiences (shown first, in their own section)
 * and the list order (latest updated by default).
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

/** Pinned universe ids, most recently pinned first. */
export function usePins(): number[] {
	return useSyncExternalStore(pins.subscribe, pins.get, pins.get);
}

export function isPinned(list: readonly number[], universeId: number): boolean {
	return list.includes(universeId);
}

export function togglePin(universeId: number): boolean {
	const now = pins.get();
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
