package com.dogtracker.location

/**
 * Where the phone recorder's fixes come from (067). Indoors the GPS provider
 * alone gave 3-satellite, 238 m fixes (dropped by the 50 m filter) while
 * Google Maps showed a good position: Play services' fused location uses GPS,
 * Wi-Fi, cell and sensors. Outdoors fused high accuracy uses GPS too, so the
 * battery cost is about the same there and lower indoors (the GPS chip no
 * longer searches in vain).
 * - Play services available: FusedLocationProviderClient, PRIORITY_HIGH_ACCURACY,
 *   1 s interval and 1 s minimum.
 * - Otherwise, Android 12+ (API 31): LocationManager's own "fused" provider.
 * - Otherwise: the GPS and network providers that are switched on.
 * Pure (JUnit); LocationTrackerService does the Android calls.
 */
object LocationSource {
  const val INTERVAL_MS = 1000L
  const val GPS = "gps"
  const val NETWORK = "network"
  const val FUSED = "fused"

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
  fun label(choice: Choice, fixProvider: String?): String = when (choice) {
    Choice.PlayFused -> "play-fused"
    Choice.FrameworkFused -> FUSED
    else -> fixProvider ?: "unknown"
  }
}
