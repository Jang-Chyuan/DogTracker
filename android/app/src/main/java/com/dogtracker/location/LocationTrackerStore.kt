package com.dogtracker.location

import android.content.Context
import com.dogtracker.DogStatusStore
import com.dogtracker.SerialWriter
import org.json.JSONArray
import org.json.JSONObject

class LocationTrackerStore(context: Context) {
  companion object {
    /**
     * The route's writes, in order, on their own thread (稽核 A F3): the
     * location looper hands a row over and goes back to its fixes, even
     * while a cloud download holds the database lock. One per process, so
     * rows keep their order when the recording service restarts. 600 rows is
     * ten minutes at one a second before [save] waits again.
     */
    private val writer by lazy { SerialWriter("PhoneLocationDb", capacity = 600) }
  }
  private val store = DogStatusStore.get(context)
  // The newest 80,000 rows as written (id), not by recorded_at: a row dated
  // ahead by a wall clock that was later set back would otherwise outlive
  // every newer row.
  private val trim = "DELETE FROM myLocationTracker WHERE id IN (SELECT id FROM myLocationTracker ORDER BY id DESC LIMIT -1 OFFSET 80000)"
  init {
    store.executeBatch(JSONArray().put(command("CREATE TABLE IF NOT EXISTS myLocationTracker (id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at INTEGER NOT NULL, location_at INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy_meters REAL, altitude_meters REAL, speed_kmh REAL, heading_degrees REAL)"))
      .put(command("CREATE INDEX IF NOT EXISTS idx_myLocationTracker_time ON myLocationTracker(recorded_at DESC, id DESC)"))
      .put(command(trim)))
    synchronized(store) {
      val columns = store.executeSql("PRAGMA table_info(myLocationTracker)", JSONArray()).getJSONArray("results")
      val names = (0 until columns.length()).map { columns.getJSONObject(it).getString("name") }.toSet()
      for ((name, type) in listOf("raw_latitude" to "REAL", "raw_longitude" to "REAL", "session_id" to "TEXT",
        "raw_speed_kmh" to "REAL", "speed_accuracy_mps" to "REAL", "motion_state" to "TEXT",
        "display_latitude" to "REAL", "display_longitude" to "REAL", "display_source" to "TEXT", "display_location_at" to "INTEGER",
        "provider" to "TEXT", "odometer_m" to "REAL"))
        if (name !in names) store.executeSql("ALTER TABLE myLocationTracker ADD COLUMN $name $type", JSONArray())
    }
  }
  private fun command(sql: String, values: JSONArray = JSONArray()) = JSONObject().put("query", sql).put("params", values)
  /**
   * recorded_at is the fix's own time on the system clock (LocationPipeline.fixWallTime), not the write time.
   * Queues the row and returns. A row the writer thread could not save is
   * reported here, on the next call (the service counts it as a write error
   * and saves the current fix on the following tick, as before).
   */
  internal fun save(location: LocationSample, session: String, display: DisplayLocation?, recordedAt: Long) {
    writer.takeFailure()?.let { throw it }
    val values = JSONArray().put(recordedAt).put(location.timestamp)
      .put(location.latitude).put(location.longitude)
      .put(location.accuracy).put(location.altitude ?: JSONObject.NULL)
      .put(location.speed?.times(3.6) ?: JSONObject.NULL).put(location.bearing ?: JSONObject.NULL)
    // Keep the existing insert shape; add raw provenance in the same transaction.
    val commands = JSONArray().put(command("INSERT INTO myLocationTracker (recorded_at,location_at,latitude,longitude,accuracy_meters,altitude_meters,speed_kmh,heading_degrees) VALUES (?,?,?,?,?,?,?,?)", values))
      .put(command("UPDATE myLocationTracker SET raw_latitude=?,raw_longitude=?,session_id=?,raw_speed_kmh=?,speed_accuracy_mps=?,motion_state=?,provider=?,odometer_m=? WHERE id=last_insert_rowid()",
        JSONArray().put(location.rawLatitude).put(location.rawLongitude).put(session)
          .put(location.rawSpeed?.times(3.6) ?: JSONObject.NULL).put(location.speedAccuracy ?: JSONObject.NULL).put(location.motionState)
          .put(location.provider ?: JSONObject.NULL).put(location.odometer ?: JSONObject.NULL)))
      .put(command("UPDATE myLocationTracker SET display_latitude=?,display_longitude=?,display_source=?,display_location_at=? WHERE id=last_insert_rowid()",
        JSONArray().put(display?.latitude ?: location.latitude).put(display?.longitude ?: location.longitude)
          .put(if (display == null) "pipeline" else "animated").put(display?.fixTime ?: location.timestamp)))
      .put(command(trim))
    val queued = System.nanoTime()
    writer.submit {
      store.executeBatch(commands, DogStatusStore.LOCATION)
      // From the looper's hand-over to the commit: how late the row lands, not a wait of the looper.
      DogStatusStore.waits.waited(DogStatusStore.LOCATION_DELAY, (System.nanoTime() - queued) / 1_000_000)
    }
  }
  /** location_at of the row written last (any recording; by id, whatever the clock did), or null when there is none. */
  fun newestLocationAt(): Long? {
    // Rows an earlier recording of this process still has queued count too.
    writer.drain(5_000)
    val rows = store.executeSql("SELECT location_at FROM myLocationTracker ORDER BY id DESC LIMIT 1",
      JSONArray()).getJSONArray("results")
    return if (rows.length() == 0) null else rows.getJSONObject(0).optLong("location_at", 0L).takeIf { it > 0 }
  }
  fun deleteAll() {
    // Queued rows land first, so none of them comes back after the delete.
    writer.drain(30_000)
    store.executeSql("DELETE FROM myLocationTracker", JSONArray())
  }
  fun page(before: Long): JSONObject {
    val where = if (before > 0) "WHERE id < ?" else ""
    val params = if (before > 0) JSONArray().put(before) else JSONArray()
    val rows = store.executeSql("SELECT * FROM myLocationTracker $where ORDER BY id DESC LIMIT 51", params).getJSONArray("results")
    val count = store.executeSql("SELECT COUNT(*) AS total FROM myLocationTracker", JSONArray()).getJSONArray("results").getJSONObject(0).getLong("total")
    return JSONObject().put("rows", rows).put("total", count)
  }
}
