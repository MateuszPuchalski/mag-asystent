#!/bin/bash
# Test dymny workera Sfery — pełny cykl kolejki BEZ Sfery (--dry-run).
#
# Powód: do 0.197.0 CI sprawdzało wyłącznie, że projekt się KOMPILUJE, a testu
# nie miał żaden plik C# w tym repo. Pierwszym uruchomieniem `Queue.cs` była
# więc bramka 1 z `docs/wdrozenie.md` — na maszynie klienta, przy Subiekcie.
# Dry-run chodzi na Linuksie (README §Flagi), więc to samo da się zmierzyć tutaj.
#
# Co ten test bramkuje, a czego nie:
#  • DAJE: przejścia statusów, zdarzenia audytu, heartbeat, numer dokumentu
#    z adaptera i to, że zapytania z `sql/` naprawdę jadą w exe jako zasoby.
#  • NIE DAJE: niczego o COM Sfery — tam wchodzi sonda.ps1 i bramka 2.
#
# Użycie:
#   sfera-worker/test-dymny.sh                    # buduje i uruchamia przez dotnet
#   SFERA_CMD="/sciezka/wertis-sfera-worker.exe" sfera-worker/test-dymny.sh
set -euo pipefail

KORZEN=$(cd "$(dirname "$0")/.." && pwd)
PRACA=$(mktemp -d)
trap 'rm -rf "$PRACA"' EXIT

# Domyślnie `dotnet run` — w CI i u dewelopera nie ma po co produkować exe,
# a wersja pod bieżący system jest jedyną, którą da się tu uruchomić.
SFERA_CMD=${SFERA_CMD:-"dotnet run --project $KORZEN/sfera-worker/WertisSferaWorker.csproj -c Release --"}

przygotuj() {   # $1 = plik bazy, $2 = 'wolne' | 'zablokowane'
  # Bazę zakłada KOD SERWERA, nie sam `schema.sql`. Powód wyszedł przy pierwszym
  # uruchomieniu tego testu: worker pisze do `events.user_ref`, a ta kolumna
  # dochodzi migracją w `db.ts`. Baza z samego schematu wywracała zapis audytu
  # i zostawiała zadanie w `processing` — czyli objaw, który u klienta
  # zobaczyłby ktoś PO wystawieniu dokumentu w Subiekcie.
  (cd "$KORZEN" && DB_PATH="$1" npx tsx -e \
    "import(\"$KORZEN/server/src/db/db.ts\").then(m => m.db());" >/dev/null 2>&1)

  python3 - "$1" "$2" <<'PY'
import sqlite3, sys
baza, wariant = sys.argv[1], sys.argv[2]
db = sqlite3.connect(baza)
# Zablokowane: WCZEŚNIEJSZY set_location tego samego towaru w błędzie. Guard
# „adres przed sprzedawalnością" ma wtedy nie oddać MM (sql/pick_mm_pending.sql).
if wariant == "zablokowane":
    db.execute(
        "INSERT INTO sfera_queue (type, payload, status, tw_id, created_by) "
        "VALUES ('set_location', '{}', 'error', 7, 'test')")
db.execute(
    "INSERT INTO sfera_queue (type, payload, status, tw_id, created_by) VALUES "
    "('mm', '{\"magFrom\":1,\"magTo\":2,\"items\":[{\"twId\":7,\"qty\":3}]}', 'pending', 7, 'magazynier')")
db.commit()
PY
}

uruchom() {     # $1 = plik bazy
  cat > "$PRACA/wertis.env" <<EOF
SFERA_WORKER=1
SGT_MODE=mssql
DB_PATH=$1
EOF
  # Bez `set -e` na tym wywołaniu: kod wyjścia workera sprawdzamy sami, żeby
  # móc pokazać jego wyjście, zanim skrypt padnie.
  if ! WERTIS_ENV_FILE="$PRACA/wertis.env" $SFERA_CMD --dry-run --once > "$PRACA/log.txt" 2>&1; then
    echo "BŁĄD: worker zakończył się niezerowo"
    cat "$PRACA/log.txt"
    exit 1
  fi
  sed 's/^/    /' "$PRACA/log.txt"
}

sprawdz() {     # $1 = plik bazy, $2 = oczekiwany status, $3 = opis
  python3 - "$1" "$2" "$3" <<'PY'
import sqlite3, sys
baza, oczekiwany, opis = sys.argv[1], sys.argv[2], sys.argv[3]
db = sqlite3.connect(baza)
status, nr, blad = db.execute(
    "SELECT status, sgt_doc_number, error_msg FROM sfera_queue WHERE type='mm'").fetchone()
bledy = []
if status != oczekiwany:
    bledy.append(f"status={status!r}, oczekiwano {oczekiwany!r} (błąd: {blad!r})")
if oczekiwany == "done":
    if not (nr or "").startswith("MM DRY-RUN/"):
        bledy.append(f"sgt_doc_number={nr!r}, oczekiwano 'MM DRY-RUN/…'")
    zdarzenia = [r[0] for r in db.execute("SELECT type FROM events")]
    if "queue_applied" not in zdarzenia:
        bledy.append(f"brak zdarzenia queue_applied w dzienniku (jest: {zdarzenia})")
    meldunek = db.execute("SELECT sfera_mode FROM process_state WHERE name='sfera'").fetchone()
    if not meldunek or meldunek[0] != "dry-run":
        bledy.append(f"heartbeat procesu 'sfera' = {meldunek!r}, oczekiwano ('dry-run',)")
else:
    if nr is not None:
        bledy.append(f"zadanie zablokowane, a ma numer dokumentu {nr!r}")
if bledy:
    print(f"NIE: {opis}")
    for b in bledy:
        print(f"     {b}")
    sys.exit(1)
print(f"OK: {opis}")
PY
}

if [ ! -d "$KORZEN/node_modules/tsx" ]; then
  echo "Brak node_modules — bazę testową zakłada kod serwera. Uruchom 'npm ci'."
  exit 1
fi

echo "Test dymny workera Sfery (--dry-run --once)"
echo

echo "1/2 · zadanie MM przechodzi cykl pending → done"
przygotuj "$PRACA/wolne.db" wolne
uruchom "$PRACA/wolne.db"
sprawdz "$PRACA/wolne.db" done "MM wykonane, numer z dry-run, zdarzenie i heartbeat na miejscu"
echo

echo "2/2 · guard kolejności: MM za niewykonanym set_location stoi"
przygotuj "$PRACA/zablokowane.db" zablokowane
uruchom "$PRACA/zablokowane.db"
sprawdz "$PRACA/zablokowane.db" pending "MM nietknięte, dopóki adres nie wejdzie"
echo

echo "Test dymny zielony."
