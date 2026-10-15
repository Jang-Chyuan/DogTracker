package com.dogtracker

import java.io.ByteArrayOutputStream

/**
 * Preserve UTF-8 bytes across BLE notifications and split complete JSON objects.
 *
 * A notification cut short (one longer than the link's MTU allows, or a lost
 * fragment) leaves an object open that never closes: every later packet would
 * only nest inside it until [MAX_FRAME]. So an open frame is dropped
 * ([resyncs]) when a notification starts a new top-level object and either
 * is itself one or more complete objects, or comes [STALE_MS] or more after
 * the frame's last bytes (a fragmented packet's notifications arrive
 * together; the next packet does not). Receiver packets are flat objects, so
 * a notification that starts with `{` inside an open packet is a new packet.
 */
class BleJsonFramer {
  companion object {
    const val STALE_MS = 500L
    const val MAX_FRAME = 65536
  }
  private val frame = ByteArrayOutputStream()
  private var depth = 0
  private var quoted = false
  private var escaped = false
  private var lastAt: Long? = null
  /** Open frames dropped for a new packet (see the class comment). */
  var resyncs = 0; private set
  /** The longest complete frame so far, in bytes. */
  var largest = 0; private set

  fun reset() {
    frame.reset()
    depth = 0
    quoted = false
    escaped = false
  }

  /** `atMs`: the notification's arrival on a monotonic clock, or null to skip the stale test. */
  fun accept(bytes: ByteArray, atMs: Long? = null): List<String> {
    if (depth > 0 && startsObject(bytes)) {
      val previous = lastAt
      val stale = atMs != null && previous != null && atMs - previous >= STALE_MS
      if (stale || completeObjects(bytes)) { reset(); resyncs++ }
    }
    lastAt = atMs
    val complete = mutableListOf<String>()
    for (byte in bytes) {
      val c = byte.toInt() and 0xff
      if (depth == 0) {
        if (c != 123) continue
        reset()
      }
      frame.write(c)
      if (quoted) {
        if (escaped) escaped = false
        else if (c == 92) escaped = true
        else if (c == 34) quoted = false
      } else {
        if (c == 34) quoted = true
        else if (c == 123) depth++
        else if (c == 125) depth--
      }
      if (frame.size() > MAX_FRAME) {
        reset()
        throw IllegalArgumentException(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1050))
      }
      if (depth == 0) {
        largest = maxOf(largest, frame.size())
        complete.add(frame.toString("UTF-8"))
        reset()
      }
    }
    return complete
  }

  private fun padding(c: Int) = c == 0 || c == 32 || c == 9 || c == 10 || c == 13

  private fun startsObject(bytes: ByteArray): Boolean {
    val first = bytes.firstOrNull { !padding(it.toInt() and 0xff) } ?: return false
    return (first.toInt() and 0xff) == 123
  }

  /** The notification on its own is one or more whole objects (only padding around them). */
  private fun completeObjects(bytes: ByteArray): Boolean {
    var level = 0
    var inString = false
    var escape = false
    var closed = false
    for (byte in bytes) {
      val c = byte.toInt() and 0xff
      if (level == 0 && !inString) {
        if (padding(c)) continue
        if (c != 123) return false
      }
      if (inString) {
        if (escape) escape = false
        else if (c == 92) escape = true
        else if (c == 34) inString = false
      } else if (c == 34) inString = true
      else if (c == 123) level++
      else if (c == 125) { level--; if (level == 0) closed = true }
    }
    return closed && level == 0 && !inString
  }
}
