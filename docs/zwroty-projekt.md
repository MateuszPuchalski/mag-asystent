# Zwroty — projekt obiegu i lista rzeczy popsutych

Dokument z rozmowy z właścicielem (16 września 2026). Pytanie brzmiało: „jak
zaprojektowałbyś obsługę zwrotów od początku, gdy celem jest w ogóle nie klikać
w Subiekcie". Odpowiedź po czterech rundach ustaleń brzmi: **architektura, którą
mamy, jest w większości słuszna**. Przeprojektowania nie ma. Jest sześć
konkretnych rzeczy popsutych i jedna, która blokuje pięć pozostałych.

Ten plik nie opisuje stanu kodu — to robi `docs/architektura.md`. Opisuje
DECYZJE i ich uzasadnienia, żeby następna sesja nie zaczynała od zera.

---

## 1. Cel i jego granica

Cel właściciela: **wszystkie dokumenty ZW i MM wystawia aplikacja, człowiek nie
otwiera Subiekta**. Granica tego celu jest dziś jedna i jest decyzją, nie
przeszkodą techniczną: **korekty faktur (FS → KFS) zostają ręczne**. Różnica po
stronie Sfery to jedna metoda managera dokumentów, więc gdy decyzja się zmieni,
kod idzie tą samą drogą co ZW.

Do czasu zmiany tej decyzji cel brzmi precyzyjnie: **zero kliknięć na ścieżce
paragonowej**. Panel ma zwroty do faktur oznaczać jako ręczne, a nie udawać, że
automat je pominął.

## 2. Decyzje właściciela z tej rozmowy

Cztery, wszystkie wiążące dla kodu.

**D1. ZW wychodzi przy obsłudze każdego zwrotu.** Czyli tak jak dziś: po
zapisaniu kwoty, jeden ZW na jeden zwrot. Rozważane było przesunięcie ZW na
zamknięcie koszyka — odrzucone, bo dokument księgowy ma powstawać wtedy, kiedy
oddajemy pieniądze. Agregowanie ZW i tak jest niemożliwe: dokument wisi na
jednym paragonie przez `NaPodstawie(dok_Id)`.

