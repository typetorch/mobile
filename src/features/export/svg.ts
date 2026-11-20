/**
 * An export block drawn as standalone SVG markup, on white (print and chat friendly whatever the app's theme). The PDF
 * report puts it inline in its HTML; a PNG is the same markup rasterised by react-native-svg (png.tsx).
 * A header (the page, project and filters) goes on top when the image stands alone (PNG).
 */
import type { ExportBlock, SeriesData } from "./context";

export const INK = {
	bg: "#ffffff",
	fg: "#111111",
	muted: "#6b6b6b",
	grid: "#e5e5e5",
	track: "#f0f0f0",
	alert: "#d03b3b",
	chart: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
};

const FONT = "Helvetica, Arial, sans-serif";

export function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Cuts text to about `max` characters (SVG text doesn't wrap). */
function clip(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/** Words into lines of at most about `max` characters. */
function wrap(s: string, max: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of s.split(/\s+/)) {
		if (line && line.length + 1 + word.length > max) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	return lines;
}

function text(x: number, y: number, s: string, opts: { size?: number; color?: string; anchor?: "start" | "middle" | "end"; weight?: number } = {}): string {
	return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${opts.size ?? 12}" fill="${opts.color ?? INK.fg}"${opts.anchor && opts.anchor !== "start" ? ` text-anchor="${opts.anchor}"` : ""}${opts.weight ? ` font-weight="${opts.weight}"` : ""}>${esc(s)}</text>`;
}

function niceMax(max: number): number {
	if (max <= 0) return 1;
	const exp = 10 ** Math.floor(Math.log10(max));
	const f = max / exp;
	return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

export interface Drawn {
	svg: string;
	width: number;
	height: number;
}

export interface Header {
	title: string;
	lines: string[];
}

/** The block as one SVG `width` wide, with an optional header on top. */
export function blockSvg(block: ExportBlock, width = 760, header?: Header): Drawn {
	const pad = 20;
	const inner = width - pad * 2;
	let y = pad;
	const parts: string[] = [];
	if (header) {
		parts.push(text(pad, y + 16, clip(header.title, 70), { size: 18, weight: 700 }));
		y += 26;
		for (const line of header.lines) {
			parts.push(text(pad, y + 12, clip(line, 110), { size: 11, color: INK.muted }));
			y += 16;
		}
		y += 8;
	}
	parts.push(text(pad, y + 14, clip(block.title, 80), { size: 15, weight: 600 }));
	y += 26;
	const body = drawBody(block, pad, y, inner);
	parts.push(body.svg);
	y += body.height;
	if (block.note) {
		y += 6;
		for (const line of wrap(block.note, Math.floor(inner / 5.4)).slice(0, 4)) {
			parts.push(text(pad, y + 11, line, { size: 10, color: INK.muted }));
			y += 14;
		}
		y += 2;
	}
	const height = Math.ceil(y + pad);
	return {
		width,
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="${INK.bg}"/>${parts.join("")}</svg>`,
	};
}

/** Only the block's drawing (no title), for the PDF where the title is HTML. Tables have none. */
export function bodySvg(block: ExportBlock, width = 700): Drawn | null {
	if (block.kind === "table") return null;
	const body = drawBody(block, 0, 0, width);
	return { width, height: body.height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${body.height}" viewBox="0 0 ${width} ${body.height}">${body.svg}</svg>` };
}

function drawBody(block: ExportBlock, x: number, y: number, w: number): { svg: string; height: number } {
	switch (block.kind) {
		case "series":
			return drawSeries(block, x, y, w);
		case "bars":
			return drawBars(block, x, y, w);
		case "stats":
			return drawStats(block, x, y, w);
		case "table":
			return drawTable(block, x, y, w);
	}
}

function drawSeries(block: Extract<ExportBlock, { kind: "series" }>, x0: number, y0: number, w: number): { svg: string; height: number } {
	const H = 220;
	const pad = { top: 8, right: 10, bottom: 24, left: 52 };
	// A bar chart's extra series (the previous period) is a grey dashed line: its legend swatch too.
	const series: (SeriesData & { color: string })[] = block.series.map((s, i) => ({ ...s, color: block.chart === "bar" && i > 0 ? INK.muted : (s.color ?? (INK.chart[i % INK.chart.length] as string)) }));
	const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
	const values = series.flatMap((s) => s.points.map((p) => p.v ?? 0));
	const max = niceMax(Math.max(0, ...values));
	const min = Math.min(0, ...values);
	const plotW = w - pad.left - pad.right;
	const plotH = H - pad.top - pad.bottom;
	const left = x0 + pad.left;
	const top = y0 + pad.top;
	const out: string[] = [];
	const yOf = (v: number) => top + plotH - ((v - min) / (max - min || 1)) * plotH;
	for (const f of [0, 0.25, 0.5, 0.75, 1]) {
		const v = min + (max - min) * f;
		const yy = yOf(v);
		out.push(`<line x1="${left}" x2="${left + plotW}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${INK.grid}" stroke-width="1"/>`);
		out.push(text(left - 6, yy + 4, block.format(v), { size: 10, color: INK.muted, anchor: "end" }));
	}
	if (block.chart === "bar") {
		const s = series[0];
		const pts = s ? [...s.points].sort((a, b) => a.t - b.t) : [];
		const slot = pts.length ? plotW / pts.length : plotW;
		const bw = Math.max(1, slot * 0.72);
		pts.forEach((p, i) => {
			const h = ((p.v ?? 0) / max) * plotH;
			out.push(`<rect x="${(left + i * slot + (slot - bw) / 2).toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, p.v ? 1 : 0).toFixed(1)}" rx="1.5" fill="${s?.color}"/>`);
		});
		// a second series (the previous period) as a dashed line over the bars
		for (const extra of series.slice(1)) {
			const d = [...extra.points]
				.sort((a, b) => a.t - b.t)
				.map((p, i) => (p.v === null ? null : `${(left + i * slot + slot / 2).toFixed(1)},${yOf(p.v).toFixed(1)}`))
				.reduce<string[]>((acc, pt, i, all) => (pt === null ? acc : [...acc, `${i > 0 && all[i - 1] !== null ? "L" : "M"}${pt}`]), [])
				.join(" ");
			if (d) out.push(`<path d="${d}" stroke="${INK.muted}" stroke-width="1.5" stroke-dasharray="4,3" fill="none"/>`);
		}
	} else {
		const xOf = (t: number) => (times.length <= 1 ? left + plotW / 2 : left + ((t - (times[0] as number)) / ((times[times.length - 1] as number) - (times[0] as number))) * plotW);
		for (const s of series) {
			const pts = [...s.points].filter((p) => p.v !== null).sort((a, b) => a.t - b.t);
			if (!pts.length) continue;
			if (pts.length === 1) {
				const p = pts[0] as { t: number; v: number };
				out.push(`<circle cx="${xOf(p.t).toFixed(1)}" cy="${yOf(p.v).toFixed(1)}" r="2.5" fill="${s.color}"/>`);
				continue;
			}
			const d = pts.map((p, i) => `${i ? "L" : "M"}${xOf(p.t).toFixed(1)},${yOf(p.v as number).toFixed(1)}`).join(" ");
			out.push(`<path d="${d}" stroke="${s.color}" stroke-width="2" fill="none"${s.dashed ? ' stroke-dasharray="5,4"' : ""}/>`);
		}
	}
	if (times.length) {
		const first = times[0] as number;
		const last = times[times.length - 1] as number;
		out.push(text(left, top + plotH + 16, block.timeLabel(first), { size: 10, color: INK.muted }));
		if (times.length > 2) out.push(text(left + plotW / 2, top + plotH + 16, block.timeLabel(times[Math.floor(times.length / 2)] as number), { size: 10, color: INK.muted, anchor: "middle" }));
		if (times.length > 1) out.push(text(left + plotW, top + plotH + 16, block.timeLabel(last), { size: 10, color: INK.muted, anchor: "end" }));
	}
	let height = H;
	if (series.length > 1) {
		let lx = x0;
		let ly = y0 + H + 4;
		for (const s of series) {
			const label = clip(s.name, 28);
			const lw = 16 + label.length * 6.2 + 14;
			if (lx + lw > x0 + w) {
				lx = x0;
				ly += 16;
			}
			out.push(`<rect x="${lx}" y="${ly}" width="10" height="10" rx="2" fill="${s.color}"/>`);
			out.push(text(lx + 14, ly + 9, label, { size: 10, color: INK.muted }));
			lx += lw;
		}
		height = ly - y0 + 16;
	}
	return { svg: out.join(""), height };
}

function drawBars(block: Extract<ExportBlock, { kind: "bars" }>, x0: number, y0: number, w: number): { svg: string; height: number } {
	const out: string[] = [];
	let y = y0;
	block.rows.forEach((r, i) => {
		const color = r.alert ? INK.alert : (INK.chart[0] as string);
		const label = clip(r.label, Math.floor(w / 7));
		// The value beside the label when both fit on the line, else under the bar.
		const inline = label.length * 7 + r.text.length * 6.2 + 16 <= w;
		out.push(text(x0, y + 12, label, { size: 12, weight: 600, color: r.alert ? INK.alert : INK.fg }));
		if (inline) out.push(text(x0 + w, y + 12, r.text, { size: 11, color: INK.muted, anchor: "end" }));
		y += 18;
		out.push(`<rect x="${x0}" y="${y}" width="${w}" height="8" rx="4" fill="${INK.track}"/>`);
		out.push(`<rect x="${x0}" y="${y}" width="${Math.max(0, Math.min(1, r.share) * w).toFixed(1)}" height="8" rx="4" fill="${color}"/>`);
		y += 12;
		if (!inline) {
			out.push(text(x0, y + 10, clip(r.text, Math.floor(w / 6)), { size: 10.5, color: INK.muted }));
			y += 15;
		}
		if (r.sub) {
			out.push(text(x0, y + 10, clip(r.sub, 120), { size: 10, color: r.alert ? INK.alert : INK.muted }));
			y += 15;
		}
		if (i < block.rows.length - 1) y += 8;
	});
	return { svg: out.join(""), height: y - y0 };
}

function drawStats(block: Extract<ExportBlock, { kind: "stats" }>, x0: number, y0: number, w: number): { svg: string; height: number } {
	const cols = w >= 600 ? 4 : w >= 400 ? 3 : 2;
	const gap = 10;
	const cw = (w - gap * (cols - 1)) / cols;
	const ch = 64;
	const out: string[] = [];
	block.items.forEach((it, i) => {
		const cx = x0 + (i % cols) * (cw + gap);
		const cy = y0 + Math.floor(i / cols) * (ch + gap);
		const chars = Math.floor(cw / 6.5);
		out.push(`<rect x="${cx.toFixed(1)}" y="${cy}" width="${cw.toFixed(1)}" height="${ch}" rx="8" fill="none" stroke="${INK.grid}"/>`);
		out.push(text(cx + 10, cy + 17, clip(it.label.toUpperCase(), chars), { size: 9, color: INK.muted, weight: 600 }));
		out.push(text(cx + 10, cy + 40, clip(it.value, Math.floor(cw / 11)), { size: 18, weight: 700 }));
		if (it.sub) out.push(text(cx + 10, cy + 56, clip(it.sub, chars), { size: 9, color: INK.muted }));
	});
	const rows = Math.ceil(block.items.length / cols);
	return { svg: out.join(""), height: rows * ch + (rows - 1) * gap };
}

/** A table as an image: the first rows (the PDF and CSV carry them all). */
export const IMAGE_TABLE_ROWS = 30;

function drawTable(block: Extract<ExportBlock, { kind: "table" }>, x0: number, y0: number, w: number): { svg: string; height: number } {
	const cols = block.columns.slice(0, 8);
	const cw = w / Math.max(1, cols.length);
	const chars = Math.max(3, Math.floor(cw / 6.3));
	const rowH = 20;
	// Rows with pictures (ad creatives) are taller: the pictures (16:9) over the text, as many as fit the column.
	const picH = Math.min(54, Math.floor(((cw - 8) * 9) / 16));
	const hasPics = (ri: number) => cols.some((_c, i) => (block.images?.[ri]?.[i]?.length ?? 0) > 0);
	const out: string[] = [];
	cols.forEach((c, i) => out.push(text(x0 + i * cw + 4, y0 + 14, clip(c, chars), { size: 10, weight: 700, color: INK.muted })));
	let y = y0 + rowH;
	out.push(`<line x1="${x0}" x2="${x0 + w}" y1="${y}" y2="${y}" stroke="${INK.grid}"/>`);
	const rows = block.rows.slice(0, IMAGE_TABLE_ROWS);
	rows.forEach((r, ri) => {
		const top = hasPics(ri) ? picH + 6 : 0;
		const h = rowH + top;
		if (ri % 2 === 1) out.push(`<rect x="${x0}" y="${y}" width="${w}" height="${h}" fill="#fafafa"/>`);
		cols.forEach((_c, i) => {
			const urls = block.images?.[ri]?.[i] ?? [];
			const picW = Math.round((picH * 16) / 9);
			const fit = Math.max(1, Math.floor((cw - 8 + 3) / (picW + 3)));
			urls.slice(0, fit).forEach((u, k) => out.push(`<image x="${x0 + i * cw + 4 + k * (picW + 3)}" y="${y + 4}" width="${picW}" height="${picH}" preserveAspectRatio="xMidYMid slice" href="${esc(u)}"/>`));
			out.push(text(x0 + i * cw + 4, y + top + 14, clip(r[i] ?? "", chars), { size: 10 }));
		});
		y += h;
	});
	if (block.rows.length > rows.length || block.columns.length > cols.length) {
		const more = [block.rows.length > rows.length ? `${block.rows.length - rows.length} more rows` : "", block.columns.length > cols.length ? `${block.columns.length - cols.length} more columns` : ""].filter(Boolean).join(", ");
		out.push(text(x0, y + 14, `… ${more} in the PDF and CSV`, { size: 10, color: INK.muted }));
		y += 20;
	}
	return { svg: out.join(""), height: y - y0 };
}
