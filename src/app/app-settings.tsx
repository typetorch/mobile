/** App settings opened over a game (its bottom bar's menu): the Settings tab's screen in the root stack, so back returns to the game. */
import { Stack } from "expo-router";

import SettingsScreen from "./(tabs)/settings";

export default function AppSettings() {
	return (
		<>
			<Stack.Screen options={{ title: "Settings" }} />
			<SettingsScreen />
		</>
	);
}
