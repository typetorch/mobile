/**
 * androidx.javascriptengine (the widget program's sandbox, docs/WIDGET_PROGRAM.md) declares minSdk 26 and the app keeps
 * 24: the override has to be in the app's own manifest for the manifest merger to take it. The module only uses the
 * library on Android 8.0+ with JavaScriptSandbox.isSupported() (JsEngine.supported()).
 */
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withJsEngineOverride(config) {
	return withAndroidManifest(config, (cfg) => {
		const manifest = cfg.modResults.manifest;
		manifest.$ = { ...manifest.$, "xmlns:tools": "http://schemas.android.com/tools" };
		const libs = "androidx.javascriptengine";
		const usesSdk = manifest["uses-sdk"] ?? [];
		const entry = usesSdk[0] ?? { $: {} };
		const current = entry.$["tools:overrideLibrary"];
		entry.$["tools:overrideLibrary"] = current ? [...new Set([...current.split(","), libs])].join(",") : libs;
		manifest["uses-sdk"] = [entry, ...usesSdk.slice(1)];
		return cfg;
	});
};
