# WERTIS — panel obsługi klienta i doboru części

Status: projekt docelowy. Wersja dokumentu 1.0, 1 września 2026.

Ten dokument opisuje, dokąd idziemy. Rejestrem decyzji właściciela i listą
dowodów jest `docs/obsluga-klienta.md` — tam stoją odpowiedzi na osiem pytań,
tutaj ich konsekwencja. Stan faktyczny kodu opisuje rozdział 28 na końcu.

**Nazwy bytów są tu takie, jak w kodzie.** Projekt właściciela używał nazw
angielskich (`field_task`, `internal_comment`, `draft`, `audit_event`), a repo
ma dla nich własne tabele. Zmieniliśmy dokument, nie bazę: równoległa nazwa dla
istniejącego bytu dała już w tym repo dwie tabele zadań i trzeci front.

## 1. Cel systemu

Panel wspiera obsługę pytań klientów sklepu z częściami do kosiarek,
traktorków, kos, pilarek i silników ogrodniczych.

Najważniejszy przypadek to **techniczny dobór części**. Odpowiedź wymaga
połączenia danych z wielu źródeł: pytania klienta, oferty Allegro, historii
rozmowy, kartoteki Subiekta GT, symboli OEM i zamienników, dokumentacji
producenta, wcześniejszych potwierdzonych dopasowań, zdjęć i tabliczek
znamionowych, pomiarów magazyniera oraz wiedzy pracowników.

System nie jest skrzynką wiadomości. Ma prowadzić agenta od pytania klienta do
udokumentowanej decyzji o dopasowaniu części.

## 2. Główna obietnica produktu

Agent obsługuje pytanie techniczne bez przełączania się między Centrum
Wiadomości Allegro, pocztą, Subiektem GT, katalogami producentów, arkuszami,
komunikatorem, telefonem do magazynu i prywatnymi notatkami.

Docelowy przepływ:

```
pytanie klienta
    ↓
automatycznie pobrana rozmowa i oferta
    ↓
rozpoznanie urządzenia, silnika i szukanej części
    ↓
wyszukanie produktów oraz potwierdzonych zastosowań
    ↓
uzupełnienie brakujących informacji
    ↓
opcjonalne zadanie dla magazynu
    ↓
wynik pomiaru lub zdjęcie
    ↓
szkic odpowiedzi
    ↓
kontrola i wysyłka przez agenta
    ↓
utrwalenie potwierdzonej wiedzy
```

## 3. Zakres pierwszego kanału

Pierwszy kanał to Allegro: Centrum Wiadomości, pytania pod ofertami, kolejne
wiadomości w istniejących rozmowach, kontekst własnej oferty, kontekst
zamówienia, docelowo dyskusje i reklamacje.

Architektura nie może zakładać, że Allegro zostanie jedynym kanałem. Mają być
możliwe adaptery poczty, sklepu internetowego, formularza kontaktowego, innych
marketplace'ów oraz rozmów telefonicznych rejestrowanych ręcznie.

## 4. Zakres funkcjonalny

### 4.1. Skrzynka zespołowa

Lista nowych rozmów, kolejka nieprzypisanych, rozmowy zalogowanego agenta,
rozmowy innych agentów, priorytety, statusy, terminy odpowiedzi, odłożenie do
wskazanego czasu, przekazanie, prywatne komentarze, wzmianki, historia działań,
filtrowanie i wyszukiwanie.

### 4.2. Obsługa rozmowy

Agent widzi pełną chronologiczną historię, autora każdej wiadomości, datę
i godzinę, kanał, załączniki, ofertę, powiązane zamówienie, komentarze
wewnętrzne, zadania terenowe, wyniki z magazynu, szkic odpowiedzi i historię
jego zmian.

### 4.3. Kontekst oferty i produktu

Panel prezentuje oddzielnie dane Allegro (identyfikator oferty, tytuł,
miniaturę, status, cenę, opis, parametry, kategorię, link, czas ostatniego
odświeżenia) i dane Subiekta (`tw_id`, symbol, nazwę, EAN, opis, jednostkę,
lokalizacje, stan, rezerwacje, stan dostępny, zamówienia u dostawców,
zamienniki, zdjęcia, dodatkowe magazyny).

**Każdy fakt niesie swoje źródło.** System nie miesza danych z Allegro
i z Subiekta bez pokazania, skąd pochodzą. Ta sama zasada dotyczy kartoteki
wskazanej ręcznie przez agenta: jest jego wyborem, nie faktem z Allegro.

## 5. Role użytkowników

**Agent** czyta rozmowy, przejmuje nieprzypisane, pisze szkice, wysyła
odpowiedzi, dodaje komentarze wewnętrzne, wysyła zadania do magazynu, wyszukuje
części, proponuje dopasowanie, oznacza rozmowę jako oczekującą lub zakończoną.

**Ekspert techniczny** ma uprawnienia agenta oraz zatwierdza zastosowania
części, odrzuca błędne dopasowania, zatwierdza negatywne dopasowania, redaguje
dane techniczne i rozstrzyga konflikty między źródłami.

**Magazynier** pracuje w istniejącej aplikacji kolektora. Widzi zadania
skierowane do magazynu, przejmuje je, otwiera kartę towaru, widzi lokalizację,
wykonuje pomiar, wpisuje wynik, robi zdjęcie, przekazuje uwagę, oznacza brak
produktu na półce i kończy zadanie. Nie potrzebuje Teamsa, Slacka ani drugiej
aplikacji.

**Administrator** zarządza kontami, połączeniami kanałów, paruje konto Allegro,
ustawia reguły synchronizacji, konfiguruje retencję, zarządza rolami, przegląda
audyt, wymusza przekazanie sprawy oraz zarządza źródłami wiedzy i konfiguracją
sztucznej inteligencji.

## 6. Model pracy zespołu

### 6.1. Jednostki domenowe

System rozróżnia **rozmowę** (komunikację w kanale), **sprawę** (problem
klienta obejmujący czasem kilka rozmów), **wiadomość**, **dobór** (proces
wyboru części), **zadanie** (pracę pomocniczą), **dowód** (podstawę decyzji
technicznej) i **szkic** (niewysłaną treść).

