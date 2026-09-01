#!/usr/bin/env python3
"""Kontrola spójności dokumentacji z kodem.

Powstało po tym, jak `docs/analiza-rozkladanie.md` przez kilka PR-ów odsyłał do
plików skasowanych razem z PWA. Dokument ze ścieżką, której nie da się otworzyć,
jest gorszy niż jego brak — czytelnik nie wie, która część opisu jest jeszcze
prawdziwa. Ten skrypt łapie to automatycznie, a nie okiem.
"""
import glob
import json
import os
import re
import sys

DOCS = [
    "README.md",
    "DEPLOY.md",
    "CHANGELOG.md",
    "android/README.md",
    "instalator/README.md",
] + sorted(glob.glob("docs/*.md"))

# Ścieżki, których BRAK jest poprawny: artefakty builda i plik dostarczany
# ręcznie (licencja Honeywella nie pozwala go trzymać w repo).
ALLOWED_MISSING = {
    "server/dist",
    "android/app/libs/honeywell-datacollection.aar",
    "android/app/build/outputs/apk/debug",
    # baza powstaje przy `npm run seed`; w świeżym klonie (i w CI) jej nie ma,
    # ale instrukcja resetu musi móc nazwać plik po imieniu
    "server/data/wertis.db",
    # cache zdjęć kartotek — powstaje przy pierwszym otwarciu karty, w świeżym
    # klonie go nie ma, ale dokumentacja musi móc nazwać katalog po imieniu
    "server/data/zdjecia/",
    # APK dla kolektorów — kładzie go instalator przy aktualizacji, w świeżym
    # klonie go nie ma, a dokumentacja musi móc nazwać katalog po imieniu
    "server/data/apk/",
    # Inwentarz obsługi klienta — skasowany w 0.138.0 razem z kodem, który
    # opisywał. Wpisy CHANGELOG-a od 0.128.0 do 0.137.1 nazywają go po imieniu
    # i mają do tego prawo: opisują wydania, w których ten plik istniał.
    "docs/architektura-spraw.md",
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
    "10 ekran",
    # Sesje rozkładania i tryb kontenerowy — wycięte w 0.22.0. Kontener rozkłada
    # się dziś jak każda inna dostawa, a przesunięcie stanu jest osobną
    # operacją (`services/przesuniecie.ts`). Tokeny są IDENTYFIKATORAMI, nie
    # polskimi słowami: „kontener" jako przedmiot ma prawo zostać w prozie,
    # instrukcja każąca zatwierdzić wózek — nie.
    "putaway_sessions",
    "putaway_items",
    "api/putaway/",
    "listPutawayDocuments",
    "commitCart",
    "scanToCart",
    "closeSession",
    "PutawaySession",
    "PUTAWAY_DOCS",
    "PUTAWAY_SESSION",
    "walkMode",
    # „13 ekran" stało tu od 0.22.0, gdy sesja rozkładania zabrała ekran
    # i liczba wróciła do dwunastu. W 0.75.0 kolektor ma trzynasty naprawdę
    # (zakładka ZWROTY), więc token przestał znaczyć „usunięty byt".
    # Blokady pozycji i rola brygadzisty — wycięte w 0.47.0. Jedną dostawę
    # rozkłada tu jedna osoba, więc lock nie rozstrzygał żadnego sporu, a rola
    # istniała głównie po to, żeby móc cudzą pozycję odebrać. Tokeny są
    # IDENTYFIKATORAMI, nie polskimi słowami: „blokada" w prozie o historii ma
    # prawo zostać, instrukcja każąca odebrać pozycję koledze — nie.
    "services/locks.ts",
    "locked_by",
    "locked_at",
    "forceReleaseLine",
    "zdjecie_cudzego_locka",
    "lock_forced",
    "/force-release",
    # Flaga sprawdzenia faktury — wycięta w 0.16.0 razem z prawem zapisu do
    # `fl_Wartosc`. Tokeny są identyfikatorami, nie polskim słowem „flaga":
    # historia i uzasadnienie decyzji mogą o niej mówić prozą, ale instrukcja
    # każąca cokolwiek ustawić albo nadać ma zapalić się na czerwono.
    "DOC_FLAG_",
    "MSSQL_FLAG_",
    "fl_Wartosc",
    "fl__Flagi",
    # Zwroty koszykami i klucz wiersza faktury — wycięte w 0.17.0. Ta sama
    # zasada co wyżej: identyfikatory, nie polskie słowa. „Zwrot" jako pojęcie
    # magazynowe zostaje (jest magazyn Zwroty), ale instrukcja każąca ustawić
    # `DOK_TYP_ZWROTY` albo domknąć koszyk ma się zapalić na czerwono.
    "set_doc_flag",
    "DOK_TYP_ZWROTY",
    "MSSQL_POZ_ID_COLUMN",
    "sgt_pozycje",
    "closeBasket",
    "koszyk_bez_mm",
    # Logowanie plakietką i PIN — wycięte w 0.20.0. Znowu identyfikatory:
    # „plakietka" jako przedmiot i historia decyzji mogą zostać prozą, ale
    # instrukcja każąca zeskanować badge, wydrukować kod albo podać PIN
    # w żądaniu ma się zapalić na czerwono.
    "auth/badge",
    "badgeCode",
    "badge_code",
    "PRC-",
    "parseBadge",
    "cyfraKontrolna",
    "looksLikeBadge",
    "pinAutora",
    "hashPin",
    "auth/handover",
    # Tryb serwisowy — wprowadzony w 0.23.0 i wycofany w 0.24.0, po jednym
    # wydaniu. Konto admina zakłada dziś instalator, a logowanie odbywa się jak
    # każde inne. Ta sama zasada co wyżej: wpis w CHANGELOG-u opisujący, co było
    # i dlaczego wyszło, stoi pod `docs_check: historia`; instrukcja każąca
    # cokolwiek ustawić ma się zapalić na czerwono.
    "WERTIS_ADMIN",
    "tryb_serwisowy_start",
    "przyjmijTrybSerwisowy",
    "TrybSerwisowyBanner",
    "adminMode",
]

