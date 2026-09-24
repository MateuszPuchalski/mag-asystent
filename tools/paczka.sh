#!/usr/bin/env bash
# Paczka wydania WERTIS (0.491.2).
#
# Po co: do tego wydania każda instalacja i każda aktualizacja BUDOWAŁA
# aplikację na maszynie z Subiektem. `git pull`, `npm ci` (372 MB, łącznie
# z narzędziami testowymi) i kompilacja, przez cały czas przy zatrzymanych
# usługach. Paczka robi tę pracę raz, w CI, a serwer w magazynie tylko ją
# rozpakowuje.
#
# Układ paczki powtarza układ repozytorium (`server/dist`, `server/seed`,
# `instalator/`), więc ścieżki usług NSSM z instalatora zostają te same.
# Zależności to wyłącznie produkcyjne, z tego samego lockfile'a, na którym
# przeszły testy — `npm ci --omit=dev`, nie świeże rozwiązywanie wersji.
#
# Wymaga zbudowanego repo (`npm run build`). Wynik:
#   <wyjście>/wertis-<wersja>.zip i .zip.sha256
set -euo pipefail

KORZEN=$(cd "$(dirname "$0")/.." && pwd)
WYJSCIE=${1:-"$KORZEN/dist/paczka"}
# Ścieżka bezwzględna od razu: `zip` biegnie niżej z katalogu roboczego,
# a względne `dist/paczka` z CI wskazywało wtedy w próżnię.
mkdir -p "$WYJSCIE"
WYJSCIE=$(cd "$WYJSCIE" && pwd)
WERSJA=$(node -p "require('$KORZEN/package.json').version")
NAZWA="wertis-$WERSJA"

# Paczka bez panelu albo bez serwera wstałaby „zdrowa" i pokazała pustą
# stronę — ten błąd ma paść tutaj, a nie w magazynie.
for plik in server/dist/index.js server/dist/worker/worker.js server/dist/db/schema.sql \
            server/dist/web/obsluga/index.html server/dist/reconcile-run.js; do
  [ -f "$KORZEN/$plik" ] || { echo "Brak $plik — uruchom najpierw npm run build." >&2; exit 1; }
done

ROB=$(mktemp -d)
trap 'rm -rf "$ROB"' EXIT
P="$ROB/$NAZWA"
mkdir -p "$P/server" "$P/instalator"

cp -r "$KORZEN/server/dist" "$P/server/dist"
cp -r "$KORZEN/server/seed" "$P/server/seed"
cp "$KORZEN/wertis.env.example" "$P/"
# Instalator jedzie w paczce, bo aktualizację z panelu wykonuje skrypt z TEJ
# instalacji. Bez tego nowa wersja instalatora nie dotarłaby nigdy.
cp "$KORZEN"/instalator/*.ps1 "$KORZEN"/instalator/URUCHOM.cmd "$KORZEN"/instalator/README.md "$P/instalator/"

# ── Manifesty ────────────────────────────────────────────────────────────
# Skrypty `tsx src/X.ts` przepisane na `node dist/X.js` MECHANICZNIE, żeby
# lista nie rozjechała się z `server/package.json`. tsx jest narzędziem
# deweloperskim i w paczce go nie ma. Skrypty deweloperskie (dev, test,
# build) odpadają — w paczce nie mają na czym pracować.
node - "$KORZEN" "$P" "$WERSJA" <<'SKRYPT'
const [korzen, p, wersja] = process.argv.slice(2);
const fs = require("fs");
const path = require("path");
const czytaj = (f) => JSON.parse(fs.readFileSync(path.join(korzen, f), "utf8"));
const zapisz = (f, o) => fs.writeFileSync(path.join(p, f), JSON.stringify(o, null, 2) + "\n");

const s = czytaj("server/package.json");
const skrypty = { start: "node dist/index.js", "start:worker": "node dist/worker/worker.js" };
for (const [k, v] of Object.entries(s.scripts ?? {})) {
  const m = /^tsx (src\/[^\s]+)\.ts(.*)$/.exec(v);
  if (m) skrypty[k] = `node ${m[1].replace(/^src\//, "dist/")}.js${m[2]}`;
}
zapisz("server/package.json", { name: s.name, version: wersja, private: true, type: s.type,
  engines: s.engines, scripts: skrypty, dependencies: s.dependencies });

const r = czytaj("package.json");
const glowne = {};
for (const [k, v] of Object.entries(r.scripts ?? {})) {
  const m = /^npm -w server run (\S+)(.*)$/.exec(v);
  if (m && skrypty[m[1]]) glowne[k] = `npm --prefix server run ${m[1]}${m[2]}`;
}
zapisz("package.json", { name: r.name, version: wersja, private: true, engines: r.engines, scripts: glowne });

/* Pieczątka paczki — instalator porównuje z nią numer, zanim cokolwiek
   zamieni, i zapisuje ją obok instalacji jako dowód, co stoi na dysku. */
