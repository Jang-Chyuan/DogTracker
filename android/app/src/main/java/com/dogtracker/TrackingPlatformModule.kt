package com.dogtracker

import android.app.NotificationManager
import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.util.Log
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
      Log.w(NAME, "Unable to remove legacy tracking notification", error)
    }
  }

  // Installation-level permission UX, separate from Demo and tracking data.
  override fun claimLocationPermissionPrompt(promise: Promise) {
    try {
      synchronized(this) {
        val preferences = reactApplicationContext.getSharedPreferences("phone_location", Context.MODE_PRIVATE)
        if (preferences.getBoolean("prompt_requested", false)) {
          promise.resolve(false)
        } else {
          if (!preferences.edit().putBoolean("prompt_requested", true).commit()) {
            throw IllegalStateException("無法保存定位詢問紀錄")
          }
          promise.resolve(true)
        }
      }
    } catch (error: Exception) {
      promise.reject("location_prompt_state", "無法保存定位詢問紀錄", error)
    }
  }

  override fun locationServicesEnabled(promise: Promise) {
    try {
      val location = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      val enabled = if (Build.VERSION.SDK_INT >= 28) location.isLocationEnabled
        else location.isProviderEnabled(LocationManager.GPS_PROVIDER) || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
      promise.resolve(enabled)
    } catch (error: Exception) {
      promise.reject("location_status", "無法讀取系統定位狀態", error)
    }
  }

  companion object { const val NAME = "TrackingPlatform" }
}
