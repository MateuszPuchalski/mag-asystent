#!/usr/bin/env python3
"""Kontrola stylu dokumentacji — mierzalna część reguł z `docs/slownik.md`.

Dokumentacja WERTIS trzyma się reguł ASD-STE100 w zakresie, jaki da się
przenieść na polski. Reguły opisuje `docs/slownik.md`; ten skrypt mierzy trzy
z nich:

    * długość zdania      — 20 wyrazów w kroku procedury, 25 w prozie,
    * długość akapitu     — najwyżej 6 zdań,
    * słowniczek          — odrzucone warianty terminów.

CZEGO TEN SKRYPT NIE MIERZY, a co jest regułą: „jedna instrukcja = jedno
zdanie", strony czynnej i kolejności ostrzeżeń względem kroku. Tego pilnuje
człowiek przy przeglądzie.

To ta sama lekcja, co `-DryRun` w `instalator/README.md`: narzędzie ma mówić,
czego NIE dowodzi. Zielony wynik nie znaczy, że tekst jest dobry — znaczy, że
nie łamie trzech mierzalnych reguł.

Skrypt istnieje, bo bez pomiaru styl wraca do stanu wyjściowego przy pierwszym
PR. Dokładnie tak zestarzało się `docs/analiza-rozkladanie.md` względem kodu,
zanim powstał `docs_check.py`.
"""
import json
import os
import re
import sys

# Trzy dokumenty są POZA zakresem, bo w całości są uzasadnieniami decyzji:
# docs/architektura.md, docs/porownanie-asystent.md, CHANGELOG.md. Limit
# długości zdania wyciąłby z nich dokładnie tę treść, dla której powstały.
DOCS = [
    "README.md",
    "DEPLOY.md",
    "android/README.md",
    "instalator/README.md",
    "docs/slownik.md",
    "docs/adresy-do-poprawy.md",
    "docs/analiza-rozkladanie.md",
    "docs/subiekt-gt-edu-setup.md",
    "docs/subiekt-gt-struktura.md",
    # Dekalog obsługi klienta: ten sam powód co przy dekalogu ergonomii.
    # Czyta go człowiek PRZED zmianą, żeby rozstrzygnąć spór o kształt drogi
    # klienta przez cztery kolejki. Zdanie na trzy linijki przekonuje tam tyle,
    # co reguła bez zakresu.
    "docs/obsluga-klienta-calosc.md",
    # Dekalog ergonomii: czyta go człowiek przed zmianą ekranu i po niej.
    # Dokument o dyscyplinie, który sam łamie limit zdania, przekonuje tyle,
    # co komentarz „zgodnie z wersją monorepo".
    "docs/ergonomia-magazynu.md",
    # Katalog scenariuszy testowych: 66 pozycji, każdą czyta się osobno i pod
    # ekranem. Długie zdanie kosztuje tu tyle samo, co w instrukcji wdrożenia.
    "docs/scenariusze-testowe.md",
    # Procedura wdrożenia wchodzi tu z tego samego powodu co DEPLOY: wykonuje ją
    # człowiek pod presją, na cudzej maszynie, często pierwszy raz.
    "docs/wdrozenie.md",
    # Ustalenia o COM Sfery czyta się przy maszynie klienta, obok otwartej
    # konsoli. Ten sam powód co przy opisie struktury Subiekta.
    "docs/sfera-com.md",
]

SLOWNIK = "docs/slownik.md"

LIMIT_KROK = 20      # punkt numerowany albo pozycja checklisty (STE 6.4)
LIMIT_PROZA = 25     # zdanie opisowe (STE 6.5)
LIMIT_AKAPIT = 6     # zdań w akapicie (STE 6.2)

KROK_RE = re.compile(r"^\s*(?:\d+\.\s|[-*]\s\[[ xX]\]\s)")
# Każda pozycja listy jest osobnym akapitem. Bez tego lista ośmiu punktów
# wyglądałaby jak jeden akapit o dwudziestu zdaniach i limit 6 nie miałby sensu.
POZYCJA_RE = re.compile(r"^\s*(?:\d+\.\s|[-*+]\s)")
SKROTY = ("np.", "itd.", "itp.", "tj.", "tzn.", "ok.", "ww.", "art.", "str.",
          "min.", "godz.", "sek.", "ang.", "por.", "zob.", "m.in.")


