package com.dogtracker.alerts

import org.junit.Assert.*
import org.junit.Test

class AlertAttentionTest {
  @Test fun systemChoicesAlwaysWin() {
    // S6 on, ringer on, channel 「預設」 without its own sound/vibration: the app's own.
    assertTrue(AlertAttention.vibration(true, false, true, false))
    assertTrue(AlertAttention.sound(true, true, true, false))
    // S6 off.
    assertFalse(AlertAttention.vibration(false, false, true, false))
    assertFalse(AlertAttention.sound(false, true, true, false))
    // Channel set to 靜音 / 最低 in system settings.
    assertFalse(AlertAttention.vibration(true, false, false, false))
    assertFalse(AlertAttention.sound(true, true, false, false))
    // Phone on silent / vibrate only.
    assertFalse(AlertAttention.vibration(true, true, true, false))
    assertFalse(AlertAttention.sound(true, false, true, false))
  }

  @Test fun aChannelSoundOrVibrationOfTheUsersOwnIsNotDoubled() {
    assertFalse(AlertAttention.vibration(true, false, true, true))
    assertFalse(AlertAttention.sound(true, true, true, true))
  }
}
