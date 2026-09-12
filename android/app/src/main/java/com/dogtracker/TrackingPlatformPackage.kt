package com.dogtracker

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class TrackingPlatformPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext) =
    if (name == TrackingPlatformModule.NAME) TrackingPlatformModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(TrackingPlatformModule.NAME to ReactModuleInfo(TrackingPlatformModule.NAME, TrackingPlatformModule.NAME, false, false, false, true))
  }
}
