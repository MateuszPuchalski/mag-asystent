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

**Roli eksperta technicznego NIE MA** — decyzja właściciela z etapów E1 i E2.
Projekt przewidywał osobną rolę do zatwierdzania zastosowań, odrzucania błędnych
dopasowań i rozstrzygania konfliktów między źródłami. Robi to każdy z biura,
także autor propozycji. Autor i zatwierdzający są zapisani osobno, więc widać,
gdy to ta sama osoba. Automat nie zatwierdza nigdy.

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

#### 6.1.1. Sprawa w kodzie (0.161.0)

Sprawa jest KLAMRĄ: ma tytuł i listę rozmów, nic więcej. Nie ma statusu, bo §7
go dla niej nie zna, i nie ma własnej osi, bo zdarzenia wiszą przy ŹRÓDLE —
blizna z 0.130.0 mówi, że historia sprawy ginęła przy scalaniu.

Rozmowa należy do CO NAJWYŻEJ JEDNEJ sprawy i pilnuje tego klucz główny, nie
dyscyplina serwisu. Odmowa przy drugiej sprawie niesie tytuł tej pierwszej,
żeby agent wiedział, co odkleić. Sklejenie to jeden wiersz, rozklejenie to jego
skasowanie — poprzednia odpowiedź o tym samym kształcie kosztowała cztery
tabele nakładki plus ręczne SCAL i ROZKLEJ (`docs/obsluga-klienta.md`,
pytanie 1).

Sklejenie i rozklejenie widać na osi każdej rozmowy, której dotyczyło. Ekranu
sprawy nie ma: pasek nad rozmową pokazuje tytuł i rodzeństwo, bo to jedyne
pytanie, na które sprawa dziś odpowiada.

### 6.2. Przypisanie

Rozmowa jest nieprzypisana, przypisana do agenta, przypisana do zespołu,
przekazana koledze z biura, odłożona albo zakończona.

**Przejęcie jest atomowe.** Gdy dwóch agentów spróbuje przejąć tę samą rozmowę,
uda się jeden zapis. Drugi dostaje konflikt z aktualnym właścicielem, czasem
przejęcia i bieżącą wersją rozmowy.

**Dwa rodzaje przydziału (0.159.0).** Decyzja właściciela: samo wejście agenta
w pytanie przydziela mu je NA CZAS SIEDZENIA, a odpowiedź — na stałe.

| przydział | co go daje | jak długo trwa | gdzie żyje |
|---|---|---|---|
| tymczasowy (uchwyt) | wejście w rozmowę | do wyjścia albo do wygaśnięcia | pamięć procesu |
| trwały | odpowiedź do klienta albo „Przejmij" | do przekazania | `conversation.assigned_user_id` |

Uchwyt trzyma PIERWSZY, który wszedł, nie ostatni: inaczej kolega otwierający
rozmowę „na chwilę" odbierałby ją komuś w połowie pisania odpowiedzi.

Wysyłka odpowiedzi na rozmowę nieprzypisaną nie wymaga już osobnego przejęcia.
Do 0.158.0 agent, który wszedł w pytanie i napisał odpowiedź, dostawał na
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

Ten akapit napisano w 0.141.0, a w 0.159.0 dostał zastosowanie: to na nim
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

#### 6.4.1. Skrzynka wzmianek (0.160.0)

Wzmianka jest prośbą o zajęcie się czymś, więc musi mieć własną drogę do
adresata. Do 0.158.0 wracała wyłącznie do tego, kto sam otworzył właściwą
rozmowę — kto nie zgadł którą, nie dowiadywał się nigdy.

Zakładka „Wzmianki" pokazuje wzmianki JEDNEGO konta; adresat bierze się
z sesji, nigdy z parametru żądania. Licznik nieodhaczonych stoi przy zakładce,
bo prośba kolegi ma być widoczna z każdego ekranu panelu.

Odhaczenie jest jawnym kliknięciem wzmiankowanego. Nie robi tego ani otwarcie
listy, ani wejście do rozmowy: obowiązuje reguła „zero zapisu przy patrzeniu",
a wzmianka gasnąca od samego spojrzenia ginęłaby przy przewijaniu listy.
Odhacza się PARĘ komentarz–osoba, bo dwoje wzmiankowanych w jednym zdaniu ma
z nim dwie różne sprawy. Odhaczone zostają na liście jako dowód.

## 7. Statusy

**Rozmowa:** `new`, `open`, `waiting_for_customer`, `waiting_for_internal`,
`snoozed`, `resolved`, `closed`, `spam`.

**Dobór:** `not_started`, `extracting_data`, `missing_information`, `searching`,
`candidates_found`, `requires_expert`, `confirmed`, `rejected`,
`not_applicable`.

**Szkic:** `none`, `draft`, `needs_review`, `ready`, `sending`, `sent`,
`send_uncertain`, `send_failed`.

**Synchronizacja** ma status niezależny od rozmowy: `current`, `delayed`,
`rate_limited`, `authentication_error`, `failed`.

### 7.1. Statusy rozmowy w kodzie (0.158.0)

Lista rozmowy stoi w trzech miejscach naraz: `STATUSY_ROZMOWY`
w `services/conversations.ts`, `CHECK` na kolumnie `conversation.status`
i typ `StatusRozmowy` w panelu. Każda kopia pilnuje innej granicy — typów,
API i bazy — a rozjazd wychodzi przy kompilacji albo przy zapisie.

Pięć przejść dzieje się SAMYCH, bez agenta:

- przejęcie rozmowy prowadzi `new` → `open`;
- wysłana odpowiedź prowadzi do `waiting_for_customer`;
- przychodząca wiadomość klienta budzi rozmowę do `open`;
- zlecony pomiar prowadzi do `waiting_for_internal` (0.159.0);
- wynik z hali zdejmuje ten stan z powrotem do `open` (0.159.0).

Dwa ostatnie doszły później i nie są dodatkiem: do 0.158.0
`waiting_for_internal` stał w liście dopuszczonych wartości bez ani jednego
nadawcy. Agent musiał wybrać go ręcznie, choć fakt — zlecenie pomiaru — już
się wydarzył.

Budzenie omija `closed` i `spam`. To jawne werdykty człowieka, a automat,
który je cofa, kazałby zamykać tę samą rozmowę w kółko.

Odłożenie wymaga terminu i kończy się SAMO — liczymy to przy odczycie, bez
tickera. Rozmowa po minionym terminie wraca jako `open` i niesie znacznik
„po terminie", bo inaczej niczym nie różniłaby się od świeżo otwartej.

Zamknięcia automatycznego po N dniach NIE MA. §26 wymienia je wśród pytań
do właściciela; do czasu decyzji rozmowę zamyka wyłącznie człowiek.

### 7.2. Statusy doboru w kodzie (etap E1)

Lista doboru stoi, jak lista rozmowy, w trzech miejscach: `STATUSY_DOBORU`
w `services/dobor.ts`, `CHECK` na kolumnie `dobor_rozmowy.status` i typ
`StatusDoboru` w panelu. Brak wiersza `dobor_rozmowy` znaczy `not_started`
i liczy się przy odczycie. Otwarcie zakładki niczego nie wstawia.

`extracting_data` nie ma w etapie E nadawcy. To stan, w którym Copilot wyciąga
dane z pytania klienta (etap F). Człowiek dane wpisuje, nie wyciąga, więc
serwis odrzuca ten status z ręki. `CHECK` zostawia go na liście, żeby etap F
nie przebudowywał tabeli.

Trzy przejścia dzieją się SAME:

- pierwszy zapis danych wejściowych prowadzi `not_started` → `searching`;
- wybór kandydata prowadzi do `candidates_found`, z każdego stanu;
- zdjęcie wyboru przy `confirmed` cofa do `candidates_found`.

`confirmed` wymaga wybranej kartoteki. `missing_information` niesie notatkę,
czego dopytać; wyjście z tego stanu ją kasuje. Zatwierdza każdy z biura.
Roli „ekspert" nie ma decyzją właściciela, a automat nie zatwierdza nigdy.

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

**Ekran mieści się w OKNIE, a przewijają się kolumny (0.165.0).** Do 0.164.0
przewijał się dokument, czyli wszystkie kolumny naraz: żeby dojść do dołu
dowodów przy zwrocie, operator zjeżdżał z oczu kolejce i paskowi decyzji.
Makieta `docs/projekt-widokow/Main.dc.html` rysowała to poprawnie od początku.

**Skrzynka ma trzy kolumny od 0.180.0.** Do 0.179.0 miała dwie, a kontekst —
oferta, towar i zamówienie — leżał w środkowej, nad osią. Cztery bloki jeden
pod drugim spychały pytanie klienta poniżej krawędzi okna, czyli chowały to,
po co agent otwiera rozmowę. Kolumna kontekstu ma DWIE zakładki: „Oferta"
i „Towar". Trzech pozostałych z makiety — „Dobór", „Klient", „Wiedza" — nie ma,
bo nie mają skąd wziąć danych; wchodzą razem z etapem E.

