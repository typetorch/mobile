import { BackendHeader, TTHome } from "@/features/typetorch/components";
import { TTScreen } from "@/features/typetorch/screen";

/** A TypeTorch backend's dashboard home (the web explorer's Overview + the page menu). */
export default function BackendHome() {
	return (
		<TTScreen title={(a) => a.name} notice={false}>
			{({ account, backendId }) => (
				<>
					<BackendHeader account={account} />
					<TTHome backendId={backendId} />
				</>
			)}
		</TTScreen>
	);
}
