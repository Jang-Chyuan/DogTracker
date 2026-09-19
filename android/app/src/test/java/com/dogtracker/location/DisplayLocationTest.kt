package com.dogtracker.location
import org.junit.Assert.*
import org.junit.Test

class DisplayLocationTest {
  @Test fun rejectsStaleFutureAndPreviousSessionDisplayCoordinates() {
    val sample = LocationSample(25.0, 121.0, 3f, 10_000_000_000L, 10000)
    val display = DisplayLocation("a", 9000, 24.9, 120.9, 9_000_000_000L)
    assertTrue(display.usable("a", sample, 10_000_000_000L))
    assertFalse(display.usable("b", sample, 10_000_000_000L))
    assertFalse(display.usable("a", sample, 11_000_000_000L))
    assertFalse(display.copy(fixTime = 11000).usable("a", sample, 10_000_000_000L))
    assertFalse(display.copy(fixTime = 6000).usable("a", sample, 10_000_000_000L))
  }
}
