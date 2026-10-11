# Dog history: a range wholly inside a confirmed stay

A dog history range wholly inside a stay already confirmed by the full available day could lose the numbered stop and then show a zero-distance movement row and movement cursor. The selected interval is now retained as an unnumbered display stay. It supplies list/cursor presentation without inventing another numbered stop or moving the dog's observed coordinate.

The day-confirmed interval is presentation context only. The range must contain movement-edge evidence, and any measured travel, ride, or genuine unbridged gap vetoes the display stay. An unconfirmed short stationary interval is not promoted. Phone anchor inference is not applied to dogs.

Seven independent fictional-data regressions exercise the production history model, cursor, map presentation, CSV and GPX:

- A shorter interior range within a day-confirmed 39-minute stay becomes an unnumbered display stay.
- A measured 20-metre out-and-back remains possible short walking.
- An unconfirmed short interval remains unconfirmed.
- A real departure and return remains visible.
- A true long recording gap remains visible.
- Every selected raw CSV row and GPX observation remains present.
- Calling the stop helper without movement edges cannot establish the new display stay.

Validation on main `acbe5a45` plus `e6b66d63` / `51d67022`: 220 suites / 2,465 JavaScript tests passed; changed-file lint and diff check passed. Android release assembly succeeded in 26 seconds.

Root also performed a private before/after native check using retained normal history. The real range drag reproduced the misleading movement row/cursor before the fix, then removed that row and showed the selected stay duration afterward. Reversing the range restored the original numbered stay; Done and return to the live map worked. These captures contain private locations and are not public PR media. The candidate APK used the explicit paired QA version override `0.3.162` / `162`; it is not a newly merged main release.

An independent fictional native screenshot comparison still needs to be added before UI review. This PR does not solve the uncertain dog-indoor classification or claim that zero net displacement proves no short walk.
