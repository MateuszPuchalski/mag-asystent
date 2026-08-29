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
rozbija jeden problem na obiekty: wątek wiadomości, dyskusję, CLAIM, zwrot,
od 0.135.0 także opinię.
Klient pisze „gdzie paczka", zakłada dyskusję, w końcu odsyła towar — trzy
obiekty, jeden problem. SPRAWA je agreguje; obiekty są źródłami sprawy.

**2. Najważniejszy stan sprawy: kto ma piłkę.** Docelowo cztery wartości: MY,
KLIENT, ŚWIAT (przewoźnik, Allegro), NIKT (zamknięta). Od 0.129.0 działają
trzy — ŚWIAT czeka na producenta danych. Kolejka pracy to sprawy z piłką
u nas, po terminie. Statusy Allegro są szczegółem źródła, nie osią.
Decyzja właściciela: piłkę liczą METADANE (kto ostatni, kiedy, ile
wiadomości) — treść rozmów dalej czyta się na klik i nie zapisuje.

**3. Zdarzenia są prawdą, stan jest projekcją.** Synchronizacja i akcje
agenta dopisują zdarzenia do append-only logu. Piłka, terminy i liczniki
wyliczają się z niego. To daje idempotentny polling, audyt „czemu ta sprawa
tu stoi" i odtwarzalność po błędzie. Od 0.130.0 sprawa ma taki log:
`sprawa_zdarzenie` z kluczem idempotencji. Piłka dalej liczy się z rejestrów
i metadanych — log jest historią dla człowieka, nie źródłem stanu.
Ogólny `events` zostaje audytem systemu (patrz inwentarz).

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
- ~~Statusu płatności nie czyta nikt~~ — od 0.132.0 czyta: `payment.*`,
  status zamówienia i `fulfillment.status` jadą do sekcji ZAMÓWIENIE
  I PRZESYŁKA przy zwrocie i dyskusji, razem z paczkami i śledzeniem.
  Zostaje blok `klient` z trasy dyskusji, którego panel dalej nie rysuje.
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
- `sprawa_zdarzenie` (0.130.0) — append-only oś czasu: klient napisał,
  odpowiedzieliśmy, status z Allegro, przejęto, szkic AI. Zdarzenie wisi przy
  ŹRÓDLE, nie przy sprawie, więc SCAL i ROZKLEJ nie przepisują historii —
  oś czasu sprawy jest sumą zdarzeń jej dzisiejszych źródeł. Zamknięty
  słownik typów i zero treści rozmów: `szczegol` niesie status albo liczbę.
- `watek_meta` — metadane piłki bez treści: kto ostatni, kiedy, ile
  wiadomości. Wypełnia je synchronizacja.

Sklejanie źródeł w sprawę: automatycznie WYŁĄCZNIE po `order_id`. Po samym
kupującym system podpowiada scalenie, a klika człowiek — pytanie nie ma
`order_id`, a dwa niezależne pytania jednego klienta to dwie sprawy.
Warunek wstępny: kolumna `kupujacy_id` przy pytaniach i odmaskowanie loginów.

## Ekran docelowy

Powłoka z 0.125.0 zostaje: pasek boczny, konsola kolejka–sprawa–kontekst,
MAGAZYN ZWROTÓW i REJESTRY osobno. Pasma wiedzą, kto ma ruch; oś czasu
pokazuje, co się działo:

- Pasma kolejki przeszły z wieku na **piłkę × termin** (0.129.0): PO TERMINIE,
  TERMIN ≤7 DNI, TERMIN USTAWOWY, trzy pasma CZEKA NA NAS (wiek dzieli je
  wewnątrz piłki) i zwinięte CZEKA NA KLIENTA. Pasmo U PRZEWOŹNIKA / ALLEGRO
  dojdzie razem z piłką ŚWIAT.
- **Oś czasu sprawy** weszła w 0.130.0 jako zwijana sekcja w każdym z trzech
  szczegółów: wszystkie kanały jednej sprawy chronologicznie, z kolumną
  kanału przy sprawie wielźródłowej. Treści rozmów tam nie ma i nie będzie.
