package com.dogtracker

import android.database.sqlite.SQLiteDatabase

/**
 * The journal and sync modes, set rather than left to the device. These are
 * the modes the app has always run with: Android's defaults for a database
 * opened with openOrCreateDatabase (journal_mode=TRUNCATE, synchronous=FULL;
 * `dumpsys dbinfo com.dogtracker` on an API 34 emulator), so a device whose
 * build changes the defaults no longer changes how the file is written.
 *
 * Used for dogtracker-latest.sqlite (CloudLatestStore). dogtracker.sqlite's
 * mode belongs to DogStatusStore's own open, which the lock-contention work
 * (audit A F3) switches to WAL: do not call this on that file, it would turn
 * WAL back off.
 */
internal object SqliteModes {
  const val JOURNAL_MODE = "TRUNCATE"
  const val SYNCHRONOUS = "FULL"

  fun rollbackJournal(db: SQLiteDatabase) {
    db.rawQuery("PRAGMA journal_mode=$JOURNAL_MODE", null).use { it.moveToFirst() }
    db.execSQL("PRAGMA synchronous=$SYNCHRONOUS")
  }
}
