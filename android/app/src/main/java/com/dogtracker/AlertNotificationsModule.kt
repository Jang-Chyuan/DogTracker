package com.dogtracker

import android.os.Build
import com.dogtracker.alerts.AlertPoster
import com.dogtracker.alerts.BackgroundAlerts
import com.dogtracker.alerts.Content
import com.dogtracker.alerts.NotificationContent
import com.dogtracker.alerts.Target
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject

/** The alerts' Android side for the app in front (see BackgroundAlerts). */
@ReactModule(name = AlertNotificationsModule.NAME)
class AlertNotificationsModule(context: ReactApplicationContext) : NativeAlertNotificationsSpec(context) {
  companion object { const val NAME = "AlertNotifications" }
  override fun getName() = NAME

  private fun run(promise: Promise, block: () -> Any?) {
    try { promise.resolve(block()) } catch (error: Exception) { promise.reject("alert_notifications", error) }
  }

  override fun loadState(promise: Promise) = run(promise) { BackgroundAlerts.load(reactApplicationContext) }

  override fun saveState(state: String, basedOn: Double, promise: Promise) = run(promise) {
    BackgroundAlerts.save(reactApplicationContext, state, basedOn.toLong())
  }

  override fun handOver(snapshot: String, promise: Promise) = run(promise) {
    BackgroundAlerts.handOver(reactApplicationContext, snapshot); null
  }

  override fun deliver(effects: String, promise: Promise) = run(promise) {
    val data = JSONObject(effects)
    val context = reactApplicationContext
    // Only a posted new alert makes Android's own noise (in front: none).
    val systemAlerts = data.optString("command") == "notify" && AlertPoster.alertsEnabled(context)
    data.optJSONArray("vibration")?.let { array ->
      val pattern = LongArray(array.length()) { array.optLong(it) }
      if (pattern.isNotEmpty()) AlertPoster.vibrate(context, pattern, data.optBoolean("critical"), systemAlerts)
    }
    if (data.optBoolean("sound")) AlertPoster.sound(context, systemAlerts)
    val content = data.optJSONObject("content")?.let { value ->
      val lines = value.optJSONArray("lines") ?: return@let null
      val target = value.optJSONObject("target") ?: JSONObject()
      NotificationContent(value.getString("title"), (0 until lines.length()).map { lines.getString(it) },
        Target(target.optString("screen", "map"), if (target.isNull("dogId") || !target.has("dogId")) null
          else target.get("dogId").toString()))
    }
    AlertPoster.post(context, data.optString("command", "cancel"), content)
  }

  override fun permissionState(promise: Promise) = run(promise) {
    JSONObject().put("required", Build.VERSION.SDK_INT >= 33)
      .put("granted", AlertPoster.allowed(reactApplicationContext))
      .put("alertsEnabled", AlertPoster.alertsEnabled(reactApplicationContext))
      .put("pauseMinutes", Content.PAUSE_MINUTES).toString()
  }
}
