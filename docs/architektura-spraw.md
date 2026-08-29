# Sprawy jako system tiketowy — architektura docelowa

Cel właściciela: złagodzić pracę agenta i zminimalizować skakanie między
oknami. Sprzedaż idzie wyłącznie przez Allegro, więc API jest jedynym źródłem
spraw. Decyzja: **ewolucja WERTIS**, nie nowa aplikacja obok.

Ten dokument spisuje zasady, do których zmierzamy, i mapę etapów. Etap A
(nawigacja boczna, rozprężenie SPRAW) wszedł w 0.125.0. Kolejne litery to
osobne wydania, każde działające na produkcji.

## Siedem zasad

Wywiedzione z pracy agenta, nie z technologii. Praca agenta znaczy: żaden
ustawowy termin nie mija, żaden klient nie czeka bez potrzeby, nikt nie robi
tego samego dwa razy, każda odpowiedź ma fakty pod ręką.

**1. Jednostką pracy jest problem klienta, nie obiekt Allegro.** Allegro
rozbija jeden problem na obiekty: wątek wiadomości, dyskusję, CLAIM, zwrot.
Klient pisze „gdzie paczka", zakłada dyskusję, w końcu odsyła towar — trzy
obiekty, jeden problem. SPRAWA je agreguje; obiekty są źródłami sprawy.

**2. Najważniejszy stan sprawy: kto ma piłkę.** Cztery wartości: MY, KLIENT,
ŚWIAT (przewoźnik, Allegro), NIKT (zamknięta). Kolejka pracy to sprawy
z piłką u nas, po terminie. Statusy Allegro są szczegółem źródła, nie osią.
Decyzja właściciela: piłkę liczą METADANE (kto ostatni, kiedy, ile
wiadomości) — treść rozmów dalej czyta się na klik i nie zapisuje.

**3. Zdarzenia są prawdą, stan jest projekcją.** Synchronizacja i akcje
agenta dopisują zdarzenia do append-only logu. Piłka, terminy i liczniki
wyliczają się z niego. To daje idempotentny polling, audyt „czemu ta sprawa
tu stoi" i odtwarzalność po błędzie. Zalążek istnieje: tabela `events`
i `logEvent` — append-only z kształtu, ale niekompletny (patrz inwentarz).

**4. Kontekst przyjeżdża do sprawy.** Zamówienie, płatność, przesyłka
z trackingiem, stan magazynowy, historia klienta — na jednym ekranie, przy
sprawie. To jest wprost cel „zero skakania po oknach". Nasza przewaga nad
każdym helpdeskiem: magazyn i Subiekt są w tym samym procesie, więc zwrot
przechodzi w skan, kosz i korektę bez zmiany narzędzia.

**5. Terminy ustawowe to dane wejściowe, nie ozdoba.** Zegar liczy się przy
wjeździe sprawy i steruje kolejką. Pasma pilności (0.121.0) już go konsumują.

**6. Automat proponuje, człowiek wysyła.** AI pisze szkic, tagowanie
i przydział mogą być regułami — ale do klienta mówi wyłącznie człowiek.
To świadome odrzucenie autorespondera (patrz Responso niżej).

