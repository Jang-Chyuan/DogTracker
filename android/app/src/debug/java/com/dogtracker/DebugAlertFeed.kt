package com.dogtracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.dogtracker.alerts.BackgroundAlerts
import com.dogtracker.alerts.ReceiverInput
import org.json.JSONObject

/**
 * Debug builds only: drives the background alert check without a receiver,
 * so the emulator can show the real notification path (src/dev/README.md,
 * 「背景提醒」). Fake positions only.
 *
 *   adb shell am broadcast -n com.dogtracker/.DebugAlertFeed -a com.dogtracker.debug.ALERT_PACKET \
 *     --ei sid 4 --ef lat 24.989 --ef lon 121.314 --ef mlat 24.989 --ef mlon 121.313 --ei bp 60 [--el at <ms>]
 *   adb shell am broadcast -n com.dogtracker/.DebugAlertFeed -a com.dogtracker.debug.ALERT_STEP \
 *     [--ez connected false --el disconnectedAt <ms> --ei number 7 --ei battery 62 --es storageError ... --el at <ms>]
 *   adb shell am broadcast -n com.dogtracker/.DebugAlertFeed -a com.dogtracker.debug.ALERT_RESET
 *   adb shell am broadcast -n com.dogtracker/.DebugAlertFeed -a com.dogtracker.debug.ALERT_RECEIVER
 *     (starts the receiver's service with a made-up DogGPS-Master7 that never answers: its 「常駐」
 *     notification and the service's own background check every 10 s; 中斷連線 on it stops it)
 */
class DebugAlertFeed : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val at = intent.getLongExtra("at", System.currentTimeMillis())
    when (intent.action) {
      "com.dogtracker.debug.ALERT_PACKET" -> {
        val packet = JSONObject().put("sid", intent.getIntExtra("sid", 0)).put("mid", intent.getIntExtra("mid", 7))
          .put("slat", intent.getFloatExtra("lat", 0f).toDouble()).put("slon", intent.getFloatExtra("lon", 0f).toDouble())
          .put("mlat", intent.getFloatExtra("mlat", 0f).toDouble()).put("mlon", intent.getFloatExtra("mlon", 0f).toDouble())
        if (intent.hasExtra("bp")) packet.put("bp", intent.getIntExtra("bp", 0)).put("bv", 1)
        if (intent.hasExtra("mbp")) packet.put("mbp", intent.getIntExtra("mbp", 0)).put("mbv", 1)
        if (intent.hasExtra("usb")) packet.put("usbPresent", if (intent.getBooleanExtra("usb", false)) 1 else 0)
        BackgroundAlerts.onPacket(context, packet, at)
        Log.i("DogTrackerAlerts", "debug packet $packet at $at")
      }
      "com.dogtracker.debug.ALERT_STEP" -> {
        val connected = intent.getBooleanExtra("connected", true)
        val input = ReceiverInput(
          enabled = true, running = true, connected = connected,
          disconnectedAt = if (connected) 0 else intent.getLongExtra("disconnectedAt", at - 60_000),
          number = intent.getIntExtra("number", 7),
          batteryPercentage = if (intent.hasExtra("battery")) intent.getIntExtra("battery", 0) else BackgroundAlerts.receiverBattery(context),
          storageError = intent.getStringExtra("storageError"),
          pauses = emptyList(),
        )
        val effects = BackgroundAlerts.evaluate(context, input, at)
        Log.i("DogTrackerAlerts", "debug step at $at: ${effects?.notification ?: "app on screen, skipped"}")
      }
      "com.dogtracker.debug.ALERT_RECEIVER" -> {
        val start = Intent(context, BleForegroundService::class.java).setAction(BleForegroundService.ACTION_CONNECT)
          .putExtra(BleForegroundService.EXTRA_DEVICE_ID, "02:00:00:00:00:07")
          .putExtra(BleForegroundService.EXTRA_DEVICE_NAME, "DogGPS-Master7")
          .putExtra(BleForegroundService.EXTRA_SERVICE_UUID, "7f510001-6d9e-4e2f-a671-8f3f2d49a001")
          .putExtra(BleForegroundService.EXTRA_DATA_UUID, "7f510002-6d9e-4e2f-a671-8f3f2d49a001")
          .putExtra("expectedMasterId", 7)
        androidx.core.content.ContextCompat.startForegroundService(context, start)
        Log.i("DogTrackerAlerts", "debug receiver service started")
      }
      "com.dogtracker.debug.ALERT_RESET" -> {
        BackgroundAlerts.reset(context)
        Log.i("DogTrackerAlerts", "debug reset")
      }
    }
  }
}
