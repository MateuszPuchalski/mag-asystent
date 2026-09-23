# WERTIS — zasady pracy w tym repo

Magazynowo-biurowy asystent firmy ogrodniczej: serwer Fastify + `node:sqlite`
(`server/`), panel biura (`panel/`, React + Vite, pod `/obsluga`; dawny
`biuro.html` zniknął w 0.446.0), kolektor Android (`android/`). Architektura i decyzje:
`docs/architektura.md`. Ten plik mówi tylko, CZEGO pilnować przy zmianach.

## Twarde zasady

- **Komentarze po polsku i wyjaśniają DLACZEGO**, nie co robi następna linia.
  Decyzja bez uzasadnienia w komentarzu to decyzja do wycofania.
- **Jeden front: `panel/`.** Od 0.431.0, decyzją właściciela z
  `docs/obsluga-klienta.md` §7, całe biuro mieszka w `panel/` (React + Vite,
  build do `dist/web/obsluga`). Przeprowadzka skończyła się w 0.446.0:
  `biuro.html` zniknął, a `/` i `/biuro` przekierowują do `/obsluga/`.
  Drugiego frontu nie ma i nie będzie — nowy ekran biura, magazynowy czy
  obsługi, idzie do `panel/`. Kształt ekranu wynika z celu biura (§7): praca
  na górnym rzędzie, wgląd na dolnym, ustawienia za zębatką. Gwarancje
  strażników `biuro.html` przejęły testy ekranów panelu, każdy nazwany
  w wydaniu, które przeniosło jego widok.
- **Ekran magazynowy projektuje się pod ergonomię, nie pod wygląd.** Reguły
  stoją w `docs/ergonomia-magazynu.md`. Rozstrzygają spór o kształt ekranu na
  korzyść tego, który wymaga mniej decyzji, mniej interakcji, mniej uwagi,
  mniej pamiętania, mniej ruchu i mniej błędów. Uroda liczy się dopiero po
  tamtym. Mierzalną część — cele dotyku na kolektorze — bramkuje
  `tools/ergonomia_check.py`: cel mniejszy niż 48 dp wymaga komentarza
  `ergonomia: <powód>` przy łańcuchu, bo zwolnienie bez uzasadnienia to
  brak zwolnienia. Dekalog obowiązuje kolektor; biuro i panel obsługi biorą
  z niego punkty 1, 2, 5, 6 i 10, bo mysz na blacie to nie kciuk w rękawicy.

- **Obsługę klienta projektuje się jako JEDNĄ drogę, nie cztery kolejki.**
  Reguły stoją w `docs/obsluga-klienta-calosc.md`. Rozstrzygają spór o kształt
  na korzyść tego, który daje agentowi całą historię klienta w jednym miejscu.
  Kolejki — skrzynka, zwroty, reklamacje, dyskusje — są NASZE, nie jego.
  Dokładając kolejkę albo ekran, dopisujesz ją do `services/droga-klienta.ts`:
  wiązania po numerze zamówienia w obie strony. Wiązanie jednostronne to
  wiązanie, którego nie ma. Po loginie rozmówcy nie wiąż niczego NOWEGO, dopóki
  stoi przy nim `[WERYFIKUJ]` w `docs/allegro-ksztalt.md` — blizna 0.56.6 mówi,
  że bywa zamaskowany, a dwie funkcje już po nim chodzą. Piątej tabeli ze
  wspólnym statusem nad kolejkami nie było i nie będzie — ten kształt kosztował
  już cztery tabele nakładki spraw.

- **Reguła klienta HTTP obowiązuje KAŻDY front z osobna.** Żądanie bez ciała
  nie deklaruje typu treści — pusty JSON to `FST_ERR_CTP_EMPTY_JSON_BODY`
  i gołe „Bad Request" na ekranie. Pilnują tego dwie niezależne strażnice:
  `panel/src/api/klient.test.ts` (po zachowaniu) i `EMPTY_BODY` w kolektorze.
  Trzecia, po źródle `biuro.html`, odeszła z tą stroną. Panel obsługi kupił
  tę bliznę drugi raz, bo strażnik istniał tylko dla jednego pliku.
  Dokładając front, dokładasz też jego strażnika.
- **Zero zapisu przy patrzeniu.** Otwarcie ekranu niczego nie mutuje.
  Pilnują tego testy ekranów (`ekrany/*.test.tsx`): liczą żądania inne niż
  GET przy samym otwarciu i oczekują zera. Nowy ekran dostaje taki test —
  bez niego reguła nie ma strażnika. Do 0.446.0 umową były też liczniki
  zapisów po źródle `biuro.html`; odeszły razem z tą stroną.
  Od 0.410.0 jest JEDEN wyjątek, decyzją właściciela: wejście w reklamację
  odświeża ją z Allegro. Powód jest mierzalny — przebieg synchronizacji czyta
  najwyżej tysiąc spraw, więc ogona archiwum nie odświeżał NIGDY. Wyjątek
  bramkuje `ekrany/Reklamacje.test.tsx`: dozwolona jest dokładnie jedna
  mutacja przy wejściu i ani jedna przy samym otwarciu ekranu.
- **Cienkie trasy, logika w serwisach** z testem obok (`*.test.ts`,
  `tsx --test`). Każda mutacja woła `logEvent`. Bramka ról: `odmowa()`
  w trasach biura, `autoryzuj()` przy operacjach uprzywilejowanych.
