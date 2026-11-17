/**
 * expo-gl 58.0.4 ships no R8 keep rules, and SDK 58 release builds minify: R8 strips GLView's constructor (Expo makes
 * views by reflection) and GLContext.flush() (the native code finds it by name over JNI), so the first GLView kills the
 * React instance (a blank, dead window on every map page). The whole package is kept (small; the upstream fix keeps the
 * two members, the issue's control kept everything), so nothing else of it found by reflection or JNI goes either. expo/expo#51948, fixed upstream by #51951; drop this plugin
 * once an expo-gl release carries android/proguard-rules.pro.
 */
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

const MARK = "# expo-gl keep rules (plugins/with-expo-gl-keep-rules.js)";
const RULES = `
${MARK}
-keep class expo.modules.gl.** { *; }
`;

module.exports = function withExpoGlKeepRules(config) {
	return withDangerousMod(config, [
		"android",
		(cfg) => {
			const file = path.join(cfg.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
			const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
			if (!current.includes(MARK)) fs.writeFileSync(file, current + RULES);
			return cfg;
		},
	]);
};
