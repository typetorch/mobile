/**
 * The app's home-screen widget, in the widget HTML subset (docs/WIDGET_HTML.md). Compiled to the widget spec by
 * `compile.ts` and sent by LiveSync, so a change here ships with `eas update`. Preview it on a desktop with
 * `bun scripts/widgets/preview.ts` (docs/widgets-preview.html), check it with `bun scripts/widgets/check.ts`.
 *
 * The look agreed on 2026-11-17 (docs/WIDGET_STATS.md): the game's icon in the header, values in `text` with coloured
 * units, ▲/▼ against the period before; 2x1 (two to four stats, short), 2x2 (CCU and a grid of four), 4x1 (CCU, the line,
 * four stats), 4x2 (CCU, the 6-hour line and four stat rows). Keep WidgetSpec.kt's DEFAULT_JSON in step at the next APK
 * (`bun scripts/widgets/check.ts --print`).
 */
/**
 * The release garden (docs/WIDGET_RELEASES.md, docs/WIDGET_HTML.md "The release garden"): a widget whose slot 1 is empty
 * (Settings → Widgets, style Releases: slots ["", "", "", "releases"]) draws the last 60 / 30 days of releases instead of
 * the stats. The data: the live answer's top-level `releases` (the backend sends it with every answer, so the APKs that
 * keep only a metric's value / prev still have it; an all-games widget gets it merged over the games). 60 days, oldest
 * first, the last one today; each day's `bg` / `tri` are the colour tokens below.
 */
const R = "releases";
/** Shown when the release data is there (the newest day has its colour). */
const HAS_RELEASES = `${R}.days.59.bg`;

const n2 = (n: number) => String(Math.round(n * 100) / 100);

/**
 * One `<svg>` with the last cols × rows days (oldest top left, row by row, today bottom right, outlined): per day a
 * rounded square in the day's `bg` token and over its bottom-right half (below the top-right → bottom-left diagonal,
 * following the rounded corners) the `tri` token (`rnone`, transparent, unless the day has prod and dev releases).
 * Fixed cell geometry in viewBox units; `data-fit="contain"` scales it uniformly into the element's box (the svg
 * templates have no arithmetic, so the cells can't be laid out from {w} / {h}).
 */
function garden(cols: number, rows: number, cell: number, gap: number, radius: number, style: string): string {
	const count = cols * rows;
	const first = 60 - count;
	const w = cols * cell + (cols - 1) * gap;
	const h = rows * cell + (rows - 1) * gap;
	const r = radius;
	const a = r * (1 - Math.SQRT1_2); // where the diagonal meets a rounded corner
	const side = cell - 2 * r;
	const out: string[] = [];
	let todayX = 0;
	let todayY = 0;
	for (let k = 0; k < count; k++) {
		const day = first + k;
		const x = (k % cols) * (cell + gap);
		const y = Math.floor(k / cols) * (cell + gap);
		out.push(`<rect x='${n2(x)}' y='${n2(y)}' width='${cell}' height='${cell}' rx='${r}' fill='var(--{${R}.days.${day}.bg|r0})'/>`);
		out.push(
			`<path d='M${n2(x + cell - a)},${n2(y + a)}a${r},${r} 0 0 1 ${n2(a)},${n2(r - a)}v${n2(side)}a${r},${r} 0 0 1 -${r},${r}h-${n2(side)}a${r},${r} 0 0 1 -${n2(r - a)},-${n2(a)}z' fill='var(--{${R}.days.${day}.tri|rnone})'/>`,
		);
		todayX = x;
		todayY = y;
	}
	const sw = Math.max(1, Math.round(cell * 0.1 * 10) / 10);
	out.push(
		`<rect x='${n2(todayX + sw / 2)}' y='${n2(todayY + sw / 2)}' width='${n2(cell - sw)}' height='${n2(cell - sw)}' rx='${n2(Math.max(0, r - sw / 2))}' fill='none' stroke='var(--text)' stroke-opacity='0.8' stroke-width='${sw}'/>`,
	);
	return `<svg viewBox="0 0 ${n2(w)} ${n2(h)}" data-fit="contain" style="${style}">${out.join("")}</svg>`;
}

/** "Loading releases…" in the garden's place until the release data is there. */
const GARDEN_LOADING = `<div style="display: grid; flex: 1" data-show-if="!${HAS_RELEASES}">
			<p style="place-self: center; margin: 0 8px; font-size: 11px; color: var(--text2); text-align: center">Loading releases…</p>
		</div>`;

