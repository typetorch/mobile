/**
 * Localization: languages and automatic translation, the experience's translated name and description, localized
 * passes / products / badges, the auto-localization table, and text tools (Roblox's translator, text to speech).
 * Public reads open without a key; each part names the scope it needs. Translator roles are cookie-only (no API).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { OpenCloud } from "@/api/opencloud";
import { Chips, ScopeNotice } from "@/components/ui";
import { ENG_SCOPES } from "@/features/project/api/engagement";
import { ExperienceInfo } from "@/features/project/engagement/ExperienceInfo";
import { ItemLocalization } from "@/features/project/engagement/ItemLocalization";
import { Languages } from "@/features/project/engagement/Languages";
import { LocalizationTable } from "@/features/project/engagement/LocalizationTable";
import { TextTools } from "@/features/project/engagement/TextTools";
import { ToolScreen } from "@/features/project/tool";

type Tab = "languages" | "info" | "items" | "table" | "tools";

const TABS: { value: Tab; label: string }[] = [
	{ value: "languages", label: "Languages" },
	{ value: "info", label: "Experience info" },
	{ value: "items", label: "Passes, products, badges" },
	{ value: "table", label: "Localization table" },
	{ value: "tools", label: "Translate & speech" },
];

export default function LocalizationScreen() {
	const queryClient = useQueryClient();
	return (
		<ToolScreen
			title="Localization"
			scopes={[]}
			onRefresh={() => {
				for (const key of ["i18n", "i18n-items", "oc"]) queryClient.refetchQueries({ queryKey: [key], type: "active" });
			}}
		>
			{({ universeId, cloud, can }) => <Localization universeId={universeId} cloud={cloud} can={can} />}
		</ToolScreen>
	);
}

function Localization({ universeId, cloud, can }: { universeId: number; cloud: OpenCloud; can: (scope: string) => boolean }) {
	const [tab, setTab] = useState<Tab>("languages");
	const canManage = can(ENG_SCOPES.legacyUniverse);
	return (
		<>
			<Chips options={TABS} value={tab} onChange={setTab} />
			{tab === "languages" ? (
				<Languages universeId={universeId} cloud={cloud} canManage={canManage} />
			) : tab === "info" ? (
				<ExperienceInfo universeId={universeId} cloud={cloud} canManage={canManage} canTranslate={can(ENG_SCOPES.universeWrite)} />
			) : tab === "items" ? (
				<ItemLocalization universeId={universeId} cloud={cloud} can={can} />
			) : tab === "table" ? (
				canManage ? <LocalizationTable universeId={universeId} cloud={cloud} /> : <ScopeNotice what="The localization table" scopes={[ENG_SCOPES.legacyUniverse]} />
			) : (
				<TextTools universeId={universeId} cloud={cloud} can={can} />
			)}
		</>
	);
}
