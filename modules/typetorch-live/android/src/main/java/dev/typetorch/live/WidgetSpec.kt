package dev.typetorch.live

import android.content.Context
import android.graphics.Color
import org.json.JSONObject

/**
 * The widget's look as data (docs/WIDGET_SPEC.md): the app's JS sends a JSON spec (`setWidgetSpec`), [WidgetRenderer]
 * draws it as one bitmap. Parsing is strict about the structure (a bad spec is rejected by setWidgetSpec and never
 * drawn) and lenient about values (an unknown element type is skipped, a bad colour falls back to the token default).
 */

/** Sides in dp. `start`/`end` are left/right (the widget is drawn left to right). */
internal class Edges(val start: Float, val top: Float, val end: Float, val bottom: Float) {
  val horizontal: Float get() = start + end
  val vertical: Float get() = top + bottom

  companion object {
    val ZERO = Edges(0f, 0f, 0f, 0f)
  }
}

/** A filled rounded rectangle: [color] is a token or hex; [radius] in dp, or the launcher's radius when [system]. */
internal class Fill(val color: String, val radius: Float, val system: Boolean)

/** One element. A single class for every type keeps the parser and renderer short; each type reads its own fields. */
internal class Node(
  val type: String,
  val children: List<Node>,
  val weight: Float,
  val width: Float?,
  val height: Float?,
  val padding: Edges,
  val margin: Edges,
  val gap: Float,
  /** Containers: cross-axis alignment. Text: text alignment. */
  val align: String?,
  val justify: String?,
  val alignSelf: String?,
  val gravity: String?,
  val showIf: String?,
  val background: Fill?,
  // text
  val text: String,
  val size: Float,
  val fontWeight: Int,
  val color: String?,
  val maxLines: Int,
  val ellipsis: Boolean,
  // chart
  val minutes: Int,
  val stroke: Float,
  /** Null: no fill; "auto": the line colour, faded; else a colour. */
  val fill: String?,
  val dot: Boolean,
  /** The value axis starts at 0 (else it fits the low and high values). */
  val zero: Boolean,
  /** Points averaged into buckets of this many minutes (0 / 1: every point). */
  val bucket: Int,
  /** A curve through the points instead of straight segments. */
  val smooth: Boolean,
  /** Value labels and light grid lines (top and middle) on the left. */
  val labels: Boolean,
  // icon
  val icon: String,
  // divider
  val thickness: Float,
  // image (and chart): the binding it shows
  val bind: String?,
  // image: corner radius in dp, the colour drawn while the picture is missing (null: nothing)
  val radius: Float,
  val placeholder: String?,
  // svg: the markup template (filled per draw, see [Svg]) and how its viewBox maps to the box
  val svg: String,
  /** `fill` (stretched), `contain` (meet) or `cover` (slice). */
  val fit: String,
  /**
   * What a tap on the element's box does (Android 12+): `open`, `refresh`, `toggle:games.N` or `action:…` (a widget
   * program's tap, `{…}` filled when drawn; nothing without a program); null: nothing of its
   * own (the whole widget's tap). See [WidgetSpecs.TAP].
   */
  val tap: String? = null,
)

/** One size class of one state. */
internal class SizeLayout(
  val minWidth: Float,
  val minHeight: Float,
  val background: Fill,
  val refresh: String,
  val description: String?,
  val root: Node,
)

internal class WidgetSpec(
  val version: Int,
  val day: Map<String, Int>,
  val night: Map<String, Int>,
  val strings: Map<String, String>,
  val layouts: Map<String, List<SizeLayout>>,
  /** Decimals of ratios (retention) as a percent and of their change in points. */
  val ratioDecimals: Int = 2,
)

internal object WidgetSpecs {
  const val VERSION = 1
  const val DATA = "data"
  const val LOADING = "loading"
  const val UNREACHABLE = "unreachable"
  const val SIGNED_OUT = "signedOut"
  const val PICK = "pick"
  private val STATES = listOf(DATA, LOADING, UNREACHABLE, SIGNED_OUT, PICK)
  private val CORNERS = setOf("topEnd", "topStart", "bottomEnd", "bottomStart", "none")

