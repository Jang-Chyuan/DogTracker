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

  @ReactMethod fun setOwner(owner: String?, promise: Promise) {
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
      CloudSyncModule.NAME, CloudSyncModule.NAME, false, false, false, true))
  }
}
