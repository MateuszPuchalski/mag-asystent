# Zwroty — projekt obiegu i otwarte sprawy

Pytanie właściciela brzmiało: „jak zaprojektowałbyś obsługę zwrotów od
początku, gdy celem jest w ogóle nie klikać w Subiekcie". Odpowiedź: **architektura,
którą mamy, jest w większości słuszna**. Zostały konkretne luki, opisane w §4.

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

## 2. Decyzje właściciela

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

## 4. Co zostaje otwarte

### 4.1. ZW nie przechodzi na produkcji

`SuDokument.Zapisz()` odmawia ZW kodem `COMException 0x80040F20`, a ten sam ZW
wystawiony ręką przechodzi. Konto, operator, kasa i paragon są wykluczone. Stan
dochodzenia i hipotezy stoją w `docs/sfera-com.md` §2m. Dopóki to nie jest
rozstrzygnięte, ZW zostaje ręczny. MM przechodzi walidację, więc dokumenty
magazynowe (RW, PW) nie mają powodu odbijać się od COM.

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

Projekt rozdziela to na wejściu, a nie przy wystawianiu dokumentu:

* pozycja wskazana z dokumentu sprzedaży — wchodzi przez ZW,
* pozycja bez pokrycia w dokumencie — wchodzi przez PW na magazyn zwrotów,
* kartoteka usługowa — nie wchodzi do obiegu magazynowego wcale. Ta blokada
  już działa: bramka stoi na numerze `TW_ID_PRZESYLKA` i na braku wiersza stanu.

Wtedy MM nie ma prawa paść na braku stanu, bo każda linia kosza ma udokumentowane
wejście.

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
2. PW dla nadwyżek (4.4).
3. RW dla utylizacji, po decyzji o bilansie (4.3).
4. Etykieta kosza z kodem kreskowym. Wymaga decyzji: nowa zależność albo własny
   koder Code128 z tablicą wziętą ze specyfikacji, nie z pamięci.
5. KFS — tylko jeśli właściciel odwróci decyzję o ręcznych fakturach.

Punkty 2 i 3 są niezależne od Sfery po naszej stronie. Ich wykonanie i tak
zatrzyma się na punkcie 1, bo to worker Sfery wystawia dokumenty.

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
