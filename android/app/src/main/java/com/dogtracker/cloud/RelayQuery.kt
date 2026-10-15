package com.dogtracker.cloud

/**
 * The relay's database question, asked off the main thread (稽核 A F3: the
 * main looper used to read the queue itself, and a long database lock was an
 * ANR). [ask] and the answer both run on the caller's (main) thread; only
 * the query runs in [background]. Asking again while a query is out reruns
 * it once when it comes back, so a stale answer is never acted on.
 */
internal class RelayQuery<T>(
  private val background: (Runnable) -> Unit,
  private val foreground: (Runnable) -> Unit,
) {
  private var running = false
  private var again: Pair<() -> T, (Result<T>) -> Unit>? = null

  fun ask(query: () -> T, answer: (Result<T>) -> Unit) {
    if (running) { again = query to answer; return }
    running = true
    background(Runnable {
      val result = runCatching(query)
      foreground(Runnable {
        running = false
        val next = again
        again = null
        if (next != null) ask(next.first, next.second) else answer(result)
      })
    })
  }
}
