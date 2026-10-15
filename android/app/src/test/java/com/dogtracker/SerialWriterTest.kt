package com.dogtracker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SerialWriterTest {
  @Test fun theCallerDoesNotWaitForASlowWrite() {
    val writer = SerialWriter("test-writer", capacity = 10)
    val lock = CountDownLatch(1) // the database lock, held by someone else
    val written = Collections.synchronizedList(mutableListOf<Int>())
    val started = System.nanoTime()
    writer.submit { lock.await(); written.add(1) }
    writer.submit { written.add(2) }
    writer.submit { written.add(3) }
    // Three rows handed over while the first one still waits for the lock.
    assertTrue((System.nanoTime() - started) / 1_000_000 < 500)
    assertTrue(written.isEmpty())
    lock.countDown()
    assertTrue(writer.drain(5_000))
    assertEquals(listOf(1, 2, 3), written.toList())
  }

  @Test fun aFullQueueMakesTheCallerWaitInsteadOfDropping() {
    val writer = SerialWriter("test-writer", capacity = 1)
    val lock = CountDownLatch(1)
    val written = Collections.synchronizedList(mutableListOf<Int>())
    writer.submit { lock.await(); written.add(1) }
    // The writer took the first; one more fits, the next waits for room.
    waitUntil { writer.waiting == 0 }
    writer.submit { written.add(2) }
    val third = Thread { writer.submit { written.add(3) } }.apply { start() }
    third.join(300)
    assertTrue(third.isAlive)
    lock.countDown()
    third.join(5_000)
    assertTrue(writer.drain(5_000))
    assertEquals(listOf(1, 2, 3), written.toList())
  }

  @Test fun aFailingWriteIsRetriedThenReportedOnce() {
    val sleeps = mutableListOf<Long>()
    val writer = SerialWriter("test-writer", capacity = 10, attempts = 3, retryDelayMs = 7, sleep = { sleeps.add(it) })
    val error = IllegalStateException("disk full")
    var tries = 0
    writer.submit { tries++; throw error }
    var after = false
    writer.submit { after = true }
    assertTrue(writer.drain(5_000))
    assertEquals(3, tries)
    assertEquals(listOf(7L, 7L), sleeps)
    assertTrue(after)
    assertEquals(1, writer.dropped)
    assertSame(error, writer.takeFailure())
    assertNull(writer.takeFailure())
  }

  @Test fun aWriteThatSucceedsOnRetryIsNotReported() {
    val writer = SerialWriter("test-writer", capacity = 10, attempts = 3, retryDelayMs = 0, sleep = {})
    var tries = 0
    writer.submit { if (++tries < 2) error("busy") }
    assertTrue(writer.drain(5_000))
    assertEquals(2, tries)
    assertEquals(0, writer.dropped)
    assertNull(writer.takeFailure())
  }

  @Test fun drainGivesUpAfterItsTimeout() {
    val writer = SerialWriter("test-writer", capacity = 10)
    val lock = CountDownLatch(1)
    writer.submit { lock.await(10, TimeUnit.SECONDS) }
    assertFalse(writer.drain(100))
    lock.countDown()
    assertTrue(writer.drain(5_000))
  }

  private fun waitUntil(condition: () -> Boolean) {
    val until = System.nanoTime() + 5_000_000_000L
    while (!condition() && System.nanoTime() < until) Thread.sleep(5)
    assertTrue(condition())
  }
}
