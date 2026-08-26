# WERTIS — zasady pracy w tym repo

Magazynowo-biurowy asystent firmy ogrodniczej: serwer Fastify + `node:sqlite`
(`server/`), jeden ręcznie pisany panel biura (`server/src/web/biuro.html`,
bez bundlera), kolektor Android (`android/`). Architektura i decyzje:
`docs/architektura.md`. Ten plik mówi tylko, CZEGO pilnować przy zmianach.

## Twarde zasady

- **Komentarze po polsku i wyjaśniają DLACZEGO**, nie co robi następna linia.
  Decyzja bez uzasadnienia w komentarzu to decyzja do wycofania.
- **Jeden front.** Panel biura to `biuro.html` — żadnego drugiego frontu,
  frameworka ani bundlera. Funkcje w jego `<script>` nie mogą się powtarzać
  z nazwy (test dubli), delegacje kliknięć stoją na SEKCJACH, nie na
  pojemnikach w środku sprawy (test delegacji).
- **Zero zapisu przy patrzeniu.** Otwarcie ekranu niczego nie mutuje.
  Liczniki `method: "POST"/"PUT"/"DELETE"` w `routes/biuro.test.ts` są
  UMOWĄ — każdy nowy zapis podnosi licznik i dostaje zdanie w uzasadnieniu.
- **Cienkie trasy, logika w serwisach** z testem obok (`*.test.ts`,
  `tsx --test`). Każda mutacja woła `logEvent`. Bramka ról: `odmowa()`
  w trasach biura, `autoryzuj()` przy operacjach uprzywilejowanych.
- **Tickery wyłącznie w `main()`**, nigdy w `buildApp()` (testy tras nie
  strzelają do Allegro). `ALLEGRO_POLL_MS` domyślnie 0; rytm przez
  `services/takt.ts` (rozrzut, respekt dla 429).
- **Prywatność:** rozmowy z Allegro czyta się na klik i NIE zapisuje;
  załączniki i obrazy nie są przechowywane; adresy dostawy nie przechodzą
  przez mapowanie (pilnują testy).
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
