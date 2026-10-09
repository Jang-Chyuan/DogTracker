package com.dogtracker

import org.junit.Test
import org.junit.Assert.*
import java.nio.file.Files
import java.util.concurrent.TimeUnit

class HistoryExportCleanupTest {
  @Test fun removesExpiredExportsAndKeepsRecentOnes() {
    val root = Files.createTempDirectory("exports").toFile()
    try {
      val now = System.currentTimeMillis()
      val old = java.io.File(root, "old").apply { mkdir(); java.io.File(this, "private.csv").writeText("coordinates"); setLastModified(now - TimeUnit.DAYS.toMillis(2)) }
      val recent = java.io.File(root, "recent").apply { mkdir(); setLastModified(now) }
      HistoryExportCleanup.expired(root, now)
      assertFalse(old.exists()); assertTrue(recent.exists())
    } finally { root.deleteRecursively() }
  }
}