- **Jedno pole odpowiedzi z wyborem kanału** weszło w 0.131.0. Blok
  ODPOWIEDZ W SPRAWIE pokazuje kanały INNE niż ten, w którym stoi otwarty
  szczegół, i poleca ten, w którym klient odezwał się ostatni. Przy zwrocie
  rozwija się od razu — zwrot nie ma własnego kanału, więc to jedyna droga
  do klienta bez zmiany ekranu.
- **Zwinięcie trzech szczegółów w jeden widok NIE jest już potrzebne do celu
  „zero skakania".** Oś czasu i pole odpowiedzi dojechały do każdego z nich,
  a każdy niesie mechanikę, której pozostałe nie potrzebują: pozycje i kosze
  przy zwrocie, dopasowane towary przy pytaniu, załącznik przy dyskusji.
  Scalenie ich w jeden ekran zostaje jako możliwe uproszczenie kodu, nie jako
  warunek pracy agenta — decyzja właściciela, czy w ogóle warta wydania.

## Mapa etapów

Każdy etap to osobne wydanie i osobny PR; kolejny zaczyna się po obejrzeniu
poprzedniego na produkcji.

- **A (0.125.0, wykonany):** nawigacja boczna zamiast górnego paska; SPRAWY
  rozprężone na trzy widoki; konsole na pełne `100dvh`.
- **B (0.127.0, wykonany) — uszczelnienie wjazdu:** paginacja `/sale/issues`
  (do 1000 spraw); `watek_meta` dla dyskusji i pytań ze świeżością wysyłki
  po stronie serwera; dekodowanie encji HTML w adapterze i jednorazowe
  przeliczenie bazy. Statusy końcowe: mechanizm weryfikacji wszedł (nieznane
  wartości liczą się i świecą przy DYSKUSJACH), potwierdzenie właściciela na
  żywym koncie i korekta listy to osobny PATCH.
- **C (0.128.0, wykonany) — encja sprawy:** `sprawa` i `sprawa_zrodlo`
  nakładką utrzymywaną rekoncyliacją z mutacji; sklejanie automatem
  wyłącznie po `order_id`; `kupujacy_id` przy pytaniach odmaskowany
  z `client:NNN`; kolejka, licznik, wyszukiwarka i Klient 360 liczą sprawy.
  Podpowiedź „ten sam kupujący" jest odczytem — SCAL i ROZKLEJ czekają
  na etap D; `kupujacy_id` przy dyskusjach to kandydat do E (wymaga
  czytania checkout-formów w sync).
- **D1 (0.129.0, wykonany) — piłka:** kto ma ruch (MY / KLIENT / NIKT) liczy
  się przy odczycie ze statusów rejestrów i `watek_meta`; pasma przechodzą
  z wieku na piłkę × termin; synchronizacja dyskusji dociąga metadane rozmów
  otwartych spraw (sufit stu na pobranie); SCAL i ROZKLEJ potwierdzają
  podpowiedź „ten sam kupujący" ręką człowieka. Piłka ŚWIAT (przewoźnik,
  Allegro) czeka na producenta danych: tracking czyta się na żądanie i nigdzie
  nie zapisuje, a zapowiedzi zwrotów nie są źródłem sprawy.
- **D2 (0.130.0, wykonany) — oś czasu:** `sprawa_zdarzenie` jako append-only
  historia przy źródle; zdarzenia dopisują mutacje rejestrów (wpłynięcie,
  głos klienta, odpowiedź, szkic, przejęcie, decyzja, dokumenty, środki,
  werdykt, zamknięcie, SCAL i ROZKLEJ); dosypka ze stempli rejestrów przy
  starcie; zwijana sekcja OŚ CZASU SPRAWY w trzech szczegółach.
