package com.dogtracker

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

// The launch screen (D0) stays up until its drawing has finished and the app
// has something to show, so it is never cut off halfway and never followed by
// a blank screen. A timeout lets the app through if JavaScript never reports;
// once JavaScript is running and deciding what opens first (opening the
// database, restoring the sign-in, which can take longer on a first launch)
// it holds the screen up to HOLD_TIMEOUT_MS instead.
object SplashState {
  @Volatile var animationDone = false
  @Volatile var appReady = false
  @Volatile var held = false
  const val ANIMATION_MS = 800L
  const val TIMEOUT_MS = 10_000L
  const val HOLD_TIMEOUT_MS = 30_000L
  fun keepOnScreen() = !(animationDone && appReady)
}

class AppSplashModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AppSplash"

  @ReactMethod
  fun hide() {
    SplashState.appReady = true
  }

  // JavaScript is up and deciding what opens first: TIMEOUT_MS no longer
  // applies, only HOLD_TIMEOUT_MS from the start.
  @ReactMethod
  fun hold() {
    SplashState.held = true
  }
}

class AppSplashPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(AppSplashModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
