package dev.typetorch.live

import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToLong

/** A run of a widget text, coloured by a colour token when [color] is set (a unit, a delta's up / down). */
internal class Seg(val text: String, val color: String? = null)

/**
 * Metric values as coloured segments (docs/WIDGET_STATS.md, docs/WIDGET_SPEC.md "Rich text"): the number in the
 * element's colour, the unit in a unit token (`unitTime`, `unitPercent`, `unitRobux`); deltas against the period before
 * in `up` / `down`. Plus the built-in metric catalog (labels and units for ids the backend didn't describe).
 */
internal object Units {
  const val TIME = "unitTime"
  const val PERCENT = "unitPercent"
  const val ROBUX = "unitRobux"

  private const val DASH = "—"
  private val US = Locale.US

  // region values

  /** [v] in [unit] (`count`, `ratio`, `robux`, `seconds`, `hours`; anything else: the number and the unit's name). */
  fun value(unit: String?, v: Double?, short: Boolean): List<Seg> {
    if (v == null || v.isNaN() || v.isInfinite()) return listOf(Seg(DASH))
    return when (unit) {
      "ratio" -> percent(v, short)
      "robux" -> robux(v, short)
      "seconds" -> seconds(v)
      "hours" -> hours(v, short)
      "count", null, "" -> listOf(Seg(if (short) countShort(v) else grouped(v)))
      else -> listOf(Seg(number(v)), Seg(" $unit"))
    }
  }

  /** 0.342 → 34.2% (short: 34%). */
  fun percent(ratio: Double, short: Boolean): List<Seg> {
    val p = ratio * 100.0
    val text = if (short || abs(p) >= 100) p.roundToLong().toString() else oneDecimal(p)
    return listOf(Seg(text), Seg("%", PERCENT))
  }

  /** R$2,140 (short: R$2.1K). */
  fun robux(n: Double, short: Boolean): List<Seg> {
    val sign = if (n < 0) "-" else ""
    val a = abs(n)
    return listOf(Seg(sign), Seg("R$", ROBUX), Seg(if (short) countShort(a) else grouped(a))).filter { it.text.isNotEmpty() }
  }

  /** 45s, 18m 40s, 2h 5m. */
  fun seconds(sec: Double): List<Seg> {
    if (sec < 0) return listOf(Seg(DASH))
    val s = sec.roundToLong()
    return when {
      s < 60 -> listOf(Seg("$s"), Seg("s", TIME))
      s < 3600 -> listOf(Seg("${s / 60}"), Seg("m", TIME), Seg(" ${s % 60}"), Seg("s", TIME))
      else -> listOf(Seg("${s / 3600}"), Seg("h", TIME), Seg(" ${(s % 3600) / 60}"), Seg("m", TIME))
    }
  }

  /** 1,240 h, 4.5 h, 35 m (short: 12K h from 10,000). */
  fun hours(h: Double, short: Boolean): List<Seg> {
    if (h < 0) return listOf(Seg(DASH))
    return when {
      short && h >= 10_000 -> listOf(Seg(countShort(h)), Seg(" h", TIME))
      h >= 10 -> listOf(Seg(String.format(US, "%,d", floor(h).toLong())), Seg(" h", TIME))
      h >= 1 -> listOf(Seg(oneDecimal(h)), Seg(" h", TIME))
      else -> listOf(Seg("${(h * 60).roundToLong()}"), Seg(" m", TIME))
    }
  }

  /**
   * The change against the period before: ratios in points (▲1.1 / ▼2.4), everything else in percent (▲6% / ▼14%);
   * `up` / `down` coloured, ±0 in `text2`. Null when either number is missing or [prev] is 0 (no percentage).
   */
  fun delta(unit: String?, v: Double?, prev: Double?): Seg? {
    if (v == null || prev == null || v.isNaN() || prev.isNaN() || v.isInfinite() || prev.isInfinite()) return null
    if (unit == "ratio") {
      val d = (v - prev) * 100.0
      val text = oneDecimal(abs(d))
      if (text == "0") return Seg("±0", "text2")
      return if (d > 0) Seg("▲$text", "up") else Seg("▼$text", "down")
    }
    if (prev == 0.0) return if (v == 0.0) Seg("±0%", "text2") else null
    val pct = (v - prev) / abs(prev) * 100.0
    val r = abs(pct).roundToLong()
    if (r == 0L) return Seg("±0%", "text2")
    val text = if (r > 999) "999+%" else "$r%"
    return if (pct > 0) Seg("▲$text", "up") else Seg("▼$text", "down")
  }

