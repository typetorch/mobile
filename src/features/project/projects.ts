/**
 * The home screen's experiences: the Open Cloud key's universes, the user's own public experiences, and the
 * experiences of the groups the user ranks high in, merged by universe and grouped by owner.
 */
import { useQuery } from "@tanstack/react-query";

import { keyGroupIds, keyUniverseIds } from "@/api/opencloud";
import {
	gameDetails,
	gameIcons,
	gameVotes,
	groupGames,
	groupIcons,
	userGames,
	userGroups,
	type GameDetail,
	type GroupRole,
} from "@/api/roblox-public";
import { mapLimit } from "@/api/http";
import { useAccounts } from "@/store/accounts";

export interface Project {
	universeId: number;
	name: string;
	description: string | null;
	rootPlaceId: number;
	creator: GameDetail["creator"];
	playing: number;
	visits: number;
	favorites: number;
	upVotes: number | null;
	downVotes: number | null;
	icon: string | null;
	created: string;
	updated: string;
	/** The Open Cloud key names this universe. */
	viaKey: boolean;
}

export interface ProjectSection {
	key: string;
	title: string;
	icon: string | null;
	subtitle?: string;
	projects: Project[];
}

export interface ProjectsResult {
	sections: ProjectSection[];
	all: Project[];
	warnings: string[];
	userId: number | null;
}

function toProject(d: GameDetail, icons: Record<number, string>, votes: Map<number, { upVotes: number; downVotes: number }>, keyIds: Set<number>): Project {
	const v = votes.get(d.id);
	return {
		universeId: d.id,
		name: d.name,
		description: d.description,
		rootPlaceId: d.rootPlaceId,
		creator: d.creator,
		playing: d.playing ?? 0,
		visits: d.visits ?? 0,
		favorites: d.favoritedCount ?? 0,
		upVotes: v?.upVotes ?? null,
		downVotes: v?.downVotes ?? null,
		icon: icons[d.id] ?? null,
		created: d.created,
		updated: d.updated,
		viaKey: keyIds.has(d.id),
	};
}

async function enrich(ids: number[], keyIds: Set<number>): Promise<Project[]> {
	if (!ids.length) return [];
	const [details, icons, votes] = await Promise.all([gameDetails(ids), gameIcons(ids).catch(() => ({})), gameVotes(ids).catch(() => [])]);
	const voteMap = new Map(votes.map((v) => [v.id, v]));
	return details.map((d) => toProject(d, icons, voteMap, keyIds));
}

export function useProjects() {
	const { ready, keyInfo, hasKey, keyLoading, prefs } = useAccounts();
	const userId = prefs.userId ?? keyInfo?.authorizedUserId ?? null;
	const keyIds = keyUniverseIds(keyInfo);
	const keyGroups = keyGroupIds(keyInfo);
	return useQuery<ProjectsResult>({
		queryKey: ["projects", userId, prefs.groupMinRank, keyIds.join(","), keyGroups.join(","), prefs.extraUniverseIds.join(",")],
		enabled: ready && !(hasKey && keyLoading),
		staleTime: 60_000,
		queryFn: async () => {
			const warnings: string[] = [];
			const ids = new Set<number>([...keyIds, ...prefs.extraUniverseIds]);
			let groups: GroupRole[] = [];
			if (userId) {
				const [mine, roles] = await Promise.all([
					userGames(userId).catch((e: Error) => {
						warnings.push(`Your experiences: ${e.message}`);
						return [];
					}),
					userGroups(userId).catch((e: Error) => {
						warnings.push(`Your groups: ${e.message}`);
						return [] as GroupRole[];
					}),
				]);
				for (const g of mine) ids.add(g.id);
				groups = roles.filter((r) => r.role.rank >= prefs.groupMinRank || keyGroups.includes(r.group.id));
			}
			const groupIds = Array.from(new Set([...groups.map((g) => g.group.id), ...keyGroups]));
			const perGroup = await mapLimit(groupIds, 3, (gid) =>
				groupGames(gid).catch((e: Error) => {
					warnings.push(`Group ${gid}: ${e.message}`);
					return [];
				}),
			);
			for (const list of perGroup) for (const g of list) ids.add(g.id);
			const keySet = new Set(keyIds);
			const [projects, gIcons] = await Promise.all([enrich([...ids], keySet), groupIcons(groupIds).catch(() => ({}) as Record<number, string>)]);
			projects.sort((a, b) => b.playing - a.playing || b.visits - a.visits);

			const sections = new Map<string, ProjectSection>();
			const roleOf = new Map(groups.map((g) => [g.group.id, g]));
			for (const p of projects) {
				let key: string;
				let title: string;
				let icon: string | null = null;
				let subtitle: string | undefined;
				if (p.creator.type === "User" && userId && p.creator.id === userId) {
					key = "me";
					title = "My experiences";
				} else if (p.creator.type === "Group") {
					key = `group:${p.creator.id}`;
					title = p.creator.name;
					icon = gIcons[p.creator.id] ?? null;
					const r = roleOf.get(p.creator.id);
					subtitle = r ? `${r.role.name} · rank ${r.role.rank}` : "From your API key";
				} else {
					key = `user:${p.creator.id}`;
					title = `${p.creator.name}'s experiences`;
				}
				const s = sections.get(key) ?? { key, title, icon, subtitle, projects: [] };
				s.projects.push(p);
				sections.set(key, s);
			}
			const ordered = [...sections.values()].sort((a, b) => (a.key === "me" ? -1 : b.key === "me" ? 1 : b.projects.reduce((n, p) => n + p.playing, 0) - a.projects.reduce((n, p) => n + p.playing, 0)));
			return { sections: ordered, all: projects, warnings, userId };
		},
	});
}

/** One experience (any universe, also one not in the list). */
export function useProject(universeId: number) {
	const { keyInfo } = useAccounts();
	const keyIds = new Set(keyUniverseIds(keyInfo));
	return useQuery({
		queryKey: ["project", universeId, keyIds.has(universeId)],
		enabled: Number.isFinite(universeId) && universeId > 0,
		staleTime: 30_000,
		queryFn: async () => {
			const [p] = await enrich([universeId], keyIds);
			if (!p) throw new Error(`Roblox doesn't know universe ${universeId}`);
			return p;
		},
	});
}
