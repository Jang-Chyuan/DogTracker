package com.dogtracker.location

import android.content.Intent
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.Executors

class LocationTrackerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  private val store by lazy { LocationTrackerStore(context) }
  override fun getName() = "LocationTracker"
  @ReactMethod fun displayPosition(session: String, timestamp: Double, latitude: Double, longitude: Double) {
    if (context.lifecycleState != LifecycleState.RESUMED || !LocationTrackerService.running ||
      !timestamp.isFinite() || timestamp <= 0 || !latitude.isFinite() || !longitude.isFinite() ||
      kotlin.math.abs(latitude) > 90 || kotlin.math.abs(longitude) > 180) return
    LocationTrackerService.displayLocation = DisplayLocation(session, timestamp.toLong(), latitude, longitude,
      android.os.SystemClock.elapsedRealtimeNanos())
  }
  @ReactMethod fun clearDisplayPosition(session: String) {
    if (LocationTrackerService.displayLocation?.session == session) LocationTrackerService.displayLocation = null
  }
  @ReactMethod fun live(promise: Promise) {
    promise.resolve(org.json.JSONObject(LocationTrackerService.liveJson)
      .put("running", LocationTrackerService.running).put("status", LocationTrackerService.status).toString())
  }
  @ReactMethod fun start(promise: Promise) {
    try {
      check(context.lifecycleState == LifecycleState.RESUMED) { "請在 App 前景開始記錄" }
      context.getSharedPreferences("phone_location_recording", 0).edit().putBoolean("enabled", true).apply()
      val intent = Intent(context, LocationTrackerService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("LOCATION_START", e.message, e) }
  }
  @ReactMethod fun stop(promise: Promise) {
    context.getSharedPreferences("phone_location_recording", 0).edit().putBoolean("enabled", false).apply()
    context.stopService(Intent(context, LocationTrackerService::class.java))
    promise.resolve(true)
  }
  @ReactMethod fun resumeIfEnabled(promise: Promise) {
    try {
      val enabled = context.getSharedPreferences("phone_location_recording", 0).getBoolean("enabled", true)
      val precise = androidx.core.content.ContextCompat.checkSelfPermission(context,
        android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
      val manager = context.getSystemService(android.location.LocationManager::class.java)
      if (!enabled || LocationTrackerService.running || context.lifecycleState != LifecycleState.RESUMED ||
        !precise || !manager.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)) {
        promise.resolve(false); return
      }
      val intent = Intent(context, LocationTrackerService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      LocationTrackerService.status = "自動開始失敗，請至手機位置記錄頁重試"
      promise.reject("LOCATION_AUTO_START", e.message, e)
    }
  }
  @ReactMethod fun page(before: Double, promise: Promise) {
    executor.execute {
      try {
        val result = store.page(before.toLong())
          .put("running", LocationTrackerService.running).put("status", LocationTrackerService.status)
        promise.resolve(result.toString())
      } catch (e: Exception) { promise.reject("LOCATION_READ", "無法讀取手機定位記錄", e) }
    }
  }
  override fun invalidate() { executor.shutdown(); super.invalidate() }
}

class LocationTrackerPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(LocationTrackerModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
