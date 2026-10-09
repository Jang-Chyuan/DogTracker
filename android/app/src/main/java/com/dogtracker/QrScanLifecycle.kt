package com.dogtracker

/**
 * The resources of one QR camera view (QrCameraViewManager.QrCameraView):
 * a scanner (ML Kit's, Closeable) made on attach and closed on detach, so a
 * view that leaves the window holds nothing; a view that comes back gets a
 * new one. `drop` (React dropped the view) is for good: no attach after it.
 *
 * Every attach and detach starts a new generation. A scan result is posted
 * to the UI thread with the generation it was read in, and `accepts` lets it
 * through only while that same attachment still stands — a result that
 * arrives after the page was left is never reported.
 */
class QrScanLifecycle<S : AutoCloseable>(private val newScanner: () -> S) {
  var scanner: S? = null
    private set
  var generation = 0
    private set
  var attached = false
    private set
  var dropped = false
    private set

  /** The scanner for this attachment, or null once dropped. */
  fun attach(): S? {
    if (dropped) return null
    if (attached) return scanner
    attached = true
    generation += 1
    return scanner ?: newScanner().also { scanner = it }
  }

  fun detach() {
    if (attached) generation += 1
    attached = false
    scanner?.let { runCatching { it.close() } }
    scanner = null
  }

  fun drop() {
    detach()
    dropped = true
  }

  fun accepts(at: Int) = attached && !dropped && at == generation
}
