#!/usr/bin/env python3
"""Kontrola celów dotyku na kolektorze — mierzalna część `docs/ergonomia-magazynu.md`.

DLACZEGO TO ISTNIEJE. Dekalog ergonomii jest deklaracją, a deklaracja nie jest
mechanizmem — dokładnie tak, jak komentarz „zgodnie z wersją monorepo" nie był
mechanizmem dla trzech rozjeżdżających się numerów wersji. Punkt 4 dekalogu
(prawo Fittsa) jako jedyny da się zmierzyć tanio i bez fałszywych alarmów,
więc jako jedyny dostaje bramkę.

Kolektor ma JEDNO źródło minimalnego celu dotyku: `MinTap` w `Common.kt`.
Ekrany, które budują własny klikalny `Box`, to źródło omijają — i trzy takie
miejsca w repo faktycznie zjechały poniżej progu, zanim ten skrypt powstał.

CO SPRAWDZA. Dwie rzeczy:

  1. Łańcuch `Modifier` z `clickable` (albo `toggleable`, `selectable`,
     `combinedClickable`), który SAM ustawia wysokość poniżej 48 dp. Liczą się
     wyłącznie ogniwa tego łańcucha, nigdy rozmiary z jego argumentów — ikona
     20 dp w środku przycisku 48 dp jest poprawna i nie ma prawa się zapalić.

  2. Że `MinTap` nadal istnieje, ma jedno źródło i nie zszedł poniżej 48 dp.
     Bez tego całą bramkę omija się jedną linijką w `Common.kt`.

ZWOLNIENIA SĄ JAWNE. Komentarz `ergonomia: <powód>` w linii łańcucha albo tuż
nad nim zdejmuje zgłoszenie. Powód musi mieć co najmniej trzy wyrazy, bo
zwolnienie bez uzasadnienia jest tym samym, co brak zwolnienia. Punkt 4
dekalogu sam dopuszcza mniejszy cel przy czynności rzadkiej albo groźnej —
skrypt ma wymusić zdanie, nie zabronić decyzji.

CZEGO NIE SPRAWDZA. Reszty dekalogu. Liczby decyzji, kolejności informacji,
kosztu ruchu i trasy nie mierzy tu nic. Nie wykrywa też celu za małego przez
sam brak wymiaru: łańcuch bez wysokości mierzy się dopiero na urządzeniu.
Zielony wynik nie znaczy „ekran jest ergonomiczny".

Użycie:  python3 tools/ergonomia_check.py [pliki...]
         bez argumentów sprawdza cały android/app
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

KORZEN = Path(__file__).resolve().parent.parent
UI = KORZEN / "android/app/src/main/kotlin"
WSPOLNE = UI / "pl/wertis/kolektor/ui/components/Common.kt"

MIN_DP = 48.0

# Ogniwa, które CZYNIĄ element klikalnym. `clickable` wystarczy — reszta to te
# same gesty pod inną nazwą i milczenie o nich byłoby dziurą, nie zwolnieniem.
KLIKALNE = ("clickable", "combinedClickable", "toggleable", "selectable")

# Ogniwa, które USTALAJĄ wysokość. `width` i `widthIn` nie wchodzą: wąski
# przycisk bywa poprawny, niski — nie.
WYMIAROWE = ("size", "height", "heightIn", "sizeIn", "defaultMinSize", "requiredHeight",
             "requiredSize")

DP = re.compile(r"(\d+(?:\.\d+)?)\s*\.dp")
POWOD = re.compile(r"ergonomia:\s*(.+)")
MINTAP_DEF = re.compile(r"^\s*(?:internal\s+|private\s+|public\s+)?val\s+MinTap\s*=\s*(\d+(?:\.\d+)?)\.dp",
                        re.MULTILINE)


def bez_komentarzy(src: str) -> str:
    """Komentarze i literały na spacje — offsety zostają, więc numer linii też.

    Komentarze Kotlina SIĘ ZAGNIEŻDŻAJĄ. Ta sama pułapka położyła kiedyś build
    0.122.0, więc licznik poziomów jest tu, a nie regex na `/*.*?\\*/`.
    """
    out = list(src)
    i, n = 0, len(src)
    poziom = 0
    while i < n:
        if poziom:
            if src.startswith("/*", i):
                poziom += 1
                out[i] = out[i + 1] = " "
                i += 2
                continue
            if src.startswith("*/", i):
                poziom -= 1
                out[i] = out[i + 1] = " "
                i += 2
                continue
            if src[i] != "\n":
                out[i] = " "
            i += 1
            continue
        if src.startswith("/*", i):
            poziom = 1
            out[i] = out[i + 1] = " "
            i += 2
            continue
        if src.startswith("//", i):
            while i < n and src[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if src[i] == '"':
            # potrójny cudzysłów albo zwykły łańcuch — oba na spacje
            potrojny = src.startswith('"""', i)
            znacznik = '"""' if potrojny else '"'
            out[i:i + len(znacznik)] = " " * len(znacznik)
            i += len(znacznik)
            while i < n:
                if not potrojny and src[i] == "\\":
                    out[i] = " "
                    if i + 1 < n and src[i + 1] != "\n":
                        out[i + 1] = " "
                    i += 2
                    continue
                if src.startswith(znacznik, i):
                    out[i:i + len(znacznik)] = " " * len(znacznik)
                    i += len(znacznik)
                    break
                if src[i] != "\n":
                    out[i] = " "
                i += 1
            continue
        i += 1
    return "".join(out)


