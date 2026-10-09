package com.dogtracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * The app's two notification channels (design v3 「Android 細節」: alerts and
 * the always-on services apart): 「提醒」 (high) for the merged alert, and
 * 「常駐」 (low, silent) for the receiver, the phone's route recording and the
 * data sync. Created again on every start: Android keeps what the user
 * changed on an existing channel.
 */
object NotificationChannels {
  const val ALERTS = "alerts"
  const val TRACKING = "tracking"
  // The channels of earlier versions (one per service, and the old stale-dog
  // alert), folded into the two above.
  private val OLD = listOf("dogtracker_ble", "dogtracker_phone_location", "dogtracker_search_relay", "tracking_stale")

  fun accent(context: Context) = context.getColor(R.color.ic_launcher_background)

  fun create(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(ALERTS, com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c191), NotificationManager.IMPORTANCE_HIGH).apply {
      description = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1053)
      // High so a new alert pops up on screen (N1/N2). Its sound and
      // vibration are the alert's own (S6 震動／聲音, critical or normal
      // pattern), so the channel starts silent; what the user then sets on
      // it in system settings wins (AlertAttention).
      setSound(null, null)
      enableVibration(false)
    })
    manager.createNotificationChannel(NotificationChannel(TRACKING, com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c477), NotificationManager.IMPORTANCE_LOW).apply {
      description = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1054)
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    })
    OLD.forEach { if (manager.getNotificationChannel(it) != null) manager.deleteNotificationChannel(it) }
  }

  /**
   * Opens the app at `screen` (dogtracker://notification/<screen>?dogId=):
   * 'map' with a dog (its card), 'open-map' (the live map, everything
   * framed), 'receiver-settings', 'diagnostics', 'system-storage', 'my-route',
   * 'cloud-settings'.
   */
  fun launch(context: Context, screen: String, dogId: String? = null, requestCode: Int = 0): PendingIntent {
    val uri = Uri.Builder().scheme("dogtracker").authority("notification").appendPath(screen)
      .apply { if (dogId != null) appendQueryParameter("dogId", dogId) }.build()
    return PendingIntent.getActivity(context, requestCode, Intent(context, MainActivity::class.java)
      .setAction(Intent.ACTION_VIEW).setData(uri)
      // Opened from a notification: the launch screen hands over with the
      // plain fade (SplashOverlay).
      .putExtra(SplashState.EXTRA_FROM_NOTIFICATION, true)
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
