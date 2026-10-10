# v3 retention-cap performance verification

Host: Node 22.16.0, in-process node:sqlite 3.49.1, Apple M2 Pro. No device/bridge/render timings. See the external codex-e2efix-report.md for decisions and numbers.

The fixture generator is Claude's supplied v3 build.mjs, with an output path argument added. It seeds 60,000 BLE, 936,228 cloud, 80,000 phone and 21,000 queue rows.

```sh
TZ=Asia/Taipei node --experimental-sqlite scripts/perf-v3-build.mjs /private/tmp/dogtracker-perf-v3.db
node --experimental-sqlite scripts/perf-v3.cjs /private/tmp/dogtracker-perf-v3.db src /private/tmp/perf-after.json
# Restrict repeated timing cases if desired:
BENCH_CASES=dogs.poll,sync.initialize.repeat node --experimental-sqlite scripts/perf-v3.cjs /private/tmp/dogtracker-perf-v3.db src /private/tmp/perf-poll.json
```

For the baseline, extract src from commit 0ea062b to a temporary directory and supply that src root as the third argument. Each run copies the fixture, runs actual source methods with a test-only in-process connection, and records a first sample plus the warm median of five. First samples are not true cold storage reads. Smoothing writes are rolled back between samples. Migration runs once before guarded-initialize timings. The harness uses Babel only to load project ES modules; it does not mock the SQL or pure algorithms.

before.json and after.json have identical result hashes for every matching case, including full ordered live-window rows, packet/fix/environment/hold poll outputs and smoothed coordinates. p1/p2/p3.json record intermediate results. supplied-bench.log is a rerun of the original measure.mjs selected P1–P4 cases, with original a–e variants; it reproduces the unmodified smoothing regression. packet-index-cost.json/.log record the supplied packet.save/packet.insertTrigger SQL with shipped indexes versus P1/P3 indexes + ANALYZE. The packet path was not rewritten; these measure index-write cost (full queue case, native original trim SQL).

ANALYZE is intentionally tested separately in the harness even after open-time maintenance. Production runs it only if sqlite_stat1 is absent, otherwise PRAGMA optimize; P2 caches successful open-time work. Results are not a claim about hardware battery life or app startup latency.
