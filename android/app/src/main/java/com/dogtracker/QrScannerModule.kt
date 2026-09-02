package com.dogtracker

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

class QrScannerModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName(): String = "QrScanner"

  @ReactMethod
  fun scan(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "QR Scanner 無法取得目前畫面")
      return
    }

    val options = GmsBarcodeScannerOptions.Builder()
      .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
      .enableAutoZoom()
      .build()

    GmsBarcodeScanning.getClient(activity, options)
      .startScan()
      .addOnSuccessListener { barcode ->
        val value = barcode.rawValue
        if (value.isNullOrBlank()) {
          promise.reject("EMPTY_QR", "QR Code 沒有內容")
        } else {
          promise.resolve(value)
        }
      }
      .addOnCanceledListener {
        promise.reject("SCAN_CANCELED", "已取消 QR 掃描")
      }
      .addOnFailureListener { error ->
        promise.reject("SCAN_FAILED", error.message, error)
      }
  }
}
