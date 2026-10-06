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
    if (!Geocoder.isPresent()) { promise.resolve("[]"); return }
    val geocoder = Geocoder(reactApplicationContext, Locale.TRADITIONAL_CHINESE)
    if (Build.VERSION.SDK_INT >= 33) {
      geocoder.getFromLocation(latitude, longitude, 3, object : Geocoder.GeocodeListener {
        override fun onGeocode(addresses: MutableList<Address>) = promise.resolve(json(addresses))
        override fun onError(message: String?) = promise.reject("geocode", message ?: "geocode failed")
      })
    } else {
      Thread {
        try {
          @Suppress("DEPRECATION")
          promise.resolve(json(geocoder.getFromLocation(latitude, longitude, 3) ?: emptyList()))
        } catch (error: Exception) {
          promise.reject("geocode", error.message ?: "geocode failed")
        }
      }.start()
    }
  }
}

class PlaceLookupPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PlaceLookupModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
