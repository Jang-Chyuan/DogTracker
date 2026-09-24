package com.dogtracker.cloud

import android.app.*
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.*
import androidx.core.app.NotificationCompat
import com.dogtracker.BleForegroundService
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.UUID

/** User-visible search relay; the durable queue remains owned by DogStatusStore. */
class SearchRelayService : Service() {
  companion object {
    @Volatile var instance: SearchRelayService? = null
    @Volatile var timedOut = false
  }
  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var owner = ""
  @Volatile private var runId: String? = null
  private var lock: PowerManager.WakeLock? = null
  private val tick = object : Runnable {
    override fun run() {
      if (!BleForegroundService.isRunning) { stopSelf(); return }
      val network = getSystemService(ConnectivityManager::class.java)
      val online = network.getNetworkCapabilities(network.activeNetwork)
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
      val context = (application as ReactApplication).reactHost?.currentReactContext
      if (runId == null && online && context != null && owner.isNotEmpty()) {
        val id = UUID.randomUUID().toString()
        runId = id
        lock?.acquire(35000)
        try {
          val data = Arguments.createMap().apply { putString("owner", owner); putString("runId", id) }
          HeadlessJsTaskContext.getInstance(context).startTask(
            HeadlessJsTaskConfig("DogTrackerSearchRelay", data, 30000, true))
          handler.postDelayed({ complete(id) }, 31000)
        } catch (_: Exception) { complete(id) }
      }
      handler.postDelayed(this, 10000)
    }
  }
  override fun onCreate() {
    super.onCreate()
    instance = this
    lock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DogTracker:search-relay")
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel("dogtracker_search_relay", "搜尋位置轉送", NotificationManager.IMPORTANCE_LOW))
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(3106, NotificationCompat.Builder(this, "dogtracker_search_relay")
      .setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("DogTracker 搜尋位置轉送")
      .setContentText("每 10 秒嘗試上傳；斷網保留資料").setOngoing(true).build())
    val next = intent?.getStringExtra("owner").orEmpty()
    if (next.isEmpty() || timedOut) { stopSelf(); return START_NOT_STICKY }
    if (next != owner) { runId = null; owner = next }
    handler.removeCallbacks(tick)
    handler.post(tick)
    return START_NOT_STICKY
  }
  fun isCurrent(id: String, account: String) = runId == id && owner == account && BleForegroundService.isRunning
  fun belongsTo(account: String) = owner == account
  fun complete(id: String) {
    if (id != runId) return
    runId = null
    if (lock?.isHeld == true) lock?.release()
  }
  override fun onTimeout(startId: Int, fgsType: Int) { timedOut = true; stopSelf() }
  override fun onDestroy() {
    runId = null; owner = ""; instance = null
    handler.removeCallbacksAndMessages(null)
    if (lock?.isHeld == true) lock?.release()
    super.onDestroy()
  }
  override fun onBind(intent: Intent?) = null
}
