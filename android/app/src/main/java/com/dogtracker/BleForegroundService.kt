package com.dogtracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class BleForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "dogtracker_ble"
    const val NOTIFICATION_ID = 3103
  }

  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "DogTracker BLE",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "維持 DogTracker BLE 背景連線"
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val status = intent?.getStringExtra("status") ?: "BLE 已連線，背景接收資料中"
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("DogTracker")
      .setContentText(status)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
    startForeground(NOTIFICATION_ID, notification)
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