Nie zastępujemy tych pojęć jedną tabelą ze wspólnym statusem.

### 6.2. Przypisanie

Rozmowa jest nieprzypisana, przypisana do agenta, przypisana do zespołu,
przekazana ekspertowi, odłożona albo zakończona.

**Przejęcie jest atomowe.** Gdy dwóch agentów spróbuje przejąć tę samą rozmowę,
uda się jeden zapis. Drugi dostaje konflikt z aktualnym właścicielem, czasem
przejęcia i bieżącą wersją rozmowy.

**Dwa rodzaje przydziału (0.158.0).** Decyzja właściciela: samo wejście agenta
w pytanie przydziela mu je NA CZAS SIEDZENIA, a odpowiedź — na stałe.

| przydział | co go daje | jak długo trwa | gdzie żyje |
|---|---|---|---|
| tymczasowy (uchwyt) | wejście w rozmowę | do wyjścia albo do wygaśnięcia | pamięć procesu |
| trwały | odpowiedź do klienta albo „Przejmij" | do przekazania | `conversation.assigned_user_id` |

Uchwyt trzyma PIERWSZY, który wszedł, nie ostatni: inaczej kolega otwierający
rozmowę „na chwilę" odbierałby ją komuś w połowie pisania odpowiedzi.

Wysyłka odpowiedzi na rozmowę nieprzypisaną nie wymaga już osobnego przejęcia.
Do 0.157.0 agent, który wszedł w pytanie i napisał odpowiedź, dostawał na
końcu „najpierw ją przejmij" i tracił ruch.

**Blokada jest miękka.** Gdy przy rozmowie siedzi kto inny, wysyłka odpada
z 409 i nazwiskiem — ale ekran daje jawne „odpowiedz mimo to". Twarda blokada
zatrzymywałaby biuro za każdym razem, gdy kolega zostawił otwartą zakładkę
i wyszedł.

### 6.3. Obecność agentów

Panel pokazuje, kto ogląda rozmowę, kto pisze, kto zmienił szkic i kto ostatnio
wykonał działanie.

**Obecność i „pisze" nie są tabelą.** To stan krótkotrwały, żyjący w pamięci
procesu (`services/conversation-realtime.ts`) i wygasający sam. Zapisany do
bazy stałby się trwałym statusem rozmowy, czyli dokładnie tym, czym nie jest —
a po restarcie serwera kłamałby o tym, kto siedzi przy sprawie.

Ten akapit napisano w 0.141.0, a w 0.158.0 dostał zastosowanie: to na nim
stoi przydział tymczasowy z §6.2. Uchwyt puszcza po czterdziestu pięciu
sekundach bez znaku życia, panel bije sercem co piętnaście. Trzykrotny zapas
jest po to, żeby jedno zgubione żądanie nie oddało rozmowy komuś innemu
w połowie pisania odpowiedzi.

Dzięki temu wejście na ekran nie zapisuje ANI JEDNEGO wiersza. Trasa obecności
jest zapisem tylko z nazwy — reguła „zero zapisu przy patrzeniu" obowiązuje
skrzynkę tak samo jak resztę.

### 6.4. Wewnętrzne komentarze

Komentarze są widoczne wyłącznie dla pracowników, mogą zawierać wzmianki, mogą
wskazywać produkt, zadanie lub dowód, nie mogą przypadkiem trafić do klienta
i są wizualnie odróżnione od wiadomości klienta.

## 7. Statusy

**Rozmowa:** `new`, `open`, `waiting_for_customer`, `waiting_for_internal`,
`snoozed`, `resolved`, `closed`, `spam`. **Działają od 0.157.0**, komplet
ośmiu.

### 7.1. Cztery liczy automat, cztery stawia człowiek

Status wynika z faktów, które i tak zapisujemy, i zapisuje go ta sama
transakcja co fakt:

| fakt | status po |
|---|---|
| przyszła wiadomość od klienta | `new`, a przy rozmowie z właścicielem `open` |
| ktoś przejął albo przekazał rozmowę | `open` |
| odpowiedź poszła do klienta | `waiting_for_customer` |
| zlecono zadanie hali | `waiting_for_internal` |
| wrócił wynik z hali | `open` |

Ręką stawia się cztery: odłożenie z terminem, `resolved`, `closed` i `spam`.
Automat nie ustawia ich NIGDY — nie ma jak wiedzieć, że sprawa jest
załatwiona, a domyślanie się tego to ten gatunek zgadywania, po którym
w 0.140.0 zniknął cały moduł.

Dwie reguły nadrzędne. `spam` jest nietykalny dla automatu, bo spamer pisze
dalej. `waiting_for_internal` przeżywa dopisek klienta: hala dalej mierzy,
a to, że przyszło coś nowego, mówi flaga nieprzeczytanej.

Rozmowa `resolved` albo `closed`, do której klient odpisał, WRACA do `open`
i dostaje w kolejce znacznik „wróciła". Bez niego wygląda jak każda inna
w toku, a to jedyna, przy której trzeba przeczytać, co obiecano wcześniej.

### 7.2. Odłożenie wygasa przy odczycie

`snoozed` obowiązuje, dopóki `snooze_do` jest w przyszłości; potem odczyt
pokazuje `open` — bez zapisu i bez tickera. Ticker przebudzający rozmowy
byłby czwartym w tym systemie i jedynym, którego całą pracą jest przepisanie
kolumny dającej się policzyć. „Zero zapisu przy patrzeniu" obowiązuje też
skrzynkę.

### 7.3. Status to nie jest flaga nieprzeczytanej

`conversation.unread` przychodzi z Allegro i mówi, czy sprzedawca odpisał
klientowi. `status` mówi, co z tym zrobiło biuro. Rozmowa załatwiona
telefonicznie ma `unread = 0` i `resolved`; jedna kolumna dla obu kłamałaby
przy każdej takiej.

**Dobór:** `not_started`, `extracting_data`, `missing_information`, `searching`,
`candidates_found`, `requires_expert`, `confirmed`, `rejected`,
`not_applicable`.

**Szkic:** `none`, `draft`, `needs_review`, `ready`, `sending`, `sent`,
`send_uncertain`, `send_failed`.

