package com.dogtracker

/**
 * 「存到下載」 for the history export (067): the files go to the phone's
 * Download/DogTracker/ without a storage permission.
 * - Android 10 and up (API 29+): MediaStore.Downloads, RELATIVE_PATH
 *   Download/DogTracker; names are reserved with an extension-preserving
 *   suffix, then the system's final name is read back and checked.
 * - Android 7–9 (API 24–28): the system's "save as" (ACTION_CREATE_DOCUMENT),
 *   one file at a time, with the export's own name suggested.
 * Pure parts here (JUnit); HistoryExportModule does the Android calls.
 */
object ExportDownloads {
  const val FOLDER = "DogTracker"
  /** MediaStore's RELATIVE_PATH: under the shared Download folder. */
  const val RELATIVE_PATH = "Download/$FOLDER"

  enum class Mode { MEDIA_STORE, CREATE_DOCUMENT }

  fun mode(sdk: Int): Mode = if (sdk >= 29) Mode.MEDIA_STORE else Mode.CREATE_DOCUMENT

  /** A saved file: its final name and its content URI (as a string). */
  data class Saved(val name: String, val uri: String)
}

/**
 * The "save as" queue of Android 7–9: each file of one save goes through the
 * system picker in turn. One save at a time; its result is settled once —
 * every file saved, or cancelled at the first file the user backs out of
 * (files saved before stay saved and are reported), or failed.
 */
class CreateDocumentQueue<T>(private val files: List<T>) {
  private var index = 0
  private val saved = ArrayList<ExportDownloads.Saved>()
  var settled = false
    private set

  /** The file the picker is for now, or null when every one is done. */
  fun current(): T? = if (settled) null else files.getOrNull(index)

  /** The current file was saved as `saved`; returns the next one or null. */
  fun done(item: ExportDownloads.Saved): T? {
    check(!settled) { "settled" }
    saved.add(item)
    index += 1
    if (index >= files.size) settled = true
    return current()
  }

  /** The user backed out: the save ends with what was saved so far. */
  fun cancel(): List<ExportDownloads.Saved> { settled = true; return saved.toList() }

  fun result(): List<ExportDownloads.Saved> = saved.toList()
}
