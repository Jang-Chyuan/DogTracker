package com.dogtracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

/** Keeps the existing JS sync owner alive; never creates another downloader or DB. */
class CloudBackgroundService : HeadlessJsTaskService() {
  companion object {
    const val CHANNEL = "dogtracker_cloud_sync"
    const val NOTIFICATION = 3104
    const val STOPPED = "CloudBackgroundStopped"
    @Volatile var instance: CloudBackgroundService? = null
  }

  val runId: String = UUID.randomUUID().toString()
  private var started = false
  private var reason = "背景同步已停止，開啟 App 後可恢復"

  override fun onCreate() {
    super.onCreate()
    instance = this
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, "雲端資料同步", NotificationManager.IMPORTANCE_LOW)
      )
    }
  }

  private fun notification(text: String): android.app.Notification {
    val launch = PendingIntent.getActivity(this, 3104,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("DogTracker 雲端同步")
      .setContentText(text)
      .setContentIntent(launch)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!started) {
      try {
        startForeground(NOTIFICATION, notification("每 30 秒增量同步；登出即可停止"))
        started = true
        startTask(HeadlessJsTaskConfig("DogTrackerCloudKeepAlive",
          Arguments.createMap().apply { putString("runId", runId) }, 0, true))
      } catch (_: Exception) {
        reason = "系統無法啟動背景同步，請回到 App 重試"
        stopSelf()
      }
    }
    // No blind restart without the mounted, authenticated App sync owner.
    return START_NOT_STICKY
  }

  fun updateStatus(text: String) {
    if (started) getSystemService(NotificationManager::class.java)
      .notify(NOTIFICATION, notification(text))
  }

  // Android 15+ limits the total background lifetime of dataSync services.
  override fun onTimeout(startId: Int, fgsType: Int) {
    reason = "已達系統背景同步時限，請開啟 App 恢復並補下載"
    stopSelf()
  }

  override fun onDestroy() {
    instance = null
    reactContext?.let { context ->
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(STOPPED, Arguments.createMap().apply {
            putString("runId", runId)
            putString("reason", reason)
          })
      }
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
