package com.dogtracker

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class BleBackgroundModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName(): String = "BleBackground"

  init {
    BleForegroundService.eventSink = { event, value ->
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(event, value)
      }
    }
  }

  @ReactMethod
  fun connect(deviceId: String, deviceName: String, serviceUuid: String, dataUuid: String, promise: Promise) {
    try {
      val intent = Intent(context, BleForegroundService::class.java).apply {
        action = BleForegroundService.ACTION_CONNECT
        putExtra(BleForegroundService.EXTRA_DEVICE_ID, deviceId)
        putExtra(BleForegroundService.EXTRA_DEVICE_NAME, deviceName)
        putExtra(BleForegroundService.EXTRA_SERVICE_UUID, serviceUuid)
        putExtra(BleForegroundService.EXTRA_DATA_UUID, dataUuid)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BLE_CONNECT_START_FAILED", error)
    }
  }

  @ReactMethod
  fun start(status: String) {
    // Kept for compatibility. A real session is started by connect().
  }

  @ReactMethod
  fun stop() {
    context.startService(Intent(context, BleForegroundService::class.java).apply {
      action = BleForegroundService.ACTION_STOP
    })
  }

  @ReactMethod
  fun moveToBackground() {
    context.currentActivity?.moveTaskToBack(true)
  }

  @ReactMethod
  fun getState(promise: Promise) {
    val prefs = context.getSharedPreferences("ble_session", android.content.Context.MODE_PRIVATE)
    val result = Arguments.createMap().apply {
      putBoolean("running", BleForegroundService.isRunning)
      putBoolean("connected", BleForegroundService.isConnected)
      putBoolean("enabled", prefs.getBoolean("enabled", false))
      putString("deviceName", prefs.getString("deviceName", "DogGPS Master"))
      putString("lastStatus", prefs.getString("lastStatus", ""))
      putString("lastPayload", prefs.getString("lastPayload", ""))
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun isRunning(promise: Promise) = promise.resolve(BleForegroundService.isRunning)

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    BleForegroundService.eventSink = null
    super.invalidate()
  }
}
