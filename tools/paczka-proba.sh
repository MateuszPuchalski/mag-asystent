#!/usr/bin/env bash
# Próba paczki wydania (0.491.2): rozpakowana w pustym katalogu, bez repo,
# bez tsx i bez narzędzi deweloperskich, ma wstać i odpowiedzieć.
#
# To jest jedyne sprawdzenie, które mówi, że paczka działa SAMA. Testy repo
# biegną na checkoucie z pełnymi zależnościami, więc brakujący plik w paczce
# albo zależność z devDependencies przeszłyby przez nie bez słowa — a wyszłyby
# dopiero w magazynie, po aktualizacji.
#
#   tools/paczka-proba.sh <ścieżka do wertis-X.Y.Z.zip>
set -euo pipefail

ZIP=$1
WERSJA=$(basename "$ZIP" .zip | sed 's/^wertis-//')
ROB=$(mktemp -d)
PID=""
trap '[ -n "$PID" ] && kill "$PID" 2>/dev/null; rm -rf "$ROB"' EXIT

( cd "$(dirname "$ZIP")" && sha256sum -c "$(basename "$ZIP").sha256" )
unzip -q "$ZIP" -d "$ROB"
P="$ROB/wertis-$WERSJA"
[ "$(node -p "require('$P/paczka.json').wersja")" = "$WERSJA" ] || { echo "paczka.json nie zgadza się z nazwą" >&2; exit 1; }
# Node dla Windowsa (@wydanie): tu go nie uruchomimy, ale jego brak albo
# ucięty plik zatrzymałby instalację w magazynie na pierwszej usłudze.
. "$(dirname "$0")/node-windows.txt"
[ -f "$P/node/node.exe" ] && [ "$(stat -c %s "$P/node/node.exe")" -gt 10000000 ] \
  || { echo "Paczka nie ma node\\node.exe (Node $NODE_WERSJA dla Windowsa)." >&2; exit 1; }
[ -f "$P/node/npm.cmd" ] || { echo "Paczka nie ma npm.cmd przy Nodzie." >&2; exit 1; }

# Środowisko czyste: bez wertis.env z repo i bez zmiennych z CI, które
# przykryłyby to, co ma czytać sama paczka.
export WERTIS_ENV_FILE="$ROB/brak.env"
export SGT_MODE=seeded DB_PATH="$ROB/dane/wertis.db" PORT=39123 LOG_LEVEL=warn

cd "$P"
node server/dist/index.js > "$ROB/api.log" 2>&1 &
PID=$!
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" -o "$ROB/health.json" 2>/dev/null; then break; fi
  kill -0 "$PID" 2>/dev/null || { cat "$ROB/api.log" >&2; echo "API padło przy starcie" >&2; exit 1; }
  sleep 1
done
[ -s "$ROB/health.json" ] || { cat "$ROB/api.log" >&2; echo "API nie odpowiedziało w 60 s" >&2; exit 1; }
node -e "
  const h = require('$ROB/health.json');
  if (h.wersja !== '$WERSJA') throw new Error('wersja ' + h.wersja + ' zamiast $WERSJA');
  if (!h.panelObslugi) throw new Error('paczka bez panelu obsługi');
  console.log('API wstało:', h.wersja, 'panel', h.panelObslugi);
"
curl -fsS "http://127.0.0.1:$PORT/obsluga/" | grep -q '<div id="root"' \
  || { echo "panel nie serwuje index.html" >&2; exit 1; }

# Worker i wsad z dist — oba szły dotąd przez tsx albo z checkoutu.
timeout 5 node server/dist/worker/worker.js > "$ROB/worker.log" 2>&1 || [ $? -eq 124 ] \
  || { cat "$ROB/worker.log" >&2; echo "worker padł" >&2; exit 1; }
npm --prefix server run --silent reconcile > "$ROB/reconcile.log" 2>&1 \
  || { cat "$ROB/reconcile.log" >&2; echo "rekoncyliacja z paczki padła" >&2; exit 1; }

echo "Paczka $WERSJA działa bez repo: API, panel, worker i wsad."
