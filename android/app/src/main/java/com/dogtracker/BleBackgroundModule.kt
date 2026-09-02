package com.dogtracker

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BleBackgroundModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName(): String = "BleBackground"

  @ReactMethod
  fun start(status: String) {
    val intent = Intent(context, BleForegroundService::class.java)
      .putExtra("status", status)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
  }

  @ReactMethod
  fun stop() {
    context.stopService(Intent(context, BleForegroundService::class.java))
  }

  @ReactMethod
  fun moveToBackground() {
    context.currentActivity?.moveTaskToBack(true)
  }
}
