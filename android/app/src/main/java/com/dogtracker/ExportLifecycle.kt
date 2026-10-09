package com.dogtracker

/**
 * The export jobs of HistoryExportModule: which ones run, which ones were
 * cancelled (取消, the back key, leaving the history), and whether the module
 * was invalidated (a reload), after which every job counts as cancelled.
 *
 * JS may cancel an export before its PNG pages are queued (while the font
 * widths are measured, or a GPX/CSV is written), so a cancel of an id that
 * is not running yet is remembered too — but only the last [remember] of
 * them, so ids that never start cannot pile up. `finish` forgets an id.
 */
class ExportJobs(private val remember: Int = 16) {
  private val running = HashSet<String>()
  private val cancelled = LinkedHashSet<String>()
  @Volatile var disposed = false
    private set

  /** False once the module is gone: the job must not start. */
  @Synchronized fun begin(id: String): Boolean {
    if (disposed) return false
    running.add(id)
    return true
  }

  @Synchronized fun cancel(id: String) {
    if (disposed) return
    cancelled.remove(id)
    cancelled.add(id)
    // Forget the oldest cancels of ids that are not running.
    val extra = cancelled.size - remember
    if (extra > 0) cancelled.filter { it !in running }.take(extra).forEach { cancelled.remove(it) }
  }

  @Synchronized fun isCancelled(id: String) = disposed || id in cancelled

  @Synchronized fun finish(id: String) {
    running.remove(id)
    cancelled.remove(id)
  }

  /** The module is invalidated: every running and later job is cancelled. */
  @Synchronized fun dispose() {
    disposed = true
    running.clear()
    cancelled.clear()
  }

  @Synchronized fun runningCount() = running.size
  @Synchronized fun cancelledCount() = cancelled.size
}

/**
 * The share sheet's sessions (HistoryExportModule.share). One session at a
 * time, each with its own request code, so a callback of an earlier chooser
 * can never settle a later share. Its Promise is settled exactly once: by the
 * chooser's broadcast ("shared"), by the activity result when nothing was
 * chosen ("cancelled"), by a failed launch, or by the module's invalidation.
 *
 * After "shared" the session stays until its activity result arrives (that
 * result must not settle the next share), but a new share may replace it, as
 * the activity result is not guaranteed (the activity may be gone).
 */
class ShareSessions<T : Any>(private val firstCode: Int = 7401, private val codes: Int = 64) {
  private class Session<T>(val code: Int, val value: T, var settled: Boolean = false)
  private var current: Session<T>? = null
  private var next = 0
  var disposed = false
    private set

  /** The request code of a new session, or null (one still open, or disposed). */
  @Synchronized fun open(value: T): Int? {
    if (disposed) return null
    if (current?.settled == false) return null
    val code = firstCode + next
    next = (next + 1) % codes
    current = Session(code, value)
    return code
  }

  fun owns(code: Int) = code >= firstCode && code < firstCode + codes

  /** The chooser's broadcast: the Promise to resolve "shared", once. */
  @Synchronized fun chosen(code: Int): T? {
    val session = current?.takeIf { it.code == code && !it.settled } ?: return null
    session.settled = true
    return session.value
  }

  /** The chooser closed (activity result): the Promise to resolve "cancelled" when not shared. */
  @Synchronized fun closed(code: Int): T? {
    val session = current?.takeIf { it.code == code } ?: return null
    current = null
    return session.value.takeIf { !session.settled }
  }

  /** The launch failed: the Promise to reject, unless settled already. */
  @Synchronized fun failed(code: Int): T? = closed(code)

  /** The module is gone: the open Promise to reject; no session opens again. */
  @Synchronized fun dispose(): T? {
    disposed = true
    val session = current
    current = null
    return session?.value?.takeIf { !session.settled }
  }
}

/** Runs `block` with `resource` and always releases it (a page's bitmap). */
inline fun <T, R> T.releasing(release: (T) -> Unit, block: (T) -> R): R =
  try { block(this) } finally { release(this) }
