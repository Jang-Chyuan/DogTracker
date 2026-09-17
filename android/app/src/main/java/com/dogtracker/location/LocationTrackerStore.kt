package com.dogtracker.location

import android.content.Context
import android.location.Location
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
  }
  private fun command(sql: String, values: JSONArray = JSONArray()) = JSONObject().put("query", sql).put("params", values)
  fun save(location: Location) {
    val values = JSONArray().put(System.currentTimeMillis()).put(location.time)
      .put(location.latitude).put(location.longitude)
      .put(if (location.hasAccuracy()) location.accuracy else JSONObject.NULL)
      .put(if (location.hasAltitude()) location.altitude else JSONObject.NULL)
      .put(if (location.hasSpeed()) location.speed * 3.6 else JSONObject.NULL)
      .put(if (location.hasBearing()) location.bearing else JSONObject.NULL)
    store.executeBatch(JSONArray().put(command("INSERT INTO myLocationTracker (recorded_at,location_at,latitude,longitude,accuracy_meters,altitude_meters,speed_kmh,heading_degrees) VALUES (?,?,?,?,?,?,?,?)", values)).put(command(trim)))
  }
  fun page(before: Long): JSONObject {
    val where = if (before > 0) "WHERE id < ?" else ""
    val params = if (before > 0) JSONArray().put(before) else JSONArray()
    val rows = store.executeSql("SELECT * FROM myLocationTracker $where ORDER BY id DESC LIMIT 51", params).getJSONArray("results")
    val count = store.executeSql("SELECT COUNT(*) AS total FROM myLocationTracker", JSONArray()).getJSONArray("results").getJSONObject(0).getLong("total")
    return JSONObject().put("rows", rows).put("total", count)
  }
}
