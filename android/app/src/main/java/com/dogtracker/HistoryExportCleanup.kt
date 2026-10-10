package com.dogtracker

import android.content.Context
import androidx.work.*
import java.io.File
import java.util.concurrent.TimeUnit

object HistoryExportCleanup {
  fun clear(context: Context) { File(context.cacheDir, "history_exports").deleteRecursively() }
  fun expired(root: File, now: Long) {
    root.listFiles()?.filter { now - it.lastModified() >= TimeUnit.DAYS.toMillis(1) }?.forEach { it.deleteRecursively() }
  }
  fun start(context: Context) {
    clear(context)
    WorkManager.getInstance(context).enqueueUniquePeriodicWork("history-export-cleanup", ExistingPeriodicWorkPolicy.KEEP,
      PeriodicWorkRequestBuilder<HistoryExportCleanupWorker>(1, TimeUnit.DAYS).build())
  }
}
class HistoryExportCleanupWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    HistoryExportCleanup.expired(File(applicationContext.cacheDir, "history_exports"), System.currentTimeMillis())
    return Result.success()
  }
}
