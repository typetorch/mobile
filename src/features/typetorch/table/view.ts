/**
 * A table's view (sort, search, filters, hidden columns, widths, page size), like the web's use-table-view.ts: it starts
 * from the route when a link carried this table's parameters, else from the phone's storage (AsyncStorage, per backend
 * and table id), else from the defaults; every change is saved a moment later. A link's parameters leave the route
 * after the first change (the table owns its view from then on; "Copy link to this view" writes it back).
 */
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { readStored, writeStored } from "../persist";
import { decodeStored, hasViewParams, paramsToView, storedText, viewParamKeys, type Params, type TableView } from "./model";

export const TABLE_STORAGE_PREFIX = "tt.table.v1.";

/** Stored text per storage key once read (so a table that mounts again starts right away). */
const cache = new Map<string, string | null>();

export function useTableView(options: { id: string; storageKey: string; defaults: TableView; persist: boolean; params: Params | null }) {
	const { id, storageKey, persist } = options;
	const defaultsRef = useRef(options.defaults);
	defaultsRef.current = options.defaults;
	const fromLink = useRef(!!options.params && hasViewParams(id, options.params));
	const linkKeys = useRef(options.params ? viewParamKeys(id, options.params) : []);
	const [view, setView] = useState<TableView>(() => {
		if (fromLink.current && options.params) return paramsToView(id, options.params, options.defaults);
		if (persist && cache.has(storageKey)) return decodeStored(cache.get(storageKey), options.defaults) ?? options.defaults;
		return options.defaults;
	});
	const touched = useRef(false);

	useEffect(() => {
		if (!persist || fromLink.current || cache.has(storageKey)) return;
		let live = true;
		void readStored(TABLE_STORAGE_PREFIX + storageKey).then((text) => {
			cache.set(storageKey, text);
			if (!live || touched.current) return;
			const stored = decodeStored(text, defaultsRef.current);
			if (stored) setView(stored);
		});
		return () => {
			live = false;
		};
	}, [persist, storageKey]);

	const update = useCallback((change: (view: TableView) => TableView) => {
		touched.current = true;
		setView(change);
	}, []);
	const reset = useCallback(() => update(() => defaultsRef.current), [update]);

	const latest = useRef(view);
	latest.current = view;
	const pending = useRef<(() => void) | null>(null);
	useEffect(() => {
		if (!touched.current) return;
		const write = () => {
			pending.current = null;
			if (persist) {
				const text = storedText(latest.current, defaultsRef.current);
				cache.set(storageKey, text);
				writeStored(TABLE_STORAGE_PREFIX + storageKey, text);
			}
			if (fromLink.current) {
				fromLink.current = false;
				const clear: Record<string, undefined> = {};
				for (const k of linkKeys.current) clear[k] = undefined;
				if (linkKeys.current.length) {
					try {
						router.setParams(clear);
					} catch {
						// the screen is gone
					}
				}
			}
		};
		const timer = setTimeout(write, 250);
		pending.current = () => {
			clearTimeout(timer);
			write();
		};
		return () => clearTimeout(timer);
	}, [view, persist, storageKey]);
	// Leaving the page within the quarter second must not lose the last change.
	useEffect(
		() => () => {
			pending.current?.();
		},
		[],
	);

	return { view, update, reset };
}