Blokada zaczyna się od szerokości `lg`. Niżej grid jest jednokolumnowy, a trzy
scrollery po dwieście pikseli czytałoby się gorzej niż jedną przewijaną stronę;
widok wąski jest osobnym ekranem (§10.5), nie tym samym w miniaturze.

### 10.2. Lista rozmów

Wiersz pokazuje kanał, klienta, fragment ostatniej wiadomości, czas
oczekiwania, ofertę lub produkt, właściciela, priorytet, termin, liczbę nowych
wiadomości, status doboru i oczekujące zadanie terenowe.

**Wiersz uzupełniony w 0.181.0: priorytet, czas oczekiwania, licznik dopisków
klienta i znak oczekującego zadania.** Jednej pozycji z listy wyżej dalej nie
ma i to jest decyzja, nie przeoczenie. TERMIN odpowiedzi czeka na
rozstrzygnięcie z §26 — bez niego byłby zmyślony.

**Status doboru doszedł w etapie E1.** Wiersz milczy przy `not_started`
i `not_applicable`: plakietka „nierozpoczęty" na każdym wierszu nie mówiłaby
niczego, a „nie dotyczy" to wiersz, przy którym doboru nie trzeba robić.

**Licznik mówi to, co mierzy.** To liczba wiadomości klienta od NASZEJ
ostatniej odpowiedzi, nie „nieprzeczytane przez agenta". Tamtego policzyć się
nie da: Allegro oddaje samą flagę wątku, a nasza baza nie ma znacznika odczytu.
Nazwa na ekranie idzie za tym, co liczba naprawdę zlicza.

**Kolejność listy: PILNE, potem najdłużej czekające pytanie.** Właściciel
wybrał obie drogi naraz — ręczna flaga przebija automatyczną kolejność. Flaga
jest ręczna, bo bez terminu odpowiedzi automat wyliczyłby z niej tylko „stare",
a reklamacja z zegarem ustawowym nie wyprzedziłaby zwykłego pytania.

**Fragment to ostatnia wiadomość KLIENTA, z jej datą (0.167.0).** Do 0.165.0
wiersz brał ostatnią wiadomość jakąkolwiek, więc autoodpowiedź konta Allegro
zasłaniała pytanie, a data pod nią była datą wątku. Gdy klient nic nie napisał,
stoi nasza wiadomość z podpisem „Biuro". Kolejność listy dalej niesie datę
wątku — tę samą, którą właściciel widzi w panelu sprzedawcy.

### 10.3. Oś rozmowy

Oś zawiera wiadomości klienta, odpowiedzi firmy, komentarze wewnętrzne, zmiany
przypisania, zmianę statusu, utworzenie zadania, przejęcie przez magazyniera,
wynik magazyniera oraz przygotowanie i wysłanie odpowiedzi. Każdy rodzaj
zdarzenia wygląda inaczej.

### 10.4. Edytor odpowiedzi

**Rozdzielenie trybów (0.157.0).** Przełącznik ma dwa tryby i każdy ma WŁASNE
pole oraz własny przycisk. W trybie komentarza przycisk wysyłki nie istnieje
w drzewie — wyłączony da się kliknąć, gdy stan rozjedzie się o ułamek sekundy;
nieistniejącego nie da się nigdy. Osobne pola znaczą też, że przełączenie
trybu nie przenosi notatki do szkicu, który idzie do klienta.

Komentowanie NIE wymaga prowadzenia rozmowy: notatka zespołu to nie odpowiedź,
a kolega ma prawo dopisać „to ten sam klient co wczoraj" bez przejmowania
sprawy.

Zwykły tekst, szablony, szkic ze sztucznej inteligencji, licznik znaków,
podgląd, historia wersji, ostrzeżenie o zmianie rozmowy, wstawienie wyniku
magazyniera, wstawienie parametrów produktu i przełączenie na komentarz
wewnętrzny.

**Z tej listy działa w 0.190.0:** licznik znaków, ostrzeżenie o dopisku
klienta, wstawienie wyniku magazyniera, wstawienie zdania doboru ze źródłem,
wstawienie parametrów produktu i przełączenie trybu.

Wstawka parametrów bierze tożsamość towaru i dostępność. NIE bierze półki,
rezerwacji ani rozbicia na magazyny. Szkic czyta klient, a adres regału mówi
obcemu, jak zbudowany jest nasz magazyn.

Nie ma szablonów, podglądu ani historii wersji szkicu. Szkicu ze sztucznej
inteligencji nie ma i nie będzie przed etapem F.

**Przycisk komentarza i przycisk wysyłki do klienta są jednoznacznie
rozdzielone.**

### 10.5. Widok mobilny

**Zdjęty z planu decyzją właściciela (0.181.1).** Panel obsługi pracuje na
monitorach biura; telefon nie jest stanowiskiem pracy agenta. Poniżej
szerokości `lg` kolumny stają jedna pod drugą i przewija się cała strona — to
wystarcza na podgląd, a osobnego ekranu z przyciskiem powrotu nie będzie.

Pierwotny projekt zostaje dla historii: lista jako osobny ekran, otwarcie
rozmowy ją zastępuje, kontekst jako panel albo zakładka, szkic nie ginie przy
powrocie. Gdyby decyzja wróciła, to jest punkt wyjścia.

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

**Co działa od etapu E1.** Dobór wisi przy rozmowie w tabeli `dobor_rozmowy`
(nie `dopasowanie` — tę nazwę `migrate()` kasuje). Agent wpisuje dane §11.1,
widzi kandydatów i wybiera kartotekę. Kandydatów daje `services/kandydaci.ts`
z czterech szczebli: dokładny symbol, EAN, kartoteka oferty, zamiennik z opisu.
Zastosowanie doszło w E2, numer OEM i pełny tekst w E3. Wyszukiwanie
semantyczne nie ma szczebla w kodzie — czeka na F.
Każdy szczebel mówi, czy był sprawdzony; pominięty niesie powód. Wyszukiwarka
klikana ręcznie nie jest kandydatem, tylko wyborem z drogą `wyszukiwarka`.
Furtki na literówki dobór nie używa — blizna „szarpaka".

Zdanie do szkicu pisze serwer, ze źródłem (§14.3). Dobór zatwierdzony przez
agenta to wciąż dobór, nie potwierdzone zastosowanie — wiedza idzie w E2.

