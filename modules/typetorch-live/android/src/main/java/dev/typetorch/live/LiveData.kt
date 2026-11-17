package dev.typetorch.live

import org.json.JSONArray
import org.json.JSONObject
import java.util.TreeMap
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** One minute of the CCU line (`series[]` of `GET /v1/mobile/live`). */
internal data class Point(val t: Long, val ccu: Int)

/** `lastHour` of `GET /v1/mobile/live`; every field may be null. */
internal data class LastHour(
  val avgSessionSeconds: Double?,
  val medianSessionSeconds: Double?,
  val sessionsEnded: Int?,
  val playtimeHours: Double?,
)

/**
 * One entry of `metrics` (docs/WIDGET_STATS.md): [value] in [unit] (`count`, `ratio`, `robux`, `seconds`, `hours`, or
 * something newer), [prev] the same for the window before; any field may be null.
 */
internal data class Metric(val value: Double?, val prev: Double?, val unit: String?, val label: String?) {
  fun toJson(): JSONObject = JSONObject()
    .put("value", value ?: JSONObject.NULL)
    .put("prev", prev ?: JSONObject.NULL)
    .put("unit", unit ?: JSONObject.NULL)
    .put("label", label ?: JSONObject.NULL)

  companion object {
    fun fromJson(o: JSONObject): Metric = Metric(
      value = o.numOrNull("value"),
      prev = o.numOrNull("prev"),
      unit = o.strOrNull("unit")?.takeIf { it.isNotBlank() },
      label = o.strOrNull("label")?.takeIf { it.isNotBlank() },
    )
  }
}

/**
 * The parsed answer of `GET /v1/mobile/live` (docs/PUSH_WATCH_WIDGETS.md, section 1; docs/WIDGET_STATS.md). Parsing is
 * lenient: a missing or null field becomes null, a bad series point or metric is skipped, so an older backend (no
 * `metrics`, no `game.iconUrl`) still parses. [toJson] writes the same shape back (the cache uses it), including the
 * top-level fields this build doesn't know ([extra]), so the widget spec's path bindings can reach them.
 */
