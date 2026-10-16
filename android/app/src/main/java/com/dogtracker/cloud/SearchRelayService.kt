package com.dogtracker.cloud

import android.app.*
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.dogtracker.BleForegroundService
import com.dogtracker.DogStatusStore
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.UUID

/** Event-driven search relay; idle stops it, the durable queue owns retries. */
class SearchRelayService : Service() {
  companion object {
    @Volatile var instance: SearchRelayService? = null
    @Volatile var timedOut = false
    private val requests = Handler(Looper.getMainLooper())
    private var queuedStart: Runnable? = null
    private fun configured(context: Context) = context.getSharedPreferences("search_relay", 0)
    fun configure(context: Context, owner: String?, enabled: Boolean) {
      configured(context).edit().putString("owner", if (enabled) owner.orEmpty() else "").commit()
      requests.post {
        queuedStart?.let { requests.removeCallbacks(it) }; queuedStart = null
        if (!enabled || owner.isNullOrEmpty() || instance?.belongsTo(owner) == false) {
          context.stopService(Intent(context, SearchRelayService::class.java))
        }
        if (enabled && !owner.isNullOrEmpty()) startIfPending(context, owner)
      }
    }
    // Batch incoming packets over ten seconds without keeping the CPU awake.
    // Restart only for an account/phone route explicitly enabled by the UI.
    fun queued(context: Context, owner: String) {
      requests.post {
        if (configured(context).getString("owner", "") != owner || timedOut) return@post
        if (queuedStart != null) return@post
        val start = Runnable { queuedStart = null; startIfPending(context, owner) }
        queuedStart = start
        requests.postDelayed(start, 10_000)
      }
    }
    fun receiverStopped(context: Context) {
      requests.post {
        queuedStart?.let { requests.removeCallbacks(it) }; queuedStart = null
        context.stopService(Intent(context, SearchRelayService::class.java))
      }
    }
    // The relay's database reads: never on the main looper, where a long
    // database lock (a cloud download) risked an ANR (稽核 A F3).
    private val database by lazy { Handler(HandlerThread("DogTracker-SearchRelayDb").apply { start() }.looper) }
    private fun startable(context: Context, owner: String) =
      !timedOut && BleForegroundService.isRunning && configured(context).getString("owner", "") == owner
    private fun startIfPending(context: Context, owner: String) {
      if (!startable(context, owner)) return
      database.post {
        val next = runCatching { DogStatusStore.get(context).nextSearchRetry(owner) }.getOrNull()
        requests.post {
          // Checked again: things may have changed while the queue was read.
          if (next == null || !startable(context, owner)) return@post
          instance?.let { it.request(owner); return@post }
          // Android can deny a background start; retain every row for foreground or
          // WorkManager recovery rather than disrupting the BLE writer.
          runCatching { ContextCompat.startForegroundService(context, Intent(context, SearchRelayService::class.java).putExtra("owner", owner)) }
            .onFailure { com.dogtracker.AppLog.w("DogTracker", "Search relay start deferred", it) }
        }
      }
    }
  }
  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var owner = ""
  @Volatile private var runId: String? = null
  private var lock: PowerManager.WakeLock? = null
  private var reactWaitAttempt = 0
  private var nextPassElapsed = 0L
  private val network by lazy { getSystemService(ConnectivityManager::class.java) }
  private var networkRegistered = false
  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onCapabilitiesChanged(net: Network, caps: NetworkCapabilities) {
      if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) handler.post { request(owner) }
    }
  }
  // JS aborts at 25 s. Only an active pass holds the lock, with one second of
  // timeout/cleanup margin, and completion releases it immediately.
  private val deadline = Runnable { runId?.let { complete(it) } }
  @Volatile private var destroyed = false
  // The queue is read on the database thread; the answer comes back here.
  private val queue = RelayQuery<Long?>({ database.post(it) }, { handler.post(it) })
  private val tick = object : Runnable {
    override fun run() {
      if (!BleForegroundService.isRunning || owner.isEmpty()) { stopSelf(); return }
      if (runId != null) return
      val account = owner
      queue.ask({ DogStatusStore.get(this@SearchRelayService).nextSearchRetry(account) }) { next ->
        // A newer request asks again itself; a failed read stops like an empty queue.
        if (destroyed || account != owner || runId != null) return@ask
        if (!BleForegroundService.isRunning) { stopSelf(); return@ask }
        pass(next.getOrNull())
      }
    }
  }
  private fun pass(next: Long?) {
    val now = System.currentTimeMillis()
    val delay = SearchRelayTiming.waitMs(next, now, nextPassElapsed - SystemClock.elapsedRealtime())
    if (delay == null) { stopSelf(); return }
    if (delay > 0) {
      show(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1428))
      handler.postDelayed(tick, delay)
      return
    }
    val online = network.getNetworkCapabilities(network.activeNetwork)
      ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    if (!online) { show(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1428)); return }
    val context = (application as ReactApplication).reactHost?.currentReactContext
    if (context == null) {
      show(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1428))
      handler.postDelayed(tick, SearchRelayTiming.reactWaitMs(reactWaitAttempt))
      reactWaitAttempt = minOf(reactWaitAttempt + 1, 4)
      return
    }
    reactWaitAttempt = 0
    val id = UUID.randomUUID().toString()
    runId = id
    show(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1150))
    lock?.acquire(SearchRelayTiming.ACTIVE_TIMEOUT_MS)
    try {
      val data = Arguments.createMap().apply { putString("owner", owner); putString("runId", id) }
      HeadlessJsTaskContext.getInstance(context).startTask(
        HeadlessJsTaskConfig("DogTrackerSearchRelay", data, SearchRelayTiming.ACTIVE_TIMEOUT_MS, true))
      handler.postDelayed(deadline, SearchRelayTiming.ACTIVE_TIMEOUT_MS)
    } catch (_: Exception) { complete(id) }
  }
  override fun onCreate() {
    super.onCreate(); instance = this
    lock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DogTracker:search-relay").apply {
      setReferenceCounted(false)
    }
    com.dogtracker.NotificationChannels.create(this)
    network.registerDefaultNetworkCallback(networkCallback); networkRegistered = true
  }
  private fun show(text: String) {
    startForeground(3106, NotificationCompat.Builder(this, com.dogtracker.NotificationChannels.TRACKING)
      .setSmallIcon(com.dogtracker.R.drawable.ic_stat_dog).setContentTitle(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1151))
      .setContentText(text).setColor(com.dogtracker.NotificationChannels.accent(this))
      .setContentIntent(com.dogtracker.NotificationChannels.launch(this, "cloud-settings"))
      .setOnlyAlertOnce(true).setOngoing(true).build())
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    show(com.dogtracker.NativeCopy.text(com.dogtracker.R.string.c1429))
    val next = intent?.getStringExtra("owner").orEmpty()
    if (next.isEmpty() || timedOut) { stopSelf(); return START_NOT_STICKY }
    if (next != owner) {
      runId = null
      handler.removeCallbacks(deadline)
      if (lock?.isHeld == true) lock?.release()
      reactWaitAttempt = 0
      owner = next
    }
    request(next)
    return START_NOT_STICKY
  }
  private fun request(account: String) {
    if (account != owner || runId != null) return
    handler.removeCallbacks(tick); handler.post(tick)
  }
  fun isCurrent(id: String, account: String) = runId == id && owner == account && BleForegroundService.isRunning
  fun belongsTo(account: String) = owner == account
  fun complete(id: String) {
    if (id != runId) return
    runId = null
    handler.removeCallbacks(deadline)
    if (lock?.isHeld == true) lock?.release()
    // Idle is checked immediately. Nonempty queues keep a 10 s cooldown,
    // including busy/cancelled/failed launches, rather than spinning JS tasks.
    nextPassElapsed = SystemClock.elapsedRealtime() + 10_000
    handler.removeCallbacks(tick); handler.post(tick)
  }
  override fun onTimeout(startId: Int, fgsType: Int) { timedOut = true; stopSelf() }
  override fun onDestroy() {
    destroyed = true
    runId = null; owner = ""; instance = null
    handler.removeCallbacksAndMessages(null)
    if (networkRegistered) network.unregisterNetworkCallback(networkCallback)
    if (lock?.isHeld == true) lock?.release()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
  override fun onBind(intent: Intent?) = null
}