  /** The `tap` values this build knows; anything else is ignored (a newer spec's tap degrades to no tap). */
  val TAP = Regex("^(open|refresh|toggle:games\\.[0-9]{1,2}|action:[^\\r\\n]{0,200})$")

  private const val MAX_DEPTH = 24
  private const val MAX_NODES = 400
  private const val MAX_JSON_CHARS = 200_000

  /** Built-in colours (the same as res/values and res/values-night); a spec's `tokens` override them. */
  private val BASE_DAY = mapOf(
    "bg" to 0xF7FFFFFF.toInt(),
    "text" to 0xFF1B1B1F.toInt(),
    "text2" to 0xFF5F6368.toInt(),
    "brand" to 0xFFFB7A32.toInt(),
    "up" to 0xFF2E9D57.toInt(),
    "down" to 0xFFD64545.toInt(),
    "divider" to 0x1F000000,
    "unitTime" to 0xFFE2700F.toInt(),
    "unitPercent" to 0xFF1F6FD1.toInt(),
    "unitRobux" to 0xFF1F8A4C.toInt(),
  )
  private val BASE_NIGHT = mapOf(
    "bg" to 0xF21E1E22.toInt(),
    "text" to 0xFFECECEE.toInt(),
    "text2" to 0xFFA8A8AD.toInt(),
    "brand" to 0xFFFB7A32.toInt(),
    "up" to 0xFF4CC27A.toInt(),
    "down" to 0xFFF06A6A.toInt(),
    "divider" to 0x33FFFFFF,
    "unitTime" to 0xFFFB923C.toInt(),
    "unitPercent" to 0xFF5AA9FF.toInt(),
    "unitRobux" to 0xFF4CC27A.toInt(),
  )
  private val BASE_STRINGS = mapOf("refreshing" to "refreshing…", "offline" to "offline · {updated}")

  /** The built-in spec. Throws (on every access) only if DEFAULT_JSON is broken; callers catch and use the plain layout. */
  val default: WidgetSpec by lazy { parse(DEFAULT_JSON) }

  private class Cached(val json: String, val spec: WidgetSpec?)

  @Volatile
  private var cached: Cached? = null

  /** The spec the app sent (parsed once per change), or null: none sent, or it doesn't parse. */
  fun stored(ctx: Context): WidgetSpec? {
    val json = try {
      Store.widgetSpecJson(ctx)
    } catch (t: Throwable) {
      null
    } ?: return null
    val c = cached
    if (c != null && c.json == json) return c.spec
    val spec = try {
      parse(json)
    } catch (t: Throwable) {
      Log.w("stored widget spec invalid", t)
      null
    }
    cached = Cached(json, spec)
    return spec
  }

  /** Null when [json] is a spec this renderer can draw, else why not (shown to the app's JS; never holds tokens). */
  fun validate(json: String): String? = try {
    parse(json)
    null
  } catch (t: Throwable) {
    t.message ?: t.javaClass.simpleName
  }

  /** The palette of a mode: built-in colours, then the default spec's tokens, then [spec]'s. */
  fun palette(spec: WidgetSpec, night: Boolean): Map<String, Int> {
    val out = HashMap(if (night) BASE_NIGHT else BASE_DAY)
    try {
      if (spec !== default) out.putAll(if (night) default.night else default.day)
    } catch (t: Throwable) {
      // a broken built-in spec: the base colours
    }
    out.putAll(if (night) spec.night else spec.day)
    return out
  }

  fun string(spec: WidgetSpec, key: String): String {
    spec.strings[key]?.let { return it }
    try {
      default.strings[key]?.let { return it }
    } catch (t: Throwable) {
      // fall through
    }
    return BASE_STRINGS[key] ?: ""
  }

  /**
   * The layout of [state] for a widget of [w] x [h] dp: among the entries whose minimums fit, the one with the largest
   * minWidth x minHeight; none fits: the smallest. A state the spec lacks comes from the built-in default.
   */
  fun pick(spec: WidgetSpec, state: String, w: Float, h: Float): SizeLayout {
    val list = spec.layouts[state]?.takeIf { it.isNotEmpty() }
      ?: (if (spec !== default) default.layouts[state]?.takeIf { it.isNotEmpty() } else null)
      ?: spec.layouts[DATA]?.takeIf { it.isNotEmpty() }
      ?: throw IllegalStateException("no layout for $state")
    val fits = list.filter { it.minWidth <= w && it.minHeight <= h }
    return fits.maxByOrNull { it.minWidth * it.minHeight } ?: list.minByOrNull { it.minWidth * it.minHeight } ?: list[0]
  }

