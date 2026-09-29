# Serwer — zasady obszaru

Uzupełnia `CLAUDE.md` w korzeniu. Tam stoją zasady wspólne i bramki przed
wypchnięciem; tu to, co dotyczy wyłącznie `server/`.

## Trasy i serwisy

- **Trasa jest cienka, logika siedzi w serwisie z testem obok**
  (`*.test.ts`, `tsx --test`). Trasa sprawdza sesję i rolę, woła serwis
  i tłumaczy jego błąd na kod HTTP. *Strażnik: konwencja.*
- **Każda mutacja woła `logEvent`** (`services/events.ts`), zwykle w serwisie,
  nie w trasie. Dziennik biura to jedyny ślad, kto co zmienił.
  *Strażnik: konwencja.*
- **Role biura: `ROLE_BIUROWE` z `services/users.ts`.** Para
  `["biuro", "admin"]` wpisana z palca to miejsce, w którym nowa rola po
  cichu nie zadziała. *Strażnik: `src/routes/role-biura.test.ts`.*
- **`odmowa()` to wzorzec lokalny, nie wspólna funkcja.** Każdy plik tras
  ma własną, w jednym z dwóch kształtów: zwraca `{ kod, error }` albo sama
  wysyła 403. Kopiując, bierz kształt z pliku, w którym pracujesz.
- **`autoryzuj()` przy operacjach uprzywilejowanych** (`services/auth.ts`).
  Zapisuje wpis `privileged` z nazwą operacji, więc nie stawiaj go przy
  zwykłym zapisie. Inaczej zwykłe kliknięcie wygląda w dzienniku jak przelew.
- **Pusty JSON to brak ciała.** Parser w `buildApp()` przepuszcza pustą
  treść z `content-type: application/json` jako brak ciała, a resztę oddaje
  domyślnemu parserowi Fastify. Nie usuwaj go przy porządkach.
  *Strażnik: `src/routes/logo-dostawcy.test.ts`.*

## Praca w tle

- **Tickery wyłącznie w `main()`, nigdy w `buildApp()`.** Import `buildApp`
  w testach nie ma prawa uruchomić niczego w tle.
- **Wszystko, co odpytuje Allegro, idzie przez `uruchomTakt`**
  (`services/takt.ts`): rozrzut startu i respekt dla 429. Lista taktów stoi
  w `main()` w `index.ts`. Odświeżanie read-modelu Subiekta w tym samym
  `main()` chodzi zwykłym `setInterval` i tak ma zostać: to lokalny SQL,
  nie cudze API z limitem.

## Allegro

- **Kształt czytaj z `docs/allegro/swagger.yaml`, nie z pamięci** — zasada
  w korzeniu. Nowe pole mapujesz dopiero po znalezieniu go w SCHEMACIE,
  a wymagalność bierzesz z listy `required`.
- **Prywatność stoi w kształcie tabel.** Kolumna z członem `adres`,
  `telefon`, `mail`, `iban`, `pesel` i podobnymi zatrzyma
  `src/db/prywatnosc-schematu.test.ts`. Wyjątek dopisujesz tam z powodem
  i tylko razem z uzasadnieniem w `docs/obsluga-klienta.md`.

## Copilot (model językowy)

Model językowy woła się z `src/adapters/copilot.anthropic.ts`. Jedyny
wyjątek to rozpoznawanie wiadomości klientów, które od 29 września 2026
robi Jev z `src/adapters/copilot.jev.ts`. Wybiera go `KLASYFIKATOR_DOSTAWCA`
przez `copilot.klasyfikator.ts`, a trasy i takty wołają wyłącznie ten wybór.
Nowe wywołanie klasyfikacji idzie przez `nadawcaKlasyfikacji`, nie przez
konkretnego dostawcę. Jev nie generuje tekstu, więc szkice zostają przy Claude.

Jev: model przypięty do wersji (`JEV_MODEL`), nigdy do aliasu `jev-latest`,
bo progi pewności w `copilot.jev.ts` są dostrojone do wersji. Zmieniając
pytania albo progi, podnieś `PYTANIA_JEVA`. Dokumentacja TypeSafe mówi, że
angielski jest językiem o najlepszej trafności, więc polską trafność mierzy
raport porównawczy, nie założenie.

Cztery reguły Claude z audytu promptów, każda po awarii albo o krok od niej:

- `output_config.effort` idzie tylko przez `wspieraWysilek`, bo Haiku 4.5
  i Sonnet 4.5 odrzucają go błędem 400.
- `max_tokens` liczy też myślenie, domyślnie włączone na claude-opus-5.
  Ucięty JSON to wywołanie zapłacone za nic, a sufit nie kosztuje nic.
- Kształt odpowiedzi wymusza `zodOutputFormat`. Instrukcja opisuje pola,
  nie każe „zwrócić JSON".
- Powód reguły i opis incydentu stoją w komentarzu obok instrukcji, nie
  w jej tekście. Model przejmuje przykłady i rejestr instrukcji, także
  myślniki.

Te reguły są przypięte do konkretnych modeli. Zmieniając model w
`COPILOT_MODEL`, sprawdź je od nowa z aktualną dokumentacją API, nie z pamięci.

## Testy

`npm test` zbiera wzorcem `"src/**/*.test.ts"` w cudzysłowie, więc Node
rozwija go rekurencyjnie. Bez cudzysłowu powłoka `sh` schodzi tylko jeden
katalog w głąb i test w `src/a/b/` nie uruchomiłby się nigdy, przy zielonym CI.
