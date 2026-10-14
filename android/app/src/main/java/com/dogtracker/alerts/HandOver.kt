package com.dogtracker.alerts

/**
 * What the background check keeps when the app hands its dogs over
 * (AlertNotifications.alertSnapshot). Pure: no Android, no storage.
 *
 * - `incoming` are the dogs the app counts as this phone's: heard by this
 *   phone's receiver lately, even when a teammate's cloud row of the same
 *   collar is newer (AlertNotifications.isLocalDog).
 * - `others` are the rest (heard only through the cloud now): only their
 *   names and range judgements, so a dog this phone hears again while the
 *   app is away is not re-created as 「狗 N」 with an empty judgement.
 */
data class OtherDog(val slaveId: Int, val name: String?, val range: RangeState)

object HandOver {
  // AlertNotifications.LOCAL_RECEPTION_MS (ReceiverRange localSilenceMs).
  const val LOCAL_RECEPTION_MS = 3 * 60000L

  /** The last packet this phone stored of the dog. */
  private fun heardAt(dog: AlertDog): Long? = listOfNotNull(dog.range.lastLocalAt, dog.packetAt).maxOrNull()

  /**
   * The dogs after a hand-over. Whichever saw this phone's newest packet of a
   * dog keeps what came from the packets (times, position, hold, range,
   * battery); the name is always the app's. A dog the app left out is
   * dropped, unless this side stored a packet of it within
   * LOCAL_RECEPTION_MS of `now`: the app reads its rows a few seconds behind
   * the service, so a dog heard again just now is still this phone's.
   */
  fun merge(
    known: Map<Int, AlertDog>,
    incoming: Map<Int, AlertDog>,
    now: Long,
    others: Map<Int, OtherDog> = emptyMap(),
  ): MutableMap<Int, AlertDog> {
    val result = LinkedHashMap<Int, AlertDog>()
    for ((id, dog) in known) {
      if (id in incoming) continue
      val heard = heardAt(dog) ?: continue
      if (now - heard <= LOCAL_RECEPTION_MS) result[id] = others[id]?.name?.let { dog.copy(name = it) } ?: dog
    }
    for ((id, dog) in incoming) {
      val mine = known[id]
      val mineNewer = mine != null && (mine.range.lastLocalAt ?: mine.packetAt ?: 0) >
        (dog.range.lastLocalAt ?: dog.packetAt ?: 0)
      result[id] = if (mine != null && mineNewer) mine.copy(name = dog.name) else dog
    }
    return result
  }

  /** Where a packet of a dog not (or no longer) checked here starts from. */
  fun start(known: AlertDog?, other: OtherDog?): AlertDog? =
    known ?: other?.let { AlertDog(it.slaveId, name = it.name, range = it.range) }
}
