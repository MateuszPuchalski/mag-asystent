#!/usr/bin/env python3
"""Kontrola importów w Kotlinie — namiastka kompilatora dla modułu :app.

DLACZEGO TO ISTNIEJE. Moduł `:app` nie kompiluje się poza CI: wymaga Android
SDK, a środowisko pracy go nie ma (settings.gradle świadomie pomija moduł).
Każdy brakujący import wychodzi więc dopiero na runnerze, kosztuje pełny cykl
CI i wraca jako czerwony build. Dwa razy pod rząd był to dokładnie ten błąd.

CO SPRAWDZA. Dwie rzeczy, obie tanie i obie złapane już na żywym błędzie:

  1. BRAKUJĄCE IMPORTY. Czy użyte identyfikatory, które są top-levelowymi
     deklaracjami w innym pakiecie tego repo, mają import. Łapie funkcję albo
     właściwość rozszerzającą przeniesioną do `:core` i użytą bez importu
     (kompilator mówi wtedy „Unresolved reference").

  2. BILANS KLAMER I NAWIASÓW po usunięciu komentarzy i literałów. Brzmi
     trywialnie, a wyłapało dwa realne błędy: komentarz rozwalony przy
     usuwaniu kodu wyrażeniem regularnym oraz polski cudzysłów zamknięty
     PROSTYM znakiem `"` wewnątrz łańcucha — Kotlin kończy na nim string
     i dalej wszystko się rozjeżdża.

CZEGO NIE SPRAWDZA. Typów, sygnatur, przeciążeń, wnioskowania. To NIE jest
kompilator i nie udaje nim być — ma wyłapać jedną, powtarzalną pomyłkę,
zanim pojedzie na CI. Zielony wynik nie znaczy „skompiluje się".

Użycie:  python3 tools/kt_imports_check.py [pliki...]
         bez argumentów sprawdza cały android/
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

KORZEN = Path(__file__).resolve().parent.parent / "android"

# top-levelowe deklaracje. Grupa 1 = odbiorca rozszerzenia (albo None),
# grupa 2 = nazwa. Rozróżnienie jest kluczowe — patrz komentarz przy ODWOLANIE.
DEKLARACJA = re.compile(
    r"^(?:@\w+\s+)*(?:public\s+|internal\s+|private\s+)?"
    r"(?:suspend\s+)?(?:inline\s+)?(?:sealed\s+|data\s+|value\s+|abstract\s+|open\s+)?"
    r"(?:fun\s+interface|fun|val|var|class|object|interface|enum\s+class|const\s+val)\s+"
    r"(?:<[^>]+>\s+)?"           # parametry typowe: fun <T> ...
    r"([\w.]+\.)?"               # odbiorca rozszerzenia: fun String.foo()
    r"(\w+)",
    re.MULTILINE,
)
PAKIET = re.compile(r"^package\s+([\w.]+)", re.MULTILINE)
IMPORT = re.compile(r"^import\s+([\w.]+)(?:\s+as\s+(\w+))?", re.MULTILINE)

# DWIE kategorie, bo używa się ich składniowo odwrotnie:
#
#   ZWYKŁY symbol (`badgeCode(7)`) stoi BEZ kropki przed sobą. Filtr „nie po
#   kropce" odsiewa `WIcons.Scan`, czyli składową, która importu nie wymaga.
#
#   ROZSZERZENIE (`stan.osoba`, `stan.userId`) stoi ZAWSZE PO KROPCE — i mimo to
#   wymaga importu. Gdyby stosować do niego ten sam filtr, narzędzie przegapiłoby
#   dokładnie ten błąd, dla którego powstało: właściwość rozszerzającą z `:core`
#   użytą bez importu.
ODWOLANIE = re.compile(r"(?<![.\w])([A-Za-z_]\w*)\b(?!\s*:)")
PO_KROPCE = re.compile(r"\.([A-Za-z_]\w*)\b")

# Nazwy związane LOKALNIE w pliku — parametry i zmienne na dowolnym wcięciu.
# Parametr `osoba: String` zasłania funkcję `osoba` z innego pakietu i jego
# użycie w ciele nie wymaga żadnego importu; bez tej listy narzędzie zgłasza
# każde takie przesłonięcie jako brak importu.
LOKALNE = re.compile(r"(?:^|[(,]|\bval\s+|\bvar\s+)\s*(\w+)\s*(?::|=[^=])", re.MULTILINE)


def bez_komentarzy(src: str) -> str:
    """Usuwa komentarze i literały — inaczej słowa z prozy udają kod."""
    out: list[str] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
        elif c == "/" and src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j == -1 else j + 2
        elif src.startswith('"""', i):
            j = src.find('"""', i + 3)
            i = n if j == -1 else j + 3
        elif c == '"':
            i += 1
            while i < n and src[i] != '"':
                i += 2 if src[i] == "\\" else 1
            i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def zbierz_deklaracje() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """(zwykłe, rozszerzenia): symbol → pakiety, w których jest na top-levelu."""
    mapa: dict[str, set[str]] = {}
    ext: dict[str, set[str]] = {}
    for p in KORZEN.rglob("*.kt"):
        if "/build/" in str(p):
            continue
        src = p.read_text(encoding="utf-8")
        m = PAKIET.search(src)
        if not m:
            continue
        pkg = m.group(1)
        # tylko deklaracje bez wcięcia = top-level
        for linia in bez_komentarzy(src).splitlines():
            if linia[:1].isspace():
                continue
            d = DEKLARACJA.match(linia)
            if d:
                cel = ext if d.group(1) else mapa
                cel.setdefault(d.group(2), set()).add(pkg)
    return mapa, ext


