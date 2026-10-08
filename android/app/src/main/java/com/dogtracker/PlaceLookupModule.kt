package com.dogtracker

import android.location.Address
import android.location.Geocoder
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

// Android's built-in reverse geocoder (Google's address data on phones with
// Play services): free, no key. Answers a JSON array of nearby addresses,
// each with its own coordinate, so the caller can tell how near it is.
class PlaceLookupModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PlaceLookup"

  private val worker = java.util.concurrent.Executors.newSingleThreadExecutor()

  @ReactMethod
  fun isOnline(promise: Promise) {
    try {
      val manager = reactApplicationContext.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
      val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
      promise.resolve(capabilities?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) == true)
    } catch (error: Exception) { promise.resolve(false) }
  }

  override fun invalidate() {
    worker.shutdownNow()
    super.invalidate()
  }

  private fun json(addresses: List<Address>): String = JSONArray().apply {
    addresses.forEach { address ->
      put(JSONObject()
        .put("line", address.getAddressLine(0) ?: JSONObject.NULL)
        .put("feature", address.featureName ?: JSONObject.NULL)
        .put("street", address.thoroughfare ?: JSONObject.NULL)
        .put("number", address.subThoroughfare ?: JSONObject.NULL)
        .put("district", address.subAdminArea ?: address.locality ?: JSONObject.NULL)
        .put("latitude", if (address.hasLatitude()) address.latitude else JSONObject.NULL)
        .put("longitude", if (address.hasLongitude()) address.longitude else JSONObject.NULL))
    }
  }.toString()

  @ReactMethod
  fun reverseGeocode(latitude: Double, longitude: Double, promise: Promise) {
    if (!latitude.isFinite() || !longitude.isFinite() || latitude !in -90.0..90.0 || longitude !in -180.0..180.0) {
      promise.resolve("[]"); return
    }
    // A single worker also serializes requests whose JS caller has timed out.
    worker.execute {
      try {
        if (!Geocoder.isPresent()) { promise.resolve("[]"); return@execute }
        val geocoder = Geocoder(reactApplicationContext, Locale.TRADITIONAL_CHINESE)
        if (Build.VERSION.SDK_INT >= 33) {
          val finished = java.util.concurrent.CountDownLatch(1)
          val settled = java.util.concurrent.atomic.AtomicBoolean(false)
          geocoder.getFromLocation(latitude, longitude, 3, object : Geocoder.GeocodeListener {
            override fun onGeocode(addresses: MutableList<Address>) {
              try { if (settled.compareAndSet(false, true)) promise.resolve(json(addresses)) }
              finally { finished.countDown() }
            }
            override fun onError(message: String?) {
              if (settled.compareAndSet(false, true)) promise.resolve("[]")
              finished.countDown()
            }
          })
          if (!finished.await(15, java.util.concurrent.TimeUnit.SECONDS) && settled.compareAndSet(false, true)) promise.resolve("[]")
        } else {
          @Suppress("DEPRECATION")
          promise.resolve(json(geocoder.getFromLocation(latitude, longitude, 3) ?: emptyList()))
        }
      } catch (error: Exception) {
        promise.resolve("[]")
      }
    }
  }
}

class PlaceLookupPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PlaceLookupModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
