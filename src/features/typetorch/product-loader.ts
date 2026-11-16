/**
 * The Roblox product-name loader behind ProductName: batches the ids asked in one tick per backend. Kept apart from
 * bits.tsx so the accounts store can reset it (a renewed token or a disconnect) without an import cycle.
 */
import type { Api } from "@/api/backend";
import type { RobloxProductInfo } from "@/api/tt/types";

export type ProductType = RobloxProductInfo["type"];

type Waiter = { type: ProductType; id: number; resolve(info: RobloxProductInfo): void };
type Loader = { api: Api; load(type: ProductType, id: number): Promise<RobloxProductInfo> };
/** Only the batching state is kept per backend; the Api is replaced on every call (a renewed token builds a new one). */
const loaders = new Map<string, Loader>();

/** Forgets a backend's product loader (its token was replaced, or it was disconnected). */
export function resetProductLoader(backendId: string) {
	loaders.delete(backendId);
}

/** Collects the ids asked in one tick and asks them in batches of 50 (one loader per backend, the newest Api). */
export function loaderFor(backendId: string, api: Api) {
	const existing = loaders.get(backendId);
	if (existing) {
		existing.api = api;
		return existing.load;
	}
	let pending: Waiter[] = [];
	let scheduled = false;
	const flush = async () => {
		scheduled = false;
		const waiters = pending;
		pending = [];
		const current = loader.api;
		const keys = [...new Set(waiters.map((w) => `${w.type}:${w.id}`))];
		for (let i = 0; i < keys.length; i += 50) {
			const chunk = keys.slice(i, i + 50);
			const ids = { gamepass: [] as number[], product: [] as number[] };
			for (const k of chunk) {
				const [type, id] = k.split(":") as [ProductType, string];
				ids[type].push(Number(id));
			}
			let items: RobloxProductInfo[] = [];
			try {
				items = await current.robloxProducts(ids);
			} catch {
				// the bare id below
			}
			const found = new Map(items.map((it) => [`${it.type}:${it.id}`, it]));
			for (const w of waiters) {
				const key = `${w.type}:${w.id}`;
				if (!chunk.includes(key)) continue;
				w.resolve(found.get(key) ?? { type: w.type, id: w.id, status: "unavailable", name: null, price: null, forSale: null, icon: null });
			}
		}
	};
	const loader: Loader = {
		api,
		load: (type: ProductType, id: number) =>
			new Promise<RobloxProductInfo>((resolve) => {
				pending.push({ type, id, resolve });
				if (!scheduled) {
					scheduled = true;
					setTimeout(() => void flush(), 0);
				}
			}),
	};
	loaders.set(backendId, loader);
	return loader.load;
}
