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
import com.dogtracker.ServiceStartLog
import com.dogtracker.serviceStartLog
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
  // Starts and refusals, kept across process ends (ServiceStartLog).
  private val startLog by lazy { serviceStartLog(com.dogtracker.ServiceStarts.LOCATION) }
  // A START_STICKY restart that may get no fixes until the app is opened (RestartFixWatch).
  @Volatile private var restartWatch: RestartFixWatch? = null
  // location_at of the newest row saved before this recording (read on the first write).
  private var earlierLocationAt: Long? = UNREAD
  private fun counters() = SaveGapHistory.Counters(pipeline.received, pipeline.accepted,
    LinkedHashMap(pipeline.rejectedBy), saved, writeErrors)
  private val tick = object : Runnable {
    override fun run() {
      if (stopped) return
      val now = SystemClock.elapsedRealtimeNanos()
      // Low power: no usable fix for a while, back to HIGH to look (StationaryPowerMode).
      if (power?.silent(now, pipeline.lowUsableAt) == true) exitLowPower(now, StationaryPowerMode.Exit.SILENCE)
      // Nothing arrived for a while: ask again (LocationResubscribe). In low
      // power fixes come ~30 s apart; the silence rule above covers it.
      if (running && !pipeline.lowPower && resubscribe?.due(now) == true) {
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
            // A held row (low power) is the pipeline's locked stop, never the map's animation.
            val display = displayLocation?.takeIf { !pipeline.lowPower && it.usable(sessionId, sample, now) }
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
      restartWatch?.let { watch ->
        val note = watch.noFixesNote(now) ?: watch.firstFixNote()
        if (note != null) runCatching { startLog.note(System.currentTimeMillis(), note) }
      }
      // Once a minute: survive a process end with the night's counts.
      if (now - checkpointAt >= 60_000_000_000L) {
        checkpointAt = now
        val wall = System.currentTimeMillis()
        runCatching { gapHistory.checkpoint(wall, counters(), gapLog.ongoing(now, wall, pipeline, writeErrors)) }
      }
      val latest = pipeline.latest
      val age = latest?.let { (now - it.elapsedNanos) / 1e9 }
      // Expired once the pipeline would no longer save it (the map keeps its own display fence);
      // in low power after two missed ~30 s fixes.
      val expired = age != null && age > (if (pipeline.lowPower) StationaryPowerMode.LOW_FRESH_NANOS
        else LocationPipeline.MAX_FIX_AGE_NANOS) / 1e9
      if (!writeFailed) status = if (expired) com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1127) else pipeline.reason
      liveJson = JSONObject().put("running", running).put("status", status)
        .put("received", pipeline.received).put("accepted", pipeline.accepted).put("rejected", pipeline.rejected)
        .put("saved", saved).put("writeErrors", writeErrors).put("ageSeconds", age ?: JSONObject.NULL)
        .put("intervalSeconds", pipeline.intervalSeconds)
        .put("lowPower", pipeline.lowPower)
        .put("sessionId", sessionId)
        // Diagnostics: a system restart (START_STICKY) and whether it is getting fixes.
        .put("restarted", restartWatch?.restart == true)
        .put("restartWithoutFixes", restartWatch?.state(now) == RestartFixWatch.State.NO_FIXES).apply {
          if (latest != null) put("position", JSONObject().put("latitude", latest.latitude).put("longitude", latest.longitude)
            .put("timestamp", latest.timestamp).put("accuracy", latest.accuracy)
            .put("speedKmh", latest.speed?.times(3.6) ?: JSONObject.NULL)
            .put("rawSpeedKmh", latest.rawSpeed?.times(3.6) ?: JSONObject.NULL)
            .put("speedAccuracyMps", latest.speedAccuracy ?: JSONObject.NULL)
            .put("motionState", if (expired) "unknown" else latest.motionState)
            .put("bearing", latest.bearing ?: JSONObject.NULL))
        }.toString()
      updateNotice(now)
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
      RecordingResumeReceiver.clear(this)
      stopSelf(); return START_NOT_STICKY
    }
    // A queued automatic start must not undo a later explicit stop.
    if (!preferences.getBoolean("enabled", true)) { stopSelf(); return START_NOT_STICKY }
    if (running) return START_STICKY
    // A null intent: the system's START_STICKY restart after the process
    // ended, with the app most likely off screen. Android 12+ may refuse the
    // foreground start then (ForegroundServiceStartNotAllowedException;
    // Android 14 a SecurityException for the location type): recorded, and
    // the app's next resume (resumeIfEnabled) starts it again.
    val kind = ServiceStartLog.kindOf(intent == null)
    val startedWall = System.currentTimeMillis()
    var cannotStart = RecordingNotice.CANNOT_START
    try {
      startForeground(ID, recordingNotification(RecordingNotice.RECORDING))
      shownNotice = RecordingNotice.RECORDING
      com.dogtracker.PlainNotices.clear(this, com.dogtracker.PlainNotices.RECORDING_START_ID)
      val precise = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
      if (!precise) cannotStart = RecordingNotice.NEEDS_PRECISE_LOCATION
      check(precise) { com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1131) }
      // 067: fused location (GPS + Wi-Fi + cell + sensors) where it can be had.
      val choice = LocationSource.choose(playServicesAvailable(), Build.VERSION.SDK_INT,
        androidx.core.location.LocationManagerCompat.isLocationEnabled(manager),
        manager.allProviders.filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }.toSet())
      source = choice
      if (choice == LocationSource.Choice.None) cannotStart = RecordingNotice.LOCATION_OFF
      if (choice == LocationSource.Choice.None) error(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1132))
      val background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
      restartWatch = RestartFixWatch(kind == ServiceStartLog.Kind.RESTART, background, Build.VERSION.SDK_INT,
        SystemClock.elapsedRealtimeNanos())
      resubscribe = LocationResubscribe(SystemClock.elapsedRealtimeNanos())
      power = if (choice == LocationSource.Choice.PlayFused) StationaryPowerMode(SystemClock.elapsedRealtimeNanos()) else null
      subscribe()
      running = true
      status = com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1133)
      // Recording again: the 「點一下繼續記錄路線」 prompt is done.
      RecordingResumeReceiver.clear(this)
      startedAtMs = System.currentTimeMillis()
      startedNanos = SystemClock.elapsedRealtimeNanos()
      runCatching { startLog.started(kind, startedWall) }
      handler.post {
        gapLog.saved(SystemClock.elapsedRealtimeNanos(), startedAtMs, pipeline, writeErrors)
        runCatching { gapHistory.begin(startedAtMs) }
      }
      handler.post(tick)
    } catch (error: Exception) {
      runCatching { startLog.failed(kind, startedWall, error) }
      // A refused restart is not a permission the user can grant here.
      status = com.dogtracker.NativeCopy.text(if (kind == ServiceStartLog.Kind.RESTART) com.dogtracker.R.string.c1138
        else com.dogtracker.R.string.c1134)
      // Started by the app or by the user: say why in plain words (the start log has the detail). A
      // system restart that was refused is the 「點一下繼續記錄路線」 prompt's business (RecordingResume).
      if (kind != ServiceStartLog.Kind.RESTART) com.dogtracker.PlainNotices.post(this,
        com.dogtracker.PlainNotices.RECORDING_START_ID, cannotStart.text(), "my-route")
      stopSelf()
    }
    return if (running) START_STICKY else START_NOT_STICKY
  }
  // The notification in plain words (RecordingNotice); posted again only when its state changes.
  private var shownNotice = RecordingNotice.RECORDING
  private fun recordingNotification(notice: RecordingNotice): Notification {
    val launch = com.dogtracker.NotificationChannels.launch(this, "my-route")
    val stop = PendingIntent.getService(this, ID, Intent(this, javaClass).setAction("STOP"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_dog)
      .setContentTitle(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1128)).setContentText(notice.text())
      .setColor(com.dogtracker.NotificationChannels.accent(this)).setOnlyAlertOnce(true).setContentIntent(launch).setOngoing(true)
      .addAction(0, com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1130), stop).build()
  }
  private fun updateNotice(now: Long) {
    if (!running) return
    val age = pipeline.latest?.let { (now - it.elapsedNanos) / 1e9 }
    val notice = RecordingNotice.during(androidx.core.location.LocationManagerCompat.isLocationEnabled(manager),
      age, (now - startedNanos) / 1e9, pipeline.lowPower)
    if (notice == shownNotice) return
    shownNotice = notice
    runCatching { getSystemService(NotificationManager::class.java).notify(ID, recordingNotification(notice)) }
  }
  private var startedNanos = 0L
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
        // HIGH 1 s, or balanced power ~30 s on a held stop (StationaryPowerMode).
        val low = pipeline.lowPower
        val spec = LocationSource.fusedRequest(low)
        val request = com.google.android.gms.location.LocationRequest.Builder(spec.priority, spec.intervalMs)
          .setMinUpdateIntervalMillis(spec.minIntervalMs).build()
        val callback = object : com.google.android.gms.location.LocationCallback() {
          override fun onLocationResult(result: com.google.android.gms.location.LocationResult) {
            // Checked for each fix: a fix of this batch may have switched the request.
            for (location in result.locations) {
              if (fusedCallback !== this) return
              onLocationChanged(location)
            }
          }
        }
        fusedCallback = callback
        client.requestLocationUpdates(request, callback, worker.looper)
          .addOnFailureListener {
            // A low-power request Play services refused: back to the 1 s one.
            handler.post { if (!stopped && low && fusedCallback === callback)
              exitLowPower(SystemClock.elapsedRealtimeNanos(), StationaryPowerMode.Exit.REQUEST_FAILED) }
          }
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
  // Low-power mode on a held stop (Play services fused only; null otherwise). Worker thread only.
  private var power: StationaryPowerMode? = null
  private var sensors: android.hardware.SensorManager? = null
  private var motionTrigger: android.hardware.TriggerEventListener? = null
  private var significantMotion: String = "unchecked"

  /** After each fix (worker thread): leave LOW on the pipeline's evidence, or enter it on a long enough stop. */
  private fun checkPower(now: Long) {
    val power = power ?: return
    if (pipeline.lowPower) {
      pipeline.lowExit?.let { exitLowPower(now, it) }
      return
    }
    if (!power.shouldDownshift(now, pipeline.stationarySince, pipeline.judgedAt) || !pipeline.enterLowPower()) return
    power.enterLow(now)
    armSignificantMotion()
    // After this batch of fixes: the callback identity fences the old request's late fixes.
    handler.post { if (!stopped && pipeline.lowPower) resubscribeNow() }
  }

  private fun exitLowPower(now: Long, reason: StationaryPowerMode.Exit) {
    val power = power ?: return
    if (!pipeline.lowPower && !power.low) return
    pipeline.exitLowPower()
    power.exitLow(now, reason)
    cancelSignificantMotion()
    // The 1 s request starts now; the silence schedule starts again with it.
    resubscribe?.received(now)
    handler.post { if (!stopped && !pipeline.lowPower) resubscribeNow() }
  }

  private fun resubscribeNow() {
    unsubscribe()
    runCatching { subscribe() }
  }

  /** The one-shot significant-motion sensor (no permission). Without one, fixes and the silence rule decide. */
  private fun armSignificantMotion() {
    val manager = sensors ?: getSystemService(android.hardware.SensorManager::class.java)?.also { sensors = it }
    val sensor = manager?.getDefaultSensor(android.hardware.Sensor.TYPE_SIGNIFICANT_MOTION)
    if (manager == null || sensor == null) { significantMotion = "absent"; return }
    cancelSignificantMotion()
    val listener = object : android.hardware.TriggerEventListener() {
      override fun onTrigger(event: android.hardware.TriggerEvent?) {
        // Delivered on the main thread: hand it to the worker; a stale trigger is ignored.
        handler.post {
          if (stopped || motionTrigger !== this) return@post
          motionTrigger = null
          exitLowPower(SystemClock.elapsedRealtimeNanos(), StationaryPowerMode.Exit.SIGNIFICANT_MOTION)
        }
      }
    }
    val armed = runCatching { manager.requestTriggerSensor(listener, sensor) }.getOrDefault(false)
    significantMotion = if (armed) "armed" else "failed"
    motionTrigger = if (armed) listener else null
  }

  private fun cancelSignificantMotion() {
    val listener = motionTrigger ?: return
    motionTrigger = null
    val manager = sensors ?: return
    runCatching { manager.cancelTriggerSensor(listener, manager.getDefaultSensor(android.hardware.Sensor.TYPE_SIGNIFICANT_MOTION)) }
  }

  private fun playServicesAvailable() = try {
    com.google.android.gms.common.GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) ==
      com.google.android.gms.common.ConnectionResult.SUCCESS
  } catch (_: Throwable) { false }

  override fun onLocationChanged(location: Location) {
    if (stopped) return
    val now = SystemClock.elapsedRealtimeNanos()
    resubscribe?.received(now)
    restartWatch?.received(now)
    pipeline.accept(LocationSample(location.latitude, location.longitude,
      if (location.hasAccuracy()) location.accuracy else Float.NaN, location.elapsedRealtimeNanos, location.time,
      if (location.hasSpeed() && location.speed.isFinite() && location.speed >= 0) location.speed else null,
      if (location.hasBearing() && location.bearing.isFinite()) location.bearing else null,
      if (location.hasAltitude() && location.altitude.isFinite()) location.altitude else null,
      speedAccuracy = if (Build.VERSION.SDK_INT >= 26 && location.hasSpeedAccuracy() &&
        location.speedAccuracyMetersPerSecond.isFinite() && location.speedAccuracyMetersPerSecond >= 0)
        location.speedAccuracyMetersPerSecond else null,
      provider = LocationSource.label(source, location.provider, pipeline.lowPower)), now)
    checkPower(now)
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
    writer.println(com.dogtracker.DogStatusStore.diagnostics())
  }
  private fun diagnostics(): String {
    val now = SystemClock.elapsedRealtimeNanos(); val wall = System.currentTimeMillis()
    val time = java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.US)
    val latest = pipeline.latest
    return buildString {
      appendLine("phone recording: started ${time.format(startedAtMs)} source=${LocationSource.label(source, null)}")
      power?.let { appendLine("power: ${if (it.low) "LOW (balanced ~${StationaryPowerMode.LOW_INTERVAL_MS / 1000}s)" else "HIGH (1s)"} " +
        "downshifts=${it.downshifts} exits=${it.exits} lowSeconds=${it.lowSeconds(now)} significantMotion=$significantMotion") }
        ?: appendLine("power: HIGH only (source without low-power mode)")
      appendLine("received=${pipeline.received} accepted=${pipeline.accepted} rejected=${pipeline.rejectedBy} " +
        "motionOnly=${pipeline.motionOnly} saved=$saved writeErrors=$writeErrors intervalSeconds=${pipeline.intervalSeconds} " +
        "resubscribed=${resubscribe?.total ?: 0} odometer=${"%.1f".format(pipeline.odometerMeters)}m")
      restartWatch?.let { appendLine(it.describe(now)) }
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
    com.dogtracker.ServiceStarts.lines(this@LocationTrackerService) { time.format(it) }.forEach { appendLine(it) }
  }
  override fun onDestroy() {
    stopped = true
    // The trigger's manager call is thread-safe; its late callback is fenced by `stopped`.
    runCatching { cancelSignificantMotion() }
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
