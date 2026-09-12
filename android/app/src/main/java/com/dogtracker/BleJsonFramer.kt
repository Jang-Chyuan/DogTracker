package com.dogtracker

import java.io.ByteArrayOutputStream

/** Preserve UTF-8 bytes across BLE notifications and split complete JSON objects. */
class BleJsonFramer {
  private val frame = ByteArrayOutputStream()
  private var depth = 0
  private var quoted = false
  private var escaped = false

  fun reset() {
    frame.reset()
    depth = 0
    quoted = false
    escaped = false
  }

  fun accept(bytes: ByteArray): List<String> {
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
      if (frame.size() > 65536) {
        reset()
        throw IllegalArgumentException("BLE 資料封包過大")
      }
      if (depth == 0) {
        complete.add(frame.toString("UTF-8"))
        reset()
      }
    }
    return complete
  }
}