def domykajacy(src: str, otwarcie: int) -> int:
    """Indeks nawiasu zamykającego. Literały są już wyczyszczone."""
    glebokosc = 0
    for i in range(otwarcie, len(src)):
        if src[i] == "(":
            glebokosc += 1
        elif src[i] == ")":
            glebokosc -= 1
            if glebokosc == 0:
                return i
    return len(src) - 1


def lancuchy(src: str):
    """Łańcuchy `Modifier` jako lista ogniw najwyższego poziomu.

    Ogniwo to (nazwa, argumenty, offset). Argumenty zostają nierozpakowane
    WŁAŚNIE po to, żeby rozmiary z ich wnętrza nie liczyły się jako wymiar
    łańcucha — inaczej ikona w środku przycisku zapalałaby bramkę.
    """
    for m in re.finditer(r"\bModifier\b", src):
        i = m.end()
        ogniwa = []
        while True:
            while i < len(src) and src[i] in " \t\r\n":
                i += 1
            if i >= len(src) or src[i] != ".":
                break
            nazwa = re.match(r"\.(\w+)", src[i:])
            if not nazwa:
                break
            j = i + nazwa.end()
            k = j
            while k < len(src) and src[k] in " \t\r\n":
                k += 1
            if k < len(src) and src[k] == "(":
                koniec = domykajacy(src, k)
                ogniwa.append((nazwa.group(1), src[k + 1:koniec], i))
                i = koniec + 1
            else:
                ogniwa.append((nazwa.group(1), "", i))
                i = j
        if ogniwa:
            yield m.start(), ogniwa


def etykieta(sciezka: Path) -> str:
    """Ścieżka względem repo, a dla pliku spoza niego — pełna, bez wywrotki."""
    try:
        return str(sciezka.relative_to(KORZEN))
    except ValueError:
        return str(sciezka)


def linia(src: str, offset: int) -> int:
    return src.count("\n", 0, offset) + 1


def zwolniony(linie: list[str], od: int, do: int) -> str | None:
    """Powód zwolnienia z linii łańcucha albo z sześciu linii nad nim."""
    for nr in range(max(1, od - 6), do + 1):
        m = POWOD.search(linie[nr - 1])
        if m and len(m.group(1).split()) >= 3:
            return m.group(1).strip()
    return None


def sprawdz_plik(sciezka: Path) -> int:
    raw = sciezka.read_text(encoding="utf-8")
    src = bez_komentarzy(raw)
    linie = raw.splitlines()
    wzgledna = etykieta(sciezka)
    bad = 0
    zgloszone: set[tuple[int, str]] = set()

    for start, ogniwa in lancuchy(src):
        if not any(n in KLIKALNE for n, _, _ in ogniwa):
            continue
        if any("MinTap" in a for n, a, _ in ogniwa if n in WYMIAROWE):
            continue
        for nazwa, args, offset in ogniwa:
            if nazwa not in WYMIAROWE:
                continue
            # `size(width = X, height = Y)` — bierzemy wysokość, nie szerokość
            tylko_szerokosc = re.fullmatch(r"\s*width\s*=[^,]+", args)
            if tylko_szerokosc:
                continue
            for dp in DP.finditer(args):
                if float(dp.group(1)) >= MIN_DP:
                    continue
                if re.search(r"width\s*=\s*" + re.escape(dp.group(0)), args):
                    continue
                nr = linia(src, offset)
                klucz = (nr, dp.group(0))
                if klucz in zgloszone:
                    continue
                zgloszone.add(klucz)
                powod = zwolniony(linie, linia(src, start), nr)
                if powod:
                    print(f"zwolnienie      {wzgledna}:{nr} → {dp.group(1)} dp — {powod}")
                    continue
                print(f"MAŁY CEL DOTYKU {wzgledna}:{nr} → .{nazwa}({dp.group(0)}) "
                      f"na elemencie klikalnym, minimum {MIN_DP:.0f} dp")
                print(f"                użyj MinTap albo dopisz komentarz "
                      f"„ergonomia: <powód>\" — patrz docs/ergonomia-magazynu.md §4")
                bad += 1
    return bad


def sprawdz_zrodlo_progu() -> int:
    """`MinTap` ma jedno źródło i nie schodzi poniżej progu."""
    if not WSPOLNE.exists():
        print(f"BRAK PLIKU      {etykieta(WSPOLNE)} — zniknęło źródło MinTap")
        return 1
    definicje = [
        (p, m)
        for p in sorted(UI.rglob("*.kt"))
        for m in MINTAP_DEF.finditer(bez_komentarzy(p.read_text(encoding="utf-8")))
    ]
    if not definicje:
        print("BRAK PROGU      nie znalazłem definicji MinTap — bramka nie ma o co oprzeć")
        return 1
    if len(definicje) > 1:
        for p, _ in definicje:
            print(f"DWA PROGI       {etykieta(p)} — MinTap ma mieć JEDNO źródło")
        return 1
    p, m = definicje[0]
    wartosc = float(m.group(1))
    if wartosc < MIN_DP:
        print(f"NISKI PRÓG      {etykieta(p)} → MinTap = {wartosc:.0f} dp, "
              f"minimum {MIN_DP:.0f} dp")
        return 1
    print(f"próg dotyku: MinTap = {wartosc:.0f} dp ({etykieta(p)})")
    return 0


def main(argv: list[str]) -> int:
    pliki = [Path(a).resolve() for a in argv] or sorted(UI.rglob("*.kt"))
    bad = sprawdz_zrodlo_progu()
    for p in pliki:
        bad += sprawdz_plik(p)
    print(f"\nprzeskanowanych plików: {len(pliki)}")
    print("OK — cele dotyku zgodne z docs/ergonomia-magazynu.md"
          if not bad else f"\n{bad} rozbieżności")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
