# Dog anchor and GPS gap UI evidence

A native release screenshot from existing emulator 5562. All 40 raw observations were independently invented by formulas; this is not a shifted or otherwise transformed user route. The actual history hook uses a manual range covering all observations (09:14:30–09:29). No preassigned hold or hand-built timeline was supplied.

Private QA source f96d3d91 uses the reviewed dog production port with the same IndoorHold, RawObservation and Kotlin source as main-based PR96 source4cc60003; newer phone/cloud integration is present. QA-only activation is not part of this PR. APK SHA256 a2f2d531970a8914fc54eee0d425e264f50de1fe0a998741936f1f6ab77018db.

The pipeline shows a held indoor window, a 15-second no-GPS release gap (minute labels both09:24), separated approach/departure lines, and preserved short out-and-return movement. Underlying raw input has four minutes without a fix, largely retained in the indoor window; do not mislabel the modeled gap as four minutes. Total modeled movement189.9999m, short excursion89.9999m. Root visually inspected the exact native PNG.

This demonstrates this independent drawing/departure counterexample; it does not resolve the user's13 indoor nodes or validate every real-world departure. Private actual3716 replay remains separate and unchanged.