**Synchronizacja** ma status niezależny od rozmowy: `current`, `delayed`,
`rate_limited`, `authentication_error`, `failed`.

## 8. Integracja z Allegro

### 8.1. Autoryzacja

Wykorzystujemy istniejące: OAuth Device Flow, refresh token, rozdzielenie
produkcji i sandboksa, wymagany User-Agent, obsługę 401, 403, 406 i 429, scope
`allegro:api:messaging` oraz scope odczytu własnych ofert. Parowanie
i rozłączenie konta wymaga administratora.

### 8.2. Odczyt wiadomości

Podstawowe zasoby:

```
GET /messaging/threads
GET /messaging/threads/{threadId}/messages
```

**Mapowanie pól wynika z oficjalnej dokumentacji Allegro.** Pole, którego nie
da się z niej odczytać wprost, dostaje znacznik `[WERYFIKUJ]` i trafia do
licznika w preambule `docs/subiekt-gt-struktura.md`. Kształty potwierdzone
zapisujemy w `docs/allegro-ksztalt.md` i to on jest kontraktem dla kodu.

Nie wolno implementować mapowania na podstawie pamięci, przykładowego JSON-a
wymyślonego w teście, pól z poprzedniej usuniętej implementacji ani samej
treści e-maila powiadamiającego. Ta ostatnia lista kosztowała już jedno
wydanie: `external.id` czytany z wiadomości zamiast z oferty dawał `NaN`.

### 8.3. Paginacja

Synchronizacja pobiera wszystkie potrzebne strony. Nie zatrzymuje się po
pierwszych dwudziestu wątkach, nie zakłada, że pierwsza strona obejmuje cały
okres, nie przesuwa kursora po niepełnym zapisie i nie pomija starszych
zmienionych wątków bez jawnego bezpiecznika.

### 8.4. Idempotencja

Wiadomość identyfikuje jej numer w Allegro. Ponowne pobranie nie tworzy drugiej
wiadomości, może uzupełnić pola i metadane, ale **nie nadpisuje pracy agentów**.
Wiersz wiadomości nie może też zniknąć i wrócić z nowym numerem: wiszą na nim
szkic i zadania terenowe.

### 8.5. Wysyłka odpowiedzi

Wysyłka wymaga zalogowanego agenta, uprawnienia, aktualnego przypisania,
niepustej treści, zgodności wersji rozmowy, zgodności ostatniej wiadomości
klienta, klucza idempotencji i zapisu zdarzenia audytowego.

Przed wysłaniem serwer ponownie sprawdza świeżość rozmowy. Gdy klient dopisał
wiadomość w trakcie redagowania: serwer zwraca 409, szkic zostaje zachowany,
panel pokazuje nową wiadomość, agent aktualizuje odpowiedź, a wysyłka wymaga
ponownego zatwierdzenia.

**Po niejednoznacznym timeoucie nie ponawiamy wysyłki automatycznie.** System
najpierw synchronizuje wątek i sprawdza, czy odpowiedź już tam jest.

## 9. Synchronizacja

Synchronizację wykonuje proces serwera, nie przeglądarka. Pobiera stronę
nagłówków, porównuje z lokalnym stanem, pobiera wiadomości zmienionych wątków,
mapuje dane, zapisuje partię transakcyjnie, publikuje zdarzenia do panelu,
przesuwa kursor po poprawnym zapisie i zapisuje metryki przebiegu.

Synchronizator respektuje `Retry-After`, stosuje rozrzut, nie uruchamia wielu
równoległych przebiegów, izoluje błąd pojedynczego wątku, udostępnia ręczną
synchronizację, raportuje opóźnienie, działa wyłącznie w procesie produkcyjnym
i nie uruchamia się podczas testów tras.

## 10. Interfejs panelu

Front: React, TypeScript, Vite, Tailwind CSS, komponenty w duchu shadcn,
TanStack Query, React Router, React Hook Form, walidacja Zod, SSE albo
WebSocket, Vitest, Testing Library, Playwright.

To rozszerza koszt zapisany w `docs/obsluga-klienta.md` §7 z trzech bibliotek
do ośmiu. Decyzja właściciela, świadoma; §7 niesie nową wycenę.

### 10.1. Układ szerokiego ekranu

```
┌─────────────────┬───────────────────────────┬──────────────────────┐
│ Kolejka         │ Rozmowa                   │ Kontekst             │
│                 │                           │                      │
│ Nieprzypisane   │ Klient                    │ Oferta Allegro       │
│ Moje            │ Agent                     │ Towar z Subiekta     │
│ Oczekujące      │ Komentarze                │ Dobór części         │
│ Po terminie     │ Zadania i wyniki          │ Historia klienta     │
│                 │                           │ Wiedza i źródła      │
└─────────────────┴───────────────────────────┴──────────────────────┘
```

### 10.2. Lista rozmów

Wiersz pokazuje kanał, klienta, fragment ostatniej wiadomości, czas
oczekiwania, ofertę lub produkt, właściciela, priorytet, termin, liczbę nowych
wiadomości, status doboru i oczekujące zadanie terenowe.

### 10.3. Oś rozmowy

Oś zawiera wiadomości klienta, odpowiedzi firmy, komentarze wewnętrzne, zmiany
przypisania, zmianę statusu, utworzenie zadania, przejęcie przez magazyniera,
wynik magazyniera oraz przygotowanie i wysłanie odpowiedzi. Każdy rodzaj
zdarzenia wygląda inaczej.

### 10.4. Edytor odpowiedzi

Zwykły tekst, szablony, szkic ze sztucznej inteligencji, licznik znaków,
podgląd, historia wersji, ostrzeżenie o zmianie rozmowy, wstawienie wyniku
magazyniera, wstawienie parametrów produktu i przełączenie na komentarz
wewnętrzny.

**Przycisk komentarza i przycisk wysyłki do klienta są jednoznacznie
rozdzielone.**

### 10.5. Widok mobilny

Lista jest osobnym ekranem, otwarcie rozmowy ją zastępuje, kontekst otwiera się
jako panel albo zakładka, szkic nie ginie przy powrocie, a przycisk powrotu
jest zawsze dostępny.

