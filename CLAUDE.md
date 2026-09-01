# WERTIS — zasady pracy w tym repo

Magazynowo-biurowy asystent firmy ogrodniczej: serwer Fastify + `node:sqlite`
(`server/`), ręcznie pisany panel biura (`server/src/web/biuro.html`, bez
bundlera), panel obsługi klienta (`panel/`, React + Vite), kolektor Android
(`android/`). Architektura i decyzje:
`docs/architektura.md`. Ten plik mówi tylko, CZEGO pilnować przy zmianach.

## Twarde zasady

- **Komentarze po polsku i wyjaśniają DLACZEGO**, nie co robi następna linia.
  Decyzja bez uzasadnienia w komentarzu to decyzja do wycofania.
- **Dwa fronty, każdy ze swoją granicą.** Do 0.141.0 front był jeden. Decyzja
  właściciela z `docs/obsluga-klienta.md` §7 dołożyła drugi: obsługa klienta
  dostaje `panel/` (React + Vite, build do `dist/web/obsluga`). Magazyn zostaje
  w `biuro.html` — bez frameworka i bez bundlera, bo nic tam tego nie wymaga.
  Nowy ekran magazynu idzie do `biuro.html`, nowy ekran obsługi do `panel/`.
  Trzeciego frontu nie ma. Funkcje w `<script>` biura nie mogą się powtarzać
  z nazwy (test dubli) ani wołać funkcji, której nie ma (test wywołań);
  delegacje kliknięć stoją na SEKCJACH, nie na pojemnikach w ich środku
  (test delegacji).
- **Reguła klienta HTTP obowiązuje KAŻDY front z osobna.** Żądanie bez ciała
  nie deklaruje typu treści — pusty JSON to `FST_ERR_CTP_EMPTY_JSON_BODY`
  i gołe „Bad Request" na ekranie. Pilnują tego trzy niezależne strażnice:
  `routes/biuro.test.ts` (po źródle `biuro.html`), `panel/src/api/klient.test.ts`
  (po zachowaniu) i `EMPTY_BODY` w kolektorze. Panel obsługi kupił tę bliznę
  drugi raz, bo strażnik istniał tylko dla jednego pliku. Dokładając front,
  dokładasz też jego strażnika.
- **Zero zapisu przy patrzeniu.** Otwarcie ekranu niczego nie mutuje.
  Liczniki `method: "POST"/"PUT"/"DELETE"` w `routes/biuro.test.ts` są
  UMOWĄ — każdy nowy zapis podnosi licznik i dostaje zdanie w uzasadnieniu.
- **Cienkie trasy, logika w serwisach** z testem obok (`*.test.ts`,
  `tsx --test`). Każda mutacja woła `logEvent`. Bramka ról: `odmowa()`
  w trasach biura, `autoryzuj()` przy operacjach uprzywilejowanych.
- **Tickery wyłącznie w `main()`**, nigdy w `buildApp()` (testy tras nie
  strzelają do Allegro). Dziś żadnego nie ma — gdy wróci, rytm bierze
  z `services/takt.ts` (rozrzut, respekt dla 429).
- **Prywatność:** adresy dostawy nie przechodzą przez mapowanie (pilnują
  testy). Obsługa klienta powstaje od nowa i swoją politykę danych ma
  zapisać w `docs/obsluga-klienta.md`, zanim dotknie pierwszej rozmowy.
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

## Zanim wypchniesz

```bash
cd server && npx tsc --noEmit && npm test
python3 tools/docs_check.py && python3 tools/styl_check.py   # ≤25 słów/zdanie
```

Wszystkie cztery muszą być czyste. `npm test` to także testy-strażnicy
struktury `biuro.html` — ich odmowa zwykle znaczy, że łamiesz jedną
z zasad wyżej, nie że test jest do poprawienia.
