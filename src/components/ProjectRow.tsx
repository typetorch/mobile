import { Image } from "expo-image";
import { View } from "react-native";

import type { Project } from "@/features/project/projects";
import { compact } from "@/lib/format";
import { radius, useTheme } from "@/theme";

import { Badge, Dot, Icon, Row, Txt } from "./ui";

export function GameIcon({ uri, size = 40 }: { uri: string | null | undefined; size?: number }) {
	const p = useTheme();
	if (!uri)
		return (
			<View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: p.muted, alignItems: "center", justifyContent: "center" }}>
				<Icon name="cube-outline" size={size / 2} color={p.mutedForeground} />
			</View>
		);
	return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: p.muted }} contentFit="cover" transition={150} />;
}

export function ProjectRow({ project, hasBackend, onPress }: { project: Project; hasBackend: boolean; onPress: () => void }) {
	const rating = project.upVotes !== null && project.downVotes !== null && project.upVotes + project.downVotes > 0 ? Math.round((project.upVotes / (project.upVotes + project.downVotes)) * 100) : null;
	return (
		<Row
			onPress={onPress}
			chevron
			left={<GameIcon uri={project.icon} />}
			title={
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<Txt numberOfLines={1} style={{ fontWeight: "600", flexShrink: 1 }}>
						{project.name}
					</Txt>
					{hasBackend ? <Badge label="TypeTorch" tone="brand" icon="flame" /> : null}
				</View>
			}
			subtitle={
				<View style={{ gap: 4 }}>
					<ProjectStats project={project} rating={rating} />
					<ProjectBadges project={project} />
				</View>
			}
		/>
	);
}

/** Private / archived / view-only flags (develop v1, Open Cloud and the permissions multiget); nothing when all is usual. */
export function ProjectBadges({ project }: { project: Project }) {
	const flags = [
		project.privacy === "private" ? <Badge key="private" label="Private" tone="warning" icon="lock-closed" /> : null,
		project.archived ? <Badge key="archived" label="Archived" tone="muted" icon="archive-outline" /> : null,
		project.active === false && project.privacy !== "private" ? <Badge key="inactive" label="Not active" tone="muted" icon="pause-circle-outline" /> : null,
		project.canManage === false ? <Badge key="view" label="View only" tone="muted" icon="eye-outline" /> : null,
	].filter(Boolean);
	if (!flags.length) return null;
	return <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{flags}</View>;
}

function ProjectStats({ project, rating }: { project: Project; rating: number | null }) {
	const p = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
				<Dot tone={project.playing > 0 ? "good" : "muted"} size={6} />
				<Txt variant="small">{compact(project.playing)} playing</Txt>
			</View>
			<Txt variant="small">{compact(project.visits)} visits</Txt>
			{rating !== null ? <Txt variant="small">{rating}% likes</Txt> : null}
			{project.viaKey ? <Icon name="key-outline" size={12} color={p.mutedForeground} /> : null}
		</View>
	);
}
