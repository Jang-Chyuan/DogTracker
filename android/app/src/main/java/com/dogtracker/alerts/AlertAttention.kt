package com.dogtracker.alerts

/** System permissions and channel settings have precedence over S6 attention. */
object AlertAttention {
  fun vibration(allowed: Boolean, silent: Boolean, channelVibrates: Boolean) = allowed && !silent && channelVibrates
  fun sound(allowed: Boolean, normalRinger: Boolean, channelHasSound: Boolean) = allowed && normalRinger && channelHasSound
}