def bilans(p: Path, kod: str) -> list[str]:
    """Klamry i nawiasy po wycięciu komentarzy i łańcuchów."""
    problemy: list[str] = []
    for otw, zam, nazwa in (("{", "}", "klamry"), ("(", ")", "nawiasy")):
        d = kod.count(otw) - kod.count(zam)
        if d:
            problemy.append(
                f"{p.relative_to(KORZEN.parent)}: niezbilansowane {nazwa} (różnica {d}) "
                f"— najczęstsza przyczyna to `\"` zamykający cudzysłów wewnątrz łańcucha "
                f"albo komentarz uszkodzony przy usuwaniu kodu"
            )
    return problemy


def sprawdz(
    pliki: list[Path], deklaracje: dict[str, set[str]], rozszerzenia: dict[str, set[str]]
) -> list[str]:
    problemy: list[str] = []
    for p in pliki:
        if not p.exists() or "/build/" in str(p):
            continue
        src = p.read_text(encoding="utf-8")
        m = PAKIET.search(src)
        if not m:
            continue
        wlasny = m.group(1)
        importy = {i.group(2) or i.group(1).rsplit(".", 1)[-1] for i in IMPORT.finditer(src)}
        gwiazdki = {i.group(1)[:-2] for i in IMPORT.finditer(src) if i.group(1).endswith(".*")}
        kod = bez_komentarzy(src)
        wlasne = {d.group(2) for d in DEKLARACJA.finditer(kod)}
        wlasne |= {l.group(1) for l in LOKALNE.finditer(kod)}

        def zglos(uzyte: set[str], slownik: dict[str, set[str]], rodzaj: str) -> None:
            for uzyty in uzyte:
                pakiety = slownik.get(uzyty)
                if not pakiety:
                    continue
                if wlasny in pakiety or uzyty in importy or uzyty in wlasne:
                    continue
                if pakiety & gwiazdki:
                    continue
                gdzie = ", ".join(sorted(pakiety))
                problemy.append(
                    f"{p.relative_to(KORZEN.parent)}: {rodzaj} '{uzyty}' bez importu "
                    f"(zadeklarowane w {gdzie})"
                )

        zglos({i.group(1) for i in ODWOLANIE.finditer(kod)}, deklaracje, "symbol")
        zglos({i.group(1) for i in PO_KROPCE.finditer(kod)}, rozszerzenia, "rozszerzenie")
        problemy += bilans(p, kod)
    return problemy


def main() -> int:
    deklaracje, rozszerzenia = zbierz_deklaracje()
    if len(sys.argv) > 1:
        pliki = [Path(a).resolve() for a in sys.argv[1:] if a.endswith(".kt")]
    else:
        pliki = [p for p in KORZEN.rglob("*.kt") if "/build/" not in str(p)]

    problemy = sprawdz(pliki, deklaracje, rozszerzenia)
    for x in sorted(set(problemy)):
        print(x)
    print(
        f"\nsprawdzono plików: {len(pliki)}; "
        + ("OK — importy i bilans nawiasów" if not problemy else f"{len(set(problemy))} problemów")
    )
    return 1 if problemy else 0


if __name__ == "__main__":
    raise SystemExit(main())
