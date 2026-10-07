package com.dogtracker

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

// The launch screen stays up until its drawing has finished and the app has
// something to show, so it is never cut off halfway and never followed by a
// blank screen. A timeout lets the app through if JavaScript never reports.
object SplashState {
  @Volatile var animationDone = false
  @Volatile var appReady = false
  const val ANIMATION_MS = 800L
  const val TIMEOUT_MS = 10_000L
  fun keepOnScreen() = !(animationDone && appReady)
}

class AppSplashModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AppSplash"

  @ReactMethod
  fun hide() {
    SplashState.appReady = true
  }
}

class AppSplashPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(AppSplashModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
