/**
 * The app's widget: `default-widget.ts` compiled to the widget spec (docs/WIDGET_HTML.md) once, at first import.
 * LiveSync sends `WIDGET_SPEC_JSON`; Settings → Widgets lists `WIDGET_WARNINGS` in dev builds.
 */
import type { WidgetSpec } from "../widget-spec";

import { compileWidgetHtml } from "./compile";
import { DEFAULT_WIDGET_HTML } from "./default-widget";

const compiled = compileWidgetHtml(DEFAULT_WIDGET_HTML);

export const WIDGET_SPEC: WidgetSpec = compiled.spec;
/** The compiler's warnings ("line N: …"): unsupported HTML / CSS that was left out. */
export const WIDGET_WARNINGS: readonly string[] = compiled.warnings;
/** What LiveSync sends; null when the HTML has no data layout (the native side keeps its saved spec then). */
export const WIDGET_SPEC_JSON: string | null = compiled.spec.layouts.data.length ? JSON.stringify(compiled.spec) : null;

if (__DEV__ && WIDGET_WARNINGS.length) {
	console.warn(`[widgets] default-widget.ts: ${WIDGET_WARNINGS.length} warning(s)\n${WIDGET_WARNINGS.join("\n")}`);
}
