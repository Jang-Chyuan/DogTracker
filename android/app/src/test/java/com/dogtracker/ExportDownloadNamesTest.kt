package com.dogtracker

import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class ExportDownloadNamesTest {
  @Test fun duplicateNamesKeepTheLastExtension() {
    for (ext in listOf("gpx", "csv", "png", "GPX")) {
      val first = "route.part.$ext"
      assertEquals("route.part (2).$ext", ExportDownloadNames.available(first,
        listOf(first, "route.part (1).$ext")))
    }
  }

  @Test fun caseInsensitiveCollisionsDoNotOverwrite() {
    assertEquals("Walk (1).GPX", ExportDownloadNames.available("Walk.GPX", listOf("walk.gpx")))
  }

  @Test fun filenameIsSafeAndUnicodeSurvives() {
    assertEquals("狗_路線_ (1).gpx", ExportDownloadNames.available("狗/路線?.gpx", listOf("狗_路線_.gpx")))
    val name = ExportDownloadNames.available("🐕".repeat(90) + ".gpx", emptyList())
    assertTrue((".pending-${Long.MAX_VALUE}-$name").toByteArray(Charsets.UTF_8).size <= 255)
    assertTrue(name.endsWith(".gpx"))
    assertFalse(name.dropLast(4).last().isHighSurrogate())
  }

  @Test fun emptyHiddenAndExtensionlessNamesStayLegal() {
    assertEquals("export", ExportDownloadNames.available(".. ", emptyList()))
    assertEquals("_.route (1).gpx", ExportDownloadNames.available(".route.gpx", listOf("_.route.gpx")))
    assertEquals("route (1)", ExportDownloadNames.available("route. ", listOf("route")))
  }

  @Test fun systemSuffixAfterGpxIsDiscardedAndRetriedWithoutChangingMime() {
    val names = ArrayList<String>(); val discarded = ArrayList<ExportDownloads.Saved>()
    val completed = ArrayList<String>()
    val result = ExportDownloadNames.save("route.gpx", emptyList(), reserve = { candidate ->
      names.add(candidate)
      ExportDownloads.Saved(if (names.size == 1) "route.gpx (1)" else candidate, "content://${names.size}")
    }, complete = { completed.add(it.uri); it }, discard = { discarded.add(it) })
    assertEquals(listOf("route.gpx", "route (1).gpx"), names)
    assertEquals("route (1).gpx", result.name)
    assertEquals(listOf("content://1"), discarded.map { it.uri })
    assertEquals(listOf("content://2"), completed)
  }

  @Test fun visibleDuplicatesAreSkippedBeforeInsertion() {
    var created = ""
    val result = ExportDownloadNames.save("route.gpx", listOf("route.gpx", "route (1).gpx"),
      reserve = { created = it; ExportDownloads.Saved(it, "content://new") },
      complete = { it }, discard = { fail("accepted URI must not be deleted") })
    assertEquals("route (2).gpx", created)
    assertEquals(created, result.name)
  }

  @Test fun unseenConcurrentCollisionsAreBoundedAndOnlyOwnUrisAreDiscarded() {
    val created = ArrayList<String>(); val discarded = ArrayList<String>()
    try {
      ExportDownloadNames.save("route.gpx", emptyList(), reserve = {
        created.add(it); ExportDownloads.Saved("$it (1)", "content://own-${created.size}")
      }, complete = { fail("renamed pending URI must never copy or publish"); it },
        discard = { discarded.add(it.uri) }, maxAttempts = 3)
      fail("unusable names cannot be accepted")
    } catch (_: IOException) { }
    assertEquals(listOf("route.gpx", "route (1).gpx", "route (2).gpx"), created)
    assertEquals(listOf("content://own-1", "content://own-2", "content://own-3"), discarded)
  }

  @Test fun reservationFailureDoesNotDeletePreviousFiles() {
    var discarded = false
    try {
      ExportDownloadNames.save("route.gpx", listOf("route.gpx"),
        reserve = { throw IOException("copy failed") }, complete = { it }, discard = { discarded = true })
      fail("failure must propagate")
    } catch (_: IOException) { }
    assertFalse(discarded)
  }

  @Test fun cleanupFailureStopsRetryRatherThanLeavingMoreUnacceptedFiles() {
    var creates = 0
    try {
      ExportDownloadNames.save("route.gpx", emptyList(),
        reserve = { creates++; ExportDownloads.Saved("$it (1)", "content://own") },
        complete = { it }, discard = { throw IOException("delete failed") })
      fail("cleanup failure must propagate")
    } catch (_: IOException) { }
    assertEquals(1, creates)
  }

  @Test fun completionFailureDiscardsOnlyItsOwnReservation() {
    val discarded = ArrayList<String>(); var copies = 0
    try {
      ExportDownloadNames.save("route.gpx", listOf("route.gpx"),
        reserve = { ExportDownloads.Saved(it, "content://own") },
        complete = { copies++; throw IOException("copy failed") },
        discard = { discarded.add(it.uri) })
      fail("copy failure must propagate")
    } catch (_: IOException) { }
    assertEquals(1, copies)
    assertEquals(listOf("content://own"), discarded)
  }

  @Test fun matchedReservationCopiesExactlyOnceAndChecksPublishedName() {
    val discarded = ArrayList<String>(); val completed = ArrayList<String>(); var reservations = 0
    val saved = ExportDownloadNames.save("route.gpx", emptyList(),
      reserve = { reservations++; ExportDownloads.Saved(it, "content://own-$reservations") },
      complete = {
        completed.add(it.uri)
        if (completed.size == 1) it.copy(name = "${it.name} (1)") else it
      }, discard = { discarded.add(it.uri) })
    assertEquals(listOf("content://own-1", "content://own-2"), completed)
    assertEquals(listOf("content://own-1"), discarded)
    assertEquals("route (1).gpx", saved.name)
  }
}
