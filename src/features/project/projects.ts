/**
 * The home screen's experiences, as complete as a key and Roblox's public APIs allow (Creator Hub's "Creations"):
 *   - the universes the Open Cloud key names (introspection) and the ones added by hand;
 *   - the user's own public experiences (games v2) and created places (inventory, assumed tab);
 *   - every group the user is in (Open Cloud memberships with the wildcard group, public groups v2 roles as the
 *     fallback and for names / ranks), with the experiences of the groups the user ranks high in, can manage
 *     (legacy-group:manage) or that the key names: games v2 (public) plus develop v1 group universes (no auth; private
 *     and archived ones are kept when Roblox returns them);
 *   - the universes the ads billing accounts can advertise (ad.campaign:read).
 * Each universe is then resolved through games v1 (stats), develop v1 multiget (privacy / archived / active) and, for
 * ids neither knows (private universes games v1 leaves out), GET /cloud/v2/universes/{id}. Every source that fails is
 * a warning, never a crash; every loop and fan-out is bounded.
 *
 * Prefs.groupMinRank keeps its meaning (a group's experiences are listed when my rank there is at least this); groups
 * the key owner can manage, or whose role can manage group universes, are listed whatever the rank. The other groups
 * appear in `otherGroups` and load their experiences on demand (useGroupProjects).
 */
import { useQuery, keepPreviousData } from "@tanstack/react-query";

import { mapLimit } from "@/api/http";
import { hasScope, keyGroupIds, keyUniverseIds, type CloudUniverse, type KeyInfo, type OpenCloud } from "@/api/opencloud";
import {
	advertisableUniverses,
	canManageGroups,
	cloudGroup,
	cloudGroupRole,
	cloudUniverse,
	cloudUserMemberships,
	developUniverses,
	gameDetails,
	gameIcons,
	gameVotes,
	groupGames,
	groupIcons,
	groupUniverses,
	isRefusal,
	universePermissions,
	userCreatedPlaces,
	userGames,
	userGroups,
	type DevelopUniverse,
	type GameDetail,
	type GroupRole,
	type UserGroupMembership,
} from "@/api/roblox-public";
import { useAccounts } from "@/store/accounts";

import { compareProjects, useAddedIds } from "./pins";

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
	/** From develop v1 / Open Cloud; null when neither answered. */
	privacy: "public" | "private" | null;
	archived: boolean;
	/** develop v1 isActive (false: unpublished / private); null when unknown. */
	active: boolean | null;
	/** legacy-develop permissions multiget; null when the key lacks legacy-universe:manage. */
	canManage: boolean | null;
}

export interface ProjectSection {
	key: string;
	title: string;
	icon: string | null;
	subtitle?: string;
	projects: Project[];
}

export interface GroupInfo {
	id: number;
	name: string;
	roleName: string | null;
	rank: number | null;
	icon: string | null;
	/** canmanage says so, or the role can manage group universes. */
	canManage: boolean;
	/** The key's creator-target scopes name this group. */
	viaKey: boolean;
}

export interface ProjectsResult {
	sections: ProjectSection[];
	all: Project[];
	warnings: string[];
	userId: number | null;
	/** Groups the user is in whose experiences are not listed (below the rank threshold). */
	otherGroups: GroupInfo[];
	/** How many universe ids each source gave (before merging). */
	sources: { label: string; count: number }[];
}

/** Ids the list resolves with Open Cloud when games v1 and develop v1 don't know them. */
const MAX_CLOUD_LOOKUPS = 50;
/** Groups whose names / ranks come from Open Cloud one by one when the public roles call doesn't have them. */
const MAX_GROUP_LOOKUPS = 100;
/** Group billing accounts asked for advertisable universes. */
const MAX_AD_GROUPS = 20;

/** Records the first failure of a source and how many times it failed, so one bad source is one warning line. */
class Warnings {
	readonly list: string[] = [];
	private readonly grouped = new Map<string, { message: string; count: number }>();
	add(label: string, error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		const g = this.grouped.get(label);
		if (g) g.count++;
		else this.grouped.set(label, { message, count: 1 });
	}
	done(): string[] {
		return [...this.list, ...[...this.grouped].map(([label, g]) => (g.count > 1 ? `${label} (${g.count}×): ${g.message}` : `${label}: ${g.message}`))];
	}
}

