import { BackendHeader, TTHome } from "@/features/typetorch/components";
import { TTScreen } from "@/features/typetorch/screen";
import { usePageParam } from "@/features/typetorch/view-link";

/** A TypeTorch backend's dashboard home (the web explorer's Overview + the page menu). */
export default function BackendHome() {
	// The web's `vs=prev` ("vs previous period"), the same key as Errors and Performance, so it travels in a link.
	const [vs, setVs] = usePageParam("vs");
	return (
		<TTScreen title={(a) => a.name} notice={false}>
			{({ account, backendId }) => (
				<>
					<BackendHeader account={account} />
					<TTHome backendId={backendId} compare={{ on: vs === "prev", set: (on) => setVs(on ? "prev" : "") }} />
				</>
			)}
		</TTScreen>
	);
}
