#!/bin/sh
# Global layout audit (060): every screen fixture at font scale 1.0, 1.3 and
# 2.0, light and dark — a screenshot and a `uiautomator dump` of each — then
# scripts/layout-audit.js over every set. Needs what fixture-screenshots.sh
# needs (debug build, Metro, adb reverse). Puts the font scale back to 1.0 and
# the theme back to light at the end.
#
#   ANDROID_SERIAL=emulator-5554 scripts/layout-audit.sh [out-dir] [fixture ...]
set -e
cd "$(dirname "$0")/.."
OUT=${1:-layout-audit}
shift 2>/dev/null || true
NAMES=${*:-$(sed -n "s/^  '\([a-z0-9-]*\)': now =>.*/\1/p" src/dev/ScreenFixtures.js)}
WAIT=${FIXTURE_WAIT:-6}
SCALES=${SCALES:-1.0 1.3 2.0}
THEMES=${THEMES:-no yes}

open_link() {
  case "$1" in
    *@*) query="name=${1%@*}\\&page=${1#*@}" ;;
    *) query="name=$1" ;;
  esac
  adb shell am start -W -a android.intent.action.VIEW -d "dogtracker://dev/fixture?$query" com.dogtracker >/dev/null
}
wait_for() {
  tries=0
  case "$1" in *@*) shown="${1%@*} on ${1#*@}" ;; *) shown="$1" ;; esac
  until adb logcat -d -s ReactNativeJS:I | grep -qE "\[ScreenFixture\] showing $shown[[:space:]]*\$"; do
    tries=$((tries + 1))
    if [ "$tries" -eq 20 ]; then open_link "$1"; fi
    if [ "$tries" -gt 60 ]; then echo "fixture $1 did not open" >&2; return 1; fi
    sleep 1
  done
}
cleanup() {
  trap - EXIT INT TERM
  open_link off 2>/dev/null || true
  adb shell settings put system font_scale 1.0 >/dev/null 2>&1 || true
  adb shell cmd uimode night no >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

for theme in $THEMES; do
  for scale in $SCALES; do
    set_dir="$OUT/$scale-$([ "$theme" = yes ] && echo dark || echo light)"
    mkdir -p "$set_dir"
    adb shell settings put system font_scale "$scale"
    adb shell cmd uimode night "$theme" >/dev/null
    adb shell am force-stop com.dogtracker
    adb shell monkey -p com.dogtracker -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    sleep 40
    for name in $NAMES; do
      # Back to the map between fixtures, so a settings page does not stay open.
      open_link off; sleep 2
      adb logcat -c
      open_link "$name"
      wait_for "$name" || continue
      sleep "$WAIT"
      adb exec-out screencap -p > "$set_dir/$name.png"
      adb shell uiautomator dump /sdcard/layout-audit.xml >/dev/null 2>&1 || true
      adb pull /sdcard/layout-audit.xml "$set_dir/$name.xml" >/dev/null 2>&1 || true
      echo "$set_dir/$name"
    done
    node scripts/layout-audit.js "$set_dir" $([ "$theme" = yes ] && echo --dark) --json "$set_dir/report.json" \
      > "$set_dir/report.txt" || true
    tail -1 "$set_dir/report.txt"
  done
done
