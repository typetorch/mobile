/**
 * Catches a render or effect error below it and shows it in place, so one broken view never blanks the whole app (in a
 * release build an uncaught render error unmounts everything and leaves a bare background with no way back).
 * The message and the first lines of the stack are shown and copyable, so a phone-only failure can be reported.
 */
import * as Clipboard from "expo-clipboard";
import { Component, type ReactNode } from "react";
import { View } from "react-native";

import { Button, Card, Icon, Txt } from "@/components/ui";
import { useTheme } from "@/theme";

export function errorText(error: unknown, componentStack?: string | null): string {
	const e = error instanceof Error ? error : new Error(String(error ?? "unknown error"));
	const stack = (e.stack ?? "").split("\n").slice(0, 8).join("\n");
	const where = (componentStack ?? "").trim().split("\n").slice(0, 6).join("\n");
	return [`${e.name}: ${e.message}`, stack, where ? `in:\n${where}` : ""].filter(Boolean).join("\n\n");
}

export function ErrorPanel({ error, details, title = "This view crashed", onRetry, extra }: { error: unknown; details?: string; title?: string; onRetry?: () => void; extra?: ReactNode }) {
	const p = useTheme();
	const message = error instanceof Error ? error.message : String(error ?? "unknown error");
	const text = details ?? errorText(error);
	return (
		<Card style={{ gap: 8, borderColor: `${p.destructive}66` }}>
			<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				<Icon name="alert-circle" size={18} color={p.destructive} />
				<Txt style={{ fontWeight: "600", flex: 1 }}>{title}</Txt>
			</View>
			<Txt variant="muted" selectable>
				{message}
			</Txt>
			<Txt variant="mono" selectable numberOfLines={14} style={{ fontSize: 10, color: p.mutedForeground }}>
				{text}
			</Txt>
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				{onRetry ? <Button title="Try again" icon="refresh" small onPress={onRetry} /> : null}
				<Button title="Copy error" icon="copy-outline" small variant="ghost" onPress={() => void Clipboard.setStringAsync(text)} />
				{extra}
			</View>
		</Card>
	);
}

type Props = { children: ReactNode; title?: string; extra?: ReactNode; style?: object };
type State = { error: unknown; details: string } | null;

export class ErrorBoundary extends Component<Props, { caught: State }> {
	state: { caught: State } = { caught: null };

	static getDerivedStateFromError(error: unknown) {
		return { caught: { error, details: errorText(error) } };
	}

	componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
		console.error("[ErrorBoundary]", error, info.componentStack);
		this.setState({ caught: { error, details: errorText(error, info.componentStack) } });
	}

	render() {
		const { caught } = this.state;
		if (!caught) return this.props.children;
		return (
			<View style={this.props.style}>
				<ErrorPanel error={caught.error} details={caught.details} title={this.props.title} extra={this.props.extra} onRetry={() => this.setState({ caught: null })} />
			</View>
		);
	}
}
