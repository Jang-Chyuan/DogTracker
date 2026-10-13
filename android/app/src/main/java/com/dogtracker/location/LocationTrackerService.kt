package com.dogtracker.location

import android.app.*
import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import android.location.*
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.dogtracker.R
import org.json.JSONObject
import java.util.UUID

/** Native acquisition and storage continue without a mounted React screen. */
class LocationTrackerService : Service(), LocationListener {
  companion object {
    @Volatile var running = false
    @Volatile var status = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1125)
    @Volatile var liveJson = "{}"
    @Volatile internal var displayLocation: DisplayLocation? = null
    const val CHANNEL = com.dogtracker.NotificationChannels.TRACKING
    const val ID = 3105
    private const val UNREAD = Long.MIN_VALUE
  }
  private lateinit var manager: LocationManager
  private val worker = HandlerThread("PhoneLocationWriter")
  private lateinit var handler: Handler
  private var store: LocationTrackerStore? = null
  private val pipeline = LocationPipeline()
  private val sessionId = UUID.randomUUID().toString()
  private var saved = 0
  private var writeErrors = 0
  private val gapLog = SaveGapLog()
  private var startedAtMs = 0L
  // The same counts, kept across process ends (worker thread only).
  private val gapHistory by lazy {
    val preferences = getSharedPreferences("phone_location_diagnostics", 0)
    SaveGapHistory(object : SaveGapHistory.Store {
      override fun get() = preferences.getString("history", null)
      override fun put(value: String, now: Boolean) {
        val edit = preferences.edit().putString("history", value)
        if (now) edit.commit() else edit.apply()
      }
    })
  }
  private var checkpointAt = 0L
  // location_at of the newest row saved before this recording (read on the first write).
  private var earlierLocationAt: Long? = UNREAD
  private fun counters() = SaveGapHistory.Counters(pipeline.received, pipeline.accepted,
    LinkedHashMap(pipeline.rejectedBy), saved, writeErrors)
  private val tick = object : Runnable {
    override fun run() {
      if (stopped) return
      val now = SystemClock.elapsedRealtimeNanos()
      // Nothing arrived for a while: ask again (LocationResubscribe).
      if (running && resubscribe?.due(now) == true) {
        unsubscribe()
        runCatching { subscribe() }
      }
      val sample = pipeline.candidate(now)
      var writeFailed = false
      if (sample != null) {
        try {
          val database = store ?: LocationTrackerStore(this@LocationTrackerService).also { store = it }
          // A new recording's first fix may be the cached one an earlier recording already saved.
          if (earlierLocationAt == UNREAD) earlierLocationAt = database.newestLocationAt()
          if (LocationPipeline.repeatsSavedRow(sample, earlierLocationAt)) pipeline.skipped(sample)
          else {
            val display = displayLocation?.takeIf { it.usable(sessionId, sample, now) }
            // The fix's own time: an accepted fix can be up to MAX_FIX_AGE_NANOS old.
            database.save(sample, sessionId, display, LocationPipeline.fixWallTime(sample, now, System.currentTimeMillis()))
            earlierLocationAt = null // later fixes are ordered by the pipeline
            pipeline.written(sample, now); saved++
            gapLog.saved(now, System.currentTimeMillis(), pipeline, writeErrors)?.let { done ->
              runCatching { gapHistory.stretchDone(done) }
            }
          }
        } catch (_: Exception) { writeErrors++; writeFailed = true; status = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1126) }
      }
      // Once a minute: survive a process end with the night's counts.
      if (now - checkpointAt >= 60_000_000_000L) {
        checkpointAt = now
        val wall = System.currentTimeMillis()
        runCatching { gapHistory.checkpoint(wall, counters(), gapLog.ongoing(now, wall, pipeline, writeErrors)) }
      }
      val latest = pipeline.latest
      val age = latest?.let { (now - it.elapsedNanos) / 1e9 }
      // Expired once the pipeline would no longer save it (the map keeps its own display fence).
      val expired = age != null && age > LocationPipeline.MAX_FIX_AGE_NANOS / 1e9
      if (!writeFailed) status = if (expired) com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1127) else pipeline.reason
      liveJson = JSONObject().put("running", running).put("status", status)
        .put("received", pipeline.received).put("accepted", pipeline.accepted).put("rejected", pipeline.rejected)
        .put("saved", saved).put("writeErrors", writeErrors).put("ageSeconds", age ?: JSONObject.NULL)
        .put("intervalSeconds", pipeline.intervalSeconds)
        .put("sessionId", sessionId).apply {
          if (latest != null) put("position", JSONObject().put("latitude", latest.latitude).put("longitude", latest.longitude)
            .put("timestamp", latest.timestamp).put("accuracy", latest.accuracy)
            .put("speedKmh", latest.speed?.times(3.6) ?: JSONObject.NULL)
            .put("rawSpeedKmh", latest.rawSpeed?.times(3.6) ?: JSONObject.NULL)
            .put("speedAccuracyMps", latest.speedAccuracy ?: JSONObject.NULL)
            .put("motionState", if (expired) "unknown" else latest.motionState)
            .put("bearing", latest.bearing ?: JSONObject.NULL))
        }.toString()
      handler.postDelayed(this, 1000)
    }
  }
  @Volatile private var stopped = false
  override fun onBind(intent: Intent?) = null
  override fun onCreate() {
    super.onCreate()
    manager = getSystemService(LocationManager::class.java)
    worker.start()
    handler = Handler(worker.looper)
    com.dogtracker.NotificationChannels.create(this)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val preferences = getSharedPreferences("phone_location_recording", 0)
    if (intent?.action == "STOP") {
      preferences.edit().putBoolean("enabled", false).putLong("stoppedAt", System.currentTimeMillis()).commit()
      stopSelf(); return START_NOT_STICKY
    }
    // A queued automatic start must not undo a later explicit stop.
    if (!preferences.getBoolean("enabled", true)) { stopSelf(); return START_NOT_STICKY }
    if (running) return START_STICKY
    try {
      val launch = com.dogtracker.NotificationChannels.launch(this, "my-route")
      val stop = PendingIntent.getService(this, ID, Intent(this, javaClass).setAction("STOP"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      startForeground(ID, NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_dog)
        .setContentTitle(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1128)).setContentText(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1129))
        .setColor(com.dogtracker.NotificationChannels.accent(this)).setOnlyAlertOnce(true).setContentIntent(launch).setOngoing(true).addAction(0, com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1130), stop).build())
      val precise = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
      check(precise) { com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1131) }
      // 067: fused location (GPS + Wi-Fi + cell + sensors) where it can be had.
      val choice = LocationSource.choose(playServicesAvailable(), Build.VERSION.SDK_INT,
        androidx.core.location.LocationManagerCompat.isLocationEnabled(manager),
        manager.allProviders.filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }.toSet())
      source = choice
      if (choice == LocationSource.Choice.None) error(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1132))
      resubscribe = LocationResubscribe(SystemClock.elapsedRealtimeNanos())
      subscribe()
      running = true
      status = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1133)
      startedAtMs = System.currentTimeMillis()
      handler.post {
        gapLog.saved(SystemClock.elapsedRealtimeNanos(), startedAtMs, pipeline, writeErrors)
        runCatching { gapHistory.begin(startedAtMs) }
      }
      handler.post(tick)
    } catch (_: Exception) {
      status = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1134)
      stopSelf()
    }
    return if (running) START_STICKY else START_NOT_STICKY
  }
  private var source: LocationSource.Choice = LocationSource.Choice.None
  private var fused: com.google.android.gms.location.FusedLocationProviderClient? = null
  @Volatile private var fusedCallback: com.google.android.gms.location.LocationCallback? = null
  // Asks for updates again while none arrive (LocationResubscribe: a request
  // made while Play services still drops a dead process's one can stay silent).
  @Volatile private var resubscribe: LocationResubscribe? = null

  /** Registers for updates from [source]; a fresh fused callback each time. */
  private fun subscribe() {
    when (val choice = source) {
      LocationSource.Choice.PlayFused -> {
        val client = fused ?: com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(this)
        val request = com.google.android.gms.location.LocationRequest.Builder(
          com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY, LocationSource.INTERVAL_MS)
          .setMinUpdateIntervalMillis(LocationSource.INTERVAL_MS).build()
        val callback = object : com.google.android.gms.location.LocationCallback() {
          override fun onLocationResult(result: com.google.android.gms.location.LocationResult) {
            if (fusedCallback !== this) return
            result.locations.forEach { onLocationChanged(it) }
          }
        }
        fusedCallback = callback
        client.requestLocationUpdates(request, callback, worker.looper)
        fused = client
      }
      LocationSource.Choice.FrameworkFused -> if (Build.VERSION.SDK_INT >= 31)
        manager.requestLocationUpdates(LocationManager.FUSED_PROVIDER, LocationSource.INTERVAL_MS, 0f, this, worker.looper)
      is LocationSource.Choice.Framework -> for (provider in choice.providers)
        manager.requestLocationUpdates(provider, LocationSource.INTERVAL_MS, 0f, this, worker.looper)
      LocationSource.Choice.None -> Unit
    }
  }

  private fun unsubscribe() {
    runCatching { manager.removeUpdates(this) }
    fusedCallback?.let { callback -> runCatching { fused?.removeLocationUpdates(callback) } }
    fusedCallback = null
  }
  private fun playServicesAvailable() = try {
    com.google.android.gms.common.GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) ==
      com.google.android.gms.common.ConnectionResult.SUCCESS
  } catch (_: Throwable) { false }

  override fun onLocationChanged(location: Location) {
    if (stopped) return
    val now = SystemClock.elapsedRealtimeNanos()
    resubscribe?.received(now)
    pipeline.accept(LocationSample(location.latitude, location.longitude,
      if (location.hasAccuracy()) location.accuracy else Float.NaN, location.elapsedRealtimeNanos, location.time,
      if (location.hasSpeed() && location.speed.isFinite() && location.speed >= 0) location.speed else null,
      if (location.hasBearing() && location.bearing.isFinite()) location.bearing else null,
      if (location.hasAltitude() && location.altitude.isFinite()) location.altitude else null,
      speedAccuracy = if (Build.VERSION.SDK_INT >= 26 && location.hasSpeedAccuracy() &&
        location.speedAccuracyMetersPerSecond.isFinite() && location.speedAccuracyMetersPerSecond >= 0)
        location.speedAccuracyMetersPerSecond else null,
      provider = LocationSource.label(source, location.provider)), now)
  }
  override fun onProviderDisabled(provider: String) { status = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1135) }
  override fun onProviderEnabled(provider: String) { status = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1117) }
  @Deprecated("Legacy Android callback")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
  /** Counts and times only (no position): why stretches went without a saved row. */
  override fun dump(fd: java.io.FileDescriptor?, writer: java.io.PrintWriter, args: Array<out String>?) {
    val done = java.util.concurrent.CountDownLatch(1)
    var text: String? = null
    if (!stopped && running && handler.post { text = diagnostics(); done.countDown() })
      done.await(2, java.util.concurrent.TimeUnit.SECONDS)
    // Not recording in this process: the history kept from earlier ones.
    writer.println(text ?: "phone recording: not running\n" + persisted())
  }
  private fun diagnostics(): String {
    val now = SystemClock.elapsedRealtimeNanos(); val wall = System.currentTimeMillis()
    val time = java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.US)
    val latest = pipeline.latest
    return buildString {
      appendLine("phone recording: started ${time.format(startedAtMs)} source=${LocationSource.label(source, null)}")
      appendLine("received=${pipeline.received} accepted=${pipeline.accepted} rejected=${pipeline.rejectedBy} " +
        "motionOnly=${pipeline.motionOnly} saved=$saved writeErrors=$writeErrors intervalSeconds=${pipeline.intervalSeconds} " +
        "resubscribed=${resubscribe?.total ?: 0}")
      if (latest != null) appendLine("latest fix age=${"%.1f".format((now - latest.elapsedNanos) / 1e9)}s " +
        "accuracy=${latest.accuracy}m motion=${latest.motionState}")
      appendLine("stretches without a saved row (>= 60 s):")
      for (s in gapLog.snapshot(now, wall, pipeline, writeErrors)) appendLine("  ${time.format(s.startWallMs)} -> " +
        "${s.endWallMs?.let { time.format(it) } ?: "now"} ${s.seconds}s received=${s.received} accepted=${s.accepted} " +
        "rejected=${s.rejectedBy} writeErrors=${s.writeErrors} maxStale=${s.maxStaleSeconds?.let { "%.1fs".format(it) } ?: "-"} " +
        "bestRejectedAccuracy=${s.bestRejectedAccuracy?.let { "${it}m" } ?: "-"} motionOnly=${s.motionOnly}")
      append(persisted())
    }
  }
  private fun persisted() = buildString {
    val time = java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.US)
    appendLine("kept across process ends (recordings, then stretches; oldest first):")
    runCatching { gapHistory.lines { time.format(it) } }.getOrDefault(emptyList()).forEach { appendLine(it) }
  }
  override fun onDestroy() {
    stopped = true
    handler.removeCallbacks(tick)
    if (running) handler.post { runCatching { gapHistory.end(System.currentTimeMillis(), counters()) } }
    liveJson = "{}"
    displayLocation = null
    unsubscribe()
    fused = null
    worker.quitSafely()
    if (running) status = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1136)
    running = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
