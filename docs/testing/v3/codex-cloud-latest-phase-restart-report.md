# Latest-first restart regression repair

Base: `8da73b6af3d51eaa8425a4c44739c731e2b4ecc4`. This change contains test fixtures and regressions only; no production implementation, database migration, device installation, or remote request.

## Reproduced failures

The two focused suites reproduced the exact six failures from the integration run: 6 failed / 9 passed, 1.085 s. Evidence: `/private/tmp/latest-phase-restart-red.json`.

Three failures assumed one map success per automatic pass. The current implementation independently accepts the latest positions and then the complete hold context, producing two map revisions; complete archive publication is a different transaction and revision. Two fixtures consumed the new latest-key request as their supposed first archive page, then failed before archive staging began. The manual-scope case expected the historical operation to leave the live-map fence pending, contrary to the new independent snapshot/archive contract. None of these six failures required a production source change.

## Replacement evidence

`LatestArchiveRest` uses the installed real Supabase SDK with an in-memory `fetch` server. It evaluates emitted membership, master/dog/event filters, numeric payload constraints, independent phone/fallback clocks, next-dog key seeks, context/seed queries, and historical cursor predicates. Timestamp comparisons retain six fractional digits. Historical responses can be capped below the requested 1,000 rows, so the production downloader must query through the empty terminal page. Fixture transport retries are explicitly disabled: these tests exercise CloudSync publication/cancellation/restart, not SDK backoff. There is no request to Supabase.

- The first completed pass now verifies distinct latest/context and archive results. A subsequent failed manual page still cannot change the already published archive on an independent scheduler/SQLite wrapper.
- Resuming previously staged automatic rows performs exactly one terminal `publishDownload(owner, 'auto', cutoff, guard)` and persists one complete archive proof. The accepted latest snapshot stays unchanged even when the archive contains a newer staged fix.
- For both network failure and cancellation, the real archive's second page is held until its first page and event cursor have committed to SQLite. Meanwhile, the accepted latest no-GPS packet, separate last valid fix, and complete context are available. The published archive remains old and Activity's complete-archive gate remains closed. Recreating the database wrapper/scheduler retains the exact cursor; the first resumed REST request contains `event_id.gt.<saved cursor>`. Only full completion publishes the staged rows and durable proof. Failure/cancellation never changes the accepted snapshot.
- Two additional cases fail the actual SDK packet or valid-fix phase. They cannot start archive staging, alter the old complete cache, advance a cursor, or create archive proof.
- The real manual downloader completes dog 9, then fails dog 10. Published historical rows remain dogs 6 and 9, excluding the unrelated partial automatic dog 8. Dog 9's selected-day proof remains complete and dog 10's remains incomplete. A page read can open, while Activity's all-archive gate stays closed; the independent live snapshot is byte-for-value unchanged across a new database wrapper.

The historical row-reader harness intentionally uses `historyPublication`, not the live map fence. Direct snapshot assertions cover the new map contract; the previous SQLite rollback, retention, owner-isolation, and cancellation tests remain present.

## Validation

Focused final run: **2 suites / 17 tests PASS, 0.967 s**, `/private/tmp/latest-phase-restart-final.json`.

```sh
node --experimental-sqlite node_modules/jest/bin/jest.js --runInBand \
  __tests__/CloudPartialRestart.test.js __tests__/CloudManualScopeBlocker.test.js
```

Targeted ESLint and `git diff --check` pass. Full integration tests, release build, physical-device installation, and real remote multi-page acceptance remain the parent integration task; these local SDK/SQLite results do not claim those have passed.
