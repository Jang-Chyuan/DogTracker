package com.dogtracker.cloud

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayQueryTest {
  private val background = ArrayDeque<Runnable>()
  private val main = ArrayDeque<Runnable>()
  private val query = RelayQuery<Long?>({ background.add(it) }, { main.add(it) })
  private var onMain = true

  private fun runBackground() { onMain = false; background.removeFirst().run(); onMain = true }
  private fun runMain() { main.removeFirst().run() }

  @Test fun theQueryRunsInTheBackgroundAndTheAnswerOnMain() {
    val answers = mutableListOf<Long?>()
    var queriedOnMain: Boolean? = null
    query.ask({ queriedOnMain = onMain; 42L }) { answers.add(it.getOrThrow()) }
    assertTrue(answers.isEmpty())
    runBackground()
    assertEquals(false, queriedOnMain)
    assertTrue(answers.isEmpty())
    runMain()
    assertEquals(listOf<Long?>(42L), answers)
  }

  @Test fun askingAgainWhileOutRerunsOnceAndOnlyTheLatestIsAnswered() {
    val answers = mutableListOf<String>()
    var value = 1L
    query.ask({ value }) { answers.add("first ${it.getOrThrow()}") }
    query.ask({ value }) { answers.add("second ${it.getOrThrow()}") }
    query.ask({ value }) { answers.add("third ${it.getOrThrow()}") }
    assertEquals(1, background.size)
    runBackground()
    value = 2L // the queue changed while the first answer was on its way
    runMain()
    assertTrue(answers.isEmpty())
    assertEquals(1, background.size)
    runBackground(); runMain()
    assertEquals(listOf("third 2"), answers)
    assertTrue(background.isEmpty() && main.isEmpty())
  }

  @Test fun aFailedQueryIsAnAnswerToo() {
    var failed = false
    query.ask({ error("database closed") }) { failed = it.isFailure }
    runBackground(); runMain()
    assertTrue(failed)
    // And the next one is asked normally.
    var answer: Long? = 0L
    query.ask({ null }) { answer = it.getOrThrow() }
    runBackground(); runMain()
    assertEquals(null, answer)
  }
}
