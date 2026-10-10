package com.dogtracker

import java.io.IOException
import java.util.Locale

/** Pure reservation policy; MediaStore remains the final no-overwrite arbiter. */
object ExportDownloadNames {
  private fun safeName(requested: String): String {
    val clean = requested.map { c ->
      if (c.code < 32 || c.code == 127 || c in "<>:\"/\\|?*") '_' else c
    }.joinToString("").trimEnd(' ', '.').ifEmpty { "export" }
    return if (clean.startsWith('.')) "_$clean" else clean
  }

  private fun candidate(requested: String, number: Int): String {
    val name = safeName(requested)
    val dot = name.lastIndexOf('.')
    val extension = if (dot > 0) name.substring(dot) else ""
    var stem = if (dot > 0) name.substring(0, dot) else name
    val suffix = if (number == 0) "" else " ($number)"
    val budget = 255 - (suffix + extension).toByteArray(Charsets.UTF_8).size
    if (budget < 1) throw IOException("export extension is too long")
    while (stem.toByteArray(Charsets.UTF_8).size > budget)
      stem = stem.substring(0, stem.offsetByCodePoints(stem.length, -1))
    return stem + suffix + extension
  }

  fun available(requested: String, existing: Collection<String>): String {
    val used = existing.map { it.lowercase(Locale.ROOT) }.toHashSet()
    // There are at most used.size occupied candidates; a free one follows.
    for (number in 0..used.size) {
      val name = candidate(requested, number)
      if (name.lowercase(Locale.ROOT) !in used) return name
    }
    throw IOException("no available export name")
  }

  fun save(requested: String, existing: Collection<String>,
    reserve: (String) -> ExportDownloads.Saved,
    complete: (ExportDownloads.Saved) -> ExportDownloads.Saved,
    discard: (ExportDownloads.Saved) -> Unit,
    maxAttempts: Int = 32): ExportDownloads.Saved {
    require(maxAttempts > 0)
    val occupied = existing.toMutableSet()
    repeat(maxAttempts) {
      val name = available(requested, occupied)
      val reservation = reserve(name)
      if (reservation.name != name) {
        // Reject a renamed pending reservation before any copy/publication.
        discard(reservation)
        occupied.add(name)
        occupied.add(reservation.name)
        return@repeat
      }
      val saved = try {
        complete(reservation).also { check(it.uri == reservation.uri) { "export URI changed" } }
      } catch (error: Exception) {
        try { discard(reservation) } catch (cleanup: Exception) {
          cleanup.addSuppressed(error)
          throw cleanup
        }
        throw error
      }
      if (saved.name == name) return saved
      // A file hidden by scoped storage, or a concurrent writer, may defeat
      // the pre-query. Never accept a provider name with a broken extension,
      // and only remove this newly created URI, never a pre-existing file.
      discard(reservation)
      occupied.add(name)
      occupied.add(saved.name)
    }
    throw IOException("export filename collision retry limit reached")
  }
}
