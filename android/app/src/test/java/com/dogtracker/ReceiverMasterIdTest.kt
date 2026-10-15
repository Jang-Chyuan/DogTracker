package com.dogtracker

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ReceiverMasterIdTest {
  private fun check(json: String, expected: Int = 3) = ReceiverMasterId.check(JSONObject(json), expected)

  @Test fun onlyAnotherReceiversNumberIsAMismatch() {
    assertEquals(ReceiverMasterId.Check.Same, check("""{"mid":3}"""))
    assertEquals(ReceiverMasterId.Check.Same, check("""{"master_id":3,"mid":5}"""))
    assertEquals(ReceiverMasterId.Check.Other(5), check("""{"mid":5}"""))
    assertEquals(ReceiverMasterId.Check.Other(5), check("""{"mid":"5"}"""))
  }

  @Test fun aFrameWithoutAUsableNumberIsNotAMismatch() {
    for (json in listOf("""{"sid":1}""", """{"mid":null}""", """{"mid":0}""", """{"mid":3.5}""",
      """{"mid":"x"}""", """{"master_id":null}""", """{"mid":{}}""")) {
      assertEquals(json, ReceiverMasterId.Check.Missing, check(json))
    }
  }

  @Test fun anOlderPairingWithoutAQrNumberAcceptsAnyReceiver() {
    assertEquals(ReceiverMasterId.Check.Same, check("""{"mid":5}""", expected = 0))
    assertEquals(ReceiverMasterId.Check.Missing, check("""{"sid":1}""", expected = 0))
  }
}
