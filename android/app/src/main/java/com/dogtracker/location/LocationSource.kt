package com.dogtracker.location

/**
 * Where the phone recorder's fixes come from (067). Indoors the GPS provider
 * alone gave 3-satellite, 238 m fixes (dropped by the 50 m filter) while
 * Google Maps showed a good position: Play services' fused location uses GPS,
 * Wi-Fi, cell and sensors. Outdoors fused high accuracy uses GPS too, so the
 * battery cost is about the same there and lower indoors (the GPS chip no
 * longer searches in vain).
 * - Play services available: FusedLocationProviderClient, PRIORITY_HIGH_ACCURACY,
 *   1 s interval and 1 s minimum; on a confirmed stop PRIORITY_BALANCED_POWER_ACCURACY
 *   about every 30 s (StationaryPowerMode, 2026-10-21). The other sources
 *   below always ask for 1 s.
 * - Otherwise, Android 12+ (API 31): LocationManager's own "fused" provider.
 * - Otherwise: the GPS and network providers that are switched on.
 * Pure (JUnit); LocationTrackerService does the Android calls.
 */
object LocationSource {
  const val INTERVAL_MS = 1000L
  const val GPS = "gps"
  const val NETWORK = "network"
  const val FUSED = "fused"
  /** Appended to the stored label of a fix taken in low-power mode (a held row). */
  const val LOW_POWER_SUFFIX = "-low"

  /** A Play services request: com.google.android.gms.location.Priority value, interval and minimum (ms). */
  data class Request(val priority: Int, val intervalMs: Long, val minIntervalMs: Long)
  // Priority.PRIORITY_HIGH_ACCURACY / PRIORITY_BALANCED_POWER_ACCURACY (stable API values).
  const val PRIORITY_HIGH_ACCURACY = 100
  const val PRIORITY_BALANCED_POWER_ACCURACY = 102

  /**
   * HIGH: 1 s high accuracy. LOW: balanced power (Wi-Fi and cell, no GPS
   * search) every 30 s, no minimum distance: each fix at the stop is saved as
   * a held row, and a stay without rows longer than history's 16 h same-place
   * limit would read 「沒有資料」.
   */
  fun fusedRequest(lowPower: Boolean): Request =
    if (lowPower) Request(PRIORITY_BALANCED_POWER_ACCURACY, StationaryPowerMode.LOW_INTERVAL_MS, StationaryPowerMode.LOW_INTERVAL_MS)
    else Request(PRIORITY_HIGH_ACCURACY, INTERVAL_MS, INTERVAL_MS)

  sealed class Choice {
    object PlayFused : Choice()
    object FrameworkFused : Choice()
    data class Framework(val providers: List<String>) : Choice()
    /** Nothing can give a position (location switched off). */
    object None : Choice()
  }

  /**
   * `enabledProviders`: LocationManager providers that are switched on;
   * `locationOn`: the phone's location setting.
   */
  fun choose(playServices: Boolean, sdk: Int, locationOn: Boolean, enabledProviders: Set<String>): Choice {
    if (!locationOn) return Choice.None
    if (playServices) return Choice.PlayFused
    if (sdk >= 31 && FUSED in enabledProviders) return Choice.FrameworkFused
    val providers = listOf(GPS, NETWORK).filter { it in enabledProviders }
    return if (providers.isEmpty()) Choice.None else Choice.Framework(providers)
  }

  /** The name stored with each fix (myLocationTracker.provider). */
  fun label(choice: Choice, fixProvider: String?, lowPower: Boolean = false): String = when (choice) {
    Choice.PlayFused -> "play-fused"
    Choice.FrameworkFused -> FUSED
    else -> fixProvider ?: "unknown"
  } + if (lowPower) LOW_POWER_SUFFIX else ""
}
