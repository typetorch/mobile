/**
 * Builds docs/widgets-preview.html: one self-contained page (no CDN, no server) that compiles the widget HTML with the
 * app's compiler and draws it with sample data at the launcher's size classes, by day and by night. The page has an
 * editor: changes there redraw at once (kept in the browser's storage); copy them back into default-widget.ts.
 *
 * Run: `timeout 60 bun scripts/widgets/preview.ts`, then open docs/widgets-preview.html.
 *   --watch   rebuild when a bundled file changes (reload the page after); stop with Ctrl+C
 *
 * Bundling: each TypeScript file is transpiled (types stripped, typescript's transpileModule) to a CommonJS function and
 * the requires are resolved to those functions, starting from scripts/widgets/preview-render.ts.
 */
import ts from "typescript";

// Bun's API (run with bun; the app's tsconfig has no node / bun types, so just what is used here).
declare const Bun: {
	file(path: string): { text(): Promise<string>; exists(): Promise<boolean>; lastModified: number };
	write(path: string, data: string): Promise<number>;
	argv: string[];
};

const ROOT = new URL("../../", import.meta.url).pathname;
const ENTRY = "scripts/widgets/preview-render.ts";
const OUT = "docs/widgets-preview.html";

function dirOf(id: string) {
	return id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "";
}

/** "a/b" + "../c" → "a/c". */
function joinPath(dir: string, spec: string): string {
	const parts = dir ? dir.split("/") : [];
	for (const p of spec.split("/")) {
		if (p === "..") parts.pop();
		else if (p !== "." && p) parts.push(p);
	}
	return parts.join("/");
}

async function resolve(from: string, spec: string): Promise<string> {
	if (!spec.startsWith(".")) throw new Error(`${from}: only relative imports can be bundled (${spec})`);
	const base = joinPath(dirOf(from), spec);
	for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
		if (await Bun.file(ROOT + cand).exists()) return cand;
	}
	throw new Error(`${from}: cannot resolve ${spec}`);
}

async function bundle(): Promise<{ js: string; files: string[] }> {
	const modules = new Map<string, string>();
	const queue = [ENTRY];
	while (queue.length) {
		const id = queue.shift() as string;
		if (modules.has(id)) continue;
		const src = await Bun.file(ROOT + id).text();
		const out = ts.transpileModule(src, {
			fileName: id,
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false },
		}).outputText;
		const specs = [...out.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
		let code = out;
		for (const spec of new Set(specs)) {
			const dep = await resolve(id, spec);
			code = code.split(`require("${spec}")`).join(`require(${JSON.stringify(dep)})`);
			queue.push(dep);
		}
		modules.set(id, code);
	}
	const defs = [...modules.entries()]
		.map(([id, code]) => `${JSON.stringify(id)}: function (module, exports, require) {\n${code}\n}`)
		.join(",\n");
	const js = `(function () {
var defs = {
${defs}
};
var cache = {};
function require(id) {
	if (cache[id]) return cache[id].exports;
	var module = (cache[id] = { exports: {} });
	defs[id](module, module.exports, require);
	return module.exports;
}
require(${JSON.stringify(ENTRY)}).mount(document.getElementById("app"));
})();`;
	return { js: js.replace(/<\/script/gi, "<\\/script"), files: [...modules.keys()] };
}

