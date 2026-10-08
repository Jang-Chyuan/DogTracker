package com.dogtracker

import android.app.Application
import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(TrackingPlatformPackage())
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(BleBackgroundPackage())
          add(HistoryExportPackage())
          add(com.dogtracker.location.LocationTrackerPackage())
          add(QrScannerPackage())
          add(com.dogtracker.cloud.CloudSyncPackage())
          add(AppSplashPackage())
          add(PlaceLookupPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Light only (v3 has no dark mode): the app's configuration stays day in
    // the phone's dark mode, so React Native's Appearance, AppCompat widgets
    // and dialogs all keep their light look.
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
    loadReactNative(this)
  }
}
