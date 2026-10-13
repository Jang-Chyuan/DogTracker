package com.dogtracker.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationResubscribeTest {
  private fun ms(value: Long) = value * 1_000_000L

  @Test fun silenceAfterStartAsksAgainWithDoublingWaits() {
    val policy = LocationResubscribe(ms(0))
    assertFalse(policy.due(ms(14_999)))
    assertTrue(policy.due(ms(15_000)))
    assertEquals(1, policy.resubscribed)
    // Then 30 s, 60 s, 120 s, and 120 s from then on.
    assertFalse(policy.due(ms(15_000 + 29_999)))
    assertTrue(policy.due(ms(45_000)))
    assertTrue(policy.due(ms(105_000)))
    assertTrue(policy.due(ms(225_000)))
    assertFalse(policy.due(ms(225_000 + 119_999)))
    assertTrue(policy.due(ms(345_000)))
  }

  @Test fun anyFixResetsTheSchedule() {
    val policy = LocationResubscribe(ms(0))
    assertTrue(policy.due(ms(15_000)))
    assertTrue(policy.due(ms(45_000)))
    policy.received(ms(50_000))
    assertEquals(0, policy.resubscribed)
    assertFalse(policy.due(ms(64_999)))
    assertTrue(policy.due(ms(65_000)))
  }

  @Test fun fixesArrivingKeepTheRequestAlone() {
    val policy = LocationResubscribe(ms(0))
    for (second in 1L..600L) {
      policy.received(ms(second * 1000))
      assertFalse(policy.due(ms(second * 1000 + 500)))
    }
  }
}
