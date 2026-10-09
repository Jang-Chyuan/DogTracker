#!/bin/sh
# Opens named screen states (src/dev/ScreenFixtures.js) in a debug build on the
# connected phone or emulator and saves a screenshot of each.
#
# Needs: a debug build with Metro running (npm start; adb reverse tcp:8081
# tcp:8081; cd android && ./gradlew installDebug), the device unlocked, and the
# app on the live map. ANDROID_SERIAL picks the device when several are attached.
#
#   scripts/fixture-screenshots.sh [out-dir] [fixture ...]
#
# Without fixture names it takes every fixture in ScreenFixtures.js. The status
# bar clock is set to the fixtures' fixed clock (09:30) with Android's demo mode,
# and both are switched back off at the end (name=off returns to live data).
set -e
cd "$(dirname "$0")/.."
OUT=${1:-fixture-screenshots}
shift 2>/dev/null || true
NAMES=${*:-$(sed -n "s/^  '\([a-z0-9-]*\)': now =>.*/\1/p" src/dev/ScreenFixtures.js)}
WAIT=${FIXTURE_WAIT:-8}
mkdir -p "$OUT"

open_link() {
  adb shell am start -W -a android.intent.action.VIEW \
    -d "dogtracker://dev/fixture?name=$1" com.dogtracker >/dev/null
}

# useScreenFixture logs "[ScreenFixture] showing <name>" once the app has
# swapped the inputs; a busy debug JS thread can take several seconds.
wait_for() {
  tries=0
  until adb logcat -d -s ReactNativeJS:I | grep -qE "\[ScreenFixture\] showing $1[[:space:]]*\$"; do
    tries=$((tries + 1))
    # A link sent while the app was still starting can be lost: send it again.
    if [ "$tries" -eq 20 ]; then open_link "$1"; fi
    if [ "$tries" -gt 60 ]; then echo "fixture $1 did not open (is Metro running?)" >&2; exit 1; fi
    sleep 1
  done
}

demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null 2>&1 || true; }
DEMO_ALLOWED=$(adb shell settings get global sysui_demo_allowed 2>/dev/null | tr -d '\r')
cleanup() {
  trap - EXIT INT TERM
  open_link off 2>/dev/null || true
  demo exit
  case "$DEMO_ALLOWED" in
    0|1) adb shell settings put global sysui_demo_allowed "$DEMO_ALLOWED" >/dev/null 2>&1 || true ;;
    *) adb shell settings delete global sysui_demo_allowed >/dev/null 2>&1 || true ;;
  esac
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM
adb shell settings put global sysui_demo_allowed 1 >/dev/null 2>&1 || true
demo enter
demo clock -e hhmm 0930
demo battery -e level 85 -e plugged false
demo notifications -e visible false

for name in $NAMES; do
  adb logcat -c
  open_link "$name"
  wait_for "$name"
  # Then give the map time to move the camera, draw the markers and the tiles.
  sleep "$WAIT"
  adb exec-out screencap -p > "$OUT/$name.png"
  echo "$OUT/$name.png"
done
