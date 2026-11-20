/**
 * The header's Export button: a sheet with the whole page as a PDF report, and each chart, breakdown, set of key numbers
 * and table on it as a PNG image or a CSV file, all as on screen (the page's filters, a table's own filters and sort).
 * Files go to the share sheet (save to Files / Drive, send in a chat, mail).
 *
 * PNG: the block's SVG (svg.ts) is drawn by react-native-svg off screen and read back with toDataURL, at 2x.
 * PDF: expo-print renders the report's HTML (report.ts).
 */
import * as Print from "expo-print";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRef, useState, type ComponentType, type Ref } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { Button, Icon, notify, Txt } from "@/components/ui";
import { Sheet, SheetItem } from "@/features/typetorch/sheet";
import { shareTextFile } from "@/features/typetorch/table/export";
import { radius, space, useTheme } from "@/theme";

import type { ExportBlock, ExportRegistry } from "./context";
import { inlineImages } from "./images";
import { reportHtml } from "./report";
import { blockSvg, type Header } from "./svg";

/** A file name part: "Funnels", "The Prison" → "funnels", "the-prison". */
export function slug(s: string): string {
	return (
		s
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^\w]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "export"
	);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");

async function shareFile(file: File, mimeType: string, UTI: string): Promise<void> {
	if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
	await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle: file.name });
}

function freshFile(name: string): File {
	const file = new File(Paths.cache, name);
	if (file.exists) file.delete();
	return file;
}