function tail(path: string | undefined, segment: string): number | null {
	const m = path ? new RegExp(`${segment}/(\\d+)`).exec(path) : null;
	return m ? Number(m[1]) : null;
}

function privacyOf(value: string | undefined | null): "public" | "private" | null {
	const v = (value ?? "").toLowerCase();
	return v === "public" ? "public" : v === "private" ? "private" : null;
}

interface ResolveCtx {
	cloud: OpenCloud | null;
	keyInfo: KeyInfo | null;
	keyIds: Set<number>;
	userId: number | null;
	/** develop v1 entries already in hand (group universe lists). */
	known: Map<number, DevelopUniverse>;
	groupNames: Map<number, string>;
	warnings: Warnings;
}

/** Universe ids -> Projects: games v1 stats, develop v1 status, Open Cloud for the rest, icons, votes, manage rights. */
async function resolveProjects(input: number[], ctx: ResolveCtx): Promise<Project[]> {
	const ids = Array.from(new Set(input.filter((n) => Number.isFinite(n) && n > 0)));
	if (!ids.length) return [];
	const { cloud, warnings } = ctx;
	const canReadPerms = !!cloud && hasScope(ctx.keyInfo, "legacy-universe:manage");
	const [details, dev, icons, votes, perms] = await Promise.all([
		gameDetails(ids).catch((e) => {
			warnings.add("Experience stats (games v1)", e);
			return [] as GameDetail[];
		}),
		developUniverses(ids.filter((id) => !ctx.known.has(id))).catch((e) => {
			warnings.add("Privacy / archived status (develop v1)", e);
			return [] as DevelopUniverse[];
		}),
		gameIcons(ids).catch(() => ({}) as Record<number, string>),
		gameVotes(ids).catch(() => []),
		canReadPerms
			? universePermissions(cloud!, ids).catch((e) => {
					warnings.add("Manage rights", e);
					return [];
				})
			: Promise.resolve([]),
	]);
	const detailMap = new Map(details.map((d) => [d.id, d]));
	const devMap = new Map(ctx.known);
	for (const d of dev) devMap.set(d.id, d);
	const voteMap = new Map(votes.map((v) => [v.id, v]));
	const permMap = new Map(perms.map((p) => [p.universeId, p.canManage]));

	// Private universes games v1 leaves out and develop v1 doesn't return: ask Open Cloud (the key reaches them).
	const missing = ids.filter((id) => !detailMap.has(id) && !devMap.has(id));
	const cloudMap = new Map<number, CloudUniverse>();
	if (missing.length && cloud) {
		const asked = missing.slice(0, MAX_CLOUD_LOOKUPS);
		if (missing.length > asked.length) warnings.list.push(`${missing.length - asked.length} more universes were not looked up (limit ${MAX_CLOUD_LOOKUPS})`);
		await mapLimit(asked, 3, async (id) => {
			try {
				cloudMap.set(id, await cloudUniverse(cloud, id));
			} catch (e) {
				warnings.add("Universes Roblox doesn't show", new Error(`${id}: ${(e as Error).message}`));
			}
		});
	} else if (missing.length) {
		warnings.list.push(`${missing.length} universes are unknown to Roblox's public APIs (add an Open Cloud key to read private ones)`);
	}

	const out: Project[] = [];
	for (const id of ids) {
		const d = detailMap.get(id);
		const s = devMap.get(id);
		const c = cloudMap.get(id);
		const v = voteMap.get(id);
		const base = {
			universeId: id,
			upVotes: v?.upVotes ?? null,
			downVotes: v?.downVotes ?? null,
			icon: icons[id] ?? null,
			viaKey: ctx.keyIds.has(id),
			privacy: s ? (privacyOf(s.privacyType) ?? (s.isActive ? null : "private")) : c ? privacyOf(c.visibility) : null,
			archived: s?.isArchived ?? false,
			active: s ? s.isActive : null,
			canManage: permMap.get(id) ?? null,
		};
		if (d) {
			out.push({
				...base,
				name: d.name,
				description: d.description,
				rootPlaceId: d.rootPlaceId,
				creator: d.creator,
				playing: d.playing ?? 0,
				visits: d.visits ?? 0,
				favorites: d.favoritedCount ?? 0,
				created: d.created,
				updated: d.updated,
			});
		} else if (s) {
			const isGroup = s.creatorType === "Group";
			out.push({
				...base,
				name: s.name,
				description: s.description ?? null,
				rootPlaceId: s.rootPlaceId,
				creator: {
					id: s.creatorTargetId,
					type: s.creatorType,
					name: s.creatorName ?? (isGroup ? ctx.groupNames.get(s.creatorTargetId) ?? `Group ${s.creatorTargetId}` : `User ${s.creatorTargetId}`),
				},
				playing: 0,
				visits: 0,
				favorites: 0,
				created: s.created,
				updated: s.updated,
			});
		} else if (c) {
			const groupId = tail(c.group, "groups");
			const ownerId = groupId ?? tail(c.user, "users") ?? 0;
			out.push({
				...base,
				name: c.displayName || `Universe ${id}`,
				description: c.description ?? null,
				rootPlaceId: tail(c.rootPlace, "places") ?? 0,
				creator: groupId
					? { id: groupId, type: "Group", name: ctx.groupNames.get(groupId) ?? `Group ${groupId}` }
					: { id: ownerId, type: "User", name: ownerId === ctx.userId ? "You" : `User ${ownerId}` },
				playing: 0,
				visits: 0,
				favorites: 0,
				created: c.createTime,
				updated: c.updateTime,
			});
		}
	}
	return out;
}