## 11. Dobór części

### 11.1. Dane wejściowe

System rozpoznaje markę urządzenia, model, wariant, rocznik, numer seryjny,
model i kod silnika, numer OEM, nazwę części, parametry, wymiary, dane ze
zdjęcia oraz wcześniejsze ustalenia. Rozpoznane wartości są propozycją i agent
może je poprawić.

### 11.2. Kandydaci

Kolejność wyszukiwania: dokładny symbol, EAN, numer OEM, potwierdzone
zastosowanie, zamiennik, zgodne parametry, wyszukiwanie pełnotekstowe,
wyszukiwanie semantyczne.

**Wynik semantyczny nie jest dowodem kompatybilności.**

### 11.3. Poziomy pewności

Dopasowanie bywa potwierdzone przez producenta, katalogiem dostawcy, pomiarem
własnym, przez eksperta, wcześniejszą sprzedażą i weryfikacją; albo jest
prawdopodobne, wymagające danych lub odrzucone. Interfejs pokazuje źródło
i poziom pewności.

### 11.4. Negatywne dopasowania

Przechowujemy również wiedzę, że część nie pasuje, pasuje tylko do innego
wariantu, ma niewłaściwy rozstaw, ma właściwą średnicę przy innym sposobie
mocowania, występuje pod mylącym oznaczeniem albo wymaga dodatkowego pomiaru.

Negatywne dopasowanie jest istotnym ostrzeżeniem, nie brakiem danych.

## 12. Baza wiedzy

Byty: `Manufacturer`, `MachineModel`, `EngineModel`, `Part`, `PartIdentifier`,
`Fitment`, `FitmentEvidence`, `Measurement`, `KnowledgeDocument`,
`KnowledgeRevision`.

Dowód zastosowania przechowuje część, urządzenie lub silnik, typ relacji,
zakres numerów seryjnych, parametry, źródło, autora zatwierdzenia, datę, poziom
wiarygodności, komentarz i link do źródła. Każda zmiana wiedzy ma historię
wersji.

## 13. Zadania terenowe

Zadanie żyje w tabeli **`zadanie_terenowe`** (projekt właściciela nazywał ją
`field_task`).

### 13.1. Rodzaje

Pomiar, zdjęcie, weryfikacja oznaczenia, sprawdzenie zawartości zestawu,
kontrola lokalizacji, porównanie dwóch części, inne.

### 13.2. Utworzenie

Zadanie powstaje z rozmowy, z wiadomości, z oferty, z produktu albo ręcznie.
Utworzone z rozmowy przypina automatycznie rozmowę, źródłową wiadomość, ofertę,
produkt, autora i priorytet.

**Agent nie wpisuje technicznego `tw_id`.** Wskazuje towar wyszukiwarką albo
kartoteka wynika z oferty. Te dwie drogi są w zadaniu rozróżnione: kartoteka
wskazana przez agenta nie udaje faktu potwierdzonego przez Allegro.

### 13.3. Widok magazyniera

Kolektor pokazuje tytuł, instrukcję, priorytet, symbol, nazwę, zdjęcie,
lokalizację, oczekiwany typ wyniku i osobę zlecającą.

Magazynier przejmuje zadanie, odrzuca z powodem, wpisuje wynik, robi zdjęcie,
oznacza brak towaru, oznacza brak możliwości wykonania i kończy zadanie.

### 13.4. Wynik

Wynik wraca na oś rozmowy, do listy zadań, do autora, do szkicu i opcjonalnie
do propozycji wpisu w bazie wiedzy.

**Wynik nie staje się automatycznie potwierdzonym faktem technicznym.**
Utrwalenie go jako wiedzy wymaga zatwierdzenia.

## 14. Copilot

### 14.1. Dozwolone działania

Klasyfikacja wiadomości, podsumowanie rozmowy, rozpoznanie modelu i numerów,
wskazanie brakujących danych, wyszukanie kandydatów, porównanie parametrów,
propozycja pytania doprecyzowującego, przygotowanie szkicu, wskazanie
sprzecznych danych, propozycja wpisu do bazy wiedzy.

### 14.2. Niedozwolone bez człowieka

Automat nie wysyła odpowiedzi, nie potwierdza niepewnego dopasowania, nie
rozszerza bazy zastosowań, nie obiecuje dostępności ani terminu, nie uznaje
reklamacji, nie usuwa negatywnego dopasowania i nie podmienia faktu
technicznego.

### 14.3. Źródła

Każde twierdzenie techniczne w szkicu wskazuje źródło: ofertę, kartotekę,
dokumentację, dowód zastosowania, pomiar magazyniera, wcześniejszą rozmowę albo
ręczną decyzję eksperta. Brak źródła oznacza treść jako przypuszczenie.

### 14.4. Prywatność

Do dostawcy trafia minimalny zakres: potrzebny fragment rozmowy, dane produktu,
dane techniczne, niezbędny kontekst. Nie wolno przekazywać tokenów, haseł,
pełnych danych dostawy, zbędnych danych osobowych ani całej historii klienta
bez uzasadnienia.

## 15. Model danych

Tabele docelowe, nazwami z kodu:

```
channel_account          conversation            message
case                     case_conversation       conversation_event
conversation_assignment  conversation_comment    conversation_mention
conversation_draft       offer_snapshot          customer
customer_machine         order_snapshot          product_link
part                     part_identifier         machine_model
engine_model             fitment                 fitment_evidence
measurement              knowledge_document      knowledge_revision
zadanie_terenowe         zadanie_zalacznik       allegro_inbox_thread
allegro_inbox_message    allegro_inbox_sync_state
outbox                   events
```

Obecności agentów nie ma na tej liście świadomie — patrz §6.3.

### 15.1. Identyfikatory zewnętrzne

Identyfikator zewnętrzny przechowujemy zawsze razem z kanałem, kontem kanału,
środowiskiem i typem obiektu. Nie zakładamy wspólnej przestrzeni
identyfikatorów różnych zasobów.

### 15.2. Snapshoty