def wczytaj_odrzucone() -> dict:
    """Odrzucone warianty terminów — z tabeli słowniczka, nie z tego pliku.

    Lista mieszka tam, gdzie autor tekstu ją czyta. Kopia w skrypcie
    rozjechałaby się ze słowniczkiem przy pierwszym nowym terminie.
    """
    # Gwiazdka w tabeli zastępuje końcówkę fleksyjną: „pol* dodatkow*" łapie
    # „pole dodatkowe", „polu dodatkowym" i „pól dodatkowych". Polska odmiana
    # zrobiłaby z listy wariantów tabelę odmiany przez przypadki.
    odrzucone = {}
    w_tabeli = False
    for line in open(SLOWNIK, encoding="utf-8"):
        if line.startswith("| termin "):
            w_tabeli = True
            continue
        if w_tabeli:
            if not line.startswith("|"):
                break
            kol = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(kol) < 3 or set(kol[0]) <= set("-: "):
                continue
            termin = kol[0].replace("*", "").split(",")[0].strip()
            for zly in kol[2].split(","):
                zly = zly.strip()
                if zly:
                    odrzucone[zly.lower()] = termin
    return odrzucone


def dopelnij(nowy: str, stary: str) -> str:
    """Podmiana o TEJ SAMEJ długości — po niej offset dalej wskazuje tę linię.

    Numer linii wyliczamy z offsetu w oczyszczonym tekście, więc każde cięcie
    musi zachować długość. Inaczej skrypt pokazywałby błąd w złej linii, a to
    najszybszy sposób na narzędzie, któremu przestaje się wierzyć.
    """
    return (nowy + " " * len(stary))[:len(stary)]


def bez_szumu(tekst: str) -> str:
    """Zostawia sam tekst do policzenia: bez kodu, linków i markdownu."""
    # kod w linii liczy się jako jeden wyraz
    tekst = re.sub(r"`[^`]*`", lambda m: dopelnij("KOD", m.group(0)), tekst)
    tekst = re.sub(r"\[([^\]]*)\]\([^)]*\)",
                   lambda m: dopelnij(m.group(1), m.group(0)), tekst)
    tekst = re.sub(r"[*_#>]", " ", tekst)
    return tekst


def bez_nazw_ui(tekst: str) -> str:
    """To samo, ale bez **pogrubień** — do sprawdzania słowniczka.

    Nazwę elementu interfejsu pisze się w tej dokumentacji pogrubieniem
    (**Pola dodatkowe**, **ZAŁÓŻ KONTA**). To cytat z ekranu, nie nasze
    słownictwo: zakładka Subiekta nazywa się tak, jak się nazywa, i instrukcja
    musi kazać kliknąć w to, co czytelnik widzi. Długość zdania liczy się
    normalnie — wycięcie dotyczy wyłącznie słowniczka.
    """
    return re.sub(r"\*\*[^*]*\*\*", lambda m: " " * len(m.group(0)), tekst)


def zdania(tekst: str):
    """Dzieli na zdania, zwracając (zdanie, offset). Nie tnie na skrótach."""
    # Znacznik pozycji listy („1. ", „- ") nie jest zdaniem. Wycinamy go, żeby
    # nie liczył się jako osobne zdanie w akapicie.
    m = POZYCJA_RE.match(tekst)
    if m:
        tekst = " " * m.end() + tekst[m.end():]

    # Dwukropek NIE kończy zdania. Zdanie „Robi trzy rzeczy: A, B i C." jest
    # jedno i tak trzeba je liczyć — inaczej limit długości omijałoby się
    # dwukropkiem, a akapit o czterech zdaniach wyglądałby na siedem.
    out, start = [], 0
    for m in re.finditer(r"(?<=[.!?])\s+", tekst):
        do = m.start()
        przed = tekst[:do]
        if any(przed.endswith(s) for s in SKROTY):
            continue
        frag = tekst[start:do].strip()
        if frag:
            out.append((frag, start))
        start = m.end()
    frag = tekst[start:].strip()
    if frag:
        out.append((frag, start))
    return out