/**
 * Group membership: the Open Cloud wildcard list is the set; the public roles call fills in names and ranks. A group
 * is manageable when canmanage names it or my role there has manageGroupUniverses (GET /cloud/v2/groups/{g}/roles/{r}
 * with group:read; Roblox shows a non-guest role's permissions only to its members, so only when the key owner is the
 * listed user). That role check runs for groups the public call lacks and for those below `minRank` (the ones it can
 * change); at most MAX_GROUP_LOOKUPS calls.
 */
async function loadGroups(cloud: OpenCloud | null, keyInfo: KeyInfo | null, userId: number, minRank: number, warnings: Warnings): Promise<{ groups: Map<number, GroupInfo>; manageable: Set<number> }> {
	const ownerIsUser = !!keyInfo && keyInfo.authorizedUserId === userId;
	const [members, roles, manage] = await Promise.all([
		cloud
			? cloudUserMemberships(cloud, userId).catch((e) => {
					warnings.add("Your groups (Open Cloud)", e);
					return null;
				})
			: Promise.resolve(null),
		userGroups(userId).catch((e) => {
			// Only a warning when Open Cloud didn't answer either (it is the fallback).
			return e as Error;
		}),
		cloud && ownerIsUser && hasScope(keyInfo, "legacy-group:manage")
			? canManageGroups(cloud).catch((e) => {
					warnings.add("Groups you can manage", e);
					return [];
				})
			: Promise.resolve([]),
	]);
	const publicRoles: GroupRole[] = roles instanceof Error ? [] : roles;
	if (roles instanceof Error && !members) warnings.add("Your groups", roles);

	const groups = new Map<number, GroupInfo>();
	const manageable = new Set(manage.map((g) => g.id));
	for (const r of publicRoles)
		groups.set(r.group.id, { id: r.group.id, name: r.group.name, roleName: r.role.name, rank: r.role.rank, icon: null, canManage: manageable.has(r.group.id), viaKey: false });

	// Open Cloud lookups: name and rank for memberships the public call didn't list; the role's permissions for
	// listed groups below the threshold that nothing else marks manageable.
	const canSeePerms = !!cloud && ownerIsUser && hasScope(keyInfo, "group:read");
	const pending: UserGroupMembership[] = [];
	const seen = new Set<number>();
	for (const m of members ?? []) {
		if (seen.has(m.groupId)) continue;
		seen.add(m.groupId);
		const g = groups.get(m.groupId);
		if (!g) pending.push(m);
		else if (canSeePerms && m.roleId !== null && !g.canManage && (g.rank === null || g.rank < minRank)) pending.push(m);
	}
	const asked = pending.slice(0, MAX_GROUP_LOOKUPS);
	if (pending.length > asked.length) warnings.list.push(`${pending.length - asked.length} more groups were not looked up (limit ${MAX_GROUP_LOOKUPS})`);
	await mapLimit(asked, 4, async (m) => {
		const listed = groups.get(m.groupId);
		const [group, role] = await Promise.all([
			listed
				? Promise.resolve(null)
				: cloudGroup(cloud!, m.groupId).catch((e) => {
						warnings.add("Group names", e);
						return null;
					}),
			m.roleId
				? cloudGroupRole(cloud!, m.groupId, m.roleId).catch((e) => {
						warnings.add(listed ? "Group role permissions" : "Group ranks", e);
						return null;
					})
				: Promise.resolve(null),
		]);
		const managesUniverses = role?.permissions?.manageGroupUniverses === true;
		if (listed) {
			if (managesUniverses) listed.canManage = true;
			if (listed.rank === null && role) {
				listed.rank = role.rank;
				listed.roleName = listed.roleName ?? role.displayName;
			}
			return;
		}
		groups.set(m.groupId, {
			id: m.groupId,
			name: group?.displayName ?? `Group ${m.groupId}`,
			roleName: role?.displayName ?? null,
			// The owner holds rank 255.
			rank: role?.rank ?? (group?.owner && group.owner === `users/${userId}` ? 255 : null),
			icon: null,
			canManage: manageable.has(m.groupId) || managesUniverses,
			viaKey: false,
		});
	});
	// canmanage groups no membership list named (both lists failed or lagged): listed by name, rank unknown.
	for (const g of manage) {
		const x = groups.get(g.id);
		if (x) x.canManage = true;
		else groups.set(g.id, { id: g.id, name: g.name, roleName: null, rank: null, icon: null, canManage: true, viaKey: false });
	}
	return { groups, manageable };
}