/**
 * All-games widgets (docs/WIDGET_SPEC.md, All games): game N's icon chip, a 32 dp tap target that picks the game (or
 * clears the pick). The icon is dimmed by `games.N.alpha` (0.4 when another game is picked) and ringed when
 * `games.N.picked` ("1"; "" → the ring's opacity falls back to 0).
 */
function chipIcon(n: number, show = ""): string {
	const g = `games.${n}`;
	return `<svg viewBox="0 0 32 32" style="width: 32px; height: 32px"${show ? ` data-show-if="${show}"` : ""}><defs><clipPath id='i'><circle cx='16' cy='16' r='11'/></clipPath></defs><g opacity='{${g}.alpha|1}'><circle cx='16' cy='16' r='11' fill='var(--chip)'/><image href='{${g}.iconUrl}' x='5' y='5' width='22' height='22' preserveAspectRatio='xMidYMid slice' clip-path='url(#i)'/></g><circle cx='16' cy='16' r='14.2' fill='none' stroke='var(--text)' stroke-width='1.6' stroke-opacity='{${g}.picked|0}'/></svg>`;
}

/** The first [count] games' chips in a row (each hidden when there is no such game); [named]: the picked one as a pill with its name. */
function chips(count: number, named: boolean, style: string): string {
	const out: string[] = [];
	for (let n = 0; n < count; n++) {
		const g = `games.${n}`;
		const inner = named
			? `<div style="display: flex; align-items: center; padding-right: 9px; background: var(--chip); border-radius: 16px" data-show-if="${g}.picked">${chipIcon(n)}<span style="width: 70px; font-size: 10.5px; font-weight: 500; color: var(--text)">{${g}.name}</span></div>${chipIcon(n, `!${g}.picked`)}`
			: chipIcon(n);
		out.push(`<div data-show-if="${g}.id" data-tap="toggle:${g}">${inner}</div>`);
	}
	return `<div style="display: flex; align-items: center; ${style}" data-show-if="allGames">${out.join("")}</div>`;
}

/** "Releases ·" before the game's name in an all-games widget's header ({game}: "All games" or the picked game). */
const ALL_GAMES_TITLE = `<span style="margin-right: 4px; font-size: 12px; font-weight: 600; color: var(--text)" data-show-if="allGames">Releases ·</span>`;

/** Counts under a 30-day garden: prod and dev releases of the last 30 days. */
function counts30(size: number): string {
	return `<div style="display: flex; align-items: baseline">
				<span style="font-size: ${size}px; font-weight: 700; color: var(--rg3)">{${R}.prod30}</span>
				<span style="margin-left: 3px; font-size: 10px; color: var(--text2)">prod</span>
				<span style="margin-left: 8px; font-size: ${size}px; font-weight: 700; color: var(--rb3)">{${R}.dev30}</span>
				<span style="margin-left: 3px; font-size: 10px; color: var(--text2)">dev</span>
				<div style="flex: 1"></div>
				<span style="font-size: 10px; color: var(--text2)">30 d</span>
			</div>`;
}