def wyrazy(zdanie: str) -> int:
    return len([w for w in zdanie.split() if any(c.isalnum() for c in w)])


def akapity(sciezka: str):
    """Akapity prozy: (linie, czy_procedura). Bez kodu, tabel i obrazków.

    Cytowane komunikaty aplikacji („Nie widzę serwera pod adresem…") zostają —
    są częścią zdania i tak samo się je czyta.
    """
    biezacy, w_kodzie = [], False
    for nr, raw in enumerate(open(sciezka, encoding="utf-8"), 1):
        line = raw.rstrip("\n")
        if line.lstrip().startswith("```"):
            w_kodzie = not w_kodzie
            if biezacy:
                yield biezacy
                biezacy = []
            continue
        if w_kodzie:
            continue
        if not line.strip() or line.lstrip().startswith("|"):
            if biezacy:
                yield biezacy
                biezacy = []
            continue
        if POZYCJA_RE.match(line) and biezacy:
            yield biezacy
            biezacy = []
        biezacy.append((nr, line))
    if biezacy:
        yield biezacy


# ── Numer wydania w komentarzu kodu ──────────────────────────────────────────
# Komentarz mówi, dlaczego kod jest taki, jaki jest. Numer wydania mówi, kiedy
# się taki stał, a to jest historia: mieszka w CHANGELOG.md i w gicie.
# Zdanie „od 0.NN.0 robimy X" przestaje być potrzebne w dniu zmiany, a zostaje
# w kodzie i wygląda na regułę.
#
# ZAPADKA, NIE ZAKAZ. W dniu wprowadzenia bramki komentarze niosły kilkaset
# numerów. Próg per plik stoi w WERSJE_PROG i może tylko maleć. Plik z nowym
# numerem zatrzymuje CI. Plik z mniejszą liczbą niż próg też, bo inaczej
# próg zostałby na starej wysokości i dopuścił nowy numer w miejsce starego.
# Obniżenie progu: `python3 tools/styl_check.py --zapisz-wersje`.
#
# `@wydanie` liczy się jak numer, bo automat wydania zamienia go na numer
# w całym repozytorium. Bez tego próg przekroczyłoby dopiero scalenie.
WERSJE_PROG = "tools/wersje_w_komentarzach.json"
WERSJE_KATALOGI = ["server/src", "panel/src", "android", "sfera-worker", "tlo-worker"]
WERSJE_ROZSZERZENIA = (".ts", ".tsx", ".kt", ".kts", ".cs", ".sql")
WERSJE_POMIJANE = ("node_modules", "/build/", "/bin/", "/obj/", "/dist/")
# Bez cyfry ani kropki po bokach, bo `127.0.0.1` i `0.0.0.0` to adresy, nie wydania.
WERSJA_RE = re.compile(r"(?<![\d.])0\.\d{1,3}\.(?:\d{1,3}|x)\b(?!\.\d)|@wydanie")


def komentarz(linia: str, sql: bool) -> str:
    """Część linii, która jest komentarzem — w przybliżeniu, bez parsera.

    Liczy się linia zaczęta znakiem komentarza i ogon po ` // `, ` /* `
    albo ` -- `. Numer w napisie w kodzie (test porównania wersji) nie jest
    komentarzem i nie wchodzi do liczby.
    """
    s = linia.strip()
    poczatki = ("--",) if sql else ("//", "/*", "*", "{/*")
    if s.startswith(poczatki):
        return s
    for znak in ((" -- ",) if sql else (" // ", " /* ", "{/* ")):
        i = linia.find(znak)
        if i >= 0:
            return linia[i:]
    return ""


