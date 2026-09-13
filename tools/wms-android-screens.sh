#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../android"

# Runner zamyka emulator po skrypcie; dowód trzeba zabrać także przy nieudanym teście.
evidence() {
  mkdir -p app/build/wms-screen-evidence
  adb pull /sdcard/Android/data/pl.wertis.kolektor/files/wms-screens app/build/wms-screen-evidence/ || true
  adb logcat -d > app/build/wms-screen-evidence/logcat.txt || true
}
trap evidence EXIT
adb shell wm size 720x1280
adb shell wm density 320
adb shell settings put system font_scale 1.0
./gradlew :app:connectedDebugAndroidTest --console=plain
