#!/usr/bin/env python3
"""Konwersja eksportu z Subiekta GT (mag.xlsx / magmat.xlsx) do products.json.

Kolumny wejściowe rozpoznajemy po NAZWIE w wierszu nagłówka (kolejność i
nadmiarowe kolumny nie mają znaczenia). Obsługiwane nagłówki:

  Symbol, Nazwa, Stan, Rezerwacja, J.m., Opis, Kod kreskowy, Dostawca,
  Zamówione, MGP, Lokalizacja

„Stan" to stan na magazynie głównym (MAG), „MGP" — na strefie przyjęć.
Jeśli eksport nie zawiera kolumn Rezerwacja / MGP (starszy, „płaski" format
z jednym stanem łącznym), rozbijamy je deterministycznie (hash symbolu —
te same wyniki przy każdym uruchomieniu), żeby moduł rozkładania miał co
testować. Gdy kolumny są obecne, używamy wartości WPROST z eksportu.

Format wyjściowy — tablica tablic:
  [symbol, nazwa, ean, mag, rez, mgp, jm, zamowione, lokalizacja, opis, dostawca]

Użycie: python3 tools/convert_xlsx.py magmat.xlsx web/public/data/products.json
"""
import hashlib
import json
import sys

import openpyxl

# nagłówek w arkuszu -> klucz logiczny (dopasowanie po znormalizowanej nazwie)
HEADER_MAP = {
    "symbol": "symbol",
    "nazwa": "nazwa",
    "stan": "stan",
    "rezerwacja": "rez",
    "j.m.": "jm",
    "jm": "jm",
    "opis": "opis",
    "kod kreskowy": "ean",
    "dostawca": "dostawca",
    "zamówione": "zam",
    "zamowione": "zam",
    "mgp": "mgp",
    "lokalizacja": "lok",
}


def h(s: str, mod: int) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16) % mod


def to_int(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def main(src: str, dst: str) -> None:
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    ws = wb.active
    it = ws.iter_rows(values_only=True)
    header = next(it)
    # kolumna logiczna -> indeks w wierszu
    col = {}
    for i, name in enumerate(header):
        key = HEADER_MAP.get(str(name).strip().lower()) if name else None
        if key and key not in col:
            col[key] = i
    if "symbol" not in col:
        raise SystemExit("Brak kolumny 'Symbol' w nagłówku — sprawdź eksport.")

    has_rez = "rez" in col
    has_mgp = "mgp" in col

    def cell(row, key, default=None):
        i = col.get(key)
        return row[i] if i is not None and i < len(row) else default

    out = []
    for row in it:
        sym = cell(row, "symbol")
        if not sym:
            continue
        sym = str(sym).strip()
        stan = to_int(cell(row, "stan"))
        zam = to_int(cell(row, "zam"))

        # MGP i rezerwacja: realne z eksportu, a jeśli brak kolumn — synteza
        if has_mgp:
            mgp = to_int(cell(row, "mgp"))
        else:
            hv = h(sym, 100)
            mgp = max(1, round(zam * (0.2 + (hv % 7) / 10))) if (zam > 0 and hv < 55) else 0
        if has_rez:
            rez = min(stan, to_int(cell(row, "rez"))) if stan > 0 else to_int(cell(row, "rez"))
        else:
            rez = 0
            if stan > 0 and h(sym + "r", 100) < 40:
                rez = min(stan, max(1, round(stan * ((h(sym + "r", 30) + 1) / 100))))

        ean = cell(row, "ean")
        name = cell(row, "nazwa")
        jm = cell(row, "jm")
        lok = cell(row, "lok")
        opis = cell(row, "opis")
        dostawca = cell(row, "dostawca")

        out.append([
            sym,
            str(name).strip() if name else "",
            str(ean).strip() if ean else "",
            stan,
            rez,
            mgp,
            str(jm or "szt.").strip(),
            zam,
            str(lok).strip() if lok else "",
            str(opis).strip() if opis else "",
            str(dostawca).strip() if dostawca else "",
        ])

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    src_mode = "realne rez/mgp" if (has_rez and has_mgp) else "synteza rez/mgp"
    print(f"{len(out)} kartotek -> {dst} ({src_mode})")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
