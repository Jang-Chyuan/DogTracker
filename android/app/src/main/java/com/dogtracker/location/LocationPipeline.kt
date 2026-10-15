package com.dogtracker.location

import kotlin.math.*

internal data class LocationSample(
  val latitude: Double, val longitude: Double, val accuracy: Float,
  val elapsedNanos: Long, val timestamp: Long, val speed: Float? = null,
  val bearing: Float? = null, val altitude: Double? = null,
  val rawLatitude: Double = latitude, val rawLongitude: Double = longitude,
  val speedAccuracy: Float? = null, val rawSpeed: Float? = speed,
  val motionState: String = "moving",
  // Where the fix came from (LocationSource.label; 067).
  val provider: String? = null,
  // This recording's running distance up to the fix (LocationPipeline.odometerMeters).
  val odometer: Double? = null
)

/** Acquisition, display and persistence have separate clocks. Never replay old fixes. */
internal class LocationPipeline {
  companion object {
    /**
     * Oldest fix (by its own elapsedRealtimeNanos) that is accepted and saved.
     * It was 3 s when only the GPS provider was used, once a second, and every
     * fix arrived fresh. With fused location and the phone still, Samsung stops
     * GPS and the Wi-Fi fixes come seconds to minutes apart, about 4.5–5 s old
     * on arrival (PR 116 diagnostics, one night: 1004 dropped as stale, the
     * oldest 5.1 s; stretches of 80–133 min saved nothing). Older, cached fixes are still dropped; one
     * older than the last accepted fix is a duplicate. Rows carry the fix's own
     * time ([fixWallTime]), not the time they were written.
     */
    const val MAX_FIX_AGE_NANOS = 15_000_000_000L
    /** The fix's time on the system clock: wall time now, less the fix's monotonic age. */
    fun fixWallTime(sample: LocationSample, nowNanos: Long, wallMs: Long): Long =
      wallMs - (nowNanos - sample.elapsedNanos) / 1_000_000L
    /**
     * A fix the location service hands a new recording (its cached last fix)
     * that is not newer than the newest row already saved: `lastLocationAt` is
     * that row's location_at. Only a recent repeat counts, so a clock that was
     * set back does not stop recording.
     */
    fun repeatsSavedRow(sample: LocationSample, lastLocationAt: Long?): Boolean =
      lastLocationAt != null && sample.timestamp <= lastLocationAt &&
        lastLocationAt - sample.timestamp <= MAX_FIX_AGE_NANOS / 1_000_000L
    /**
     * A fix rejected only for its accuracy, finer than this, still goes to the
     * motion detector while it holds a confirmed stop ([holdStop]); it is
     * never saved. With the phone still, Samsung stops GPS and the fused fixes
     * are Wi-Fi ones of about 30–50 m: without them the detector saw nothing
     * for minutes, reset after 30 s and the locked dot jumped at the next
     * GPS fix. 50 m is where MotionDetector stops taking a fix as evidence
     * (`valid`, PhoneMotion.js the same): a coarser fix would only keep its
     * clock running and, sitting in the tail, switch off every geometric
     * departure window it falls into.
     */
    const val MOTION_ONLY_MAX_ACCURACY = 50f
    /**
     * The odometer (2026-10-13, user): the distance between two accepted fixes
     * in a row — about a second apart while walking, where the saved rows are
     * 5 s apart and their chords cut every curve — is added only when both
     * are in the moving state, both are finer than this (history's
     * coarseConfirmedAccuracyM) and the newer one measures at least
     * [ODOMETER_MIN_SPEED_MPS] (history's stillMps), at most
     * [ODOMETER_MAX_STEP_SECONDS] apart. History still decides what counts
     * (src/history countEdge); the odometer only measures how far.
     */
    const val ODOMETER_MAX_ACCURACY = 20f
    const val ODOMETER_MIN_SPEED_MPS = 0.3f
    const val ODOMETER_MAX_STEP_SECONDS = 10.0
  }
  /** This recording's running distance (m) over its accepted fixes (see ODOMETER_MAX_ACCURACY). */
  var odometerMeters = 0.0; private set
  var latest: LocationSample? = null; private set
  var received = 0; private set
  var accepted = 0; private set
  var rejected = 0; private set
  /** Accuracy rejections that still went to the motion detector (never saved; also counted in rejectedBy). */
  var motionOnly = 0; private set
  /** Rejections by cause (stale, duplicate, invalid, accuracy, jump) for diagnostics. */
  val rejectedBy = linkedMapOf("stale" to 0, "duplicate" to 0, "invalid" to 0, "accuracy" to 0, "jump" to 0)
  /** Since [markWindow]: the oldest stale fix (s) and best rejected accuracy (m). */
  var windowMaxStaleSeconds: Double? = null; private set
  var windowBestRejectedAccuracy: Float? = null; private set
  fun markWindow() { windowMaxStaleSeconds = null; windowBestRejectedAccuracy = null }
  var reason = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1117); private set
  private var lastSavedSample = 0L
  private var lastWrite = 0L
  private var newest = 0L
  private val window = java.util.ArrayDeque<LocationSample>()
  private val motion = MotionDetector()
  private var stationaryCoordinate: Pair<Double, Double>? = null
  // Fixes accepted since the last reset (none yet, or a break over 30 s), and
  // the newest fix rejected as a jump since the last accepted one.
  private var acceptedSinceReset = 0
  private var jumpRejected: LocationSample? = null
  // The newest fix the motion detector has seen (saved or motion-only) and its answer.
  private var motionSample: LocationSample? = null
  private var motionState = "moving"
  val intervalSeconds: Int get() {
    val speed = latest?.rawSpeed?.takeIf { it.isFinite() && it >= 0 } ?: return 5
    return when {
      isFastLocation(speed) -> 1
      speed > 10f / 3.6f -> 3
      else -> 5
    }
  }
  fun accept(sample: LocationSample, now: Long): Boolean {
    received++
    fun reject(cause: String, message: () -> String): Boolean {
      rejected++; rejectedBy[cause] = (rejectedBy[cause] ?: 0) + 1; reason = message(); return false
    }
    if (sample.elapsedNanos <= 0 || sample.elapsedNanos > now || now - sample.elapsedNanos > MAX_FIX_AGE_NANOS) {
      if (sample.elapsedNanos in 1..now) windowMaxStaleSeconds =
        maxOf(windowMaxStaleSeconds ?: 0.0, (now - sample.elapsedNanos) / 1e9)
      return reject("stale") { com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1118) }
    }
    if (sample.elapsedNanos <= newest) return reject("duplicate") { com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1119) }
    if (!sample.latitude.isFinite() || !sample.longitude.isFinite() || abs(sample.latitude) > 90 || abs(sample.longitude) > 180)
      return reject("invalid") { com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1120) }
    if (!acceptsLocationAccuracy(true, sample.accuracy, sample.rawSpeed)) {
      if (sample.accuracy.isFinite() && sample.accuracy >= 0f) windowBestRejectedAccuracy =
        minOf(windowBestRejectedAccuracy ?: Float.MAX_VALUE, sample.accuracy)
      holdStop(sample)
      return reject("accuracy") { if (isFastLocation(sample.rawSpeed)) com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1121) else com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1122) }
    }
    val previous = latest
    val dt = if (previous == null) 0.0 else (sample.elapsedNanos - previous.elapsedNanos) / 1e9
    var reset = previous == null || dt > 30
    if (!reset) {
      val distance = distanceMeters(previous!!.rawLatitude, previous.rawLongitude, sample.latitude, sample.longitude)
      if (distance > 70 * dt + previous.accuracy + sample.accuracy) {
        // #200 (audit A): the first fix after a reset (a stale cached
        // position, a Wi-Fi fix kilometres off) was wrong. Every right fix
        // after it was a jump from it until the 30 s reset, about
        // distance / 70 s. Two jump-rejected fixes in a row that agree with
        // each other outvote one accepted fix: start again from them.
        val other = jumpRejected
        val agrees = acceptedSinceReset == 1 && other != null && other.elapsedNanos < sample.elapsedNanos &&
          (sample.elapsedNanos - other.elapsedNanos) / 1e9 <= 30 &&
          distanceMeters(other.latitude, other.longitude, sample.latitude, sample.longitude) <=
            70 * (sample.elapsedNanos - other.elapsedNanos) / 1e9 + other.accuracy + sample.accuracy
        if (!agrees) {
          jumpRejected = sample
          return reject("jump") { com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1123) }
        }
        reset = true
      }
    }
    if (reset) acceptedSinceReset = 0
    jumpRejected = null
    // Three valid raw samples; a signal gap starts a new smoothing window.
    if (reset || dt > 3) {
      window.clear()
      // MotionDetector owns the lock lifetime; smoothing gaps alone cannot release it.
    }
    window.addLast(sample)
    while (window.size > 3) window.removeFirst()
    val points = window.toList()
    val fast = sample.speed != null && sample.speed * 3.6 > 10
    val weights = if (fast && points.size > 1)
      points.indices.map { if (it == points.lastIndex) 0.9 else 0.1 / (points.size - 1) }
      else points.map { 1.0 / points.size }
    val latitude = points.indices.sumOf { points[it].latitude * weights[it] }
    val offset = points.indices.sumOf { (((points[it].longitude - sample.longitude + 540) % 360) - 180) * weights[it] }
    // A motion-only fix newer than this one was already judged (separate
    // providers can deliver out of order): keep its answer, as the detector
    // would reset on time going backwards.
    val state = if (sample.elapsedNanos > (motionSample?.elapsedNanos ?: 0L)) judge(sample) else motionState
    val longitude = ((sample.longitude + offset + 540) % 360) - 180
    // Lock the smoothed position at confirmation, while continuing to judge raw fixes.
    if (state == "stationary") {
      if (stationaryCoordinate == null) stationaryCoordinate = latitude to longitude
    } else stationaryCoordinate = null
    val shownLatitude = stationaryCoordinate?.first ?: latitude
    val shownLongitude = stationaryCoordinate?.second ?: longitude
    if (previous != null && !reset && dt > 0 && dt <= ODOMETER_MAX_STEP_SECONDS && state == "moving" &&
      previous.motionState == "moving" && sample.accuracy <= ODOMETER_MAX_ACCURACY &&
      previous.accuracy <= ODOMETER_MAX_ACCURACY &&
      (sample.rawSpeed?.takeIf { it.isFinite() } ?: 0f) >= ODOMETER_MIN_SPEED_MPS)
      odometerMeters += distanceMeters(previous.latitude, previous.longitude, shownLatitude, shownLongitude)
    latest = sample.copy(latitude = shownLatitude, longitude = shownLongitude,
      speed = if (state == "stationary") 0f else sample.speed, motionState = state, odometer = odometerMeters)
    newest = sample.elapsedNanos
    acceptedSinceReset++
    accepted++; reason = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1124)
    return true
  }
  private fun judge(sample: LocationSample): String {
    motionSample = sample
    return motion.accept(sample).also { motionState = it }
  }
  /**
   * A fresh, valid fix that failed only the accuracy gate. While the detector
   * holds a confirmed stop it still sees the fix (PR 140: a coarse still fix
   * near the anchor keeps the stop; real speed or geometry still ends it), so
   * a coarse-only stretch neither resets the detector nor releases the lock.
   * Before a stop is confirmed it sees nothing new: a coarse fix cannot
   * confirm one, and would only clear the evidence being gathered. Neither
   * [latest] nor the write slot changes, so nothing here is ever saved.
   */
  private fun holdStop(sample: LocationSample) {
    if (motionState != "stationary" || !(sample.accuracy >= 0f && sample.accuracy < MOTION_ONLY_MAX_ACCURACY)) return
    val previous = motionSample
    if (previous != null) {
      if (sample.elapsedNanos <= previous.elapsedNanos) return
      // The same jump test a saved fix passes, against the last fix judged.
      val dt = (sample.elapsedNanos - previous.elapsedNanos) / 1e9
      if (dt <= 30 && distanceMeters(previous.rawLatitude, previous.rawLongitude, sample.latitude, sample.longitude) >
        70 * dt + previous.accuracy + sample.accuracy) return
    }
    motionOnly++
    if (judge(sample) != "stationary") stationaryCoordinate = null
  }
  fun candidate(now: Long): LocationSample? {
    val value = latest ?: return null
    if (now - value.elapsedNanos > MAX_FIX_AGE_NANOS || value.elapsedNanos <= lastSavedSample) return null
    if (lastWrite > 0 && now - lastWrite < intervalSeconds * 1_000_000_000L) return null
    return value
  }
  fun written(sample: LocationSample, now: Long) { lastSavedSample = sample.elapsedNanos; lastWrite = now }
  /** Not saved (it repeats a saved row); does not use the write slot. */
  fun skipped(sample: LocationSample) { lastSavedSample = maxOf(lastSavedSample, sample.elapsedNanos) }
  private fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val dlat = Math.toRadians(lat2 - lat1); val dlon = Math.toRadians(lon2 - lon1)
    val a = sin(dlat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dlon / 2).pow(2)
    return 6371000 * 2 * asin(sqrt(a.coerceIn(0.0, 1.0)))
  }
}
