package com.dogtracker

import org.junit.Assert.*
import org.junit.Test

class QrScanLifecycleTest {
  private class FakeScanner : AutoCloseable {
    var closed = 0
    override fun close() { closed += 1 }
  }

  private fun lifecycle(made: MutableList<FakeScanner>) = QrScanLifecycle { FakeScanner().also { made.add(it) } }

  @Test fun detachClosesTheScannerAndReattachMakesANewOne() {
    val made = mutableListOf<FakeScanner>()
    val qr = lifecycle(made)
    val first = qr.attach()!!
    assertSame(first, qr.attach()) // attached twice in a row: the same one
    qr.detach()
    assertEquals(1, first.closed)
    assertNull(qr.scanner)
    val second = qr.attach()!!
    assertNotSame(first, second)
    assertEquals(0, second.closed)
    assertEquals(2, made.size)
  }

  @Test fun dropClosesOnceAndNeverAttachesAgain() {
    val made = mutableListOf<FakeScanner>()
    val qr = lifecycle(made)
    val scanner = qr.attach()!!
    qr.drop()
    qr.drop()
    qr.detach()
    assertEquals(1, scanner.closed)
    assertNull(qr.attach())
    assertEquals(1, made.size)
  }

  @Test fun repeatedAttachDetachLeavesNothingOpen() {
    val made = mutableListOf<FakeScanner>()
    val qr = lifecycle(made)
    repeat(20) { qr.attach(); qr.detach() }
    assertEquals(20, made.size)
    assertTrue(made.all { it.closed == 1 })
  }

  @Test fun aLateResultIsDroppedAfterDetachReattachOrDrop() {
    val qr = lifecycle(mutableListOf())
    qr.attach()
    val read = qr.generation
    assertTrue(qr.accepts(read))
    qr.detach()
    assertFalse(qr.accepts(read)) // read before the page was left
    qr.attach()
    assertFalse(qr.accepts(read)) // read in the old attachment
    assertTrue(qr.accepts(qr.generation))
    val now = qr.generation
    qr.drop()
    assertFalse(qr.accepts(now))
  }

  @Test fun aScannerThatFailsToCloseStillLetsGo() {
    val qr = QrScanLifecycle { AutoCloseable { error("close failed") } }
    qr.attach()
    qr.detach()
    assertNull(qr.scanner)
    assertNotNull(qr.attach())
  }
}
