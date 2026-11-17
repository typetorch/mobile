package dev.typetorch.live

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.util.Xml
import androidx.core.graphics.PathParser
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * The widget spec's `svg` element (docs/WIDGET_SPEC.md): a markup template filled per draw ([WidgetValues.markup]:
 * values XML-escaped, plus `{w}`, `{h}` and the `{chart.*}` helpers), parsed with the platform's XmlPullParser into a
 * small tree and drawn with Canvas onto the element's box (viewBox mapped by `fit`). A subset of SVG 1.1 (see the
 * doc); anything else is skipped. Never throws: a broken template draws nothing (or what was drawn before the error),
 * each problem is logged once.
 */
internal object Svg {
  /** Longest template the spec may hold (longer: the element draws nothing). */
  const val MAX_TEMPLATE_CHARS = 64_000

  /** Longest filled markup (values and chart paths included). */
  private const val MAX_FILLED_CHARS = 200_000

  /** Elements and text runs parsed at most; the rest is dropped. */
  private const val MAX_NODES = 2_000

  /** Nesting kept at most (deeper elements are dropped; `use` references count too). */
  private const val MAX_DEPTH = 32

  /** Elements drawn at most per svg element (`use` can repeat parts). */
  private const val MAX_DRAWN = 4_000

  private const val MAX_IMAGES = 8

  // region logging

  private val logged: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

  /** Each kind of problem once per process (a widget redraws often; logcat stays readable). */
  private fun logOnce(what: String, t: Throwable? = null) {
    try {
      if (logged.size < 64 && logged.add(what)) Log.w("svg: $what", t)
    } catch (ignored: Throwable) {
    }
  }

  // endregion

  // region template

  /** [template] filled for a box of [wDp] x [hDp]: the bindings (XML-escaped), `{w}`, `{h}` and `{chart.*}`. */
  fun fill(template: String, values: WidgetValues, wDp: Float, hDp: Float): String {
    if (template.isEmpty()) return ""
    val boxed = sizes(template, wDp, hDp)
    return values.markup(boxed) { name -> own(name, values, wDp, hDp) }
  }

  /**
   * `{w}` and `{h}` replaced up front, so they also work inside another placeholder's arguments
   * (`{chart.path:{w},{h}}`). `{{w}}` (literal braces) is left alone.
   */
  private fun sizes(t: String, wDp: Float, hDp: Float): String {
    if (!t.contains("{w}") && !t.contains("{h}")) return t
    val sb = StringBuilder(t.length + 16)
    var i = 0
    while (i < t.length) {
      if (t[i] == '{' && i + 2 < t.length && t[i + 2] == '}' && (t[i + 1] == 'w' || t[i + 1] == 'h') &&
        (i == 0 || t[i - 1] != '{')
      ) {
        sb.append(Svg.n2(if (t[i + 1] == 'w') wDp else hDp))
        i += 3
        continue
      }
      sb.append(t[i])
      i++
    }
    return sb.toString()
  }

  /** The names only the svg element knows; null for every other name (a binding). "" = known but missing. */
  private fun own(name: String, values: WidgetValues, wDp: Float, hDp: Float): String? {
    if (name == "w") return n2(wDp)
    if (name == "h") return n2(hDp)
    if (!name.startsWith("chart.")) return null
    val colon = name.indexOf(':')
    val fn = if (colon >= 0) name.substring(6, colon).trim() else name.substring(6).trim()
    val args = if (colon >= 0) name.substring(colon + 1) else ""
    return try {
      chart(fn, args, values, wDp, hDp)
    } catch (t: Throwable) {
      logOnce("chart helper failed", t)
      ""
    }
  }

  /** The SVG path data sink of [Chart.trace]. */
  private class DataSink(val sb: StringBuilder) : Chart.Sink {
    override fun move(x: Float, y: Float) {
      sb.append('M').append(Svg.n2(x)).append(',').append(Svg.n2(y))
    }

    override fun line(x: Float, y: Float) {
      sb.append('L').append(Svg.n2(x)).append(',').append(Svg.n2(y))
    }

    override fun quad(cx: Float, cy: Float, x: Float, y: Float) {
      sb.append('Q').append(Svg.n2(cx)).append(',').append(Svg.n2(cy)).append(' ').append(Svg.n2(x)).append(',').append(Svg.n2(y))
    }
  }

  /**
   * `{chart.<fn>:W,H,minutes,bucket,zero,smooth}`: the CCU line in a W x H box (W / H a number, `w` / `h` or empty:
   * the element's box), the same window, buckets, axis and smoothing as the chart element. "" without points.
   */
  private fun chart(fn: String, args: String, values: WidgetValues, wDp: Float, hDp: Float): String? {
    val a = args.split(',').map { it.trim() }
    fun arg(i: Int): String? = a.getOrNull(i)?.takeIf { it.isNotEmpty() }
    fun dim(s: String?, box: Float): Float = when (s) {
      "w" -> wDp
      "h" -> hDp
      else -> s?.toFloatOrNull()?.takeIf { it.isFinite() } ?: box
    }
    fun flag(s: String?, def: Boolean): Boolean = when (s?.lowercase()) {
      null -> def
      "0", "false", "no", "off" -> false
      else -> true
    }
    val known = fn == "path" || fn == "area" || fn == "max" || fn == "mid" || fn == "min" || fn == "lastX" || fn == "lastY"
    if (!known) {
      logOnce("unknown helper chart.$fn")
      return ""
    }
    val w = dim(arg(0), wDp).coerceIn(0f, 100_000f)
    val h = dim(arg(1), hDp).coerceIn(0f, 100_000f)
    val minutes = (arg(2)?.toFloatOrNull()?.takeIf { it.isFinite() }?.toInt() ?: 360).coerceIn(1, 360)
    val bucket = (arg(3)?.toFloatOrNull()?.takeIf { it.isFinite() }?.toInt() ?: 5).coerceIn(0, 60)
    val zero = flag(arg(4), true)
    val smooth = flag(arg(5), true)
    val points = Chart.window(values.series, minutes, bucket)
    if (points.isEmpty()) return ""
    val b = Chart.bounds(points, zero)
    val lo = b[0]
    val hi = b[1]
    when (fn) {
      "max" -> return Chart.label(hi)
      "mid" -> return Chart.label((lo + hi) / 2f)
      "min" -> return Chart.label(lo)
    }
    val t0 = points.first().t
    val span = (points.last().t - t0).toFloat()
    val xs = FloatArray(points.size)
    val ys = FloatArray(points.size)
    val range = if (hi - lo > 0f) hi - lo else 1f
    for (i in points.indices) {
      val f = when {
        span > 0f -> (points[i].t - t0) / span
        points.size > 1 -> i / (points.size - 1f)
        else -> 1f
      }
      xs[i] = f * w
      ys[i] = (1f - (points[i].ccu - lo) / range) * h
    }
    val last = points.size - 1
    when (fn) {
      "lastX" -> return n2(xs[last])
      "lastY" -> return n2(ys[last])
    }
    val sb = StringBuilder(points.size * 24 + 32)
    val sink = DataSink(sb)
    val startX: Float
    if (points.size == 1) {
      // One point: a flat line across, like the chart element.
      sink.move(0f, ys[0])
      sink.line(w, ys[0])
      startX = 0f
    } else {
      Chart.trace(xs, ys, smooth, sink)
      startX = xs[0]
    }
    if (fn == "area") {
      sink.line(if (points.size == 1) w else xs[last], h)
      sink.line(startX, h)
      sb.append('Z')
    }
    return sb.toString()
  }