- **D3 (0.131.0, wykonany) — jedno pole odpowiedzi:** kanałem jest wątek
  pytania i dyskusja (zwrot i reklamacja niosą mechanikę, nie rozmowę);
  polecany jest ten, w którym klient odezwał się ostatni — liczone
  z `watek_meta`, bez pytania Allegro. Wysyłka idzie TRASĄ REJESTRU, więc
  kontrola świeżości, stempel i zdarzenie działają tak samo jak przy własnym
  polu. Zwinięcie trzech szczegółów w jeden widok zostało świadomie zdjęte
  z drogi (patrz „Ekran docelowy").
- **E1 (0.132.0, wykonany) — kontekst zamówienia:** status zamówienia,
  płatność (kwota, sposób, czy zapłacone), metoda dostawy, paczki i ostatnie
  zdarzenie śledzenia — w zwijanej sekcji przy zwrocie i dyskusji. Numer
  zamówienia bierze się z encji sprawy, więc dyskusja bez własnego `order_id`
  dostaje go od zwrotu z tej samej sprawy. Czyta się NA KLIK i nie zapisuje:
  status płatności starzeje się w godziny. Adres dostawy dalej nie przechodzi
  przez mapowanie.
- **E2 (0.133.0, wykonany) — szablony odpowiedzi:** gotowe teksty z polami
  `{{klient}}`, `{{zamowienie}}`, `{{zwrot}}`, `{{oferta}}`, `{{ja}}`,
  wstawiane w miejsce kursora przy każdym polu odpowiedzi. Podstawia SERWER,
  bo tylko on wie, co stoi w sprawie; pole, którego sprawa nie zna, zostaje
  widoczną klamrą — panel mówi wprost, co uzupełnić ręką. Redaguje je biuro
  w ustawieniach, wysyła zawsze człowiek.
- **E3 (0.134.0, wykonany) — raporty czasów:** piąty zakres ANALIZY liczony
  z osi czasu sprawy, bez ani jednej nowej tabeli. Mediana i p90 od głosu
  klienta do naszej odpowiedzi, osobno dla pytań i dyskusji, plus rozbiór per
  osoba z podstawą prawną monitoringu przy danych. Okno tnie po ODPOWIEDZI
  (jak przy czasach zwrotów), a seria wiadomości klienta liczy się od
  pierwszej; obok mediany stoi lista KTO CZEKA TERAZ, bo mediana mówi
  o przeszłości.
- **E4 (0.135.0, wykonany) — opinie jako piąte źródło:** rejestr `opinia`
  i piąty rodzaj `sprawa_zrodlo`; opinia z numerem zamówienia dopina się do
  sprawy tego zamówienia, więc zła ocena stoi przy zwrocie, którego dotyczy.
  Treść opinii TRZYMAMY, inaczej niż treść rozmowy — opinia jest publiczna,
  rozmowa prywatna. Odpowiadanie przez API czeka na weryfikację końcówki;
  do tego czasu odpowiada się w panelu Allegro, a rejestr trzyma status.
- **E5 (0.136.0, wykonany) — tagi i reguły:** tag wisi przy ŹRÓDLE (jak
  zdarzenie osi czasu), więc przeżywa SCAL, ROZKLEJ i przebudowę nakładki;
  sprawa pokazuje sumę tagów swoich dzisiejszych źródeł. Reguła szuka FRAZY
  w tytule i loginie — bez wyrażeń regularnych — nadaje tag i opcjonalnie
  przypisuje sprawę osobie, nigdy nie odbierając jej temu, kto już ją
  prowadzi. Reguły chodzą po każdym pobraniu i na żądanie.

Etap E jest zamknięty. Dalsze kierunki wychodzą poza pierwotną mapę:
odpowiadanie na opinie przez API (po weryfikacji końcówki), piłka ŚWIAT
(po znalezieniu producenta danych o przewoźniku) i potwierdzenie listy
`FINALNE_STATUSY_ALLEGRO` na żywym koncie.

## Czego świadomie nie robimy

- Auto-odpowiedzi do klientów — nigdy, niezależnie od etapu.
- Zapisu treści rozmów do bazy — piłka liczy się z metadanych.
- Drugiej aplikacji obok WERTIS — każda funkcja wjeżdża w istniejący panel.
