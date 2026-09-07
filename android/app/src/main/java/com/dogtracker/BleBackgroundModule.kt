package com.dogtracker

import android.content.Intent
import android.os.Build
import android.os.SystemClock
import java.util.UUID
import java.util.concurrent.Executors
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class BleBackgroundModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName(): String = "BleBackground"
  private val databaseWorker = Executors.newSingleThreadExecutor()

  init {
    BleForegroundService.eventSink = { event, value ->
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(event, value)
      }
    }
  }

  @ReactMethod
  fun connect(deviceId: String, deviceName: String, serviceUuid: String, dataUuid: String, expectedMasterId: Int, promise: Promise) {
    try {
      require(android.bluetooth.BluetoothAdapter.checkBluetoothAddress(deviceId)) { "Invalid BLE address" }
      UUID.fromString(serviceUuid)
      UUID.fromString(dataUuid)
      val sessionId = UUID.randomUUID().toString()
      val intent = Intent(context, BleForegroundService::class.java).apply {
        action = BleForegroundService.ACTION_CONNECT
        putExtra(BleForegroundService.EXTRA_DEVICE_ID, deviceId)
        putExtra(BleForegroundService.EXTRA_DEVICE_NAME, deviceName)
        putExtra(BleForegroundService.EXTRA_SERVICE_UUID, serviceUuid)
        putExtra(BleForegroundService.EXTRA_DATA_UUID, dataUuid)
        putExtra("expectedMasterId", expectedMasterId)
        putExtra("sessionId", sessionId)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
      promise.resolve(sessionId)
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
    context.getSharedPreferences("ble_session", android.content.Context.MODE_PRIVATE)
      .edit().putBoolean("enabled", false).commit()
    context.stopService(Intent(context, BleForegroundService::class.java))
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
      putBoolean("receiving", BleForegroundService.isConnected && BleForegroundService.lastDataElapsed > 0 &&
        SystemClock.elapsedRealtime() - BleForegroundService.lastDataElapsed < 30_000)
      putString("sessionId", prefs.getString("sessionId", ""))
      putString("deviceId", prefs.getString("deviceId", ""))
      putDouble("lastReceivedAt", prefs.getLong("lastReceivedAt", 0).toDouble())
      putString("storageError", prefs.getString("storageError", ""))
      putString("resumeError", prefs.getString("resumeError", ""))
      putString("deviceName", prefs.getString("deviceName", "DogGPS Master"))
      putString("lastStatus", prefs.getString("lastStatus", ""))
      putString("lastPayload", prefs.getString("lastPayload", ""))
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun isRunning(promise: Promise) = promise.resolve(BleForegroundService.isRunning)

  @ReactMethod
  fun wifiCommand(json: String, read: Boolean, promise: Promise) {
    val service = BleForegroundService.instance
    if (service == null) promise.reject("BLE_NOT_CONNECTED", "BLE 尚未連線")
    else service.wifiCommand(json, read) { value, error ->
      if (error != null) promise.reject("BLE_WIFI_FAILED", error) else promise.resolve(value)
    }
  }

  private fun databaseTask(promise: Promise, action: (DogStatusStore) -> Any?) {
    databaseWorker.execute {
      try { promise.resolve(action(DogStatusStore.get(context))) }
      catch (error: Exception) { promise.reject("BLE_DATABASE_FAILED", error) }
    }
  }

  @ReactMethod
  fun initializeDatabase(promise: Promise) = databaseTask(promise) { true }

  @ReactMethod
  fun listHistory(limit: Int, promise: Promise) = databaseTask(promise) { it.history(limit) }

  @ReactMethod
  fun deleteHistory(promise: Promise) = databaseTask(promise) { it.clear(); true }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    BleForegroundService.eventSink = null
    databaseWorker.shutdown()
    super.invalidate()
  }
}
