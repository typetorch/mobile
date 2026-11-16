/**
 * Small things kept on the phone between app starts (AsyncStorage): the filter bar per backend, table views per table
 * id, the deploy-marks switch. The web keeps them in localStorage. Reads and writes never throw: a failed write only
 * means the value lasts until the app restarts.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function readStored(key: string): Promise<string | null> {
	try {
		return await AsyncStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Saves `text`, or forgets the key with null. */
export function writeStored(key: string, text: string | null): void {
	const op = text === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, text);
	op.catch(() => undefined);
}

export async function readStoredJson<T>(key: string): Promise<T | null> {
	const text = await readStored(key);
	if (!text) return null;
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

/** Several keys at once (the table views of a screen), as a map; missing ones are left out. */
export async function readStoredMany(keys: readonly string[]): Promise<Map<string, string>> {
	try {
		const pairs = await AsyncStorage.multiGet(keys);
		return new Map(pairs.filter((p): p is [string, string] => typeof p[1] === "string"));
	} catch {
		return new Map();
	}
}

/** A value kept in memory and in AsyncStorage, loaded once, shared by every screen (useSyncExternalStore). */
export function storedValue<T>(key: string, fallback: T, parse: (text: string) => T | undefined, format: (value: T) => string | null) {
	let value = fallback;
	let loaded = false;
	let loading: Promise<void> | null = null;
	const listeners = new Set<() => void>();
	const emit = () => {
		for (const l of listeners) l();
	};
	const load = () => {
		if (loaded || loading) return loading;
		loading = readStored(key).then((text) => {
			const parsed = text === null ? undefined : parse(text);
			if (parsed !== undefined && !loaded) value = parsed;
			loaded = true;
			emit();
		});
		return loading;
	};
	return {
		get: () => value,
		loaded: () => loaded,
		load,
		set(next: T) {
			value = next;
			loaded = true;
			writeStored(key, format(next));
			emit();
		},
		subscribe(l: () => void) {
			listeners.add(l);
			void load();
			return () => {
				listeners.delete(l);
			};
		},
	};
}