Snapshot trzymamy dla danych potrzebnych do historycznego zrozumienia
odpowiedzi: tytułu oferty, kluczowych parametrów, ceny, symbolu produktu
i danych, na których oparto dopasowanie. Dane aktualne i snapshot prezentujemy
oddzielnie.

## 16. API aplikacji

Repo ma dziś **dwie konwencje**: `/api/obsluga/*` dla skrzynki i
`/api/conversations/*` dla współbieżnej pracy na rozmowie. Projekt właściciela
proponował trzecią, `/api/customer-service/*`.

**Zostają istniejące.** Przemianowanie teraz zepsułoby panel i kolektor bez
zysku funkcjonalnego. Ujednolicenie jest długiem do spłacenia przy okazji
większej zmiany tras, nie osobno.

Zasoby docelowe (prefiksy do ujednolicenia):

```
GET    /api/obsluga/rozmowy
GET    /api/obsluga/rozmowy/:id
POST   /api/conversations/:id/claim
POST   /api/conversations/:id/assign
POST   /api/conversations/:id/snooze
POST   /api/conversations/:id/resolve
POST   /api/conversations/:id/comments
GET    /api/conversations/:id/draft
PUT    /api/conversations/:id/draft
POST   /api/conversations/:id/send
GET    /api/conversations/:id/context
POST   /api/obsluga/zadania/pomiar
GET    /api/zadania-terenowe
POST   /api/zadania-terenowe/:id/wez
POST   /api/zadania-terenowe/:id/wykonaj
GET    /api/products/search
GET    /api/obsluga/dopasowania/szukaj
POST   /api/obsluga/dopasowania/propozycje
POST   /api/obsluga/dopasowania/:id/zatwierdz
```

Każda mutacja przyjmuje oczekiwaną wersję rekordu. Konflikt wersji zwraca 409.

## 17. Architektura backendu

```
routes → application services → domain → repositories → SQLite, Allegro, Subiekt, AI
```

Trasy walidują wejście, sprawdzają uprawnienia, wołają przypadek użycia
i mapują błąd na HTTP. Logika domenowa nie mieszka w trasach.

Adaptery zewnętrzne: `AllegroMessagingAdapter`, `AllegroOffersAdapter`,
`SubiektProductsAdapter`, `KnowledgeRepository`, `AiProvider`,
`RealtimePublisher`.

## 18. Baza aplikacji

Zostajemy przy `node:sqlite`, dopóki instalacja jest pojedyncza, agentów jest
niewielu, synchronizacja działa w jednym procesie, zapisy są krótkie,
a konflikty rozstrzyga wersjonowanie.

Migrację na PostgreSQL rozważamy przy wielu instancjach backendu, wielu kontach
marketplace, intensywnej pracy agentów, dużej historii, rozbudowanym
wyszukiwaniu, wymaganiu wysokiej dostępności, osobnej analityce albo potrzebie
wyszukiwania wektorowego. Warstwa repozytoriów ma ograniczyć koszt tej
migracji.

## 19. Audyt

Każda istotna operacja zostawia typ zdarzenia, użytkownika, identyfikator
konta, czas, obiekt, wersję przed i po, powód (gdy wymagany), identyfikator
urządzenia i identyfikator żądania.

Audyt obejmuje przejęcie, przekazanie, komentarz, utworzenie i wykonanie
zadania, zatwierdzenie dopasowania, zmianę szkicu, próbę i sukces wysyłki,
niejednoznaczny timeout, konflikt świeżości, wymuszone przejęcie i eksport
danych.

**Treść wiadomości nie trafia do ogólnego dziennika zdarzeń.**

## 20. Bezpieczeństwo

Sesje użytkowników, role, najmniejsze wymagane uprawnienia, szyfrowanie
połączeń poza zaufanym LAN-em, tokeny Allegro niedostępne dla frontendu, brak
sekretów w logach, CSP dla panelu, ochrona przed XSS, bezpieczne renderowanie
treści i załączników, limit rozmiaru treści, limit częstotliwości mutacji,
ochrona przed podwójną wysyłką, walidacja MIME załączników, retencja danych
osobowych oraz możliwość eksportu i usunięcia danych.

## 21. Monitoring

`/api/health` raportuje stan połączenia Allegro, ostatnią próbę i ostatni
sukces synchronizacji, wiek lokalnych danych, liczbę błędnych wątków, status
429, czas następnej próby, liczbę rozmów oczekujących, liczbę zadań terenowych,
wiek najstarszego zadania, stan kolejki wysyłek, stan AI i stan integracji
Subiekta.

Panel pokazuje trwały alarm, gdy synchronizacja nie powiodła się przez więcej
niż dwa planowane interwały.

## 22. Metryki biznesowe

Czas do pierwszej odpowiedzi, czas do rozwiązania, rozmowy po terminie, liczba
przekazań, pytania wymagające pomiaru, czas realizacji zadania magazynowego,
udział dopasowań potwierdzonych, udział spraw wymagających dodatkowych danych,
liczba błędnych rekomendacji, zwroty z błędnego dopasowania, najczęściej
brakujące parametry ofert, produkty generujące najwięcej pytań oraz wpływ
uzupełnienia oferty na liczbę pytań.

**Metryki nie oceniają agentów liczbą wysłanych wiadomości.**

## 23. Testowanie

### 23.1. Backend

Mapowanie rzeczywistych fixture'ów Allegro, paginacja, idempotencja, restart
synchronizacji, 401, 403, 406, 429, timeout, błąd jednego wątku, wyścig
agentów, konflikt szkicu, nowa wiadomość podczas redagowania, podwójne
kliknięcie wysyłki, niejednoznaczny wynik POST, migracja starej bazy, audyt
każdej mutacji.

### 23.2. Frontend

Logowanie, kolejka, zmiana filtrów, otwarcie rozmowy, przejęcie, komentarz,
szkic, konflikt, nowa wiadomość, utworzenie zadania, wynik z magazynu, błąd
synchronizacji.

### 23.3. End-to-end

