package com.dogtracker.location

import org.junit.Assert.assertEquals
import org.junit.Test

class LocationSourceTest {
  private val all = setOf("gps", "network", "fused", "passive")

  @Test fun playServicesFirst() {
    assertEquals(LocationSource.Choice.PlayFused, LocationSource.choose(true, 34, true, all))
    assertEquals(LocationSource.Choice.PlayFused, LocationSource.choose(true, 26, true, setOf("gps")))
  }

  @Test fun withoutPlayServicesAndroid12UsesTheSystemFusedProvider() {
    assertEquals(LocationSource.Choice.FrameworkFused, LocationSource.choose(false, 31, true, all))
    // Before Android 12 there is no system fused provider to rely on.
    assertEquals(LocationSource.Choice.Framework(listOf("gps", "network")), LocationSource.choose(false, 30, true, all))
  }

  @Test fun theOldProvidersThatAreOn() {
    assertEquals(LocationSource.Choice.Framework(listOf("network")), LocationSource.choose(false, 28, true, setOf("network")))
    assertEquals(LocationSource.Choice.Framework(listOf("gps")), LocationSource.choose(false, 33, true, setOf("gps")))
    assertEquals(LocationSource.Choice.None, LocationSource.choose(false, 28, true, setOf("passive")))
  }

  @Test fun locationOffIsNothing() {
    assertEquals(LocationSource.Choice.None, LocationSource.choose(true, 34, false, all))
  }

  @Test fun theStoredLabel() {
    assertEquals("play-fused", LocationSource.label(LocationSource.Choice.PlayFused, "fused"))
    assertEquals("fused", LocationSource.label(LocationSource.Choice.FrameworkFused, "fused"))
    assertEquals("network", LocationSource.label(LocationSource.Choice.Framework(listOf("gps", "network")), "network"))
  }
}
