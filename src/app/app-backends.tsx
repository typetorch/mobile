/** Backends opened over a game (its bottom bar's menu): the Backends tab's screen in the root stack, so back returns to the game. */
import { Stack } from "expo-router";

import BackendsScreen from "./(tabs)/backends";

export default function AppBackends() {
	return (
		<>
			<Stack.Screen options={{ title: "Backends" }} />
			<BackendsScreen />
		</>
	);
}
