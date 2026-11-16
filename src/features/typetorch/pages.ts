/**
 * The TypeTorch dashboard's pages, grouped like the explorer web app's sidebar (web lib/nav.ts NAV_GROUPS: Overview;
 * Players & gameplay; Observe & troubleshoot; Data; Admin). Adding a page = a screen file under
 * src/app/tt/[backendId]/<key>.tsx + an entry here in its group (the menu, the command palette and the project tab read
 * this list).
 */
import type { IconName } from "@/components/ui";

export type TTGroup = "overview" | "players" | "observe" | "data" | "admin";

export const TT_GROUPS: { id: TTGroup; label?: string }[] = [
	{ id: "overview" },
	{ id: "players", label: "Players & gameplay" },
	{ id: "observe", label: "Observe & troubleshoot" },
	{ id: "data", label: "Data" },
	{ id: "admin", label: "Admin" },
];

export interface TTPage {
	key: string;
	title: string;
	icon: IconName;
	description: string;
	group: TTGroup;
	/** ready: has a native screen; todo: still to port (shown greyed out). */
	status: "ready" | "todo";
	/** Only the admin role sees it (the web's `ownerOnly`: hidden for the read-only `web` role). */
	adminOnly?: boolean;
}

export const TT_PAGES: TTPage[] = [
	{ key: "overview", title: "Overview", icon: "speedometer-outline", description: "Players, sessions, playtime", group: "overview", status: "ready" },
	// Players & gameplay
	{ key: "players", title: "Players", icon: "people-outline", description: "Player list and profiles", group: "players", status: "ready" },
	{ key: "events", title: "Events", icon: "list-outline", description: "Raw events", group: "players", status: "ready" },
	{ key: "funnels", title: "Funnels", icon: "funnel-outline", description: "Step conversion", group: "players", status: "ready" },
	{ key: "flow", title: "Flow", icon: "git-network-outline", description: "Where players go", group: "players", status: "ready" },
	{ key: "retention", title: "Retention", icon: "repeat-outline", description: "Cohorts by day", group: "players", status: "ready" },
	{ key: "demographics", title: "Demographics", icon: "earth-outline", description: "Who plays: age, country, language, device", group: "players", status: "ready" },
	{ key: "notifications", title: "Notifications", icon: "notifications-outline", description: "Experience notifications: sent, opened, subscribers, the sender", group: "players", status: "ready" },
	{ key: "feedback", title: "Feedback", icon: "chatbubble-ellipses-outline", description: "What players rate and say", group: "players", status: "ready" },
	{ key: "first-session", title: "First session", icon: "footsteps-outline", description: "New players' first minutes", group: "players", status: "ready" },
	{ key: "recordings", title: "Recordings", icon: "videocam-outline", description: "First-session map layers, replays, quit autopsy, first actions", group: "players", status: "ready" },
	{ key: "maps", title: "Maps", icon: "map-outline", description: "Exported maps in 2D / 3D, where events happen", group: "players", status: "ready" },
	{ key: "economy", title: "Economy", icon: "cash-outline", description: "Currency sources and sinks", group: "players", status: "ready" },
	{ key: "monetization", title: "Monetization", icon: "card-outline", description: "Purchases and products", group: "players", status: "ready" },
	{ key: "live-events", title: "Live events", icon: "calendar-outline", description: "Scheduled events and their lift", group: "players", status: "ready" },
	{ key: "experiments", title: "Experiments", icon: "flask-outline", description: "A/B tests", group: "players", status: "ready" },
	{ key: "session-time", title: "Session time", icon: "hourglass-outline", description: "Session length per time step and device", group: "players", status: "ready" },
	{ key: "roblox", title: "Roblox", icon: "logo-electron", description: "Creator Hub numbers via the backend", group: "players", status: "ready" },
	// Observe & troubleshoot
	{ key: "fleet", title: "Fleet", icon: "server-outline", description: "Live servers, health, versions, deploys, alerts", group: "observe", status: "ready" },
	{ key: "live", title: "Live map", icon: "locate-outline", description: "Every live server's players on the map", group: "observe", status: "ready", adminOnly: true },
	{ key: "deploys", title: "Deploys", icon: "rocket-outline", description: "Release history and outcomes", group: "observe", status: "ready" },
	{ key: "errors", title: "Errors", icon: "bug-outline", description: "Error kinds, stacks, where they hit, drop rules", group: "observe", status: "ready" },
	{ key: "performance", title: "Performance", icon: "pulse-outline", description: "FPS, memory, ping, TPS", group: "observe", status: "ready" },
	// The web shows these inside Fleet ("Recently gone"); the phone gives them their own page too.
	{ key: "server-history", title: "Server history", icon: "time-outline", description: "Closed and lost servers", group: "observe", status: "ready" },
	// Data
	{ key: "query", title: "Query", icon: "code-slash-outline", description: "Named queries and SQL", group: "data", status: "ready" },
	// Admin. Settings stays in every role's menu on the phone: it also holds this device's token and the app sessions;
	// its runtime settings (the web's owner-only page) show for owners only.
	{ key: "settings", title: "Settings", icon: "options-outline", description: "Runtime settings, backups, migration, this device", group: "admin", status: "ready" },
	{ key: "backend-stats", title: "Backend stats", icon: "hardware-chip-outline", description: "The server's own metrics", group: "admin", status: "ready", adminOnly: true },
	{ key: "audit", title: "Audit log", icon: "document-text-outline", description: "Who changed what", group: "admin", status: "ready", adminOnly: true },
];

/** The route of a page (overview is the backend's index). */
export function pageHref(backendId: string, key: string): string {
	return key === "overview" ? `/tt/${backendId}` : `/tt/${backendId}/${key}`;
}

/** The pages this role may see, by group (a group with nothing left goes away), the web's visibleGroups. */
export function visiblePages(admin: boolean): { id: TTGroup; label?: string | undefined; pages: TTPage[] }[] {
	return TT_GROUPS.map((g) => ({ ...g, pages: TT_PAGES.filter((x) => x.group === g.id && (!x.adminOnly || admin)) })).filter((g) => g.pages.length > 0);
}
