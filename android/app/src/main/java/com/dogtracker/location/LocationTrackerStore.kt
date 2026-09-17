package com.dogtracker.location

import android.content.Context
import com.dogtracker.DogStatusStore
import org.json.JSONArray
import org.json.JSONObject

class LocationTrackerStore(context: Context) {
  private val store = DogStatusStore.get(context)
  private val trim = "DELETE FROM myLocationTracker WHERE id IN (SELECT id FROM myLocationTracker ORDER BY recorded_at DESC, id DESC LIMIT -1 OFFSET 80000)"
  init {
    store.executeBatch(JSONArray().put(command("CREATE TABLE IF NOT EXISTS myLocationTracker (id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at INTEGER NOT NULL, location_at INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy_meters REAL, altitude_meters REAL, speed_kmh REAL, heading_degrees REAL)"))
      .put(command("CREATE INDEX IF NOT EXISTS idx_myLocationTracker_time ON myLocationTracker(recorded_at DESC, id DESC)"))
      .put(command(trim)))
    synchronized(store) {
      val columns = store.executeSql("PRAGMA table_info(myLocationTracker)", JSONArray()).getJSONArray("results")
      val names = (0 until columns.length()).map { columns.getJSONObject(it).getString("name") }.toSet()
      for ((name, type) in listOf("raw_latitude" to "REAL", "raw_longitude" to "REAL", "session_id" to "TEXT",
        "raw_speed_kmh" to "REAL", "speed_accuracy_mps" to "REAL", "motion_state" to "TEXT"))
        if (name !in names) store.executeSql("ALTER TABLE myLocationTracker ADD COLUMN $name $type", JSONArray())
    }
  }
  private fun command(sql: String, values: JSONArray = JSONArray()) = JSONObject().put("query", sql).put("params", values)
  internal fun save(location: LocationSample, session: String) {
    val values = JSONArray().put(System.currentTimeMillis()).put(location.timestamp)
      .put(location.latitude).put(location.longitude)
      .put(location.accuracy).put(location.altitude ?: JSONObject.NULL)
      .put(location.speed?.times(3.6) ?: JSONObject.NULL).put(location.bearing ?: JSONObject.NULL)
    // Keep the existing insert shape; add raw provenance in the same transaction.
    store.executeBatch(JSONArray().put(command("INSERT INTO myLocationTracker (recorded_at,location_at,latitude,longitude,accuracy_meters,altitude_meters,speed_kmh,heading_degrees) VALUES (?,?,?,?,?,?,?,?)", values))
      .put(command("UPDATE myLocationTracker SET raw_latitude=?,raw_longitude=?,session_id=?,raw_speed_kmh=?,speed_accuracy_mps=?,motion_state=? WHERE id=last_insert_rowid()",
        JSONArray().put(location.rawLatitude).put(location.rawLongitude).put(session)
          .put(location.rawSpeed?.times(3.6) ?: JSONObject.NULL).put(location.speedAccuracy ?: JSONObject.NULL).put(location.motionState)))
      .put(command(trim)))
  }
  fun page(before: Long): JSONObject {
    val where = if (before > 0) "WHERE id < ?" else ""
    val params = if (before > 0) JSONArray().put(before) else JSONArray()
    val rows = store.executeSql("SELECT * FROM myLocationTracker $where ORDER BY id DESC LIMIT 51", params).getJSONArray("results")
    val count = store.executeSql("SELECT COUNT(*) AS total FROM myLocationTracker", JSONArray()).getJSONArray("results").getJSONObject(0).getLong("total")
    return JSONObject().put("rows", rows).put("total", count)
  }
}