zapisz("paczka.json", { wersja, commit: process.env.WERTIS_COMMIT ?? process.env.GITHUB_SHA ?? null,
  zbudowano: new Date().toISOString() });
SKRYPT

# ── Zależności produkcyjne z lockfile'a ──────────────────────────────────
# `npm ci` potrzebuje manifestów wszystkich workspace'ów, żeby lockfile się
# zgadzał — stąd kopia manifestów panelu, choć jego zależności nie wchodzą.
DEPS="$ROB/deps"
mkdir -p "$DEPS/server" "$DEPS/panel"
cp "$KORZEN/package.json" "$KORZEN/package-lock.json" "$DEPS/"
cp "$KORZEN/server/package.json" "$DEPS/server/"
cp "$KORZEN/panel/package.json" "$DEPS/panel/"
( cd "$DEPS" && npm ci --omit=dev --workspace server --ignore-scripts --no-audit --no-fund --loglevel=error )
# Dowiązania workspace'ów (`@wertis/*` → ../server) nie przeżyłyby ZIP-a na
# Windowsie, a serwer ich nie potrzebuje.
rm -rf "$DEPS/node_modules/@wertis"
# Moduł natywny zbudowany na Linuksie nie wstałby na Windowsie. Dziś serwer
# nie ma żadnego (`node:sqlite` jest wbudowany) i ma tak zostać.
if find "$DEPS/node_modules" -name '*.node' | grep -q .; then
  echo "W zależnościach produkcyjnych jest moduł natywny — paczka z Linuksa nie wstanie na Windowsie:" >&2
  find "$DEPS/node_modules" -name '*.node' >&2
  exit 1
fi
mv "$DEPS/node_modules" "$P/node_modules"

# ── Node dla Windowsa (@wydanie) ─────────────────────────────────────────
# Paczka niesie własny Node, więc instalator nie instaluje żadnych programów
# wstępnych, a serwer chodzi na wersji, na której przeszła paczka. Usługi
# wskazują `<katalog>\node\node.exe`, który podmienia się razem z wydaniem.
. "$KORZEN/tools/node-windows.txt"
NODE_ZIP="node-v$NODE_WERSJA-win-x64.zip"
PAMIEC=${WERTIS_NODE_CACHE:-"${XDG_CACHE_HOME:-$HOME/.cache}/wertis-node"}
mkdir -p "$PAMIEC"
if ! echo "$NODE_SHA256  $PAMIEC/$NODE_ZIP" | sha256sum -c --status 2>/dev/null; then
  curl -fsSL -o "$PAMIEC/$NODE_ZIP" "https://nodejs.org/dist/v$NODE_WERSJA/$NODE_ZIP"
  echo "$NODE_SHA256  $PAMIEC/$NODE_ZIP" | sha256sum -c --status || {
    echo "Suma $NODE_ZIP nie zgadza się z tools/node-windows.txt — nie pakuję." >&2; rm -f "$PAMIEC/$NODE_ZIP"; exit 1; }
fi
unzip -q "$PAMIEC/$NODE_ZIP" -d "$ROB/node-rozp"
mv "$ROB/node-rozp/node-v$NODE_WERSJA-win-x64" "$P/node"

mkdir -p "$WYJSCIE"
( cd "$ROB" && zip -qr -X "$WYJSCIE/$NAZWA.zip" "$NAZWA" )
( cd "$WYJSCIE" && sha256sum "$NAZWA.zip" > "$NAZWA.zip.sha256" )
echo "Paczka: $WYJSCIE/$NAZWA.zip ($(du -h "$WYJSCIE/$NAZWA.zip" | cut -f1))"