**7. Jedną sprawę prowadzi jedna osoba.** Przejęcie („WEZMĘ TO") działa od
0.121.0. Docelowo `prowadzi` mieszka na sprawie, nie na czterech rejestrach.

## Inwentarz — stan zastany (przegląd kodu, sierpień 2026)

Fakty z `adapters/allegro.http.ts`, `db/schema.sql` i tras; dokument stoi na
nich, nie na pamięci.

- Adapter woła 17 rodzin endpointów Allegro. Wszystko jest listowaniem stanu
  i pollingiem; zdarzeniowego nie ma nic (żadnych webhooków ani journala).
  Tickery tła są domyślnie wyłączone (`pollMs=0`) — pobiera człowiek.
- `/sale/issues` czyta JEDNĄ stronę po 100, offset zawsze 0. Rejestr dyskusji
  nie widzi nic ponad setkę — to najpewniejsze źródło „100 dyskusji"
  z produkcji, obok niezweryfikowanej listy statusów końcowych.
- `pytanie` nie ma ani `order_id`, ani `kupujacy_id`, a jego login bywa maską
  `client:NNN`. Zwrot trzyma prawdziwy login, więc złączenie po loginie
  w SQL między rejestrami nie trafia. Odmaskowanie istnieje tylko w adapterze.
- Statusu płatności nie czyta nikt (`payment.*` z checkout-forms nietknięte).
  Przy dyskusji nie widać zamówienia ani przesyłki, choć `order_id` leży
  w bazie; trasa zwraca nawet blok `klient`, a panel go ignoruje.
- `events` zapisuje ~70 typów, bez wartości przed/po; części mutacji brakuje
  (np. przejęcie pytania nie loguje). Zalążek logu zdarzeń, nie log.
- Świeżość rozmowy chroni wyłącznie pytania (`nowa_wiadomosc_at` i blokada
  wysyłki). Dyskusja i zwrot mogą wysłać odpowiedź na nieaktualną rozmowę.

## Responso — zapożyczenia i krytyka

Responso to polski helpdesk e-commerce z integracją Allegro; Trustpilot daje
mu 3,3/5 (odczyt: sierpień 2026). Bierzemy od nich pomysły, nie model.

Zapożyczamy: jedną skrzynkę wielu kanałów i kont (nasza architektura źródeł
musi przyjąć opinie Allegro i drugie konto bez przebudowy), szablony
odpowiedzi ze zmiennymi, reguły automatyzacji ograniczone do tagów
i przydziału, raporty czasów odpowiedzi na osobę.

Krytykujemy cztery rzeczy. Model „wątek = ticket" rozbija problem klienta na
tickety per kanał — nasza sprawa robi odwrotnie. Flagowy autoresponder
odpowiada klientom regułami; u nas automat nigdy nie mówi do klienta sam.
Helpdesk kończy się na odpowiedzi — bez magazynu i ERP nie domknie zwrotu,
który u nas przechodzi w skan, kosz i korektę w Subiekcie. Dane rozmów
klientów mieszkają w cudzej chmurze; u nas lokalnie, a treści rozmów nie
zapisujemy wcale.

## Model danych docelowy

Cztery istniejące tabele rejestrów ZOSTAJĄ — niosą mechanikę swoich procesów
(kosze, korekty, werdykty). Sprawa jest nakładką, nie zamiennikiem.

- `sprawa` — id, kupujący (id i login), `order_id` (może być pusty), tytuł,
  **piłka**, `termin_at`, `prowadzi`, otwarcie i zamknięcie.
- `sprawa_zrodlo` — wiązanie sprawy z obiektem: rodzaj (wątek, dyskusja,
  zwrot, reklamacja; w przyszłości opinia), id Allegro, id lokalny.
- `sprawa_zdarzenie` — append-only oś czasu: klient napisał, odpowiedzieliśmy,
  status z Allegro, przejęto, szkic AI. Stan sprawy jest projekcją tej osi.
- `watek_meta` — metadane piłki bez treści: kto ostatni, kiedy, ile
  wiadomości. Wypełnia je synchronizacja.

Sklejanie źródeł w sprawę: automatycznie WYŁĄCZNIE po `order_id`. Po samym
kupującym system podpowiada scalenie, a klika człowiek — pytanie nie ma
`order_id`, a dwa niezależne pytania jednego klienta to dwie sprawy.
Warunek wstępny: kolumna `kupujacy_id` przy pytaniach i odmaskowanie loginów.

## Ekran docelowy

Powłoka z 0.125.0 zostaje: pasek boczny, konsola kolejka–sprawa–kontekst,
MAGAZYN ZWROTÓW i REJESTRY osobno. Dwie zmiany czekają na model danych:

- Pasma kolejki przechodzą z wieku na **piłkę × termin**: PO TERMINIE,
  TERMIN ≤7 DNI, CZEKA NA NAS, dalej zwinięte CZEKA NA KLIENTA
  i U PRZEWOŹNIKA / ALLEGRO. Dzisiejsze pasma zgadują z wieku; docelowe wiedzą.
- Widok sprawy staje się **jedną osią czasu**: wszystkie kanały sprawy
  chronologicznie, jedno pole odpowiedzi z wyborem kanału (domyślnie kanał
  ostatniego głosu klienta). Unifikuje trzy dzisiejsze szczegóły — pytania,
  zwrotu i dyskusji — czyli trzy osobne implementacje po kilkaset linii.

## Mapa etapów

Każdy etap to osobne wydanie i osobny PR; kolejny zaczyna się po obejrzeniu
poprzedniego na produkcji.

- **A (0.125.0, wykonany):** nawigacja boczna zamiast górnego paska; SPRAWY
  rozprężone na trzy widoki; konsole na pełne `100dvh`.
- **B (0.126.0, wykonany) — uszczelnienie wjazdu:** paginacja `/sale/issues`
  (do 1000 spraw); `watek_meta` dla dyskusji i pytań ze świeżością wysyłki
  po stronie serwera; dekodowanie encji HTML w adapterze i jednorazowe
  przeliczenie bazy. Statusy końcowe: mechanizm weryfikacji wszedł (nieznane
  wartości liczą się i świecą przy DYSKUSJACH), potwierdzenie właściciela na
  żywym koncie i korekta listy to osobny PATCH.
- **C — encja sprawy:** `sprawa` i `sprawa_zrodlo` nakładką, wypełnienie
  wstecz po `order_id` i kupującym, `kupujacy_id` przy pytaniach; kolejka
  czyta sprawy zamiast czterech budowniczych.
- **D — piłka i oś czasu:** `sprawa_zdarzenie` z projekcją piłki; pasma na
  piłkę × termin; oś czasu w widoku sprawy i jedno pole odpowiedzi.
- **E — narzędzia agenta:** szablony odpowiedzi; reguły tagowania
  i przydziału; opinie Allegro jako piąte źródło; raporty czasów; komplet
  kontekstu (płatność, zamówienie i przesyłka przy dyskusji, śledzenie
  przy zwrocie).

## Czego świadomie nie robimy

- Auto-odpowiedzi do klientów — nigdy, niezależnie od etapu.
- Zapisu treści rozmów do bazy — piłka liczy się z metadanych.
- Drugiej aplikacji obok WERTIS — każda funkcja wjeżdża w istniejący panel.