PATH_RE = re.compile(
    r"(?<![\w./-])((?:server|android|web|docs|tools|instalator|\.github)/[\w./-]*[\w/])"
)


def sprawdz_wersje() -> int:
    """Wersja ma JEDNO źródło i musi być opisana w CHANGELOG-u.

    `0.3.0` przetrwało sześć zmergowanych zmian, bo numer stał w trzech
    miejscach, a zgodność pilnował komentarz „zgodnie z wersją monorepo".
    Komentarz nie jest mechanizmem — to jest.
    """
    bad = 0
    wersja = json.load(open("package.json", encoding="utf-8"))["version"]

    srv = json.load(open("server/package.json", encoding="utf-8"))["version"]
    if srv != wersja:
        print(f"ZŁA WERSJA      server/package.json → {srv}, w korzeniu {wersja}")
        bad += 1

    # Plik blokady niesie własną kopię numeru w DWÓCH miejscach i `npm ci`
    # jej nie poprawia. Rozjazd nie psuje instalacji, ale kłamie: wersja
    # w blokadzie została na 0.145.1 przez trzy podbicia i wyszła dopiero przy
    # czytaniu repo po awarii. Repo ma na to precedens — commit „Plik blokady
    # dogania wersję 0.145.0" — a precedens bez mechanizmu wraca.
    blok = json.load(open("package-lock.json", encoding="utf-8"))
    for gdzie, wpis in (("", blok), ('packages[""]', blok.get("packages", {}).get("", {}))):
        wblok = wpis.get("version")
        if wblok is not None and wblok != wersja:
            etykieta = f"package-lock.json {gdzie}".strip()
            print(f"ZŁA WERSJA      {etykieta} → {wblok}, w korzeniu {wersja}")
            print("                napraw: npm install --package-lock-only")
            bad += 1

    # Android czyta package.json przy budowaniu; pilnujemy, że NADAL czyta,
    # a nie że ktoś w pośpiechu wpisał numer z powrotem na sztywno.
    gradle = open("android/app/build.gradle.kts", encoding="utf-8").read()
    if "versionName = wersjaMonorepo" not in gradle:
        print("ZŁA WERSJA      android/app/build.gradle.kts nie czyta wersji z package.json")
        bad += 1

    changelog = open("CHANGELOG.md", encoding="utf-8").read()
    if f"## {wersja}" not in changelog:
        print(f"BRAK WPISU      CHANGELOG.md nie opisuje wersji {wersja}")
        bad += 1

    print(f"wersja: {wersja}")
    return bad


