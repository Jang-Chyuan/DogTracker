package com.dogtracker.cloud

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.UUID
import java.util.concurrent.TimeUnit

object CloudSyncSchedule {
  const val WORK_NAME = "dogtracker-cloud-history"
  private fun prefs(context: Context) = context.getSharedPreferences(WORK_NAME, Context.MODE_PRIVATE)

  // Only an account ID and generation are persisted here. Credentials stay in
  // the existing encrypted Supabase session store, never WorkManager inputData.
  @Synchronized fun setOwner(context: Context, owner: String?) {
    val prefs = prefs(context)
    val previous = prefs.getString("owner", null)
    val manager = WorkManager.getInstance(context)
    if (owner.isNullOrEmpty()) {
      check(prefs.edit().clear().commit()) { "Unable to cancel cloud sync owner" }
      CloudHistoryWorker.cancelAll()
      manager.cancelUniqueWork(WORK_NAME)
      return
    }
    val generation = if (previous == owner) prefs.getString("generation", null) else null
    val token = generation ?: UUID.randomUUID().toString()
    check(prefs.edit().putString("owner", owner).putString("generation", token).commit())
    if (previous != owner) CloudHistoryWorker.cancelAll()
    val request = PeriodicWorkRequestBuilder<CloudHistoryWorker>(15, TimeUnit.MINUTES)
      .setInitialDelay(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 2, TimeUnit.MINUTES)
      .setInputData(workDataOf("owner" to owner, "generation" to token))
      .addTag(WORK_NAME)
      .build()
    manager.enqueueUniquePeriodicWork(WORK_NAME,
      // UPDATE preserves the interval but also repairs an old job's input if
      // the process died between committing preferences and enqueueing work.
      if (generation == null) ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE else ExistingPeriodicWorkPolicy.UPDATE,
      request)
  }

  @Synchronized fun matches(context: Context, owner: String, generation: String): Boolean {
    val prefs = prefs(context)
    return prefs.getString("owner", null) == owner && prefs.getString("generation", null) == generation
  }

  @Synchronized fun cancelIfMatches(context: Context, owner: String, generation: String) {
    if (matches(context, owner, generation)) setOwner(context, null)
  }
}
