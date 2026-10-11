# Dense dog selection candidate — not approved or natively verified

This branch builds on the restored bottom names in PR108. It does not restore the automatic overlap picker removed by PR91 (`a46093a2`): every avatar's press still calls `pressDog(id)` and opens that dog's card. Density, camera zoom and pan never change that action. PR106's native-marker priority over a duplicate map event and PR107's history gesture protections remain in place.

The implemented candidate gives the selected dog first choice of its own bottom name. Remaining names are admitted in stable problem-first/ID order only where conservative text boxes do not collide or cross the visible control/card boundary. All true coordinates and faces remain. A suppressed name uses the existing compact native bitmap so its invisible name area does not intercept a neighbour. Problem/indoor badges, selected size and z-index retain their existing semantics.

An explicit **選狗** button shares the frame-all row. It states total mapped dogs and the number with problems. Only this button opens a scrollable selector. Every row is identified by dog ID, carries that dog's full accessibility sentence and current problem note, and opens its detailed card; a selection closes the selector. Ordinary polling or coordinate changes do not reorder its ID order. Owner/source, receiver identity or membership changes close it and invalidate queued callbacks. Back/outside/close, unmount and reopening also invalidate old callbacks. Dogs with no drawable coordinate retain the existing product limitation and are not included in this map-only selector.

Selected dogs off screen retain selection and remain in the explicit selector. Existing edge hints and the once-per-card-open framing remain. This candidate never follows telemetry by moving the camera. Actual floating-control height is fed into name/edge-hint avoidance (including large-font wrapping); SDK map padding is unchanged.

## Alternative comparison

| Candidate | 16 / 32 / 64 near dogs | Pan / zoom / offscreen | Trade-off |
| --- | --- | --- | --- |
| Selected name + suppression + explicit selector (implemented) | Keeps the map readable; every mapped ID reachable through the same labelled entry, independent of density | Face always opens own card; selector keeps offscreen dogs and selection | Finding a hidden dog takes two explicit actions; native list, font2 and real hit regions still require verification |
| Fixed dog-name row (concept only) | Direct card access without opening a list; many horizontal chips for 32/64 dogs | Names stay reachable independent of projection | Permanently occupies map space and requires repeated horizontal scrolling; long names/font2 increase the cost |

Recommendation: the implemented first candidate. A fixed row becomes hard to scan at 64 dogs and would compete with the user's existing map/route controls. The `dense-dog-selection-concept.html` is an independently invented interactive comparison, **not** native acceptance or a replacement of the approved UI. Its typography and map geometry are schematic.

## Current supported cardinality

The existing production `DogMerge.MAX_DOGS=20` keeps at most 20 unique dog IDs across the team. This candidate leaves that policy unchanged. **Native acceptance therefore uses 16 and 20 dogs, including 20 total dogs split into two groups of 10.** The 32/64 policy, renderer and interactive-concept cases are UI stress checks above the current upstream limit, not proof that production accepts 32/64 dogs. A raw 32/64 QA attempt through the unchanged mapper/merge correctly exposed the cap (four RED expected-count cases); no cap bypass or protocol widening is used.

## Source evidence

`__fixtures__/DenseDogScene.js` independently generates 16/32/64 local-metre rings with each group under 2 m in diameter, or two groups centred 12 m apart. The latitude/longitude origin is fictional (1,1); no real row, account, translated geometry or timestamp is used. Each scene has at most 64 points. Selected/problem face sizes use the product's 40/48/+8 semantics.

Focused tests exercise close overlap, two groups, different scale/pan, arbitrary last-dog selection, selected-offscreen, problem priority, unchanged coordinates, exact Marker → card identity, accessibility identity, blank map/zoom/pan never opening a list, scope/member/receiver/background stale events, reopen/duplicate/back cancellation, and font2 actual control-height admission. The legacy close-zoom `nameTags(..., group:false)` function substituted into the same 16/32/64 policy tests fails all three, rather than relying on a pretty but non-colliding fixture.

Existing tests that expressly required all close names or an `N 隻` label are updated to the candidate's admitted-name policy. Their real-coordinate, reverse-projection, pan/zoom, marker press, duplicate-map-event, accessibility and history gesture assertions remain. Pure legacy `DogMarkers.nameTags` remains available for history and splash framing and retains its original unit tests.

Focused source validation on the earlier `acbe5a45` base: **8 suites / 133 tests PASS**, 6.322 s, single worker; changed-JS lint **0 errors / 0 warnings**. Replacing only the admission policy with the legacy close-zoom function makes the same three dense-count tests **3 RED**. Native QA uses the same independent formula with 16/20 points through the unchanged mapper/merge. The existing TrackingMap suite emits its pre-existing splash reset `act` warning; Final product source on main `1dce247a`: **222 suites / 2491 tests PASS**, 175.454 s; full lint **0 errors / 8 existing warnings**. The first full run caught missing pressed feedback on the new close button; the source fix passed the existing TouchTargets audit plus the final complete suite. No native build or device acceptance was performed by this lane. Interactive concept JavaScript syntax was checked; its rendering is not native evidence.

## Required native acceptance — none performed for this candidate yet

Root owns builds and device assignments. Use only a guarded memory fixture with the above independent geometry, no database seeding or account mutation. Preserve installed source/hash and original ON/auth/permission/theme/radio state.

1. Capture normal/wide camera and real pan/pinch for 16/20 and two groups; names do not form a solid overlap block and face coordinates do not drift.
2. Tap a visible avatar before/after zoom: the selected card belongs to that exact dog and no selector opens. Verify duplicate native map events do not immediately dismiss/change it.
3. Explicitly open the selector, scroll to an arbitrary middle/last ID and open its card. Close via Back/outside/close, then select again. Verify all 20 mapped dogs, selected row and problem notes/count.
4. Pan the selected dog off screen. Selection/card remain; the selector can reach it. An explicit new card selection may use existing once-only framing, but GPS polling must not chase it.
5. Font2/light/dark/portrait/landscape: button and close target >=48 dp; full names/problem text readable; first/last selector rows reachable; viewport/control/card/edge hints do not intersect. The current text-size estimate is not a native measurement.
6. TalkBack on the actual device: explicit entry count, title focus, each dog's own full sentence, selected state, 20th row and focus return. Source accessibility props are not proof of spoken output.
7. Source/owner/member removal and live/history/background transitions: selector closes, no stale row acts on a new scope; returning remains usable.

Do not merge this UI before the user reviews its actual native screenshots/video. No performance, Supabase, GPS raw/export, protocol, private fixture activation or version/signing change is part of this candidate.