/** The block's CSV: a table's own (raw values), a chart's values per time, bars and numbers as label / value rows. */
export function blockCsv(block: ExportBlock): string {
	const field = (v: string | number | null | undefined) => {
		const s = v === null || v === undefined ? "" : String(v);
		return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const lines = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(field).join(",")).join("\r\n");
	switch (block.kind) {
		case "table":
			return block.csv();
		case "series": {
			const times = [...new Set(block.series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
			const byName = block.series.map((s) => new Map(s.points.map((p) => [p.t, p.v])));
			return lines([["time (UTC)", ...block.series.map((s) => s.name)], ...times.map((t) => [new Date(t).toISOString(), ...byName.map((m) => m.get(t) ?? null)])]);
		}
		case "bars":
			return lines([["label", "share", "value"], ...block.rows.map((r) => [r.label, +r.share.toFixed(6), r.sub ? `${r.text} · ${r.sub}` : r.text])]);
		case "stats":
			return lines([["metric", "value", "detail"], ...block.items.map((it) => [it.label, it.value, it.sub ?? ""])]);
	}
}

/** Draws SVG markup off screen and returns it as a base64 PNG. */
function usePngRenderer() {
	const [job, setJob] = useState<{ xml: string; width: number; height: number; done(b64: string | null): void } | null>(null);
	const svg = useRef<{ toDataURL(cb: (b64: string) => void, options?: object): void } | null>(null);
	const render = (xml: string, width: number, height: number) =>
		new Promise<string | null>((resolve) => {
			const timer = setTimeout(() => finish(null), 8000);
			const finish = (b64: string | null) => {
				clearTimeout(timer);
				setJob(null);
				resolve(b64);
			};
			setJob({ xml, width, height, done: finish });
		});
	// SvgXml hands its props (ref included, React 19) to the Svg it draws: the ref is that Svg, with toDataURL.
	const Xml = SvgXml as unknown as ComponentType<{ xml: string; width: number; height: number; ref?: Ref<unknown> }>;
	const host = job ? (
		<View pointerEvents="none" style={{ position: "absolute", left: -20000, top: 0, width: job.width, height: job.height, opacity: 0 }}>
			<View
				onLayout={() =>
					setTimeout(() => {
						if (!svg.current) return job.done(null);
						svg.current.toDataURL((b64) => job.done(b64 || null), { width: job.width * 2, height: job.height * 2 });
					}, job.xml.includes("<image") ? 600 : 60) // pictures decode after layout
				}
			>
				<Xml ref={svg} xml={job.xml} width={job.width} height={job.height} />
			</View>
		</View>
	) : null;
	return { render, host };
}

type Busy = null | { key: string; label: string };

export function ExportButton({ registry, header, fileBase }: { registry: ExportRegistry; header: () => Header; fileBase: () => string }) {
	const p = useTheme();
	const [open, setOpen] = useState(false);
	const [blocks, setBlocks] = useState<ExportBlock[]>([]);
	const [busy, setBusy] = useState<Busy>(null);
	const png = usePngRenderer();

	const run = async (key: string, label: string, work: () => Promise<void>) => {
		if (busy) return;
		setBusy({ key, label });
		try {
			await work();
		} catch (error) {
			notify("Export failed", error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	};

	const pdf = () =>
		run("pdf", "Making the PDF…", async () => {
			const now = registry.blocks();
			if (!now.length) throw new Error("Nothing on this page to export yet.");
			const result = await Print.printToFileAsync({ html: reportHtml(header(), await inlineImages(now, true)) });
			const file = freshFile(`${fileBase()}-${stamp()}.pdf`);
			new File(result.uri).move(file);
			await shareFile(file, "application/pdf", "com.adobe.pdf");
		});

	const pngOf = (block: ExportBlock) =>
		run(`png:${block.title}`, "Drawing the image…", async () => {
			const [withPics] = await inlineImages([block], false);
			const drawn = blockSvg(withPics ?? block, 760, header());
			const b64 = await png.render(drawn.svg, drawn.width, drawn.height);
			if (!b64) throw new Error("The image couldn't be drawn.");
			const file = freshFile(`${fileBase()}-${slug(block.title)}-${stamp()}.png`);
			file.create();
			file.write(b64, { encoding: "base64" });
			await shareFile(file, "image/png", "public.png");
		});

	const csvOf = (block: ExportBlock) =>
		run(`csv:${block.title}`, "Writing the CSV…", async () => {
			const ok = await shareTextFile(`${fileBase()}-${slug(block.title)}-${stamp()}.csv`, blockCsv(block));
			if (!ok) throw new Error("The CSV couldn't be saved or shared.");
		});

	const kindLabel = (b: ExportBlock) => (b.kind === "table" ? `Table · ${b.rows.length} rows` : b.kind === "series" ? "Chart" : b.kind === "bars" ? `Bars · ${b.rows.length}` : `Numbers · ${b.items.length}`);
	const kindIcon = (b: ExportBlock) => (b.kind === "table" ? "grid-outline" : b.kind === "series" ? "stats-chart-outline" : b.kind === "bars" ? "bar-chart-outline" : "speedometer-outline");

	return (
		<>
			<Pressable
				onPress={() => {
					setBlocks(registry.blocks());
					setOpen(true);
				}}
				hitSlop={10}
				accessibilityLabel="Export this page"
				style={{ paddingHorizontal: 4 }}
			>
				<Icon name="download-outline" size={20} color={p.foreground} />
			</Pressable>
			<Sheet open={open} onClose={() => setOpen(false)} title="Export" subtitle="As on screen: this page's filters, each table's filters and sort">
				{png.host}
				{blocks.length ? (
					<>
						<SheetItem icon="document-text-outline" label={`PDF report (${blocks.length} section${blocks.length === 1 ? "" : "s"})`} onPress={() => void pdf()} disabled={!!busy} />
						<Txt variant="label" style={{ marginTop: space.sm }}>
							Charts and tables
						</Txt>
						{blocks.map((b, i) => (
							<View key={`${b.title}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderColor: p.border }}>
								<Icon name={kindIcon(b)} size={16} color={p.mutedForeground} />
								<View style={{ flex: 1 }}>
									<Txt numberOfLines={1}>{b.title}</Txt>
									<Txt variant="small">{kindLabel(b)}</Txt>
								</View>
								<Button title="PNG" small variant="ghost" onPress={() => void pngOf(b)} disabled={!!busy} />
								<Button title="CSV" small variant="ghost" onPress={() => void csvOf(b)} disabled={!!busy} />
							</View>
						))}
					</>
				) : (
					<Txt variant="muted">Nothing to export yet: the page's charts and tables show up here once they've loaded.</Txt>
				)}
				{busy ? (
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: p.muted }}>
						<ActivityIndicator size="small" color={p.brand} />
						<Txt variant="small">{busy.label}</Txt>
					</View>
				) : null}
			</Sheet>
		</>
	);
}
