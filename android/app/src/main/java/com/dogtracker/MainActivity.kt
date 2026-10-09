package com.dogtracker

import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log

import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.content.ContextCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // Must run before super.onCreate: it swaps Theme.App.Starting for AppTheme.
    // Warm start (already handed over in this process): no launch screen to
    // wait for.
    SplashState.animationDone = SplashState.handedOver
    SplashState.fromNotification =
      intent?.getBooleanExtra(SplashState.EXTRA_FROM_NOTIFICATION, false) == true
    // The system launch screen only waits for its drawing (800 ms): the window
    // under it shows the same picture (launch_background) and JavaScript's
    // copy (SplashOverlay) takes over from there, so nothing waits on a held
    // first draw. (Holding the first draw longer left the window black when
    // the system removed its launch screen early — in debug builds Metro's
    // loading banner draws first and the system took that as the app ready.)
    // Debug builds: Metro's "Loading…" banner is a window of its own that
    // draws first, and the system takes it as the app being ready and removes
    // its launch screen while the held first draw keeps our window black. So
    // in debug the window draws at once (the same picture); release builds
    // keep the system screen for its 800 ms drawing.
    installSplashScreen().apply {
      setKeepOnScreenCondition { !BuildConfig.DEBUG && SplashState.keepOnScreen() }
      // No exit animation: the window under it shows the same picture, so it
      // is removed at once (the system's default exit faded the whole app
      // window in from black for ~250 ms).
      setOnExitAnimationListener { it.remove() }
    }
    val handler = Handler(Looper.getMainLooper())
    handler.postDelayed({ SplashState.animationDone = true }, SplashState.ANIMATION_MS)
    super.onCreate(savedInstanceState)
    updateSystemBars(resources.configuration)
  }

  // singleTask: a notification tapped while the app is still opening arrives
  // here; its handover is the plain fade too.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (intent.getBooleanExtra(SplashState.EXTRA_FROM_NOTIFICATION, false)) SplashState.fromNotification = true
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    setTheme(R.style.AppTheme)
    updateSystemBars(newConfig)
  }

  @Suppress("DEPRECATION")
  fun updateSystemBars(config: Configuration) {
    val dark = (config.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    // While the app opens the window is the launch screen's picture.
    val opening = !SplashState.handedOver
    window.navigationBarColor = ContextCompat.getColor(this, if (opening) R.color.splash_background else R.color.app_background)
    if (opening) window.setBackgroundDrawableResource(R.drawable.launch_background)
    else window.setBackgroundDrawableResource(R.color.app_background)
    WindowInsetsControllerCompat(window, window.decorView).apply {
      isAppearanceLightStatusBars = !dark
      isAppearanceLightNavigationBars = !dark
    }
  }

  override fun onResume() {
    super.onResume()
    // The bars follow the screen shown: a handover that finished while this
    // activity was not the current one (AppSplash.done found none) applies now.
    if (SplashState.handedOver) updateSystemBars(resources.configuration)
    // The app on screen runs the alerts itself (useAlertEngine).
    com.dogtracker.alerts.BackgroundAlerts.setAppVisible(true, this)
    // Only resume when the user brings the app to the foreground. A manual
    // stop clears enabled; a system force-stop leaves the saved session intact.
    val prefs = getSharedPreferences("ble_session", MODE_PRIVATE)
    if (BleForegroundService.isRunning || !prefs.getBoolean("enabled", false)) return
    val deviceId = prefs.getString("deviceId", "").orEmpty()
    if (deviceId.isBlank()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
      prefs.edit().putString("resumeError", com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1051)).apply()
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
      com.dogtracker.AppLog.e("DogTracker", "Unable to resume saved BLE session", error)
      prefs.edit().putString("resumeError", com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1052, error.message)).apply()
    }
  }

  override fun onPause() {
    // Off screen: the receiver's service checks the alerts (BackgroundAlerts).
    com.dogtracker.alerts.BackgroundAlerts.setAppVisible(false)
    super.onPause()
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
