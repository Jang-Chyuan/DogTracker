package com.dogtracker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExportDownloadsTest {
  @Test fun mediaStoreFromAndroid10CreateDocumentBefore() {
    assertEquals(ExportDownloads.Mode.CREATE_DOCUMENT, ExportDownloads.mode(24))
    assertEquals(ExportDownloads.Mode.CREATE_DOCUMENT, ExportDownloads.mode(28))
    assertEquals(ExportDownloads.Mode.MEDIA_STORE, ExportDownloads.mode(29))
    assertEquals(ExportDownloads.Mode.MEDIA_STORE, ExportDownloads.mode(35))
  }

  @Test fun theFolderIsDownloadDogTracker() {
    assertEquals("Download/DogTracker", ExportDownloads.RELATIVE_PATH)
  }

  @Test fun createDocumentGoesThroughEachFileInTurn() {
    val queue = CreateDocumentQueue(listOf("a.png", "b.png"))
    assertEquals("a.png", queue.current())
    assertEquals("b.png", queue.done(ExportDownloads.Saved("a.png", "content://1")))
    assertNull(queue.done(ExportDownloads.Saved("b (1).png", "content://2")))
    assertTrue(queue.settled)
    assertEquals(listOf("a.png", "b (1).png"), queue.result().map { it.name })
    assertNull(queue.current())
  }

  @Test fun backingOutKeepsWhatWasSaved() {
    val queue = CreateDocumentQueue(listOf("a.png", "b.png", "c.png"))
    queue.done(ExportDownloads.Saved("a.png", "content://1"))
    assertEquals(listOf("a.png"), queue.cancel().map { it.name })
    assertTrue(queue.settled)
    assertNull(queue.current())
  }
}