  /** A number for markup: at most 2 decimals, no exponent, no grouping (12, 12.5, -0.25). */
  private fun n2(v: Float): String {
    if (!v.isFinite()) return "0"
    val r = (v * 100f).roundToLong()
    val a = abs(r)
    val sb = StringBuilder(12)
    if (r < 0) sb.append('-')
    sb.append(a / 100)
    val frac = (a % 100).toInt()
    if (frac != 0) {
      sb.append('.')
      if (frac % 10 == 0) sb.append(frac / 10) else {
        if (frac < 10) sb.append('0')
        sb.append(frac)
      }
    }
    return sb.toString()
  }

  // endregion

  // region parsing

  /** One element (or, named "#text", a text node inside `text` / `tspan`). Attributes include the `style` ones. */
  private class El(val name: String, val attrs: Map<String, String>, val text: String?) {
    val kids = ArrayList<El>(0)
  }

  /** [xml] as a tree, or null when it has no element. Malformed markup: what was read before the error. */
  private fun parse(xml: String): El? {
    if (xml.isBlank()) return null
    if (xml.contains("<!DOCTYPE", ignoreCase = true) || xml.contains("<!ENTITY", ignoreCase = true)) {
      logOnce("DOCTYPE / ENTITY is not supported: not drawn")
      return null
    }
    val p = Xml.newPullParser()
    try {
      p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
    } catch (ignored: Throwable) {
    }
    try {
      p.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false)
    } catch (ignored: Throwable) {
    }
    try {
      // KXmlParser's lenient mode: unknown entities (&nbsp;) and small slips don't end the parse.
      p.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true)
    } catch (ignored: Throwable) {
    }
    p.setInput(StringReader(xml))
    val stack = ArrayList<El>()
    var root: El? = null
    var count = 0
    var skip = 0
    while (true) {
      val ev = try {
        p.next()
      } catch (t: Throwable) {
        logOnce("markup error (drawn up to it)", t)
        break
      }
      when (ev) {
        XmlPullParser.END_DOCUMENT -> break
        XmlPullParser.START_TAG -> {
          if (skip > 0 || stack.size >= MAX_DEPTH || count >= MAX_NODES || (stack.isEmpty() && root != null)) {
            if (count >= MAX_NODES) logOnce("more than $MAX_NODES nodes: the rest dropped")
            skip++
            continue
          }
          val el = El(local(p.name ?: ""), attributes(p), null)
          count++
          if (stack.isEmpty()) root = el else stack[stack.size - 1].kids.add(el)
          stack.add(el)
        }
        XmlPullParser.END_TAG -> {
          if (skip > 0) skip-- else if (stack.isNotEmpty()) stack.removeAt(stack.size - 1)
        }
        XmlPullParser.TEXT -> {
          if (skip == 0 && stack.isNotEmpty() && count < MAX_NODES) {
            val parent = stack[stack.size - 1]
            val text = p.text
            if ((parent.name == "text" || parent.name == "tspan") && !text.isNullOrEmpty()) {
              parent.kids.add(El("#text", emptyMap(), text))
              count++
            }
          }
        }
      }
    }
    return root
  }

  /** `svg:rect` → `rect`. */
  private fun local(name: String): String {
    val i = name.indexOf(':')
    return if (i >= 0) name.substring(i + 1) else name
  }

  /** The attributes (`xlink:href` as `href`), then the `style` attribute's declarations over them. */
  private fun attributes(p: XmlPullParser): Map<String, String> {
    val n = p.attributeCount
    if (n <= 0) return emptyMap()
    val out = HashMap<String, String>(n * 2)
    for (i in 0 until n) {
      val raw = p.getAttributeName(i) ?: continue
      val v = p.getAttributeValue(i) ?: continue
      val key = if (raw.startsWith("xlink:")) raw.substring(6) else raw
      if (key == "href" && out.containsKey("href") && raw.startsWith("xlink:")) continue
      out[key] = v
    }
    val style = out["style"]
    if (style != null) {
      for (decl in style.split(';')) {
        val colon = decl.indexOf(':')
        if (colon <= 0) continue
        val k = decl.substring(0, colon).trim()
        val v = decl.substring(colon + 1).trim().removeSuffix("!important").trim()
        if (k.isNotEmpty() && v.isNotEmpty()) out[k] = v
      }
    }
    return out
  }

  // endregion

  // region values

  /** The numbers in [s] (separated by spaces, commas or signs: `10-5` is 10, -5), at most [max]. */
  private fun numbers(s: String?, max: Int = 20_000): FloatArray {
    if (s.isNullOrEmpty()) return FloatArray(0)
    val out = ArrayList<Float>()
    var i = 0
    val n = s.length
    while (i < n && out.size < max) {
      val ch = s[i]
      if (ch in '0'..'9' || ch == '.' || ch == '-' || ch == '+') {
        val end = numberEnd(s, i)
        if (end == i) {
          i++
          continue
        }
        s.substring(i, end).toFloatOrNull()?.takeIf { it.isFinite() }?.let { out.add(it) }
        i = end
      } else {
        i++
      }
    }
    val arr = FloatArray(out.size)
    for (k in out.indices) arr[k] = out[k]
    return arr
  }

  /** The end of the number starting at [start] in [s] ([start] when there is none). */
  private fun numberEnd(s: String, start: Int): Int {
    val n = s.length
    var j = start
    if (j < n && (s[j] == '+' || s[j] == '-')) j++
    var digits = false
    while (j < n && s[j] in '0'..'9') {
      j++
      digits = true
    }
    if (j < n && s[j] == '.') {
      j++
      while (j < n && s[j] in '0'..'9') {
        j++
        digits = true
      }
    }
    if (!digits) return start
    if (j < n && (s[j] == 'e' || s[j] == 'E')) {
      var k = j + 1
      if (k < n && (s[k] == '+' || s[k] == '-')) k++
      if (k < n && s[k] in '0'..'9') {
        while (k < n && s[k] in '0'..'9') k++
        j = k
      }
    }
    return j
  }

  /** A length: a number, `px`, `pt`, `em` (of [font]) or `%` (of [ref]); [def] when missing or unreadable. */
  private fun len(s: String?, ref: Float, def: Float, font: Float = 16f): Float {
    if (s == null) return def
    val t = s.trim()
    val end = numberEnd(t, 0)
    if (end == 0) return def
    val num = t.substring(0, end).toFloatOrNull()?.takeIf { it.isFinite() } ?: return def
    val v = when (t.substring(end).trim().lowercase()) {
      "%" -> num * ref / 100f
      "em" -> num * font
      "rem" -> num * 16f
      "pt" -> num * 4f / 3f
      else -> num // px, dp, unknown units
    }
    return if (v.isFinite()) v else def
  }

  /** The first of a list (`x="10 20"`): text positions per glyph are not supported. */
  private fun first(s: String?): String? {
    if (s == null) return null
    val t = s.trim()
    if (t.isEmpty()) return null
    var end = 0
    while (end < t.length && t[end] != ' ' && t[end] != ',' && t[end] != '\t' && t[end] != '\n') end++
    return t.substring(0, end)
  }

  /** 0..1 from a number or a percentage; null when unreadable. */
  private fun fraction(s: String?): Float? {
    if (s == null) return null
    val t = s.trim()
    val v = if (t.endsWith("%")) t.dropLast(1).trim().toFloatOrNull()?.div(100f) else t.toFloatOrNull()
    return v?.takeIf { it.isFinite() }?.coerceIn(0f, 1f)
  }

  private val TRANSFORM = Regex("([a-zA-Z]+)\\s*\\(([^)]*)\\)")

  /** `translate`, `scale`, `rotate`, `skewX`, `skewY`, `matrix` (applied right to left, as in SVG); null: none. */
  private fun transform(s: String?): Matrix? {
    if (s.isNullOrBlank()) return null
    val m = Matrix()
    var any = false
    for (mt in TRANSFORM.findAll(s)) {
      val a = numbers(mt.groupValues[2], 6)
      if (a.isEmpty()) continue
      when (mt.groupValues[1]) {
        "translate" -> {
          m.preTranslate(a[0], if (a.size > 1) a[1] else 0f)
          any = true
        }
        "scale" -> {
          m.preScale(a[0], if (a.size > 1) a[1] else a[0])
          any = true
        }
        "rotate" -> {
          if (a.size >= 3) m.preRotate(a[0], a[1], a[2]) else m.preRotate(a[0])
          any = true
        }
        "skewX" -> {
          m.preSkew(tan(Math.toRadians(a[0].toDouble())).toFloat(), 0f)
          any = true
        }
        "skewY" -> {
          m.preSkew(0f, tan(Math.toRadians(a[0].toDouble())).toFloat())
          any = true
        }
        "matrix" -> if (a.size >= 6) {
          val t = Matrix()
          t.setValues(floatArrayOf(a[0], a[2], a[4], a[1], a[3], a[5], 0f, 0f, 1f))
          m.preConcat(t)
          any = true
        }
      }
    }
    return if (any) m else null
  }

  /** `url(#id)` (or `url('#id') fallback`) → `id`. */
  private fun urlId(s: String?): String? {
    if (s == null) return null
    val t = s.trim()
    if (!t.startsWith("url(")) return null
    val close = t.indexOf(')')
    if (close < 0) return null
    val inner = t.substring(4, close).trim().trim('\'', '"').trim()
    return if (inner.startsWith("#") && inner.length > 1) inner.substring(1) else null
  }

  private val NAMED = mapOf(
    "black" to 0xFF000000.toInt(),
    "white" to 0xFFFFFFFF.toInt(),
    "red" to 0xFFFF0000.toInt(),
    "green" to 0xFF008000.toInt(),
    "lime" to 0xFF00FF00.toInt(),
    "blue" to 0xFF0000FF.toInt(),
    "yellow" to 0xFFFFFF00.toInt(),
    "orange" to 0xFFFFA500.toInt(),
    "purple" to 0xFF800080.toInt(),
    "gray" to 0xFF808080.toInt(),
    "grey" to 0xFF808080.toInt(),
    "silver" to 0xFFC0C0C0.toInt(),
    "navy" to 0xFF000080.toInt(),
    "teal" to 0xFF008080.toInt(),
    "transparent" to 0,
  )

  /**
   * A colour: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (CSS order: alpha last), `rgb()`, `rgba()`, a few names,
   * `var(--token)` / `var(--token, fallback)` from [palette] (the spec's tokens, day or night), or a bare token
   * name. Null when it isn't one (`none` included).
   */
  private fun color(palette: Map<String, Int>, raw: String, depth: Int = 0): Int? {
    val v = raw.trim()
    if (v.isEmpty() || depth > 3) return null
    if (v.startsWith("var(", ignoreCase = true) && v.endsWith(")")) {
      val inner = v.substring(4, v.length - 1)
      val comma = inner.indexOf(',')
      val name = (if (comma >= 0) inner.substring(0, comma) else inner).trim().removePrefix("--")
      palette[name]?.let { return it }
      return if (comma >= 0) color(palette, inner.substring(comma + 1), depth + 1) else null
    }
    if (v[0] == '#') return hex(v.substring(1))
    val lower = v.lowercase()
    if (lower.startsWith("rgb")) return rgb(v)
    NAMED[lower]?.let { return it }
    return palette[v]
  }

  private fun hex(h: String): Int? {
    if (h.isEmpty() || h.length > 8) return null
    if (!h.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
    val n = h.toLongOrNull(16) ?: return null
    fun nib(shift: Int): Int = ((n shr shift) and 0xFL).toInt() * 17
    return when (h.length) {
      3 -> Color.argb(255, nib(8), nib(4), nib(0))
      4 -> Color.argb(nib(0), nib(12), nib(8), nib(4))
      6 -> (0xFF000000L or n).toInt()
      8 -> {
        val a = (n and 0xFFL).toInt()
        val rgb = ((n shr 8) and 0xFFFFFFL).toInt()
        (a shl 24) or rgb
      }
      else -> null
    }
  }

  private fun rgb(v: String): Int? {
    val open = v.indexOf('(')
    val close = v.lastIndexOf(')')
    if (open < 0 || close <= open) return null
    val parts = v.substring(open + 1, close).split(',', ' ', '/', '\t', '\n').map { it.trim() }.filter { it.isNotEmpty() }
    if (parts.size < 3) return null
    fun channel(p: String): Int? {
      val f = if (p.endsWith("%")) p.dropLast(1).toFloatOrNull()?.times(2.55f) else p.toFloatOrNull()
      return f?.takeIf { it.isFinite() }?.roundToInt()?.coerceIn(0, 255)
    }
    val r = channel(parts[0]) ?: return null
    val g = channel(parts[1]) ?: return null
    val b = channel(parts[2]) ?: return null
    val a = if (parts.size > 3) fraction(parts[3]) ?: 1f else 1f
    return Color.argb((a * 255f).roundToInt().coerceIn(0, 255), r, g, b)
  }

  // endregion

  // region drawing

  /** The inherited presentation attributes. Paints stay strings (`none`, a colour, `url(#id)`) until drawn. */
  private data class Style(
    var fill: String = "#000000",
    var stroke: String = "none",
    var color: String = "#000000",
    var strokeWidth: Float = 1f,
    var cap: Paint.Cap = Paint.Cap.BUTT,
    var join: Paint.Join = Paint.Join.MITER,
    var miter: Float = 4f,
    var dash: FloatArray? = null,
    var dashOffset: Float = 0f,
    var fillOpacity: Float = 1f,
    var strokeOpacity: Float = 1f,
    var evenOdd: Boolean = false,
    var fontSize: Float = 16f,
    var fontWeight: Int = 400,
    var italic: Boolean = false,
    var family: String = "",
    var anchor: String = "start",
    var baseline: String = "auto",
    var hidden: Boolean = false,
  )

  /** One svg element's drawing pass. */
  private class Pass(
    val ctx: Context,
    val palette: Map<String, Int>,
    val ids: Map<String, El>,
    /** The viewBox size: what percentages are of. */
    val vpW: Float,
    val vpH: Float,
    val texts: MutableList<String>,
  ) {
    var budget = Svg.MAX_DRAWN
    val diag: Float get() = sqrt((vpW * vpW + vpH * vpH) / 2f)
  }

  /**
   * Draws [template] (filled with [values]) into the box [x], [y], [w], [h] (px; [s] px per dp), its viewBox mapped
   * by [fit]. The drawn texts go to [texts] (TalkBack). Never throws.
   */
  fun draw(
    ctx: Context, c: Canvas, template: String, fit: String, values: WidgetValues, palette: Map<String, Int>,
    x: Float, y: Float, w: Float, h: Float, s: Float, texts: MutableList<String>,
  ) {
    if (template.isEmpty() || w <= 0f || h <= 0f || s <= 0f) return
    val save = c.save()
    try {
      val xml = fill(template, values, w / s, h / s)
      if (xml.length > MAX_FILLED_CHARS) {
        logOnce("filled markup longer than $MAX_FILLED_CHARS chars: not drawn")
        return
      }
      val root = parse(xml) ?: return
      val ids = HashMap<String, El>()
      collectIds(root, ids, 0)
      val vb = numbers(root.attrs["viewBox"], 4)
      val hasVb = vb.size == 4 && vb[2] > 0f && vb[3] > 0f
      val vbX = if (hasVb) vb[0] else 0f
      val vbY = if (hasVb) vb[1] else 0f
      val vbW = if (hasVb) vb[2] else w / s
      val vbH = if (hasVb) vb[3] else h / s
      val m = Matrix()
      if (!hasVb) {
        // No viewBox: user units are dp, from the box's top left.
        m.setTranslate(x, y)
        m.preScale(s, s)
      } else {
        var sx = w / vbW
        var sy = h / vbH
        if (fit == "contain" || fit == "cover") {
          val k = if (fit == "contain") min(sx, sy) else max(sx, sy)
          sx = k
          sy = k
        }
        val tx = x + (w - vbW * sx) / 2f - vbX * sx
        val ty = y + (h - vbH * sy) / 2f - vbY * sy
        m.setTranslate(tx, ty)
        m.preScale(sx, sy)
      }
      c.clipRect(x, y, x + w, y + h)
      c.concat(m)
      val pass = Pass(ctx, palette, ids, vbW, vbH, texts)
      // The root's own presentation attributes (fill="none", font-size, …) apply to everything.
      val st = Style()
      applyStyle(pass, root, st)
      val alpha = fraction(root.attrs["opacity"]) ?: 1f
      if (alpha <= 0f) return
      if (alpha < 1f) c.saveLayerAlpha(null as RectF?, (alpha * 255f).roundToInt())
      if (root.name == "svg" || root.name == "g") {
        for (k in root.kids) drawEl(pass, c, k, st, m, 1)
      } else {
        drawEl(pass, c, root, Style(), m, 1)
      }
    } catch (t: Throwable) {
      logOnce("draw failed", t)
    } finally {
      try {
        c.restoreToCount(save)
      } catch (ignored: Throwable) {
      }
    }
  }

  /** The pictures (`<image href>` web URLs) [template] shows with [values], to download ahead of drawing. */
  fun imageUrls(template: String, values: WidgetValues): Set<String> {
    val out = LinkedHashSet<String>()
    try {
      if (template.indexOf("image", ignoreCase = true) < 0) return out
      val xml = fill(template, values, 100f, 100f)
      if (xml.length > MAX_FILLED_CHARS) return out
      val root = parse(xml) ?: return out
      fun walk(e: El, depth: Int) {
        if (out.size >= MAX_IMAGES || depth > MAX_DEPTH) return
        if (e.name == "image") {
          val href = e.attrs["href"]?.trim()
          if (href != null && WidgetImages.isWebUrl(href) && href.length <= 2048) out.add(href)
        }
        for (k in e.kids) walk(k, depth + 1)
      }
      walk(root, 0)
    } catch (t: Throwable) {
      logOnce("image list failed", t)
    }
    return out
  }

  private fun collectIds(e: El, ids: MutableMap<String, El>, depth: Int) {
    if (depth > MAX_DEPTH) return
    val id = e.attrs["id"]
    if (id != null && id.isNotEmpty() && !ids.containsKey(id)) ids[id] = e
    for (k in e.kids) collectIds(k, ids, depth + 1)
  }

  /** Elements never drawn where they stand (definitions, metadata) and ones not supported. */
  private val NOT_DRAWN = setOf(
    "defs", "clipPath", "linearGradient", "radialGradient", "stop", "symbol", "mask", "pattern", "marker", "filter",
    "style", "script", "title", "desc", "metadata", "foreignObject", "#text",
  )

  /** [e] and its children with the inherited [parent] style; [ctm] maps its user space to the bitmap. */
  private fun drawEl(k: Pass, c: Canvas, e: El, parent: Style, ctm: Matrix, depth: Int) {
    if (depth > MAX_DEPTH) return
    if (k.budget <= 0) {
      logOnce("more than $MAX_DRAWN elements drawn: the rest skipped")
      return
    }
    k.budget--
    if (e.name in NOT_DRAWN) return
    if (e.attrs["display"]?.trim() == "none") return
    val save = c.save()
    try {
      val st = parent.copy()
      applyStyle(k, e, st)
      val local = transform(e.attrs["transform"])
      val m = if (local != null) {
        c.concat(local)
        Matrix(ctm).apply { preConcat(local) }
      } else {
        ctm
      }
      val alpha = fraction(e.attrs["opacity"]) ?: 1f
      if (alpha <= 0f) return
      when (e.name) {
        "g", "svg", "a", "switch" -> {
          if (e.name == "svg") {
            // A nested svg: placed at its x / y (its own viewBox is not supported).
            c.translate(len(e.attrs["x"], k.vpW, 0f, st.fontSize), len(e.attrs["y"], k.vpH, 0f, st.fontSize))
          }
          clipPathOf(k, e, null)?.let { c.clipPath(it) }
          if (alpha < 1f) c.saveLayerAlpha(null as RectF?, (alpha * 255f).roundToInt())
          val inner = if (e.name == "svg") Matrix(m).apply {
            preTranslate(len(e.attrs["x"], k.vpW, 0f, st.fontSize), len(e.attrs["y"], k.vpH, 0f, st.fontSize))
          } else m
          for (kid in e.kids) drawEl(k, c, kid, st, inner, depth + 1)
        }
        "use" -> {
          val target = urlIdOrHash(e.attrs["href"])?.let { k.ids[it] } ?: return
          val tx = len(e.attrs["x"], k.vpW, 0f, st.fontSize)
          val ty = len(e.attrs["y"], k.vpH, 0f, st.fontSize)
          c.translate(tx, ty)
          val inner = Matrix(m).apply { preTranslate(tx, ty) }
          clipPathOf(k, e, null)?.let { c.clipPath(it) }
          if (alpha < 1f) c.saveLayerAlpha(null as RectF?, (alpha * 255f).roundToInt())
          if (target.name == "symbol") {
            for (kid in target.kids) drawEl(k, c, kid, st, inner, depth + 1)
          } else {
            drawEl(k, c, target, st, inner, depth + 1)
          }
        }
        "text" -> {
          clipPathOf(k, e, null)?.let { c.clipPath(it) }
          drawText(k, c, e, st, alpha)
        }
        "image" -> drawImage(k, c, e, st, m, alpha)
        else -> {
          val path = shapePath(k, e, st.fontSize) ?: return
          drawShape(k, c, e, path, st, alpha)
        }
      }
    } catch (t: Throwable) {
      logOnce("<${e.name}> skipped", t)
    } finally {
      c.restoreToCount(save)
    }
  }

  /** `#id` (a `use` / gradient `href`) or `url(#id)` → `id`. */
  private fun urlIdOrHash(s: String?): String? {
    if (s == null) return null
    val t = s.trim()
    if (t.startsWith("#") && t.length > 1) return t.substring(1)
    return urlId(t)
  }

  private fun applyStyle(k: Pass, e: El, st: Style) {
    val a = e.attrs
    if (a.isEmpty()) return
    val col = a["color"]
    if (col != null && color(k.palette, col) != null) st.color = col.trim()
    paintValue(k, a["fill"], st)?.let { st.fill = it }
    paintValue(k, a["stroke"], st)?.let { st.stroke = it }
    val fs = len(a["font-size"], st.fontSize, -1f, st.fontSize)
    if (fs > 0f) st.fontSize = fs
    val sw = len(a["stroke-width"], k.diag, -1f, st.fontSize)
    if (sw >= 0f) st.strokeWidth = sw
    when (a["stroke-linecap"]?.trim()) {
      "butt" -> st.cap = Paint.Cap.BUTT
      "round" -> st.cap = Paint.Cap.ROUND
      "square" -> st.cap = Paint.Cap.SQUARE
    }
    when (a["stroke-linejoin"]?.trim()) {
      "miter", "miter-clip", "arcs" -> st.join = Paint.Join.MITER
      "round" -> st.join = Paint.Join.ROUND
      "bevel" -> st.join = Paint.Join.BEVEL
    }
    a["stroke-miterlimit"]?.trim()?.toFloatOrNull()?.takeIf { it.isFinite() && it >= 1f }?.let { st.miter = it }
    a["stroke-dasharray"]?.let { v ->
      if (v.trim() == "none") {
        st.dash = null
      } else {
        val d = numbers(v, 64)
        if (d.isNotEmpty() && d.all { it >= 0f } && d.any { it > 0f }) {
          st.dash = if (d.size % 2 == 0) d else d + d
        }
      }
    }
    a["stroke-dashoffset"]?.let { v -> st.dashOffset = len(v, k.diag, 0f, st.fontSize) }
    fraction(a["fill-opacity"])?.let { st.fillOpacity = it }
    fraction(a["stroke-opacity"])?.let { st.strokeOpacity = it }
    when (a["fill-rule"]?.trim()) {
      "evenodd" -> st.evenOdd = true
      "nonzero" -> st.evenOdd = false
    }
    a["font-weight"]?.let { st.fontWeight = fontWeight(it.trim(), st.fontWeight) }
    when (a["font-style"]?.trim()) {
      "italic", "oblique" -> st.italic = true
      "normal" -> st.italic = false
    }
    a["font-family"]?.let { st.family = it.lowercase() }
    when (a["text-anchor"]?.trim()) {
      "start" -> st.anchor = "start"
      "middle" -> st.anchor = "middle"
      "end" -> st.anchor = "end"
    }
    a["dominant-baseline"]?.trim()?.takeIf { it.isNotEmpty() }?.let { st.baseline = it }
    when (a["visibility"]?.trim()) {
      "hidden", "collapse" -> st.hidden = true
      "visible" -> st.hidden = false
    }
  }

  /** A fill / stroke value worth keeping (else the inherited one stays, as SVG does with invalid values). */
  private fun paintValue(k: Pass, v: String?, st: Style): String? {
    if (v == null) return null
    val t = v.trim()
    if (t == "none") return "none"
    if (t == "currentColor") return st.color
    if (t.startsWith("url(")) return t
    return if (color(k.palette, t) != null) t else null
  }

  private fun fontWeight(v: String, inherited: Int): Int = when (v.lowercase()) {
    "normal" -> 400
    "bold" -> 700
    "bolder" -> min(900, inherited + 300)
    "lighter" -> max(100, inherited - 300)
    else -> v.toFloatOrNull()?.takeIf { it.isFinite() }?.roundToInt()?.coerceIn(1, 1000) ?: inherited
  }

  /** A paint for [value] (`none` → null) at [opacity]; gradients sized to [bbox] when objectBoundingBox. */
  private fun paint(k: Pass, value: String, opacity: Float, bbox: RectF?, st: Style): Paint? {
    if (value == "none" || opacity <= 0f) return null
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    if (value.startsWith("url(")) {
      val g = urlId(value)?.let { k.ids[it] }
      val gp = g?.let { gradient(k, it, bbox, st) }
      if (gp != null) {
        if (gp.shader != null) {
          p.shader = gp.shader
          p.color = Color.BLACK
          p.alpha = (255f * opacity).roundToInt().coerceIn(0, 255)
          return p
        }
        p.color = gp.color
        p.alpha = (Color.alpha(gp.color) * opacity).roundToInt().coerceIn(0, 255)
        return if (p.alpha == 0) null else p
      }
      // A missing / unsupported paint server: the fallback colour after it, else nothing.
      val close = value.indexOf(')')
      val fallback = if (close >= 0) value.substring(close + 1).trim() else ""
      val c = if (fallback.isEmpty() || fallback == "none") null else color(k.palette, fallback)
      if (c == null) {
        if (g == null) logOnce("paint $value not found")
        return null
      }
      p.color = c
      p.alpha = (Color.alpha(c) * opacity).roundToInt().coerceIn(0, 255)
      return if (p.alpha == 0) null else p
    }
    val c = color(k.palette, value) ?: return null
    p.color = c
    p.alpha = (Color.alpha(c) * opacity).roundToInt().coerceIn(0, 255)
    return if (p.alpha == 0) null else p
  }

  /** A gradient's paint: a shader, or one colour (a single stop, a zero radius). */
  private class GradientPaint(val shader: Shader?, val color: Int)

  private fun gradient(k: Pass, g: El, bbox: RectF?, st: Style): GradientPaint? {
    val linear = g.name == "linearGradient"
    if (!linear && g.name != "radialGradient") return null
    // Stops: its own, else the ones of the gradient its href names (one level).
    var stopsEl = g
    if (g.kids.none { it.name == "stop" }) {
      val ref = urlIdOrHash(g.attrs["href"])?.let { k.ids[it] }
      if (ref != null) stopsEl = ref
    }
    val colors = ArrayList<Int>()
    val positions = ArrayList<Float>()
    var last = 0f
    for (stop in stopsEl.kids) {
      if (stop.name != "stop") continue
      val off = (fraction(stop.attrs["offset"]) ?: 0f).coerceAtLeast(last)
      last = off
      val sc: String = stop.attrs["stop-color"]?.trim() ?: "black"
      val base = (if (sc == "currentColor") color(k.palette, st.color) else color(k.palette, sc)) ?: Color.BLACK
      val op = fraction(stop.attrs["stop-opacity"]) ?: 1f
      val a = (Color.alpha(base) * op).roundToInt().coerceIn(0, 255)
      colors.add((a shl 24) or (base and 0x00FFFFFF))
      positions.add(off)
    }
    if (colors.isEmpty()) return null
    if (colors.size == 1) return GradientPaint(null, colors[0])
    val obb = g.attrs["gradientUnits"]?.trim() != "userSpaceOnUse"
    if (obb && (bbox == null || bbox.width() <= 0f || bbox.height() <= 0f)) return null
    val refW = if (obb) 1f else k.vpW
    val refH = if (obb) 1f else k.vpH
    val tile = when (g.attrs["spreadMethod"]?.trim()) {
      "reflect" -> Shader.TileMode.MIRROR
      "repeat" -> Shader.TileMode.REPEAT
      else -> Shader.TileMode.CLAMP
    }
    val colorArr = IntArray(colors.size) { colors[it] }
    val posArr = FloatArray(positions.size) { positions[it] }
    val shader: Shader = if (linear) {
      val x1 = len(g.attrs["x1"], refW, 0f)
      val y1 = len(g.attrs["y1"], refH, 0f)
      val x2 = len(g.attrs["x2"], refW, refW)
      val y2 = len(g.attrs["y2"], refH, 0f)
      if (x1 == x2 && y1 == y2) return GradientPaint(null, colors[colors.size - 1])
      LinearGradient(x1, y1, x2, y2, colorArr, posArr, tile)
    } else {
      val cx = len(g.attrs["cx"], refW, refW / 2f)
      val cy = len(g.attrs["cy"], refH, refH / 2f)
      val rRef = if (obb) 1f else k.diag
      val r = len(g.attrs["r"], rRef, rRef / 2f)
      if (r <= 0f) return GradientPaint(null, colors[colors.size - 1])
      RadialGradient(cx, cy, r, colorArr, posArr, tile)
    }
    val local = Matrix()
    if (obb && bbox != null) {
      local.setTranslate(bbox.left, bbox.top)
      local.preScale(bbox.width(), bbox.height())
    }
    transform(g.attrs["gradientTransform"])?.let { local.preConcat(it) }
    shader.setLocalMatrix(local)
    return GradientPaint(shader, 0)
  }

  /** The outline of a basic shape (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`); null: none. */
  private fun shapePath(k: Pass, e: El, font: Float): Path? {
    val a = e.attrs
    fun lx(name: String, def: Float = 0f) = len(a[name], k.vpW, def, font)
    fun ly(name: String, def: Float = 0f) = len(a[name], k.vpH, def, font)
    return when (e.name) {
      "rect" -> {
        val w = lx("width")
        val h = ly("height")
        if (w <= 0f || h <= 0f) return null
        val x = lx("x")
        val y = ly("y")
        var rx = len(a["rx"], k.vpW, -1f, font)
        var ry = len(a["ry"], k.vpH, -1f, font)
        if (rx < 0f) rx = ry
        if (ry < 0f) ry = rx
        rx = rx.coerceIn(0f, w / 2f)
        ry = ry.coerceIn(0f, h / 2f)
        val p = Path()
        val r = RectF(x, y, x + w, y + h)
        if (rx > 0f && ry > 0f) p.addRoundRect(r, rx, ry, Path.Direction.CW) else p.addRect(r, Path.Direction.CW)
        p
      }
      "circle" -> {
        val r = len(a["r"], k.diag, 0f, font)
        if (r <= 0f) return null
        val p = Path()
        p.addCircle(lx("cx"), ly("cy"), r, Path.Direction.CW)
        p
      }
      "ellipse" -> {
        var rx = len(a["rx"], k.vpW, -1f, font)
        var ry = len(a["ry"], k.vpH, -1f, font)
        if (rx < 0f) rx = ry
        if (ry < 0f) ry = rx
        if (rx <= 0f || ry <= 0f) return null
        val cx = lx("cx")
        val cy = ly("cy")
        val p = Path()
        p.addOval(RectF(cx - rx, cy - ry, cx + rx, cy + ry), Path.Direction.CW)
        p
      }
      "line" -> {
        val p = Path()
        p.moveTo(lx("x1"), ly("y1"))
        p.lineTo(lx("x2"), ly("y2"))
        p
      }
      "polyline", "polygon" -> {
        val pts = numbers(a["points"])
        if (pts.size < 4) return null
        val p = Path()
        p.moveTo(pts[0], pts[1])
        var i = 2
        while (i + 1 < pts.size) {
          p.lineTo(pts[i], pts[i + 1])
          i += 2
        }
        if (e.name == "polygon") p.close()
        p
      }
      "path" -> {
        val d = a["d"]?.trim()
        if (d.isNullOrEmpty()) return null
        try {
          PathParser.createPathFromPathData(d)
        } catch (t: Throwable) {
          logOnce("path data not understood", t)
          null
        }
      }
      else -> {
        logOnce("<${e.name}> not supported")
        null
      }
    }
  }

  private fun drawShape(k: Pass, c: Canvas, e: El, path: Path, st: Style, alpha: Float) {
    if (st.hidden) return
    path.fillType = if (st.evenOdd) Path.FillType.EVEN_ODD else Path.FillType.WINDING
    val bbox = RectF()
    path.computeBounds(bbox, true)
    clipPathOf(k, e, bbox)?.let { c.clipPath(it) }
    if (e.name != "line") {
      paint(k, st.fill, st.fillOpacity * alpha, bbox, st)?.let { p ->
        p.style = Paint.Style.FILL
        c.drawPath(path, p)
      }
    }
    if (st.strokeWidth > 0f) {
      paint(k, st.stroke, st.strokeOpacity * alpha, bbox, st)?.let { p ->
        stroke(p, st)
        c.drawPath(path, p)
      }
    }
  }

  private fun stroke(p: Paint, st: Style) {
    p.style = Paint.Style.STROKE
    p.strokeWidth = st.strokeWidth
    p.strokeCap = st.cap
    p.strokeJoin = st.join
    p.strokeMiter = st.miter
    val d = st.dash
    if (d != null && d.size >= 2) p.pathEffect = DashPathEffect(d, st.dashOffset)
  }

  /** The `clip-path` of [e] as a path in its user space ([bbox]: for objectBoundingBox units); null: no clip. */
  private fun clipPathOf(k: Pass, e: El, bbox: RectF?): Path? {
    val ref = e.attrs["clip-path"] ?: return null
    val cp = urlId(ref)?.let { k.ids[it] }?.takeIf { it.name == "clipPath" } ?: return null
    val out = Path()
    for (kid in cp.kids) {
      if (kid.attrs["display"]?.trim() == "none") continue
      val p = shapePath(k, kid, 16f) ?: continue
      transform(kid.attrs["transform"])?.let { p.transform(it) }
      out.addPath(p)
    }
    transform(cp.attrs["transform"])?.let { out.transform(it) }
    if (cp.attrs["clipPathUnits"]?.trim() == "objectBoundingBox") {
      if (bbox == null || bbox.width() <= 0f || bbox.height() <= 0f) return null
      val m = Matrix()
      m.setTranslate(bbox.left, bbox.top)
      m.preScale(bbox.width(), bbox.height())
      out.transform(m)
    }
    return out
  }

  // region text

  private class Run(
    var text: String,
    val st: Style,
    val alpha: Float,
    val x: Float?,
    val y: Float?,
    val dx: Float,
    val dy: Float,
  )

  /** Where the next run starts: absolute x / y (a new chunk) and relative dx / dy. */
  private class Pos(var x: Float?, var y: Float?, var dx: Float, var dy: Float)

  private class Piece(val run: Run, var x: Float, val y: Float, val width: Float, val paint: Paint)

  private fun collectRuns(k: Pass, e: El, st: Style, alpha: Float, pos: Pos, out: MutableList<Run>, depth: Int) {
    if (depth > MAX_DEPTH) return
    for (kid in e.kids) {
      if (out.size >= MAX_NODES) return
      if (kid.name == "#text") {
        out.add(Run(kid.text ?: "", st, alpha, pos.x, pos.y, pos.dx, pos.dy))
        pos.x = null
        pos.y = null
        pos.dx = 0f
        pos.dy = 0f
      } else if (kid.name == "tspan") {
        if (kid.attrs["display"]?.trim() == "none") continue
        val ks = st.copy()
        applyStyle(k, kid, ks)
        val ka = alpha * (fraction(kid.attrs["opacity"]) ?: 1f)
        first(kid.attrs["x"])?.let { pos.x = len(it, k.vpW, 0f, ks.fontSize) }
        first(kid.attrs["y"])?.let { pos.y = len(it, k.vpH, 0f, ks.fontSize) }
        first(kid.attrs["dx"])?.let { pos.dx += len(it, k.vpW, 0f, ks.fontSize) }
        first(kid.attrs["dy"])?.let { pos.dy += len(it, k.vpH, 0f, ks.fontSize) }
        collectRuns(k, kid, ks, ka, pos, out, depth + 1)
      }
    }
  }

  /** Spaces as a browser shows them: runs of white space as one space, none at the start or the end. */
  private fun collapse(runs: List<Run>) {
    var lastSpace = true
    for (r in runs) {
      val sb = StringBuilder(r.text.length)
      for (ch in r.text) {
        if (ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t') {
          if (!lastSpace) sb.append(' ')
          lastSpace = true
        } else {
          sb.append(ch)
          lastSpace = false
        }
      }
      r.text = sb.toString()
    }
    for (i in runs.indices.reversed()) {
      val r = runs[i]
      if (r.text.isEmpty()) continue
      r.text = r.text.trimEnd(' ')
      break
    }
  }

  private fun typeface(st: Style): Typeface {
    val fam = st.family
    val base = when {
      fam.contains("mono") -> Typeface.MONOSPACE
      fam.contains("serif") && !fam.contains("sans") -> Typeface.SERIF
      else -> Typeface.DEFAULT
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return Typeface.create(base, st.fontWeight.coerceIn(1, 1000), st.italic)
    val bold = st.fontWeight >= 600
    if (!bold && !st.italic && st.fontWeight >= 500 && base === Typeface.DEFAULT) {
      return Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }
    val style = when {
      bold && st.italic -> Typeface.BOLD_ITALIC
      bold -> Typeface.BOLD
      st.italic -> Typeface.ITALIC
      else -> Typeface.NORMAL
    }
    return Typeface.create(base, style)
  }

  private fun drawText(k: Pass, c: Canvas, e: El, st: Style, alpha: Float) {
    val runs = ArrayList<Run>()
    val pos = Pos(
      first(e.attrs["x"])?.let { len(it, k.vpW, 0f, st.fontSize) } ?: 0f,
      first(e.attrs["y"])?.let { len(it, k.vpH, 0f, st.fontSize) } ?: 0f,
      first(e.attrs["dx"])?.let { len(it, k.vpW, 0f, st.fontSize) } ?: 0f,
      first(e.attrs["dy"])?.let { len(it, k.vpH, 0f, st.fontSize) } ?: 0f,
    )
    collectRuns(k, e, st, alpha, pos, runs, 0)
    if (runs.isEmpty()) return
    collapse(runs)
    val pieces = ArrayList<Piece>()
    var curX = 0f
    var curY = 0f
    var chunkStart = 0
    var chunkX0 = 0f
    var anchor = st.anchor
    fun flush() {
      val width = curX - chunkX0
      val shift = when (anchor) {
        "middle" -> -width / 2f
        "end" -> -width
        else -> 0f
      }
      if (shift != 0f) for (i in chunkStart until pieces.size) pieces[i].x += shift
      chunkStart = pieces.size
    }
    for (r in runs) {
      val rx = r.x
      val ry = r.y
      if (rx != null || ry != null) {
        flush()
        if (rx != null) curX = rx
        if (ry != null) curY = ry
        chunkX0 = curX
        anchor = r.st.anchor
      }
      curX += r.dx
      curY += r.dy
      if (r.text.isEmpty() || r.st.fontSize <= 0f) continue
      val p = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
      p.textSize = r.st.fontSize
      p.typeface = typeface(r.st)
      val width = p.measureText(r.text)
      pieces.add(Piece(r, curX, curY, width, p))
      curX += width
    }
    flush()
    val drawn = StringBuilder()
    for (pc in pieces) {
      val r = pc.run
      drawn.append(r.text)
      if (r.st.hidden) continue
      val fm = pc.paint.fontMetrics
      val y = pc.y + when (r.st.baseline) {
        "middle", "central" -> -(fm.ascent + fm.descent) / 2f
        "hanging", "text-before-edge", "text-top" -> -fm.ascent
        "text-after-edge", "text-bottom" -> -fm.descent
        else -> 0f
      }
      val bbox = RectF(pc.x, y + fm.ascent, pc.x + pc.width, y + fm.descent)
      paint(k, r.st.fill, r.st.fillOpacity * r.alpha, bbox, r.st)?.let { fp ->
        fp.textSize = pc.paint.textSize
        fp.typeface = pc.paint.typeface
        fp.flags = fp.flags or Paint.SUBPIXEL_TEXT_FLAG
        fp.style = Paint.Style.FILL
        c.drawText(r.text, pc.x, y, fp)
      }
      if (r.st.strokeWidth > 0f && r.st.stroke != "none") {
        paint(k, r.st.stroke, r.st.strokeOpacity * r.alpha, bbox, r.st)?.let { sp ->
          sp.textSize = pc.paint.textSize
          sp.typeface = pc.paint.typeface
          stroke(sp, r.st)
          c.drawText(r.text, pc.x, y, sp)
        }
      }
    }
    val text = drawn.toString().trim()
    if (text.isNotEmpty() && k.texts.size < 64) k.texts.add(text)
  }

  // endregion

  // region image

  /**
   * An `<image>`: the picture from the disk cache ([WidgetImages], downloaded by the widget refresh; nothing while
   * missing), placed by `preserveAspectRatio` in x / y / width / height. Drawn as a shader-filled shape, so a
   * `clip-path` (a rounded icon) has smooth edges.
   */
  private fun drawImage(k: Pass, c: Canvas, e: El, st: Style, ctm: Matrix, alpha: Float) {
    if (st.hidden) return
    val url = e.attrs["href"]?.trim() ?: return
    if (!WidgetImages.isWebUrl(url)) return
    val x = len(e.attrs["x"], k.vpW, 0f, st.fontSize)
    val y = len(e.attrs["y"], k.vpH, 0f, st.fontSize)
    val w = len(e.attrs["width"], k.vpW, 0f, st.fontSize)
    val h = len(e.attrs["height"], k.vpH, 0f, st.fontSize)
    if (w <= 0f || h <= 0f) return
    // Its size on the bitmap, to decode at about that size.
    val pts = floatArrayOf(x, y, x + w, y, x, y + h)
    ctm.mapPoints(pts)
    val devW = hypot(pts[2] - pts[0], pts[3] - pts[1])
    val devH = hypot(pts[4] - pts[0], pts[5] - pts[1])
    if (devW < 0.5f || devH < 0.5f) return
    val bmp: Bitmap = WidgetImages.loadWhole(
      k.ctx, url, ceil(devW).toInt().coerceIn(1, 2048), ceil(devH).toInt().coerceIn(1, 2048),
    ) ?: return
    val bw = bmp.width.toFloat()
    val bh = bmp.height.toFloat()
    if (bw <= 0f || bh <= 0f) return
    val viewport = RectF(x, y, x + w, y + h)
    val dst = placed(e.attrs["preserveAspectRatio"], viewport, bw, bh)
    val area = RectF(viewport)
    if (!area.intersect(dst)) return
    val shape = Path()
    shape.addRect(area, Path.Direction.CW)
    val clip = clipPathOf(k, e, viewport)
    if (clip != null) {
      if (!shape.op(clip, Path.Op.INTERSECT)) c.clipPath(clip)
    }
    val p = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    val shader = BitmapShader(bmp, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    val local = Matrix()
    local.setRectToRect(RectF(0f, 0f, bw, bh), dst, Matrix.ScaleToFit.FILL)
    shader.setLocalMatrix(local)
    p.shader = shader
    p.alpha = (255f * alpha).roundToInt().coerceIn(0, 255)
    c.drawPath(shape, p)
  }

  /** Where a [bw] x [bh] picture goes in [vp] by `preserveAspectRatio` (default `xMidYMid meet`). */
  private fun placed(par: String?, vp: RectF, bw: Float, bh: Float): RectF {
    val tokens = (par ?: "").trim().split(' ', '\t', '\n').filter { it.isNotEmpty() && it != "defer" }
    val align = tokens.getOrNull(0) ?: "xMidYMid"
    if (align == "none") return RectF(vp)
    val slice = tokens.getOrNull(1) == "slice"
    val k = if (slice) max(vp.width() / bw, vp.height() / bh) else min(vp.width() / bw, vp.height() / bh)
    val dw = bw * k
    val dh = bh * k
    val ax = when {
      align.startsWith("xMin") -> 0f
      align.startsWith("xMax") -> 1f
      else -> 0.5f
    }
    val ay = when {
      align.endsWith("YMin") -> 0f
      align.endsWith("YMax") -> 1f
      else -> 0.5f
    }
    val left = vp.left + (vp.width() - dw) * ax
    val top = vp.top + (vp.height() - dh) * ay
    return RectF(left, top, left + dw, top + dh)
  }

  // endregion

  // endregion
}
