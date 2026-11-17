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
 * The parsed answer of `GET /v1/mobile/live` (docs/PUSH_WATCH_WIDGETS.md, section 1). Parsing is lenient: a missing or
 * null field becomes null, a bad series point is skipped. [toJson] writes the same shape back (the cache uses it).
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
) {
  /** The points of the last [windowMs] before the newest one. */
  fun seriesWindow(windowMs: Long): List<Point> {
    if (series.isEmpty()) return series
    val cutoff = series.last().t - windowMs
    return series.filter { it.t >= cutoff }
  }

  fun toJson(): JSONObject {
    val o = JSONObject()
    val game = JSONObject()
    game.put("name", gameName ?: JSONObject.NULL)
    game.put("universeId", universeId ?: JSONObject.NULL)
    o.put("game", game)
    o.put("ccu", ccu ?: JSONObject.NULL)
    o.put("servers", servers ?: JSONObject.NULL)
    o.put("delta", delta ?: JSONObject.NULL)
    o.put("peakToday", peakToday ?: JSONObject.NULL)
    val arr = JSONArray()
    for (p in series) arr.put(JSONObject().put("t", p.t).put("ccu", p.ccu))
    o.put("series", arr)
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
    return o
  }

  companion object {
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
      return LiveData(
        gameName = game?.strOrNull("name"),
        universeId = game?.numOrNull("universeId")?.roundToLong(),
        ccu = o.numOrNull("ccu")?.roundToInt(),
        servers = o.numOrNull("servers")?.roundToInt(),
        delta = o.numOrNull("delta")?.roundToInt(),
        peakToday = o.numOrNull("peakToday")?.roundToInt(),
        series = series,
        lastHour = lh,
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
