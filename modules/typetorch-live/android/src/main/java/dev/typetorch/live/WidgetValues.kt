package dev.typetorch.live

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToLong

/** A text with coloured runs: [spans] hold colour tokens over [text] (start inclusive, end exclusive). */
internal class Rich(val text: String, val spans: List<Span>) {
  class Span(val start: Int, val end: Int, val color: String)
}

/** A metric's numbers as a binding value: formatted by [unit] unless the template names another format. */
internal class MetricCell(val value: Double?, val prev: Double?, val unit: String?)

/**
 * A part of a metric's value formatted by its unit (`{slot.1.number}`, `{slot.1.unit}`, ...), for markup that colours
 * the unit itself (the svg element's tspans). Formatted when read, so the spec's `format.ratioDecimals` applies.
 */
internal class PartCell(val cell: MetricCell, val part: String) {
  fun text(): String {
    val segs = Units.value(cell.unit, cell.value, false)
    val units = segs.filter { it.color != null && it.text.isNotEmpty() }
    // A duration (18m 40s) has a unit after each number: the number part is the whole text, the unit part empty.
    val one = units.size == 1
    val unitAt = if (one) segs.indexOf(units[0]) else -1
    val firstNumber = segs.indexOfFirst { it.color == null && it.text.isNotBlank() && it.text != "-" }
    val before = one && firstNumber >= 0 && unitAt < firstNumber
    return when (part) {
      "number" -> if (one) segs.filter { it.color == null }.joinToString("") { it.text } else segs.joinToString("") { it.text }
      "unit" -> if (one) units[0].text else ""
      "unitBefore" -> if (before) units[0].text else ""
      "unitAfter" -> if (one && !before) units[0].text else ""
      "unitToken" -> units.firstOrNull()?.color ?: ""
      else -> ""
    }
  }
}

/** A metric's change against the period before (`{slot.1.delta}`, `{metrics.dau.delta}`). */
internal class DeltaCell(val cell: MetricCell) {
  val seg: Seg? by lazy { Units.delta(cell.unit, cell.value, cell.prev) }
}

/**
 * The values a widget spec's texts can show (docs/WIDGET_SPEC.md, bindings), and the `{name:format|fallback}` template
 * filler. Numbers are kept as Double, texts as String, metrics as [MetricCell] / [DeltaCell]; null = unknown. A name
 * that isn't a built-in binding is a path into the live answer (`metrics.mau.value`, `game.universeId`), so a new
 * backend field needs no APK.
 */