interface GroupHarvest {
	ids: number[];
	known: DevelopUniverse[];
}

/** One group's universes: games v2 (public) plus develop v1 active and archived lists (no auth). */
async function harvestGroup(groupId: number, warnings: Warnings): Promise<GroupHarvest> {
	const [games, active, archived] = await Promise.all([
		groupGames(groupId).catch((e) => {
			warnings.add("Group experiences (games v2)", e);
			return [];
		}),
		// develop v1 group lists are tried without auth; a refusal (cookie wanted) is expected, so only other failures warn.
		groupUniverses(groupId, false).catch((e) => {
			if (!isRefusal(e)) warnings.add("Group universes (develop v1)", e);
			return [] as DevelopUniverse[];
		}),
		groupUniverses(groupId, true).catch((e) => {
			if (!isRefusal(e)) warnings.add("Archived group universes (develop v1)", e);
			return [] as DevelopUniverse[];
		}),
	]);
	const known = [...active, ...archived];
	return { ids: [...games.map((g) => g.id), ...known.map((u) => u.id)], known };
}

function sortProjects(projects: Project[]) {
	// The default order (latest updated); the home screen re-sorts by the order picked there.
	projects.sort(compareProjects("updated"));
}

export function useProjects() {
	const { ready, keyInfo, hasKey, keyLoading, prefs, cloud, backends } = useAccounts();
	const userId = prefs.userId ?? keyInfo?.authorizedUserId ?? null;
	const keyIds = keyUniverseIds(keyInfo);
	// The person's own list is always in the discovery list too (shown as added).
	const pinIds = [...useAddedIds().ids].sort((a, b) => a - b);
	const keyGroups = keyGroupIds(keyInfo);
	// Universes of connected TypeTorch backends: listed even when private, unlisted or in a group under the rank filter.
	const backendIds = [...new Set(backends.map((b) => b.universeId).filter((id): id is number => typeof id === "number" && id > 0))].sort((a, b) => a - b);
	const scopeSig = keyInfo ? ["legacy-group:manage", "legacy-universe:manage", "ad.campaign:read", "group:read"].map((s) => (hasScope(keyInfo, s) ? 1 : 0)).join("") : "-";
	return useQuery<ProjectsResult>({
		queryKey: ["projects", userId, prefs.groupMinRank, keyIds.join(","), keyGroups.join(","), prefs.extraUniverseIds.join(","), backendIds.join(","), pinIds.join(","), hasKey, keyInfo?.authorizedUserId ?? null, scopeSig],
		enabled: ready && !(hasKey && keyLoading),
		staleTime: 60_000,
		queryFn: async () => {
			const warnings = new Warnings();
			const oc = hasKey ? cloud : null;
			const ids = new Set<number>();
			const sources: { label: string; count: number }[] = [];
			const addSource = (label: string, list: number[]) => {
				if (list.length) sources.push({ label, count: new Set(list).size });
				for (const id of list) ids.add(id);
			};
			addSource("API key", keyIds);
			addSource("Added by hand", prefs.extraUniverseIds);
			addSource("TypeTorch backends", backendIds);
			addSource("Your projects", pinIds);

			let groups = new Map<number, GroupInfo>();
			if (userId) {
				const [mine, created, loaded] = await Promise.all([
					userGames(userId).catch((e) => {
						warnings.add("Your experiences", e);
						return [];
					}),
					userCreatedPlaces(userId).catch((e) => {
						// A refusal means the inventory needs a cookie or is hidden: not worth a warning every time.
						if (!isRefusal(e)) warnings.add("Your created places", e);
						return [];
					}),
					loadGroups(oc, keyInfo, userId, prefs.groupMinRank, warnings),
				]);
				addSource("Your experiences", mine.map((g) => g.id));
				addSource("Your created places", created.map((p) => p.universeId));
				groups = loaded.groups;
			}
			for (const gid of keyGroups) {
				const g = groups.get(gid);
				if (g) g.viaKey = true;
				else groups.set(gid, { id: gid, name: `Group ${gid}`, roleName: null, rank: null, icon: null, canManage: false, viaKey: true });
			}
			const included = [...groups.values()].filter((g) => (g.rank !== null && g.rank >= prefs.groupMinRank) || g.canManage || g.viaKey);
			const includedIds = new Set(included.map((g) => g.id));

			const known = new Map<number, DevelopUniverse>();
			const harvests = await mapLimit(included, 3, (g) => harvestGroup(g.id, warnings));
			const groupIdsFound: number[] = [];
			for (const h of harvests) {
				groupIdsFound.push(...h.ids);
				for (const u of h.known) known.set(u.id, u);
			}
			addSource("Your groups", groupIdsFound);

			// Ads: the universes the personal and group billing accounts can advertise (an extra source of ids).
			if (oc && hasScope(keyInfo, "ad.campaign:read")) {
				const personal = await advertisableUniverses(oc).catch((e) => {
					warnings.add("Advertisable experiences", e);
					return [] as number[];
				});
				const perGroup = await mapLimit(included.slice(0, MAX_AD_GROUPS), 3, (g) =>
					// A group without an ads account (or rights to it) refuses: expected, so not a warning.
					advertisableUniverses(oc, g.id).catch((e) => {
						if (!isRefusal(e)) warnings.add("Group advertisable experiences", e);
						return [] as number[];
					}),
				);
				addSource("Ads accounts", [...personal, ...perGroup.flat()]);
			}

			const groupNames = new Map([...groups.values()].map((g) => [g.id, g.name]));
			const [projects, gIcons] = await Promise.all([
				resolveProjects([...ids], { cloud: oc, keyInfo, keyIds: new Set(keyIds), userId, known, groupNames, warnings }),
				groupIcons([...groups.keys()]).catch(() => ({}) as Record<number, string>),
			]);
			for (const g of groups.values()) g.icon = gIcons[g.id] ?? null;
			sortProjects(projects);

			const sections = new Map<string, ProjectSection>();
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
					const g = groups.get(p.creator.id);
					title = g?.name && !g.name.startsWith("Group ") ? g.name : p.creator.name;
					icon = g?.icon ?? gIcons[p.creator.id] ?? null;
					// "From your API key" only when the key is the source (it may also be a hand-added id or an ads account's).
					subtitle = g?.roleName
						? `${g.roleName}${g.rank !== null ? ` · rank ${g.rank}` : ""}`
						: g?.rank != null
							? `Rank ${g.rank}`
							: g?.canManage
								? "You can manage"
								: g?.viaKey || p.viaKey
									? "From your API key"
									: undefined;
				} else {
					key = `user:${p.creator.id}`;
					title = `${p.creator.name}'s experiences`;
				}
				const s = sections.get(key) ?? { key, title, icon, subtitle, projects: [] };
				// A later project of the section may be the one the key names.
				if (p.viaKey && !s.subtitle && key !== "me") s.subtitle = "From your API key";
				s.projects.push(p);
				sections.set(key, s);
			}
			const playing = (s: ProjectSection) => s.projects.reduce((n, p) => n + p.playing, 0);
			const ordered = [...sections.values()].sort((a, b) => (a.key === "me" ? -1 : b.key === "me" ? 1 : playing(b) - playing(a)));
			const otherGroups = [...groups.values()].filter((g) => !includedIds.has(g.id)).sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1) || a.name.localeCompare(b.name));
			return { sections: ordered, all: projects, warnings: warnings.done(), userId, otherGroups, sources };
		},
	});
}

