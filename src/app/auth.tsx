/**
 * The browser sign-in's redirect target (typetorch://auth, exp://.../--/auth in Expo Go). openAuthSessionAsync
 * normally catches the redirect itself; if the system opens the app on this route instead, go back where we were.
 */
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";

import { Loading, Screen } from "@/components/ui";

WebBrowser.maybeCompleteAuthSession();

export default function AuthRedirect() {
	useEffect(() => {
		const t = setTimeout(() => (router.canGoBack() ? router.back() : router.replace("/")), 300);
		return () => clearTimeout(t);
	}, []);
	return (
		<Screen scroll={false}>
			<Loading />
		</Screen>
	);
}
