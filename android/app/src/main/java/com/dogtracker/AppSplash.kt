package com.dogtracker

import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager

// The launch screen (D0; 「D0 → 地圖銜接（C）」). The system launch screen only
// stays for its drawing (ANIMATION_MS). Under it the window already shows the
// same picture (res/drawable/launch_background), and JavaScript draws its own
// copy (src/app/SplashOverlay.js) that waits for the first screen and hands
// over to it. So there is never a black or empty window, whatever the timing.
object SplashState {
  @Volatile var animationDone = false
  // Opened from one of our notifications. JavaScript reads where it leads
  // from the link (hideSplash.launchFromNotification); kept for diagnostics.
  @Volatile var fromNotification = false
  // The handover has finished in this process: the window's launch picture
  // gives way to the plain app background; an activity made again later
  // (warm start) has no launch screen to wait for.
  @Volatile var handedOver = false
  const val EXTRA_FROM_NOTIFICATION = "dogtracker.from_notification"
  const val ANIMATION_MS = 800L
  fun keepOnScreen() = !animationDone
  // At most 2 s: a handover never keeps the launch screen's colours longer.
  fun handoverDelay(durationMs: Double): Long =
    if (durationMs.isFinite()) durationMs.toLong().coerceIn(0L, 2000L) else 0L
}

class AppSplashModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AppSplash"

  // The JavaScript copy of the launch screen is drawn. Kept for older
  // callers: the system launch screen no longer waits for it.
  @ReactMethod
  fun hide() {}

  // The JavaScript copy has handed over and is gone: the window background
  // and navigation bar become the app's own (MainActivity.updateSystemBars).
  @ReactMethod
  fun done() {
    SplashState.handedOver = true
    val activity = reactApplicationContext.currentActivity as? MainActivity ?: return
    activity.runOnUiThread { activity.updateSystemBars(activity.resources.configuration) }
  }

  // The handover has started and its animation runs on the UI thread for
  // `durationMs`: the bars become the app's own when it ends, on the UI thread
  // too. done() comes through JavaScript, which can run seconds late on a busy
  // phone; meanwhile the map showed under a coral navigation bar.
  @ReactMethod
  fun handover(durationMs: Double) {
    val delay = SplashState.handoverDelay(durationMs)
    Handler(Looper.getMainLooper()).postDelayed({
      SplashState.handedOver = true
      (reactApplicationContext.currentActivity as? MainActivity)?.let {
        it.updateSystemBars(it.resources.configuration)
      }
    }, delay)
  }

  // How this launch should hand over (D0 → 地圖銜接（C）): opened from a
  // notification, and the system animator scale (0 = animations off).
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun launchInfo(): WritableMap = Arguments.createMap().apply {
    putBoolean("fromNotification", SplashState.fromNotification)
    putDouble(
      "animatorScale",
      android.provider.Settings.Global.getFloat(
        reactApplicationContext.contentResolver,
        android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
        1f,
      ).toDouble(),
    )
  }

  @ReactMethod
  fun hold() {}
}

class AppSplashPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(AppSplashModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
