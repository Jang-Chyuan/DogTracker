package com.dogtracker.location

import org.junit.Assert.*
import org.junit.Test

class LocationAccuracyTest {
  @Test fun acceptsBoundaryAndBetterFixes() {
    assertTrue(acceptsLocationAccuracy(true, 5f))
    assertTrue(acceptsLocationAccuracy(true, 30f))
    assertTrue(acceptsLocationAccuracy(true, 2.5f))
  }
  @Test fun rejectsPoorMissingAndInvalidAccuracy() {
    for (meters in listOf(30.001f, 100f, -1f, Float.NaN, Float.POSITIVE_INFINITY))
      assertFalse(acceptsLocationAccuracy(true, meters))
    assertFalse(acceptsLocationAccuracy(false, 0f))
  }
}
