package com.dogtracker

import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.core.content.FileProvider
import androidx.core.graphics.PathParser
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.GoogleMapOptions
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.MapsInitializer
import com.google.android.gms.maps.model.LatLng
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sinh

/**
 * The history export (H9/H10, src/mapHistory/useHistoryExport.js): font widths
 * for the PNG layout, the GPX/CSV text written to the cache, the PNG pages
 * painted from ExportDraw's operations (the map block on a Google lite-mode
 * snapshot, or a blank background with a scale when it cannot load), Android's
 * share sheet, and the temporary files (cache/history_exports/<export id>/,
 * removed the next day by the JS side).
 */
class HistoryExportModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val worker = Executors.newSingleThreadExecutor()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()
  private val root get() = File(context.cacheDir, "history_exports").apply { mkdirs() }

  override fun getName() = "HistoryExport"

  private fun folder(directory: String): File {
    require(Regex("^history_exports/[A-Za-z0-9_-]+$").matches(directory)) { "匯出資料夾無效" }
    val dir = File(context.cacheDir, directory).canonicalFile
    require(dir.parentFile == root.canonicalFile) { "匯出資料夾無效" }
    dir.mkdirs()
    return dir
  }

  private fun fileIn(dir: File, filename: String): File {
    val file = File(dir, filename).canonicalFile
    require(file.parentFile == dir && filename.isNotBlank()) { "匯出檔名無效" }
    return file
  }

  /** Widths at 100px of every character, regular and bold (the app's font). */
  @ReactMethod
  fun charWidths(chars: String, promise: Promise) {
    worker.execute {
      try {
        val result = Arguments.createMap()
        for ((key, face) in listOf("regular" to Typeface.DEFAULT, "bold" to Typeface.DEFAULT_BOLD)) {
          val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 100f; typeface = face }
          val table = Arguments.createMap()
          var i = 0
          while (i < chars.length) {
            val cp = chars.codePointAt(i)
            val text = String(Character.toChars(cp))
            table.putDouble(text, paint.measureText(text).toDouble())
            i += Character.charCount(cp)
          }
          result.putMap(key, table)
        }
        promise.resolve(result)
      } catch (e: Exception) { promise.reject("EXPORT_FONT", "無法量字寬", e) }
    }
  }

  @ReactMethod
  fun writeText(directory: String, filename: String, text: String, promise: Promise) {
    worker.execute {
      try {
        val file = fileIn(folder(directory), filename)
        file.writeText(text, Charsets.UTF_8)
        promise.resolve(file.absolutePath)
      } catch (e: Exception) { promise.reject("EXPORT_WRITE", "無法建立匯出檔案", e) }
    }
  }

  @ReactMethod
  fun cancel(exportId: String) { cancelled.add(exportId) }

  @ReactMethod
  fun renderPng(exportId: String, directory: String, json: String, promise: Promise) {
    worker.execute {
      val written = mutableListOf<File>()
      try {
        val dir = folder(directory)
        val pages = JSONArray(json)
        val paths = Arguments.createArray()
        for (p in 0 until pages.length()) {
          if (exportId in cancelled) throw InterruptedException("cancelled")
          val page = pages.getJSONObject(p)
          val width = page.getInt("width")
          val height = min(page.getInt("height"), 2400)
          val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
          val canvas = Canvas(bitmap)
          val ops = page.getJSONArray("ops")
          for (i in 0 until ops.length()) draw(canvas, ops.getJSONObject(i), exportId)
          val file = fileIn(dir, page.getString("filename"))
          file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
          bitmap.recycle()
          written.add(file)
          paths.pushString(file.absolutePath)
        }
        if (exportId in cancelled) throw InterruptedException("cancelled")
        promise.resolve(paths)
      } catch (e: Exception) {
        android.util.Log.w("HistoryExport", "PNG export failed", e)
        written.forEach { it.delete() }
        promise.reject("EXPORT_PNG", if (e is InterruptedException) "已取消" else "無法產生圖片", e)
      } finally { cancelled.remove(exportId) }
    }
  }

  @ReactMethod
  fun share(paths: ReadableArray, mime: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val activity = context.currentActivity ?: error("請回到 App 再分享")
        val uris = ArrayList<Uri>()
        for (i in 0 until paths.size()) {
          val file = File(paths.getString(i) ?: "").canonicalFile
          require(file.path.startsWith(root.canonicalPath + File.separator) && file.isFile) { "匯出檔案無效" }
          uris.add(FileProvider.getUriForFile(context, context.packageName + ".historyexports", file))
        }
        require(uris.isNotEmpty()) { "沒有匯出檔案" }
        val intent = if (uris.size == 1) Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
          else Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        intent.setType(mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData = ClipData.newRawUri("DogTracker", uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
        activity.startActivity(Intent.createChooser(intent, null))
        promise.resolve("opened")
      } catch (e: Exception) { android.util.Log.w("HistoryExport", "share failed", e); promise.reject("EXPORT_SHARE", "無法開啟分享選單", e) }
    }
  }

  @ReactMethod
  fun listExports(promise: Promise) {
    worker.execute {
      val list = Arguments.createArray()
      root.listFiles()?.forEach { entry ->
        list.pushMap(Arguments.createMap().apply {
          putString("directory", "history_exports/${entry.name}")
          putDouble("createdAt", entry.lastModified().toDouble())
        })
      }
      promise.resolve(list)
    }
  }

  @ReactMethod
  fun removeExports(directories: ReadableArray, promise: Promise) {
    worker.execute {
      for (i in 0 until directories.size()) {
        val name = directories.getString(i) ?: continue
        val entry = File(context.cacheDir, name).canonicalFile
        if (entry.parentFile == root.canonicalFile) entry.deleteRecursively()
      }
      promise.resolve(null)
    }
  }

  // ---- painting ---------------------------------------------------------------
  private fun color(value: String?): Int {
    if (value == null) return 0
    val rgba = Regex("^rgba\\((\\d+),(\\d+),(\\d+),([\\d.]+)\\)$").find(value.replace(" ", ""))
    if (rgba != null) {
      val (r, g, b, a) = rgba.destructured
      return android.graphics.Color.argb((a.toDouble() * 255).toInt(), r.toInt(), g.toInt(), b.toInt())
    }
    return android.graphics.Color.parseColor(value)
  }

  private fun textPaint(size: Float, bold: Boolean, colour: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = size; typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT; color = colour
  }

  /** `y` is the top of a line box `h` high; the text sits in its middle. */
  private fun baseline(paint: Paint, y: Float, h: Float): Float {
    val m = paint.fontMetrics
    return y + h / 2f - (m.ascent + m.descent) / 2f
  }

  private fun drawText(canvas: Canvas, text: String, x: Float, y: Float, h: Float, size: Float, bold: Boolean,
                       colour: Int, align: String, halo: Int? = null) {
    val paint = textPaint(size, bold, colour)
    paint.textAlign = when (align) { "right" -> Paint.Align.RIGHT; "center" -> Paint.Align.CENTER; else -> Paint.Align.LEFT }
    val by = baseline(paint, y, h)
    if (halo != null) {
      val stroke = Paint(paint).apply { style = Paint.Style.STROKE; strokeWidth = size / 4f; color = halo
        strokeJoin = Paint.Join.ROUND }
      canvas.drawText(text, x, by, stroke)
    }
    canvas.drawText(text, x, by, paint)
  }

  /** An icon of ExportDraw.EXPORT_ICONS: path data on a 24-unit grid, stroked 2 units and/or filled. */
  private fun drawIcon(canvas: Canvas, icon: JSONObject, x: Float, y: Float, size: Float, colour: Int) {
    val scale = size / 24f
    canvas.save()
    canvas.translate(x, y)
    canvas.scale(scale, scale)
    icon.optString("stroke").takeIf { it.isNotEmpty() }?.let {
      canvas.drawPath(PathParser.createPathFromPathData(it), Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 2f; color = colour; strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND })
    }
    icon.optString("fill").takeIf { it.isNotEmpty() }?.let {
      canvas.drawPath(PathParser.createPathFromPathData(it), Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL; color = colour })
    }
    canvas.restore()
  }

  private fun draw(canvas: Canvas, op: JSONObject, exportId: String) {
    val f = { key: String -> op.optDouble(key, 0.0).toFloat() }
    when (op.getString("t")) {
      "rect" -> {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = color(op.optString("fill")) }
        val r = f("r")
        canvas.drawRoundRect(RectF(f("x"), f("y"), f("x") + f("w"), f("y") + f("h")), r, r, paint)
      }
      "circle" -> {
        // A ring `strokeWidth` wide inside r, the fill within it (no seam between them).
        val ring = if (op.has("stroke")) f("strokeWidth") else 0f
        if (ring > 0f) canvas.drawCircle(f("cx"), f("cy"), f("r"), Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = color(op.getString("stroke")) })
        if (op.has("fill")) canvas.drawCircle(f("cx"), f("cy"), f("r") - ring, Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = color(op.getString("fill")) })
      }
      "line" -> {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = f("width")
          color = color(op.getString("color")) }
        op.optJSONArray("dash")?.let { paint.pathEffect = DashPathEffect(floatArrayOf(it.getDouble(0).toFloat(), it.getDouble(1).toFloat()), 0f) }
        canvas.drawLine(f("x1"), f("y1"), f("x2"), f("y2"), paint)
      }
      "text" -> drawText(canvas, op.getString("text"), f("x"), f("y"), f("h"), f("size"), op.optBoolean("bold"),
        color(op.getString("color")), op.optString("align", "left"),
        if (op.isNull("halo")) null else color(op.getString("halo")))
      "runs" -> {
        var x = f("x")
        val main = textPaint(f("size"), false, 0)
        val by = baseline(main, f("y"), f("h"))
        val runs = op.getJSONArray("runs")
        for (i in 0 until runs.length()) {
          val run = runs.getJSONObject(i)
          val paint = textPaint(run.optDouble("size", f("size").toDouble()).toFloat(), run.optBoolean("bold"),
            color(run.getString("color")))
          canvas.drawText(run.getString("text"), x, by, paint)
          x += paint.measureText(run.getString("text"))
        }
      }
      "icon" -> drawIcon(canvas, op.getJSONObject("icon"), f("x"), f("y"), f("size"), color(op.getString("color")))
      "map" -> drawMap(canvas, op, exportId)
    }
  }

  // ---- the map block ------------------------------------------------------------
  private class Projector(val toPixel: (Double, Double) -> Pair<Float, Float>, val metresPerPixel: Double)

  private fun mercator(lat: Double, lon: Double): Pair<Double, Double> {
    val x = (lon + 180.0) / 360.0
    val s = sin(lat * PI / 180.0).coerceIn(-0.9999, 0.9999)
    val y = 0.5 - ln((1 + s) / (1 - s)) / (4 * PI)
    return x to y
  }

  private fun coordinatesOf(op: JSONObject): List<LatLng> {
    val out = mutableListOf<LatLng>()
    val subjects = op.getJSONArray("subjects")
    for (s in 0 until subjects.length()) {
      val subject = subjects.getJSONObject(s)
      val lines = subject.getJSONArray("lines")
      for (l in 0 until lines.length()) {
        val coords = lines.getJSONObject(l).getJSONArray("coordinates")
        for (c in 0 until coords.length()) coords.getJSONArray(c).let { out.add(LatLng(it.getDouble(0), it.getDouble(1))) }
      }
      for (key in listOf("places", "times")) {
        val list = subject.getJSONArray(key)
        for (i in 0 until list.length()) list.getJSONObject(i).let { out.add(LatLng(it.getDouble("latitude"), it.getDouble("longitude"))) }
      }
      val points = subject.getJSONArray("points")
      for (i in 0 until points.length()) points.getJSONArray(i).let { out.add(LatLng(it.getDouble(0), it.getDouble(1))) }
    }
    return out
  }

  /** A linear Web Mercator fit of `coords` in w×h with `padding` (no base map). */
  private fun ownFit(coords: List<LatLng>, w: Int, h: Int, padding: Float): Projector {
    val pts = coords.map { mercator(it.latitude, it.longitude) }
    val minX = pts.minOf { it.first }; val maxX = pts.maxOf { it.first }
    val minY = pts.minOf { it.second }; val maxY = pts.maxOf { it.second }
    // At least ~200 m across, so one point is not a city block wide.
    val span = max(max(maxX - minX, maxY - minY), 200.0 / 40075016.0)
    val scale = min((w - 2 * padding) / max(maxX - minX, span), (h - 2 * padding) / max(maxY - minY, span))
    val cx = (minX + maxX) / 2; val cy = (minY + maxY) / 2
    val lat = coords.map { it.latitude }.average()
    return Projector({ la, lo -> val (x, y) = mercator(la, lo)
      ((w / 2.0 + (x - cx) * scale).toFloat()) to ((h / 2.0 + (y - cy) * scale).toFloat()) },
      40075016.0 * cos(lat * PI / 180.0) / scale)
  }

  /**
   * The base map: a lite-mode Google map drawn into a bitmap. Its camera is
   * set when it is made (a lite map ignores later camera moves before it has
   * drawn): centred on the routes at the largest whole zoom that keeps them
   * `padding` from the edges, so pixels follow Web Mercator exactly.
   */
  private fun baseMap(coords: List<LatLng>, w: Int, h: Int, padding: Int): Pair<Bitmap, Projector>? {
    val activity = context.currentActivity ?: return null
    val density = activity.resources.displayMetrics.density.toDouble()
    val pts = coords.map { mercator(it.latitude, it.longitude) }
    val minX = pts.minOf { it.first }; val maxX = pts.maxOf { it.first }
    val minY = pts.minOf { it.second }; val maxY = pts.maxOf { it.second }
    val fit = min((w - 2.0 * padding) / max(maxX - minX, 1e-9), (h - 2.0 * padding) / max(maxY - minY, 1e-9))
    val zoom = floor(ln(fit / (256 * density)) / ln(2.0)).coerceIn(3.0, 18.0)
    val scale = 256 * density * 2.0.pow(zoom)
    val cx = (minX + maxX) / 2; val cy = (minY + maxY) / 2
    val centre = LatLng(atan(sinh(PI * (1 - 2 * cy))) * 180 / PI, cx * 360 - 180)
    val latch = CountDownLatch(1)
    var result: Pair<Bitmap, Projector>? = null
    var view: MapView? = null
    UiThreadUtil.runOnUiThread {
      try {
        MapsInitializer.initialize(activity)
        val map = MapView(activity, GoogleMapOptions().liteMode(true).mapToolbarEnabled(false)
          .camera(CameraPosition.fromLatLngZoom(centre, zoom.toFloat())))
        view = map
        map.onCreate(null)
        // Behind the app's own views: laid out at the PNG's size, never seen.
        (activity.window.decorView as ViewGroup).addView(map, 0, FrameLayout.LayoutParams(w, h))
        map.onResume()
        map.getMapAsync { google ->
          google.uiSettings.isMapToolbarEnabled = false
          google.setOnMapLoadedCallback {
            try {
              val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
              map.draw(Canvas(bitmap))
              result = bitmap to Projector({ la, lo -> val (x, y) = mercator(la, lo)
                ((w / 2.0 + (x - cx) * scale).toFloat()) to ((h / 2.0 + (y - cy) * scale).toFloat()) },
                40075016.0 * cos(centre.latitude * PI / 180.0) / scale)
            } catch (_: Exception) { }
            latch.countDown()
          }
        }
      } catch (_: Exception) { latch.countDown() }
    }
    latch.await(12, TimeUnit.SECONDS)
    UiThreadUtil.runOnUiThread {
      view?.let { it.onPause(); it.onDestroy(); (it.parent as? ViewGroup)?.removeView(it) }
    }
    return result
  }

  private fun drawMap(canvas: Canvas, op: JSONObject, exportId: String) {
    val x = op.getDouble("x").toFloat(); val y = op.getDouble("y").toFloat()
    val w = op.getInt("w"); val h = op.getInt("h")
    val padding = op.optInt("padding", 72)
    val coords = coordinatesOf(op)
    canvas.save()
    canvas.clipRect(x, y, x + w, y + h)
    canvas.translate(x, y)
    canvas.drawColor(color(op.getString("background")))
    if (coords.isEmpty()) { canvas.restore(); return }
    val base = if (exportId in cancelled) null else baseMap(coords, w, h, padding)
    val projector = base?.second?.takeIf { it.metresPerPixel.isFinite() && it.metresPerPixel > 0 }
      ?: ownFit(coords, w, h, padding.toFloat())
    base?.first?.let { canvas.drawBitmap(it, 0f, 0f, null); it.recycle() }
    val subjects = op.getJSONArray("subjects")
    val halo = color(op.getString("halo"))
    val ink = color(op.getString("text"))
    val surface = color(op.getString("surface"))
    // Routes first, every subject's; then time markers; then numbers on top.
    for (s in 0 until subjects.length()) {
      val subject = subjects.getJSONObject(s)
      val colour = color(subject.getString("color"))
      val lines = subject.getJSONArray("lines")
      for (l in 0 until lines.length()) {
        val line = lines.getJSONObject(l)
        val coordinates = line.getJSONArray("coordinates")
        val path = Path()
        for (c in 0 until coordinates.length()) {
          val point = coordinates.getJSONArray(c)
          val (px, py) = projector.toPixel(point.getDouble(0), point.getDouble(1))
          if (c == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        canvas.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE
          strokeWidth = line.getDouble("width").toFloat(); color = colour; strokeCap = Paint.Cap.ROUND
          strokeJoin = Paint.Join.ROUND })
      }
      val points = subject.getJSONArray("points")
      for (i in 0 until points.length()) {
        val point = points.getJSONArray(i)
        val (px, py) = projector.toPixel(point.getDouble(0), point.getDouble(1))
        canvas.drawCircle(px, py, 15f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = colour })
      }
    }
    val labels = mutableListOf<Triple<String, Pair<Float, Float>, Float>>()
    for (s in 0 until subjects.length()) {
      val subject = subjects.getJSONObject(s)
      val colour = color(subject.getString("color"))
      val times = subject.getJSONArray("times")
      for (i in 0 until times.length()) {
        val marker = times.getJSONObject(i)
        val (px, py) = projector.toPixel(marker.getDouble("latitude"), marker.getDouble("longitude"))
        val end = marker.optBoolean("end")
        val r = if (end) 20f else 15f
        canvas.drawCircle(px, py, r, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = surface })
        canvas.drawCircle(px, py, r - (if (end) 3.6f else 2.4f), Paint(Paint.ANTI_ALIAS_FLAG).apply {
          style = Paint.Style.STROKE; strokeWidth = if (end) 7.2f else 4.8f; color = colour })
        labels.add(Triple(marker.getString("label"), px to py, r))
      }
    }
    // The time labels where they cover no number, house or other label:
    // under the ring, else above, right or left (several dogs' ends crowd).
    val placeRects = mutableListOf<RectF>()
    for (s in 0 until subjects.length()) {
      val places = subjects.getJSONObject(s).getJSONArray("places")
      for (i in 0 until places.length()) {
        val place = places.getJSONObject(i)
        val (px, py) = projector.toPixel(place.getDouble("latitude"), place.getDouble("longitude"))
        placeRects.add(RectF(px - 33f, py - 33f, px + 33f, py + 33f))
      }
    }
    val taken = placeRects.toMutableList()
    val measure = textPaint(39f, true, ink)
    for ((label, at, r) in labels) {
      val (px, py) = at
      val half = measure.measureText(label) / 2f + 4f
      val options = listOf(RectF(px - half, py + r + 4f, px + half, py + r + 48f),
        RectF(px - half, py - r - 48f, px + half, py - r - 4f),
        RectF(px + r + 6f, py - 22f, px + r + 6f + 2 * half, py + 22f),
        RectF(px - r - 6f - 2 * half, py - 22f, px - r - 6f, py + 22f))
      val box = options.firstOrNull { option -> taken.none { RectF.intersects(it, option) } } ?: options[0]
      taken.add(box)
      drawText(canvas, label, box.centerX(), box.top, box.height(), 39f, true, ink, "center", halo)
    }
    for (s in 0 until subjects.length()) {
      val subject = subjects.getJSONObject(s)
      val colour = color(subject.getString("color"))
      val places = subject.getJSONArray("places")
      for (i in 0 until places.length()) {
        val place = places.getJSONObject(i)
        val (px, py) = projector.toPixel(place.getDouble("latitude"), place.getDouble("longitude"))
        val indoor = place.optString("kind") == "indoor"
        canvas.drawCircle(px, py, 33f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = surface })
        canvas.drawCircle(px, py, 27f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = if (indoor) color(op.getString("indoor")) else colour })
        if (indoor) drawIcon(canvas, op.getJSONObject("house"), px - 21f, py - 21f, 42f, color(op.getString("onRoute")))
        else drawText(canvas, if (place.isNull("number")) "" else place.get("number").toString(), px, py - 22f, 44f, 34f,
          true, color(op.getString("onRoute")), "center")
      }
    }
    if (op.optBoolean("scale")) drawScale(canvas, projector, h, ink, halo)
    if (op.optBoolean("north")) drawNorth(canvas, w, op, surface, ink)
    if (base != null) drawText(canvas, op.optString("attribution"), w - 24f, h - 56f, 40f, 26f, false,
      color(op.getString("attributionColor")), "right", halo)
    canvas.restore()
  }

  // 比例尺: a bar of a round length (1, 2 or 5 × 10ⁿ m) up to 240px, bottom left.
  private fun drawScale(canvas: Canvas, projector: Projector, h: Int, ink: Int, halo: Int) {
    val maxMetres = projector.metresPerPixel * 240
    if (!maxMetres.isFinite() || maxMetres <= 0) return
    val power = 10.0.pow(floor(log10(maxMetres)))
    val metres = listOf(5.0, 2.0, 1.0).map { it * power }.firstOrNull { it <= maxMetres * 1.0001 } ?: power
    val length = (metres / projector.metresPerPixel).toFloat()
    val left = 32f; val bottom = h - 120f
    val stroke = { width: Float, colour: Int -> Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE
      strokeWidth = width; color = colour; strokeCap = Paint.Cap.SQUARE } }
    val bar = Path().apply { moveTo(left, bottom - 14f); lineTo(left, bottom); lineTo(left + length, bottom); lineTo(left + length, bottom - 14f) }
    canvas.drawPath(bar, stroke(10f, halo))
    canvas.drawPath(bar, stroke(4f, ink))
    val label = if (metres >= 1000) "${(metres / 1000).let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }} km" else "${metres.toInt()} m"
    drawText(canvas, label, left, bottom - 56f, 40f, 30f, true, ink, "left", halo)
  }

  // 指北: the compass of the map buttons, top right (north half red).
  private fun drawNorth(canvas: Canvas, w: Int, op: JSONObject, surface: Int, ink: Int) {
    val cx = w - 72f; val cy = 72f
    canvas.drawCircle(cx, cy, 40f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = surface })
    val north = Path().apply { moveTo(cx, cy - 28f); lineTo(cx + 10f, cy); lineTo(cx - 10f, cy); close() }
    val south = Path().apply { moveTo(cx, cy + 28f); lineTo(cx + 10f, cy); lineTo(cx - 10f, cy); close() }
    canvas.drawPath(north, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = color(op.getString("northColor")) })
    canvas.drawPath(south, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ink })
  }

  override fun invalidate() {
    worker.shutdown()
    super.invalidate()
  }
}

class HistoryExportPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(HistoryExportModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
