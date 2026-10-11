# Large-font short landscape history acceptance

Production UI commits: 38b2f8b, c388bd28, 373d2635; PR source 9c5de571. The fixed date and range header uses two columns only for a short, wide window. The sheet remains capped at half the screen. Compact summary padding is reduced without reducing font scale; the extra list tail gap is removed only for short-wide windows at font scale >=1.79, while the navigation inset remains intact.

Native evidence: existing Android emulator-5562, font scale 2, dark mode. Independent, formula-generated 86 observations, held in memory by a private QA entry that is absent from this PR. Runtime 217434db / APK SHA 01ebf01c7b6d7a2ccac42de279e7453a10da0265eb6ae9ca40c81c964e17705f. That QA includes other integration source, so these images establish layout and gestures, not a build of the isolated PR or GPS classification accuracy. Google base-map tiles may use the network.

- At actual maximum scroll, both landscape and portrait show the complete END circle, address, end label and coordinates above system navigation.
- A real range swipe updates the selected time; Back and Done close the range bar while retaining history.
- A native DOWN/MOVE preview without UP is canceled by rotation. Delivering the old UP afterward does not overwrite the previously committed range.
- The full independent range is restored before the final screenshots.

Only independently invented inputs are published. User history, account screenshots, raw logs and actual geometry remain private. Formal runtime 8c3044ab was restored afterward; normal-data acceptance is tracked separately. This does not establish behavior on all OEMs, all font sizes or Android 7–9 SAF.