Najważniejszy scenariusz: Allegro zwraca nowe pytanie, synchronizator zapisuje
rozmowę, panel pokazuje ją w kolejce, agent przejmuje rozmowę, zleca pomiar,
kolektor pokazuje zadanie, magazynier je przejmuje i wpisuje wynik, wynik
pojawia się w panelu, agent aktualizuje szkic, klient dopisuje wiadomość,
pierwsza wysyłka dostaje konflikt, agent poprawia szkic, odpowiedź wychodzi
raz, a audyt zawiera cały przebieg.

## 24. Etapy wdrożenia

**A — fundament frontu:** podział na moduły, TanStack Query, React Router,
shadcn, walidacja, testy, wyszukiwarka produktu zamiast ręcznego `tw_id`.

**B — kontrakt Allegro:** oficjalna dokumentacja, fixture'y, potwierdzenie
oferty i autora, decyzja o retencji.

**C — skrzynka tylko do odczytu:** synchronizacja, lista rozmów, historia,
oferta, kartoteka, przypisanie agentów, komentarze, zadania z rozmowy.

**D — wysyłka:** szkic, kontrola świeżości, idempotencja, wysyłka, audyt,
obsługa niejednoznacznego timeoutu.

**E — dobór części:** modele urządzeń i silników, OEM, zamienniki, parametry,
pozytywne i negatywne zastosowania, dowody.

**F — Copilot:** klasyfikacja, ekstrakcja, OCR, brakujące dane, kandydaci,
porównanie, szkic z dowodami.

**G — automatyzacje:** priorytety, routing, terminy, odłożenie, sugestie
poprawy ofert, analiza powodów kontaktu, kolejne kanały.

## 25. Kryteria gotowości

Panel jest gotowy do codziennej pracy, gdy nowe pytanie pojawia się
automatycznie; rozmowa nie ginie po restarcie; wszystkie strony Allegro są
synchronizowane; agent widzi ofertę albo jawny brak powiązania; agent widzi
dane produktu; dwóch agentów nie odpowie przypadkowo jednocześnie; komentarz
wewnętrzny nie może trafić do klienta; wynik magazyniera wraca do właściwej
rozmowy; nowa wiadomość zatrzymuje nieaktualną wysyłkę; podwójne kliknięcie nie
tworzy dwóch odpowiedzi; automat nie wysyła bez człowieka; rekomendacja
techniczna pokazuje źródło; negatywne dopasowania są widoczne; awaria
synchronizacji jest jawna; każda mutacja ma autora i czas; system działa bez
Teamsa i Slacka; agent obsłuży typowe pytanie bez otwierania panelu Allegro.

## 25a. Zwroty klienckie

Rozdział dopisany w 0.150.0. Odpowiada na pytanie §6 z `docs/obsluga-klienta.md`
i opisuje drugi ekran obsługi — pierwszy poza skrzynką.

### 25a.1. Czym jest zwrot

Dwoma bytami o jednym numerze. Sprawa klienta żyje w Allegro: identyfikator,
zegar ustawowy, pieniądze. Proces magazynowy żyje w Subiekcie: paczka wraca,
korekta, MM na bufor. Panel spina oba i nie buduje trzeciego obiegu.

### 25a.2. Kolejka bramek

Ekran nie jest rejestrem. Praca dzieli się na kubełki, a w każdym stoi jedno
pytanie, więc operator nie wybiera akcji z menu — odpowiada.

| kubełek | pytanie | klawisze |
|---|---|---|
| DO DECYZJI | przyjąć czy odrzucić? | `P` `O` `J` |
| DO OCENY | co z towarem? | `S` `C` `U` |
| DO ZWROTU | ile oddać? | zaznaczenie + `Enter` |
| DO KOREKTY | zlecić korektę? | `Enter` `R` |
| ODRZUCONE, ZAMKNIĘTE | — | tylko wgląd |

Po decyzji kursor schodzi na następny wiersz. Strzałki chodzą po kolejce,
cyfry przełączają kubełek.

Przełączenie kubełka przestawia też kursor na jego pierwszy zwrot. Bez tego
jeden klawisz zmieniałby listę, a zaznaczenie zostawałoby na zwrocie
z poprzedniego kubełka — i trzeba by dokliknąć wiersz.

### 25a.3. Propozycja i sygnały

Wiersz przyjeżdża z policzoną propozycją kwoty, więc typowy zwrot to jeden
klawisz. Liczy ją serwer, panel niczego nie zgaduje.

**Kwota powstaje z ZAZNACZENIA (0.156.0).** Operator odhacza pozycje i koszt
dostawy, suma rośnie na oczach, a jedno kliknięcie ją zapisuje. Trzy warianty
z pierwszej wersji projektu — pełna, bez wysyłki, inna — zostały ETYKIETĄ
wyliczaną z zaznaczenia, a nie pozycją w menu.

Do serwera idzie samo zaznaczenie. Suma na ekranie jest podglądem: gdyby panel
wysyłał gotową liczbę, dałoby się oddać dowolną kwotę żądaniem z pominięciem
ekranu. Koszt dostawy bierze się z zamówienia — dociągamy je od 0.152.0
i dopiero to zdjęło blokadę opisaną wcześniej przy `sumaPozycji`.

Sygnały są trzy: termin ustawowy blisko, towar jeszcze nie wrócił, sprawa
rozstrzygnięta już w panelu Allegro. Czwarty z projektu — rozjazd liczby
sztuk — czeka na ocenę hali z 0.151.0.

Kolejność bierze się z terminu ustawowego, nie z daty wpływu.

### 25a.4. Układ

Trzy kolumny, jak §10.1: kolejka, pasek werdyktu z osią, dowody. Dwa ekrany
obsługi mają mieć jeden nawyk, nie dwa.

### 25a.5. Cofnięcie zamiast potwierdzenia

Potwierdzenie dostają dwie rzeczy nieodwracalne: oddanie pieniędzy i odmowa
zwrotu. Reszta ma cofnięcie, dopóki zapis czeka w kolejce.

### 25a.6. Zamówienie i zdjęcia

Zwrot niesie sam numer zamówienia, więc panel dociąga jego treść i pokazuje
**całe zamówienie**, zaznaczając pozycje, które wracają. „Kupił trzy, oddaje
jedną" jest kontekstem decyzji, a nie ciekawostką.

