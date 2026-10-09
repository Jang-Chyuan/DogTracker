package com.dogtracker.alerts

import org.junit.Assert.*
import org.junit.Test

class AlertAttentionTest {
  @Test fun systemChoicesAlwaysWin() {
    assertTrue(AlertAttention.vibration(true, false, true))
    assertTrue(AlertAttention.sound(true, true, true))
    assertFalse(AlertAttention.vibration(false, false, true))
    assertFalse(AlertAttention.sound(false, true, true))
    assertFalse(AlertAttention.vibration(true, false, false))
    assertFalse(AlertAttention.sound(true, true, false))
    assertFalse(AlertAttention.vibration(true, true, true))
    assertFalse(AlertAttention.sound(true, false, true))
  }
}
