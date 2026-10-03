# WERTIS — zasady pracy w tym repo

Magazynowo-biurowy asystent firmy ogrodniczej. Serwer Fastify z `node:sqlite`
(`server/`), panel biura w React i Vite pod `/obsluga` (`panel/`), kolektor
Android (`android/`). Obok nich trzy procesy Windows: worker Sfery, który
wystawia dokumenty w Subiekcie (`sfera-worker/`, C#), usługa zdjęć bez tła
(`tlo-worker/`, C#) i instalator (`instalator/`, PowerShell). Architektura
i decyzje stoją w `docs/architektura.md`.

Ten plik mówi, CZEGO pilnować przy zmianach. Zasady jednego obszaru stoją
w jego katalogu: `server/CLAUDE.md`, `panel/CLAUDE.md`, `android/CLAUDE.md`
i `sfera-worker/CLAUDE.md`. Claude Code wczytuje je, gdy pracujesz w danym
katalogu.

## Najpierw to: twojego PR-a nikt nie przeczyta przed produkcją

Zielone CI scala PR samo, bez zatwierdzenia (`auto-scalanie.yml`). Każde
scalenie z fragmentem zmian to wydanie (`wydanie.yml`). Serwer w magazynie
bierze wydanie sam, domyślnie godzinę później (`AKTUALIZACJA_AUTO=zaraz`).

Wniosek: zasada, której nic nie sprawdza, nie chroni nikogo. Dlatego każda
zasada niżej ma swojego **strażnika** — test albo skrypt, który zatrzyma CI.
Zasada bez strażnika jest oznaczona jako **konwencja**, żeby było widać,
na czym stoi. Dokładając zasadę, dokładasz strażnika albo piszesz
„konwencja".

**Jeden wyjątek od scalania bez człowieka: zapis do Subiekta.** PR, który go
dotyka, czeka na kliknięcie właściciela. Listę ścieżek trzyma
`.github/workflows/zgoda.yml`, a instrukcję DEPLOY §0d. Powód: zły dokument
w Subiekcie zostaje w księgach, a następne wydanie go nie cofnie. Nie zmieniaj
tej bramki przy okazji innej pracy.

## Agenci

W `.claude/agents/` stoi sześciu agentów. Cztery obszary: `serwer`,
`panel`, `kolektor` i `sfera`. Każdy pracuje tylko w swoim katalogu i nie
commituje. Funkcję na kilka obszarów dzieli sesja główna: najpierw ustala
kontrakt API, potem deleguje części i robi jeden commit. Obok nich dwaj
recenzenci tylko do odczytu. `allegro-ksztalt` odpowiada o kształcie
Allegro wyłącznie z plików, z cytatami. `straznik-zasad` przegląda diff
przed wypchnięciem i uruchamia bramki. `tlo-worker/` i `instalator/` nie mają
własnego agenta, bo zmieniają się rzadko. Agentów wczytuje dopiero nowa sesja.

## Zasady

Każda zasada: co robić, dlaczego i kto tego pilnuje.

- **Komentarze po polsku i wyjaśniają DLACZEGO.** Powód, nie historia.
  „Robimy X, bo Y" zostaje prawdziwe. „Do wersji N było inaczej" przestaje
  być potrzebne w dniu zmiany, a historia mieszka w `CHANGELOG.md` i gicie.
  Decyzja bez powodu w komentarzu to decyzja do wycofania.
  *Strażnik: `tools/styl_check.py`* — nowy numer wydania w komentarzu kodu
  zatrzyma CI. Stare numery trzyma próg per plik
  (`tools/wersje_w_komentarzach.json`), który może tylko maleć. Usuwając
  numer, obniż próg: `python3 tools/styl_check.py --zapisz-wersje`.
  Reszta zasady: konwencja.

- **Jeden front: `panel/`.** Całe biuro mieszka w `panel/`, a `/` i `/biuro`
  przekierowują do `/obsluga/`. Nowy ekran biura, magazynowy czy obsługi,
  idzie do `panel/`. Kształt ekranu: praca na górnym rzędzie, wgląd na dolnym,
  ustawienia za zębatką (`docs/obsluga-klienta.md` §7).
  *Strażnik: konwencja.*

- **Zero zapisu przy patrzeniu.** Otwarcie ekranu niczego nie mutuje.
  *Strażnik: `panel/src/ZeroZapisu.test.ts`* — każda trasa z `main.tsx` musi
  mieć test, który liczy zapisy przy otwarciu. Nowy ekran bez takiego testu
  zatrzyma CI. Najprościej napisać go atrapą z `panel/src/test/zapisy.ts`.
  **Wyjątki, decyzją właściciela:** wejście w reklamację i w dyskusję
  odświeża sprawę z Allegro jednym POST-em. Powód: po wysyłce odpowiedzi
  albo werdyktu stan u Allegro dochodzi do nas dopiero pełnym przebiegiem,
  co trzy minuty, a agent patrzy na ekran teraz. *Strażnik wyjątków:
  `ekrany/Reklamacje.test.tsx` i `ekrany/Dyskusje.test.tsx`* — dokładnie
  jedna mutacja przy wejściu, zero przy samym otwarciu ekranu.

- **Reguła klienta HTTP.** Żądanie bez ciała nie deklaruje typu treści.
  Serwer i tak czyta pusty JSON jak brak ciała (parser w `buildApp()`), więc
  pomyłka frontu nie kończy się już gołym „Bad Request". Powód: ten błąd
  trafił dwa razy, za każdym razem na innym froncie, bo pilnował go każdy
  front z osobna. *Strażnik: `server/src/routes/logo-dostawcy.test.ts`
  (serwer) i `panel/src/api/klient.test.ts` (panel).* Kolektor wysyła
  `EMPTY_BODY` z `ApiService.kt` — to konwencja.

- **Cienkie trasy, logika w serwisach, test obok.** Każda mutacja woła
  `logEvent`. Role biura bierze się z `ROLE_BIUROWE` (`services/users.ts`),
  a operacje uprzywilejowane idą przez `autoryzuj()` (`services/auth.ts`).
  Szczegóły w `server/CLAUDE.md`. *Strażnik ról: `routes/role-biura.test.ts`.
  Reszta: konwencja.*

- **Tickery odpytujące Allegro startują wyłącznie w `main()`**, przez
  `uruchomTakt` z `services/takt.ts` (rozrzut, respekt dla 429). Nigdy
  w `buildApp()`, bo testy tras nie mają prawa strzelać do Allegro.
  *Strażnik: konwencja.*

- **Copilot woła się z `adapters/copilot.anthropic.ts`, a rozpoznawanie
  wiadomości klientów także z `adapters/copilot.jev.ts`.** Jev z TypeSafe
  rozpoznaje, gdy stoi `TYPESAFE_API_KEY`; szkice zawsze pisze Claude, bo Jev
  nie generuje tekstu. Rozpoznawanie wchodzi przez `nadawcaKlasyfikacji`
  (`copilot.klasyfikator.ts`), nigdy przez konkretnego dostawcę. Przed zmianą
  wywołania przeczytaj nagłówek pliku i `server/CLAUDE.md`. Reguły modelu
  zależą od jego wersji i starzeją się z nią. Kolejny dostawca modelu to
  decyzja właściciela, nie zmiana przy okazji. *Strażnik:
  `copilot.klasyfikator.test.ts` pilnuje wspólnego wejścia, a
  `copilot.jev.test.ts` — że klucz TypeSafe nie trafia do błędów. Jedyny
  import `@anthropic-ai/sdk` to konwencja.*

- **Kształt Allegro czyta się z pliku, nie z pamięci.** Specyfikacja leży
  w `docs/allegro/swagger.yaml`, cudza i nietykalna. Czytaj SCHEMAT, nie
  przykład: wymagalność pola mówi wyłącznie lista `required`. `public.v1`
  i `beta.v1` bywają RÓŻNYMI kształtami. Powód: mapowanie z pamięci
  kosztowało już trzy wydania i skrzynkę, która nie zapisała ani jednego
  wątku. *Strażnik: sumę pliku pilnuje `tools/docs_check.py`; samo czytanie
  to konwencja.*

- **Prywatność.** Przez mapowanie przechodzi adres DOSTAWY: ulica, miasto,
  kod, telefon i nazwa odbiorcy. Telefon ma drugą kolumnę z samymi cyframi,
  bo szuka się po końcówce numeru. Z `buyer` przechodzi WYŁĄCZNIE login,
  bo to klucz klienta. Nie przechodzą: `invoice.address`, reszta `buyer`
  (e-mail, telefon, własny adres kupującego), PESEL i konto bankowe.
  Lądowisko `surowe_json` nie dostaje nic z adresu. Zakres i powód stoją
  w `docs/obsluga-klienta.md`. Dokładając pole, dopisujesz tam uzasadnienie
  albo pola nie dokładasz. *Strażnik: `server/src/db/prywatnosc-schematu.test.ts`
  (każda tabela) i testy mapowania zamówień.*

- **Obsługa klienta to JEDNA droga, nie cztery kolejki.** Kolejki —
  skrzynka, zwroty, reklamacje, dyskusje — są NASZE, nie klienta. Nowa
  kolejka albo ekran dopisuje się do `services/droga-klienta.ts`, wiązaniem
  po numerze zamówienia w obie strony. Wiązanie jednostronne to wiązanie,
  którego nie ma. Klientem jest login Allegro porównywany bez wielkości liter.
  Wspólnego statusu przepisanego z kolejek nie było i nie będzie. Sprawa
  klienta trzyma wyłącznie to, czego kolejki nie wiedzą: kto prowadzi,
  następny krok z terminem i zakończenie. Reguły, S6 i powody:
  `docs/obsluga-klienta-calosc.md`. *Strażnik: konwencja.*

- **Ekran magazynowy projektuje się pod ergonomię, nie pod wygląd.** Reguły
  stoją w `docs/ergonomia-magazynu.md`. Spór o kształt wygrywa ekran, który
  wymaga mniej decyzji, interakcji, uwagi, pamiętania, ruchu i błędów.
  Dekalog obowiązuje kolektor. Biuro i panel obsługi biorą z niego punkty
  1, 2, 5, 6 i 10, bo mysz na blacie to nie kciuk w rękawicy.
  *Strażnik: `tools/ergonomia_check.py`* — cel dotyku kolektora poniżej
  48 dp wymaga komentarza `ergonomia: <powód>`. Reszta dekalogu: konwencja.

- **`[WERYFIKUJ]`** znaczy: niezweryfikowane na żywym Allegro albo Subiekcie.
  Dopisując lub zdejmując znacznik, popraw liczbę w preambule
  `docs/subiekt-gt-struktura.md`. *Strażnik: `tools/docs_check.py`.*

## Wydania

- **Numer nadaje automat po scaleniu, nie PR.** PR nie zmienia wersji
  w `package.json` ani nie dopisuje `## ` do `CHANGELOG.md` — zatrzyma go
  bramka `Fragmenty zmian`. Zmianę opisuje `zmiany/<nazwa>.md` (wzór:
  `zmiany/README.md`): `rodzaj: minor` dla widocznej funkcji albo działania
  przy wdrożeniu, `patch` dla reszty, `tytul:` i treść wpisu. PR z samym CI
  albo dokumentacją fragmentu nie potrzebuje.
- **Numer swojego wydania pisz jako `@wydanie`, ale tylko w dokumentach.**
  Automat podmieni znacznik przy scaleniu. W komentarzu kodu numeru nie ma
  wcale, także jako znacznika. Ten plik jest z podmiany wyłączony, bo
  znacznik opisuje.
- **`[wymaga działania]` w fragmencie wstrzymuje automatyczną aktualizację
  serwera**, aż ktoś kliknie ją w panelu. Pisz go zawsze, gdy wdrożenie
  potrzebuje czegoś poza samą aktualizacją: nowego klucza w `wertis.env`,
  kroku w Subiekcie, ręcznej migracji. Powód: pominięty znacznik kosztuje
  awarię w magazynie godzinę po scaleniu, a nadmiarowy — jedno kliknięcie.
- Commity po polsku. Numer w tytule ma tylko commit wydania.

## Zanim zaczniesz

```bash
npm ci                   # W KORZENIU repo, nigdy w panel/ ani server/
sh tools/co_w_toku.sh    # hak SessionStart robi to sam; to jest droga ręczna
```

`panel/` i `server/` to workspace'y npm. `npm ci` w jednym z nich kasuje
wspólne `node_modules`, a testy serwera pokazują potem setki awarii, których
nie ma.

`co_w_toku.sh` pokazuje gałęzie z commitami spoza `main`, ich **zgłoszenia**
i otwarte PR-y. Lista PR-ów wymaga `gh`, którego w sesjach chmurowych nie
ma. Zgłoszenia działają bez niego, bo czyta je sam git.

**Zgłoś pracę pierwszym pushem.** Zanim napiszesz kod, wypchnij na swojej
gałęzi fragment `zmiany/<nazwa>.md` z tytułem i otwórz PR jako szkic.
`co_w_toku.sh` pokaże go innym sesjom jako „zgłoszone", a szkicu automat nie
scala. Powód: dwie sesje zbudowały już tę samą funkcję równolegle i jedną
implementację trzeba było wyrzucić w całości.

**Gdy ktoś zgłosił TO SAMO**, powiedz właścicielowi i nie pisz kodu, dopóki
nie zdecyduje. Jeśli nikt nie odpowiada, zostaw zgłoszenie, opisz kolizję
w szkicu PR-a i zakończ pracę. Druga wersja tej samej funkcji kosztuje więcej
niż czekanie.

## Zanim wypchniesz

```bash
cd server && npx tsc --noEmit && npm test
cd panel  && npx tsc -b --noEmit && npm test
python3 tools/docs_check.py && python3 tools/styl_check.py   # ≤25 słów/zdanie
python3 tools/ergonomia_check.py && python3 tools/kt_imports_check.py   # kolektor
```

Wszystkie osiem musi być czystych. Testy serwera i panelu trwają po około
dwie minuty. `npm test` w `server/` nie uruchamia testów panelu, więc wiersz
z `panel` nie jest opcjonalny. Dwie ostatnie bramki dotyczą Kotlina i biegną
w sekundy. Moduł `:app` nie kompiluje się poza CI, więc to jedyne, co łapie
mały cel dotyku i brakujący import przed wypchnięciem.

Testy-strażnicy źródeł w `panel/src/` (m.in. `Bursztyn`, `Kontrast`,
`Skala`, `Czas`, `ZeroZapisu`) to zasady zapisane w kodzie. Ich odmowa zwykle
znaczy, że łamiesz jedną z nich, nie że test jest do poprawienia.
