package com.dogtracker

import org.junit.Assert.assertEquals
import org.junit.Test

class SplashStateTest {
  @Test fun handoverDelayIsTheAnimationCappedAtTwoSeconds() {
    assertEquals(300L, SplashState.handoverDelay(300.0))
    assertEquals(0L, SplashState.handoverDelay(-5.0))
    assertEquals(2000L, SplashState.handoverDelay(60_000.0))
    assertEquals(0L, SplashState.handoverDelay(Double.NaN))
  }
}