export const DEFAULT_WIDGET_HTML = `
<!-- Colours: the tokens (var(--name) anywhere below), per system mode. #rrggbbaa: the last pair is the alpha.
     r0, rg1–rg3, rb1–rb3, rnone: the release garden's days (none, prod 1 / 2–3 / 4+, dev 1 / 2–3 / 4+, transparent);
     chip: an all-games widget's game chips. -->
<widget-tokens mode="day" style="
	--bg: #ffffffef; --text: #17171b; --text2: #62606a; --brand: #fb7a32; --up: #1f8a4c; --down: #c93c3c;
	--divider: #0000001f; --unitTime: #e2700f; --unitPercent: #1f6fd1; --unitRobux: #1f8a4c;
	--r0: #ebedf0; --rg1: #9be9a8; --rg2: #40c463; --rg3: #216e39; --rb1: #b3d1fa; --rb2: #4a8fe0; --rb3: #1d5cb3; --rnone: #0000;
	--chip: #ececf0">
</widget-tokens>
<widget-tokens mode="night" style="
	--bg: #1c1c20; --text: #f2f0f5; --text2: #a7a3ad; --brand: #fb7a32; --up: #4cc27a; --down: #ef6b6b;
	--divider: #ffffff33; --unitTime: #fb923c; --unitPercent: #5aa9ff; --unitRobux: #4cc27a;
	--r0: #2b2b31; --rg1: #1f6f45; --rg2: #2fa463; --rg3: #4cc27a; --rb1: #24508a; --rb2: #3a7fd0; --rb3: #5aa9ff; --rnone: #0000;
	--chip: #2b2b31">
</widget-tokens>
<widget-strings refreshing="refreshing…" offline="offline · {updated}"></widget-strings>
<!-- Retention as 34.25 % and its change as ▲1.12 points. -->
<widget-format ratio-decimals="2"></widget-format>

<!-- 4x2 and up: the CCU and its 6-hour line left, the four stats right. Releases style: 60 days (5 rows of 12), the
     counts and the last prod release beside; all games: a row of game chips (tap: show only that game) above. -->
<widget state="data" name="medium" min-width="240" min-height="120" refresh="topEnd">
	<div style="padding: 4px 6px 10px 14px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 22px; height: 22px; border-radius: 6px; background: var(--divider); margin-right: 7px" data-show-if="!allGames">
			${ALL_GAMES_TITLE}
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="display: flex; flex: 1; align-items: stretch; margin-top: 4px; padding-right: 8px" data-show-if="slot.1">
			<div style="flex: 1">
				<div style="display: flex; align-items: baseline">
					<span style="font-size: 34px; font-weight: 600; color: var(--text)">{ccu}</span>
					<span style="margin-left: 4px; font-size: 13px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
				</div>
				<tt-chart minutes="360" bucket="5" labels zero smooth dot fill style="flex: 1; margin: 2px 0 1px; color: var(--brand)"></tt-chart>
				<div style="display: flex; align-items: center; margin-left: 18px; margin-bottom: 2px">
					<span style="font-size: 9px; color: var(--text2)">6h ago</span>
					<div style="flex: 1"></div>
					<span style="font-size: 9px; color: var(--text2)">3h ago</span>
					<div style="flex: 1"></div>
					<span style="font-size: 9px; color: var(--text2)">{updated|now}</span>
				</div>
				<span style="font-size: 10px; color: var(--text2)">last 6 h · {serversLabel|no servers} · peak {peakToday}</span>
			</div>
			<div style="flex: 1; justify-content: center; gap: 6px; margin-left: 12px">
				<div style="display: flex; align-items: baseline" data-show-if="slot.1">
					<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{slot.1.label}</span>
					<span style="margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--text)">{slot.1.value}</span>
					<span style="margin-left: 4px; font-size: 9.5px; font-weight: 700" data-show-if="slot.1.delta">{slot.1.delta}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.2">
					<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{slot.2.label}</span>
					<span style="margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--text)">{slot.2.value}</span>
					<span style="margin-left: 4px; font-size: 9.5px; font-weight: 700" data-show-if="slot.2.delta">{slot.2.delta}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.3">
					<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{slot.3.label}</span>
					<span style="margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--text)">{slot.3.value}</span>
					<span style="margin-left: 4px; font-size: 9.5px; font-weight: 700" data-show-if="slot.3.delta">{slot.3.delta}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.4">
					<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{slot.4.label}</span>
					<span style="margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--text)">{slot.4.value}</span>
					<span style="margin-left: 4px; font-size: 9.5px; font-weight: 700" data-show-if="slot.4.delta">{slot.4.delta}</span>
				</div>
			</div>
		</div>
		<div style="flex: 1; margin-top: 6px; padding-right: 8px" data-show-if="!slot.1">
			${chips(6, true, "gap: 4px; margin-bottom: 3px")}
			<div style="display: flex; flex: 1; align-items: stretch" data-show-if="${HAS_RELEASES}">
				${garden(12, 5, 15, 3, 3, "flex: 1")}
				<div style="justify-content: center; gap: 2px; margin-left: 12px">
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 16px; font-weight: 700; color: var(--rg3)">{${R}.prod}</span>
						<span style="margin-left: 4px; font-size: 11px; color: var(--text2)">prod</span>
					</div>
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 16px; font-weight: 700; color: var(--rb3)">{${R}.dev}</span>
						<span style="margin-left: 4px; font-size: 11px; color: var(--text2)">dev</span>
					</div>
					<span style="margin-top: 4px; font-size: 10px; color: var(--text2)">last prod</span>
					<span style="font-size: 11.5px; font-weight: 600; color: var(--text)">{${R}.lastProd|none}</span>
					<span style="font-size: 9.5px; color: var(--text2)" data-show-if="${R}.lastProdGame">{${R}.lastProdGame}</span>
					<div data-show-if="!allGames">
						<span style="font-size: 9.5px; color: var(--text2)" data-show-if="${R}.lastProdLabel">{${R}.lastProdLabel}</span>
					</div>
				</div>
			</div>
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- 2x2: the CCU, then a 2x2 grid of the stats at the bottom. Releases style: the last 30 days (5 rows of 6), counts under; all games: chips of the first 4 games above. -->
<widget state="data" name="grid" min-width="100" min-height="115" refresh="topEnd">
	<div style="padding: 4px 6px 10px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 20px; height: 20px; border-radius: 6px; background: var(--divider); margin-right: 7px" data-show-if="!allGames">
			${ALL_GAMES_TITLE}
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="flex: 1" data-show-if="slot.1">
			<div style="display: flex; align-items: baseline; margin-top: 4px">
				<span style="font-size: 22px; font-weight: 600; color: var(--text)">{ccu}</span>
				<span style="margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
				<span style="flex: 1; margin-left: 4px; font-size: 10px; color: var(--text2)" data-show-if="servers">· {serversLabel}</span>
			</div>
			<div style="flex: 1"></div>
			<div style="display: flex; align-items: flex-start; gap: 6px; padding-right: 6px; margin-bottom: 7px">
				<div style="flex: 1" data-show-if="slot.1">
					<span style="font-size: 10px; color: var(--text2)">{slot.1.label}</span>
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 12px; font-weight: 600; color: var(--text)">{slot.1.value}</span>
						<span style="margin-left: 3px; font-size: 8.5px; font-weight: 700" data-show-if="slot.1.delta">{slot.1.delta}</span>
					</div>
				</div>
				<div style="flex: 1" data-show-if="slot.2">
					<span style="font-size: 10px; color: var(--text2)">{slot.2.label}</span>
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 12px; font-weight: 600; color: var(--text)">{slot.2.value}</span>
						<span style="margin-left: 3px; font-size: 8.5px; font-weight: 700" data-show-if="slot.2.delta">{slot.2.delta}</span>
					</div>
				</div>
			</div>
			<div style="display: flex; align-items: flex-start; gap: 6px; padding-right: 6px">
				<div style="flex: 1" data-show-if="slot.3">
					<span style="font-size: 10px; color: var(--text2)">{slot.3.label}</span>
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 12px; font-weight: 600; color: var(--text)">{slot.3.value}</span>
						<span style="margin-left: 3px; font-size: 8.5px; font-weight: 700" data-show-if="slot.3.delta">{slot.3.delta}</span>
					</div>
				</div>
				<div style="flex: 1" data-show-if="slot.4">
					<span style="font-size: 10px; color: var(--text2)">{slot.4.label}</span>
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 12px; font-weight: 600; color: var(--text)">{slot.4.value}</span>
						<span style="margin-left: 3px; font-size: 8.5px; font-weight: 700" data-show-if="slot.4.delta">{slot.4.delta}</span>
					</div>
				</div>
			</div>
		</div>
		<div style="flex: 1; margin-top: 4px; padding-right: 6px" data-show-if="!slot.1">
			${chips(4, false, "gap: 4px; margin-bottom: 2px")}
			<div style="flex: 1; margin-bottom: 2px" data-show-if="${HAS_RELEASES}">
				${garden(6, 5, 15, 3, 3, "flex: 1; margin-bottom: 5px")}
				${counts30(13)}
			</div>
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- 4x1 (wide and short): the CCU left, the 6-hour line in the middle, the stats right. Releases style: 60 days (3 rows
     of 20), the 60-day counts and the last prod release right; all games: the game chips in the header. -->
<widget state="data" name="wide" min-width="240" min-height="60" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px" data-show-if="!allGames">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			${chips(6, false, "gap: 2px; margin: 0 10px 0 4px")}
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)" data-show-if="!allGames">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="display: flex; flex: 1; align-items: stretch; padding-right: 6px" data-show-if="slot.1">
			<div style="justify-content: center">
				<div style="display: flex; align-items: baseline">
					<span style="font-size: 24px; font-weight: 600; color: var(--text)">{ccu}</span>
					<span style="margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
				</div>
			</div>
			<div style="flex: 1.7; margin: 2px 10px 0 10px">
				<tt-chart minutes="360" bucket="5" labels zero smooth dot fill style="flex: 1; margin-bottom: 1px; color: var(--brand)"></tt-chart>
				<div style="display: flex; align-items: center; margin-left: 18px; margin-bottom: 2px">
					<span style="font-size: 9px; color: var(--text2)">6h ago</span>
					<div style="flex: 1"></div>
					<span style="font-size: 9px; color: var(--text2)">3h ago</span>
					<div style="flex: 1"></div>
					<span style="font-size: 9px; color: var(--text2)">{updated|now}</span>
				</div>
			</div>
			<div style="justify-content: center; align-items: flex-end; gap: 1px">
				<div style="display: flex; align-items: baseline" data-show-if="slot.1">
					<span style="font-size: 10px; color: var(--text2)">{slot.1.label}</span>
					<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.1.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.2">
					<span style="font-size: 10px; color: var(--text2)">{slot.2.label}</span>
					<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.2.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.3">
					<span style="font-size: 10px; color: var(--text2)">{slot.3.label}</span>
					<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.3.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.4">
					<span style="font-size: 10px; color: var(--text2)">{slot.4.label}</span>
					<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.4.value}</span>
				</div>
			</div>
		</div>
		<div style="flex: 1; padding-right: 6px" data-show-if="!slot.1">
			<div style="display: flex; flex: 1; align-items: stretch" data-show-if="${HAS_RELEASES}">
				${garden(20, 3, 11, 2, 2, "flex: 1; margin: 1px 0 3px")}
				<div style="justify-content: center; align-items: flex-end; gap: 1px; margin-left: 10px">
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 13px; font-weight: 700; color: var(--rg3)">{${R}.prod}</span>
						<span style="margin-left: 3px; font-size: 10px; color: var(--text2)">prod</span>
						<span style="margin-left: 8px; font-size: 13px; font-weight: 700; color: var(--rb3)">{${R}.dev}</span>
						<span style="margin-left: 3px; font-size: 10px; color: var(--text2)">dev</span>
					</div>
					<span style="font-size: 10px; color: var(--text2)">last prod {${R}.lastProd|none}</span>
				</div>
			</div>
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- 2x1 tall enough for four stats. Releases style: the last 30 days (3 rows of 10), counts under. -->
<widget state="data" name="small4" min-width="100" min-height="90" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px" data-show-if="!allGames">
			${ALL_GAMES_TITLE}
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="flex: 1" data-show-if="slot.1">
			<div style="flex: 1"></div>
			<div style="display: flex; align-items: center; padding-right: 6px">
				<span style="font-size: 22px; font-weight: 600; color: var(--text)">{ccu}</span>
				<span style="margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
				<div style="flex: 1; align-items: flex-end; gap: 1px; margin-left: 8px">
					<div style="display: flex; align-items: baseline" data-show-if="slot.1">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.1.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.1.value:short}</span>
					</div>
					<div style="display: flex; align-items: baseline" data-show-if="slot.2">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.2.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.2.value:short}</span>
					</div>
					<div style="display: flex; align-items: baseline" data-show-if="slot.3">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.3.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.3.value:short}</span>
					</div>
					<div style="display: flex; align-items: baseline" data-show-if="slot.4">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.4.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.4.value:short}</span>
					</div>
				</div>
			</div>
			<div style="flex: 1"></div>
		</div>
		<div style="flex: 1; margin-top: 2px; padding-right: 6px" data-show-if="!slot.1">
			<div style="flex: 1" data-show-if="${HAS_RELEASES}">
				${garden(10, 3, 11, 2, 2, "flex: 1; margin-bottom: 4px")}
				${counts30(12)}
			</div>
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- 2x1 from 72 dp: three stats. Releases style: the last 30 days (2 rows of 15), counts under. -->
<widget state="data" name="small" min-width="100" min-height="72" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px" data-show-if="!allGames">
			${ALL_GAMES_TITLE}
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="flex: 1" data-show-if="slot.1">
			<div style="flex: 1"></div>
			<div style="display: flex; align-items: center; padding-right: 6px">
				<span style="font-size: 22px; font-weight: 600; color: var(--text)">{ccu}</span>
				<span style="margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
				<div style="flex: 1; align-items: flex-end; gap: 1px; margin-left: 8px">
					<div style="display: flex; align-items: baseline" data-show-if="slot.1">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.1.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.1.value:short}</span>
					</div>
					<div style="display: flex; align-items: baseline" data-show-if="slot.2">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.2.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.2.value:short}</span>
					</div>
					<div style="display: flex; align-items: baseline" data-show-if="slot.3">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.3.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.3.value:short}</span>
					</div>
				</div>
			</div>
			<div style="flex: 1"></div>
		</div>
		<div style="flex: 1; margin-top: 2px; padding-right: 6px" data-show-if="!slot.1">
			<div style="flex: 1" data-show-if="${HAS_RELEASES}">
				${garden(15, 2, 11, 2, 2, "flex: 1; margin-bottom: 3px")}
				${counts30(12)}
			</div>
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- anything smaller: two stats. Releases style: the last 30 days (2 rows of 15), the 30-day prod / dev counts in the
     header. -->
<widget state="data" name="tiny" min-width="0" min-height="0" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px" data-show-if="!allGames">
			${ALL_GAMES_TITLE}
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)" data-show-if="slot.1">{status}</span>
			<div data-show-if="!slot.1">
				<div style="display: flex; align-items: baseline; margin-left: 6px" data-show-if="${HAS_RELEASES}">
					<span style="font-size: 12px; font-weight: 700; color: var(--rg3)">{${R}.prod30}</span>
					<span style="margin-left: 5px; font-size: 12px; font-weight: 700; color: var(--rb3)">{${R}.dev30}</span>
				</div>
			</div>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="flex: 1" data-show-if="slot.1">
			<div style="flex: 1"></div>
			<div style="display: flex; align-items: center; padding-right: 6px">
				<span style="font-size: 22px; font-weight: 600; color: var(--text)">{ccu}</span>
				<span style="margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
				<div style="flex: 1; align-items: flex-end; gap: 1px; margin-left: 8px">
					<div style="display: flex; align-items: baseline" data-show-if="slot.1">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.1.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.1.value:short}</span>
					</div>
					<div style="display: flex; align-items: baseline" data-show-if="slot.2">
						<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.2.label}</span>
						<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.2.value:short}</span>
					</div>
				</div>
			</div>
			<div style="flex: 1"></div>
		</div>
		<div style="flex: 1; margin-top: 2px; padding-right: 6px" data-show-if="!slot.1">
			${garden(15, 2, 11, 2, 2, "flex: 1").replace("<svg ", `<svg data-show-if="${HAS_RELEASES}" `)}
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- No numbers yet. -->
<widget state="loading" name="message" refresh="topEnd">
	<div style="display: grid; padding: 8px">
		<p style="place-self: center; margin: 0 20px; font-size: 13px; color: var(--text); text-align: center; -webkit-line-clamp: 2">Loading…</p>
		<tt-icon name="refresh" style="place-self: start end; width: 18px; height: 18px; padding: 3px; color: var(--text2)"></tt-icon>
	</div>
</widget>

<!-- No numbers and the last fetch failed. -->
<widget state="unreachable" name="message" refresh="topEnd">
	<div style="display: grid; padding: 8px">
		<p style="place-self: center; margin: 0 20px; font-size: 13px; color: var(--text); text-align: center; -webkit-line-clamp: 2">Can't reach {backend|the backend}</p>
		<tt-icon name="refresh" style="place-self: start end; width: 18px; height: 18px; padding: 3px; color: var(--text2)"></tt-icon>
	</div>
</widget>

<!-- The backend is gone or its token is dead (no refresh). -->
<widget state="signedOut" name="message" refresh="none">
	<div style="display: grid; padding: 8px">
		<p style="place-self: center; margin: 0 20px; font-size: 13px; color: var(--text); text-align: center; -webkit-line-clamp: 2">Open TypeTorch to sign in</p>
	</div>
</widget>

<!-- No game picked yet (a tap opens the picker). -->
<widget state="pick" name="message" refresh="none">
	<div style="display: grid; padding: 8px">
		<p style="place-self: center; margin: 0 20px; font-size: 13px; color: var(--text); text-align: center; -webkit-line-clamp: 2">Tap to pick a game</p>
	</div>
</widget>
`;
