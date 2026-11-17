/**
 * app.json, plus the Firebase file when there is one (docs/FIREBASE_SETUP.md): EAS builds get it from the file
 * variable GOOGLE_SERVICES_JSON, a local build from ./google-services.json (git-ignored). Without it the app builds and
 * runs; only the milestone pushes are off (expo-notifications can't get a push token).
 */
const { existsSync } = require("node:fs");

module.exports = ({ config }) => {
	const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (existsSync("./google-services.json") ? "./google-services.json" : undefined);
	return { ...config, android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) } };
};
