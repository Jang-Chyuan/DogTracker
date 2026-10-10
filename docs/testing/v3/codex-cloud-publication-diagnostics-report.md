# Safe accepted-publication diagnostics

Base: `6593bab878d76835dab0cadbad4e12b2af8eda02` (formal PR 105 source). This increment adds release observations, not a new setting, UI, query, migration, or per-page logging.

The existing fixed-schema `cloudSyncDiagnostic` now accepts exactly two further event names:

| Event | Fields | Meaning |
| --- | --- | --- |
| `latest-published` | `attempt`, `elapsedMs`, `revision` | First latest snapshot committed and passed the current generation/abort check. Revision is the scheduler's accepted snapshot publication counter; complete hold context may subsequently advance it. |
| `archive-published` | `attempt`, `elapsedMs`, `revision` | Automatic archive terminal publication completed and passed the current generation/abort check. Revision is the accepted archive counter. |

Each event is emitted at most once per corresponding stage in one automatic pass. A context completion does not emit another latest event. Manual selected-day completion and partial background staging do not emit automatic archive success. Failure/cancellation cannot emit an archive success. Owner replacement during an already-started native commit can let the old owner's physical SQLite transaction finish, but the generation check prevents reporting that as accepted success.

The logger reconstructs only the three numeric fields: positive safe-integer attempt/revision, finite nonnegative elapsed duration. It drops extra owner/master/slave identifiers, absolute timestamps/cutoffs, URLs, coordinates, payloads, and error objects. Arbitrary events and invalid values are refused. All cloud diagnostic branches now contain sink failures so logging cannot change a download outcome or expose the logging failure in another message.

## Verification

Before the source change, focused diagnostic/logger tests reproduced **6 failures / 7 passes** (`/private/tmp/cloud-publication-stages-red.json`). After the change, the related four suites passed: **64 tests / 4 suites, 5.051 s** (`/private/tmp/cloud-publication-stages-first.json`). Targeted ESLint and diff check pass.

The new sync cases use the real Supabase SDK and in-memory REST response server with real SQLite. They verify latest success is logged before a held archive request, completion adds exactly one archive success, archive failure/cancellation keeps the accepted no-GPS packet and independent last valid fix without archive success, stale latest/archive native publication cannot emit success, and a throwing log sink leaves real snapshot/archive completion successful. Logger tests check the exact field whitelist, invalid counters/durations, arbitrary names, and throwing sinks. Existing CloudSync/CloudLatestSync regressions remain green.

Full unified tests, official APK build, and real 5554 Supabase acceptance belong to the parent integration step. These new events will make **accepted phase order** observable there. They do not expose or independently prove individual HTTP/JSONB filters, remote page counts, SQL execution plans, or backend index coverage.
