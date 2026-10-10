package com.dogtracker

import android.app.NotificationManager
import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import android.view.HapticFeedbackConstants
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = TrackingPlatformModule.NAME)
class TrackingPlatformModule(context: ReactApplicationContext) : NativeTrackingPlatformSpec(context) {
  override fun getName() = NAME
  override fun isMapConfigured() = BuildConfig.GOOGLE_MAPS_CONFIGURED

  override fun initialize() {
    super.initialize()
    // Upgrade cleanup for the removed feature; never post or request notices.
    try {
      val manager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(1001)
      if (Build.VERSION.SDK_INT >= 26) manager.deleteNotificationChannel("tracking_stale")
    } catch (error: Exception) {
      // Cleanup of an obsolete notice must not prevent maps/location startup.
      com.dogtracker.AppLog.w(NAME, "Unable to remove legacy tracking notification", error)
    }
  }

  // Installation-level permission UX, separate from tracking data.
  override fun claimLocationPermissionPrompt(promise: Promise) {
    try {
      synchronized(this) {
        val preferences = reactApplicationContext.getSharedPreferences("phone_location", Context.MODE_PRIVATE)
        if (preferences.getBoolean("prompt_requested", false)) {
          promise.resolve(false)
        } else {
          if (!preferences.edit().putBoolean("prompt_requested", true).commit()) {
            throw IllegalStateException(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1068))
          }
          promise.resolve(true)
        }
      }
    } catch (error: Exception) {
      promise.reject("location_prompt_state", com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1068), error)
    }
  }

  override fun locationServicesEnabled(promise: Promise) {
    try {
      val location = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      val enabled = if (Build.VERSION.SDK_INT >= 28) location.isLocationEnabled
        else location.isProviderEnabled(LocationManager.GPS_PROVIDER) || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
      promise.resolve(enabled)
    } catch (error: Exception) {
      promise.reject("location_status", com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1069), error)
    }
  }

  override fun appVersion(): String = BuildConfig.VERSION_NAME
  override fun packageName(): String = reactApplicationContext.packageName

  // Touch haptics through the window (no VIBRATE permission; follows the
  // system's touch-feedback setting). EFFECT_DOUBLE_CLICK is two light taps.
  override fun performHaptic(effect: String) {
    val view = reactApplicationContext.currentActivity?.window?.decorView ?: return
    val constant = when (effect) {
      "EFFECT_TICK" -> HapticFeedbackConstants.CLOCK_TICK
      "EFFECT_CLICK" -> HapticFeedbackConstants.CONTEXT_CLICK
      "EFFECT_DOUBLE_CLICK" -> HapticFeedbackConstants.KEYBOARD_TAP
      "EFFECT_HEAVY_CLICK" -> HapticFeedbackConstants.LONG_PRESS
      else -> return
    }
    UiThreadUtil.runOnUiThread {
      view.performHapticFeedback(constant)
      if (effect == "EFFECT_DOUBLE_CLICK") view.postDelayed({ view.performHapticFeedback(constant) }, 90)
    }
  }

  override fun batteryOptimizationIgnored(promise: Promise) {
    try {
      val power = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(power.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
    } catch (error: Exception) {
      promise.reject("battery_optimization", com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1070), error)
    }
  }

  companion object { const val NAME = "TrackingPlatform" }
}
