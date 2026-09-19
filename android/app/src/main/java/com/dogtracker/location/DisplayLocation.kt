package com.dogtracker.location

internal data class DisplayLocation(val session: String, val fixTime: Long, val latitude: Double,
  val longitude: Double, val receivedNanos: Long) {
  fun usable(sessionId: String, sample: LocationSample, now: Long): Boolean =
    session == sessionId && sample.timestamp >= fixTime && sample.timestamp - fixTime <= 3000 &&
      now >= receivedNanos && now - receivedNanos <= 1_500_000_000L
}