  /** The templates of every `svg` element of [spec] (their `<image>` pictures are downloaded ahead of drawing too). */
  fun svgTemplates(spec: WidgetSpec): List<String> {
    val out = ArrayList<String>()
    fun walk(n: Node) {
      if (n.type == "svg" && n.svg.isNotEmpty()) out.add(n.svg)
      for (k in n.children) walk(k)
    }
    for (list in spec.layouts.values) for (l in list) walk(l.root)
    return out
  }

  /** The bindings of every `image` element of [spec] (to download their pictures ahead of drawing). */
  fun imageBinds(spec: WidgetSpec): Set<String> {
    val out = LinkedHashSet<String>()
    fun walk(n: Node) {
      if (n.type == "image") n.bind?.let { out.add(it) }
      for (k in n.children) walk(k)
    }
    for (list in spec.layouts.values) for (l in list) walk(l.root)
    return out
  }

  // region parsing

  fun parse(json: String): WidgetSpec {
    if (json.length > MAX_JSON_CHARS) bad("spec is too large")
    val o = try {
      JSONObject(json)
    } catch (t: Throwable) {
      bad("not a JSON object")
    }
    val version = o.optInt("version", 0)
    if (version < 1) bad("version missing")
    if (version > VERSION) bad("version $version is newer than this app build understands ($VERSION)")
    val tokens = o.optJSONObject("tokens")
    val strings = HashMap<String, String>()
    o.optJSONObject("strings")?.let { s ->
      val keys = s.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        str(s, k)?.let { strings[k] = it }
      }
    }
    val layoutsJson = o.optJSONObject("layouts") ?: bad("layouts missing")
    val count = IntArray(1)
    val layouts = HashMap<String, List<SizeLayout>>()
    for (state in STATES) {
      if (!layoutsJson.has(state) || layoutsJson.isNull(state)) continue
      val arr = layoutsJson.optJSONArray(state) ?: bad("layouts.$state is not an array")
      val list = ArrayList<SizeLayout>(arr.length())
      for (i in 0 until arr.length()) {
        val e = arr.optJSONObject(i) ?: bad("layouts.$state[$i] is not an object")
        list.add(sizeLayout(e, "layouts.$state[$i]", count))
      }
      if (list.isNotEmpty()) layouts[state] = list
    }
    if (layouts[DATA].isNullOrEmpty()) bad("layouts.data is empty")
    return WidgetSpec(
      version = version,
      day = colors(tokens?.optJSONObject("day")),
      night = colors(tokens?.optJSONObject("night")),
      strings = strings,
      layouts = layouts,
      ratioDecimals = o.optJSONObject("format")?.optInt("ratioDecimals", 2)?.coerceIn(0, 4) ?: 2,
    )
  }

  private fun bad(why: String): Nothing = throw IllegalArgumentException(why)

  private fun sizeLayout(o: JSONObject, where: String, count: IntArray): SizeLayout {
    val rootJson = o.optJSONObject("root") ?: bad("$where.root missing")
    val refresh = str(o, "refresh") ?: "topEnd"
    return SizeLayout(
      minWidth = num(o, "minWidth")?.coerceAtLeast(0f) ?: 0f,
      minHeight = num(o, "minHeight")?.coerceAtLeast(0f) ?: 0f,
      background = fill(o, "background") ?: Fill("bg", 16f, true),
      refresh = if (refresh in CORNERS) refresh else "topEnd",
      description = str(o, "description"),
      root = node(rootJson, 0, count, "$where.root"),
    )
  }

  private fun node(o: JSONObject, depth: Int, count: IntArray, where: String): Node {
    if (depth > MAX_DEPTH) bad("$where: nested too deep")
    count[0]++
    if (count[0] > MAX_NODES) bad("too many elements (max $MAX_NODES)")
    val type = str(o, "type") ?: ""
    val kids = ArrayList<Node>()
    val arr = o.optJSONArray("children")
    if (arr != null) {
      for (i in 0 until arr.length()) {
        val c = arr.optJSONObject(i) ?: continue
        kids.add(node(c, depth + 1, count, "$where.children[$i]"))
      }
    }
    val height = num(o, "height")?.coerceAtLeast(0f)
    var weight = num(o, "weight")?.coerceAtLeast(0f) ?: 0f
    // A chart or svg without a height fills what is left.
    if ((type == "chart" || type == "svg") && height == null && !o.has("weight")) weight = 1f
    // An svg template too large to draw is dropped (the element draws nothing), not the whole spec.
    val svg = if (type == "svg") str(o, "svg").orEmpty() else ""
    val svgOk = svg.length <= Svg.MAX_TEMPLATE_CHARS
    if (!svgOk) Log.w("svg template too large (${svg.length} chars, max ${Svg.MAX_TEMPLATE_CHARS}): dropped")
    val fit = when (str(o, "fit")) {
      "contain" -> "contain"
      "cover" -> "cover"
      else -> "fill"
    }
    val fill: String? = when (val f = o.opt("fill")) {
      is Boolean -> if (f) "auto" else null
      is String -> f
      null -> if (type == "chart") "auto" else null
      else -> null
    }
    val textDefault = when (type) {
      "icon" -> "text2"
      "divider" -> "divider"
      "chart" -> "brand"
      else -> "text"
    }
    return Node(
      type = type,
      children = kids,
      weight = weight,
      width = num(o, "width")?.coerceAtLeast(0f),
      height = height,
      padding = edges(o, "padding"),
      margin = edges(o, "margin"),
      gap = num(o, "gap")?.coerceAtLeast(0f) ?: 0f,
      align = str(o, "align"),
      justify = str(o, "justify"),
      alignSelf = str(o, "alignSelf"),
      gravity = str(o, "gravity"),
      showIf = str(o, "showIf")?.takeIf { it.isNotBlank() },
      background = fill(o, "background"),
      text = str(o, "text") ?: "",
      size = num(o, "size")?.coerceIn(0f, 200f) ?: when (type) {
        "icon" -> 16f
        "image" -> 22f
        "spacer" -> 0f
        else -> 12f
      },
      fontWeight = fontWeight(o.opt("fontWeight")),
      color = str(o, "color") ?: textDefault,
      maxLines = (num(o, "maxLines")?.toInt() ?: 1).coerceIn(1, 20),
      ellipsis = if (o.has("ellipsis")) o.optBoolean("ellipsis", true) else true,
      minutes = (num(o, "minutes")?.toInt() ?: 360).coerceIn(1, 360),
      stroke = num(o, "stroke")?.coerceIn(0.5f, 12f) ?: 2f,
      fill = fill,
      dot = if (o.has("dot")) o.optBoolean("dot", true) else true,
      zero = if (o.has("zero")) o.optBoolean("zero", true) else true,
      bucket = (num(o, "bucket")?.toInt() ?: 5).coerceIn(0, 60),
      smooth = if (o.has("smooth")) o.optBoolean("smooth", true) else true,
      labels = if (o.has("labels")) o.optBoolean("labels", true) else true,
      icon = str(o, "name") ?: "",
      thickness = num(o, "thickness")?.coerceIn(0f, 50f) ?: 1f,
      bind = str(o, "bind")?.trim()?.takeIf { it.isNotEmpty() } ?: if (type == "image") "game.iconUrl" else null,
      radius = num(o, "radius")?.coerceIn(0f, 500f) ?: if (type == "image") 6f else 0f,
      placeholder = if (o.has("placeholder")) str(o, "placeholder") else if (type == "image") "divider" else null,
      svg = if (svgOk) svg else "",
      fit = fit,
      tap = str(o, "tap")?.trim()?.takeIf { TAP.matches(it) },
    )
  }

  private fun fontWeight(v: Any?): Int = when (v) {
    is Number -> v.toInt().coerceIn(100, 900)
    is String -> when (v.lowercase()) {
      "thin" -> 100
      "light" -> 300
      "medium" -> 500
      "semibold" -> 600
      "bold" -> 700
      "black" -> 900
      else -> v.toIntOrNull()?.coerceIn(100, 900) ?: 400
    }
    else -> 400
  }

  /** A number (all sides) or { top, bottom, start, end, horizontal, vertical }. */
  private fun edges(o: JSONObject, key: String): Edges {
    if (!o.has(key) || o.isNull(key)) return Edges.ZERO
    val v = o.opt(key)
    if (v is Number) {
      val n = v.toFloat().takeIf { it.isFinite() }?.coerceIn(0f, 500f) ?: 0f
      return Edges(n, n, n, n)
    }
    val e = v as? JSONObject ?: return Edges.ZERO
    val h = num(e, "horizontal") ?: 0f
    val vert = num(e, "vertical") ?: 0f
    fun side(k: String, d: Float) = (num(e, k) ?: d).coerceIn(0f, 500f)
    return Edges(side("start", h), side("top", vert), side("end", h), side("bottom", vert))
  }

  /** A colour string, or { color, radius } (radius a number in dp or "system"). */
  private fun fill(o: JSONObject, key: String): Fill? {
    if (!o.has(key) || o.isNull(key)) return null
    return when (val v = o.opt(key)) {
      is String -> Fill(v, 0f, false)
      is JSONObject -> {
        val color = str(v, "color") ?: "bg"
        val system = str(v, "radius") == "system"
        Fill(color, if (system) 16f else (num(v, "radius") ?: 0f).coerceIn(0f, 500f), system)
      }
      else -> null
    }
  }

  private fun colors(o: JSONObject?): Map<String, Int> {
    if (o == null) return emptyMap()
    val out = HashMap<String, Int>()
    val keys = o.keys()
    while (keys.hasNext()) {
      val k = keys.next()
      parseColor(str(o, k))?.let { out[k] = it }
    }
    return out
  }

  /** "#RRGGBB", "#AARRGGBB" or "transparent"; null for anything else (a token name, a typo). */
  fun parseColor(s: String?): Int? {
    if (s == null) return null
    if (s == "transparent") return 0
    if (!s.startsWith("#")) return null
    return try {
      Color.parseColor(s)
    } catch (t: Throwable) {
      null
    }
  }

  private fun num(o: JSONObject, key: String): Float? {
    if (!o.has(key) || o.isNull(key)) return null
    val v = o.opt(key) as? Number ?: return null
    val f = v.toFloat()
    return if (f.isFinite()) f else null
  }

  /** The string at [key]; null when missing or JSON null (org.json's optString would give "null"). */
  private fun str(o: JSONObject, key: String): String? {
    if (!o.has(key) || o.isNull(key)) return null
    val v = o.opt(key)
    return if (v is String) v else v?.toString()
  }

  // endregion

  /**
   * The built-in spec: the same as WIDGET_SPEC in src/features/live/widget-spec.ts (keep them in step). Used until the
   * app sends a spec and whenever the sent one can't be parsed or drawn.
   */
  private const val DEFAULT_JSON = """{"version":1,"layouts":{"data":[{"minWidth":240,"minHeight":120,"root":{"type":"column","padding":{"top":4,"bottom":10,"start":14,"end":6},"children":[{"type":"row","align":"center","children":[{"type":"image","bind":"game.iconUrl","size":22,"radius":6,"placeholder":"divider","margin":{"end":7}},{"type":"text","text":"{game}","size":12,"fontWeight":"medium","color":"text","weight":1},{"type":"text","text":"{status}","size":10,"color":"text2","margin":{"start":6}},{"type":"icon","name":"refresh","size":15,"color":"text2","padding":4}]},{"type":"row","align":"stretch","weight":1,"padding":{"end":8},"margin":{"top":4},"children":[{"type":"column","weight":1,"children":[{"type":"row","align":"baseline","children":[{"type":"text","text":"{ccu}","size":34,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{delta}","size":13,"fontWeight":"bold","color":"delta","margin":{"start":4},"showIf":"delta"}]},{"type":"chart","bind":"series","minutes":360,"bucket":5,"color":"brand","fill":true,"dot":true,"zero":true,"smooth":true,"labels":true,"weight":1,"margin":{"top":2,"bottom":3}},{"type":"text","text":"last 6 h · {serversLabel|no servers} · peak {peakToday}","size":10,"color":"text2"}]},{"type":"column","gap":6,"justify":"center","weight":1,"margin":{"start":12},"children":[{"type":"row","align":"baseline","showIf":"slot.1","children":[{"type":"text","text":"{slot.1.label}","size":10.5,"color":"text2","weight":1},{"type":"text","text":"{slot.1.value}","size":12,"fontWeight":"semibold","color":"text","margin":{"start":8}},{"type":"text","text":"{slot.1.delta}","size":9.5,"fontWeight":"bold","margin":{"start":4},"showIf":"slot.1.delta"}]},{"type":"row","align":"baseline","showIf":"slot.2","children":[{"type":"text","text":"{slot.2.label}","size":10.5,"color":"text2","weight":1},{"type":"text","text":"{slot.2.value}","size":12,"fontWeight":"semibold","color":"text","margin":{"start":8}},{"type":"text","text":"{slot.2.delta}","size":9.5,"fontWeight":"bold","margin":{"start":4},"showIf":"slot.2.delta"}]},{"type":"row","align":"baseline","showIf":"slot.3","children":[{"type":"text","text":"{slot.3.label}","size":10.5,"color":"text2","weight":1},{"type":"text","text":"{slot.3.value}","size":12,"fontWeight":"semibold","color":"text","margin":{"start":8}},{"type":"text","text":"{slot.3.delta}","size":9.5,"fontWeight":"bold","margin":{"start":4},"showIf":"slot.3.delta"}]},{"type":"row","align":"baseline","showIf":"slot.4","children":[{"type":"text","text":"{slot.4.label}","size":10.5,"color":"text2","weight":1},{"type":"text","text":"{slot.4.value}","size":12,"fontWeight":"semibold","color":"text","margin":{"start":8}},{"type":"text","text":"{slot.4.delta}","size":9.5,"fontWeight":"bold","margin":{"start":4},"showIf":"slot.4.delta"}]}]}]}]},"name":"medium","refresh":"topEnd"},{"minWidth":100,"minHeight":115,"root":{"type":"column","padding":{"top":4,"bottom":10,"start":12,"end":6},"children":[{"type":"row","align":"center","children":[{"type":"image","bind":"game.iconUrl","size":20,"radius":6,"placeholder":"divider","margin":{"end":7}},{"type":"text","text":"{game}","size":12,"fontWeight":"medium","color":"text2","weight":1},{"type":"icon","name":"refresh","size":15,"color":"text2","padding":4}]},{"type":"row","align":"baseline","margin":{"top":4},"children":[{"type":"text","text":"{ccu}","size":22,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{delta}","size":12,"fontWeight":"bold","color":"delta","margin":{"start":4},"showIf":"delta"},{"type":"text","text":"· {serversLabel}","size":10,"color":"text2","weight":1,"margin":{"start":4},"showIf":"servers"}]},{"type":"spacer","weight":1},{"type":"row","gap":6,"align":"start","padding":{"end":6},"margin":{"bottom":7},"children":[{"type":"column","weight":1,"showIf":"slot.1","children":[{"type":"text","text":"{slot.1.label}","size":10,"color":"text2"},{"type":"row","align":"baseline","children":[{"type":"text","text":"{slot.1.value}","size":12,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{slot.1.delta}","size":8.5,"fontWeight":"bold","margin":{"start":3},"showIf":"slot.1.delta"}]}]},{"type":"column","weight":1,"showIf":"slot.2","children":[{"type":"text","text":"{slot.2.label}","size":10,"color":"text2"},{"type":"row","align":"baseline","children":[{"type":"text","text":"{slot.2.value}","size":12,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{slot.2.delta}","size":8.5,"fontWeight":"bold","margin":{"start":3},"showIf":"slot.2.delta"}]}]}]},{"type":"row","gap":6,"align":"start","padding":{"end":6},"children":[{"type":"column","weight":1,"showIf":"slot.3","children":[{"type":"text","text":"{slot.3.label}","size":10,"color":"text2"},{"type":"row","align":"baseline","children":[{"type":"text","text":"{slot.3.value}","size":12,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{slot.3.delta}","size":8.5,"fontWeight":"bold","margin":{"start":3},"showIf":"slot.3.delta"}]}]},{"type":"column","weight":1,"showIf":"slot.4","children":[{"type":"text","text":"{slot.4.label}","size":10,"color":"text2"},{"type":"row","align":"baseline","children":[{"type":"text","text":"{slot.4.value}","size":12,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{slot.4.delta}","size":8.5,"fontWeight":"bold","margin":{"start":3},"showIf":"slot.4.delta"}]}]}]}]},"name":"grid","refresh":"topEnd"},{"minWidth":240,"minHeight":60,"root":{"type":"column","padding":{"top":4,"bottom":8,"start":12,"end":6},"children":[{"type":"row","align":"center","children":[{"type":"image","bind":"game.iconUrl","size":18,"radius":6,"placeholder":"divider","margin":{"end":7}},{"type":"text","text":"{game}","size":12,"fontWeight":"medium","color":"text2","weight":1},{"type":"text","text":"{status}","size":10,"color":"text2","margin":{"start":6}},{"type":"icon","name":"refresh","size":15,"color":"text2","padding":4}]},{"type":"row","align":"center","weight":1,"padding":{"end":6},"children":[{"type":"row","align":"baseline","children":[{"type":"text","text":"{ccu}","size":24,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{delta}","size":12,"fontWeight":"bold","color":"delta","margin":{"start":4},"showIf":"delta"}]},{"type":"chart","bind":"series","minutes":360,"bucket":5,"color":"brand","fill":true,"dot":true,"zero":true,"smooth":true,"labels":true,"weight":1,"height":34,"margin":{"start":10,"end":10}},{"type":"column","gap":1,"align":"end","weight":0.9,"children":[{"type":"row","align":"baseline","showIf":"slot.1","children":[{"type":"text","text":"{slot.1.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.1.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.2","children":[{"type":"text","text":"{slot.2.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.2.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.3","children":[{"type":"text","text":"{slot.3.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.3.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.4","children":[{"type":"text","text":"{slot.4.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.4.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]}]}]}]},"name":"wide","refresh":"topEnd"},{"minWidth":100,"minHeight":90,"root":{"type":"column","padding":{"top":4,"bottom":8,"start":12,"end":6},"children":[{"type":"row","align":"center","children":[{"type":"image","bind":"game.iconUrl","size":18,"radius":6,"placeholder":"divider","margin":{"end":7}},{"type":"text","text":"{game}","size":12,"fontWeight":"medium","color":"text2","weight":1},{"type":"text","text":"{status}","size":10,"color":"text2","margin":{"start":6}},{"type":"icon","name":"refresh","size":15,"color":"text2","padding":4}]},{"type":"spacer","weight":1},{"type":"row","align":"center","padding":{"end":6},"children":[{"type":"text","text":"{ccu}","size":22,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{delta}","size":12,"fontWeight":"bold","color":"delta","margin":{"start":4},"showIf":"delta"},{"type":"column","gap":1,"align":"end","weight":1,"margin":{"start":8},"children":[{"type":"row","align":"baseline","showIf":"slot.1","children":[{"type":"text","text":"{slot.1.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.1.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.2","children":[{"type":"text","text":"{slot.2.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.2.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.3","children":[{"type":"text","text":"{slot.3.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.3.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.4","children":[{"type":"text","text":"{slot.4.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.4.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]}]}]},{"type":"spacer","weight":1}]},"name":"small4","refresh":"topEnd"},{"minWidth":100,"minHeight":72,"root":{"type":"column","padding":{"top":4,"bottom":8,"start":12,"end":6},"children":[{"type":"row","align":"center","children":[{"type":"image","bind":"game.iconUrl","size":18,"radius":6,"placeholder":"divider","margin":{"end":7}},{"type":"text","text":"{game}","size":12,"fontWeight":"medium","color":"text2","weight":1},{"type":"text","text":"{status}","size":10,"color":"text2","margin":{"start":6}},{"type":"icon","name":"refresh","size":15,"color":"text2","padding":4}]},{"type":"spacer","weight":1},{"type":"row","align":"center","padding":{"end":6},"children":[{"type":"text","text":"{ccu}","size":22,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{delta}","size":12,"fontWeight":"bold","color":"delta","margin":{"start":4},"showIf":"delta"},{"type":"column","gap":1,"align":"end","weight":1,"margin":{"start":8},"children":[{"type":"row","align":"baseline","showIf":"slot.1","children":[{"type":"text","text":"{slot.1.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.1.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.2","children":[{"type":"text","text":"{slot.2.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.2.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.3","children":[{"type":"text","text":"{slot.3.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.3.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]}]}]},{"type":"spacer","weight":1}]},"name":"small","refresh":"topEnd"},{"minWidth":0,"minHeight":0,"root":{"type":"column","padding":{"top":4,"bottom":8,"start":12,"end":6},"children":[{"type":"row","align":"center","children":[{"type":"image","bind":"game.iconUrl","size":18,"radius":6,"placeholder":"divider","margin":{"end":7}},{"type":"text","text":"{game}","size":12,"fontWeight":"medium","color":"text2","weight":1},{"type":"text","text":"{status}","size":10,"color":"text2","margin":{"start":6}},{"type":"icon","name":"refresh","size":15,"color":"text2","padding":4}]},{"type":"spacer","weight":1},{"type":"row","align":"center","padding":{"end":6},"children":[{"type":"text","text":"{ccu}","size":22,"fontWeight":"semibold","color":"text"},{"type":"text","text":"{delta}","size":12,"fontWeight":"bold","color":"delta","margin":{"start":4},"showIf":"delta"},{"type":"column","gap":1,"align":"end","weight":1,"margin":{"start":8},"children":[{"type":"row","align":"baseline","showIf":"slot.1","children":[{"type":"text","text":"{slot.1.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.1.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]},{"type":"row","align":"baseline","showIf":"slot.2","children":[{"type":"text","text":"{slot.2.label}","size":10,"color":"text2","align":"end","weight":1},{"type":"text","text":"{slot.2.value:short}","size":11,"fontWeight":"semibold","color":"text","margin":{"start":4}}]}]}]},{"type":"spacer","weight":1}]},"name":"tiny","refresh":"topEnd"}],"loading":[{"minWidth":0,"minHeight":0,"root":{"type":"stack","padding":8,"children":[{"type":"text","text":"Loading…","size":13,"color":"text","align":"center","maxLines":2,"margin":{"start":20,"end":20},"gravity":"center"},{"type":"icon","name":"refresh","size":18,"color":"text2","padding":3,"gravity":"topEnd"}]},"name":"message","refresh":"topEnd"}],"unreachable":[{"minWidth":0,"minHeight":0,"root":{"type":"stack","padding":8,"children":[{"type":"text","text":"Can't reach {backend|the backend}","size":13,"color":"text","align":"center","maxLines":2,"margin":{"start":20,"end":20},"gravity":"center"},{"type":"icon","name":"refresh","size":18,"color":"text2","padding":3,"gravity":"topEnd"}]},"name":"message","refresh":"topEnd"}],"signedOut":[{"minWidth":0,"minHeight":0,"root":{"type":"stack","padding":8,"children":[{"type":"text","text":"Open TypeTorch to sign in","size":13,"color":"text","align":"center","maxLines":2,"margin":{"start":20,"end":20},"gravity":"center"}]},"name":"message","refresh":"none"}],"pick":[{"minWidth":0,"minHeight":0,"root":{"type":"stack","padding":8,"children":[{"type":"text","text":"Tap to pick a game","size":13,"color":"text","align":"center","maxLines":2,"margin":{"start":20,"end":20},"gravity":"center"}]},"name":"message","refresh":"none"}]},"tokens":{"day":{"bg":"#EFFFFFFF","text":"#FF17171B","text2":"#FF62606A","brand":"#FFFB7A32","up":"#FF1F8A4C","down":"#FFC93C3C","divider":"#1F000000","unitTime":"#FFE2700F","unitPercent":"#FF1F6FD1","unitRobux":"#FF1F8A4C"},"night":{"bg":"#FF1C1C20","text":"#FFF2F0F5","text2":"#FFA7A3AD","brand":"#FFFB7A32","up":"#FF4CC27A","down":"#FFEF6B6B","divider":"#33FFFFFF","unitTime":"#FFFB923C","unitPercent":"#FF5AA9FF","unitRobux":"#FF4CC27A"}},"strings":{"refreshing":"refreshing…","offline":"offline · {updated}"},"format":{"ratioDecimals":2}}"""
}
