package com.dogtracker

/** No app log payloads or throwable details are emitted in release. */
object AppLog {
  fun i(tag: String, message: String) { if (BuildConfig.DEBUG) android.util.Log.i(tag, message) }
  fun w(tag: String, message: String, error: Throwable? = null) { if (BuildConfig.DEBUG) android.util.Log.w(tag, message, error) }
  fun e(tag: String, message: String, error: Throwable? = null) { if (BuildConfig.DEBUG) android.util.Log.e(tag, message, error) }
}
