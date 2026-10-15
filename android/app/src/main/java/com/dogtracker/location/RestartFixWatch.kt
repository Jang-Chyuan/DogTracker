package com.dogtracker.location

/**
 * Whether a recording the system restarted (START_STICKY after the process
 * ended) is getting fixes. On Android 11+ a location foreground service
 * started while the app is in the background gets no location without
 * ACCESS_BACKGROUND_LOCATION, which the app does not ask for: such a restart
 * may run with nothing coming in until the app is opened. Diagnostics only
 * (dumpsys, the live snapshot); it asks for nothing. Pure: no Android.
 */
internal class RestartFixWatch(
  val restart: Boolean,
  val backgroundLocation: Boolean,
  val sdk: Int,
  private val startedNanos: Long,
) {
  companion object {
    /** How long a restart may go without a fix before it counts as getting none. */
    const val WAIT_NANOS = 60_000_000_000L
    /** Android 11 (R): no location for a while-in-use service started in the background. */
    const val WHILE_IN_USE_SDK = 30
  }

  enum class State(val label: String) {
    /** An ordinary start (from the app on screen). */
    NOT_RESTART("not a restart"),
    WAITING("restarted, waiting for the first fix"),
    NO_FIXES("restarted, no fixes"),
    RECEIVING("restarted, receiving"),
  }

  /** The likely reason a restart gets nothing: background location is missing. */
  val whileInUseOnly get() = restart && !backgroundLocation && sdk >= WHILE_IN_USE_SDK

  var firstFixNanos: Long? = null; private set
  private var noFixesNoted = false
  private var firstFixNoted = false

  fun received(nowNanos: Long) { if (firstFixNanos == null) firstFixNanos = nowNanos }

  fun state(nowNanos: Long): State = when {
    !restart -> State.NOT_RESTART
    firstFixNanos != null -> State.RECEIVING
    nowNanos - startedNanos >= WAIT_NANOS -> State.NO_FIXES
    else -> State.WAITING
  }

  /** Once per restart, when it first counts as getting no fixes: the line to keep. */
  fun noFixesNote(nowNanos: Long): String? {
    if (noFixesNoted || state(nowNanos) != State.NO_FIXES) return null
    noFixesNoted = true
    return "restart got no fixes in ${WAIT_NANOS / 1_000_000_000L} s" +
      if (whileInUseOnly) " (no background location: none until the app is opened)" else ""
  }

  /** Once the first fix comes after [noFixesNote]: how long the restart went without. */
  fun firstFixNote(): String? {
    val first = firstFixNanos ?: return null
    if (!noFixesNoted || firstFixNoted) return null
    firstFixNoted = true
    return "restart got its first fix after ${(first - startedNanos) / 1_000_000_000L} s"
  }

  fun describe(nowNanos: Long): String {
    val state = state(nowNanos)
    if (state == State.NOT_RESTART) return "restart: no (started from the app)"
    val since = (nowNanos - startedNanos) / 1_000_000_000L
    return "restart: ${state.label} ${since}s since restart, backgroundLocation=$backgroundLocation sdk=$sdk" +
      (firstFixNanos?.let { " firstFixAfter=${(it - startedNanos) / 1_000_000_000L}s" } ?: "") +
      (if (state == State.NO_FIXES && whileInUseOnly) " (none until the app is opened)" else "")
  }
}