const CSS = `
:root { --page: #f4f4f6; --panel: #ffffff; --ink: #1b1b1f; --muted: #66646c; --line: #dcdce2; --accent: #fb7a32; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --page: #111114; --panel: #1b1b20; --ink: #ececee; --muted: #a2a0a8; --line: #2e2e36; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 2; }
header h1 { font-size: 16px; margin: 0 8px 0 0; }
header label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
header input[type=number] { width: 64px; }
select, input, button, textarea { font: inherit; color: inherit; background: var(--page); border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px; }
button { cursor: pointer; }
main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 520px); gap: 16px; padding: 16px; align-items: start; }
@media (max-width: 1100px) { main { grid-template-columns: minmax(0, 1fr); } }
#out { display: grid; gap: 16px; min-width: 0; }
.home { border-radius: 14px; padding: 12px 14px 16px; overflow-x: auto; }
.home h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.home.day { background: linear-gradient(160deg, #cfe0f5, #eef1e6); color: #1b1b1f; }
.home.night { background: linear-gradient(160deg, #1d2433, #0d1017); color: #e6e6ea; }
.row { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; margin-bottom: 12px; }
figure { margin: 0; }
figcaption { font-size: 11px; opacity: .75; margin-top: 4px; }
.widget { font-family: Roboto, "Segoe UI", system-ui, sans-serif; box-shadow: 0 1px 3px rgba(0,0,0,.18); }
aside { position: sticky; top: 70px; display: grid; gap: 10px; min-width: 0; }
aside .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#source { width: 100%; height: 560px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; tab-size: 2; resize: vertical; }
.warn { font-size: 12px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); max-height: 240px; overflow: auto; }
.warn ul { margin: 6px 0 0; padding-left: 18px; }
.warn.bad { border-color: #d6454580; }
.warn.ok { color: var(--muted); }
details { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
details pre { max-height: 420px; overflow: auto; font-size: 11px; margin: 6px 0 0; }
#edited { color: var(--accent); font-size: 12px; }
.hint { color: var(--muted); font-size: 12px; margin: 0; }
`;

function page(js: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Widget preview</title>
<!-- Generated by scripts/widgets/preview.ts from src/features/live/widgets/ (do not edit; run: bun scripts/widgets/preview.ts). -->
<style>${CSS}</style>
</head>
<body>
<div id="app">
<header>
	<h1>Widget preview</h1>
	<label>Sample <select id="sample"></select></label>
	<label>Style <select id="style"><option value="stats">Stats</option><option value="releases">Releases</option><option value="releasesLoading">Releases (no data yet)</option><option value="releasesOld">Releases (older backend: 60 days)</option></select></label>
	<label>Zoom <select id="zoom"><option value="1">1×</option><option value="1.5" selected>1.5×</option><option value="2">2×</option></select></label>
	<label><input type="checkbox" id="hit"> hit areas</label>
	<label>Custom <input id="cw" type="number" min="40" max="600" placeholder="w"> × <input id="ch" type="number" min="40" max="600" placeholder="h"> dp</label>
</header>
<main>
	<div id="out"></div>
	<aside>
		<div class="bar">
			<b>Widget HTML</b> <span id="edited" hidden>edited here (not saved to the repo)</span>
			<span style="flex:1"></span>
			<button id="copy" type="button">Copy HTML</button>
			<button id="copyJson" type="button">Copy spec JSON</button>
			<button id="reset" type="button">Reset to default-widget.ts</button>
		</div>
		<textarea id="source" spellcheck="false" aria-label="Widget HTML"></textarea>
		<p class="hint">Edits redraw at once. To ship one, paste it into src/features/live/widgets/default-widget.ts (docs/WIDGET_HTML.md).</p>
		<div id="warnings" class="warn"></div>
		<details><summary>Compiled spec (what the app sends)</summary><pre id="json"></pre></details>
	</aside>
</main>
</div>
<script>${js}</script>
</body>
</html>
`;
}

async function build(): Promise<string[]> {
	const { js, files } = await bundle();
	await Bun.write(ROOT + OUT, page(js));
	console.log(`wrote ${OUT} (${files.length} modules: ${files.join(", ")})`);
	return files;
}

let files = await build();
if (Bun.argv.includes("--watch")) {
	const stamp = () => files.map((f) => Bun.file(ROOT + f).lastModified).join(",");
	let last = stamp();
	console.log("watching; Ctrl+C to stop");
	setInterval(async () => {
		const now = stamp();
		if (now === last) return;
		last = now;
		try {
			files = await build();
			last = stamp();
		} catch (e) {
			console.error(String(e));
		}
	}, 800);
}
