package com.dogtracker

import android.content.Intent
import android.os.Build
import android.util.Log

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onResume() {
    super.onResume()
    // Only resume when the user brings the app to the foreground. A manual
    // stop clears enabled; a system force-stop leaves the saved session intact.
    val prefs = getSharedPreferences("ble_session", MODE_PRIVATE)
    if (BleForegroundService.isRunning || !prefs.getBoolean("enabled", false)) return
    val deviceId = prefs.getString("deviceId", "").orEmpty()
    if (deviceId.isBlank()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
      prefs.edit().putString("resumeError", "背景恢復失敗：請重新授予藍牙權限後連線").apply()
      return
    }
    try {
      require(android.bluetooth.BluetoothAdapter.checkBluetoothAddress(deviceId))
      java.util.UUID.fromString(prefs.getString("serviceUuid", ""))
      java.util.UUID.fromString(prefs.getString("dataUuid", ""))
      val intent = Intent(this, BleForegroundService::class.java).apply {
        action = BleForegroundService.ACTION_RESUME
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
      else startService(intent)
    } catch (error: Exception) {
      Log.e("DogTracker", "Unable to resume saved BLE session", error)
      prefs.edit().putString("resumeError", "背景恢復失敗：${error.message}").apply()
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "DogTracker"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
