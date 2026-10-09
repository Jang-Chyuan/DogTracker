# V3 pure export builders (H9/H10)

These modules do not access React Native, SQLite, the network, files, clocks or
randomness. `useHistoryExport` (056) wires them: `ExportSnapshot.buildExportSnapshot`
makes the snapshot from the history screen's day model, `ExportDraw` turns the
PNG layout into drawing operations for `HistoryExportPackage.kt`.

## 056 changes to the Codex draft

- `timeZone: null` means the phone's own zone (the app passes null).
- My route exports its recorded route (`latitude`/`longitude`) in the GPX and the CSV
  coordinate columns; its `raw_*` go to the raw columns. A dog's raw columns default
  to the collar fix (as main wrote `slave_lat` there).
- GPX points are in the range by packet time (the screen's range); the fix time still
  decides hold/ride classification. A fix repeated in several packets is one trkpt.
- Stay waypoints deduct the list's own `interruptionMs` (`excludedMs`).
- PNG rows are the screen's list rows (`exportTimelineRows`: title, pill, coordinates,
  查不到地址, 不含中斷, movement lead/time/rest); the title is two lines (who; date, times,
  distance); a row taller than a page has its address cut after 2 lines (判定表「PNG
  一列比一頁還高」) instead of failing.

## Snapshot contract

All builders accept `{ since, until, timeZone: 'Asia/Taipei', subjects: [...] }`.
Times are finite Unix milliseconds; range endpoints are inclusive and already
aligned to real samples/hold packets by the range controller. Both endpoints must
be in the same calendar day in `timeZone` (default UTC). They must contain actual
times, never a moving “now”. Short ranges and a single point remain exportable.

A subject has:

- `kind: 'dog' | 'phone'`, `name`, `slaveId`, `distanceKm`, `routeColor`.
- `rows`: complete, source-filtered and deduplicated packet/GPS records. Existing
  CSV snake_case fields are accepted; `time` is the packet/recording timestamp,
  `location_at` is GPS acquisition time. Without `time`, use `recorded_at`.
  If present, `raw_latitude`/`raw_longitude` are authoritative, including null.
  Otherwise `latitude`/`longitude` must be original GPS, not display coordinates.
  A phone-derived display position must never be supplied as original GPS.
- `holds`, `stays`, `rides`, `gaps`: interval arrays using `{start,end}`. Hold/ride
  end is exclusive for GPS classification; release/alighting belongs to movement.
  Gaps are disjoint, detected no-data intervals. Holds use representative
  `latitude`, `longitude`, optional `address`; stays additionally have the shared
  timeline `number` (including transport switch nodes in the numbering scheme).
  Stay detection and representative-position recalculation must have been run on
  the selected range, as in the screen. Holds keep their detected held position.
- `timeline`: the screen's range-calculated rows, each `{type, address, title,
  detail, label, ...}`; all additional fields (times, numbers, coordinates) are
  retained for the renderer. Types `move`, `ride`, `drive`, `gap` are movement
  rows; other types are nodes. Supply coordinate/fallback titles and the complete
  formatted badge/detail text, as on screen. The export label “現在” becomes “結束”.

Activity is determined from packet timestamps within the selected range, so
hold-only packets with no valid GPS still count. GPX GPS points are clipped by acquisition timestamp. CSV includes every selected
packet by recording timestamp, including packets with missing raw coordinates. No interpolation, smoothing or downsampling is
performed. Do not pass map geometry capped to a drawing budget.

## Functions

- `buildGPX(snapshot)`: GPX 1.1 XML, UTC; waypoints precede tracks. One movement
  track per subject, separate numbered drive tracks per exported ride. Hold
  boundaries, ride boundaries, sessions, explicit gaps, missing GPS and GPS gaps
  over three minutes split segments. Hold waypoints are range-clipped and split
  around gaps. Stay duration/description deduct clipped no-data time.
- `buildCSV(snapshot)`: one UTF-8 string with BOM, CRLF and the 24-column design
  header; quoted/escaped cells, missing values empty. Sort by recording time (UTC), then
  slave ID. Phone source is `phone`, dog source is `dog-N`, matching the existing
  serializer. Phone collar-only fields are empty. Raw coordinates populate the
  primary latitude/longitude columns as well as the raw columns when supplied.
- `buildPNGLayout(snapshot, {measureText})`: 1080px layout with page heights,
  positioned map/section/row blocks and footer. `measureText(text,fontSize)` is
  an optional synchronous pure font measurement function. Default measurement is
  deterministic and conservative; actual renderer font metrics should be used
  for final layout. Title and legend lines are measured; legend item coordinates
  are relative to the legend area under the title. Addresses and details wrap without truncation; a row too tall for an entire
  page rejects explicitly. Render rows using `PNG_STYLE` and app light colours.
  Page one alone has a square map; later pages repeat title/legend. Map block
  provides subjects, combined 72px padding (=24dp), endpoint/all time-marker
  policy, no cursor/fading, attribution and blank-map scale fallback policy.
  Layout is a renderer contract, not a bitmap or map projection implementation.
- `buildExportFilename(snapshot, format, page?)`: common base name, local range
  timestamps, invalid characters replaced; page suffix only for split PNGs.
- `buildTempFile(snapshot, format, {createdAt,exportId,page})`: relative cache
  directory and filename descriptor. Platform chooses its cache root; caller
  supplies an opaque unique ID to isolate concurrent runs. No files are written.
- `shouldCleanupExport({createdAt}, now, timeZone)`: true starting the next local
  calendar day; not an elapsed-24-hour/seven-day expiry. Platform enumerates only
  its export cache and performs deletion. Invalid dates return false.

`captureExportSnapshot` copies and deeply freezes the snapshot at export selection
for retry. `exportAddressState` makes the offline/error/5000ms deadline decision
without I/O or timers; the caller must enforce its remaining deadline and cancel
requests. Cached snapshot addresses are preserved. Address
lookups, hold detection, range snapping, rendering, sharing and filesystem cleanup
remain caller/platform responsibilities.
