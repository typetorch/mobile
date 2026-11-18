package dev.typetorch.live

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * All-games widgets (backend id [Store.ALL]; docs/WIDGET_SPEC.md, All games). Every signed-in backend is fetched and
 * cached on its own as usual; drawing merges the cached answers into one live object:
 * - `game.name`: "All games", or the picked game's name; `game.iconUrl`: the picked game's, else null;
 * - `releases` and `metrics.releases` (the same merged object): per-day `p` / `d` summed over all games (or only the
 *   picked one) from each answer's top-level `releases` (else its `metrics.releases`), the counts, `lastProd` and the
 *   cell tokens recomputed with the backend's rule; the picked game's other metrics too;
 * - `ccu`, `servers`, `delta`: summed (or the picked game's); `peakToday`, `lastHour` and the series only when picked;
 * - `games`: up to [MAX_GAMES] `{ id, name, iconUrl, picked: "1" | "", alpha: "1" | "0.4" }` (the app's order);
 * - `filter`: the picked backend id (absent: all games); `allGames`: "1".
 * Any thread, no network.
 */
internal object AllGames {
  const val MAX_GAMES = 6
  const val NAME = "All games"
  private const val RELEASES = "releases"

  /** The cell token of a day before a game's deploy history began (drawn as nothing). */
  private const val NONE = "rnone"

  /** What an all-games widget draws. [snap] null: no backend has answered yet ([anyFailed]: and some fetch failed). */
  class View(
    val snap: Snapshot?,
    val anyFailed: Boolean,
    val picked: Backend?,
    /** `games[]` in order: `toggle:games.N` picks `games[N]`. */
    val games: List<Backend>,
  )

  /** The backends whose token isn't dead (the ones an all-games widget fetches). */
  fun signedIn(ctx: Context): List<Backend> = Store.backends(ctx).filter { !Store.isDead(ctx, it.id, it.token) }

  fun forWidget(ctx: Context, widgetId: Int): View = view(ctx, Store.widgetFilter(ctx, widgetId))

  /** The merged view, filtered to [filterId] (a backend id; null, unknown or signed out: all games). */
  fun view(ctx: Context, filterId: String?): View {
    val backends = signedIn(ctx)
    val snaps = HashMap<String, Snapshot>()
    for (b in backends) {
      val s = Store.snapshot(ctx, b.id)
      if (s != null) snaps[b.id] = s
    }
    val picked = if (filterId == null) null else backends.firstOrNull { it.id == filterId }
    val games = backends.take(MAX_GAMES)
    val withData = backends.filter { snaps[it.id]?.data != null }
    if (withData.isEmpty()) return View(null, snaps.values.any { it.failedAt > 0L }, picked, games)
    val scope: List<Backend> = if (picked != null) listOf(picked) else withData
    val scopeSnaps = scope.mapNotNull { b -> snaps[b.id]?.takeIf { it.data != null } }
    val datas = scopeSnaps.mapNotNull { it.data }

    // games[]
    val arr = JSONArray()
    for (g in games) {
      val d = snaps[g.id]?.data
      val on = picked != null && picked.id == g.id
      arr.put(
        JSONObject()
          .put("id", g.id)
          .put("name", gameName(d, g))
          .put("iconUrl", d?.iconUrl ?: JSONObject.NULL)
          .put("picked", if (on) "1" else "")
          .put("alpha", if (picked == null || on) "1" else "0.4"),
      )
    }
    val extra = JSONObject().put("games", arr).put("allGames", "1")
    if (picked != null) extra.put("filter", picked.id)

    // metrics: the picked game's, with `releases` merged (recomputed) in either case.
    val metrics = LinkedHashMap<String, Metric>()
    val pickedData = picked?.let { snaps[it.id]?.data }
    if (pickedData != null) metrics.putAll(pickedData.metrics)
    val inputs = ArrayList<Pair<String, Metric>>()
    for (b in scope) {
      val d = snaps[b.id]?.data ?: continue
      val m = releasesOf(d) ?: continue
      inputs.add(gameName(d, b) to m)
    }
    val releases = mergeReleases(inputs)
    if (releases != null) metrics[RELEASES] = releases else metrics.remove(RELEASES)
    // The top-level `releases` too (what the widget HTML reads: every answer carries it, a metric may not).
    if (releases != null) extra.put(RELEASES, releases.toJson())

    val merged = LiveData(
      gameName = if (picked != null) gameName(pickedData, picked) else NAME,
      universeId = pickedData?.universeId,
      ccu = sum(datas) { it.ccu },
      servers = sum(datas) { it.servers },
      delta = sum(datas) { it.delta },
      peakToday = pickedData?.peakToday,
      series = pickedData?.series.orEmpty(),
      lastHour = pickedData?.lastHour,
      iconUrl = pickedData?.iconUrl,
      metrics = metrics,
      extra = extra,
    )
    // `updated` is the oldest answer's time; offline when any of them is stale.
    val okAt = scopeSnaps.filter { it.okAt > 0L }.minOfOrNull { it.okAt } ?: 0L
    val stale = scopeSnaps.any { it.stale }
    val failedAt = if (stale) maxOf(okAt + 1L, scopeSnaps.maxOf { it.failedAt }) else 0L
    return View(Snapshot(merged, okAt, failedAt), false, picked, games)
  }

  /**
   * A game's releases: the answer's top-level `releases` (every answer carries it, the live watch's polls too), else
   * `metrics.releases`.
   */
  private fun releasesOf(d: LiveData): Metric? {
    val top = d.extra?.optJSONObject(RELEASES)
    if (top != null) {
      try {
        return Metric.fromJson(top)
      } catch (t: Throwable) {
        // a bad field: the metric's
      }
    }
    return d.metrics[RELEASES]
  }

  private fun gameName(d: LiveData?, b: Backend): String =
    d?.gameName?.takeIf { it.isNotBlank() } ?: b.name.takeIf { it.isNotBlank() } ?: NAME

  private fun sum(datas: List<LiveData>, sel: (LiveData) -> Int?): Int? {
    var any = false
    var total = 0L
    for (d in datas) {
      val v = sel(d) ?: continue
      any = true
      total += v
    }
    return if (any) total.coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt() else null
  }

  // region releases

  /** docs/WIDGET_RELEASES.md: 0 for 0, 1 for 1, 2 for 2–3, 3 for 4+. */
  private fun level(n: Int): Int = when {
    n <= 0 -> 0
    n == 1 -> 1
    n <= 3 -> 2
    else -> 3
  }

  private class Day(val key: String, val date: String?)

  /** A day's key: its date, else its position from the end (`#0` = the last day). */
  private fun dayKey(o: JSONObject?, i: Int, n: Int): String {
    val date = o?.optString("date", "")?.trim().orEmpty()
    return if (date.isNotEmpty() && date != "null") date else "#" + (n - 1 - i)
  }

  private fun count(o: JSONObject?, key: String): Int {
    if (o == null || !o.has(key) || o.isNull(key)) return 0
    val v = o.opt(key)
    val d = when (v) {
      is Number -> v.toDouble()
      is String -> v.toDoubleOrNull() ?: 0.0
      else -> 0.0
    }
    if (d.isNaN() || d <= 0.0) return 0
    return if (d > 1_000_000.0) 1_000_000 else d.toInt()
  }

  /**
   * The `releases` metrics of several games ([inputs]: game name, metric) as one: per-day `p` / `d` summed by date on
   * the days of the game whose last day is the newest (the backend sends 182), the counts recomputed from those days,
   * `lastProd` from the newest prod day, `lastProdLabel` (and `lastProdGame`) from the game that made it, the cell
   * tokens by the backend's rule. A day no game has history for (every game's cell for it is `rnone`, or the game has
   * no such day: before its deploy history began) stays `rnone` / `rnone` (blank, not a grey square). Null when no game
   * has the metric.
   */
  fun mergeReleases(inputs: List<Pair<String, Metric>>): Metric? {
    if (inputs.isEmpty()) return null
    // The axis: the days of the game whose last day is the newest (string order works for ISO dates).
    var axisArr: JSONArray? = null
    var axisLast = ""
    for ((_, m) in inputs) {
      val days = m.extra?.optJSONArray("days") ?: continue
      if (days.length() == 0) continue
      val last = dayKey(days.optJSONObject(days.length() - 1), days.length() - 1, days.length())
      if (axisArr == null || last > axisLast) {
        axisArr = days
        axisLast = last
      }
    }
    val label = inputs.firstNotNullOfOrNull { it.second.label } ?: "Releases"
    val ax = axisArr
    val out = JSONObject()
    if (ax == null) {
      // No game sends days (an older backend): the totals summed, nothing per day.
      var prod = 0
      var dev = 0
      var prod30 = 0
      var dev30 = 0
      for ((_, m) in inputs) {
        val x = m.extra
        prod += if (x != null && x.has("prod")) count(x, "prod") else (m.value ?: 0.0).toInt().coerceAtLeast(0)
        dev += count(x, "dev")
        prod30 += count(x, "prod30")
        dev30 += count(x, "dev30")
      }
      out.put("prod", prod).put("dev", dev).put("prod30", prod30).put("dev30", dev30)
      if (inputs.size == 1) {
        val x = inputs[0].second.extra
        out.put("lastProd", x?.opt("lastProd") ?: JSONObject.NULL)
        out.put("lastProdLabel", x?.opt("lastProdLabel") ?: JSONObject.NULL)
      } else {
        out.put("lastProd", JSONObject.NULL).put("lastProdLabel", JSONObject.NULL)
      }
      out.put("days", JSONArray())
      return Metric(prod.toDouble(), null, "count", label, out)
    }
    val n = minOf(ax.length(), 400)
    val start = ax.length() - n
    val axis = ArrayList<Day>(n)
    val index = HashMap<String, Int>()
    for (i in start until ax.length()) {
      val o = ax.optJSONObject(i)
      val key = dayKey(o, i, ax.length())
      index[key] = axis.size
      axis.add(Day(key, if (key.startsWith("#")) null else key))
    }
    val p = IntArray(n)
    val d = IntArray(n)
    // Per axis day: some game has history for it (a day of its own whose cell isn't "rnone").
    val history = BooleanArray(n)
    // Per game: the axis index of its newest prod day (for lastProdLabel).
    var bestAt = -1
    var bestLabel: Any? = null
    var bestGame: String? = null
    for ((game, m) in inputs) {
      val days = m.extra?.optJSONArray("days") ?: continue
      var newest = -1
      for (i in 0 until days.length()) {
        val o = days.optJSONObject(i) ?: continue
        val at = index[dayKey(o, i, days.length())] ?: continue
        if (o.optString("bg", "") != NONE) history[at] = true
        val dp = count(o, "p")
        p[at] += dp
        d[at] += count(o, "d")
        if (dp > 0 && at > newest) newest = at
      }
      if (newest > bestAt) {
        bestAt = newest
        bestLabel = m.extra?.opt("lastProdLabel")
        bestGame = game
      }
    }
    val daysOut = JSONArray()
    var prod = 0
    var dev = 0
    var prod30 = 0
    var dev30 = 0
    var lastProdAt = -1
    for (i in 0 until n) {
      val pi = p[i]
      val di = d[i]
      prod += pi
      dev += di
      if (i >= n - 30) {
        prod30 += pi
        dev30 += di
      }
      if (pi > 0) lastProdAt = i
      val bg: String
      val tri: String
      if (pi > 0) {
        bg = "rg" + level(pi)
        tri = if (di > 0) "rb" + level(di) else "rnone"
      } else if (di > 0) {
        bg = "rb" + level(di)
        tri = NONE
      } else if (history[i]) {
        bg = "r0"
        tri = NONE
      } else {
        bg = NONE
        tri = NONE
      }
      val day = JSONObject()
      val date = axis[i].date
      if (date != null) day.put("date", date)
      day.put("p", pi).put("d", di).put("bg", bg).put("tri", tri)
      daysOut.put(day)
    }
    val lastProd: Any = when {
      lastProdAt < 0 -> JSONObject.NULL
      lastProdAt == n - 1 -> "today"
      else -> "${n - 1 - lastProdAt} d ago"
    }
    val labelOut = bestLabel
    out.put("prod", prod).put("dev", dev).put("prod30", prod30).put("dev30", dev30)
    out.put("lastProd", lastProd)
    out.put("lastProdLabel", if (bestAt >= 0 && labelOut != null) labelOut else JSONObject.NULL)
    out.put("lastProdGame", if (bestAt >= 0) bestGame ?: JSONObject.NULL else JSONObject.NULL)
    out.put("days", daysOut)
    return Metric(prod.toDouble(), null, "count", label, out)
  }

  // endregion
}
