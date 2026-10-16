package com.dogtracker

import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * One-off notices for a problem that ends a service (so its ongoing
 * notification is gone): a plain sentence, no title, a tap opens the app at
 * the screen that fixes it. The detail stays in 診斷 and dumpsys.
 */
object PlainNotices {
  /** The receiver's pairing is wrong (another receiver's number): the service stopped. */
  const val RECEIVER_CONFIG_ID = 3109
  /** Recording 我的路線 could not start. */
  const val RECORDING_START_ID = 3110

  @android.annotation.SuppressLint("MissingPermission") // areNotificationsEnabled, and the SecurityException caught
  fun post(context: Context, id: Int, text: String, screen: String) {
    runCatching {
      NotificationChannels.create(context)
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) return
      manager.notify(id, NotificationCompat.Builder(context, NotificationChannels.ALERTS)
        .setSmallIcon(R.drawable.ic_stat_dog).setColor(NotificationChannels.accent(context))
        .setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setCategory(NotificationCompat.CATEGORY_STATUS).setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setContentIntent(NotificationChannels.launch(context, screen, requestCode = id))
        .setAutoCancel(true).build())
    }
  }

  fun clear(context: Context, id: Int) { runCatching { NotificationManagerCompat.from(context).cancel(id) } }
}
