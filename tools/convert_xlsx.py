#!/usr/bin/env python3
"""Konwersja eksportu z Subiekta GT (mag.xlsx) do data/products.json.

Format wejściowy (arkusz 1, wiersz nagłówka):
  Symbol | Nazwa | Stan | J.m. | Opis | Kod kreskowy | Zamówione | Lokalizacja

Format wyjściowy — tablica tablic (kolejność jak w prototypie):
  [symbol, nazwa, ean, mag, rez, przyj, jm, zamowione, lokalizacje, opis]

Ponieważ eksport zawiera tylko jeden stan łączny, na potrzeby TESTÓW
rozbijamy go deterministycznie (hash symbolu — te same wyniki przy każdym
uruchomieniu):
  * ~55% towarów z Zamówione > 0 dostaje stan na PRZYJ (symulacja
    częściowo rozłożonej dostawy),
  * ~40% towarów ze stanem dostaje niewielkie rezerwacje.
W wersji produkcyjnej te liczby pochodzą wprost z tw_Stan (st_Stan,
st_StanRez) dla magazynów MAG i PRZYJ.

Użycie: python3 tools/convert_xlsx.py mag.xlsx data/products.json
"""
import hashlib
import json
import sys

import openpyxl


def h(s: str, mod: int) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16) % mod


def main(src: str, dst: str) -> None:
    wb = openpyxl.load_workbook(src, read_only=True)
    rows = list(wb.active.iter_rows(values_only=True))[1:]

    out = []
    for r in rows:
        sym, name, stan, jm, opis, ean, zam, lok = r
        if not sym:
            continue
        sym = str(sym).strip()
        stan = int(stan or 0)
        zam = int(zam or 0)
        hv = h(sym, 100)
        przyj = 0
        if zam > 0 and hv < 55:
            przyj = max(1, round(zam * (0.2 + (hv % 7) / 10)))
        rez = 0
        if stan > 0 and h(sym + "r", 100) < 40:
            rez = min(stan, max(1, round(stan * ((h(sym + "r", 30) + 1) / 100))))
        out.append([
            sym,
            str(name).strip() if name else "",
            str(ean).strip() if ean else "",
            stan,
            rez,
            przyj,
            str(jm or "szt.").strip(),
            zam,
            str(lok).strip() if lok else "",
            str(opis).strip() if opis else "",
        ])

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)} kartotek -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