  /** 1,830 */
  fun grouped(v: Double): String = String.format(US, "%,d", v.roundToLong())

  /** 214, 1.2K, 12K, 1.5M (like Fmt.count, for any size). */
  fun countShort(v: Double): String {
    val sign = if (v < 0) "-" else ""
    val a = abs(v)
    return sign + when {
      a < 999.5 -> a.roundToLong().toString()
      a < 9_950.0 -> oneDecimal(a / 1_000.0) + "K"
      a < 999_500.0 -> (a / 1_000.0).roundToLong().toString() + "K"
      a < 9_950_000.0 -> oneDecimal(a / 1_000_000.0) + "M"
      else -> (a / 1_000_000.0).roundToLong().toString() + "M"
    }
  }

  /** An integer grouped, else up to two decimals. */
  fun number(v: Double): String =
    if (v % 1.0 == 0.0 && abs(v) < 1e15) grouped(v) else String.format(US, "%,.2f", v).trimEnd('0').trimEnd('.')

  private fun oneDecimal(v: Double): String {
    val s = String.format(US, "%.1f", v)
    return if (s.endsWith(".0")) s.dropLast(2) else s
  }

  // endregion

  // region catalog

  /** The unit of a metric id when the backend doesn't say (`revenue:72h` → robux). */
  fun unitOf(id: String): String? = when (id.substringBefore(':')) {
    "ccu", "servers", "peakToday", "dau", "wau", "mau", "new", "sessions", "payers" -> "count"
    "d1", "d7" -> "ratio"
    "session" -> "seconds"
    "playtime" -> "hours"
    "revenue" -> "robux"
    else -> null
  }

  /** The label of a metric id when the backend doesn't send one (the same wording as the backend's). */
  fun label(id: String): String {
    val base = id.substringBefore(':')
    val window = if (id.contains(':')) " " + id.substringAfter(':') else ""
    return when (base) {
      "ccu" -> "CCU"
      "servers" -> "Servers"
      "peakToday" -> "Peak today"
      "dau" -> "DAU"
      "wau" -> "WAU"
      "mau" -> "MAU"
      "d1" -> "D1"
      "d7" -> "D7"
      "new" -> "New$window"
      "session" -> "Session$window"
      "playtime" -> "Playtime$window"
      "sessions" -> "Sessions$window"
      "revenue" -> "Revenue$window"
      "payers" -> "Payers$window"
      else -> id
    }
  }

  /**
   * A slot's numbers from the answer's other fields when its `metrics` lacks the id (an older backend): the top-level
   * CCU, servers and peak, and the last hour's sessions.
   */
  fun fallback(id: String, data: LiveData?): Metric? {
    if (data == null) return null
    val lh = data.lastHour
    return when (id) {
      "ccu" -> data.ccu?.let { c -> Metric(c.toDouble(), data.delta?.let { (c - it).toDouble() }, "count", null) }
      "servers" -> data.servers?.let { Metric(it.toDouble(), null, "count", null) }
      "peakToday" -> data.peakToday?.let { Metric(it.toDouble(), null, "count", null) }
      "session:1h" -> lh?.avgSessionSeconds?.let { Metric(it, null, "seconds", null) }
      "playtime:1h" -> lh?.playtimeHours?.let { Metric(it, null, "hours", null) }
      "sessions:1h" -> lh?.sessionsEnded?.let { Metric(it.toDouble(), null, "count", null) }
      else -> null
    }
  }

  // endregion
}