Stamtąd bierze się też koszt dostawy — składnik kwoty pełnej, którego zwrot
sam nie zna — oraz SKU sprzedawcy (`offer.external.id`), czyli mostek do
kartoteki Subiekta. Bez kartoteki nie ma zdjęcia: cache obrazów jest
kluczowany po `tw_id`.

**Automat proponuje, człowiek zatwierdza.** Dopasowanie po SKU niesie źródło
i czeka na jedno kliknięcie. Zero i wiele trafień daje brak, nigdy
zgadywanie; po nazwie towaru w KARTOTECE nie dopasowujemy nigdy.

**Pamięć wskazań (0.154.0).** Potwierdzenie zapamiętuje parę oferta–kartoteka,
a następny zwrot tej samej oferty dostaje ją bez pytania o zamówienie. To
jedyna zmiana, która realnie zdejmuje pracę powtarzalną; źródłem jest wtedy
człowiek, nie SKU, i ekran tak to podpisuje.

**Dopasowanie zapasowe idzie wyłącznie w obrębie jednego zamówienia.** Gdy
identyfikator nie trafia, a zamówienie ma dokładnie jedną pozycję — to jest ta
pozycja. Gdy ma kilka, liczy się dokładnie jedna o zgodnej nazwie. Zbiór ma
dwie do pięciu pozycji z tej samej transakcji, więc to nie jest zakazane
szukanie po nazwie wśród trzech tysięcy kartotek.

**Brak kartoteki niesie POWÓD.** Łańcuch ma sześć ogniw i do 0.153.1 każde
zerwane wyglądało identycznie. Ekran mówi teraz, które pękło: zwrot bez
zamówienia, zamówienie niepobrane, oferty nie ma w zamówieniu, oferta bez SKU,
SKU nie trafia w kartotekę, symbol zdublowany. Nad kolejką stoi licznik: ile
pozycji czeka i z jakiego powodu. Bez tych liczb nie da się powiedzieć, czy
problem jest w kodzie, czy w danych Allegro.

Zdanie o powodzie pisze SERWER. Druga kopia tej reguły w panelu rozjechałaby
się przy pierwszej poprawce jednej z nich, a rozjazd byłby niewidoczny.

Przy zamówieniu, którego jeszcze nie pobrano, stoi przycisk „Dociągnij teraz".
Bez niego diagnoza wymagała czekania dziesięciu minut na ticker. Przycisku nie
ma tam, gdzie Allegro nie podało numeru zamówienia: nie byłoby czego pobrać.

Zdjęcie widać w trzech miejscach: miniatura w wierszu kolejki, kafel przy
pozycji w kolumnie dowodów i powiększenie po kliknięciu. Kafel ma stały
rozmiar także wtedy, gdy zdjęcia nie ma — rosnący przesuwałby wiersze pod
kursorem.

### 25a.7. Odnośniki do Allegro

Numer zwrotu i zamówienie są klikalne i prowadzą do panelu sprzedawcy.
Identyfikator zamówienia jest UUID-em, więc obok stoi przycisk kopiowania —
nikt go nie przepisuje z ekranu ręcznie.

Oferta ma **własny, podpisany odnośnik** „Zobacz ofertę" przy każdej zwracanej
pozycji. Do 0.153.0 odnośnikiem była sama nazwa towaru: istniał, ale nikt go
tak nie czytał, bo podkreślenie nie mówi, dokąd prowadzi. Gdy Allegro adresu
nie podało, ekran mówi to wprost — milczenie wygląda na usterkę panelu, a jest
brakiem danych po drugiej stronie.

Adresy panelu nie są udokumentowane przez Allegro, więc stoją w konfiguracji
i noszą `[WERYFIKUJ]`. Bez adresu zostaje sam tekst: link donikąd jest gorszy
od jego braku.

### 25a.8. Czego panel nie wie

Kwoty pełnej nie znamy, dopóki zamówienie nie zostanie pobrane — i ekran mówi
to wprost, zamiast pokazywać sumę pozycji jako całość.

## 26. Decyzje do potwierdzenia

Ile kont Allegro podłączymy? Ilu agentów pracuje jednocześnie? Jak długo
przechowujemy treść rozmów? Czy obsługujemy też dyskusje? Czy wynik magazyniera
może zawierać zdjęcia? Kto zatwierdza nowe zastosowania części? Czy komentarze
wymagają wzmianek? Jaki jest wymagany czas odpowiedzi? Kiedy zamykamy rozmowę
automatycznie? Czy do pierwszego wydania wchodzi AI? Które katalogi producentów
są dostępne? Czy istnieje firmowa baza dopasowań? Czy panel zostaje
on-premise? Czy przewidujemy dostęp spoza sieci firmy? Czy Subiekt zostaje
jedynym ERP?

## 27. Zasady nadrzędne

1. Najpierw dane i dowody, potem automatyzacja.
2. Człowiek wysyła odpowiedź do klienta.
3. Automat nie jest źródłem kompatybilności.
4. Rozmowa, sprawa, dobór i zadanie są osobnymi bytami.
5. Każda mutacja ma autora.
6. Praca kilku agentów musi być bezpieczna.
7. Magazynier pracuje w aplikacji kolektora.
8. Wynik terenowy wraca do źródłowej rozmowy.
9. Negatywna wiedza jest równie cenna jak pozytywna.
10. Awaria integracji musi być widoczna.
11. Odpowiedź bez źródła nie udaje pewnego faktu.
12. E-mail Allegro jest powiadomieniem, nie źródłem danych.

## 28. Stan faktyczny — co już działa

Ta tabela jest po to, żeby następny agent nie zbudował drugi raz czegoś, co
stoi. W tym repo zdarzyło się to już dwa razy.

