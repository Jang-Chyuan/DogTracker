package com.dogtracker.location

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.dogtracker.NativeCopy
import com.dogtracker.NotificationChannels
import com.dogtracker.R
import com.dogtracker.serviceStartLog

/**
 * After an app update or a phone restart: starts 我的路線's recording again
 * when it was on and Android gives it location, otherwise asks the user with
 * a notification (RecordingResume). Each outcome goes to the recording's
 * start log (dumpsys activity service LocationTrackerService).
 */
class RecordingResumeReceiver : BroadcastReceiver() {
  companion object {
    const val NOTIFICATION_ID = 3108

    /** Removes the 「點一下繼續記錄路線」 notification (recording started, or switched off). */
    fun clear(context: Context) = runCatching { NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID) }
  }

  override fun onReceive(context: Context, intent: Intent) {
    val trigger = RecordingResume.triggerOf(intent.action) ?: return
    val log = context.serviceStartLog(com.dogtracker.ServiceStarts.LOCATION)
    val now = System.currentTimeMillis()
    try {
      val enabled = context.getSharedPreferences("phone_location_recording", 0).getBoolean("enabled", true)
      val precise = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
      val manager = context.getSystemService(LocationManager::class.java)
      val locationOn = manager != null && androidx.core.location.LocationManagerCompat.isLocationEnabled(manager)
      val decision = RecordingResume.decide(enabled, LocationTrackerService.running, precise, locationOn, Build.VERSION.SDK_INT)
      when (decision.action) {
        RecordingResume.Action.SKIP -> log.note(now, RecordingResume.note(trigger, decision.action, decision.reason))
        RecordingResume.Action.START -> {
          val refused = try {
            val service = Intent(context, LocationTrackerService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service)
            null
          } catch (error: Exception) { error }
          if (refused == null) log.note(now, RecordingResume.note(trigger, decision.action, decision.reason))
          else log.note(now, RecordingResume.note(trigger, RecordingResume.Action.NOTIFY,
            "start refused: ${refused.javaClass.simpleName}", notify(context, trigger)))
        }
        RecordingResume.Action.NOTIFY ->
          log.note(now, RecordingResume.note(trigger, decision.action, decision.reason, notify(context, trigger)))
      }
    } catch (error: Exception) {
      runCatching { log.note(now, "${trigger.label}: check failed ${error.javaClass.simpleName}") }
    }
  }

  /** Posts the notification; returns a dumpsys remark when it could not be shown. */
  @android.annotation.SuppressLint("MissingPermission") // areNotificationsEnabled, and the SecurityException caught
  private fun notify(context: Context, trigger: RecordingResume.Trigger): String? {
    NotificationChannels.create(context)
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return "notifications blocked"
    val text = NativeCopy.text(if (trigger == RecordingResume.Trigger.UPDATE) R.string.c1401 else R.string.c1402)
    // A tap opens 我的路線; the app on screen resumes the recording (resumeIfEnabled).
    val notification = NotificationCompat.Builder(context, NotificationChannels.ALERTS)
      .setSmallIcon(R.drawable.ic_stat_dog).setColor(NotificationChannels.accent(context))
      .setContentTitle(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setCategory(NotificationCompat.CATEGORY_REMINDER).setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(NotificationChannels.launch(context, "my-route", requestCode = NOTIFICATION_ID))
      .setAutoCancel(true).build()
    return try { manager.notify(NOTIFICATION_ID, notification); null }
    catch (error: SecurityException) { "notifications blocked" }
  }
}