STRUKTURA = "docs/subiekt-gt-struktura.md"

# Dokumenty, w których liczy się znaczniki `[WERYFIKUJ]`. Do 0.148.0 był tu
# wyłącznie `STRUKTURA` — i to była dziura: `panel-obslugi-klienta.md` §8.2 każe
# kierować do TEGO SAMEGO licznika znaczniki z mapowania Allegro, a te siedzą
# w `allegro-ksztalt.md`. Znacznik postawiony poza jednym plikiem przechodził
# więc bez żadnej kontroli, czyli dokładnie tam, gdzie licznik miał pracować.
#
# Deklaracja zostaje w preambule `STRUKTURA` i obejmuje sumę z obu plików:
# jedno zdanie o tym, ile rzeczy czeka na sprawdzenie, jest łatwiejsze do
# utrzymania niż dwa, które trzeba dodać w pamięci.
SKANOWANE_ZNACZNIKI = [STRUKTURA, "docs/allegro-ksztalt.md"]

# Liczebniki, którymi preambuła może wyrazić liczbę rzeczy do ustalenia.
LICZEBNIKI = {
    "zero": 0, "jedna": 1, "dwie": 2, "trzy": 3, "cztery": 4,
    "pięć": 5, "sześć": 6, "siedem": 7, "osiem": 8, "dziewięć": 9,
}

# Znacznik otwierający akapit — taka jest konwencja tego dokumentu. Wystąpienie
# w środku zdania (jak w samej preambule) NIE jest pozycją do ustalenia.
ZNACZNIK_RE = re.compile(r"^`\[WERYFIKUJ\]`", re.MULTILINE)
# Dwie formy, bo polszczyzna wymaga innej przy trzech, a innej przy sześciu:
# „zostały trzy", ale „zostało sześć". Zamknięcie regexu na jednej z nich
# kazałoby wybierać między zielonym testem a poprawnym zdaniem.
DEKLARACJA_RE = re.compile(r"takich rzeczy (?:zostały|zostało) (\w+)")


def sprawdz_licznik_weryfikuj() -> int:
    """Preambuła `struktura.md` deklaruje liczbę rzeczy do ustalenia.

    Ta liczba rozjechała się już raz: dokument mówił „cztery", a znaczników było
    pięć. Rozjazd powstał przy dopisaniu sekcji i nikt go nie zauważył, bo liczbę
    w prozie pilnowało wyłącznie oko.

    To ten sam gatunek zgnilizny, dla którego powstał cały ten skrypt — więc
    dostaje ten sam rodzaj odpowiedzi.
    """
    text = open(STRUKTURA, encoding="utf-8").read()
    m = DEKLARACJA_RE.search(text)
    if not m:
        print(f"BRAK DEKLARACJI {STRUKTURA} nie mówi, ile rzeczy zostało do ustalenia")
        return 1

    slowo = m.group(1)
    if slowo not in LICZEBNIKI:
        print(f"ZŁY LICZEBNIK   {STRUKTURA}: {slowo!r} - dopisz go do LICZEBNIKI")
        return 1

    zadeklarowane = LICZEBNIKI[slowo]
    faktyczne = sum(
        len(ZNACZNIK_RE.findall(open(doc, encoding="utf-8").read()))
        for doc in SKANOWANE_ZNACZNIKI
    )
    if zadeklarowane != faktyczne:
        print(
            f"ZŁY LICZNIK     {STRUKTURA}: preambula mowi {slowo!r} "
            f"({zadeklarowane}), a znacznikow [WERYFIKUJ] jest {faktyczne}"
        )
        return 1

    print(f"znaczników [WERYFIKUJ]: {faktyczne} — zgodne z preambułą")
    return 0


def main() -> int:
    bad = sprawdz_wersje() + sprawdz_licznik_weryfikuj()
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
    # bez *.test.ts — od kiedy trasy mają własne testy, zwykły glob liczył je
    # jako trasy i statystyka kłamała o dwie pozycje
    routes = [f for f in glob.glob("server/src/routes/*.ts") if not f.endswith(".test.ts")]
    print(f"stan kodu: ekrany={screens}, pliki routes={len(routes)}, testy :core={tests}")
    print("OK — dokumentacja spójna z repo" if not bad else f"\n{bad} rozbieżności")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
