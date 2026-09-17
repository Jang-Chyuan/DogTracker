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
  @ReactMethod fun live(promise: Promise) {
    promise.resolve(org.json.JSONObject(LocationTrackerService.liveJson)
      .put("running", LocationTrackerService.running).put("status", LocationTrackerService.status).toString())
  }
  @ReactMethod fun start(promise: Promise) {
    try {
      check(context.lifecycleState == LifecycleState.RESUMED) { "請在 App 前景開始記錄" }
      val intent = Intent(context, LocationTrackerService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("LOCATION_START", e.message, e) }
  }
  @ReactMethod fun stop(promise: Promise) {
    context.stopService(Intent(context, LocationTrackerService::class.java))
    promise.resolve(true)
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
