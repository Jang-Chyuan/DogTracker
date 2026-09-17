package com.dogtracker.location

import android.app.*
import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import android.location.*
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.dogtracker.MainActivity
import com.dogtracker.R

/** Native acquisition and storage continue without a mounted React screen. */
class LocationTrackerService : Service(), LocationListener {
  companion object {
    @Volatile var running = false
    @Volatile var status = "尚未開始記錄"
    const val CHANNEL = "dogtracker_phone_location"
    const val ID = 3105
  }
  private lateinit var manager: LocationManager
  private val worker = HandlerThread("PhoneLocationWriter")
  private lateinit var handler: Handler
  private var store: LocationTrackerStore? = null
  private var lastSavedNanos = 0L
  @Volatile private var stopped = false
  override fun onBind(intent: Intent?) = null
  override fun onCreate() {
    super.onCreate()
    manager = getSystemService(LocationManager::class.java)
    worker.start()
    handler = Handler(worker.looper)
    if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java)
      .createNotificationChannel(NotificationChannel(CHANNEL, "手機位置記錄", NotificationManager.IMPORTANCE_LOW))
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "STOP") { stopSelf(); return START_NOT_STICKY }
    if (running) return START_NOT_STICKY
    try {
      val launch = PendingIntent.getActivity(this, ID, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val stop = PendingIntent.getService(this, ID, Intent(this, javaClass).setAction("STOP"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      startForeground(ID, NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("DogTracker 手機位置記錄").setContentText("只記錄估計精度 ≤ 5 公尺的位置；目標每 10 秒一筆")
        .setContentIntent(launch).setOngoing(true).addAction(0, "停止記錄", stop).build())
      val precise = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
      val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .filter { (precise || it != LocationManager.GPS_PROVIDER) && manager.isProviderEnabled(it) }
      check(providers.isNotEmpty()) { "請開啟手機定位服務" }
      for (provider in providers) manager.requestLocationUpdates(provider, 10000L, 0f, this, worker.looper)
      running = true
      status = "等待估計精度 ≤ 5 公尺的新定位"
    } catch (_: Exception) {
      status = "無法開始記錄，請確認定位權限與 GPS 已開啟"
      stopSelf()
    }
    return START_NOT_STICKY
  }
  override fun onLocationChanged(location: Location) {
    if (stopped) return
    val now = SystemClock.elapsedRealtimeNanos()
    val time = location.elapsedRealtimeNanos
    if (time <= 0 || time > now || now - time > 30_000_000_000L) return
    if (!acceptsLocationAccuracy(location.hasAccuracy(), location.accuracy)) {
      status = "等待高精度定位（需 ≤ 5 公尺），本次未寫入"
      return
    }
    if (lastSavedNanos > 0 && time - lastSavedNanos < 10_000_000_000L) return
    if (!location.latitude.isFinite() || !location.longitude.isFinite() || location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) return
    try {
      val database = store ?: LocationTrackerStore(this).also { store = it }
      database.save(location)
      lastSavedNanos = time
      status = "記錄中"
    } catch (_: Exception) { status = "位置寫入失敗，下一次定位會重試" }
  }
  override fun onProviderDisabled(provider: String) { status = "定位來源已關閉，等待恢復" }
  override fun onProviderEnabled(provider: String) { status = "等待新定位" }
  @Deprecated("Legacy Android callback")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
  override fun onDestroy() {
    stopped = true
    manager.removeUpdates(this)
    worker.quitSafely()
    if (running) status = "已停止記錄"
    running = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
