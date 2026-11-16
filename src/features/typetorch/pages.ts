/**
 * The TypeTorch dashboard's pages (the explorer web app's sidebar). Adding a page = a screen file under
 * src/app/tt/[backendId]/<key>.tsx + flipping its entry here to `ready` (the menu and the project tab read this list).
 */
import type { IconName } from "@/components/ui";

export interface TTPage {
	key: string;
	title: string;
	icon: IconName;
	description: string;
	/** ready: has a native screen; todo: still to port (shown greyed out). */
	status: "ready" | "todo";
	/** Only the admin role sees it (the web hides it for viewers too). */
	adminOnly?: boolean;
}

export const TT_PAGES: TTPage[] = [
	{ key: "overview", title: "Overview", icon: "speedometer-outline", description: "Players, sessions, playtime", status: "ready" },
	{ key: "fleet", title: "Fleet", icon: "server-outline", description: "Live servers, health, versions", status: "ready" },
	{ key: "deploys", title: "Deploys", icon: "rocket-outline", description: "Release history and outcomes", status: "ready" },
	{ key: "errors", title: "Errors", icon: "bug-outline", description: "Error kinds, stacks, where they hit", status: "ready" },
	{ key: "settings", title: "Settings", icon: "options-outline", description: "Backend settings, app sessions", status: "ready" },
	// Phase 2:
	{ key: "roblox", title: "Roblox", icon: "logo-electron", description: "Creator Hub numbers via the backend", status: "ready" },
	{ key: "retention", title: "Retention", icon: "repeat-outline", description: "Cohorts by day", status: "ready" },
	{ key: "funnels", title: "Funnels", icon: "funnel-outline", description: "Step conversion", status: "ready" },
	{ key: "players", title: "Players", icon: "people-outline", description: "Player list and profiles", status: "ready" },
	{ key: "flow", title: "Flow", icon: "git-network-outline", description: "Where players go", status: "ready" },
	{ key: "experiments", title: "Experiments", icon: "flask-outline", description: "A/B tests", status: "ready" },
	{ key: "first-session", title: "First session", icon: "footsteps-outline", description: "New players' first minutes", status: "ready" },
	{ key: "events", title: "Events", icon: "list-outline", description: "Raw events", status: "ready" },
	{ key: "server-history", title: "Server history", icon: "time-outline", description: "Closed and lost servers", status: "ready" },
	{ key: "performance", title: "Performance", icon: "pulse-outline", description: "FPS, memory, ping, TPS", status: "ready" },
	{ key: "economy", title: "Economy", icon: "cash-outline", description: "Currency sources and sinks", status: "ready" },
	{ key: "monetization", title: "Monetization", icon: "card-outline", description: "Purchases and products", status: "ready" },
	{ key: "query", title: "Query", icon: "code-slash-outline", description: "Named queries and SQL", status: "ready" },
	{ key: "audit", title: "Audit log", icon: "document-text-outline", description: "Who changed what", status: "ready", adminOnly: true },
	{ key: "backend-stats", title: "Backend stats", icon: "hardware-chip-outline", description: "The server's own metrics", status: "ready", adminOnly: true },
];

/** The route of a page (overview is the backend's index). */
export function pageHref(backendId: string, key: string): string {
	return key === "overview" ? `/tt/${backendId}` : `/tt/${backendId}/${key}`;
}
