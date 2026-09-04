package com.dogtracker

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class QrScannerModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  companion object {
    private const val REQUEST_SCAN = 3104
  }

  private var pendingPromise: Promise? = null

  private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_SCAN) return
      val promise = pendingPromise ?: return
      pendingPromise = null
      when (resultCode) {
        Activity.RESULT_OK -> {
          val value = data?.getStringExtra(QrScannerActivity.EXTRA_RESULT)
          if (value.isNullOrBlank()) promise.reject("EMPTY_QR", "QR Code 沒有內容")
          else promise.resolve(value)
        }
        QrScannerActivity.RESULT_PERMISSION_DENIED ->
          promise.reject("CAMERA_PERMISSION_DENIED", "需要相機權限才能掃描 QR Code")
        else -> promise.reject("SCAN_CANCELED", "已取消 QR 掃描")
      }
    }
  }

  init {
    context.addActivityEventListener(activityListener)
  }

  override fun getName(): String = "QrScanner"

  @ReactMethod
  fun scan(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "QR Scanner 找不到目前畫面")
      return
    }
    if (pendingPromise != null) {
      promise.reject("SCAN_IN_PROGRESS", "QR Scanner 已在執行")
      return
    }
    pendingPromise = promise
    try {
      activity.startActivityForResult(Intent(activity, QrScannerActivity::class.java), REQUEST_SCAN)
    } catch (error: Exception) {
      pendingPromise = null
      promise.reject("SCAN_FAILED", error.message, error)
    }
  }

  override fun invalidate() {
    pendingPromise?.reject("SCAN_CANCELED", "QR Scanner 已關閉")
    pendingPromise = null
    context.removeActivityEventListener(activityListener)
    super.invalidate()
  }
}
