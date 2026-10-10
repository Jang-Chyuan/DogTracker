package com.dogtracker

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AlertNotificationsPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext) =
    if (name == AlertNotificationsModule.NAME) AlertNotificationsModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(AlertNotificationsModule.NAME to ReactModuleInfo(AlertNotificationsModule.NAME, AlertNotificationsModule.NAME, false, false, false, true))
  }
}
