/**
 * A fatal JS error outside React (an event handler, a timer, a native callback) makes a release build on the new
 * architecture tear its whole React instance down: the window stays, empty, and nothing answers (not even back). In a
 * release build this keeps the app alive instead: the error is shown in an alert (copyable) and the app carries on.
 * Development builds keep React Native's own handler (the red screen).
 */
import { Alert } from "react-native";

type Handler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsShape = { getGlobalHandler(): Handler; setGlobalHandler(h: Handler): void };

let installed = false;
let showing = false;

export function installCrashGuard(): void {
	const utils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
	if (installed || !utils || __DEV__) return;
	installed = true;
	const original = utils.getGlobalHandler();
	utils.setGlobalHandler((error, isFatal) => {
		if (!isFatal) return original(error, isFatal);
		const e = error instanceof Error ? error : new Error(String(error));
		console.error("[crash-guard]", e);
		if (showing) return;
		showing = true;
		const stack = (e.stack ?? "").split("\n").slice(0, 6).join("\n");
		Alert.alert("Something broke", `${e.name}: ${e.message}\n\n${stack}`, [{ text: "OK", onPress: () => (showing = false) }], { cancelable: true, onDismiss: () => (showing = false) });
	});
}
