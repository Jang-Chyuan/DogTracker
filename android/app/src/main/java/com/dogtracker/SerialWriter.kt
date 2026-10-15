package com.dogtracker

import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Runs writes in order on one background thread, so the thread that asks
 * (the phone location looper) does not wait for the database lock: while a
 * cloud download held it, the looper used to sit in a save and the fixes
 * queued behind it went stale and were thrown away (稽核 A F3).
 *
 * [submit] waits only when [capacity] writes are already waiting. A write
 * that throws is tried [attempts] times; after that it is dropped and the
 * error is handed out once by [takeFailure], for the caller to count.
 */
class SerialWriter(name: String, capacity: Int, private val attempts: Int = 3,
  private val retryDelayMs: Long = 1_000, private val sleep: (Long) -> Unit = { Thread.sleep(it) }) {
  private val queue = LinkedBlockingQueue<() -> Unit>(capacity)
  private val failure = AtomicReference<Exception?>(null)
  @Volatile var dropped = 0L
    private set

  init {
    Thread({ run() }, name).apply { isDaemon = true; start() }
  }

  private fun run() {
    while (true) {
      val write = try { queue.take() } catch (_: InterruptedException) { return }
      for (attempt in 1..attempts) {
        try { write(); break } catch (error: Exception) {
          if (attempt < attempts) runCatching { sleep(retryDelayMs) }
          else { failure.set(error); dropped++ }
        }
      }
    }
  }

  fun submit(write: () -> Unit) = queue.put(write)

  /** Writes submitted and not run yet. */
  val waiting: Int get() = queue.size

  /** The last write that was dropped, once. */
  fun takeFailure(): Exception? = failure.getAndSet(null)

  /** Waits until every write submitted before this call has run; false after [timeoutMs]. */
  fun drain(timeoutMs: Long): Boolean {
    val done = CountDownLatch(1)
    if (!queue.offer({ done.countDown() }, timeoutMs, TimeUnit.MILLISECONDS)) return false
    return done.await(timeoutMs, TimeUnit.MILLISECONDS)
  }
}