internal data class LiveData(
  val gameName: String?,
  val universeId: Long?,
  val ccu: Int?,
  val servers: Int?,
  val delta: Int?,
  val peakToday: Int?,
  val series: List<Point>,
  val lastHour: LastHour?,
  val iconUrl: String? = null,
  /** Metric id → its numbers (absent: not asked, or the backend doesn't know it). */
  val metrics: Map<String, Metric> = emptyMap(),
  /** Top-level fields of the answer this build doesn't parse (kept for `{path}` bindings). */
  val extra: JSONObject? = null,
) {
  /** The points of the last [windowMs] before the newest one. */
  fun seriesWindow(windowMs: Long): List<Point> {
    if (series.isEmpty()) return series
    val cutoff = series.last().t - windowMs
    return series.filter { it.t >= cutoff }
  }

  fun toJson(): JSONObject = toJson(true)

  /** The answer's shape; without the series when [withSeries] is false (the bindings' path lookups). */
  fun toJson(withSeries: Boolean): JSONObject {
    val o = JSONObject()
    val x = extra
    if (x != null) {
      val keys = x.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        if (k !in KNOWN) o.put(k, x.opt(k))
      }
    }
    val game = JSONObject()
    game.put("name", gameName ?: JSONObject.NULL)
    game.put("universeId", universeId ?: JSONObject.NULL)
    game.put("iconUrl", iconUrl ?: JSONObject.NULL)
    o.put("game", game)
    o.put("ccu", ccu ?: JSONObject.NULL)
    o.put("servers", servers ?: JSONObject.NULL)
    o.put("delta", delta ?: JSONObject.NULL)
    o.put("peakToday", peakToday ?: JSONObject.NULL)
    if (withSeries) {
      val arr = JSONArray()
      for (p in series) arr.put(JSONObject().put("t", p.t).put("ccu", p.ccu))
      o.put("series", arr)
    }
    val lh = lastHour
    if (lh != null) {
      val l = JSONObject()
      l.put("avgSessionSeconds", lh.avgSessionSeconds ?: JSONObject.NULL)
      l.put("medianSessionSeconds", lh.medianSessionSeconds ?: JSONObject.NULL)
      l.put("sessionsEnded", lh.sessionsEnded ?: JSONObject.NULL)
      l.put("playtimeHours", lh.playtimeHours ?: JSONObject.NULL)
      o.put("lastHour", l)
    } else {
      o.put("lastHour", JSONObject.NULL)
    }
    val m = JSONObject()
    for ((id, metric) in metrics) m.put(id, metric.toJson())
    o.put("metrics", m)
    return o
  }

  companion object {
    private val KNOWN = setOf("game", "ccu", "servers", "delta", "peakToday", "series", "lastHour", "metrics")

    /** An unknown field bigger than this (as JSON text) isn't kept in the cache. */
    private const val MAX_EXTRA_CHARS = 16_000
    private const val MAX_METRICS = 32

    /** Null when [text] is not a JSON object. */
    fun parse(text: String): LiveData? = try {
      fromJson(JSONObject(text))
    } catch (t: Throwable) {
      null
    }

    fun fromJson(o: JSONObject): LiveData {
      val game = o.optJSONObject("game")
      val series = ArrayList<Point>()
      val arr = o.optJSONArray("series")
      if (arr != null) {
        for (i in 0 until arr.length()) {
          val p = arr.optJSONObject(i) ?: continue
          val t = p.numOrNull("t")?.roundToLong() ?: continue
          val ccu = p.numOrNull("ccu")?.roundToInt() ?: continue
          series.add(Point(t, ccu))
        }
      }
      series.sortBy { it.t }
      val lh = o.optJSONObject("lastHour")?.let { l ->
        LastHour(
          avgSessionSeconds = l.numOrNull("avgSessionSeconds"),
          medianSessionSeconds = l.numOrNull("medianSessionSeconds"),
          sessionsEnded = l.numOrNull("sessionsEnded")?.roundToInt(),
          playtimeHours = l.numOrNull("playtimeHours"),
        )
      }
      val metrics = LinkedHashMap<String, Metric>()
      o.optJSONObject("metrics")?.let { mo ->
        val keys = mo.keys()
        while (keys.hasNext() && metrics.size < MAX_METRICS) {
          val id = keys.next()
          val e = mo.optJSONObject(id) ?: continue // null: unknown metric
          try {
            metrics[id] = Metric.fromJson(e)
          } catch (t: Throwable) {
            // a bad entry: skipped
          }
        }
      }
      var extra: JSONObject? = null
      val keys = o.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        if (k in KNOWN) continue
        val v = o.opt(k) ?: continue
        if (v == JSONObject.NULL) continue
        if ((v is JSONObject || v is JSONArray) && v.toString().length > MAX_EXTRA_CHARS) continue
        if (v is String && v.length > MAX_EXTRA_CHARS) continue
        if (extra == null) extra = JSONObject()
        extra.put(k, v)
      }
      return LiveData(
        gameName = game?.strOrNull("name"),
        universeId = game?.numOrNull("universeId")?.roundToLong(),
        ccu = o.numOrNull("ccu")?.roundToInt(),
        servers = o.numOrNull("servers")?.roundToInt(),
        delta = o.numOrNull("delta")?.roundToInt(),
        peakToday = o.numOrNull("peakToday")?.roundToInt(),
        series = series,
        lastHour = lh,
        iconUrl = game?.strOrNull("iconUrl")?.trim()?.takeIf { it.startsWith("https://", true) || it.startsWith("http://", true) },
        metrics = metrics,
        extra = extra,
      )
    }

    /** [older] and [newer] merged by timestamp (newer wins), trimmed to [windowMs] before the newest point. */
    fun mergeSeries(older: List<Point>, newer: List<Point>, windowMs: Long): List<Point> {
      val byTime = TreeMap<Long, Int>()
      for (p in older) byTime[p.t] = p.ccu
      for (p in newer) byTime[p.t] = p.ccu
      if (byTime.isEmpty()) return emptyList()
      val cutoff = byTime.lastKey() - windowMs
      return byTime.tailMap(cutoff, true).map { Point(it.key, it.value) }
    }
  }
}

private fun JSONObject.numOrNull(key: String): Double? {
  if (!has(key) || isNull(key)) return null
  val d = when (val v = opt(key)) {
    is Number -> v.toDouble()
    is String -> v.toDoubleOrNull()
    else -> null
  } ?: return null
  return if (d.isNaN() || d.isInfinite()) null else d
}

private fun JSONObject.strOrNull(key: String): String? {
  if (!has(key) || isNull(key)) return null
  return opt(key)?.toString()
}