**Co działa od etapu E3.** Numer OEM czyta się z tabeli `towar_identyfikator`,
odbudowanej z opisów kartotek po każdym imporcie (sekcje `OEM:`, `Nr. oryg.`,
`Stare SKU`). Numer bez kartoteki nie znika: staje się kandydatem bez wiersza,
bez stanu i bez przycisku Wybierz. Decyzja właściciela: „nie mamy tego" jest
odpowiedzią dla klienta, a puste miejsce na liście nią nie jest. Pełny tekst
to indeks FTS5 `towar_fts` po symbolu, nazwie i opisie, z rankingiem bm25.
Pyta wyłącznie o dane wpisane przez agenta, nigdy o treść wiadomości (blizna
„szarpaka"). Marka i model podnoszą ranking, ale go nie warunkują. Trafienie
po treści ma pewność „wymaga danych" — to podpowiedź, nie dowód. Bez FTS5
w SQLite szczebel jest pominięty z powodem, a karta pokrycia to pokazuje.

### 11.3. Poziomy pewności

Dopasowanie bywa potwierdzone przez producenta, katalogiem dostawcy, pomiarem
własnym, decyzją biura, wcześniejszą sprzedażą i weryfikacją; albo jest
prawdopodobne, wymagające danych lub odrzucone. Interfejs pokazuje źródło
i poziom pewności.

**Rodzaje dowodu w kodzie (E2):** `producent`, `katalog_dostawcy`,
`pomiar_wlasny`, `sprzedaz_weryfikacja`, `decyzja_biura`, `rozmowa`. Lista
stoi w `RODZAJE_DOWODU` (`services/wiedza.ts`), w `CHECK` na kolumnie
`dowod_zastosowania.rodzaj` i w typie panelu. `decyzja_biura` stoi tam, gdzie
projekt pisał „ekspert" (§5). `rozmowa` to ślad — „dobór zatwierdzony
w rozmowie" — nie dowód techniczny.

**Pewność zastosowania** jest `potwierdzone`, gdy stoi za nim choć jeden dowód
techniczny; same ślady rozmów dają `prawdopodobne`. Liczba śladów rozmów
pewności nie podnosi. Makieta mówiła „z najsłabszego dowodu" — brane dosłownie
karałoby za dopisanie śladu rozmowy do katalogu producenta, więc reguła jest
inna i zapisana tu świadomie.

### 11.4. Negatywne dopasowania

Przechowujemy również wiedzę, że część nie pasuje, pasuje tylko do innego
wariantu, ma niewłaściwy rozstaw, ma właściwą średnicę przy innym sposobie
mocowania, występuje pod mylącym oznaczeniem albo wymaga dodatkowego pomiaru.

Negatywne dopasowanie jest istotnym ostrzeżeniem, nie brakiem danych.

**Powody w kodzie (E2):** `nie_pasuje`, `tylko_inny_wariant`,
`niewlasciwy_rozstaw`, `srednica_ok_inne_mocowanie`, `mylace_oznaczenie`,
`wymaga_pomiaru`. Negatyw bez powodu nie istnieje — pilnuje tego `CHECK`
sprzęgający obie kolumny. Negatyw pokazuje się przy kandydacie jako
ostrzeżenie i osobno, bo dotyczy także kartoteki, której nie ma na liście.
Wycofać go może tylko człowiek i tylko z powodem (§14.2).

## 12. Baza wiedzy

Projekt wymieniał dziesięć bytów: `Manufacturer`, `MachineModel`,
`EngineModel`, `Part`, `PartIdentifier`, `Fitment`, `FitmentEvidence`,
`Measurement`, `KnowledgeDocument`, `KnowledgeRevision`. Kod ma PIĘĆ tabel,
nazwami z kodu: `model_urzadzenia`, `zastosowanie`, `dowod_zastosowania` (E2)
oraz `towar_identyfikator` i `model_z_opisu` (E3). Każda z pozostałych byłaby
dziś tabelą bez czytelnika — blizna 0.157.0. Nazwa `dopasowanie` jest spalona
(§15) i nie wraca.

**Model** trzyma maszynę i silnik w jednej tabeli z `rodzaj`. Klucz liczy
`zwin()` z marki, nazwy i wariantu, więc jedna kosiarka to jeden wiersz.

**Zastosowanie** wiąże kartotekę z modelem i mówi, czy część pasuje, czy nie.
Cykl życia: `propozycja` → `zatwierdzone` | `odrzucone` | `wycofane`.
Propozycję składa dobór (automatycznie, przy zatwierdzeniu z marką i modelem),
pomiar z hali (na kliknięcie) albo biuro ręcznie. Źródło `opis` ma nadawcę
od E3 — człowieka na liście „Z opisów"; `copilot` czeka na F.
Rozstrzyga wyłącznie człowiek z biura,
także autor propozycji. Zatwierdzenie wymaga choć jednego dowodu.

**Dowód** przechowuje rodzaj (§11.3), treść, odnośnik, zadanie i rozmowę,
autora i datę. Tabela jest append-only: dowodu nie da się poprawić po cichu.

**Historia wersji** bez `KnowledgeRevision`: poprawka to nowy wiersz
z `zastepuje_id`, a stary schodzi na `wycofane` przy zatwierdzeniu nowego.
Dziennik `events` niesie pełny wiersz przy każdej zmianie.

**Identyfikatory** (`towar_identyfikator`, E3) to numery OEM, numery
oryginału, katalogi obce i stare SKU. Z opisu biorą się po każdym imporcie
(źródło `opis`, przebudowa je odtwarza); z ręki biura — z katalogu, którego
w opisie nie ma (źródło `reczne`, przebudowa je omija). Tabela nie ma klucza
obcego do `sgt_towar`, bo import wycina read-model.

**Z opisów** (`model_z_opisu`, E3). Sekcje `Modele:` z opisów kartotek
trafiają na osobną listę na ekranie Wiedza, nie do kolejki propozycji.
Automat nie proponuje z opisu — decyzja właściciela: `FS350 FS400` nie mówi,
czyja to maszyna. Człowiek wskazuje markę i model, dopiero to tworzy
propozycję ze źródłem `opis` i dowodem `decyzja_biura`. Odrzucony wiersz
zostaje w tabeli i nie wraca po imporcie.

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
Utrwalenie go jako wiedzy wymaga zatwierdzenia. Od E2 robi to przycisk
w zakładce Dobór: wynik idzie do kolejki jako dowód `pomiar_wlasny` wskazujący
zadanie. Gdy para kartoteka–model już czeka albo stoi, pomiar dopisuje się do
niej jako kolejny dowód.

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
decyzję biura. Brak źródła oznacza treść jako przypuszczenie.

### 14.4. Prywatność

Do dostawcy trafia minimalny zakres: potrzebny fragment rozmowy, dane produktu,
dane techniczne, niezbędny kontekst. Nie wolno przekazywać tokenów, haseł,
pełnych danych dostawy, zbędnych danych osobowych ani całej historii klienta
bez uzasadnienia.

### 14.5. Co działa: klasyfikacja wiadomości (etap F, przyrost pierwszy)

Pierwsza rzecz z §14.1 i pierwsze miejsce, z którego treść rozmowy wychodzi
poza firmę. Agent klika przycisk NAD KOLEJKĄ, a partia bierze nierozpoznane
rozmowy z oglądanego kubełka. Przycisku w pojedynczej rozmowie nie ma
świadomie: etykietowałby treść, którą agent właśnie przeczytał.

Słownik ma osiem wartości: `dobor`, `dostepnosc`, `wysylka`, `zwrot`,
`reklamacja`, `dokumenty` oraz dwa kosze. `inne` znaczy „słownik jest za
krótki”, `nie_wiadomo` — „za mało treści, przeczytaj sam”. Kolumna `kategoria`
nie ma `CHECK`-a, bo w SQLite rozszerzenie zamkniętej listy to przebudowa
tabeli (blizna 0.135.0). Listy pilnuje serwis, a na ekranie — `Record`
z nazwami po polsku.

**Kategoria nie przestawia kolejki i to jest decyzja.** Klucze kolejności —
ręczna flaga „pilne” i czas oczekiwania klienta — są faktami. Kategoria jest
przypuszczeniem maszyny, a jedna pomyłka zakopałaby prawdziwe pytanie na dole
listy. Ekran daje plakietkę, pasek liczników i filtr; regułę kolejności wolno
dołożyć w etapie G, gdy pomiar trafności ją uzasadni.

**Prywatność ma dwa zamki.** Pierwszy jest w typie: nadawca przyjmuje wyłącznie
`TrescBezpieczna`, a ten typ umie wyprodukować tylko `zamaskuj()`. Drugi to
asercja tuż przed wysyłką. Maskowanie wycina e-mail, telefon, kod pocztowy
z miastem, wiersz z markerem adresu, ciąg szesnastu cyfr i login kupującego.
Znacznik zostaje, żeby model wiedział, że coś tam było.

**Gdzie kończy się gwarancja.** Adres bez markera i bez kodu pocztowego
przejdzie — rozpoznawanie adresów w wolnym tekście wyrażeniami regularnymi nie
jest zadaniem rozwiązywalnym. W drugą stronę: numer OEM zapisany jak telefon
zniknie jako `[telefon]`. Klasyfikacji ten numer nie jest potrzebny, ale
przyrost ekstrakcji będzie musiał tę regułę zawęzić. Pilnuje tego test.

**Zużycie zapisujemy od pierwszego wywołania**, w tokenach, nie w złotówkach.
Kwota w bazie jest kłamstwem od dnia zmiany cennika; liczba tokenów jest
faktem na zawsze. Osobna księga `copilot_wywolanie` liczy też próby nieudane,
bo one kosztują i nie dają odpowiedzi. Trafność mierzy werdykt człowieka
(`ocena`) przy plakietce w otwartej rozmowie. Podsumowanie za zębatką zawsze
podaje `n` i liczbę nieocenionych.

Limit dostawcy zatrzymuje partię czysto: wcześniejsze wyniki zostają, trasa
oddaje 200 z wypełnionym polem `przerwane`. Zły klucz zatrzymuje ją od razu.
Ponowień nie ma, bo tickera nie ma i limit obsługuje człowiek.

Copilot jest **wyłączony domyślnie**, a brak klucza nie zatrzymuje startu.
Klucz stoi wyłącznie w `ANTHROPIC_API_KEY` i nie ma go w konfiguracji serwera
(blizna 0.84.1).

## 15. Model danych

Tabele docelowe, nazwami z kodu:

```
channel_account          conversation            message
sprawa_klienta           sprawa_klienta_rozmowa  conversation_event
conversation_assignment  conversation_comment    conversation_mention
conversation_draft       offer_snapshot          customer
customer_machine         order_snapshot          product_link
dobor_rozmowy            model_urzadzenia        zastosowanie
dowod_zastosowania       towar_identyfikator     model_z_opisu
towar_fts                knowledge_document      zadanie_terenowe
zadanie_zalacznik        allegro_inbox_thread    allegro_inbox_message
allegro_inbox_sync_state outbox                  events
klasyfikacja_rozmowy     copilot_wywolanie
```

Projektowy `part_identifier` nazywa się w kodzie `towar_identyfikator`
(precedens `sprawa_klienta`). `towar_fts` to tabela wirtualna FTS5 tworzona
w `migrate()`, nie w `schema.sql`: bez FTS5 w SQLite start ma przeżyć,
a szczebel pełnego tekstu ma się pominąć z powodem.

Obecności agentów nie ma na tej liście świadomie — patrz §6.3.

**Sprawa nazywa się `sprawa_klienta`, nie `case` (0.161.0)** i ma to dwa
powody. `case` jest słowem kluczowym SQLite, więc każde zapytanie musiałoby ją
cytować. Samo `sprawa` jest nazwą SPALONĄ: `migrate()` kasuje tę tabelę przy
każdym starcie, bo stoi na liście nakładek po starej implementacji, którą bazy
klientów muszą stracić. Tabela nazwana tak samo powstałaby ze `schema.sql`
i znikała sekundę później, bez błędu. Ten sam powód dał wcześniej
`zwrot_klienta` zamiast `zwrot`; pilnuje tego `db/migracja-sprawy.test.ts`.

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
GET    /api/obsluga/rozmowy/:id/dobor/kandydaci
PUT    /api/obsluga/rozmowy/:id/dobor/dane
POST   /api/obsluga/rozmowy/:id/dobor/status
POST   /api/obsluga/rozmowy/:id/dobor/wybor
GET    /api/obsluga/rozmowy/:id/dobor/wiedza
POST   /api/obsluga/rozmowy/:id/dobor/pomiar-do-wiedzy
GET    /api/obsluga/wiedza/kolejka
GET    /api/obsluga/wiedza/modele
GET    /api/obsluga/wiedza/towar/:twId
POST   /api/obsluga/wiedza/propozycje
POST   /api/obsluga/wiedza/:id/rozstrzygnij
POST   /api/obsluga/wiedza/:id/wycofaj
POST   /api/obsluga/wiedza/:id/dowody
GET    /api/obsluga/wiedza/z-opisow
POST   /api/obsluga/wiedza/z-opisow/:id/przerob
POST   /api/obsluga/wiedza/z-opisow/:id/odrzuc
GET    /api/obsluga/wiedza/identyfikatory/:twId
POST   /api/obsluga/wiedza/identyfikatory
GET    /api/obsluga/pokrycie-wiedzy
```

Trasy doboru działają od E1, trasy wiedzy od E2. Projekt właściciela pisał
`dopasowania/*` — adres zmienił się razem z nazwą tabeli: `dopasowanie` jest
spalone i nie wraca nawet w URL-u.

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
a konflikty rozstrzyga wersjonowanie. Wyszukiwanie pełnotekstowe (E3)
pokrywa FTS5 wbudowane w `node:sqlite`; progiem PostgreSQL zostaje
wyszukiwanie wektorowe.

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

Od 0.168.0 pełna tabela tych trzynastu pozycji mieszka **za zębatką**, na
ekranie `/obsluga/ustawienia`. Ekran pracy niesie to, co woła o reakcję:
pigułkę synchronizacji w nagłówku i trwały alarm nad kolejką. Sama tabela
opisuje tło i czyta się ją rzadko — zasada 10 mówi o widocznej AWARII, nie
o widocznej diagnostyce.

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
porównanie, szkic z dowodami. Przyrost pierwszy — klasyfikacja wiadomości —
stoi; opisuje go §14.5. Reszta czeka.

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

Dwa kryteria o wiedzy stoją od E2. Rekomendacja pokazuje źródło: kandydat
drogą `zastosowanie` i zdanie do szkicu cytują dowód z bazy wiedzy. Negatywne
dopasowania widać w zakładce Dobór osobno i jako ostrzeżenie przy kandydacie.

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
| DO KOREKTY | jaki numer korekty? | `Enter` `R` |
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

**Oddajemy dostawę, którą klient WYBRAŁ** — decyzja właściciela z 3 września
2026. Kwotą jest `dostawa_grosze` z zamówienia, czyli to, co klient naprawdę
zapłacił za swoją opcję.

Pytanie było realne, bo ustawa pozwala oddać mniej. Gdy klient wybrał opcję
droższą niż najtańsza zwykła, sprzedawca nie musi dopłacać różnicy. Oddajemy
więcej świadomie: tak samo rozlicza to Allegro, a liczenie najtańszej opcji
wymagałoby cennika oferty, którego przy zwrocie nie mamy.

Sygnały są trzy: termin ustawowy blisko, towar jeszcze nie wrócił, sprawa
rozstrzygnięta już w panelu Allegro. Czwarty z projektu — rozjazd liczby
sztuk — czeka na ocenę hali z 0.151.0.

Kolejność bierze się z terminu ustawowego, nie z daty wpływu.

### 25a.4. Układ

Trzy kolumny, jak §10.1: kolejka, produkty ze zwrotu, dowody. Dwa ekrany
obsługi mają mieć jeden nawyk, nie dwa.

**Zakładki przy rozmowie, sekcje przy zwrocie (0.180.0).** Kolumna dowodów
zwrotu to jedna lista faktów o jednej sprawie i czyta się ją w całości.
Kolumna kontekstu rozmowy niesie dwa RÓWNORZĘDNE tematy — czego klient chce
i co mamy na półce — a sekcje kazałyby przewijać obok tego, którego akurat
nie czytasz. „Jeden nawyk" obowiązuje dalej dla układu trzech kolumn, ich
szerokości i przewijania; różni się to, co stoi w środku trzeciej.

**Produkty stoją w GŁÓWNYM oknie (0.167.0).** Do 0.165.0 leżały w prawej
kolumnie, szerokiej na 340 px: nazwy ucinały się w połowie, zdjęcia miały
56 px, a najszersza kolumna świeciła pustką pod paskiem decyzji. Teraz środek
niesie towar, a prawa kolumna została kolumną dowodów o ZWROCIE: zegar
ustawowy, numery, zamówienie klienta, fakt powrotu paczki.

**Akcja stoi na wierszu produktu.** Kubełki DO OCENY i DO ZWROTU wypisywały
wcześniej te same pozycje drugi raz, jako gołe nazwy z przyciskami — bez
zdjęcia, bez powodu zwrotu, bez kartoteki. Operator oceniał towar, patrząc
na listę, która towaru nie pokazywała. Pasek decyzji zostaje przy tym, co
dotyczy CAŁEGO zwrotu: werdykt, korekta, cofnięcie.

### 25a.4a. Korekta i zamknięcie (0.162.0)

Korektę wystawia człowiek w Subiekcie, a panel zapisuje jej NUMER — i to nie
jest półśrodek w drodze do automatu. Zadanie `korekta_zwrot` w kolejce Sfery
potrzebuje identyfikatora dokumentu SPRZEDAŻY, a read-model Subiekta trzyma
wyłącznie zakupy (FZ, PZ). Bez tego identyfikatora automat musiałby go zgadywać.

Zapisany numer zamyka zwrot i zdejmuje go z kolejki pracy. Zamknięcie znaczy
„nasza część jest zrobiona", nie „klient dostał przelew": pieniądze oddaje
człowiek w panelu Allegro i ekran mówi to wprost przy przycisku.

Numer przepisuje się ręką, więc literówka jest zdarzeniem normalnym.
Cofnięcie korekty jest JEDYNĄ operacją dozwoloną na zwrocie zamkniętym
i przywraca go do DO KOREKTY — werdykt, oceny i kwota zostają.

### 25a.4b. Rabat transakcyjny (0.164.0)

Zwrot prowizji od sprzedaży. Do tego wydania firma odzyskiwała go klikając
ręcznie przy KAŻDYM zwrocie w panelu Allegro — nie z konieczności, tylko
dlatego, że znikąd nie było widać, przy którym wniosek już jest.

Panel pokazuje stan przy KAŻDEJ pozycji zwrotu, bo wniosek składa się na
pozycję zamówienia, nie na zwrot. Stany są cztery i każdy każe co innego
zrobić: brak wniosku (jest przycisk), złożony (czekać), przyznany (nic),
odrzucony (odwołanie idzie przez panel Allegro). Piąty stan mówi, że nie
wiadomo — i wtedy podaje POWÓD, bo milczenie wygląda jak usterka.

Identyfikator do żądania bierze się z pozycji ZAMÓWIENIA, nigdy z `offerId`
zwrotu. To pierwszy zapis tego systemu do Allegro, a końcówka nie ma
idempotencji: powtórzone żądanie zakłada drugi wniosek. Dlatego strażnik przed
dubletem jest nasz, potrójny, i stoi PRZED wyjściem do sieci.

Automatu nie ma i nie planujemy. Obserwacja z 2 września pokazuje, że Allegro
zakłada 40 wniosków na 100 samo — automat po naszej stronie dublowałby ich
pracę bez niczyjej wiedzy. Zapis wychodzi na jawne kliknięcie człowieka.

### 25a.4b. Potrącenie za utratę wartości (0.170.0)

Do tego wydania kwota była BINARNA per pozycja: cała cena albo nic. Towar
wracający używany nie miał jak zjechać w dół, a to codzienność biura zwrotów.

**Kwota, nie procent.** Decyzja właściciela: klient widzi złotówki, a procent
przy każdej pozycji zostawiałby końcówki, których nikt nie umie wytłumaczyć.

**Powód jest obowiązkowy** i pilnuje go najpierw pole, potem serwer. To jego
treść tłumaczy klientowi, czemu dostał mniej — bez niego potrącenie byłoby
liczbą bez uzasadnienia.

**§25a.3 zostaje nienaruszone.** Panel dalej NIE przysyła kwoty do oddania:
przysyła zaznaczenie, a sumę składa serwer. Potrącenie jest osobnym zapisem
przy POZYCJI, walidowanym w widełkach `0…cena × ilość` — potrącenie większe
niż wartość pozycji znaczyłoby, że klient dopłaca nam za własny zwrot.

Formularz otwiera się dopiero na żądanie, jak ręczne wskazanie kartoteki:
typowy zwrot wraca w porządku, a pole pod każdą pozycją byłoby ścianą pytań
o wyjątek. Zapisane potrącenie widać w KAŻDYM kubełku, bo to fakt o pozycji —
po zamknięciu zwrotu trzeba umieć powiedzieć, czemu klient dostał mniej.

Cofnięcie zdejmuje kwotę razem z powodem (§25a.5).

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

### 25a.9. Skan etykiety zwrotnej (0.163.0)

Wejście od strony fizycznej paczki. Karton ląduje na biurku, operator ciągnie
po naklejce czytnikiem USB i właściwy zwrot otwiera się sam — bez szukania
oczami po kolejce.

Pole jest JEDNO i rozpoznaje kod samo. Serwer próbuje po kolei: numer zwrotu
(`1234/Z04A`), identyfikator zwrotu z Allegro, na końcu numer listu z kopii
odpowiedzi. Wynik mówi, KTÓRA droga zadziałała.

Dopasowanie jest dokładne, nigdy przybliżone. Ekran sam otwiera zwrot przy
jednym wyniku, więc dopasowanie przybliżone prowadziłoby do cudzej sprawy —
a przy zwrocie znaczy to cudzego klienta i cudze pieniądze. **Dwa trafienia
to brak trafienia:** ekran pokazuje oba i każe wybrać.

Brak trafienia daje przycisk „Poszukaj w Allegro". Paczka bywa u nas szybciej
niż synchronizacja, więc pytamy o ten jeden numer listu, zamiast czekać na
ticker. Komunikat wypisuje zeskanowany kod i mówi, czego szukano: przy
czytniku samo „nie znalazłem" wygląda identycznie jak zepsuty czytnik.

**Czytnik nie walczy ze skrótami.** Cyfry `1`–`6` przełączają kubełek, a
przykładowa etykieta InPostu `600000367616070023174201` zawiera je wszystkie.
Hook `panel/src/skaner.ts` odróżnia serię czytnika od klawisza człowieka tym
samym wzorcem co kolektor: przerwa resetuje bufor, Enter kończy serię, krótka
seria nie jest kodem, a pierwszy znak czeka czterdzieści milisekund, zanim
trafi do skrótów. Człowiek nie wciska dwóch klawiszy w takim czasie.

Numeru listu ekran nie zapisuje. Politykę opisuje `docs/obsluga-klienta.md`.

**To samo pole SZUKA (0.165.0).** Każdy wpisany znak zawęża kolejkę po
fragmencie numeru zwrotu, identyfikatora z Allegro, numeru zamówienia albo
numeru korekty. Dwa pola na jeden kod byłyby dwoma nawykami do wyuczenia.

Filtr liczy się w panelu, w pamięci ekranu — tą samą drogą co filtr kubełka
i z tego samego powodu: lista przyjeżdża w całości. Serwer nie dostał ani
jednej nowej trasy, więc nigdzie nie zapisuje się, czego ktoś szukał.

**Szukanie przebija kubełek.** Lista pokazuje wtedy wyniki ze wszystkich
kubełków, a wiersz niesie etykietę swojego. Bez tego operator wpisuje numer,
widzi „ten kubełek jest pusty" i nie ma jak się dowiedzieć, że zwrot stoi
w ZAMKNIĘTYCH. Kliknięcie w kubełek zdejmuje filtr, bo jest prośbą o ten
kubełek.

**Fragment zawęża, otwiera dopiero CAŁY kod.** Ekran sam otwiera zwrot przy
jednym wyniku, więc dopasowanie przybliżone prowadziłoby do cudzej sprawy —
a przy zwrocie znaczy to cudzego klienta i cudze pieniądze. Numeru listu ten
filtr nie widzi, bo nie ma go w modelu pracy; od niego jest Enter, który pyta
serwer.

### 25a.10. Co widać przy zwrocie (0.169.0)

Lista życzeń biura zwrotów. Wszystkie te rzeczy Allegro przysyłało od początku,
a mapowanie je wyrzucało — pracownik szukał ich potem w panelu sprzedawcy.

**Kupujący i przewoźnik stoją PRZY ZWROCIE**, nie tylko przy zamówieniu. Zwrot
niesie login zawsze, a zamówienie bywa jeszcze niepobrane. Login to jedyna dana
osobowa, którą polityka dopuszcza wprost; imienia Allegro przy zwrocie nie
podaje wcale. Nieznanego przewoźnika pokazujemy surowo, bo Allegro nie publikuje
zamkniętej listy — sonda złapała `UNKNOWN`, którego nie ma w specyfikacji.

**Forma płatności i rodzaj dokumentu** przy zamówieniu. Przy pobraniu nie ma
karty, na którą oddać pieniądze, a rodzaj dokumentu mówi, czy potrzebna będzie
korekta faktury. Bierzemy SAMĄ FLAGĘ `invoice.required`: dane firmy niosą ulicę
i miasto, a adresy nie przechodzą przez mapowanie. Brak informacji pokazuje się
jako „nie wiadomo" — paragon wpisany na ślepo kazałby wystawić złą korektę.

**Kody towaru na wierszu produktu.** Symbol kartoteki był od 0.154.0, teraz
dochodzą EAN i SKU sprzedawcy. EAN wisi przy KARTOTECE i pojawia się dopiero po
jej potwierdzeniu — Allegro nie podaje go przy zwrocie wcale. SKU idzie
z pozycji ZAMÓWIENIA, bo pozycja zwrotu własnego nie ma.

**Powodów zwrotu jest siedemnaście, nie jedenaście.** Tyle wymienia schemat;
sonda zaobserwowała jedenaście i tylko te były tłumaczone. Lista i tak nie jest
zamknięta, więc nieznany kod dalej przechodzi surowy.

### 25a.11. Wiadomości o tym zakupie (0.169.0)

Prawa kolumna pokazuje rozmowy dotyczące tego samego zamówienia, z odnośnikiem
do skrzynki. Mostkiem jest numer zamówienia przy wiadomości — ten sam, który
skrzynka mapuje od 0.166.0. Nie kosztuje to ani jednego żądania do Allegro.

Pusty wynik mówi „Allegro nie powiązało z tym zamówieniem żadnej wiadomości",
a nie „klient nie pisał". To dwa różne zdania i tylko pierwsze jest prawdziwe:
Allegro oznacza zamówieniem część wiadomości, a klient piszący z poziomu oferty
tym mostkiem się nie znajdzie.

**Po loginie kupującego dobierać nie wolno** — blizna 0.56.6: Allegro maskuje
rozmówcę jako `client:44300444`, więc rozmowy szuka się po identyfikatorze.

### 25a.12. Lista, filtry i eksport (0.169.0)

Siódma zakładka WSZYSTKIE jest do SZUKANIA, nie do pracy: kubełki zostają
silnikiem, bo rejestr mieszający jedno z drugim skasowaliśmy w 0.140.0. Wiersz
niesie tam plakietkę swojego kubełka, tak samo jak przy szukaniu po kodzie.

Filtr przewoźnika buduje się z tego, co przyjechało, nie ze słownika — filtr
znający wartości nieobecne w danych uczy klikać na próżno.

**Kolejność domyślna zostaje po zegarze ustawowym** (blizna 0.121.0). Sortowanie
po dacie nadania jest przełącznikiem, bo odpowiada na inne pytanie: „co przyszło
najdawniej", a nie „co się najbardziej pali".

Eksport CSV ma separator `;`, jeden wiersz na POZYCJĘ i nie niesie numeru listu
przewozowego. Zostawia ślad w dzienniku, bo wynosi loginy kupujących — ta sama
zasada co przy analizie i audycie.

### 25a.13. Paczka nieodebrana (0.172.0)

Karton wraca, a zwrotu nie ma i nie będzie. Klient nie odebrał przesyłki,
kurier odesłał ją po dwóch awizach — Allegro takiego zdarzenia nie zna,
bo `CustomerReturn` powstaje wyłącznie ze zgłoszenia klienta. Pieniądze
i tak trzeba oddać, więc paczka musi wejść do kolejki.

**Rejestruje ją operator, drugim wyjściem z nieznanego kodu.** Skan nie
trafia, ekran pokazuje „Poszukaj w Allegro" i obok „To nieodebrana paczka".
Pytanie do Allegro zostaje pierwsze, bo paczka bywa u nas szybciej niż
synchronizacja i większość nietrafionych skanów to zwykły wyścig.

**Wiersz jest JAWNIE oznaczony**, kolumną `zrodlo`. Panel pisze przy nim
„Klient nie zgłosił zwrotu — przesyłka wróciła nieodebrana", a plakietka
stoi i w kolejce, i w nagłówku, i w kolumnie eksportu CSV. Bez tego biuro
liczyłoby świadome odstąpienia razem z nieodebranymi i nie miało jak ich
rozdzielić — a to dwie różne rozmowy z klientem i dwa różne wnioski.

**Numer zamówienia jest opcjonalny, ale za niego są pozycje.** Podany
przepisuje pozycje zamówienia do zwrotu, więc jest co ocenić i co wycenić.
Bez niego wiersz zostaje pustym uchwytem na paczkę — lepszym niż kartka
przy monitorze, ale pieniędzy z niego nie policzy.

**Numer listu przewozowego stoi TU w modelu pracy** — świadomy wyjątek od
polityki 0.163.0. Przy zwrocie z Allegro numer szuka się w kopii odpowiedzi,
a paczka nieodebrana żadnej kopii nie ma: to jedyny uchwyt, po którym da się
ją drugi raz zeskanować. Wyjątek trzyma się `zrodlo='nieodebrana'` i nie
wychodzi w eksporcie. Politykę opisuje `docs/obsluga-klienta.md`.

Odnośnika do Allegro taki wiersz nie dostaje. Prowadziłby na stronę zwrotu,
którego po tamtej stronie nie ma.

### 25a.14. Dokument sprzedaży z Subiekta (0.174.0)

Ostatnia pozycja z listy biura zwrotów: „widoczny numer paragonu". Pracownik
szukał go w Subiekcie ręcznie — po dacie i nazwisku, bo nic innego nie miał.
Po tym numerze wystawia się korekta, więc od niego zależą pieniądze.

**Read-model `sgt_faktura` wrócił po skasowaniu w 0.140.0.** Nazwa jest nowa
i to nie jest kosmetyka: `sgt_sprzedaz` stoi na liście kasowania, która chodzi
przy KAŻDEJ migracji. Tabela nazwana tak samo powstałaby ze `schema.sql`
i znikała sekundę później, po cichu i bez błędu.

**Automat wiąże wyłącznie pewność.** Sygnałem rozstrzygającym jest numer
zamówienia stojący NA dokumencie. Jeden taki dokument wiąże się sam; dwa to
spór, nie trafienie, i zostają dla człowieka.

**Nakładka pozycji NIE WIĄŻE nigdy.** Firma ogrodnicza sprzedaje ten sam
sekator dziesięć razy dziennie, więc „wszystkie zwracane towary są na tym
dokumencie" bywa prawdą o kilkunastu dokumentach naraz. To poszlaka — kandydat
z nią trafia na listę, ale wskazuje człowiek. Ta sama doktryna co przy
sygnaturze w 0.169.0 i z tego samego powodu: powiązanie prowadzi do korekty,
a zła korekta idzie do cudzej sprzedaży.

**Kandydat pokazuje SWÓJ powód**, nie sam numer. Wybiera człowiek, więc ma
widzieć, czemu akurat te dokumenty tam stoją. Pochodzenie zostaje widoczne po
wybraniu: automat mówi „numer zamówienia stoi na tym dokumencie", a wskazanie
ręczne podpisuje się imieniem. Projekt panelu §4.3 nie pozwala, żeby wybór
człowieka udawał fakt z danych.

**Pusty wynik się tłumaczy.** Trzy powody i wszystkie prawdziwe: sprzedaż bywa
starsza niż okno importu, integracja nie zawsze wpisuje numer na dokument,
a bez potwierdzonej kartoteki nie ma po czym dopasować towarów. Bez tych zdań
„nie znalazłem" czyta się jak zepsuty import.

**Numer jest SNAPSHOTEM przy zwrocie.** Read-model czyści się przy każdym
imporcie, a dokument wypada z okna po dwóch miesiącach — powiązanie musi
przeżyć własne źródło. Wchodzi też do eksportu CSV, osobną kolumną.

Zdjęcie powiązania to droga wyjścia z pomyłki, nie brak funkcji (§25a.5).

### 25a.15. Produkt, którego klient nie zgłosił (0.184.0)

Klient zgłasza jedną rzecz, a odsyła dwie. To nie jest wypadek przy pracy:
formularz zwrotu wypełnia się na ekranie, a paczkę pakuje przy stole — i wtedy
dokłada się to, co też nie pasowało.

**Regulamin Allegro tej zgodności nie wymaga.** Liczy się TERMINOWE
oświadczenie o odstąpieniu, nie zgodność przesyłki ze zgłoszeniem; opóźnienie
samej wysyłki odstąpienia nie unieważnia. Pieniądze i tak trzeba oddać, więc
biuro musi mieć czym zapisać to, co naprawdę przyszło.

**Produkt wybiera się Z ZAMÓWIENIA, nie z pola tekstowego.** Klient może
odesłać wyłącznie to, co kupił, więc lista zamówienia jest granicą naturalną.
Przy okazji pozycja przynosi cenę i walutę, więc kwota do oddania dalej liczy
się z faktów — §25a.3 zostaje nienaruszone.

**Lista jest RÓŻNICĄ zamówienia i zwrotu.** Pozycje już zgłoszone kazałyby
porównywać dwie listy oczami. Gdy różnicy nie ma, nie ma też przycisku.

**Dopisana pozycja jest oznaczona jako zapis biura** (`zrodlo='biuro'`) i to
oznaczenie pracuje w dwie strony. Na ekranie mówi, że to wybór człowieka, a nie
zgłoszenie klienta (§4.3). W bazie CHRONI: synchronizacja kasuje pozycje,
których Allegro już nie oddaje, i skasowałaby też dopisaną — razem z oceną hali
i zaznaczeniem do kwoty. Po cichu, bo nic nie wygląda na zepsute, dopóki ktoś
nie policzy pieniędzy.

Zdjąć da się wyłącznie pozycję biura (§25a.5). Zgłoszona przez klienta wróciłaby
przy najbliższym takcie, więc przycisk obiecywałby skutek, którego nie ma.

**Zastosowany dekalog ergonomii** (`docs/ergonomia-magazynu.md`, punkty
obowiązujące biuro): 1 — przycisk stoi pod listą produktów, bo tam operator
zauważa różnicę; 2 — lista otwiera się na żądanie, jak potrącenie; 5 — pokazuje
różnicę, nie całe zamówienie; 6 — brak pola tekstowego jest ograniczeniem
zamiast komunikatu o błędzie.

### 25a.16. Kiedy paczka do nas dotarła (0.187.0)

Właściciel zobaczył w panelu sprzedawcy Allegro datę doręczenia zwrotu
i zapytał, czemu nasz panel jej nie pokazuje. Odpowiedź była wstydliwa: bo
napisałem, że Allegro jej nie podaje, a podaje.

**Skąd wzięła się nieprawda.** Obiekt `CustomerReturn` i jego `parcels[]` mają
wyłącznie `createdAt`, czyli moment NADANIA przez klienta. Z tego jednego
schematu wyszedł wniosek o całym API — i przez trzy wydania panel pisał
„Allegro nie podaje daty doręczenia do nas".

Czas doręczenia podaje osobna końcówka: `GET /order/carriers/{id}/tracking`.
Każdy wpis historii niesie `occurredAt`, a wśród kodów jest `DELIVERED`.

**Numeru listu dalej nie zapisujemy** (polityka 0.163.0) i nie trzeba.
Numer leży w kopii odpowiedzi Allegro (`allegro_zwrot.surowe_json`) i stamtąd
go czytamy — tym samym `json_each`, co szukanie zwrotu po naklejce. Zapisujemy
sam WYNIK: moment doręczenia i kod statusu.

**Pytamy tylko o paczki w drodze.** Zwrot z zapisaną datą nie jest pytany
drugi raz — data się nie zmieni, a każde żądanie kosztuje u Allegro.

**Lista paczek do odpytania powstaje z BAZY, nie ze świeżo pobranej strony.**
Pierwsze podejście brało ją z tego, co właśnie przyszło z Allegro — i nie
zadziałało ani razu. Synchronizacja chodzi kursorem: `from` w
`getCustomerReturns` znaczy „zwroty utworzone PO tym zwrocie", więc raz
zobaczony zwrot nigdy nie wraca na listę. Pytaliśmy zatem o tracking wyłącznie
zwrotów zgłoszonych przed chwilą, a zwrot zgłoszony przed chwilą nie jest
doręczony. Kolumna nie zapełniła się ani razu.

Testy jednostkowe tego nie złapały, bo sprawdzały serwis trackingu w izolacji.
Złapał to właściciel pierwszego dnia. Strażnik stoi teraz na SZWIE: przebieg
z pustą stroną zwrotów ma i tak zapytać o paczkę w drodze.

**Nie wiem mówi „nie wiem".** Gdy przewoźnik nie podał nic, ekran pisze
„Nie wiadomo, czy dotarła", a nie „Jeszcze do nas nie dotarła". To była trzecia
z rzędu nieprawda w tej sekcji: zdanie twierdzące stawiane bez podstawy.
Paczka leżąca w magazynie od trzech dni wyglądała identycznie jak zaginiona.

**Paczka nieodebrana ma datę powrotu z definicji.** Biuro rejestruje ją,
trzymając karton w ręku (0.172.0), więc `dostarczono_at` wpisuje się od razu.
Trackingu dla niej nie ma: przewoźnika nie znamy, a Allegro tego zwrotu nie zna
wcale. Ekran nie pisze przy niej „nadana przez klienta", bo klient jej właśnie
nie odebrał i niczego nie nadawał.

**`status` zwrotu tego nie załatwia**, choć ma wartość `DELIVERED`. Sonda
pokazuje, czym to pole bywa naprawdę: `COMMISSION_REFUNDED` w 95 przypadkach
na 100. Stan prowizji nadpisuje stan przesyłki.

**Sygnał „brak dowodu" liczy się odtąd z DORĘCZENIA, nie z nadania.** Do
0.186.0 gasł, gdy klient nadał paczkę — więc zwrot doręczony i ten jadący od
tygodnia wyglądały w kolejce identycznie. Gdy trackingu nie ma, zostaje dawne
kryterium: lepszy sygnał z daty nadania niż jego brak.

Ekran mówi też, gdy przesyłka ma kłopot: awizo, problem, powrót do nadawcy.
Kod spoza listy pokazuje się surowy — jak przy przewoźniku.

### 25a.17. Oddanie pieniędzy i odmowa (0.190.0)

Do 0.190.0 panel kończył pracę w połowie. Operator rozstrzygał zwrot, zaznaczał
pozycje i dostawał policzoną kwotę — a potem szedł oddać pieniądze do panelu
Allegro.

Kryterium gotowości z §25 mówi wprost: agent ma obsłużyć sprawę bez otwierania
panelu Allegro. Przy zwrocie nie było to spełnione ani razu.

**Dwie końcówki, dwa różne kształty.** Zwrot pieniędzy to
`POST /payments/refunds` w wersji `public.v1`, na uprawnieniu
`allegro:api:payments:write`. Odmowa to
`POST /order/customer-returns/{id}/rejection` w wersji `beta.v1`, na
`allegro:api:orders:write`.

**Kwoty nie ma w ciele żądania.** Serwer bierze tę, którą sam policzył
z zaznaczenia. Panel podający liczbę pozwoliłby oddać dowolną kwotę żądaniem
z pominięciem ekranu — ta sama decyzja co przy `zapiszKwote` w 0.156.0.

**`commandId` powstaje RAZ na zwrot.** Allegro daje przy tej końcówce
idempotencję po tym polu i to jest jedyna osłona przed drugim przelewem, gdy
sieć zerwie się po wysłaniu żądania, a przed odpowiedzią. Nowy identyfikator
przy ponowieniu zamieniłby ostrożność w podwójny zwrot cudzych pieniędzy.

To jest różnica względem rabatu: tam końcówka idempotencji NIE MA i cały
strażnik musiał być nasz.

**Przeszkoda jest zdaniem, nie wyłączonym przyciskiem.** Serwer wymienia po
imieniu, czego brakuje: werdyktu, kwoty, numeru zamówienia, identyfikatora
płatności. Każda z tych rzeczy prowadzi gdzie indziej.

Pobranie dostaje własne zdanie. Tych pieniędzy Allegro nigdy nie trzymało,
więc wracają przelewem poza panelem — a żądanie i tak skończyłoby się odmową
bez czytelnego powodu.

**Odmowa pyta o powód, zwrot nie pyta o nic.** Wygląda to na niekonsekwencję,
a jest §25a.5. Zwrot pieniędzy da się cofnąć dopłatą i widać go od razu na osi.
Odmowa idzie do klienta jako oświadczenie i drugiej takiej samej Allegro nie
przyjmie.

Powód czyta KLIENT w Allegro. Ekran mówi to przy polu, bo notatka wewnętrzna
i oświadczenie wobec kupującego wyglądają na formularzu tak samo.

**Obie trasy stoją za `autoryzuj`.** To jedyne miejsca w tej aplikacji, które
ruszają cudze pieniądze na zewnątrz, więc obok bramki roli dostają wpis
`privileged` z nazwą operacji.

### 25a.8. Czego panel nie wie

Kwoty pełnej nie znamy, dopóki zamówienie nie zostanie pobrane — i ekran mówi
to wprost, zamiast pokazywać sumę pozycji jako całość.

## 26. Decyzje do potwierdzenia

Ile kont Allegro podłączymy? Ilu agentów pracuje jednocześnie? Jak długo
przechowujemy treść rozmów? Czy obsługujemy też dyskusje? Czy wynik magazyniera
może zawierać zdjęcia? Czy komentarze
wymagają wzmianek? Jaki jest wymagany czas odpowiedzi? Kiedy zamykamy rozmowę
automatycznie? Czy do pierwszego wydania wchodzi AI? Które katalogi producentów
są dostępne? Czy istnieje firmowa baza dopasowań? Czy panel zostaje
on-premise? Czy przewidujemy dostęp spoza sieci firmy? Czy Subiekt zostaje
jedynym ERP?

Pytanie „kto zatwierdza nowe zastosowania części" zeszło z tej listy w E2:
każdy z biura, także autor propozycji (§5, §12).

## 27. Zasady nadrzędne

1. Najpierw dane i dowody, potem automatyzacja.
2. Człowiek wysyła odpowiedź do klienta.
3. Automat nie jest źródłem kompatybilności.
4. Rozmowa, sprawa, dobór, zadanie i dowód są osobnymi bytami.
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
| Komentarze i wzmianki | **działa** od 0.157.0 | oś rozmowy, tryb w `Edytor.tsx`, wzmianki z `/api/users`; od 0.157.0 do 0.181.0 panel wołał zły adres i dostawał 404 |
| Skrzynka wzmianek („wspomniano o mnie") | **działa** od 0.160.0 | `services/wzmianki.ts`, `panel/src/ekrany/Wzmianki.tsx` |
| Oś rozmowy w kolejności czasu | **działa** od 0.157.0 | do 0.156.0 wyniki zadań doklejały się na końcu |
| Obecność i „pisze" | **na ekranie** od 0.190.0 | serwer od 0.144.0; kolejka pokazuje trzymającego, pasek w rozmowie — resztę i piszących (`skrzynka/Obecni.tsx`, `usePisze`) |
| Szyna zdarzeń do panelu | **działa** od 0.144.0 | `GET /api/conversations/events` |
| Zadania terenowe i kolektor | **działa** od 0.141.0 | `zadanie_terenowe`, `FieldTasksScreen.kt` |
| Wynik z hali na osi rozmowy | **działa** od 0.144.0 | `conversation_event`, `field_task_result` |
| Wyszukiwarka towaru w panelu | **działa** od 0.145.0 | `panel/src/wyszukiwarka.tsx` |
| Kartoteka wywiedziona z oferty | **działa** od 0.152.0 | `services/dopasowanie-sku.ts`, `offer.external.id` |
| Powód braku kartoteki i licznik | **działa** od 0.154.0 | `Dopasowanie.powod`, `bilansKartotek` |
| Pamięć wskazań oferta–kartoteka | **działa** od 0.154.0 | `oferta_kartoteka`, wzorzec `ean_alias` |
| Przestrzeń identyfikatora oferty w zwrocie | **niepotwierdzona** | złączenie po obu kolumnach, `poKolumnie` |
| Statusy rozmowy (§7) | **działa** od 0.158.0 | `conversation.status`, `ustawStatus`, kubełki kolejki |
| Uchwyt rozmowy — przydział na czas oglądania | **działa** od 0.159.0 | `conversation-realtime.ts`, w pamięci |
| Odpowiedź przydziela rozmowę na stałe | **działa** od 0.159.0 | `services/wysylka.ts` |
| `waiting_for_internal` z pomiaru i wyniku hali | **działa** od 0.159.0 | `zlecPomiar`, `dopiszZdarzenieWyniku` |
| Statusy doboru (§7) | **działa** od E1 | `dobor_rozmowy.status`, `services/dobor.ts`, zakładka „Dobór" |
| Kandydaci doboru (§11.2) | **działa** od E3 | `services/kandydaci.ts`: symbol, EAN, OEM, zastosowanie, oferta, zamiennik, pełny tekst; numer OEM spoza opisów to kandydat bez kartoteki |
| Identyfikatory z opisów (OEM, nr oryg., stare SKU) | **działa** od 0.186.0 | `towar_identyfikator`, `services/identyfikatory.ts`, przebudowa po imporcie w `po-imporcie.ts` |
| Sekcje „Modele:" z opisów do przerobienia | **działa** od 0.186.0 | `model_z_opisu`, ekran Wiedza → „Z opisów"; automat nie proponuje z opisu |
| Pełny tekst kartotek (FTS5, bm25) | **działa** od 0.186.0 | `towar_fts`, `services/pelnotekst.ts`; bez FTS5 szczebel pominięty z powodem |
| Pokrycie wiedzy w ustawieniach | **działa** od 0.186.0 | `GET /api/obsluga/pokrycie-wiedzy`, `ustawienia/PokrycieWiedzy.tsx` |
| Automatyczne zamknięcie po N dniach | **projekt** | otwarta decyzja właściciela z §26 |
| Sprawa nad rozmowami (§6.1) | **działa** od 0.161.0 | `sprawa_klienta`, `services/sprawy.ts`, pasek w rozmowie |
| Ekran sprawy z własną osią | **poza zakresem** | zdarzenia wiszą przy źródle — blizna 0.130.0 |
| Wysyłka do Allegro (§8.5) | **działa** od 0.148.0 | `services/wysylka.ts`, `outbox` |
| Kształt POST wysyłki | **potwierdzony** w 0.151.0 | specyfikacja OpenAPI; limit 2000 znaków |
| Mapowanie odczytu skrzynki | **poprawione** w 0.151.0 | do 0.150.0 błędne w każdym polu |
| Kontrola świeżości i dialog 409 | **działa** od 0.148.0 | `skrzynka/DialogKonfliktu.tsx` |
| Baza wiedzy (§12) | **działa** od E2 | `model_urzadzenia`, `zastosowanie`, `dowod_zastosowania`, `services/wiedza.ts` |
| Ekran Wiedza — kolejka propozycji | **działa** od E2 | `panel/src/ekrany/Wiedza.tsx`, zakładka w pasku z licznikiem |
| Dowody i negatywy przy doborze | **działa** od E2 | `skrzynka/Dobor.tsx`: dowody wybranej kartoteki, sekcja negatywów, pomiary do wiedzy |
| Copilot — klasyfikacja wiadomości (§14.5) | **działa** od F | `services/copilot-klasyfikacja.ts`, `klasyfikacja_rozmowy`, `copilot_wywolanie`, `skrzynka/Copilot.tsx`; wyłączony domyślnie |
| Copilot — ekstrakcja, OCR, kandydaci, szkic (§14.1) | **projekt** | etap F, przyrosty dalsze |
| Front na TanStack, Router, shadcn | **działa** od 0.146.0 | `panel/src/api/`, `panel/src/ui/` |
| Testy frontu (Vitest, Playwright) | **działa** od 0.146.0 | `panel/src/**/*.test.tsx`, `panel/e2e/` |
| Audyt mutacji rozmowy | **działa** od 0.145.1 | `logEvent` w `services/conversations.ts` |
| Status synchronizacji (§7) | **działa** od 0.147.0 | `statusSynchronizacji` |
| Trwały alarm synchronizacji (§21) | **działa** od 0.147.0 | `skrzynka/AlarmSynchronizacji.tsx` |
| Ustawienia obsługi za zębatką (§21) | **działa** od 0.168.0 | `panel/src/ekrany/Ustawienia.tsx`, trasa `/obsluga/ustawienia` |
| Wiązanie kartoteki po sygnaturze BEZ zatwierdzania | **działa** od 0.169.0 | `zwiazPewne` w `services/sygnatury.ts`, takt zwrotów i zamówień |
| Pokrycie sygnatur na ekranie ustawień | **działa** od 0.169.0 | `GET /api/obsluga/sygnatury`, `panel/src/ustawienia/PokrycieSygnatur.tsx` |
| Ekran przegranego przejęcia (§6.2) | **działa** od 0.147.0 | `skrzynka/KonfliktPrzejecia.tsx` |
| Wymuszone przekazanie z powodem | **działa** od 0.147.0 | `przekazRozmowe`, rola `admin` |
| Ręczne wskazanie oferty | **działa** od 0.147.0 | `wskazOferte`, `conversation_event` |
| Podgląd kolejki = ostatnia wiadomość klienta | **działa** od 0.167.0 | `LISTA` w `services/skrzynka.ts`, `ostatniaOdKlienta` |
| Zamówienie przy rozmowie (`relatesTo.order`) | **działa** od 0.167.0 | `message.related_order_id`, `skrzynka/ZamowienieRozmowy.tsx` |
| Oferta przy rozmowie (`relatesTo.offer`) | **działa** od 0.178.0 | `offer_snapshot`, `services/allegro-oferty-sync.ts`, `skrzynka/OfertaRozmowy.tsx` |
| Nazwa towaru przy ofercie w rozmowie | **z oferty** od 0.178.0 | `nazwaOferty` — snapshot, a bez niego pozycja zamówienia |
| Kartoteka Subiekta przy rozmowie | **działa** od 0.179.0 | `kartotekaOferty`, `skrzynka/TowarRozmowy.tsx` — stan, półka, zdjęcie |
| Trzy kolumny w skrzynce (§10.1) | **działa** od 0.180.0 | `skrzynka/Kontekst.tsx`, zakładki Oferta, Towar i od E1 Dobór |
| Wiersz kolejki wg §10.2 | **częściowo** od 0.181.0 | priorytet, czas oczekiwania, dopiski, zadanie, od E1 status doboru; bez terminu |
| Historia przypisań rozmowy | **działa** od 0.145.1 | `conversation_assignment` |
| Dokument sprzedaży (FS/PA) przy zwrocie | **działa** od 0.174.0 | `sgt_faktura`, `services/faktury.ts` |
| Data doręczenia paczki zwrotnej | **działa** od 0.187.0 | `services/allegro-tracking.ts`, `zwrot_klienta.dostarczono_at` |
| Produkt dopisany do zwrotu przez biuro | **działa** od 0.184.0 | `dopiszPozycje`, `zwrot_klienta_pozycja.zrodlo` |
| Paczka nieodebrana jako osobny byt | **działa** od 0.172.0 | `zwrot_klienta.zrodlo`, `zarejestrujNieodebrana` |
| Zwroty klienckie — odczyt i kolejka | **działa** od 0.150.0 | `services/zwroty.ts`, `panel/src/zwroty/` |
| Synchronizacja zwrotów z Allegro | **działa** od 0.150.0 | `services/allegro-zwroty-sync.ts` |
| Kształt zwrotów z dokumentacji, nie z sondy | **niepotwierdzony** | `[WERYFIKUJ]` w `docs/allegro-ksztalt.md` |
| Werdykt biura przy zwrocie | **działa** od 0.156.0 | `rozstrzygnijZwrot`, odmowa wymaga powodu |
| Ocena towaru przy zwrocie | **działa** od 0.156.0 | `ocenPozycje`, `stan`/`przecena`/`utylizacja` |
| Kwota do oddania | **działa** od 0.156.0 | `zapiszKwote`, suma z zaznaczenia po stronie serwera |
| Korekta i zamknięcie zwrotu | **działa** od 0.162.0 | `zapiszKorekte`, `cofnijKorekte` — numer z Subiekta |
| Skan etykiety zwrotnej otwiera zwrot | **działa** od 0.163.0 | `znajdzZwrotPoKodzie`, `panel/src/skaner.ts` |
| Szukanie zwrotu po fragmencie kodu | **działa** od 0.165.0 | `panel/src/zwroty/Szukanie.tsx`, filtr w pamięci ekranu |
| Panel trzyma się okna, kolumny przewijają się osobno | **działa** od 0.165.0 | `panel/src/main.tsx`, wzorzec z makiety |
| Produkty ze zwrotu w głównym oknie, akcja na wierszu | **działa** od 0.167.0 | `panel/src/zwroty/Pozycje.tsx` |
| Kupujący, przewoźnik, płatność i rodzaj dokumentu | **działa** od 0.169.0 | `zwrot_klienta.kupujacy_login`, `zamowienie_klienta.platnosc_typ` |
| Potrącenie za utratę wartości pozycji | **działa** od 0.170.0 | `zapiszPotracenie`, `panel/src/zwroty/Potracenie.tsx` |
| EAN i SKU na wierszu produktu | **działa** od 0.169.0 | `sgt_towar.ean`, `zamowienie_klienta_pozycja.sku` |
| Wiadomości o tym zakupie przy zwrocie | **działa** od 0.169.0 | złączenie po `message.related_order_id` |
| Zakładka WSZYSTKIE, filtr przewoźnika, eksport CSV | **działa** od 0.169.0 | `csvZwrotow`, `GET /api/obsluga/zwroty/csv` |
| Załączniki wiadomości | **działa** od 0.155.0 | `message_attachment`, `GET /api/obsluga/zalaczniki/:id` |
| Zamówienie klienta przy zwrocie | **działa** od 0.152.0 | `services/allegro-zamowienia-sync.ts` |
| Ręczne dociągnięcie zamówień | **działa** od 0.154.0 | `POST /api/obsluga/zwroty/zamowienia` |
| Zdjęcia towaru w panelu obsługi | **działa** od 0.152.0 | `panel/src/zwroty/useZdjecie.ts` |
| Odnośniki do panelu sprzedawcy | **niepotwierdzone** | `[WERYFIKUJ]`, wzorce w `ALLEGRO_PANEL_*` |
| Czyszczenie lądowisk z danych osobowych | **działa** od 0.152.0 | `services/allegro-oczyszczanie.ts` |
| Zwrot pieniędzy i odmowa w Allegro | **działa** od 0.190.0 | `services/zwrot-pieniedzy.ts`, `panel/src/zwroty/Pieniadze.tsx`; `commandId` stały na zwrot, uprawnienie `payments:write` |
| Automat korekty przez Sferę | **poza zasięgiem** | brak `dok_Id` sprzedaży — read-model zna tylko FZ i PZ |
| Rabat transakcyjny — stan przy pozycji | **działa** od 0.164.0 | `services/rabaty.ts`, `allegro_rabat`, `zwrot_klienta.status_allegro` |
| Rabat transakcyjny — złożenie wniosku | **działa** od 0.164.0 | PIERWSZY zapis do Allegro; wymaga `allegro:api:orders:write` |
| Anulowanie wniosku o rabat | **niepotrzebne** | decyzja właściciela: Allegro anuluje wniosek samo |
| Raport sondy w repo | **działa** od 0.164.0 | `docs/allegro-sonda.md`, obserwacja z 2 września |