internal class WidgetValues(
  private val map: Map<String, Any?>,
  val series: List<Point>,
  private val data: LiveData?,
) {
  private var tree: JSONObject? = null
  private var treeFailed = false

  /** A binding's value: the built-in ones, else a path into the live answer. */
  fun lookup(key: String): Any? {
    if (map.containsKey(key)) {
      val v = map[key]
      return if (v is PartCell) v.text() else v
    }
    return path(key)
  }

  /** True when [key] has a value ("series": the chart has points). */
  fun has(key: String): Boolean {
    if (key == "series") return series.isNotEmpty()
    return when (val v = lookup(key)) {
      null -> false
      is String -> v.isNotBlank()
      is MetricCell -> v.value != null
      is DeltaCell -> v.seg != null
      else -> true
    }
  }

  fun num(key: String): Double? = when (val v = lookup(key)) {
    is Double -> v
    is Number -> v.toDouble()
    is String -> v.toDoubleOrNull()
    is MetricCell -> v.value
    else -> null
  }

  /** A text value (an image's URL); null when missing or not a text. */
  fun str(key: String): String? = (lookup(key) as? String)?.takeIf { it.isNotBlank() }

  /** [t] filled, as plain text (descriptions, the status line, visibility). */
  fun template(t: String): String = rich(t).text

  /** [t] with every `{name}`, `{name:format}` and `{name|fallback}` filled; `{{` / `}}` are literal braces. */
  fun rich(t: String): Rich {
    if (t.indexOf('{') < 0 && t.indexOf('}') < 0) return Rich(t, emptyList())
    val sb = StringBuilder(t.length + 16)
    val spans = ArrayList<Rich.Span>()
    var i = 0
    while (i < t.length) {
      val ch = t[i]
      if (ch == '{') {
        if (i + 1 < t.length && t[i + 1] == '{') {
          sb.append('{')
          i += 2
          continue
        }
        val end = t.indexOf('}', i + 1)
        if (end < 0) {
          sb.append(t, i, t.length)
          break
        }
        for (seg in resolve(t.substring(i + 1, end))) {
          if (seg.text.isEmpty()) continue
          val start = sb.length
          sb.append(seg.text)
          val c = seg.color
          if (c != null) spans.add(Rich.Span(start, sb.length, c))
        }
        i = end + 1
        continue
      }
      if (ch == '}' && i + 1 < t.length && t[i + 1] == '}') {
        sb.append('}')
        i += 2
        continue
      }
      sb.append(ch)
      i++
    }
    return Rich(sb.toString(), spans)
  }

  /**
   * [t] filled for markup (the svg element): every value XML-escaped, literal text left as it is. [own] answers the
   * names it knows first ({w}, {chart.path:…}: unescaped, "" = missing so a `|fallback` shows); null = not its name.
   */
  fun markup(t: String, own: (String) -> String?): String {
    if (t.indexOf('{') < 0 && t.indexOf('}') < 0) return t
    val sb = StringBuilder(t.length + 256)
    var i = 0
    while (i < t.length) {
      val ch = t[i]
      if (ch == '{') {
        if (i + 1 < t.length && t[i + 1] == '{') {
          sb.append('{')
          i += 2
          continue
        }
        val end = t.indexOf('}', i + 1)
        if (end < 0) {
          sb.append(t, i, t.length)
          break
        }
        val expr = t.substring(i + 1, end)
        val bar = expr.indexOf('|')
        val head = (if (bar >= 0) expr.substring(0, bar) else expr).trim()
        val mine = own(head)
        if (mine != null) {
          val fallback = if (bar >= 0) expr.substring(bar + 1) else null
          if (mine.isEmpty() && fallback != null) escapeXml(fallback, sb) else sb.append(mine)
        } else {
          for (seg in resolve(expr)) escapeXml(seg.text, sb)
        }
        i = end + 1
        continue
      }
      if (ch == '}' && i + 1 < t.length && t[i + 1] == '}') {
        sb.append('}')
        i += 2
        continue
      }
      sb.append(ch)
      i++
    }
    return sb.toString()
  }

  private fun escapeXml(s: String, sb: StringBuilder) {
    for (ch in s) {
      when (ch) {
        '&' -> sb.append("&amp;")
        '<' -> sb.append("&lt;")
        '>' -> sb.append("&gt;")
        '"' -> sb.append("&quot;")
        '\'' -> sb.append("&apos;")
        else -> if (ch >= ' ' || ch == '\n' || ch == '\t') sb.append(ch)
      }
    }
  }

  private fun resolve(expr: String): List<Seg> {
    val bar = expr.indexOf('|')
    val head = (if (bar >= 0) expr.substring(0, bar) else expr).trim()
    val fallback = if (bar >= 0) expr.substring(bar + 1) else null
    // The format follows the last ':' when it names one (metric ids hold ':' too: `metrics.revenue:72h.value`).
    val colon = head.lastIndexOf(':')
    val suffix = if (colon >= 0) head.substring(colon + 1).trim() else ""
    val explicit = suffix.isNotEmpty() && suffix in FORMATS
    val key = if (explicit) head.substring(0, colon).trim() else head
    if (!has(key) && fallback != null) return listOf(Seg(fallback))
    val v = lookup(key)
    val fmt = if (explicit) suffix else DEFAULT_FORMAT[key] ?: when (v) {
      is MetricCell -> "unit"
      is DeltaCell -> "delta"
      else -> "raw"
    }
    return format(fmt, v)
  }

  private fun format(fmt: String, v: Any?): List<Seg> = when (v) {
    is DeltaCell -> {
      val seg = v.seg
      when {
        seg == null -> emptyList()
        fmt == "plain" || fmt == "raw" -> listOf(Seg(seg.text))
        else -> listOf(seg)
      }
    }
    is MetricCell -> when (fmt) {
      "unit" -> Units.value(v.unit, v.value, false)
      "short" -> Units.value(v.unit, v.value, true)
      "plain" -> listOf(Seg(Units.value(v.unit, v.value, false).joinToString("") { it.text }))
      "delta" -> listOfNotNull(Units.delta(v.unit, v.value, v.prev))
      "raw" -> listOf(Seg(raw(v.value)))
      else -> number(fmt, v.value)
    }
    else -> number(fmt, v)
  }

  /** The plain-value formats (docs/WIDGET_SPEC.md). */
  private fun number(fmt: String, v: Any?): List<Seg> {
    val d: Double? = when (v) {
      is Number -> v.toDouble()
      is String -> v.toDoubleOrNull()
      else -> null
    }?.takeIf { !it.isNaN() && !it.isInfinite() }
    val i: Int? = d?.roundToLong()?.coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong())?.toInt()
    return when (fmt) {
      "count" -> listOf(Seg(Fmt.count(i)))
      "grouped" -> listOf(Seg(Fmt.grouped(i)))
      "delta" -> listOf(Seg(Fmt.delta(i) ?: ""))
      "duration" -> listOf(Seg(Fmt.duration(d)))
      "hours" -> listOf(Seg(Fmt.hours(d)))
      "seconds" -> if (d == null) listOf(Seg("—")) else Units.seconds(d)
      "percent" -> if (d == null) listOf(Seg("—")) else Units.percent(d, false)
      "robux" -> if (d == null) listOf(Seg("—")) else Units.robux(d, false)
      "unit", "plain" -> listOf(Seg(if (d != null && v is Number) Units.number(d) else raw(v)))
      "short" -> listOf(Seg(if (d != null && v is Number) Units.countShort(d) else raw(v)))
      else -> listOf(Seg(raw(v)))
    }
  }

  private fun raw(v: Any?): String = when (v) {
    null -> ""
    is String -> v
    is Double -> if (!v.isNaN() && !v.isInfinite() && v % 1.0 == 0.0) v.toLong().toString() else v.toString()
    else -> v.toString()
  }

  /**
   * A dotted path into the live answer (array items by index). A number under an object with a `unit` (a metric's
   * `value` / `prev`) comes back as a [MetricCell]; `<metric>.delta` is computed from its `value` and `prev`.
   */
  private fun path(key: String): Any? {
    val live = data ?: return null
    if (key.isEmpty() || key.length > 200) return null
    val root = tree ?: run {
      if (treeFailed) return null
      try {
        live.toJson(false).also { tree = it }
      } catch (t: Throwable) {
        treeFailed = true
        return null
      }
    }
    val parts = key.split('.')
    var cur: Any? = root
    var parent: JSONObject? = null
    for ((i, p) in parts.withIndex()) {
      val node = cur
      if (node is JSONObject) {
        if (i == parts.size - 1 && p == "delta" && !node.has("delta") && node.has("value")) {
          return DeltaCell(cell(node, node.opt("value")))
        }
        if (!node.has(p) || node.isNull(p)) return null
        parent = node
        cur = node.opt(p)
      } else if (node is JSONArray) {
        val idx = p.toIntOrNull() ?: return null
        if (idx < 0 || idx >= node.length() || node.isNull(idx)) return null
        parent = null
        cur = node.opt(idx)
      } else {
        return null
      }
    }
    val leaf = cur
    val owner = parent
    return when (leaf) {
      is Number -> {
        val name = parts.last()
        if (owner != null && (name == "value" || name == "prev") && owner.has("unit") && !owner.isNull("unit")) {
          if (name == "value") cell(owner, leaf) else MetricCell(leaf.toDouble(), null, owner.optString("unit"))
        } else {
          leaf.toDouble()
        }
      }
      is String -> leaf
      is Boolean -> leaf.toString()
      else -> null
    }
  }

  private fun cell(metric: JSONObject, value: Any?): MetricCell {
    val prev = if (metric.has("prev") && !metric.isNull("prev")) (metric.opt("prev") as? Number)?.toDouble() else null
    val unit = if (metric.has("unit") && !metric.isNull("unit")) metric.optString("unit") else null
    return MetricCell((value as? Number)?.toDouble(), prev, unit)
  }

  companion object {
    private val FORMATS = setOf(
      "count", "grouped", "delta", "duration", "hours", "raw", "unit", "short", "plain", "seconds", "percent", "robux",
    )

    /** `slot.N.number` etc.: the parts of a slot's value (see [PartCell]). */
    private val PARTS = listOf("number", "unit", "unitBefore", "unitAfter", "unitToken")

    private val DEFAULT_FORMAT = mapOf(
      "ccu" to "count",
      "delta" to "delta",
      "servers" to "grouped",
      "peakToday" to "grouped",
      "lastHour.avgSessionSeconds" to "duration",
      "lastHour.medianSessionSeconds" to "duration",
      "lastHour.sessionsEnded" to "grouped",
      "lastHour.playtimeHours" to "hours",
    )

    /**
     * The values of one widget: [b] null when no backend; [snap] the cache; the status wording from [spec]; [slots]
     * the widget's stat slots (metric ids, "" = empty) as `slot.N.*` (1-based).
     */
    fun of(
      ctx: Context,
      spec: WidgetSpec,
      b: Backend?,
      snap: Snapshot?,
      refreshing: Boolean,
      slots: List<String>,
    ): WidgetValues {
      val data = snap?.data
      val m = HashMap<String, Any?>()
      m["backend"] = b?.name?.takeIf { it.isNotBlank() }
      m["game"] = data?.gameName?.takeIf { it.isNotBlank() } ?: b?.name?.takeIf { it.isNotBlank() }
      m["game.iconUrl"] = data?.iconUrl
      m["ccu"] = data?.ccu?.toDouble()
      m["delta"] = data?.delta?.toDouble()
      val servers = data?.servers
      m["servers"] = servers?.toDouble()
      m["serversLabel"] = servers?.let { Fmt.grouped(it) + if (it == 1) " server" else " servers" }
      m["peakToday"] = data?.peakToday?.toDouble()
      val lh = data?.lastHour
      m["lastHour.avgSessionSeconds"] = lh?.avgSessionSeconds
      m["lastHour.medianSessionSeconds"] = lh?.medianSessionSeconds
      m["lastHour.sessionsEnded"] = lh?.sessionsEnded?.toDouble()
      m["lastHour.playtimeHours"] = lh?.playtimeHours
      for ((i, id) in slots.withIndex()) {
        if (id.isEmpty()) continue
        val n = i + 1
        val metric = data?.metrics?.get(id) ?: Units.fallback(id, data)
        val cell = MetricCell(metric?.value, metric?.prev, metric?.unit ?: Units.unitOf(id))
        m["slot.$n"] = id
        m["slot.$n.id"] = id
        m["slot.$n.label"] = metric?.label ?: Units.label(id)
        m["slot.$n.value"] = cell
        m["slot.$n.delta"] = DeltaCell(cell)
        for (part in PARTS) m["slot.$n.$part"] = PartCell(cell, part)
      }
      val okAt = snap?.okAt ?: 0L
      m["updated"] = if (okAt > 0L) Fmt.clock(ctx, okAt).takeIf { it.isNotEmpty() } else null
      // A widget isn't redrawn every second, so a relative "3 min ago" would go wrong: the clock time of the data.
      val state = when {
        refreshing -> "refreshing"
        snap == null || okAt <= 0L -> ""
        snap.stale -> "offline"
        else -> "fresh"
      }
      m["state"] = state
      val partial = WidgetValues(m, data?.series.orEmpty(), data)
      m["status"] = when (state) {
        "refreshing" -> WidgetSpecs.string(spec, "refreshing")
        "offline" -> partial.template(WidgetSpecs.string(spec, "offline"))
        "fresh" -> m["updated"]
        else -> null
      }
      return WidgetValues(m, data?.series.orEmpty(), data)
    }
  }
}