**D2. Okno sprzedawalności jest akceptowalne.** Między ZW a MM koszyka towar
leży w pudle przy biurku, a Subiekt ma go jako stan na magazynie głównym.
Właściciel uznał to za nieistotne. Rozważany magazyn pośredni (roboczo
„BIURKO"), który zamykał to okno drugim dokumentem, **odpada** — kosztował jedno
MM na każdy zwrot i nie kupował niczego, na czym firmie zależy.

**D3. Outlet obsługujemy ręcznie.** Magazyn outletowy w Subiekcie istnieje,
w aplikacji nie jest skonfigurowany. Oferty outletowej na Allegro nie ma; outlet
to jeden regał oglądany przez klientów stacjonarnych. Do odwołania aplikacja nie
wystawia dokumentów na ten magazyn.

**D4. Zwrot idzie pełną wartością, potrącenie tylko w Allegro.** Decyzja starsza
(15 września 2026), potwierdzona w tej rozmowie. Towar używany wraca na paragon
w pełnej wartości, a obniżkę dostaje klient przez zwrot pieniędzy w Allegro.

Uzasadnienie D4 warto mieć zapisane, bo wygląda na przypadek, a nie jest.
Po pierwsze, ZW zawsze zgadza się z paragonem co do grosza — a to jedyna
kontrola przed wystawieniem złego dokumentu (`docs/sfera-com.md` §2m, krok 5).
Po drugie, potrącenie siedzi w jednym polu i nie dotyka Subiekta w ogóle.
Po trzecie, strata pokazuje się jako marża przy sprzedaży, a nie jako odpis przy
zwrocie.

## 3. Obieg po tych decyzjach

```
paczka zwrotna        skan listu                     bez dokumentu
rozpakowanie          wskazanie pozycji z paragonu   bez dokumentu
zapisanie kwoty       →  ZW do paragonu              towar na MAG
ocena „na stan"       →  pozycja wchodzi do koszyka  bez dokumentu
ocena „utylizacja"    →  pozycja wchodzi do koszyka odpadu
zamknięcie koszyka    →  MM MAG → ZWROTY (albo ODP)  pudło jedzie na halę
rozłożenie na hali    →  set_location na kartotece   bez dokumentu
domknięcie kosza      →  MM ZWROTY → MAG             towar sprzedawalny
```

Dwa miejsca w tym obiegu są dziś nieoczywiste i oba zostają.

**Bramka korekt przestaje być bramką, a staje się bezpiecznikiem.** MM koszyka
czeka, aż każdy zwrot w środku ma numer korekty (`brakujaceKorekty`
w `server/src/services/kosze-zwrotow.ts`). Przy ZW wychodzącym natychmiast numer
jest na miejscu na długo przed zamknięciem pudła. Bramka zatrzyma więc koszyk
WYŁĄCZNIE wtedy, gdy ZW padł — czyli dokładnie wtedy, gdy MM zdjęłoby stan,
którego nie ma.

Wynika z tego miara, którą warto obserwować po naprawie ZW. Przycisk wystawiający
MM mimo braku korekt ma być używany rzadko. Rutynowe użycie znaczy, że ZW dalej
nie działa — a nie, że bramka przeszkadza.

**Koszyk jest jednostką TRANSPORTOWĄ i niczym więcej.** Agreguje pozycje
z obsłużonych zwrotów do chwili zamknięcia i wystawienia jednego MM. Powód
agregacji stoi przy `enqueueMM` w `server/src/services/queue.ts`: jeden koszyk to
jeden dokument i jedna kartka dla magazyniera. Rozbicie na zadania jednopozycyjne
dałoby N dokumentów, N koszy po stronie kolektora i N wpisów w rekoncyliacji.

## 4. Co jest popsute

Sześć rzeczy, w kolejności ważności. Pierwsza blokuje wszystkie automatyczne.

### 4.1. ZW nie przechodzi na produkcji — blokada wszystkiego

`SuDokument.Zapisz()` odmówił dwa razy: 15 września (PA 745/MAG/09/2026)
i 16 września (zadanie `#1075`). Sfera oddaje `COMException 0x80040F20`,
`SzczegolyOstatniegoBledu` jest puste, a `SprawdzPoprawnosc()` przechodzi. Ten
sam ZW wystawiony ręką w Subiekcie zapisuje się bez komunikatu.

Główny podejrzany to konto usługi. `wertis-sfera` działa jako `LocalSystem`,
a Sfera bywa wrażliwa na brak profilu użytkownika. Kolejność sprawdzania:

1. Uruchomić usługę na dedykowanym koncie z prawami operatora Subiekta.
   Powtórzyć zadanie `#1075` i zapisać wynik.
2. Gdy dalej odmawia — uruchomić to samo `exe` ręcznie z sesji interaktywnej
   tego operatora. Różnica wyniku rozstrzyga, czy przyczyną jest konto.
3. Gdy i to odmawia — przyczyna siedzi w paragonie albo w uprawnieniach,
   a nie w tym, co ustawia worker.

**ROZSTRZYGNIĘTE 17 września: to było konto.** Sesja Sfery wstaje teraz na
koncie użytkownika (`WERTIS-MONIKA\mateu`), a nie `LocalSystem`, i `MM.Zapisz()`
dochodzi do walidacji dokumentu zamiast odbijać się od COM. Punkt 1 z listy
wyżej wystarczył; pozostałe dwa nie były potrzebne.

Następna odmowa jest już MERYTORYCZNA — `Brak towaru w magazynie` — i o niej
mówi punkt 4.4. Blokada automatyzacji zniknęła: KFS, RW i PW mają odtąd czym
przejść, o ile ktoś je napisze.

### 4.2. Ocena towaru ma dwie wartości, a rzeczywistość trzy

`ocenPozycje` w `server/src/services/zwroty.ts` zna „na stan" i „utylizację".
Towar używany, który w firmie jedzie na regał outletowy, nie ma swojej oceny.
Obsługa naciśnie więc „na stan" — bo to jedyne, co nie jest utylizacją.

Skutek jest konkretny, nie teoretyczny. Pudło jedzie na halę, magazynier odkłada
używkę na normalną półkę pod adresem pickingowym, MM powrotne oddaje stan na
magazyn główny. Egzemplarz otwarty staje się nie do odróżnienia od fabrycznego.
Następny kompletujący weźmie ten, który stoi bliżej — i to jest mechanizm
produkujący drugi zwrot, tym razem uzasadniony i droższy.

Przy ręcznym outlecie (D3) obieg musi wyglądać tak: pozycja outletowa zostaje
BEZ oceny, nie wchodzi do żadnego pudła, a człowiek przenosi ją do Subiekta
własnym MM. Aplikacja o tym ruchu nie wie.

Opcja tańsza od pełnej ścieżki: trzecia ocena, która nie tworzy dokumentu ani
koszyka, tylko stawia znacznik i buduje listę „do przeniesienia na outlet ręką".
**Warunek jest twardy: bez tej listy znacznika nie dodawać.** Ocena „przecena"
stała w tym samym miejscu od 0.156.0 i zeszła w 0.209.0 właśnie dlatego, że
kończyła się znacznikiem i niczym więcej. Repo zna cenę tego błędu.

### 4.3. Utylizacja zostawia na stanie ducha

Kosz odpadu jedzie MM-em na magazyn odpadu. Towar przeznaczony do zniszczenia
zostaje więc na stanie firmy. Kontrakt `ZlecenieKorekty`
w `server/src/adapters/sfera.ts` nazywa ten problem po imieniu przy
`pozycjeZniszczone` i przewiduje dla nich RW.

Do rozstrzygnięcia przez właściciela, bo to różnica w bilansie, nie w ekranie:
czy złom ma schodzić RW od razu, czy stać na magazynie odpadu do wywózki
i schodzić zbiorczym RW później.

### 4.4. Nadwyżka zwrotu nie ma czym wejść na stan

Koszyk przyjmuje każdą kartotekę, a MM ściąga ją z magazynu głównego. Nie
zawsze jest co ściągać: klient odsyła rzeczy, których nie kupił, a kartoteki
usługowe nie mają stanu w ogóle.

Kosztowało to już raz. Do koszyka Z-8 wszedł skanem koszt przesyłki, kosz się
zamknął, a Sfera odrzuciła MM zdaniem „Brak towaru" (0.371.0). Bramka pilnująca
statusu koszyka nie pomogła, bo problem był w zawartości, nie w stanie.

Projekt rozdziela to na wejściu, a nie przy wystawianiu dokumentu:

* pozycja wskazana z dokumentu sprzedaży — wchodzi przez ZW,
* pozycja bez pokrycia w dokumencie — wchodzi przez PW na magazyn zwrotów,
* kartoteka usługowa — nie wchodzi do obiegu magazynowego wcale, blokada na
  skanie z jednym zdaniem na ekranie.

Wtedy MM nie ma prawa paść na braku stanu, bo każda linia kosza ma udokumentowane
wejście.

### 4.5. Jeden karton nosi dwa imiona

Obsługa napełnia koszyk „Z-7", a hala rozkłada kosz z jego dokumentu — „1209".
Raport cyklu musi je zszywać heurystyką po czasie, bo numery MM powtarzają się
co rok (`server/src/services/cykl-zwrotow.ts`). Przedrostek `Z-` istnieje po to,
żeby te dwie przestrzenie nazw się nie zderzyły.

Docelowo kod nadaje aplikacja i jest jeden przez całe życie pudła. Numer MM jest
atrybutem kosza, nie jego nazwą. Etykieta drukuje kod kreskowy, więc magazynier
skanuje zamiast przepisywać liczbę z kartki.

### 4.6. Brakujące dokumenty względem celu „zero kliknięć"

| dokument | stan |
|---|---|
| MM | działa |
| ZW | zaimplementowany, nie przechodzi na produkcji (4.1) |
| KFS | kontrakt jest, nic go nie nadaje — decyzja o ręcznych fakturach |
| RW | w kontrakcie, bez wejścia w obiegu (4.3) |
| PW | nie istnieje (4.4) |

## 5. Kolejność prac

1. Rozstrzygnąć `0x80040F20` (4.1). Bez tego reszta automatyzacji nie ma sensu.
2. ~~Blokada kartotek spoza magazynu przy dokładaniu do koszyka~~ — **zrobione
   w 0.374.0**. Bramka stoi na numerze `TW_ID_PRZESYLKA` i na braku wiersza
   stanu, bo tylko te dwie rzeczy wiemy na pewno.
3. ~~Trzecia ocena z listą roboczą~~ — **zrobione w 0.375.0**. Ocena „na outlet"
   nie tworzy dokumentu; kończy się paskiem „Na regał outletowy" i meldunkiem
   o przeniesieniu.
4. PW dla nadwyżek (4.4, druga połowa) — zostaje.
5. RW dla utylizacji, po decyzji o bilansie (4.3) — zostaje.
6. ~~Jeden numer kosza~~ — **zrobione w 0.376.0**: koszyk dostaje swój dokument
   MM, a hala otwiera go z jego własnej etykiety. **Etykieta z kodem kreskowym
   zostaje** i wymaga decyzji: nowa zależność (biblioteka kodów kreskowych) albo
   własny koder Code128 z tablicą wziętą ze specyfikacji, nie z pamięci.
7. KFS — tylko jeśli właściciel odwróci decyzję o ręcznych fakturach.

Punkty 4 i 5 są niezależne od Sfery po naszej stronie, ale ich wykonanie i tak
zatrzyma się na punkcie 1: to worker Sfery wystawia dokumenty.

## 6. Czego ten projekt NIE rozstrzyga

**Ręczna sprzedaż z magazynu outletowego.** Gdy sprzedawca przy ladzie wystawi
paragon z magazynu głównego zamiast outletowego, stan outletu nigdy nie zejdzie.
Aplikacja nie wystawia sprzedaży i nie ma jak temu zapobiec. Wykrycie jest
tańsze niż zapobieganie: outlet to jeden regał, więc inwentaryzacja całości
zajmuje kwadrans (`server/src/inwentarz-run.ts`).

**Rekoncyliacja stanów buforowych.** Twierdzenie „nikt nie klika w Subiekcie"
wolno postawić dopiero wtedy, gdy coś je sprawdza. Porównanie stanu magazynów
buforowych z sumą ruchu zapisaną w aplikacji jest jedyną drogą; bez niego
pierwsze ręczne kliknięcie rozjeżdża stan po cichu. Kolumna
`powrot_poza_aplikacja` w tabeli `kosz` jest dowodem, że ręczne rozliczenia się
zdarzają.
