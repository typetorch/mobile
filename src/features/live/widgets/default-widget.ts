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
 * (Settings → Widgets, style Releases: slots ["", "", "", "releases"]) draws the last weeks of releases (GitHub-style,
 * as many weeks as the size fits) instead of the stats. The data: the live answer's top-level `releases` (the backend
 * sends it with every answer, so the APKs that keep only a metric's value / prev still have it; an all-games widget gets
 * it merged over the games). DAYS days, oldest first, the last one today; each day's `bg` / `tri` are the colour tokens
 * below (`rnone` for the days before the game's history: nothing drawn).
 */
const R = "releases";
/** How many days the backend sends in `releases.days` (oldest first, the last one today): 26 weeks. */
const DAYS = 182;
/** Shown when the release data is there (`prod` comes with every `releases`, also an older backend's). */
const HAS_RELEASES = `${R}.prod`;

const ROWS = 7;
const CELL = 10;
const GAP = 2;
const RADIUS = 2;

const n2 = (n: number) => String(Math.round(n * 100) / 100);

/**
 * One `<svg>` with the last 7 × [cols] days in GitHub order: 7 rows per column, a column filled top to bottom, columns
 * oldest left; today is the bottom-right cell (outlined). Column c, row r shows `days[DAYS - 7·cols + 7·c + r]`. Per day
 * a rounded square in its `bg` token and, over its bottom-right half (below the top-right → bottom-left diagonal,
 * following the rounded corners), its `tri` token (`rnone`, transparent, unless the day has prod and dev releases).
 * A missing day (an older backend's shorter list) is `rnone`: nothing drawn, as for the days before the game's history.
 * The two shapes are in `<defs>` once and placed with `<use>` (its fill is inherited), which keeps the markup small.
 * Fixed cell geometry in viewBox units; `data-fit="contain"` scales it uniformly into the element's box (the svg
 * templates have no arithmetic, so the cells can't be laid out from {w} / {h}): pick [cols] for the box's aspect.
 */
function gardenCells(c: number, ring = ""): string {
	const step = CELL + GAP;
	const r = RADIUS;
	const a = r * (1 - Math.SQRT1_2); // where the diagonal meets a rounded corner
	const side = CELL - 2 * r;
	const out: string[] = [
		`<defs><rect id='c' width='${CELL}' height='${CELL}' rx='${r}'/><path id='t' d='M${n2(CELL - a)},${n2(a)}a${r},${r} 0 0 1 ${n2(a)},${n2(r - a)}v${side}a${r},${r} 0 0 1 -${r},${r}h-${side}a${r},${r} 0 0 1 -${n2(r - a)},-${n2(a)}z'/></defs>`,
	];
	for (let col = 0; col < c; col++) {
		out.push(col ? `<g transform='translate(${col * step})'>` : "<g>");
		for (let row = 0; row < ROWS; row++) {
			const day = DAYS - ROWS * c + ROWS * col + row;
			const y = row ? ` y='${row * step}'` : "";
			out.push(`<use href='#c'${y} fill='var(--{${R}.days.${day}.bg|rnone})'/><use href='#t'${y} fill='var(--{${R}.days.${day}.tri|rnone})'/>`);
		}
		out.push("</g>");
	}
	const sw = 1;
	out.push(
		`<rect x='${n2((c - 1) * step + sw / 2)}' y='${n2((ROWS - 1) * step + sw / 2)}' width='${CELL - sw}' height='${CELL - sw}' rx='${n2(r - sw / 2)}' fill='none' stroke='var(--text)' stroke-opacity='0.8' stroke-width='${sw}'/>`,
	);
	// [ring]: a binding holding a colour token (`bad`, `warn`, `rnone` = nothing) drawn over today's outline.
	if (ring) {
		const rw = 2;
		out.push(
			`<rect x='${n2((c - 1) * step + rw / 2)}' y='${n2((ROWS - 1) * step + rw / 2)}' width='${CELL - rw}' height='${CELL - rw}' rx='${n2(r)}' fill='none' stroke='var(--{${ring}|rnone})' stroke-width='${rw}'/>`,
		);
	}
	return out.join("");
}

const weeks = (cols: number) => Math.min(cols, Math.floor(DAYS / ROWS));

function garden(cols: number, style: string, ring = ""): string {
	const c = weeks(cols);
	return `<svg viewBox="0 0 ${c * (CELL + GAP) - GAP} ${ROWS * (CELL + GAP) - GAP}" data-fit="contain" style="${style}">${gardenCells(c, ring)}</svg>`;
}

/**
 * The garden at the element's full height, right-aligned in its box (the 4x1): the viewBox is the box in dp
 * (`0 0 {w} {h}`, fit fill), and the grid is moved to the right edge and scaled to the height with transforms
 * (`translate({w}) scale({h}) scale(1/grid height)`), so no arithmetic is needed. A box narrower than the grid cuts its
 * oldest (left) columns.
 */
function gardenRight(cols: number, style: string): string {
	const c = weeks(cols);
	const gw = c * (CELL + GAP) - GAP;
	const gh = ROWS * (CELL + GAP) - GAP;
	return `<svg viewBox="0 0 {w} {h}" style="${style}"><g transform='translate({w}) scale({h}) scale(${(1 / gh).toFixed(6)}) translate(-${gw})'>${gardenCells(c)}</g></svg>`;
}

/** "Loading releases…" in the garden's place until the release data is there. */
const GARDEN_LOADING = `<div style="display: grid; flex: 1" data-show-if="!${HAS_RELEASES}">
			<p style="place-self: center; margin: 0 8px; font-size: 11px; color: var(--text2); text-align: center">Loading releases…</p>
		</div>`;

/**
 * All-games widgets (docs/WIDGET_SPEC.md, All games): game N's icon chip, a 32 dp tap target that picks the game (or
 * clears the pick): the widget program's `action:toggle:<backend id>` (docs/WIDGET_PROGRAM.md; LiveSync sends these
 * chips as `toggle:games.N` where the program doesn't run). The icon is dimmed by `games.N.alpha` (0.4 when another
 * game is picked) and ringed when `games.N.picked` ("1"; "" → the ring's opacity falls back to 0).
 */
function chipIcon(n: number, show = "", size = 32): string {
	const g = `games.${n}`;
	return `<svg viewBox="0 0 32 32" style="width: ${size}px; height: ${size}px"${show ? ` data-show-if="${show}"` : ""}><defs><clipPath id='i'><circle cx='16' cy='16' r='11'/></clipPath></defs><g opacity='{${g}.alpha|1}'><circle cx='16' cy='16' r='11' fill='var(--chip)'/><image href='{${g}.iconUrl}' x='5' y='5' width='22' height='22' preserveAspectRatio='xMidYMid slice' clip-path='url(#i)'/></g><circle cx='16' cy='16' r='14.2' fill='none' stroke='var(--text)' stroke-width='1.6' stroke-opacity='{${g}.picked|0}'/></svg>`;
}

/** The first [count] games' chips in a row (each hidden when there is no such game); [named]: the picked one as a pill with its name. */
function chips(count: number, named: boolean, style: string, size = 32): string {
	const out: string[] = [];
	for (let n = 0; n < count; n++) {
		const g = `games.${n}`;
		const inner = named
			? `<div style="display: flex; align-items: center; padding-right: 9px; background: var(--chip); border-radius: 16px" data-show-if="${g}.picked">${chipIcon(n)}<span style="width: 70px; font-size: 10.5px; font-weight: 500; color: var(--text)">{${g}.name}</span></div>${chipIcon(n, `!${g}.picked`)}`
			: chipIcon(n, "", size);
		out.push(`<div data-show-if="${g}.id" data-tap="action:toggle:{${g}.id}">${inner}</div>`);
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

/**
 * The Stats widgets' health (docs/WIDGET_HTML.md "Health on the Stats widgets"): the program's per-game `health`
 * (program/health.ts gameHealth; `health.on` only from the program, so the native path without it hides these). An
 * `<svg>` text, one element however many colours: each part's colour is a token name the program picked
 * (`errorsTone`, `trendTone`, `serversTone`, `alertsTone`), which only an svg fill can take from a binding.
 */
const H = "health";
const ERR = `<tspan font-weight='700' fill='var(--{${H}.errorsTone|text})'>{${H}.errors1h:count}</tspan>`;
const trend = (size: number, arrowOnly = false) =>
	`<tspan font-size='${size}' font-weight='700' fill='var(--{${H}.trendTone|text2})'>{${H}.${arrowOnly ? "errorsArrow" : "errorsTrend"}}</tspan>`;
const SRV = `<tspan fill='var(--{${H}.serversTone|text2})'><tspan font-weight='700'>{${H}.serversOk}/{${H}.servers}</tspan> srv</tspan>`;
const ALERTS = `<tspan font-weight='700' fill='var(--{${H}.alertsTone|text2})'>{${H}.alertsOpen}</tspan><tspan fill='var(--text2)'> alerts</tspan>`;
const ERR_LABEL = (label: string) => `<tspan fill='var(--text2)'> ${label}</tspan>`;

/** 4x2: a divider, then "143▲4× err 1h   5/6 srv   2 alerts" in one line. */
const HEALTH_LINE = `<svg viewBox="0 0 {w} {h}" style="height: 19px; margin-top: 4px" data-show-if="${H}.on"><line x1='0' y1='0.5' x2='{w}' y2='0.5' stroke='var(--divider)' stroke-width='1'/><text x='0' y='15' font-size='10.5' fill='var(--text)'>${ERR}${trend(9)}${ERR_LABEL("err 1h")}<tspan dx='9'>${SRV}</tspan><tspan dx='9'>${ALERTS}</tspan></text></svg>`;

/** 4x1: three lines under the CCU (errors, servers, alerts), in the height left under it (a short widget shows the first). */
const HEALTH_LINES = `<svg viewBox="0 0 {w} {h}" style="width: 76px; flex: 1; margin-top: 2px" data-show-if="${H}.on"><text font-size='10' fill='var(--text)'><tspan x='0' y='10'>${ERR}${trend(8.5)}${ERR_LABEL("err")}</tspan><tspan x='0' y='22'>${SRV}</tspan><tspan x='0' y='34'>${ALERTS}</tspan></text></svg>`;

/** 2x1: "143▲ err · 5/6 srv" (the arrow only), a full-width line right-aligned over the stats. */
const HEALTH_SHORT = `<svg viewBox="0 0 {w} {h}" style="height: 13px; margin-right: 6px" data-show-if="${H}.on"><text x='{w}' y='10' font-size='9.5' text-anchor='end' fill='var(--text)'>${ERR}${trend(8, true)}${ERR_LABEL("err ·")} ${SRV}</text></svg>`;

/** 2x2: three pills (errors with the trend, servers, open alerts); native texts, each colour a pair of elements. */
const HEALTH_PILLS = `<div style="display: flex; align-items: center; gap: 4px; margin-top: 3px" data-show-if="${H}.on">
				<div style="display: flex; align-items: baseline; padding: 1px 7px; background: var(--chip); border-radius: 9px">
					<span style="font-size: 10px; font-weight: 700; color: var(--bad)" data-show-if="${H}.errorsUp">{${H}.errors1h:count}</span>
					<span style="font-size: 10px; font-weight: 700; color: var(--text)" data-show-if="!${H}.errorsUp">{${H}.errors1h:count}</span>
					<span style="margin-left: 2px; font-size: 8px; font-weight: 700; color: var(--bad)" data-show-if="${H}.errorsUp">{${H}.errorsTrend}</span>
					<span style="margin-left: 2px; font-size: 8px; font-weight: 700; color: var(--up)" data-show-if="${H}.errorsDown">{${H}.errorsTrend}</span>
				</div>
				<div style="padding: 1px 7px; background: var(--chip); border-radius: 9px">
					<span style="font-size: 10px; color: var(--text2)" data-show-if="${H}.serversAllOk">{${H}.serversOk}/{${H}.servers}</span>
					<span style="font-size: 10px; color: var(--warn)" data-show-if="!${H}.serversAllOk">{${H}.serversOk}/{${H}.servers}</span>
				</div>
				<div style="display: flex; align-items: baseline; padding: 1px 7px; background: var(--chip); border-radius: 9px">
					<span style="font-size: 10px; font-weight: 700; color: var(--warn)" data-show-if="${H}.hasAlertsOpen">{${H}.alertsOpen}</span>
					<span style="font-size: 10px; font-weight: 700; color: var(--text2)" data-show-if="!${H}.hasAlertsOpen">{${H}.alertsOpen}</span>
					<span style="margin-left: 2px; font-size: 10px; color: var(--text2)">al</span>
				</div>
			</div>`;

export const DEFAULT_WIDGET_HTML = `
<!-- Colours: the tokens (var(--name) anywhere below), per system mode. #rrggbbaa: the last pair is the alpha.
     r0, rg1–rg3, rb1–rb3, rnone: the release garden's days (none, prod 1 / 2–3 / 4+, dev 1 / 2–3 / 4+, transparent);
     chip: an all-games widget's game chips; bad / warn: its health (errors up, alerts). -->
<widget-tokens mode="day" style="
	--bg: #ffffffef; --text: #17171b; --text2: #62606a; --brand: #fb7a32; --up: #1f8a4c; --down: #c93c3c;
	--divider: #0000001f; --unitTime: #e2700f; --unitPercent: #1f6fd1; --unitRobux: #1f8a4c;
	--r0: #ebedf0; --rg1: #9be9a8; --rg2: #40c463; --rg3: #216e39; --rb1: #b3d1fa; --rb2: #4a8fe0; --rb3: #1d5cb3; --rnone: #0000;
	--chip: #ececf0; --bad: #d64545; --warn: #c77c12">
</widget-tokens>
<widget-tokens mode="night" style="
	--bg: #1c1c20; --text: #f2f0f5; --text2: #a7a3ad; --brand: #fb7a32; --up: #4cc27a; --down: #ef6b6b;
	--divider: #ffffff33; --unitTime: #fb923c; --unitPercent: #5aa9ff; --unitRobux: #4cc27a;
	--r0: #2b2b31; --rg1: #1f6f45; --rg2: #2fa463; --rg3: #4cc27a; --rb1: #24508a; --rb2: #3a7fd0; --rb3: #5aa9ff; --rnone: #0000;
	--chip: #2b2b31; --bad: #ef6b6b; --warn: #f0a03a">
</widget-tokens>
<widget-strings refreshing="refreshing…" offline="offline · {updated}"></widget-strings>
<!-- Retention as 34.25 % and its change as ▲1.12 points. -->
<widget-format ratio-decimals="2"></widget-format>

<!-- 4x2 and up: the CCU and its 6-hour line left, the four stats right. Releases style: 14 weeks (7 rows × 14 columns,
     GitHub order), the counts (the whole history) and the last prod release beside. All games (no title row): 8 weeks
     (14 dp cells) with today ringed by the games' health, beside: the game chips (tap: one game) and ↻, errors / servers /
     open alerts, the 3 latest alerts, the totals; without health (an older backend): the last prod instead. -->
<widget state="data" name="medium" min-width="240" min-height="120" refresh="topEnd">
	<div style="padding: 4px 6px 10px 14px">
		<div style="display: flex; align-items: center" data-show-if="!allGames">
			<img src="{game.iconUrl}" style="width: 22px; height: 22px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="flex: 1; margin-top: 4px; padding-right: 8px" data-show-if="slot.1">
		<div style="display: flex; flex: 1; align-items: stretch">
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
			<div style="flex: 1.15; justify-content: center; gap: 6px; margin-left: 12px">
				<div style="display: flex; align-items: baseline" data-show-if="slot.1">
					<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{slot.1.label}</span>
					<span style="width: 34px; margin-left: 2px; font-size: 9.5px; font-weight: 700; text-align: right" data-show-if="slot.1.delta">{slot.1.delta}</span>
					<span style="margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--text)">{slot.1.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.2">
					<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{slot.2.label}</span>
					<span style="width: 34px; margin-left: 2px; font-size: 9.5px; font-weight: 700; text-align: right" data-show-if="slot.2.delta">{slot.2.delta}</span>
					<span style="margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--text)">{slot.2.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.3">
					<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{slot.3.label}</span>
					<span style="width: 34px; margin-left: 2px; font-size: 9.5px; font-weight: 700; text-align: right" data-show-if="slot.3.delta">{slot.3.delta}</span>
					<span style="margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--text)">{slot.3.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.4">
					<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{slot.4.label}</span>
					<span style="width: 34px; margin-left: 2px; font-size: 9.5px; font-weight: 700; text-align: right" data-show-if="slot.4.delta">{slot.4.delta}</span>
					<span style="margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--text)">{slot.4.value}</span>
				</div>
			</div>
		</div>
		${HEALTH_LINE}
		</div>
		<div style="flex: 1; margin-top: 6px; padding-right: 8px" data-show-if="!slot.1">
			<div style="flex: 1" data-show-if="!allGames">
				<div style="display: flex; flex: 1; align-items: stretch" data-show-if="${HAS_RELEASES}">
					${garden(14, "flex: 1")}
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
			<div style="display: flex; flex: 1; align-items: center; margin-top: 2px; padding-right: 4px" data-show-if="allGames">
				${garden(8, "width: 132px; height: 114px", "health.todayRing").replace("<svg ", `<svg data-show-if="${HAS_RELEASES}" `)}
				<div style="flex: 1; align-self: stretch; margin-left: 12px">
					<div style="display: flex; align-items: center">
						${chips(6, false, "flex: 1", 28).replace(' data-show-if="allGames"', "")}
						<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)" data-tap="refresh"></tt-icon>
					</div>
					<div style="margin-top: 6px; gap: 5px" data-show-if="health.todayRing">
						<div style="display: flex; align-items: baseline">
							<span style="font-size: 11px; font-weight: 700; color: var(--bad)" data-show-if="health.errorsHigh">{health.errors1h}{health.errorsArrow}</span>
							<span style="font-size: 11px; font-weight: 700; color: var(--text)" data-show-if="!health.errorsHigh">{health.errors1h}</span>
							<span style="margin-left: 3px; font-size: 11px; color: var(--text2)">err 1h</span>
							<span style="margin-left: 10px; font-size: 11px; font-weight: 700; color: var(--up)" data-show-if="health.serversAllOk">{health.serversOk}</span>
							<span style="margin-left: 10px; font-size: 11px; font-weight: 700; color: var(--warn)" data-show-if="!health.serversAllOk">{health.serversOk}</span>
							<span style="font-size: 11px; color: var(--text2)">/{health.servers} srv</span>
							<span style="margin-left: 10px; font-size: 11px; font-weight: 700; color: var(--warn)" data-show-if="health.hasAlertsOpen">{health.alertsOpen}</span>
							<span style="margin-left: 10px; font-size: 11px; font-weight: 700; color: var(--text)" data-show-if="!health.hasAlertsOpen">{health.alertsOpen}</span>
							<span style="margin-left: 3px; font-size: 11px; color: var(--text2)">alerts</span>
						</div>
						<div style="display: flex; align-items: center" data-show-if="health.alerts.0.text">
							<svg viewBox="0 0 8 8" style="width: 8px; height: 8px; margin-right: 6px"><circle cx='4' cy='4' r='4' fill='var(--{health.alerts.0.dot|text2})'/></svg>
							<span style="flex: 1; font-size: 10.5px; color: var(--text)">{health.alerts.0.text}</span>
							<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{health.alerts.0.age}</span>
						</div>
						<div style="display: flex; align-items: center" data-show-if="health.alerts.1.text">
							<svg viewBox="0 0 8 8" style="width: 8px; height: 8px; margin-right: 6px"><circle cx='4' cy='4' r='4' fill='var(--{health.alerts.1.dot|text2})'/></svg>
							<span style="flex: 1; font-size: 10.5px; color: var(--text)">{health.alerts.1.text}</span>
							<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{health.alerts.1.age}</span>
						</div>
						<div style="display: flex; align-items: center" data-show-if="health.alerts.2.text">
							<svg viewBox="0 0 8 8" style="width: 8px; height: 8px; margin-right: 6px"><circle cx='4' cy='4' r='4' fill='var(--{health.alerts.2.dot|text2})'/></svg>
							<span style="flex: 1; font-size: 10.5px; color: var(--text)">{health.alerts.2.text}</span>
							<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{health.alerts.2.age}</span>
						</div>
						<span style="font-size: 10.5px; color: var(--text2)" data-show-if="!health.alerts.0.text">No alerts in 24 h</span>
					</div>
					<div style="margin-top: 6px" data-show-if="!health.todayRing">
						<span style="font-size: 10.5px; color: var(--text2)">last prod {${R}.lastProd|none}</span>
						<span style="font-size: 10px; color: var(--text2)" data-show-if="${R}.lastProdGame">{${R}.lastProdGame}</span>
					</div>
					<div style="flex: 1"></div>
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 13px; font-weight: 700; color: var(--rg3)">{${R}.prod|0}</span>
						<span style="margin-left: 4px; font-size: 11px; color: var(--text2)">prod</span>
						<span style="margin-left: 10px; font-size: 13px; font-weight: 700; color: var(--rb3)">{${R}.dev|0}</span>
						<span style="margin-left: 4px; font-size: 11px; color: var(--text2)">dev</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</widget>

<!-- 2x2: the CCU, then a 2x2 grid of the stats at the bottom. Releases style: 11 weeks (7 × 11), the 30-day counts under; all games: chips of the first 4 games above. -->
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
				<div style="flex: 1" data-show-if="!${H}.on">
					<span style="margin-left: 4px; font-size: 10px; color: var(--text2)" data-show-if="servers">· {serversLabel}</span>
				</div>
			</div>
			${HEALTH_PILLS}
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
				${garden(11, "flex: 1; margin-bottom: 5px")}
				${counts30(13)}
			</div>
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- 4x1 (wide and short): the CCU left, the 6-hour line in the middle, the stats right. Releases style (no title row): the
     last 12 weeks at the full height, right-aligned next to a 168 dp column: all games: the game chips (tap: one game) and
     ↻, a line per game (its prod, dev, last prod), the totals; one game: icon, name and ↻, prod / dev, last prod. -->
<widget state="data" name="wide" min-width="240" min-height="60" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center" data-show-if="slot.1">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="display: flex; flex: 1; align-items: stretch; padding-right: 6px" data-show-if="slot.1">
			<div style="justify-content: center">
				<div style="display: flex; align-items: baseline">
					<span style="font-size: 24px; font-weight: 600; color: var(--text)">{ccu}</span>
					<span style="margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
				</div>
				${HEALTH_LINES}
			</div>
			<div style="flex: 1.15; margin: 2px 10px 0 10px">
				<tt-chart minutes="360" bucket="5" labels zero smooth dot fill style="flex: 1; margin-bottom: 1px; color: var(--brand)"></tt-chart>
				<div style="display: flex; align-items: center; margin-left: 18px; margin-bottom: 2px">
					<span style="font-size: 9px; color: var(--text2)">6h ago</span>
					<div style="flex: 1"></div>
					<span style="font-size: 9px; color: var(--text2)">3h ago</span>
					<div style="flex: 1"></div>
					<span style="font-size: 9px; color: var(--text2)">{updated|now}</span>
				</div>
			</div>
			<div style="flex: 1; justify-content: center; gap: 1px">
				<div style="display: flex; align-items: baseline" data-show-if="slot.1">
					<span style="flex: 1; font-size: 10px; color: var(--text2)">{slot.1.label}</span>
					<span style="width: 30px; margin-left: 2px; font-size: 9px; font-weight: 700; text-align: right" data-show-if="slot.1.delta">{slot.1.delta}</span>
					<span style="margin-left: 5px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.1.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.2">
					<span style="flex: 1; font-size: 10px; color: var(--text2)">{slot.2.label}</span>
					<span style="width: 30px; margin-left: 2px; font-size: 9px; font-weight: 700; text-align: right" data-show-if="slot.2.delta">{slot.2.delta}</span>
					<span style="margin-left: 5px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.2.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.3">
					<span style="flex: 1; font-size: 10px; color: var(--text2)">{slot.3.label}</span>
					<span style="width: 30px; margin-left: 2px; font-size: 9px; font-weight: 700; text-align: right" data-show-if="slot.3.delta">{slot.3.delta}</span>
					<span style="margin-left: 5px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.3.value}</span>
				</div>
				<div style="display: flex; align-items: baseline" data-show-if="slot.4">
					<span style="flex: 1; font-size: 10px; color: var(--text2)">{slot.4.label}</span>
					<span style="width: 30px; margin-left: 2px; font-size: 9px; font-weight: 700; text-align: right" data-show-if="slot.4.delta">{slot.4.delta}</span>
					<span style="margin-left: 5px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.4.value}</span>
				</div>
			</div>
		</div>
		<div style="display: flex; flex: 1; align-items: stretch; margin: 6px 8px 2px 0" data-show-if="!slot.1">
			${gardenRight(12, "flex: 1").replace("<svg ", `<svg data-show-if="${HAS_RELEASES}" `)}
			${GARDEN_LOADING}
			<div style="width: 168px; margin-left: 14px">
				<div style="flex: 1" data-show-if="allGames">
					<div style="display: flex; align-items: center">
						${chips(5, false, "flex: 1", 28).replace(' data-show-if="allGames"', "")}
						<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)" data-tap="refresh"></tt-icon>
					</div>
					<div style="flex: 1; justify-content: center; gap: 1px">
					<div style="display: flex; align-items: center" data-show-if="games.0.prod">
						<img src="{games.0.iconUrl}" style="width: 13px; height: 13px; border-radius: 7px; background: var(--chip); margin-right: 6px">
						<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{games.0.name}</span>
						<span style="margin-left: 4px; font-size: 10.5px; font-weight: 700; color: var(--rg3)">{games.0.prod}</span>
						<span style="margin-left: 5px; font-size: 10.5px; font-weight: 700; color: var(--rb3)">{games.0.dev}</span>
						<span style="width: 44px; font-size: 10px; color: var(--text2); text-align: right">{games.0.lastProd|—}</span>
					</div>
					<div style="display: flex; align-items: center" data-show-if="games.1.prod">
						<img src="{games.1.iconUrl}" style="width: 13px; height: 13px; border-radius: 7px; background: var(--chip); margin-right: 6px">
						<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{games.1.name}</span>
						<span style="margin-left: 4px; font-size: 10.5px; font-weight: 700; color: var(--rg3)">{games.1.prod}</span>
						<span style="margin-left: 5px; font-size: 10.5px; font-weight: 700; color: var(--rb3)">{games.1.dev}</span>
						<span style="width: 44px; font-size: 10px; color: var(--text2); text-align: right">{games.1.lastProd|—}</span>
					</div>
					<div style="display: flex; align-items: center" data-show-if="games.2.prod">
						<img src="{games.2.iconUrl}" style="width: 13px; height: 13px; border-radius: 7px; background: var(--chip); margin-right: 6px">
						<span style="flex: 1; font-size: 10.5px; color: var(--text2)">{games.2.name}</span>
						<span style="margin-left: 4px; font-size: 10.5px; font-weight: 700; color: var(--rg3)">{games.2.prod}</span>
						<span style="margin-left: 5px; font-size: 10.5px; font-weight: 700; color: var(--rb3)">{games.2.dev}</span>
						<span style="width: 44px; font-size: 10px; color: var(--text2); text-align: right">{games.2.lastProd|—}</span>
					</div>
					</div>
					<div style="display: flex; align-items: baseline">
						<span style="font-size: 16px; font-weight: 700; color: var(--rg3)">{${R}.prod|0}</span>
						<span style="margin-left: 4px; font-size: 12px; color: var(--text2)">prod</span>
						<span style="margin-left: 10px; font-size: 16px; font-weight: 700; color: var(--rb3)">{${R}.dev|0}</span>
						<span style="margin-left: 4px; font-size: 12px; color: var(--text2)">dev</span>
					</div>
				</div>
				<div style="flex: 1" data-show-if="!allGames">
					<div style="display: flex; align-items: center">
						<img src="{game.iconUrl}" style="width: 20px; height: 20px; border-radius: 6px; background: var(--divider); margin-right: 7px">
						<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text)">{game}</span>
						<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)" data-tap="refresh"></tt-icon>
					</div>
					<div style="display: flex; flex: 1; align-items: center">
						<span style="font-size: 16px; font-weight: 700; color: var(--rg3)">{${R}.prod|—}</span>
						<span style="margin-left: 4px; font-size: 12px; color: var(--text2)">prod</span>
						<span style="margin-left: 10px; font-size: 16px; font-weight: 700; color: var(--rb3)">{${R}.dev|—}</span>
						<span style="margin-left: 4px; font-size: 12px; color: var(--text2)">dev</span>
					</div>
					<div>
						<span style="font-size: 11px; color: var(--text2)">last prod {${R}.lastProd|none}</span>
						<span style="font-size: 10px; color: var(--text2)" data-show-if="${R}.lastProdLabel">{${R}.lastProdLabel}</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</widget>

<!-- 2x1 tall enough for four stats. Releases style: 24 weeks (7 × 24), the 30-day counts under. -->
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
			${HEALTH_SHORT}
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
					<div data-show-if="!${H}.on">
						<div style="display: flex; align-items: baseline" data-show-if="slot.4">
							<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.4.label}</span>
							<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.4.value:short}</span>
						</div>
					</div>
				</div>
			</div>
			<div style="flex: 1"></div>
		</div>
		<div style="flex: 1; margin-top: 2px; padding-right: 6px" data-show-if="!slot.1">
			<div style="flex: 1" data-show-if="${HAS_RELEASES}">
				${garden(24, "flex: 1; margin-bottom: 4px")}
				${counts30(12)}
			</div>
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- 2x1 from 72 dp: three stats. Releases style: 26 weeks (7 × 26), the 30-day counts in the header. -->
<widget state="data" name="small" min-width="100" min-height="72" refresh="topEnd">
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
			${HEALTH_SHORT}
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
					<div data-show-if="!${H}.on">
						<div style="display: flex; align-items: baseline" data-show-if="slot.3">
							<span style="flex: 1; font-size: 10px; color: var(--text2); text-align: right">{slot.3.label}</span>
							<span style="margin-left: 4px; font-size: 11px; font-weight: 600; color: var(--text)">{slot.3.value:short}</span>
						</div>
					</div>
				</div>
			</div>
			<div style="flex: 1"></div>
		</div>
		<div style="flex: 1; margin-top: 2px; padding-right: 6px" data-show-if="!slot.1">
			${garden(26, "flex: 1").replace("<svg ", `<svg data-show-if="${HAS_RELEASES}" `)}
			${GARDEN_LOADING}
		</div>
	</div>
</widget>

<!-- anything smaller: two stats. Releases style: 26 weeks (7 × 26), the 30-day counts in the header. -->
<widget state="data" name="tiny" min-width="0" min-height="0" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px" data-show-if="!allGames">
			${ALL_GAMES_TITLE}
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<div data-show-if="!${H}.on">
				<span style="margin-left: 6px; font-size: 10px; color: var(--text2)" data-show-if="slot.1">{status}</span>
			</div>
			<div data-show-if="slot.1">
				${HEALTH_SHORT.replace('style="height: 13px; margin-right: 6px"', 'style="width: 84px; height: 13px; margin-left: 6px"')}
			</div>
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
			${garden(26, "flex: 1").replace("<svg ", `<svg data-show-if="${HAS_RELEASES}" `)}
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
