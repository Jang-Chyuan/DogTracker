package com.dogtracker.alerts

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.dogtracker.NotificationChannels
import com.dogtracker.R

/**
 * Carries out one alert step on this phone: the merged notification (N1/N2)
 * on the 「提醒」 channel, the alert vibration and the sound. Used by the
 * background check and by the app in front (which only vibrates and sounds:
 * no system notification while the app is on screen).
 *
 * - A new alert is posted to pop up on screen; content updates are silent.
 *   The 「提醒」 channel has no sound or vibration of its own: the attention
 *   is the explicit vibration (strong long-short-long for 不在接收範圍 /
 *   接收器斷線) and the optional sound, so the S6 switches decide them.
 * - The user's own settings still win: no vibration when the 「提醒」 channel
 *   is blocked or the phone is on silent; it is a notification vibration
 *   (the system's notification vibration strength applies). The sound only
 *   with the ringer on, at the notification volume.
 */
object AlertPoster {
  const val ID = 3107
  const val TAG = "DogTrackerAlerts"
  const val ACTION_PAUSE = "com.dogtracker.alerts.PAUSE"
  const val ACTION_DISMISSED = "com.dogtracker.alerts.DISMISSED"
  private const val DISMISSED = "dismissed"

  /** The user swiped the notification away (it is not a resolution). */
  fun dismissed(context: Context) {
    context.getSharedPreferences("alert_notifications", Context.MODE_PRIVATE).edit().putBoolean(DISMISSED, true).apply()
    showing = null
    Log.i(TAG, "notification swiped away")
  }

  fun allowed(context: Context): Boolean =
    (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED) && NotificationManagerCompat.from(context).areNotificationsEnabled()

  /** The 「提醒」 channel is not blocked (and notifications are allowed at all). */
  fun alertsEnabled(context: Context): Boolean {
    if (!allowed(context)) return false
    if (Build.VERSION.SDK_INT < 26) return true
    NotificationChannels.create(context)
    val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(NotificationChannels.ALERTS)
    return channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun channelBlocked(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 26) return false
    NotificationChannels.create(context)
    val channel = context.getSystemService(NotificationManager::class.java)
      .getNotificationChannel(NotificationChannels.ALERTS) ?: return false
    return channel.importance == NotificationManager.IMPORTANCE_NONE
  }

  fun vibrate(context: Context, pattern: LongArray, critical: Boolean): Boolean {
    val audio = context.getSystemService(AudioManager::class.java)
    if (audio?.ringerMode == AudioManager.RINGER_MODE_SILENT || channelBlocked(context)) {
      Log.i(TAG, "vibration skipped (silent mode or the 提醒 channel is blocked)")
      return false
    }
    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return false
    if (!vibrator.hasVibrator()) Log.i(TAG, "this device has no vibrator")
    vibrator.cancel()
    val kind = if (critical) "critical" else "normal"
    Log.i(TAG, "VibrationEffect.createWaveform(${pattern.joinToString(",", "[", "]")}, -1) $kind")
    when {
      Build.VERSION.SDK_INT >= 33 -> vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1),
        VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION))
      Build.VERSION.SDK_INT >= 26 -> @Suppress("DEPRECATION") vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1),
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
      else -> @Suppress("DEPRECATION") vibrator.vibrate(pattern, -1)
    }
    return true
  }

  fun sound(context: Context): Boolean {
    val audio = context.getSystemService(AudioManager::class.java)
    if (audio?.ringerMode != AudioManager.RINGER_MODE_NORMAL) return false
    val ringtone = RingtoneManager.getRingtone(context, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
      ?: return false
    ringtone.audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    Log.i(TAG, "alert sound")
    ringtone.play()
    return true
  }

  // What the notification shows now: an update with the same words is not
  // posted again (the background check runs every 10 seconds).
  @Volatile private var showing: String? = null

  fun cancel(context: Context) {
    showing = null
    context.getSystemService(NotificationManager::class.java).cancel(ID)
  }

  /**
   * The notification command: "notify" (a new alert), "update" (the same
   * notification with new lines, no attention), "cancel". Returns whether a
   * notification is showing afterwards.
   */
  fun post(context: Context, command: String, content: NotificationContent?): Boolean {
    if (command == "cancel" || content == null || !alertsEnabled(context)) {
      cancel(context)
      return false
    }
    val manager = context.getSystemService(NotificationManager::class.java)
    // Swiped away: a silent update does not bring it back, a new alert does.
    // (Taken away while the app was on screen, it comes back with the next step.)
    val prefs = context.getSharedPreferences("alert_notifications", Context.MODE_PRIVATE)
    if (command == "notify") prefs.edit().putBoolean(DISMISSED, false).apply()
    else if (prefs.getBoolean(DISMISSED, false)) return false
    val words = content.title + "\n" + content.lines.joinToString("\n") + "\n" + content.target
    if (command == "update" && words == showing) return true
    val style = NotificationCompat.InboxStyle().setBigContentTitle(content.title)
    content.lines.forEach { style.addLine(it) }
    val pause = PendingIntent.getBroadcast(context, ID, Intent(context, AlertPauseReceiver::class.java)
      .setAction(ACTION_PAUSE), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val target = content.target
    val notification = NotificationCompat.Builder(context, NotificationChannels.ALERTS)
      .setSmallIcon(R.drawable.ic_stat_dog).setColor(NotificationChannels.accent(context))
      .setContentTitle(content.title).setContentText(content.collapsedText)
      .setStyle(style).setNumber(content.count)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      // A new alert pops up (the channel makes no sound of its own); an
      // update only changes the lines.
      .setSilent(command == "update").setOnlyAlertOnce(command == "update").setAutoCancel(true)
      .setShowWhen(true).setWhen(System.currentTimeMillis())
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(NotificationChannels.launch(context, target.screen, target.dogId, 1))
      .setDeleteIntent(PendingIntent.getBroadcast(context, ID + 1, Intent(context, AlertPauseReceiver::class.java)
        .setAction(ACTION_DISMISSED), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      .addAction(0, "打開地圖", NotificationChannels.launch(context, "open-map", null, 2))
      .addAction(0, "暫停提醒 ${Content.PAUSE_MINUTES} 分", pause)
      .build()
    // A new alert on a notification already showing pops up again only as a
    // new post (the channel is silent, so an update never peeks).
    if (command == "notify") manager.cancel(ID)
    manager.notify(ID, notification)
    showing = words
    Log.i(TAG, "notification $command: ${content.title} | ${content.lines.joinToString(" / ")}")
    return true
  }

  /** Vibration, sound, then the notification (an alert's attention first). */
  fun carryOut(context: Context, effects: Effects) {
    if (effects.vibration != null) runCatching { vibrate(context, effects.vibration, effects.critical) }
    if (effects.sound) runCatching { sound(context) }
    post(context, effects.notification, effects.content)
  }
}