def policz_wersje() -> dict:
    wynik = {}
    for katalog in WERSJE_KATALOGI:
        for korzen, _, pliki in os.walk(katalog):
            if any(p in korzen + "/" for p in WERSJE_POMIJANE):
                continue
            for nazwa in pliki:
                if not nazwa.endswith(WERSJE_ROZSZERZENIA):
                    continue
                sciezka = os.path.join(korzen, nazwa).replace(os.sep, "/")
                sql = nazwa.endswith(".sql")
                ile = 0
                with open(sciezka, encoding="utf-8", errors="replace") as f:
                    for linia in f:
                        ile += len(WERSJA_RE.findall(komentarz(linia, sql)))
                if ile:
                    wynik[sciezka] = ile
    return dict(sorted(wynik.items()))


def sprawdz_wersje_w_komentarzach(zapisz: bool) -> int:
    teraz = policz_wersje()
    if zapisz:
        with open(WERSJE_PROG, "w", encoding="utf-8") as f:
            json.dump(teraz, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"próg numerów w komentarzach zapisany: {sum(teraz.values())}")
        return 0
    prog = json.load(open(WERSJE_PROG, encoding="utf-8"))
    bad = 0
    for sciezka in sorted(set(teraz) | set(prog)):
        n, p = teraz.get(sciezka, 0), prog.get(sciezka, 0)
        if n > p:
            print(f"NUMER WYDANIA   {sciezka} → {n} w komentarzach, próg {p}.")
            print("                Komentarz mówi dlaczego, nie od kiedy. Historia: CHANGELOG.md.")
            bad += 1
        elif n < p:
            print(f"OBNIŻ PRÓG      {sciezka} → {n}, próg {p}. Uruchom:")
            print("                python3 tools/styl_check.py --zapisz-wersje")
            bad += 1
    print(f"numerów wydań w komentarzach kodu: {sum(teraz.values())} (próg {sum(prog.values())})")
    return bad


def main() -> int:
    odrzucone = wczytaj_odrzucone()
    if not odrzucone:
        print(f"BŁĄD            {SLOWNIK} — nie udało się wczytać słowniczka")
        return 1

    bad = 0
    najdluzsze = 0
    zdan = 0
    for doc in DOCS:
        for akapit in akapity(doc):
            # Numer linii z offsetu: akapit sklejamy spacjami, więc offset
            # rośnie o długość linii + 1.
            tekst, mapa, off = "", [], 0
            for nr, line in akapit:
                mapa.append((off, nr))
                tekst += line + " "
                off += len(line) + 1
            czysty = bez_szumu(tekst)
            terminy = bez_szumu(bez_nazw_ui(tekst))
            zs = zdania(czysty)
            zdan += len(zs)

            czy_krok = KROK_RE.match(akapit[0][1]) is not None
            limit = LIMIT_KROK if czy_krok else LIMIT_PROZA
            for zdanie, offset in zs:
                nr = [n for o, n in mapa if o <= offset][-1]
                n = wyrazy(zdanie)
                najdluzsze = max(najdluzsze, n)
                if n > limit:
                    print(f"DŁUGIE ZDANIE   {doc}:{nr} → {n} wyrazów (limit {limit})")
                    print(f"                {zdanie[:90]}…")
                    bad += 1
            if len(zs) > LIMIT_AKAPIT:
                print(f"DŁUGI AKAPIT    {doc}:{akapit[0][0]} → {len(zs)} zdań (limit {LIMIT_AKAPIT})")
                bad += 1

            for zly, dobry in odrzucone.items():
                wzor = re.escape(zly).replace(r"\*", r"[\w]*")
                for m in re.finditer(wzor, terminy, re.I):
                    nr = [n for o, n in mapa if o <= m.start()][-1]
                    print(f"ODRZUCONY TERMIN {doc}:{nr} → „{zly}\", ma być „{dobry}\"")
                    bad += 1

    bad += sprawdz_wersje_w_komentarzach("--zapisz-wersje" in sys.argv)

    print(f"\nzdań: {zdan}, najdłuższe: {najdluzsze} wyrazów, "
          f"dokumentów: {len(DOCS)}, terminów w słowniczku: {len(odrzucone)}")
    print("OK — styl zgodny z docs/slownik.md" if not bad else f"\n{bad} rozbieżności")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
