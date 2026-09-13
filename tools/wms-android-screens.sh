#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../android"

# Runner zamyka emulator po skrypcie; log trzeba zabrać także przy nieudanym teście.
evidence() {
  mkdir -p app/build/wms-screen-evidence
  adb logcat -d > app/build/wms-screen-evidence/logcat.txt || true
}
trap evidence EXIT
adb shell wm size 720x1280
adb shell wm density 320
adb shell settings put system font_scale 1.0
./gradlew :app:connectedDebugAndroidTest --console=plain
# Zielone testy bez obrazu nie kończą odbioru ergonomii.
python3 - <<'PY'
from pathlib import Path
screens = list(Path('app/build/outputs/connected_android_test_additional_output').rglob('*.png'))
assert len(screens) >= 5, f'Brak zrzutów ekranu: znaleziono {len(screens)}'
print(f'Zachowano {len(screens)} zrzutów ekranu')
PY
