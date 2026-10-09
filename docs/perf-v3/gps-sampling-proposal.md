# P6 phone GPS sampling proposal — deferred

Production acquisition and outcomes are unchanged. The parity prerequisite is not satisfied for stationary sampling changes.

## Current data dependencies

`LocationTrackerService` uses `LocationManager.GPS_PROVIDER`, not Google's fused provider. It requests raw observations at 1,000 ms and 0 m, then runs a separate 1 s persistence tick. `LocationPipeline.intervalSeconds` already writes at 1 s above 20 km/h, 3 s above 10 km/h, otherwise 5 s; reducing raw callbacks is a different change from reducing rows.

`LocationPipeline` rejects observations older than 3 s, resets its three-observation smoother on a gap over 3 s and refuses to persist an old fix. `MotionDetector` also resets on a gap over 3 s. It needs 15/20 s of credible low-speed clustered observations to suspect/confirm stationary, locks coordinates at confirmation and needs 3 s of credible movement/outside-anchor evidence to resume. Removing fixes changes smoothing, gaps, locked coordinates and resumption time.

History visits use the first judged fix as the 25 m centre, at least two outside fixes spanning over 20 s to leave, and the mean of judged fixes as the displayed representative. Stay qualification uses at least 3 min and 3× a visit-duration median after five visits. Sparse observations can change exit times, visit means, duration and clipping at a range/day boundary.

Departure uses the nearest observation in minutes 2.5–3.5 to minute 3 (earlier on ties), announces confirmation only at minute 3.5, then uses minutes 7–8 and a decision at minute 8. Coordinates must be over 40/80 m away, with phone candidate average speed 0.3–3 m/s. Removed observations can change the candidate and automatic range's previous-observation start.

The user's shorthand “30 s at >=4 m/s” differs from the shipped implementation: `HistoryConfig.phone.vehicleSpeed` is **5 m/s** for 30 s entry; `backtrackSpeed` is **4 m/s** for backtracking the confirmed segment, and exit is below **4 m/s** for 30 s. These thresholds were not changed. History movement computes speed from coordinate/time edges, not just raw provider speed. Sparse fixes change entry/exit boundaries and backtracking. Walking distance counts from the last counted anchor only when displacement exceeds the greater accuracy, at least 5 m; skipping even small observations can alter the anchor and final total. Driving, gaps and holds break counted runs.

## Smallest candidate and why it was not implemented

A possible future experiment would keep the existing provider and 1 s/0 m request while moving, suspected stationary, unknown or poor-accuracy; only after existing stationary confirmation request a longer interval. Start conservatively with **2 s/0 m**, below the current 3 s gap ceiling, and immediately return to 1 s upon motion/quality changes. This is smaller than introducing a new fused-location dependency. A positive minimum distance or a 5 s stationary interval cannot be substituted safely: either can suppress the observations needed to detect movement and generate a genuine signal gap. Fused-provider batching/min-distance would need a separate acquisition design, source provenance and replay tests.

Even 2 s cannot promise identical outcomes: it can shift the existing 3 s resumption confirmation to 4 s and change which raw samples enter the smoother. Preserving arbitrary existing results requires retaining those observations or explicitly changing the algorithms and accepting new behavior. No synthetic observations, stretched freshness windows, gap-policy changes or new provider were added.

## Parity evidence

Temporary proposal probes were run then removed, so the committed production and existing tests remain unchanged:

* Native: feed identical 1 s fixes through second 21 (confirmed stationary), then feed one pipeline 1 s fixes and the candidate only the second-26 fix, with the same 2 m drift. The unchanged full pipeline stays stationary with speed 0 and its locked coordinate; the sparse pipeline resets to moving, raw speed 0.6 m/s and a different coordinate. The assertions confirm a parity failure for the proposed acquisition interval. Existing `MotionDetectorTest` already specifies this gap reset.
* JS history: a six-observation, 5 s visit with alternating 1 m drift has representative latitude 25.000002997738687. Keeping only the 0 s/5 s observations gives latitude 25.0. Duration remains 5,000 ms, yet the displayed visit/address coordinate changes. This is a counterexample to exact history parity, not a battery estimate.
* Targeted history/route suite including the temporary JS probe: 37 suites, 397 tests passed. The probe intentionally asserts divergence; passing it does not claim candidate equivalence.

The final full Jest suite and Android unit suite are rerun after removing the probes. The existing phone GPS, route storage, history thresholds and outputs are retained. Actual hardware power savings were not measured because no device/emulator use was permitted.

Final validation after removing the probes: `npm test -- --runInBand` passed
143 suites / 1,653 tests; eslint passed with 0 errors / 7 existing warnings;
`:app:assembleRelease :app:testDebugUnitTest` passed (42 Android tests, zero
failures/errors). No production phone acquisition or history algorithm change
was made for P6.
