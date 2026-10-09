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
      if (enabled && !owner.isNullOrEmpty() && SearchRelayService.timedOut)
        throw IllegalStateException(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1143))
      SearchRelayService.configure(context, owner, enabled)
      promise.resolve(null)
    } catch (error: Exception) { promise.reject("SEARCH_RELAY", com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1144), error) }
  }
  @ReactMethod fun isSearchCurrent(id: String, owner: String, promise: Promise) {
    promise.resolve(SearchRelayService.instance?.isCurrent(id, owner) == true)
  }
  @ReactMethod fun completeSearch(id: String, promise: Promise) {
    context.runOnUiQueueThread { SearchRelayService.instance?.complete(id); promise.resolve(null) }
  }

  @ReactMethod fun setOwner(owner: String?, promise: Promise) {
    if (owner.isNullOrEmpty()) SearchRelayService.configure(context, null, false)
    try { CloudSyncSchedule.setOwner(context, owner); promise.resolve(null) }
    catch (error: Exception) { promise.reject("CLOUD_SCHEDULE", com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1145), error) }
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
    catch (error: Exception) { promise.reject("CLOUD_CANCEL", com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1146), error) }
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