| Obszar | Stan | Gdzie |
|---|---|---|
| Konto kanału, rozmowa, wiadomość | **działa** od 0.144.0 | `channel_account`, `conversation`, `message` |
| Synchronizacja skrzynki Allegro | **działa** od 0.142.1 | `services/allegro-inbox-sync.ts` |
| Surowe lądowisko odpowiedzi kanału | **działa** | `allegro_inbox_thread`, `allegro_inbox_message` |
| Lista rozmów i oś czasu | **działa** od 0.143.0 | `services/skrzynka.ts`, `panel/src/skrzynka/` |
| Przejęcie rozmowy, właściciel | **działa** od 0.144.0 | `przejmijRozmowe`, `conversation.version` |
| Współdzielony szkic z wersją | **działa** od 0.144.0 | `conversation_draft` |
| Komentarze i wzmianki | **model gotowy**, brak ekranu | `conversation_comment`, `conversation_mention` |
| Obecność i „pisze" | **działa**, w pamięci | `services/conversation-realtime.ts` |
| Szyna zdarzeń do panelu | **działa** od 0.144.0 | `GET /api/conversations/events` |
| Zadania terenowe i kolektor | **działa** od 0.141.0 | `zadanie_terenowe`, `FieldTasksScreen.kt` |
| Wynik z hali na osi rozmowy | **działa** od 0.144.0 | `conversation_event`, `field_task_result` |
| Wyszukiwarka towaru w panelu | **działa** od 0.145.0 | `panel/src/wyszukiwarka.tsx` |
| Kartoteka wywiedziona z oferty | **działa** od 0.152.0 | `services/dopasowanie-sku.ts`, `offer.external.id` |
| Powód braku kartoteki i licznik | **działa** od 0.154.0 | `Dopasowanie.powod`, `bilansKartotek` |
| Pamięć wskazań oferta–kartoteka | **działa** od 0.154.0 | `oferta_kartoteka`, wzorzec `ean_alias` |
| Przestrzeń identyfikatora oferty w zwrocie | **niepotwierdzona** | złączenie po obu kolumnach, `poKolumnie` |
| Statusy rozmowy (§7) | **działa** od 0.157.0 | `conversation.status`, `services/statusy.ts` |
| Kubełki i skróty w skrzynce | **działa** od 0.157.0 | `panel/src/skrzynka/Kubelki.tsx`, `Decyzja.tsx` |
| Uchwyt rozmowy — przydział na czas oglądania | **działa** od 0.158.0 | `conversation-realtime.ts`, w pamięci |
| Odpowiedź przydziela rozmowę na stałe | **działa** od 0.158.0 | `services/wysylka.ts` |
| Statusy doboru (§7) | **projekt** | dobór to etap E, którego nie ma |
| Sprawa (`case`) | **projekt** | decyzja zapadła, tabeli nie ma |
| Wysyłka do Allegro (§8.5) | **działa** od 0.148.0 | `services/wysylka.ts`, `outbox` |
| Kształt POST wysyłki | **potwierdzony** w 0.151.0 | specyfikacja OpenAPI; limit 2000 znaków |
| Mapowanie odczytu skrzynki | **poprawione** w 0.151.0 | do 0.150.0 błędne w każdym polu |
| Kontrola świeżości i dialog 409 | **działa** od 0.148.0 | `skrzynka/DialogKonfliktu.tsx` |
| Baza wiedzy i dobór części (§11–12) | **projekt** | etapy E i dalsze |
| Copilot (§14) | **projekt** | etap F |
| Front na TanStack, Router, shadcn | **działa** od 0.146.0 | `panel/src/api/`, `panel/src/ui/` |
| Testy frontu (Vitest, Playwright) | **działa** od 0.146.0 | `panel/src/**/*.test.tsx`, `panel/e2e/` |
| Audyt mutacji rozmowy | **działa** od 0.145.1 | `logEvent` w `services/conversations.ts` |
| Status synchronizacji (§7) | **działa** od 0.147.0 | `statusSynchronizacji` |
| Trwały alarm synchronizacji (§21) | **działa** od 0.147.0 | `skrzynka/AlarmSynchronizacji.tsx` |
| Ekran przegranego przejęcia (§6.2) | **działa** od 0.147.0 | `skrzynka/KonfliktPrzejecia.tsx` |
| Wymuszone przekazanie z powodem | **działa** od 0.147.0 | `przekazRozmowe`, rola `admin` |
| Ręczne wskazanie oferty | **działa** od 0.147.0 | `wskazOferte`, `conversation_event` |
| Historia przypisań rozmowy | **działa** od 0.145.1 | `conversation_assignment` |
| Zwroty klienckie — odczyt i kolejka | **działa** od 0.150.0 | `services/zwroty.ts`, `panel/src/zwroty/` |
| Synchronizacja zwrotów z Allegro | **działa** od 0.150.0 | `services/allegro-zwroty-sync.ts` |
| Kształt zwrotów z dokumentacji, nie z sondy | **niepotwierdzony** | `[WERYFIKUJ]` w `docs/allegro-ksztalt.md` |
| Werdykt biura przy zwrocie | **działa** od 0.156.0 | `rozstrzygnijZwrot`, odmowa wymaga powodu |
| Ocena towaru przy zwrocie | **działa** od 0.156.0 | `ocenPozycje`, `stan`/`przecena`/`utylizacja` |
| Kwota do oddania | **działa** od 0.156.0 | `zapiszKwote`, suma z zaznaczenia po stronie serwera |
| Korekta i zamknięcie zwrotu | **projekt** | kolumny stoją, zapisu nie ma |
| Załączniki wiadomości | **działa** od 0.155.0 | `message_attachment`, `GET /api/obsluga/zalaczniki/:id` |
| Zamówienie klienta przy zwrocie | **działa** od 0.152.0 | `services/allegro-zamowienia-sync.ts` |
| Ręczne dociągnięcie zamówień | **działa** od 0.154.0 | `POST /api/obsluga/zwroty/zamowienia` |
| Zdjęcia towaru w panelu obsługi | **działa** od 0.152.0 | `panel/src/zwroty/useZdjecie.ts` |
| Odnośniki do panelu sprzedawcy | **niepotwierdzone** | `[WERYFIKUJ]`, wzorce w `ALLEGRO_PANEL_*` |
| Czyszczenie lądowisk z danych osobowych | **działa** od 0.152.0 | `services/allegro-oczyszczanie.ts` |
| Zwrot pieniędzy i odmowa w Allegro | **projekt** | `outbox`, `commandId` — 0.151.0 |
| Automat korekty przez Sferę | **projekt** | kontrakt `korekta_zwrot` żyje, brak nadawcy |
