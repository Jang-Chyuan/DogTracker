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
 * A value that is settled at most once (the share sheet's Promise): `claim`
 * only when none is pending; `take` hands it to exactly one caller — the
 * chooser's broadcast, the activity result, or the module's invalidation.
 */
class SettleOnce<T : Any> {
  private var pending: T? = null

  @Synchronized fun claim(value: T): Boolean {
    if (pending != null) return false
    pending = value
    return true
  }

  @Synchronized fun take(): T? = pending.also { pending = null }

  @Synchronized fun isPending() = pending != null
}

/** Runs `block` with `resource` and always releases it (a page's bitmap). */
inline fun <T, R> T.releasing(release: (T) -> Unit, block: (T) -> R): R =
  try { block(this) } finally { release(this) }
