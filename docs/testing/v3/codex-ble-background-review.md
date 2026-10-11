# BLE background review: stale callbacks and legacy service launch

Switching receivers while an earlier native connection or state read is pending can let the old result clear the new session fence, report an unrelated failure, or deliver an old packet to the current callback. The JavaScript connection generation is now checked after those awaits and before handling a rejected native connection. The current receiver's genuine failure remains visible and a subsequent retry can receive its own packet.

The search relay also used `Context.startForegroundService` unconditionally although the application's minimum Android API is 24. That API begins at 26. Using `ContextCompat.startForegroundService` preserves the existing durable queue and denied-background-start recovery; AndroidX selects the supported launch method on older Android releases. See the [official AndroidX reference](https://developer.android.com/reference/androidx/core/content/ContextCompat#startForegroundService(android.content.Context,android.content.Intent)).

| Trigger | Before | After |
| --- | --- | --- |
| Receiver A's connect rejects after receiver B connects | A's catch can clear B's session fence and report A's failure | The superseded generation is ignored |
| A pending native state read returns after disconnect | Connection state and a packet can be restored | The disconnected generation is ignored |
| A pending state read returns after switching receivers | A's result can reach B's callback | The superseded generation is ignored |
| Current receiver's native connect fails | Failure must remain visible | Failure is reported; a legitimate subsequent connection still works |
| Search relay starts on API 24 or 25 | Unavailable API can defer every launch | AndroidX selects the supported service launch method |

The four deferred tests execute the real `createBleService` and control the order of native promise completion. The old implementation failed two of these regressions; the candidate passed all four and the existing background-service cases. This is behavioral evidence, not a UI screenshot or physical radio simulation.

Root reviewed the three-file code/test change on main `acbe5a45` plus source commits `f1a3af53` and `fb7e859e`:

- Whole-project JavaScript: 219 suites / 2,462 tests passed.
- Changed-file ESLint: zero errors and warnings; diff check clean.
- Android `assembleRelease`: successful in 26 seconds.
- Android `testDebugUnitTest`: 22 suites / 90 tests, zero failures/errors.

An initial request for `testReleaseUnitTest` failed because that task is not available in this repository. It was replaced with the existing debug unit-test task; the separate release assembly compiled the changed Kotlin service.

Physical receiver reception, Bluetooth background longevity, OEM battery restrictions, and an API 24/25 device remain untested. No account, permissions, BLE protocol, stored history, queue ownership, or release-signing configuration is changed by this PR.
