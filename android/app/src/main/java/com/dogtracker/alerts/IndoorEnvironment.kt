package com.dogtracker.alerts

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.sqrt

/** The same forest, aggregation, imputation and float32 inputs as src/ml/inference.js. */
object IndoorEnvironment {
  var model: JSONObject? = null
  fun classify(rows: List<JSONObject>): String {
    if (rows.isEmpty()) return "unknown"
    if (rows.all { it.optInt("usb_present", -1) == 1 }) return "indoor"
    val forest = model ?: return "unknown"
    val values = mutableListOf<Double?>()
    var signal = false
    for (name in listOf("satellites", "hdop", "rssi", "snr", "coordinate_valid")) {
      val raw = rows.mapNotNull { row ->
        val v = if (name == "coordinate_valid") {
          if (row.has("slave_lat") && !row.isNull("slave_lat"))
            if (Geo.valid(row.optDouble("slave_lat"), row.optDouble("slave_lon"))) 1.0 else 0.0 else null
        } else (row.opt(name) as? Number)?.toDouble()
        v?.takeIf { it.isFinite() && (name != "hdop" || it >= 0 && it < 655.35) }
      }
      if (raw.isNotEmpty()) signal = true
      val mean = raw.takeIf { it.isNotEmpty() }?.average()
      values.add(mean)
      values.add(if (raw.size > 1) sqrt(raw.sumOf { (it - mean!!) * (it - mean) } / (raw.size - 1)) else null)
    }
    if (!signal) return "unknown"
    val imputer = forest.getJSONObject("imputer")
    val x = values.mapIndexed { i, v -> (v ?: imputer.getJSONArray("statistics").getDouble(i)).toFloat() }.toMutableList()
    val indicators = imputer.getJSONArray("indicators")
    for (i in 0 until indicators.length()) x.add(if (values[indicators.getInt(i)] == null) 1f else 0f)
    val probability = DoubleArray(3)
    val trees = forest.getJSONArray("trees")
    for (i in 0 until trees.length()) {
      val tree = trees.getJSONObject(i)
      val left = tree.getJSONArray("left")
      var node = 0
      while (left.getInt(node) != -1) node = if (x[tree.getJSONArray("feature").getInt(node)] <= tree.getJSONArray("threshold").getDouble(node))
        left.getInt(node) else tree.getJSONArray("right").getInt(node)
      val p = tree.getJSONArray("probabilities").getJSONArray(node)
      for (j in probability.indices) probability[j] += p.getDouble(j) / trees.length()
    }
    val best = probability.indices.maxBy { probability[it] }
    return if (probability[best] >= 0.6) forest.getJSONArray("classes").getString(best) else "unknown"
  }
}
