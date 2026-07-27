#!/usr/bin/env python3
"""Kontrola spójności dokumentacji z kodem.

Powstało po tym, jak `docs/analiza-rozkladanie.md` przez kilka PR-ów odsyłał do
plików skasowanych razem z PWA. Dokument ze ścieżką, której nie da się otworzyć,
jest gorszy niż jego brak — czytelnik nie wie, która część opisu jest jeszcze
prawdziwa. Ten skrypt łapie to automatycznie, a nie okiem.
"""
import glob
import os
import re
import sys

DOCS = ["README.md", "DEPLOY.md", "android/README.md", "instalator/README.md"] + sorted(
    glob.glob("docs/*.md")
)

# Ścieżki, których BRAK jest poprawny: artefakty builda i plik dostarczany
# ręcznie (licencja Honeywella nie pozwala go trzymać w repo).
ALLOWED_MISSING = {
    "server/dist",
    "android/app/libs/honeywell-datacollection.aar",
    "android/app/build/outputs/apk/debug",
}

# Byty usunięte z kodu — odwołanie do nich w dokumentacji znaczy, że opis
# zestarzał się względem repo.
REMOVED = [
    "api/mm",          # MM ad-hoc z karty towaru
    "SFERA_MODE",      # tryb zapisu wynika dziś z SGT_MODE
    "web/src/",        # klient PWA
    "MMScreen",
    "all_mgp",         # sesja „całe MGP"
    "PutawayZone",     # strefa źródłowa w trybie B
    "mag.xlsx",        # właściwa nazwa eksportu to magmat.xlsx
    "wyłącznie tryb B",
    "10 ekran",
]

PATH_RE = re.compile(
    r"(?<![\w./-])((?:server|android|web|docs|tools|instalator|\.github)/[\w./-]*[\w/])"
)


def main() -> int:
    bad = 0
    for doc in DOCS:
        text = open(doc, encoding="utf-8").read()
        base = os.path.dirname(doc)
        for m in PATH_RE.finditer(text):
            p = m.group(1).rstrip(".,;:)")
            if p in ALLOWED_MISSING:
                continue
            # ścieżki w docs/*.md bywają względne do repo, nie do katalogu
            if os.path.exists(p) or os.path.exists(os.path.join(base, p)):
                continue
            print(f"MARTWA ŚCIEŻKA  {doc} → {p}")
            bad += 1
        # Sekcja opisująca, co zniknęło, MA prawo nazywać usunięte byty po
        # imieniu — po to istnieje. Reszta dokumentu nie.
        #
        # Zwolnienie jest JAWNE: komentarz `<!-- docs_check: historia -->`
        # otwiera je, a następny nagłówek zamyka. Wcześniej dopasowywało się do
        # słowa „różni" w nagłówku, co działało dla jednej sekcji i milcząco
        # przestałoby działać przy jej przemianowaniu — zwolnienie musi być
        # widoczne w miejscu, w którym się z niego korzysta.
        heading = ""
        historia = False
        for i, line in enumerate(text.splitlines(), 1):
            if line.startswith("#"):
                heading = line
                historia = False
            if "docs_check: historia" in line:
                historia = True
            if historia or "różni" in heading:
                continue
            for token in REMOVED:
                if token in line:
                    print(f"USUNIĘTY BYT    {doc}:{i} → {token}")
                    bad += 1

    # Liczby, które dokumentacja podaje wprost. Zestarzeją się przy pierwszym
    # nowym ekranie, jeśli nikt ich nie porówna z kodem.
    nav = open("android/core/src/main/kotlin/pl/wertis/kolektor/core/nav/NavModel.kt", encoding="utf-8").read()
    body = re.sub(r"//[^\n]*", "", re.search(r"enum class Screen \{(.*?)\n\}", nav, re.S).group(1))
    screens = len([s for s in body.replace("\n", " ").split(",") if s.strip()])
    tests = sum(open(f, encoding="utf-8").read().count("@Test")
                for f in glob.glob("android/core/src/test/**/*.kt", recursive=True))

    checked = 0
    for doc in ("README.md", "android/README.md"):
        text = open(doc, encoding="utf-8").read()
        for claimed, unit in re.findall(r"(\d+)\s+(ekran\w*|test\w*)", text):
            actual = screens if unit.startswith("ekran") else tests
            if int(claimed) != actual:
                print(f"ZŁA LICZBA      {doc} → „{claimed} {unit}\", w kodzie {actual}")
                bad += 1
            else:
                checked += 1

    print(f"\nzweryfikowanych liczb w dokumentacji: {checked}")
    print(f"stan kodu: ekrany={screens}, pliki routes={len(glob.glob('server/src/routes/*.ts'))}, testy :core={tests}")
    print("OK — dokumentacja spójna z repo" if not bad else f"\n{bad} rozbieżności")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
