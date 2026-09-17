package com.dogtracker

import android.app.Activity
import android.content.*
import android.graphics.*
import android.net.Uri
import androidx.core.content.FileProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

class HistoryExportModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val worker = Executors.newSingleThreadExecutor()
  private var pending: Promise? = null
  private var pendingFile: File? = null
  private val directory get() = File(context.cacheDir, "history_exports").apply { mkdirs() }
  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, intent: Intent?) {
      if (requestCode != 7315) return
      val promise = pending ?: return
      val file = pendingFile
      pending = null; pendingFile = null
      if (resultCode != Activity.RESULT_OK || intent?.data == null) { promise.resolve("cancelled"); return }
      val uri = intent.data!!
      worker.execute {
        try {
          requireNotNull(file)
          val stream = context.contentResolver.openOutputStream(uri, "wt") ?: error("無法開啟目的檔案")
          stream.use { out -> file.inputStream().use { it.copyTo(out) } }
          promise.resolve("saved")
        } catch (e: Exception) { promise.reject("EXPORT_SAVE", "儲存失敗，請重試", e) }
      }
    }
  }
  init { context.addActivityEventListener(listener) }
  override fun getName() = "HistoryExport"
  private fun owned(path: String): File {
    val file = File(path).canonicalFile
    require(file.parentFile == directory.canonicalFile && file.isFile) { "匯出檔案無效" }
    return file
  }
  private fun mime(file: File) = when (file.extension) { "png" -> "image/png"; "gpx" -> "application/gpx+xml"; else -> "text/csv" }
  @ReactMethod fun prepare(format: String, text: String, snapshot: String, label: String, promise: Promise) {
    worker.execute {
      try {
        require(format in listOf("png", "gpx", "csv"))
        // Only clear stale exports; active share recipients retain access.
        directory.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 7 * 86400000L }?.forEach { it.delete() }
        val file = File(directory, "DogTracker-${UUID.randomUUID()}.$format")
        if (format == "png") {
          val source = File(if (snapshot.startsWith("file:")) Uri.parse(snapshot).path!! else snapshot).canonicalFile
          require(source.path.startsWith(context.cacheDir.canonicalPath + File.separator))
          val bitmap = BitmapFactory.decodeFile(source.path) ?: error("地圖圖片無效")
          val footer = 130
          val composed = Bitmap.createBitmap(bitmap.width, bitmap.height + footer, Bitmap.Config.ARGB_8888)
          val canvas = Canvas(composed)
          canvas.drawColor(Color.WHITE); canvas.drawBitmap(bitmap, 0f, 0f, null)
          val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = (bitmap.width / 32f).coerceIn(14f, 32f) }
          for ((i, line) in label.split('\n').take(3).withIndex()) canvas.drawText(line, 16f, bitmap.height + 32f + i * 36f, paint)
          file.outputStream().use { check(composed.compress(Bitmap.CompressFormat.PNG, 100, it)) }
          bitmap.recycle(); composed.recycle(); source.delete()
        } else file.writeText(text, Charsets.UTF_8)
        promise.resolve(file.absolutePath)
      } catch (e: Exception) { promise.reject("EXPORT_PREPARE", "無法建立匯出檔案", e) }
    }
  }
  @ReactMethod fun share(path: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val activity = context.currentActivity ?: error("請回到 App 再分享")
        val file = owned(path)
        val uri = FileProvider.getUriForFile(context, context.packageName + ".historyexports", file)
        val intent = Intent(Intent.ACTION_SEND).setType(mime(file)).putExtra(Intent.EXTRA_STREAM, uri)
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).apply { clipData = ClipData.newRawUri("DogTracker", uri) }
        activity.startActivity(Intent.createChooser(intent, "分享歷史軌跡"))
        promise.resolve("opened")
      } catch (e: Exception) { promise.reject("EXPORT_SHARE", "無法開啟分享選單", e) }
    }
  }
  @ReactMethod fun save(path: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        check(pending == null) { "已有儲存作業進行中" }
        val activity = context.currentActivity ?: error("請回到 App 再儲存")
        val file = owned(path)
        pending = promise; pendingFile = file
        activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
          .setType(mime(file)).putExtra(Intent.EXTRA_TITLE, file.name), 7315)
      } catch (e: Exception) { if (pending === promise) { pending = null; pendingFile = null }; promise.reject("EXPORT_SAVE", "無法開啟儲存選單", e) }
    }
  }
  override fun invalidate() {
    context.removeActivityEventListener(listener)
    pending?.reject("EXPORT_CLOSED", "匯出已取消"); pending = null
    worker.shutdown(); super.invalidate()
  }
}
class HistoryExportPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(HistoryExportModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
