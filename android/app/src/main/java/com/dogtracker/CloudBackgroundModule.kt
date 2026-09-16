package com.dogtracker

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState

class CloudBackgroundModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "CloudBackground"

  @ReactMethod
  fun start(promise: Promise) {
    try {
      if (context.lifecycleState != LifecycleState.RESUMED) {
        promise.reject("CLOUD_NOT_FOREGROUND", "請在 App 前景啟動背景同步")
        return
      }
      val intent = Intent(context, CloudBackgroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
      promise.resolve(true)
    } catch (_: Exception) {
      promise.reject("CLOUD_SERVICE_START_FAILED", "無法啟動雲端背景服務")
    }
  }

  @ReactMethod
  fun stop() { context.stopService(Intent(context, CloudBackgroundService::class.java)) }

  @ReactMethod
  fun getRunId(promise: Promise) { promise.resolve(CloudBackgroundService.instance?.runId) }

  @ReactMethod
  fun updateStatus(text: String) { CloudBackgroundService.instance?.updateStatus(text.take(160)) }

  @ReactMethod fun addListener(event: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit
}
