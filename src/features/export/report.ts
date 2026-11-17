/**
 * The PDF report of a page: its header (page, project, backend, when, every filter in effect), then each block in
 * screen order: charts, bars and key numbers as inline SVG (svg.ts), tables as HTML tables (long ones capped, the
 * CSV has every row). expo-print turns the HTML into the PDF.
 */
import type { ExportBlock } from "./context";
import { bodySvg, esc, INK, type Header } from "./svg";

/** Rows of one table in the PDF; more is a CSV's job (and makes the PDF slow on a phone). */
export const PDF_TABLE_ROWS = 500;

function table(block: Extract<ExportBlock, { kind: "table" }>): string {
	const rows = block.rows.slice(0, PDF_TABLE_ROWS);
	const head = `<tr>${block.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
	const body = rows.map((r) => `<tr>${block.columns.map((_c, i) => `<td>${esc(r[i] ?? "")}</td>`).join("")}</tr>`).join("");
	const more = block.rows.length > rows.length ? `<p class="note">The first ${rows.length} of ${block.rows.length} rows; the table's CSV has all of them.</p>` : "";
	return `<table>${head}${body}</table>${more}`;
}

function section(block: ExportBlock): string {
	const drawn = bodySvg(block);
	const content = block.kind === "table" ? table(block) : drawn ? `<div class="chart">${drawn.svg.replace("<svg ", '<svg style="width:100%;height:auto" ')}</div>` : "";
	const note = block.note ? `<p class="note">${esc(block.note)}</p>` : "";
	return `<section><h2>${esc(block.title)}</h2>${content}${note}</section>`;
}

export function reportHtml(header: Header, blocks: ExportBlock[]): string {
	return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
	@page { margin: 14mm 12mm; }
	body { font-family: Helvetica, Arial, sans-serif; color: ${INK.fg}; font-size: 11px; margin: 0; }
	h1 { font-size: 20px; margin: 0 0 4px; }
	.meta { color: ${INK.muted}; margin: 0 0 1px; }
	h2 { font-size: 14px; margin: 0 0 8px; }
	section { margin-top: 18px; page-break-inside: avoid; }
	section:has(table) { page-break-inside: auto; }
	.chart { width: 100%; }
	table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
	th { text-align: left; color: ${INK.muted}; font-weight: 700; border-bottom: 1px solid ${INK.grid}; padding: 4px 5px; }
	td { border-bottom: 1px solid #f1f1f1; padding: 3px 5px; vertical-align: top; word-break: break-word; }
	tr:nth-child(even) td { background: #fafafa; }
	thead { display: table-header-group; }
	.note { color: ${INK.muted}; font-size: 9.5px; margin: 6px 0 0; }
	footer { margin-top: 24px; color: ${INK.muted}; font-size: 9px; }
</style></head><body>
<h1>${esc(header.title)}</h1>
${header.lines.map((l) => `<p class="meta">${esc(l)}</p>`).join("")}
${blocks.map(section).join("\n")}
<footer>Exported from the TypeTorch app.</footer>
</body></html>`;
}
