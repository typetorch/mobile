/**
 * The error view for an Open Cloud call: a 401 / 403 on a call with known scopes (ScopeError) shows which scope the
 * key is missing for this experience; anything else is the plain error card.
 */
import { View } from "react-native";

import { missingScopesOf } from "@/api/opencloud";
import { Button, ErrorState, ScopeNotice, Txt } from "@/components/ui";

export function CloudError({ error, what, onRetry, title }: { error: unknown; what: string; onRetry?: () => void; title?: string }) {
	const scopes = missingScopesOf(error);
	if (!scopes) return <ErrorState error={error} onRetry={onRetry} title={title} />;
	return (
		<View style={{ gap: 6 }}>
			<ScopeNotice what={what} scopes={scopes} />
			<Txt variant="small" selectable>
				Roblox said: {(error as Error).message}
			</Txt>
			{onRetry ? <Button title="Try again" icon="refresh" small onPress={onRetry} style={{ alignSelf: "flex-start" }} /> : null}
		</View>
	);
}

/** An Alert message for a failed write (names the missing scope on a 401 / 403). */
export function cloudErrorText(error: unknown): string {
	const scopes = missingScopesOf(error);
	const message = error instanceof Error ? error.message : String(error ?? "unknown error");
	return scopes ? `Your API key needs ${scopes.join(" + ")} for this experience.\n\n${message}` : message;
}