- **Tickery wyłącznie w `main()`**, nigdy w `buildApp()` (testy tras nie
  strzelają do Allegro). Wszystkie idą przez `uruchomTakt` z `services/takt.ts`
  (rozrzut, respekt dla 429); lista stoi w `main()` w `index.ts`.
- **Prywatność:** adres DOSTAWY przechodzi przez mapowanie od 0.422.0,
  decyzją właściciela, i to jest wyjątek, nie nowa zasada. Wchodzą cztery pola
  `delivery.address` — ulica, miasto, kod i telefon — plus nazwa odbiorcy
  od 0.367.0. Telefon dostaje drugą kolumnę z samymi cyframi, bo szuka się po
  końcówce numeru. Dalej NIE przechodzą: `invoice.address`, cokolwiek
  z `buyer`, e-mail, PESEL i konto bankowe. Lądowisko `surowe_json` nie
  dostaje nic z adresu, a raport sondy kształtu tych pól nie pokazuje — raport
  wchodzi do repo, baza zostaje w biurze. Zakres i powód stoją w
  `docs/obsluga-klienta.md` — dokładając cokolwiek z adresu, dopisujesz tam
  własne uzasadnienie albo tego nie robisz. Pilnują tego testy przy mapowaniu
  zamówień i lista zakazanych członów w `migracja-zwrotow.test.ts`.
- **Kształt Allegro czyta się z pliku, nie z pamięci.** Specyfikacja leży
  w repo: `docs/allegro/swagger.yaml` (cudza, nietykalna — sumę pilnuje
  `tools/docs_check.py`). Czytaj SCHEMAT, nie przykład: przykłady Allegro bywają
  niezgodne z własnym schematem, a wymagalność pola mówi wyłącznie lista
  `required`. `public.v1` i `beta.v1` to bywają RÓŻNE kształty, nie warianty.
  Mapowanie z pamięci kosztowało już trzy wydania, a raz — skrzynkę, która
  przez dwa wydania nie zapisała ani jednego wątku.
- **`[WERYFIKUJ]`** znaczy: niezweryfikowane na żywym Allegro/Subiekcie.
  Licznik tych znaczników sprawdza `tools/docs_check.py` — dopisując lub
  zdejmując znacznik, zaktualizuj preambułę w `docs/subiekt-gt-struktura.md`.

## Wersje i wydania

- Wersja stoi w DWÓCH `package.json` (korzeń + `server/`) i musi być równa.
- Każde wydanie: wpis w `CHANGELOG.md` (MINOR = widoczna funkcja albo
  działanie przy wdrożeniu, PATCH = reszta), często akapit w `DEPLOY.md`.
- Commity po polsku, tytuł z numerem wersji.

## Zanim zaczniesz

Nad tym repo pracuje kilka sesji naraz — zdalnych gałęzi jest ponad trzydzieści.
Kosztowało to już dwa razy, na dwa różne sposoby. Statusy rozmowy powstały
DWA RAZY (0.157.0 i 0.158.0) i jedną implementację trzeba było wyrzucić
w całości przy scalaniu. Numery zderzały się jeszcze częściej: 0.159.0, potem
0.166.0, 0.168.0, 0.171.0 i 0.173.0 — cztery ostatnie jednego dnia.

```bash
sh tools/co_w_toku.sh    # hak SessionStart robi to sam; to jest droga ręczna
```

Skrypt pokazuje gałęzie z commitami spoza `main`, wersję `main` obok lokalnej
oraz **otwarte PR-y wraz z numerami, które już zajmują**. Numer nazwany
w cudzym otwartym PR-ze podnosi głośne ostrzeżenie. Lista PR-ów wymaga `gh`
w PATH; bez niego skrypt mówi, czego nie wie, i pracuje dalej.

**Numer wydania wybieraj przy COMMICIE, nie przy pisaniu kodu.** Wpisany
wcześniej do komentarzy kosztuje przenumerowanie kilkunastu plików, gdy
w międzyczasie zajmie go ktoś inny. Zdarzyło się to cztery razy w jeden dzień.

Gdy ktoś buduje TO SAMO: powiedz właścicielowi i **czekaj na decyzję, zanim
napiszesz linijkę kodu**. Jedna wymiana zdań kosztuje mniej niż wydanie do
wyrzucenia.

## Zanim wypchniesz

```bash
cd server && npx tsc --noEmit && npm test
cd panel  && npx tsc -b --noEmit && npm test   # panel obsługi — patrz niżej
python3 tools/docs_check.py && python3 tools/styl_check.py   # ≤25 słów/zdanie
python3 tools/ergonomia_check.py && python3 tools/kt_imports_check.py   # kolektor
```

Wszystkie siedem musi być czystych. **Wiersz z `panel` doszedł w 0.255.0 i to
była dziura, nie przeoczenie w zapisie:** `npm test` w `server/` uruchamia
wyłącznie testy serwera, więc dało się przejść wszystkie bramki na zielono
i wypchnąć panel z czerwonymi testami. CI je łapało (`server.yml`, krok „Testy
panelu obsługi"), ale dopiero po wypchnięciu. Dwie ostatnie dotyczą Kotlina i biegną
w sekundy — moduł `:app` nie kompiluje się poza CI, więc to jedyne, co łapie
mały cel dotyku i brakujący import przed wypchnięciem. Testy-strażnicy źródeł
panelu (`Bursztyn`, `Kontrast`, `Skala`, `Czas`) i zero zapisu przy otwarciu
ekranu to zasady wyżej zapisane w kodzie — ich odmowa zwykle znaczy, że
łamiesz jedną z nich, nie że test jest do poprawienia.
