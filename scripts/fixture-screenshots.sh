#!/bin/sh
# Opens each named screen state in a debug build on the connected phone and
# saves a screenshot. Needs a debug build with Metro running
# (npm start; adb reverse tcp:8081 tcp:8081), the phone unlocked and the app
# on the live map tab.
#
#   scripts/fixture-screenshots.sh [out-dir] [fixture ...]
set -e
OUT=${1:-fixture-screenshots}
shift 2>/dev/null || true
NAMES=${*:-"all-good receiver-disconnected receiver-quiet no-receiver-cloud-failing dogs-aged"}
mkdir -p "$OUT"
for name in $NAMES; do
  adb shell am start -W -a android.intent.action.VIEW \
    -d "dogtracker://dev/fixture?name=$name" com.dogtracker >/dev/null
  # Debug builds lay out slowly; give the map time to frame and redraw.
  sleep 10
  adb exec-out screencap -p > "$OUT/$name.png"
  echo "$OUT/$name.png"
done
adb shell am start -a android.intent.action.VIEW -d "dogtracker://dev/fixture?name=off" com.dogtracker >/dev/null