/** One group's experiences on demand (a group below the rank threshold, opened from the home screen). */
export function useGroupProjects(groupId: number, enabled: boolean) {
	const { keyInfo, hasKey, cloud, prefs } = useAccounts();
	const userId = prefs.userId ?? keyInfo?.authorizedUserId ?? null;
	return useQuery({
		queryKey: ["group-projects", groupId, hasKey],
		enabled: enabled && groupId > 0,
		staleTime: 60_000,
		queryFn: async () => {
			const warnings = new Warnings();
			const h = await harvestGroup(groupId, warnings);
			const known = new Map(h.known.map((u) => [u.id, u]));
			const projects = await resolveProjects(h.ids, { cloud: hasKey ? cloud : null, keyInfo, keyIds: new Set(keyUniverseIds(keyInfo)), userId, known, groupNames: new Map(), warnings });
			sortProjects(projects);
			return { projects, warnings: warnings.done() };
		},
	});
}

/** One experience (any universe, also one not in the list; private ones through Open Cloud). */
export function useProject(universeId: number) {
	const { keyInfo, hasKey, cloud, prefs } = useAccounts();
	const keyIds = new Set(keyUniverseIds(keyInfo));
	const userId = prefs.userId ?? keyInfo?.authorizedUserId ?? null;
	return useQuery({
		queryKey: ["project", universeId, keyIds.has(universeId), hasKey],
		enabled: Number.isFinite(universeId) && universeId > 0,
		staleTime: 30_000,
		queryFn: async () => {
			const warnings = new Warnings();
			const [p] = await resolveProjects([universeId], { cloud: hasKey ? cloud : null, keyInfo, keyIds, userId, known: new Map(), groupNames: new Map(), warnings });
			if (!p) throw new Error(warnings.done()[0] ?? `Roblox doesn't know universe ${universeId}`);
			return p;
		},
	});
}

/**
 * Only the experiences on the person's list (the home screen): one resolve of those ids, nothing else fetched. The
 * previous answer stays on screen while an added or removed id refetches.
 */
export function useAddedProjects(ids: readonly number[]) {
	const { ready, keyInfo, hasKey, keyLoading, cloud, prefs } = useAccounts();
	const userId = prefs.userId ?? keyInfo?.authorizedUserId ?? null;
	const sorted = [...new Set(ids)].sort((a, b) => a - b);
	return useQuery({
		queryKey: ["added-projects", sorted.join(","), hasKey, keyInfo?.authorizedUserId ?? null],
		enabled: ready && !(hasKey && keyLoading),
		staleTime: 60_000,
		placeholderData: keepPreviousData,
		queryFn: async () => {
			if (!sorted.length) return { projects: [] as Project[], warnings: [] as string[] };
			const warnings = new Warnings();
			const projects = await resolveProjects(sorted, { cloud: hasKey ? cloud : null, keyInfo, keyIds: new Set(keyUniverseIds(keyInfo)), userId, known: new Map(), groupNames: new Map(), warnings });
			return { projects, warnings: warnings.done() };
		},
	});
}
