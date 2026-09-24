package com.dogtracker.cloud

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

@ReactModule(name = CloudSyncModule.NAME)
class CloudSyncModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  @ReactMethod fun configureSearch(owner: String?, enabled: Boolean, promise: Promise) {
    try {
      val intent = android.content.Intent(context, SearchRelayService::class.java)
      if (!enabled || owner.isNullOrEmpty()) context.stopService(intent)
      else if (SearchRelayService.instance?.belongsTo(owner) == false) context.stopService(intent)
      else if (SearchRelayService.timedOut) throw IllegalStateException("搜尋轉送已達 Android 執行時限")
      else if (com.dogtracker.BleForegroundService.isRunning && SearchRelayService.instance == null)
        context.startForegroundService(intent.putExtra("owner", owner))
      promise.resolve(null)
    } catch (error: Exception) { promise.reject("SEARCH_RELAY", "無法啟動搜尋轉送", error) }
  }
  @ReactMethod fun isSearchCurrent(id: String, owner: String, promise: Promise) {
    promise.resolve(SearchRelayService.instance?.isCurrent(id, owner) == true)
  }
  @ReactMethod fun completeSearch(id: String, promise: Promise) {
    context.runOnUiQueueThread { SearchRelayService.instance?.complete(id); promise.resolve(null) }
  }

  @ReactMethod fun setOwner(owner: String?, promise: Promise) {
    if (owner.isNullOrEmpty()) context.stopService(android.content.Intent(context, SearchRelayService::class.java))
    try { CloudSyncSchedule.setOwner(context, owner); promise.resolve(null) }
    catch (error: Exception) { promise.reject("CLOUD_SCHEDULE", "無法設定背景雲端同步", error) }
  }

  @ReactMethod fun isCurrent(runId: String, promise: Promise) {
    promise.resolve(CloudHistoryWorker.isCurrent(context, runId))
  }

  @ReactMethod fun complete(runId: String, outcome: String, promise: Promise) {
    CloudHistoryWorker.complete(runId, outcome)
    promise.resolve(null)
  }

  @ReactMethod fun cancelAccount(runId: String, promise: Promise) {
    try { CloudHistoryWorker.cancelAccount(context, runId); promise.resolve(null) }
    catch (error: Exception) { promise.reject("CLOUD_CANCEL", "無法取消背景同步", error) }
  }

  companion object { const val NAME = "CloudBackgroundSync" }
}

class CloudSyncPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext) =
    if (name == CloudSyncModule.NAME) CloudSyncModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(CloudSyncModule.NAME to ReactModuleInfo(
      // This module uses ReactMethod interop, not a codegen TurboModule spec.
      CloudSyncModule.NAME, CloudSyncModule.NAME, false, false, false, false))
  }
}
