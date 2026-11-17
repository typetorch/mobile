package dev.typetorch.live

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import androidx.core.content.ContextCompat
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** A drawn widget: the bitmap and the text TalkBack reads. */
internal class Rendered(val bitmap: Bitmap, val description: String)

/**
 * Draws a [SizeLayout] into one bitmap at the widget's size: a small flex layout (column / row / stack with weights,
 * gaps, padding, margins, alignment), texts with StaticLayout (coloured runs: units, deltas), the CCU line ([Chart]),
 * vector icons, pictures ([WidgetImages], from the disk only) and inline SVG ([Svg]). Everything is
 * measured in px at the bitmap's scale (the screen density unless the pixel budget caps it), so text stays crisp.
 * Throws on a broken spec; [WidgetUpdater] catches and falls back to the built-in default.
 */
internal object WidgetRenderer {
  /** px per dp at most (beyond 3x nobody sees the difference; the budget usually binds first). */
  private const val MAX_SCALE = 3f

  private class Sz(val w: Float, val h: Float, val baseline: Float = -1f)

  private class Pass(
    val ctx: Context,
    val s: Float,
    val fontScale: Float,
    val palette: Map<String, Int>,
    val values: WidgetValues,
    val texts: MutableList<String>,
  )

  fun isNight(ctx: Context): Boolean =
    (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  /** [layout] drawn at [wDp] x [hDp], at most [maxPixels] pixels (scaled down beyond; the ImageView scales it back up). */
  fun render(
    ctx: Context,
    spec: WidgetSpec,
    layout: SizeLayout,
    values: WidgetValues,
    night: Boolean,
    wDp: Float,
    hDp: Float,
    maxPixels: Int,
  ): Rendered {
    val density = ctx.resources.displayMetrics.density.takeIf { it > 0f } ?: 2f
    val area = max(1f, wDp * hDp)
    var s = min(density, MAX_SCALE)
    if (area * s * s > maxPixels) s = sqrt(maxPixels / area)
    s = s.coerceAtLeast(0.5f)
    val wPx = (wDp * s).roundToInt().coerceAtLeast(1)
    val hPx = (hDp * s).roundToInt().coerceAtLeast(1)
    val bmp = Bitmap.createBitmap(wPx, hPx, Bitmap.Config.ARGB_8888)
    try {
      Units.ratioDecimals = spec.ratioDecimals
      val c = Canvas(bmp)
      val fontScale = ctx.resources.configuration.fontScale.takeIf { it > 0f }?.coerceIn(0.8f, 1.3f) ?: 1f
      val r = Pass(ctx, s, fontScale, WidgetSpecs.palette(spec, night), values, ArrayList())
      fillBox(r, c, layout.background, 0f, 0f, wPx.toFloat(), hPx.toFloat())
      draw(r, c, layout.root, 0f, 0f, wPx.toFloat(), hPx.toFloat())
      val desc = layout.description?.let { values.template(it) }?.takeIf { it.isNotBlank() }
        ?: r.texts.joinToString(", ")
      return Rendered(bmp, desc)
    } catch (t: Throwable) {
      bmp.recycle()
      throw t
    }
  }

  // region visibility, colours

  private fun visible(r: Pass, n: Node): Boolean {
    val cond = n.showIf
    if (cond != null) {
      val neg = cond.startsWith("!")
      val key = if (neg) cond.substring(1) else cond
      if (r.values.has(key) == neg) return false
    }
    if (n.type == "text" && r.values.template(n.text).isEmpty()) return false
    return true
  }

  private fun visibleKids(r: Pass, n: Node): List<Node> = n.children.filter { visible(r, it) }

  private fun color(r: Pass, spec: String?, fallback: String): Int {
    val key = spec ?: fallback
    if (key == "delta") {
      val d = r.values.num("delta") ?: 0.0
      return r.palette[if (d < 0) "down" else "up"] ?: 0xFF888888.toInt()
    }
    return WidgetSpecs.parseColor(key)
      ?: r.palette[key]
      ?: WidgetSpecs.parseColor(fallback)
      ?: r.palette[fallback]
      ?: 0xFF888888.toInt()
  }

  private fun fillBox(r: Pass, c: Canvas, f: Fill, x: Float, y: Float, w: Float, h: Float) {
    if (w <= 0f || h <= 0f) return
    val color = color(r, f.color, "bg")
    if (color == 0) return
    val radiusDp = if (f.system) systemRadiusDp(r.ctx) else f.radius
    val rad = (radiusDp * r.s).coerceAtMost(min(w, h) / 2f)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    p.style = Paint.Style.FILL
    p.color = color
    if (rad > 0f) c.drawRoundRect(RectF(x, y, x + w, y + h), rad, rad, p) else c.drawRect(x, y, x + w, y + h, p)
  }

  /** The launcher's widget corner radius on Android 12+ (res/values-v31), 16 dp before. */
  private fun systemRadiusDp(ctx: Context): Float = try {
    val dm = ctx.resources.displayMetrics
    ctx.resources.getDimension(R.dimen.ttl_widget_radius) / (dm.density.takeIf { it > 0f } ?: 1f)
  } catch (t: Throwable) {
    16f
  }

  // endregion

  // region text

  private fun typeface(weight: Int): Typeface {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return Typeface.create(Typeface.DEFAULT, weight, false)
    return when {
      weight >= 600 -> Typeface.DEFAULT_BOLD
      weight >= 500 -> Typeface.create("sans-serif-medium", Typeface.NORMAL)
      else -> Typeface.DEFAULT
    }
  }

  private fun textPaint(r: Pass, n: Node): TextPaint {
    val p = TextPaint(Paint.ANTI_ALIAS_FLAG)
    p.textSize = (n.size * r.s * r.fontScale).coerceAtLeast(1f)
    p.typeface = typeface(n.fontWeight)
    p.color = color(r, n.color, "text")
    return p
  }

  private fun alignment(a: String?): Layout.Alignment = when (a) {
    "center" -> Layout.Alignment.ALIGN_CENTER
    "end" -> Layout.Alignment.ALIGN_OPPOSITE
    else -> Layout.Alignment.ALIGN_NORMAL
  }

  /** The filled template; coloured runs (units, deltas) become ForegroundColorSpans in their token's colour. */
  private fun richText(r: Pass, n: Node): CharSequence {
    val rich = r.values.rich(n.text)
    if (rich.spans.isEmpty() || rich.text.isEmpty()) return rich.text
    val out = SpannableString(rich.text)
    for (sp in rich.spans) {
      val start = sp.start.coerceIn(0, rich.text.length)
      val end = sp.end.coerceIn(start, rich.text.length)
      if (end > start) out.setSpan(ForegroundColorSpan(color(r, sp.color, "text")), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    return out
  }

  /** The text laid out at [exactW] px, or at its own width up to [maxW]. Null when empty or no room. */
  private fun textLayout(r: Pass, n: Node, maxW: Float, exactW: Float?): StaticLayout? {
    val str = richText(r, n)
    if (str.isEmpty()) return null
    val paint = textPaint(r, n)
    // Round, not truncate: box widths come back from float sums (100 - 0.00001 must stay 100, or "214" ellipsizes).
    val w = if (exactW != null) exactW.roundToInt() else min(ceil(Layout.getDesiredWidth(str, paint)), maxW).roundToInt()
    if (w <= 0) return null
    val b = StaticLayout.Builder.obtain(str, 0, str.length, paint, w)
      .setAlignment(alignment(n.align))
      .setIncludePad(false)
      .setMaxLines(n.maxLines)
    if (n.ellipsis) b.setEllipsize(TextUtils.TruncateAt.END)
    return b.build()
  }

  // endregion

  // region measure

  /** The outer size of [n] (margins included) within [maxW] x [maxH] px; [rowParent]: its parent lays out horizontally. */
  private fun measure(r: Pass, n: Node, maxW: Float, maxH: Float, rowParent: Boolean): Sz {
    val s = r.s
    val mW = n.margin.horizontal * s
    val mH = n.margin.vertical * s
    val pW = n.padding.horizontal * s
    val pH = n.padding.vertical * s
    val outerMaxW = max(0f, maxW - mW)
    val outerMaxH = max(0f, maxH - mH)
    val fixedW = n.width?.let { min(it * s, outerMaxW) }
    val fixedH = n.height?.let { min(it * s, outerMaxH) }
    val cMaxW = max(0f, (fixedW ?: outerMaxW) - pW)
    val cMaxH = max(0f, (fixedH ?: outerMaxH) - pH)
    var baseline = -1f
    val content: Sz = when (n.type) {
      "text" -> {
        val l = textLayout(r, n, cMaxW, null)
        if (l == null) Sz(0f, 0f) else {
          baseline = l.getLineBaseline(0).toFloat()
          Sz(l.width.toFloat(), l.height.toFloat())
        }
      }
      "icon", "image" -> {
        val d = n.size * s
        Sz(min(d, cMaxW), min(d, cMaxH))
      }
      "chart", "svg" -> Sz(cMaxW, 0f)
      "spacer" -> if (rowParent) Sz(n.size * s, 0f) else Sz(0f, n.size * s)
      "divider" -> if (rowParent) Sz(n.thickness * s, 0f) else Sz(cMaxW, n.thickness * s)
      "column" -> measureLinear(r, n, cMaxW, cMaxH, vertical = true)
      "row" -> measureLinear(r, n, cMaxW, cMaxH, vertical = false)
      "stack" -> {
        var w = 0f
        var h = 0f
        for (k in visibleKids(r, n)) {
          val sz = measure(r, k, cMaxW, cMaxH, false)
          w = max(w, sz.w)
          h = max(h, sz.h)
        }
        Sz(w, h)
      }
      else -> Sz(0f, 0f)
    }
    val w = fixedW ?: min(content.w + pW, outerMaxW)
    val h = fixedH ?: min(content.h + pH, outerMaxH)
    val outBase = if (baseline >= 0f) baseline + (n.margin.top + n.padding.top) * s else -1f
    return Sz(w + mW, h + mH, outBase)
  }

  private fun measureLinear(r: Pass, n: Node, cMaxW: Float, cMaxH: Float, vertical: Boolean): Sz {
    val kids = visibleKids(r, n)
    if (kids.isEmpty()) return Sz(0f, 0f)
    val sizes = measureKids(r, kids, n.gap * r.s, cMaxW, cMaxH, vertical, null)
    var main = n.gap * r.s * (kids.size - 1)
    var cross = 0f
    for (sz in sizes) {
      main += if (vertical) sz.h else sz.w
      cross = max(cross, if (vertical) sz.w else sz.h)
    }
    if (!vertical && n.align == "baseline") cross = max(cross, baselineSpan(kids, sizes))
    return if (vertical) Sz(cross, main) else Sz(main, cross)
  }

  /**
   * Sizes of [kids] along a row/column: fixed children first (each gets what is left), then the weighted ones —
   * their intrinsic size when [mainSize] is null (measuring), else their share of the leftover (laying out).
   */
  private fun measureKids(
    r: Pass, kids: List<Node>, gap: Float, cw: Float, ch: Float, vertical: Boolean, mainSize: Float?,
  ): Array<Sz> {
    val out = arrayOfNulls<Sz>(kids.size)
    val avail = if (vertical) ch else cw
    var used = gap * (kids.size - 1)
    for ((i, k) in kids.withIndex()) {
      if (k.weight > 0f) continue
      val left = max(0f, avail - used)
      val sz = if (vertical) measure(r, k, cw, left, false) else measure(r, k, left, ch, true)
      out[i] = sz
      used += if (vertical) sz.h else sz.w
    }
    val weightSum = kids.sumOf { it.weight.toDouble() }.toFloat()
    val leftover = max(0f, (mainSize ?: avail) - used)
    for ((i, k) in kids.withIndex()) {
      if (k.weight <= 0f) continue
      if (mainSize == null) {
        val left = max(0f, avail - used)
        val sz = if (vertical) measure(r, k, cw, left, false) else measure(r, k, left, ch, true)
        out[i] = sz
        used += if (vertical) sz.h else sz.w
      } else {
        val share = if (weightSum > 0f) leftover * k.weight / weightSum else 0f
        val sz = if (vertical) measure(r, k, cw, share, false) else measure(r, k, share, ch, true)
        // The main size is the share (like a 0dp + weight child), the cross size what it measured at that size.
        out[i] = if (vertical) Sz(sz.w, share, sz.baseline) else Sz(share, sz.h, sz.baseline)
      }
    }
    return Array(kids.size) { out[it] ?: Sz(0f, 0f) }
  }

  /** The height a baseline-aligned row needs: the tallest ascent plus the deepest descent (others: their height). */
  private fun baselineSpan(kids: List<Node>, sizes: Array<Sz>): Float {
    var asc = 0f
    var desc = 0f
    var other = 0f
    for (i in kids.indices) {
      val sz = sizes[i]
      if (sz.baseline >= 0f) {
        asc = max(asc, sz.baseline)
        desc = max(desc, sz.h - sz.baseline)
      } else {
        other = max(other, sz.h)
      }
    }
    return max(asc + desc, other)
  }

  // endregion

  // region draw

  /** Draws [n] in the outer box [x], [y], [w], [h] (px, margins included). */
  private fun draw(r: Pass, c: Canvas, n: Node, x: Float, y: Float, w: Float, h: Float) {
    if (w <= 0f || h <= 0f) return
    val s = r.s
    val ix = x + n.margin.start * s
    val iy = y + n.margin.top * s
    var iw = w - n.margin.horizontal * s
    var ih = h - n.margin.vertical * s
    n.width?.let { iw = min(iw, it * s) }
    n.height?.let { ih = min(ih, it * s) }
    if (iw <= 0f || ih <= 0f) return
    n.background?.let { fillBox(r, c, it, ix, iy, iw, ih) }
    val cx = ix + n.padding.start * s
    val cy = iy + n.padding.top * s
    val cw = iw - n.padding.horizontal * s
    val ch = ih - n.padding.vertical * s
    if (cw <= 0f || ch <= 0f) return
    val save = c.save()
    try {
      c.clipRect(ix, iy, ix + iw, iy + ih)
      when (n.type) {
        "text" -> drawText(r, c, n, cx, cy, cw)
        "icon" -> drawIcon(r, c, n, cx, cy, cw, ch)
        "image" -> drawImage(r, c, n, cx, cy, cw, ch)
        "chart" -> drawChart(r, c, n, cx, cy, cw, ch)
        "svg" -> Svg.draw(r.ctx, c, n.svg, n.fit, r.values, r.palette, cx, cy, cw, ch, r.s, r.texts)
        "divider" -> {
          val p = Paint()
          p.style = Paint.Style.FILL
          p.color = color(r, n.color, "divider")
          c.drawRect(cx, cy, cx + cw, cy + ch, p)
        }
        "column" -> drawLinear(r, c, n, cx, cy, cw, ch, vertical = true)
        "row" -> drawLinear(r, c, n, cx, cy, cw, ch, vertical = false)
        "stack" -> drawStack(r, c, n, cx, cy, cw, ch)
        else -> Unit // spacer, unknown types
      }
    } finally {
      c.restoreToCount(save)
    }
  }

  private fun drawText(r: Pass, c: Canvas, n: Node, x: Float, y: Float, w: Float) {
    val l = textLayout(r, n, w, w) ?: return
    val save = c.save()
    try {
      c.translate(x, y)
      l.draw(c)
    } finally {
      c.restoreToCount(save)
    }
    r.texts.add(l.text.toString())
  }

  private fun drawIcon(r: Pass, c: Canvas, n: Node, x: Float, y: Float, w: Float, h: Float) {
    val res = when (n.icon) {
      "flame" -> R.drawable.ttl_ic_flame
      "refresh" -> R.drawable.ttl_ic_refresh
      "people" -> R.drawable.ttl_ic_people
      "server" -> R.drawable.ttl_ic_server
      "clock" -> R.drawable.ttl_ic_clock
      else -> return
    }
    val d = ContextCompat.getDrawable(r.ctx, res)?.mutate() ?: return
    val size = min(n.size * r.s, min(w, h))
    if (size < 1f) return
    val left = (x + (w - size) / 2f).roundToInt()
    val top = (y + (h - size) / 2f).roundToInt()
    val px = size.roundToInt()
    d.setBounds(left, top, left + px, top + px)
    d.setTint(color(r, n.color, "text2"))
    d.draw(c)
  }

  /**
   * A picture by URL (the binding [Node.bind], e.g. the game's icon), centre-cropped into a [Node.size] square (or the
   * element's width x height) with rounded corners; the placeholder colour while it isn't downloaded yet.
   */
  private fun drawImage(r: Pass, c: Canvas, n: Node, x: Float, y: Float, w: Float, h: Float) {
    val dw = if (n.width != null) w else min(n.size * r.s, w)
    val dh = if (n.height != null) h else min(n.size * r.s, h)
    val wPx = dw.roundToInt()
    val hPx = dh.roundToInt()
    if (wPx < 1 || hPx < 1) return
    val left = (x + (w - dw) / 2f).roundToInt().toFloat()
    val top = (y + (h - dh) / 2f).roundToInt().toFloat()
    val rect = RectF(left, top, left + wPx, top + hPx)
    val rad = (n.radius * r.s).coerceAtMost(min(wPx, hPx) / 2f)
    val url = n.bind?.let { r.values.str(it) }
    val bmp = url?.let { WidgetImages.load(r.ctx, it, wPx, hPx) }
    val p = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    if (bmp != null) {
      val shader = BitmapShader(bmp, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
      val m = Matrix()
      m.setTranslate(left, top)
      shader.setLocalMatrix(m)
      p.shader = shader
    } else {
      val ph = n.placeholder ?: return
      p.color = color(r, ph, "divider")
      if (p.color == 0) return
    }
    if (rad > 0f) c.drawRoundRect(rect, rad, rad, p) else c.drawRect(rect, p)
  }

  private fun drawChart(r: Pass, c: Canvas, n: Node, x: Float, y: Float, w: Float, h: Float) {
    // Averaged per bucket (a per-minute line is mostly noise at small player counts); each at its newest time.
    val points = Chart.window(r.values.series, n.minutes, n.bucket)
    if (points.isEmpty()) return
    val line = color(r, n.color, "brand")
    val fill = when (val f = n.fill) {
      null -> null
      "auto" -> (line and 0x00FFFFFF) or 0x55000000
      else -> color(r, f, "brand")
    }
    val labelColor = color(r, "text2", "text2")
    Chart.drawInto(c, points, x, y, w, h, r.s, line, fill, n.dot, n.stroke, Chart.Options(n.zero, n.smooth, n.labels, labelColor, r.fontScale))
  }

  private fun drawLinear(r: Pass, c: Canvas, n: Node, x: Float, y: Float, w: Float, h: Float, vertical: Boolean) {
    val kids = visibleKids(r, n)
    if (kids.isEmpty()) return
    val gap = n.gap * r.s
    val mainBox = if (vertical) h else w
    val crossBox = if (vertical) w else h
    val sizes = measureKids(r, kids, gap, w, h, vertical, mainBox)
    var used = gap * (kids.size - 1)
    for (sz in sizes) used += if (vertical) sz.h else sz.w
    val hasWeight = kids.any { it.weight > 0f }
    val free = max(0f, mainBox - used)
    var pos = 0f
    var extraGap = 0f
    if (!hasWeight) {
      when (n.justify) {
        "center" -> pos = free / 2f
        "end" -> pos = free
        "spaceBetween" -> {
          if (kids.size > 1) extraGap = free / (kids.size - 1)
        }
      }
    }
    val defaultAlign = n.align ?: if (vertical) "stretch" else "center"
    val baselineRow = !vertical && defaultAlign == "baseline"
    var maxAsc = 0f
    var groupTop = 0f
    if (baselineRow) {
      maxAsc = sizes.filter { it.baseline >= 0f }.maxOfOrNull { it.baseline } ?: 0f
      groupTop = max(0f, (crossBox - baselineSpan(kids, sizes)) / 2f)
    }
    for ((i, k) in kids.withIndex()) {
      val sz = sizes[i]
      val main = if (vertical) sz.h else sz.w
      val measuredCross = if (vertical) sz.w else sz.h
      val a = k.alignSelf ?: defaultAlign
      val stretch = a == "stretch" || k.type == "divider"
      val crossSize = if (stretch) crossBox else min(measuredCross, crossBox)
      val crossPos = when {
        stretch -> 0f
        baselineRow && k.alignSelf == null && sz.baseline >= 0f -> groupTop + maxAsc - sz.baseline
        a == "start" -> 0f
        a == "end" -> crossBox - crossSize
        else -> (crossBox - crossSize) / 2f
      }
      if (vertical) draw(r, c, k, x + crossPos, y + pos, crossSize, main)
      else draw(r, c, k, x + pos, y + crossPos, main, crossSize)
      pos += main + gap + extraGap
    }
  }

  private fun drawStack(r: Pass, c: Canvas, n: Node, x: Float, y: Float, w: Float, h: Float) {
    for (k in visibleKids(r, n)) {
      val g = k.gravity ?: "topStart"
      if (g == "fill" || k.alignSelf == "stretch") {
        draw(r, c, k, x, y, w, h)
        continue
      }
      val sz = measure(r, k, w, h, false)
      val cw = min(sz.w, w)
      val ch = min(sz.h, h)
      val dx = when {
        g == "start" || g.endsWith("Start") -> 0f
        g == "end" || g.endsWith("End") -> w - cw
        else -> (w - cw) / 2f
      }
      val dy = when {
        g.startsWith("top") -> 0f
        g.startsWith("bottom") -> h - ch
        else -> (h - ch) / 2f
      }
      draw(r, c, k, x + dx, y + dy, cw, ch)
    }
  }

  // endregion
}
