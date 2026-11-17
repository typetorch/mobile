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
export const DEFAULT_WIDGET_HTML = `
<!-- Colours: the tokens (var(--name) anywhere below), per system mode. #rrggbbaa: the last pair is the alpha. -->
<widget-tokens mode="day" style="
	--bg: #ffffffef; --text: #17171b; --text2: #62606a; --brand: #fb7a32; --up: #1f8a4c; --down: #c93c3c;
	--divider: #0000001f; --unitTime: #e2700f; --unitPercent: #1f6fd1; --unitRobux: #1f8a4c">
</widget-tokens>
<widget-tokens mode="night" style="
	--bg: #1c1c20; --text: #f2f0f5; --text2: #a7a3ad; --brand: #fb7a32; --up: #4cc27a; --down: #ef6b6b;
	--divider: #ffffff33; --unitTime: #fb923c; --unitPercent: #5aa9ff; --unitRobux: #4cc27a">
</widget-tokens>
<widget-strings refreshing="refreshing…" offline="offline · {updated}"></widget-strings>
<!-- Retention as 34.25 % and its change as ▲1.12 points. -->
<widget-format ratio-decimals="2"></widget-format>

<!-- 4x2 and up: the CCU and its 6-hour line left, the four stats right. -->
<widget state="data" name="medium" min-width="240" min-height="120" refresh="topEnd">
	<div style="padding: 4px 6px 10px 14px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 22px; height: 22px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="display: flex; flex: 1; align-items: stretch; margin-top: 4px; padding-right: 8px">
			<div style="flex: 1">
				<div style="display: flex; align-items: baseline">
					<span style="font-size: 34px; font-weight: 600; color: var(--text)">{ccu}</span>
					<span style="margin-left: 4px; font-size: 13px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
				</div>
				<tt-chart minutes="360" bucket="5" labels zero smooth dot fill style="flex: 1; margin: 2px 0 3px; color: var(--brand)"></tt-chart>
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
	</div>
</widget>

<!-- 2x2: the CCU, then a 2x2 grid of the stats at the bottom. -->
<widget state="data" name="grid" min-width="100" min-height="115" refresh="topEnd">
	<div style="padding: 4px 6px 10px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 20px; height: 20px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
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
</widget>

<!-- 4x1 (wide and short): the CCU left, the 6-hour line in the middle, the stats right. -->
<widget state="data" name="wide" min-width="240" min-height="60" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
		<div style="display: flex; flex: 1; align-items: center; padding-right: 6px">
			<div style="display: flex; align-items: baseline">
				<span style="font-size: 24px; font-weight: 600; color: var(--text)">{ccu}</span>
				<span style="margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--delta)" data-show-if="delta">{delta}</span>
			</div>
			<tt-chart minutes="360" bucket="5" labels zero smooth dot fill style="flex: 1; height: 34px; margin: 0 10px; color: var(--brand)"></tt-chart>
			<div style="flex: 0.9; align-items: flex-end; gap: 1px">
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
	</div>
</widget>

<!-- 2x1 tall enough for four stats. -->
<widget state="data" name="small4" min-width="100" min-height="90" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
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
</widget>

<!-- 2x1 from 72 dp: three stats. -->
<widget state="data" name="small" min-width="100" min-height="72" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
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
</widget>

<!-- anything smaller: two stats. -->
<widget state="data" name="tiny" min-width="0" min-height="0" refresh="topEnd">
	<div style="padding: 4px 6px 8px 12px">
		<div style="display: flex; align-items: center">
			<img src="{game.iconUrl}" style="width: 18px; height: 18px; border-radius: 6px; background: var(--divider); margin-right: 7px">
			<span style="flex: 1; font-size: 12px; font-weight: 500; color: var(--text2)">{game}</span>
			<span style="margin-left: 6px; font-size: 10px; color: var(--text2)">{status}</span>
			<tt-icon name="refresh" style="width: 15px; height: 15px; padding: 4px; color: var(--text2)"></tt-icon>
		</div>
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
