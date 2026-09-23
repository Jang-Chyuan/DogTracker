package com.dogtracker.cloud

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.LifecycleState
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A bounded worker, not a foreground service or an indefinitely running JS timer. */
class CloudHistoryWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  private val runId = UUID.randomUUID().toString()

  class Run(val owner: String, val generation: String) {
    val finished = CountDownLatch(1)
    @Volatile var active = true
    @Volatile var outcome = "retry"
    fun finish(result: String) {
      outcome = result
      active = false
      finished.countDown()
    }
  }

  override fun doWork(): Result {
    val owner = inputData.getString("owner") ?: return Result.success()
    val generation = inputData.getString("generation") ?: return Result.success()
    if (!CloudSyncSchedule.matches(applicationContext, owner, generation)) return Result.success()
    val host = (applicationContext as ReactApplication).reactHost ?: return Result.retry()
    if (host.currentReactContext?.lifecycleState == LifecycleState.RESUMED) return Result.success()
    val run = Run(owner, generation)
    runs[runId] = run
    try {
      val started = host.start()
      if (!started.waitForCompletion(30, TimeUnit.SECONDS) || started.isFaulted() || started.isCancelled()) {
        return Result.retry()
      }
      if (isStopped || !isCurrent(applicationContext, runId)) return Result.success()
      UiThreadUtil.runOnUiThread {
        try {
          val context = host.currentReactContext
          if (context == null) run.finish("retry")
          else if (isStopped || !isCurrent(applicationContext, runId)) run.finish("cancelled")
          else {
            val data = Arguments.createMap().apply {
              putString("runId", runId)
              putString("owner", owner)
            }
            HeadlessJsTaskContext.getInstance(context).startTask(
              HeadlessJsTaskConfig("DogTrackerCloudHistory", data, 110000L, true))
          }
        } catch (_: Exception) { run.finish("retry") }
      }
      // JS has a 90-second budget. The native bound also covers JS boot failure.
      if (!run.finished.await(120, TimeUnit.SECONDS)) run.finish("retry")
      Log.i("CloudHistoryWorker", "History sync finished: ${run.outcome}")
      return if (run.outcome == "retry") Result.retry() else Result.success()
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      return Result.retry()
    } catch (_: Exception) {
      Log.w("CloudHistoryWorker", "History sync could not start; will retry")
      return Result.retry()
    } finally {
      run.active = false
      runs.remove(runId)
    }
  }

  override fun onStopped() {
    runs[runId]?.finish("cancelled")
    super.onStopped()
  }

  companion object {
    private val runs = ConcurrentHashMap<String, Run>()
    fun cancelAll() { runs.values.forEach { it.finish("cancelled") } }
    fun complete(id: String, outcome: String) { runs[id]?.finish(outcome) }
    fun cancelAccount(context: Context, id: String) {
      val run = runs[id] ?: return
      CloudSyncSchedule.cancelIfMatches(context, run.owner, run.generation)
    }
    fun isCurrent(context: Context, id: String): Boolean {
      val run = runs[id] ?: return false
      val host = (context.applicationContext as ReactApplication).reactHost
      return run.active && CloudSyncSchedule.matches(context, run.owner, run.generation) &&
        host?.currentReactContext?.lifecycleState != LifecycleState.RESUMED
    }
  }
}
