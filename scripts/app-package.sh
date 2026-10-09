#!/bin/sh
# Sourced by the device scripts: sets PACKAGE to the applicationId that is
# actually installed on the device (ANDROID_SERIAL picks it). PACKAGE from the
# environment wins; otherwise com.antgo.dogtracker (the Play id), then
# com.dogtracker (builds before the rename). Stops when neither is installed.
if [ -z "$PACKAGE" ]; then
  for candidate in com.antgo.dogtracker com.dogtracker; do
    if adb shell pm path "$candidate" 2>/dev/null | grep -q '^package:'; then
      PACKAGE=$candidate
      break
    fi
  done
fi
if [ -z "$PACKAGE" ]; then
  echo "DogTracker is not installed (tried com.antgo.dogtracker, com.dogtracker); set PACKAGE" >&2
  return 1 2>/dev/null || exit 1
fi
export PACKAGE
