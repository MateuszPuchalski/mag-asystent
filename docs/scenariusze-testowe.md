# Scenariusze testowe — dane do przypadków brzegowych

`npm run seed` daje kartotekę: 3415 prawdziwych towarów i kilkanaście dostaw.
Wystarcza to do ścieżki codziennej. Nie wystarcza do niczego więcej.

Przypadki, na których aplikacja naprawdę się łamie, trzeba było dotąd budować
ręcznie, przy każdym kasowaniu bazy od nowa. Części z nich nie dało się zbudować
z ekranu wcale. Nikt nie wystawi z kolektora zadania, które czeka w buforze od
pięciu dni.

`npm run seed:scenariusze` buduje je wprost w bazie. Katalog stoi niżej, a jego
źródłem jest [`server/src/db/seed-scenariusze.ts`](../server/src/db/seed-scenariusze.ts).
Test pilnuje, że oba są zgodne.

## Uruchomienie

```bash
npm run seed                 # kartoteka — raz
npm run seed:scenariusze     # scenariusze — dopisuje się do kartoteki
npm run dev                  # api :3001 + worker
```

Kolejność ma znaczenie tylko raz. `npm run seed` czyści tabele `sgt_*`, więc
kasuje też kartoteki scenariuszy. Po każdym `FORCE_SEED=1 npm run seed` powtórz
`npm run seed:scenariusze`.

Sam seed scenariuszy jest dopisaniem, nie wymianą. Kasuje wyłącznie własne
wiersze i buduje je od nowa. Uruchamiaj go, ile razy chcesz — stan bazy będzie
ten sam.

```bash
npm run seed:scenariusze -- --lista    # sam katalog, bez zapisu do bazy
```

### Trzy rzeczy, o których trzeba wiedzieć

**Ten seed nie uruchomi się przy `SGT_MODE=mssql`.** Zakłada konta ze znanym
hasłem i wystawia gotowe tokeny sesji. Na bazie firmy nie ma to prawa istnieć,
więc skrypt przerywa pracę przed pierwszym zapisem.

**Worker zjada scenariusze kolejki.** Zadania w statusie `pending` są po to,
żeby je wykonał — i wykona je w ciągu dwóch sekund od startu. Kolejkę ogląda się
przy zatrzymanym workerze (`npm run dev:api`) albo po ponownym uruchomieniu
seedu.

**Zdarzenia podpisane kontami scenariuszy giną przy ponownym seedzie.** Dotyczy
to także tych, które powstały przy twojej pracy na koncie `jan.k`. Dziennik
z prawdziwego wdrożenia nie ma z tym nic wspólnego.

## Konta i tokeny

| login | rola | hasło |
|---|---|---|
| `jan.k` | magazynier | `wertis12345` |
| `ewa.b` | magazynier | `wertis12345` |
| `biuro.test` | biuro | `wertis12345` |
| `admin.test` | admin | `wertis12345` |
| `zwolniony` | magazynier, konto wyłączone | `wertis12345` |
| `bez.hasla` | magazynier, konto bez hasła | — |

Gotowe tokeny sesji oszczędzają logowanie przy pracy z `curl`:

```bash
curl -s -H "x-session: scenariusz-jan" localhost:3001/api/queue
```

`scenariusz-jan` i `scenariusz-ewa` należą do magazynierów,
`scenariusz-biuro` do biura, a `scenariusz-admin` do admina. Token
`scenariusz-uniewazniona` jest unieważniony i ma zwracać 401.

## Zakresy identyfikatorów

Rozdział zakresów jest jedynym mechanizmem chroniącym dane z `npm run seed`.

| byt | zakres scenariuszy |
|---|---|
| kartoteki (`tw_id`) | od 900001 |
| dokumenty i zamówienia (`dok_id`) | od 9001 |
| dokumenty WZ z historią pobrań | od 20001 |
| konta | loginy z tabeli wyżej |

---

## Skan i klasyfikacja kodu

### S01 — kolizja EAN, obie kartoteki spoza dokumentu

Kod `5901234567890` mają `TEST-KOLIZJA-A` i `TEST-KOLIZJA-B`.

Zeskanuj go **w otwartej dostawie**. Odpowiedź ma mieć `kind: conflict` i dwóch
kandydatów. Praca staje, człowiek wybiera.

Poza dostawą (`GET /api/products/scan/5901234567890`) karta pokazuje pierwszą
kartotekę. Rozstrzyganie kolizji należy do rozkładania, bo tam pomyłka kosztuje
odłożenie na cudzy adres.

### S02 — kolizja EAN zawężona dokumentem

Kod `5907654321098` mają trzy kartoteki. Tylko `TEST-TRIO-1` stoi na dokumencie
`FZ 9001`.

Otwórz tę dostawę i zeskanuj kod. Odpowiedź ma być zwykłą linią, bez pytania.
Kolizja zostaje w dzienniku jako dług w kartotece.

### S03 — kartoteka bez kodu kreskowego

`TEST-BEZ-EAN` ma puste pole EAN. Znaleźć da się ją wyłącznie po symbolu albo
nazwie.

### S04 — EAN ośmio- i czternastocyfrowy

`TEST-EAN8` ma kod `59012345`, `TEST-EAN14` kod `59012345678901`. Oba mają
klasyfikować się jako EAN, nie jako tekst.

### S05 — symbol w kształcie adresu regału

Kartoteka `E05-03-02` ma symbol wyglądający jak adres. Skan tego kodu pokaże
**zawartość regału**, nigdy tej kartoteki.

Nie jest to błąd do naprawienia w kodzie. Formaty są rozłączne po liczbie
myślników i adres wygrywa. Wpis to dowód, że taki symbol w kartotece jest
niedostępny ze skanera.

### S06 — symbol z jednym myślnikiem

`T32-0203` ma jeden myślnik, więc adresem nie jest. Skan otwiera kartę towaru.
To ten sam kształt, co prawdziwe symbole `W32-0203`.

### S07 — adres regału i miejsce paletowe

`A01-02-03` to regał, `PAL-042` to paleta. Oba skany pokazują zawartość miejsca.
Pusty regał jest poprawną odpowiedzią, nie błędem.

### S08 — kod nieznany kartotece

`4006381333931` nie należy do niczego. Skan ma zwrócić `notfound`, a w dostawie
`kind: unknown`.

---

## Karta towaru

### S09 — cztery adresy naraz

`TEST-WIELE-LOK` leży pod `A01-02-03 B02-03-04 PAL-042 H04-01-02`. Pierwszy kod
jest adresem pickingowym i stoi w pastylce. Reszta idzie rzędem niżej.

### S10 — kartoteka bez adresu

`TEST-BEZ-LOK` nie ma żadnego kodu. Karta ma to powiedzieć wprost. Pozycja
z tego towaru idzie na koniec listy dostawy.

### S11 — pole lokalizacji przy limicie

`TEST-LOK-LIMIT` ma pole długości 49 znaków przy limicie 50. Licznik znaków na
karcie stoi tuż pod granicą.

Dodaj piąty adres z karty. Zapis ma zostać odrzucony albo obcięty zgodnie
z `LOC_FIELD_LIMIT` — obcięcie po cichu jest tu błędem.

### S12 — adres spoza wzorca w kartotece

`TEST-LOK-BLAD` ma w polu `paletq29`. Taki wpis nigdy nie dopasuje się do skanu
półki.

Raport przeslotowania liczy go jako „adres spoza wzorca". Lista takich wpisów
z prawdziwej kartoteki leży w [`docs/adresy-do-poprawy.md`](adresy-do-poprawy.md).

### S13 — stan ujemny

`TEST-STAN-MINUS` ma na MAG stan −3. Subiekt na to pozwala, więc karta musi to
znieść bez cudzysłowów i bez zera.

### S14 — rezerwacja większa niż stan

`TEST-REZERWACJA` ma stan 5 i rezerwację 9. Dostępne wychodzi −4.

### S15 — jednostka inna niż sztuka

`TEST-ULAMEK` sprzedaje się na metry i ma stan 12,5. Stoi też na dokumencie
`FZ 9005` w ilości 2,5.

### S16 — długa nazwa i znaki specjalne

`TEST-ZNAKI` ma w nazwie cudzysłowy, średnik i myślnik. Sprawdź kartę, wydruk
protokołu oraz eksport CSV.

### S17 — zamienniki z opisu

`TEST-ZAMIENNIK` ma w opisie zamiennik z naszej kartoteki, dwa numery obce
i zestaw z plusem.

Sekcja ma pokazać `TEST-ZAMIENNIK-B` jako klikalny wiersz ze stanem. `OEM-9988-XX`
i `FTC242+92-009` zostają szarym tekstem. Plus nie rozdziela, bo łączy części
zestawu.

### S18 — magazyny towaru

`TEST-WSZEDZIE` leży na MAG, MGP, Zwrotach, w serwisie i na ekspozycji. Magazyn
sezonowy (`ARCH`) jest pusty i **ukryty** w ustawieniach.

Karta ma pokazać serwis i ekspozycję, a magazynu sezonowego nie. Odkryj go
w ustawieniach i sprawdź, że wraca ze stanem zerowym.

### S19 — zamówienia u dostawcy

`TEST-ZAMOWIONY` stoi na czterech zamówieniach. Jedno jest po terminie, jedno
w terminie i zrealizowane w połowie, jedno bez terminu.

Czwarte odebrano w całości i **ma zniknąć z karty**. Brak wiersza jest tu
wynikiem, nie brakiem danych. Kolejność idzie po terminie, a zamówienie bez
terminu ląduje na końcu.

---

## Rozkładanie dostaw

### S20 — dostawa nietknięta

`FZ 9001` od FALON-TECH ma cztery pozycje i nikt jej nie otwierał. Postęp jest
pusty do chwili otwarcia.

### S21 — pięć statusów linii naraz

`FZ 9002` od STIHL Polska jest w toku. Ma linie w statusach `todo`, `done`,
`partial`, `skipped` i `problem`.

Linia z wyjątkiem nie trzyma dostawy otwartej. Postęp liczy ją jako domkniętą.

### S24 — dostawa zamknięta

`FZ 9003` od HUSQVARNA jest rozłożona w całości i zamknięta. Ma wypełniony numer
przesyłki oraz odpowiedź `nie` o protokole kuriera.

Po otwarciu tej dostawy w kolektorze **nie ma przycisku „ZAKOŃCZ DOSTAWĘ"**
w stopce pod listą. Zamiast tego **u góry ekranu** stoi napis `DOSTAWA
ZAKOŃCZONA` i przycisk `WRÓĆ DO LISTY DOSTAW`.

Ten przycisk ma wracać na listę dokumentów i ma być widoczny **bez
przewijania**. Stan końcowy stoi u góry właśnie dlatego: to jedyne wyjście
z zamkniętej dostawy.

To jest bramka na usterkę z 0.54.0. Dostawa domyka się sama po ostatniej
pozycji, więc przycisk zakończenia trafiał na dokument już zamknięty. Serwer
odmawiał, a ekran zostawał — bez wyjścia poza pasek górny.

### S25 — kontener na MGP w buforze

`FZ 9004` od IMPORT SHANGHAI księguje się na MGP i **stoi w buforze**. Lista
oznacza go pastylką przyjęć.

Rozkłada się identycznie jak dostawa krajowa. Po odłożeniu adresów zostaje stan
do przesunięcia na halę. Dokument w buforze nie blokuje rozkładania, ale blokuje
przesunięcie stanu (patrz S44).

### S26 — ten sam towar w dwóch wierszach

`FZ 9005` ma `TEST-DWIE-PARTIE` dwa razy: 3 i 5 sztuk. Po otwarciu dostawy ma
być jedna linia na 8 sztuk. Magazynier widzi jedną paletę.

### S27 — pozycja bez lokalizacji

`FZ 9001` niesie `TEST-BEZ-LOK`. Pozycje bez adresu idą na koniec listy jako
osobna sekcja.

### S28 — dostawa czterdziestopozycyjna

`FZ 9006` od DROBNICY ma 40 pozycji. Co siódma jest bez adresu. Sprawdź na niej
płynność listy i zwężanie odłożonych wierszy.

### S29 — dostawa jednopozycyjna

`FZ 9007` ma jedną pozycję. Odłóż ją i sprawdź, że dostawa zamyka się sama.

### S30 — dokument spoza okna

`FZ 9008` wystawiono 20 dni temu przy oknie 14 dni. Ma **nie być** na liście
dostaw, choć jego praca jest niedokończona.

W trybie `mssql` zachowanie jest inne: dostawa nierozłożona zostaje widoczna
niezależnie od wieku. Ten scenariusz pokazuje różnicę między demo a produkcją.

### S31 — typ dokumentu spoza filtru

`PZ 9009` jest dokumentem PZ, a `DOK_TYPY_DOSTAW` zna domyślnie samą FZ. Nie ma
go na liście.

Ustaw `DOK_TYPY_DOSTAW=1,10`, zrestartuj API i sprawdź, że się pojawia. Jest to
jedno ustawienie, nie zmiana kodu.

### S32 — rozjazd adresu

Otwórz `FZ 9001` i zeskanuj `TEST-WIELE-LOK`. Kartoteka wskazuje `A01-02-03`.
Zeskanuj półkę `C01-02-02`.

Aplikacja ma zapytać **przed zapisem**: ZAMIEŃ czy DODAJ. Z samego skanu tych
dwóch sytuacji odróżnić się nie da.

### S33 — przesyłka i protokół kuriera

Trzy dostawy niosą trzy stany. `FZ 9002` ma numer przesyłki i protokół `tak`.
`FZ 9003` ma numer i `nie`. `FZ 9004` nie ma nic — o przesyłkę jeszcze nie
pytano.

Wartość pusta znaczy „nie pytano" i nie wolno jej zwinąć do „nie". To ona jedzie
w formularzu do przewoźnika.

---

## Wyjątki

### S34 — pięć kategorii formularza

Dostawa `FZ 9002` ma po jednym zgłoszeniu każdej kategorii: błędny artykuł, brak
w przesyłce, uszkodzenie, zła ilość i artykuł niezamówiony.

Sprawdź `GET /api/problems/unresolved` oraz czerwony pasek na kolektorze.

### S35 — klucze sprzed 0.21.0

Dostawa `FZ 9003` ma wyjątki `qty_short`, `qty_over`, `no_space`,
`unknown_barcode` i `ean_conflict`.

Kolektor ich nie oferuje, serwer je zna. Protokół dla dostawcy ma pokazywać
etykietę („Za mało"), nigdy surowy klucz.

### S36 — zdjęcie dowodowe

Trzy zgłoszenia mają zdjęcie na dysku. Pobierz je przez
`GET /api/problems/:id/photo`.

### S37 — zdjęcie bez pliku

Jedno zgłoszenie ma referencję do pliku, którego nie ma w katalogu `data/photos`.

Zdarzy się to w firmie przy kopii bazy bez katalogu ze zdjęciami. Trasa ma
odpowiedzieć czytelnie, a protokół ma się wydrukować mimo braku.

### S38 — wyjątek rozwiązany

Jeden wyjątek z `FZ 9003` ma datę rozwiązania i notatkę. Nie pokazuje się na
liście nierozwiązanych, ale zostaje w protokole.

### S39 — średnik i cudzysłów w opisie

Dwa opisy niosą średnik i cudzysłów. Pobierz
`GET /api/delivery/:id/problems.csv` i otwórz plik w Excelu.

Kolumny mają się nie rozjechać. Separator to średnik, a znacznik kodowania
otwiera plik.

### S40 — artykuł spoza dokumentu

Dwa zgłoszenia nie mają linii dokumentu. Niosą numer katalogowy `OEM-77-521`
i `KAR00149`. Bez numeru nie dałoby się powiedzieć, co przyjechało.

---

## Kolejka Sfery i worker

Wszystkie scenariusze z tej sekcji ogląda się przy **zatrzymanym workerze**.
Uruchomiony wykona zadania w dwie sekundy — bo po to jest.

### S41 — zadanie czeka na workera

Zadanie zapisu adresu dla `TEST-WIELE-LOK`. Karta pokazuje dwa chipy: `C01-02-02`
przychodzi, `A01-02-03` schodzi. Pole w Subiekcie jeszcze się nie zmieniło.

### S42 — zadanie w backoffie

Zadanie dla `TEST-LOK-LIMIT` ma jedną nieudaną próbę i termin następnej za dwie
minuty. Kolejka ma je pokazać z komunikatem błędu, ale bez czerwieni.

### S43 — zadanie zawieszone w `processing`

Worker padł w połowie zadania i zostawił je w statusie `processing`. Jego dane
są celowo uszkodzone.

Karta towaru i kafle stanów mają to znieść bez błędu. Wiersz nie do odczytania
ma być pominięty, nie ma wywracać ekranu.

### S44 — MM czeka na wyjście dokumentu z bufora

Przesunięcie stanu z kontenera `FZ 9004` czeka w statusie `waiting_for_doc`.
Dokument stoi w buforze Subiekta.

Adres nie czeka na bufor, stan czeka. Przesunięcie na nieksięgowanym dokumencie
nie ma prawa wejść.

### S45 — bufor trzyma zadanie od pięciu dni

Drugie takie zadanie czeka od pięciu dni. Uruchom `npm run reconcile`. Raport ma
je wyłowić jako `utknelo_w_buforze`.

### S46 — zadanie w błędzie

Zapis adresu dla `TEST-BLAD-ZAPISU` wyczerpał trzy próby. Karta ma pokazać
czerwony, pulsujący chip. Dotknięcie prowadzi do kolejki z przyciskiem PONÓW.

Jest to najważniejszy wpis w całym dzienniku. Magazynier zrobił swoje, a do bazy
firmy nic nie weszło.

### S47 — błąd starszy niż doba

Zadanie przesunięcia leży w błędzie od trzech dni i nikt go nie ponowił.
`npm run reconcile` ma je zgłosić jako `zadanie_w_bledzie`.

### S48 — zadanie nieznanego typu

W kolejce stoi zadanie typu `przecena`. Uruchom workera i sprawdź log. Ma
skończyć się czytelnym błędem, nie ciszą i nie awarią procesu.

### S49 — kolejka jako rezerwacja

`TEST-MGP` ma na MGP 60 sztuk, a 40 czeka w kolejce na przesunięcie. Dostępne
jest 20.

Spróbuj przesunąć 30 sztuk. Serwer ma odmówić z kodem 409 i podać liczbę
dostępnych. Odmowa godzinę później, bez człowieka przy palecie, byłaby gorsza.

### S50 — rozjazd zapisu wobec kartoteki

Zadanie dla `TEST-ROZJAZD` ma status `done` i zapisany adres `F02-02-04`.
W kartotece stoi `A02-02-02`.

`npm run reconcile` ma zgłosić rozjazd i zapisać go do pliku CSV w katalogu
`data/reconcile`. Kod wyjścia 2 nadaje się pod alert.

---

## Konta, sesje i uprawnienia

### S51 — trzy role na czterech kontach

Zaloguj się kolejno jako `jan.k`, `ewa.b`, `biuro.test` i `admin.test`. Hasło
jest jedno dla wszystkich kont: `wertis12345`.

Konto `admin` z `npm run seed` zostaje nietknięte. Seed scenariuszy nie zna jego
hasła i nie ma prawa go podmienić.

### S52 — konto wyłączone

Konto `zwolniony` ma poprawne hasło i jest nieczynne. Logowanie ma się nie
powieść. Konta się nie kasuje, bo dziennik musi mieć na co wskazywać.

### S53 — konto-ślad bez loginu

W bazie stoi konto `Jan K` bez loginu i bez hasła. Zalogować się nim nie da,
a dziennik ma na co wskazywać.

Uruchom `POST /api/users/migrate-history` z tokenem biura. Zdarzenia podpisane
`Jan K` podepną się pod istniejące konto. Warianty `Jan` i `jan` zejdą się
w jedno **nowe** konto, bo różnią się tylko wielkością liter.

Trzy warianty dają więc dwa konta, nie jedno. Dopasowanie idzie po nazwie
znormalizowanej, nigdy po podobieństwie — zgadywanie byłoby gorsze niż uczciwy
brak.

### S54 — konto z loginem, bez hasła

Konto `bez.hasla` nie zaloguje się nigdy, choćby ktoś zgadł login. Komunikat ma
być ten sam, co przy błędnym haśle.

### S55 — trzy stany sesji

`scenariusz-jan` jest czynny. `scenariusz-uniewazniona` ma zwracać 401. Sesja
`scenariusz-stara` odezwała się ostatnio dwa miesiące temu i **nadal działa** —
bezczynność niczego nie zamyka.

### S66 — operacje wyłącznie dla admina

Od 0.24.0 trzy rzeczy umie sam admin: założyć konto o roli `biuro` albo `admin`,
odebrać komuś hasło i wyłączyć konto.

Spróbuj każdej z nich tokenem `scenariusz-biuro`. Serwer ma odmówić kodem 403.
Ten sam ruch tokenem `scenariusz-admin` ma się udać.

```bash
curl -X POST -H "x-session: scenariusz-biuro" -H 'content-type: application/json' \
  -d '{"name":"Nowe biuro","login":"biuro2","haslo":"tajnehaslo","role":"biuro"}' \
  localhost:3001/api/users
```

Rola strzegąca tożsamości nie ma jej rozdawać sama sobie. Zakładanie konta
magazyniera zostaje przy biurze, więc ta sama trasa odpowiada raz tak, raz nie —
zależnie od roli w ciele żądania.

---

## Dziennik, metryki i wydajność

### S57 — wszystkie typy zdarzeń

Dziennik niesie po jednym wpisie każdego typu, którego szuka audyt. Są wśród
nich `queue_failed`, `http_rejected`, `device_drop` i `audyt_eksport`.

Sprawdź `GET /api/events` z filtrami po osobie, towarze i dacie oraz eksport
`GET /api/events/csv`. Obie trasy wymagają roli biura albo admina.

### S58 — zdarzenia sprzed kont

Trzy wpisy mają pustą referencję do konta i nazwy `Jan`, `jan`, `Jan K`. Jest to
historia sprzed wprowadzenia kont.

Raport wydajności liczy je osobno jako nieprzypisane. Doklejenie ich do
kogokolwiek byłoby zgadywaniem.

### S59 — uszkodzony wpis w historii karty

Historia `TEST-WIELE-LOK` ma dwa wpisy do obsłużenia po staremu. Jeden ma
uszkodzone dane, drugi pochodzi sprzed zapisywania wartości poprzedniej.

Ekran ma pokazać oba i nie wywrócić się na żadnym.

### S60 — metryki

`GET /api/metrics` ma pokazać regał `B02-03-04` na liście etykiet do przedruku.
Sześć wpisów ręcznych na dziesięć skanów oznacza etykietę nie do odczytania.

Kartoteka `T32-0203` trafia na drugą listę — jej kod wpisuje się z ręki zawsze.
Wartość `p95` wynosi 480 ms przy celu 150 ms, więc metryka świeci na czerwono
celowo.

### S61 — wydajność

`GET /api/wydajnosc` daje dwa wiersze. Jan Kowalski ma 29 pozycji, więc próbka
jest wiarygodna. Ewa Bąk ma osiem i dostaje `wiarygodne: false`.

W środku serii Jana stoi 40-minutowa przerwa. Czas aktywny ma ją odciąć, więc
tempo liczy się z pracy, a nie z całego okna.

### S62 — raport kolizji kodów

`GET /api/ean-conflicts` ma pokazać dwa kody. Pierwszy zatrzymał pracę pięć
razy. Drugi bywa zawężany dokumentem, więc ma niezerowy licznik zawężeń.

---

## Raport przeslotowania

Uruchomienie: `npm run reslot -- --demo`. Wynik trafia do pliku CSV w katalogu
`data/reslot`.

Historia pobrań jest **syntetyczna**. Nadaje się do sprawdzenia raportu, nigdy
do decyzji o magazynie. Bez `npm run seed:scenariusze` raport odmawia wypisania
trzech pierwszych list, bo bez pobrań każdy indeks wygląda na martwy.

### S63 — eksmisja i awans

`TEST-ZLOTA-MARTWY` leży w strefie złotej i nie ruszył się ani razu. Trafia na
listę eksmisji.

`TEST-ROTUJACY` ma 40 pobrań i leży na poziomie 7, czyli poza strefą. Trafia na
listę awansów. Kolejność prac jest odwrotna do intuicji: najpierw eksmisja, bo
zwalnia miejsca.

### S64 — pobrania to wystąpienia, nie sztuki

`TEST-DUZE-PACZKI` wydano dwa razy po 200 sztuk. `TEST-ROTUJACY` wydano 40 razy
po jednej. Oba leżą poza strefą złotą.

Awans dostaje tylko drugi z nich. Pracę magazynu generuje liczba pobrań, a nie
suma wydanych sztuk. Mylenie tych dwóch liczb to najczęstszy błąd domowych
analiz.

### S65 — regał bez reguły strefy złotej

`TEST-BEZ-REGULY` leży na regale `D06`, dla którego reguły nie ma. Trafia na
czwartą listę, a nie do kosza „poza strefą".

Regał bez reguły nie jest regałem poza strefą. Gdyby nim był, jego martwy towar
zniknąłby z oczu.

## Zwroty Allegro

Zakładka ZWROTY w `/biuro` (rola biuro albo admin). W trybie demo
(`SGT_MODE=seeded`) pracuje adapter dev — fikcyjne zwroty bez kontaktu
z Allegro, zestrojone z dokumentami sprzedaży z tego seedu.

### S66a — nic nie pobiera się samo

Zaraz po starcie serwera karta **BRAKUJĄCE PACZKI** ma być pusta, a pod nią
zdanie „Jeszcze nic nie pobrano". W dzienniku serwera nie ma ani jednego wpisu
`[zapowiedzi]` i `[pytania]`. Odczekaj minutę: ma się nie zmienić nic.

Od 0.85.0 pobiera CZŁOWIEK. Kliknij **POBIERZ Z ALLEGRO** na karcie ZWROTY —
toast ma powiedzieć, ile zgłoszeń przyszło, a lista przestać być pusta.
Cichy przycisk kazałby klikać drugi raz „bo chyba nie zadziałało".

Ta sama reguła dotyczy pytań klientów: przycisk **ODŚWIEŻ Z ALLEGRO** na ich
karcie. Oba pobierania gasi i włącza jedno pokrętło `ALLEGRO_POLL_MS`.

### S67 — zwrot dopasowany jednoznacznie

Skan `DEVWB0001` zakłada zwrot z dwiema pozycjami (`TEST-LINIA-TODO`,
`TEST-LINIA-DONE`). Faktura `FS 30001` niesie numer zamówienia `dev-ord-1`
w numerze obcym, więc dokument dopasowuje się sam (`dopasowanie=auto`).

Decyzje per pozycja: jedna pełnowartościowa, druga do reklamacji — status
zwrotu przechodzi na `oceniony` dopiero po OBU decyzjach. Przycisk
ODDANO ŚRODKI kończy przepływ (`rozliczony`).

### S68 — dwa kandydujące paragony i etykieta przewoźnika doręczającego

Skan `DEVTW0002` — to numer przewoźnika DORĘCZAJĄCEGO (transportingWaybill),
inny niż numer nadania zwrotu. Adapter ma go znaleźć tak samo jak numer
nadania.

Towar `TEST-ROTUJACY` stoi na DWÓCH paragonach bez numeru zamówienia —
szczegół zwrotu pokazuje obu kandydatów z punktacją i czeka na wybór ręką
(`dopasowanie=reczne`). Wybór da się cofnąć.

### S69 — pozycja spoza kartoteki i etykieta nieznana

Skan `DEVWB0003` zakłada zwrot, którego pozycja ma sygnaturę spoza kartoteki —
`tw_id` zostaje puste (uczciwy brak), dokument się nie dopasowuje.

Skan dowolnego innego kodu kończy się komunikatem „Allegro nie zna tej
etykiety" i przyciskiem założenia zwrotu ręcznego.

### S69a — korekta i MM na bufor jednym kliknięciem

Zwrot z S67 z OBIEMA pozycjami oznaczonymi jako pełnowartościowe. Panel
KOREKTA + MM NA BUFOR pokazuje wtedy przycisk. Kliknięcie zakłada JEDNO
zadanie kolejki (`korekta_zwrot`), a nie dwa.

Efekt w trybie demo: stan magazynu sprzedaży nie zmienia się ani o sztukę,
bo korekta go dodaje, a MM zabiera. Zeskanowany towar ląduje na magazynie
zwrotów. Karta pokazuje oba numery: korekty i MM.

Po zleceniu decyzji nie da się już zmienić. Odmowa jest zamierzona —
dokumenty poszły na treść z chwili kliknięcia.

Cztery przypadki, w których zamiast przycisku stoi zdanie o przeszkodzie.
Pozycja bez decyzji. Brak dopasowanego dokumentu. Pozycja pełnowartościowa
bez rozpoznanej kartoteki. Zwrot bez ani jednej pozycji pełnowartościowej.

### S69b — kosz zwrotowy: od przypięcia po automatyczne cofnięcie bufora

Ciąg dalszy S69a. Po zleceniu dokumentów karta zwrotu pokazuje sekcję
KOSZ ZWROTOWY. Wpisz kod (np. `KZ-01`) i kliknij PRZYPNIJ — kosz powstaje
przy pierwszym użyciu kodu. Karta KOSZE ZWROTOWE pokazuje go jako otwarty.

Przycisk ZAMKNIJ — NA HALĘ działa dopiero, gdy dokumenty weszły do
Subiekta. Zadanie korekty w błędzie blokuje zamknięcie z czytelnym zdaniem.

Na kolektorze zamknięty kosz stoi na zakładce ZWROTY, w sekcji
KOSZE Z APLIKACJI — pod listą przyjęć z regału zwrotów.
Wejście otwiera listę pozycji w kolejności alejkowej. Skan towaru wskazuje
pozycję, skan regału ją odkłada. Towar spoza kosza dostaje odmowę.

Po ostatniej pozycji zostaje przycisk ZAKOŃCZ — COFNIJ BUFOR. Kolejka
dostaje MM ze zwrotów na magazyn główny, po jednym na pozycję. Nikt przy
komputerze niczego nie wystawia. Kod kosza wraca do obiegu.

### S69c — reklamacje wg terminu i raport procesu

Pozycja z decyzją „reklamacja" trafia na kartę REKLAMACJE. Lista sortuje
się po dniach do terminu ustawowego (14 dni od zgłoszenia w Allegro),
a wiersze po terminie są czerwone. UZNANA / ODRZUCONA pyta o notatkę
i zdejmuje wiersz z listy. Rozpatrzenie jest jednorazowe.

Karta RAPORT PROCESU ZWROTÓW pokazuje kafle: stany zwrotów, dokumenty
w kolejce i w błędzie, kosze, reklamacje po terminie oraz medianę czasu
od skanu do rozliczenia.

### S69d — statystyki zwrotów i uczciwy wskaźnik

Karta **STATYSTYKI ZWROTÓW** stoi pod raportem. Po skanie kilku etykiet
(S67–S69) tabela ma pokazać towary z liczbą zwrotów i sztuk, a pozycja spoza
kartoteki — znacznik POZA KARTOTEKĄ zamiast zniknąć z listy.

Sedno tego scenariusza to kolumna WSKAŹNIK. Przy oknie 90 dni liczy się ze
sprzedaży w read-modelu. Przełącz okno na **180 dni**: wskaźnik ma zamilknąć
w całej kolumnie, a pod tabelą ma stanąć zdanie, że sprzedaż sięga tylko
90 dni wstecz. Liczba wyliczona z pełnego licznika i niepełnego mianownika
byłaby zawyżona, a po niej ktoś mógłby wycofać dobrze sprzedający się towar.

Wykres tygodni ma mieć słupki także dla tygodni BEZ zwrotów — oś czasu bez
dziur. Lista kupujących pokazuje wyłącznie loginy z więcej niż jednym zwrotem.

### S69e — czasy obsługi zwrotu i uczciwa pustka

Karta **CZASY OBSŁUGI ZWROTU** stoi pod statystykami. Na świeżym ziarnie jest
PUSTA i to jest właściwy pierwszy widok do sprawdzenia. Każdy z pięciu kafli
ma pokazać myślnik ORAZ zdanie, dlaczego nie ma liczby. Sam myślnik wyglądałby
jak awaria karty.

Kafel PRZYJĘCIE → PÓŁKA mówi wprost rzecz, która myli najczęściej: kosze
z dokumentu MM nie mają przypiętego zwrotu, więc do całej drogi nie wchodzą.

Przejdź teraz S67–S69, żeby zwrot przeszedł drogę od skanu do półki. Kafle
mają dostać liczby, a sekcja CO STOI TERAZ — wiersze kosza czekającego na
rozłożenie i zwrotu bez domknięcia, od najstarszej sprawy. Kliknięcie wiersza
kosza otwiera jego podgląd, kliknięcie wiersza zwrotu — kartę zwrotu.

Tabela tempa per osoba ma nieść podstawę prawną monitoringu NAD sobą i nie
pokazywać liczby przy próbce mniejszej niż 20 pozycji.

### S69f — układ panelu w różnych szerokościach

Otwórz `/biuro` i zwężaj okno od pełnego ekranu do połowy. Karty mają
przechodzić z trzech kolumn na dwie i na jedną **płynnie**, bez skoku układu
i bez poziomego paska przewijania. Ten pasek na dole strony to usterka, nie
efekt uboczny.

Przewiń długą listę: pasek stanu i zakładki mają zostać na górze. Kliknij kafel
w pasku stanu — karta docelowa ma stanąć POD paskiem, w całości widoczna.

Na zakładce ZWROTY karta **WGLĄD** ma mieć rozwinięty sam RAPORT. Rozwiń
STATYSTYKI, odśwież stronę: mają zostać rozwinięte. Zwiń wszystko i zostaw
zakładkę otwartą na minutę — w narzędziach przeglądarki nie mają lecieć
żądania o raport, statystyki ani czasy. Zwinięta sekcja nie pyta serwera.

Ta sama reguła obowiązuje statystyki pytań na zakładce SPRAWY. Wejdź na
nią przy zwiniętej sekcji: ma polecieć żądanie o listę pytań i **żadne**
o statystyki. Rozwiń sekcję — dane mają dojść od razu, jednym żądaniem, nie
dwoma. Podwójne żądanie znaczy, że przywrócenie układu wzięto za kliknięcie.

Kliknij ikonę **i** przy nagłówku dowolnej karty. Objaśnienie ma się rozwinąć
pod nagłówkiem i zwinąć przy drugim kliknięciu. Po odświeżeniu strony ma być
znowu schowane — stanu objaśnień świadomie nie pamiętamy.

Kliknij wiersz zwrotu przy szerokim oknie: lista ma zostać po lewej, a karta
zwrotu stanąć obok niej, z podświetlonym wierszem. Zwęź okno poniżej 1280 px
przy otwartym zwrocie — szczegół ma zasłonić listę. Rozszerz z powrotem: ma
wrócić układ dwukolumnowy, bez odświeżania strony.

### S69g — konfiguracja za zębatką

Kliknij ikonę koła zębatego w prawym górnym rogu panelu. Widok ustawień ma
mieć cztery karty: **PROMPT EKSPERTA I FAKTY FIRMOWE**, **DANE FIRMY DO
FORMULARZY DOSTAWCÓW**, **REGUŁY STREFY ZŁOTEJ** i **LOGO DOSTAWCÓW**.

Sprawdź, że żadnej z nich nie ma na zakładkach pracy. Prompt nie stoi na
PYTANIACH, reguły nie stoją na ANALIZIE, a dane firmy nie stoją w karcie
REKLAMACJE. Zakładka ANALIZA ma za to zdanie mówiące, gdzie te reguły są.

Zmień coś w FAKTACH i zapisz. Wiersz pod przyciskiem ma pokazać datę i osobę.
Ta sama trasa na koncie biura ma odpowiedzieć 403 — prompt i fakty zmienia
wyłącznie admin, a mówi to serwer, nie przeglądarka.

Wejdź na PYTANIA i na ANALIZĘ z otwartymi narzędziami przeglądarki. Żadna
z nich nie ma już pytać o `pytania/prompt` ani o `strefa` — te dwa żądania
lecą dopiero po wejściu w ustawienia.

### S70 — dostawca z logo i dostawca bez logo

`FALON-TECH` ma wgrane logo, `STIHL Polska` nie ma. Oba dokumenty stoją na tej
samej liście dostaw, więc widać oba warianty wiersza obok siebie.

Po lewej stronie wiersza `FALON-TECH` jest logo. Po lewej stronie wiersza
`STIHL Polska` zostaje dotychczasowy kafelek z ikoną i kolorem stanu.

W `/biuro` → **DOSTAWCY** obaj są na liście. `FALON-TECH` ma podgląd logo
i przyciski `ZMIEŃ` oraz `✕`, `STIHL Polska` ma sam przycisk `WGRAJ`.

Bramka formatów: wgraj plik **SVG**, potem **WEBP**, potem **PNG**. Każdy ma
się zapisać i wyglądać na liście tak samo — przeglądarka przerabia je na jeden
format przed wysyłką. Serwer przyjmuje wyłącznie PNG i to jest celowe.

Bramka audytu: otwórz listę dostaw kilka razy i sprawdź dziennik. Zapytania
o logo, którego nie ma, **nie mogą** zostawiać w nim wpisów.

### S71 — zamienniki wypisane bez nagłówka

`TEST-ZAMIENNIK-LISTA` ma w opisie sam ciąg po podwójnym ukośniku, bez słowa
„Zamiennik". Tak wygląda część prawdziwych kartotek i do 0.61.0 sekcja była
przy nich pusta.

Sekcja **Zamienniki i opis** ma pokazać `TEST-LISTA-A` oraz `TEST-LISTA-B`
jako klikalne wiersze ze stanem. `OEM-7766-YY` ma zniknąć bez śladu — bez
nagłówka nie wiadomo, czy to zamiennik, czy numer modelu, więc nie trafia
nawet do numerów obcych.

Kontrola drugiej strony: `TEST-ZNAKI` nie ma w opisie podwójnego ukośnika
i jego sekcja ma pozostać taka jak dotąd.

### S72 — rozkładanie zwrotów z regału, czyli kosz z kartką

Ziarno scenariuszy zakłada trzy przesunięcia MM na regał zwrotów: `1200`,
`1205` i `1209`. Na kolektorze otwórz trzecią zakładkę **ZWROTY**. Pasek
u góry ma napisać ROZKŁADANIE ZWROTÓW, a lista pokazać wszystkie trzy
z datą, liczbą pozycji i stanem „do rozłożenia".

Wpisz w pole u góry `1209` i zatwierdź. Ma się otworzyć kosz z pozycjami
dokumentu — w tym pozycja `TEST-ZABLOKOWANY`, której nie ma w kartotece.
Tak wygląda towar wycofany ze sprzedaży: nazwę niesie dokument, skan kodem jej
nie znajdzie, odkłada się ją wskazaniem palcem. Wpisanie pełnego numeru `MM 1209/MAG/2026` ma dać **ten sam**
kosz, nie drugi — sprawdź, że lista dalej ma trzy wiersze.

Wskaż pozycję. Panel pod nią ma pokazać adres wielkim drukiem, stany
magazynów („MAG 12 · ZWR 3") i — gdy kartoteka ma zdjęcie — miniaturę w wierszu.
Pozycję `TEST-ZABLOKOWANY` **pomiń** z powodem „nie ma w koszu": ma zejść
z listy pracy, zostać z czerwonym podpisem i przestać blokować zakończenie.

Odłóż resztę skanem regału. Gdy nie ma już nic do odłożenia, przycisk
**ZAKOŃCZ** ma stanąć NAD listą, w pasku, który się nie przewija.

Sprawdź to przy koszu przewiniętym do ostatniej pozycji: domknięcie pracy nie
ma wymagać przewijania w żadną stronę. Nagłówek ma wtedy dopisać KOMPLET.
Kosz z pominięciem tego słowa nie dostaje.

Kliknij **ZAKOŃCZ — KOSZ ROZŁOŻONY**. Sedno
tego scenariusza: `SELECT * FROM sfera_queue WHERE type='mm'` ma zostać
**puste**. Przesunięcie na regał zrobiło biuro przed przywiezieniem kosza,
powrotne zrobi po rozłożeniu; dokument z kolektora byłby tym samym towarem
przesuniętym drugi raz. Zadania `set_location` mają natomiast powstać — dla
towaru, który zmienił miejsce.

Drogi powrotne (0.79.0). Wskaż odłożoną pozycję — panel ma dać **COFNIJ
ODŁOŻENIE**; po cofnięciu pozycja wraca do pracy, adres znika, a zadanie
`set_location` w kolejce ma status `cancelled`. Przestaw to zadanie ręcznie na
`done` i spróbuj cofnąć drugi raz: aplikacja ma odmówić i wskazać poprawę
skanem właściwego regału. Ta poprawa ma zadziałać i nadpisać adres.

Przycisk **PÓŹNIEJ — NA KONIEC LISTY** zsuwa pozycję na dół, zostawiając ją
w stanie „czeka". ZAKOŃCZ ma jej nadal nie przepuścić. Po zakończeniu kosza
przycisk **COFNIJ ZAKOŃCZENIE** ma go otworzyć z powrotem, z pozycjami
w stanie sprzed kliknięcia.

Biuro po rozłożeniu. W `/biuro` → SPRAWY kolumna **ROZŁOŻYŁ** ma
pokazać nazwisko i godzinę, a podgląd kosza — cały cykl życia: kto zamknął,
kto rozłożył. Kliknij COFNIJ ZAKOŃCZENIE: kolumna ma wrócić do myślnika.
Nazwisko, które zostałoby po cofnięciu, mówiłoby o pracy, której już nie ma.

Bramka roli: na wierszu przyjęcia akcja **JUŻ ROZŁOŻONY** należy do admina.
Na koncie magazyniera trasa `POST /api/przyjecia/:dokId/poza-aplikacja` ma
odpowiedzieć 403.

Nieznany numer: wpisz `999`. Komunikat ma mówić, czego szukać — kartki albo
synchronizacji z Subiektem — a nie samego „nie znaleziono".

### S73 — skrzynka pytań w trzech stanach

Ziarno zakłada trzy sprawy w skrzynce, po jednej na każdy stan, którym szyna
się różni. Wejdź w `/biuro` → **SPRAWY**. Od 0.115.0 skrzynka jest zwijanym
**REJESTREM PYTAŃ** w szynie po prawej — rozwiń go.

`client:44112097` czeka na szkic — nie ma odpowiedzi i nie ma dopasowanych
towarów. To sprawa, którą model dopiero policzy.

`client:44251880` ma szkic **po poprawce człowieka**. Sygnał autorstwa ma być
zgaszony: tekst nie jest już tym, co napisał model. Porównaj z przyciskiem
PRZYWRÓĆ SZKIC — on wraca do wersji surowej i sygnał ma się wtedy zapalić.

`client:44300104` jest wysłana. Nie liczy się do skrzynki, ale wchodzi do
mediany czasu odpowiedzi w statystykach.

Otwórz pierwszą sprawę na oknie szerszym niż 1280 px. Zakładka ma rozłożyć się
na trzy strefy: kolejka po lewej, wątek na środku, kontekst po prawej.

**Pasma szerokości są od 0.101.0 trzy i każde zachowuje się inaczej.** Zwężaj
okno i sprawdzaj po kolei.

Poniżej **1280 px** trzy strefy się nie mieszczą, ale kolejka zostaje: wchodzi
pasmo z szufladą. Kolejka po lewej, sprawa obok niej, a kontekst chowa się za
przyciskiem **KONTEKST** w rzędzie nad tytułem. Kliknij go — panel wjeżdża
z prawej i przyciemnia to, co pod nim.

Panel ma **trzy wyjścia** i każde trzeba sprawdzić osobno: przycisk ZAMKNIJ
w jego głowie, kliknięcie w przyciemnienie i klawisz Escape. Escape ma zamknąć
SAMĄ SZUFLADĘ — sprawa zostaje otwarta. Drugi Escape dopiero z niej wychodzi.

Poniżej **1024 px** wraca zachowanie sprzed 0.101.0: sprawa zasłania kolejkę,
a kontekst schodzi pod nią i przycisku KONTEKST nie ma.

Rozszerz okno z powrotem powyżej 1280 px przy wysuniętej szufladzie. Panel ma
zgasnąć sam, a kontekst wrócić jako trzecia kolumna — wysunięta szuflada
zasłaniałaby wtedy kolumnę, którą sama pokazuje.

To samo obowiązuje na **DOSTAWACH** i **ZWROTACH**: powłoka trzech stref jest
wspólna, więc szuflada też.

### S74 — pytanie o towar spoza oferty

`client:44380022` pytał o nóż do kosiarki NAC LS46-127. Nie mamy go
w kartotece, więc sprawa ma znacznik „poza ofertą".

Wejdź w `/biuro` → **ANALIZA** i ustaw zakres na pytania klientów. Lista
„pytali o towar spoza naszej oferty" ma pokazać ten wiersz z rozpoznanym
urządzeniem. To jest najtańszy research asortymentu, jaki firma ma.

### S75 — wykres tygodni, słupki i zdanie o szczycie

Ziarno rozkłada dziewięć pytań na dwa miesiące, a nie na jeden dzień. Bez tego
rozrzutu wykres tygodni pokazywał jeden słupek, a wszystkie paski proporcji
w tabeli towarów były jednakowej długości.

Wejdź w `/biuro` → **ANALIZA**, zakres pytania klientów, okno **90 dni**.

Tabela „najczęściej pytane towary" ma mieć pasek przy każdej liczbie. Pasek
najdłuższy należy do pierwszego wiersza — skalą jest największa wartość w tej
tabeli, nie żaden próg z góry. Obok stoi kolumna **STAN**. Towar spoza
kartoteki ma w niej myślnik, nie zero: to dwie różne odpowiedzi.

Pod wykresem tygodni stoi zdanie o szczycie. Mówi, który tydzień odstaje i ile
razy wobec mediany pozostałych. Sprawdź, czy liczba w zdaniu zgadza się
z najwyższym słupkiem. Zdanie znika, gdy szczyt nie odstaje — to jest
zamierzone, a nie brak danych.

Przełącz okno na **30 dni**. Zdanie ma zniknąć albo się zmienić, bo próbka
jest wtedy krótsza. Kafel „potwierdzonych dopasowań" ma spaść.

Ustaw **OSOBA** na Jana Kowalskiego. Zmienić mają się cztery kafle: wysłane,
mediana, udział bez poprawki i potwierdzone dopasowania. Tabela towarów,
kategorie i tygodnie zostają dla całego biura — mówi o tym zdanie pod kaflami.

### S76 — wgląd w zwroty stoi w analizie

Do 0.99.0 raport procesu, statystyki i czasy obsługi były zwijanymi sekcjami
na zakładce ZWROTY, z własnym oknem. Wgląd stał w zakładce pracy, wbrew
podziałowi, który pasek zakładek ogłasza.

Wejdź w `/biuro` → **ZWROTY**. Ma tu zostać sama praca: skan, kolejka, kosze,
reklamacje, zapowiedzi i karta konta Allegro. Kart z liczbami nie ma.

Wejdź w **ANALIZA** i ustaw zakres na zwroty. Trzy karty mają stać jedna pod
drugą, rozwinięte. Czip OKNA rządzi statystykami i czasami; raport procesu
mówi wprost, że jego nie dotyczy — liczy stan, nie okno.

W karcie „czasy obsługi" kliknij wiersz w tabeli „co stoi teraz". Panel ma
przełączyć się na zakładkę ZWROTY i otworzyć ten kosz albo ten zwrot. Kliknięcie
prowadzi przez granicę zakładek i to jest cała trudność tej przeprowadzki.

### S77 — analiza dostaw: u kogo się psuje

Ziarno zakłada osiem domkniętych dostaw u czterech dostawców, rozłożonych na
sześć tygodni. Do 0.99.0 domknięta dostawa była jedna — a jedna nie odpowiada
na pytanie „u kogo są problemy" wcale.

Wejdź w `/biuro` → **ANALIZA**, zakres **dostawy**, okno **90 dni**.

Tabela „dostawcy" jest posortowana po **udziale** pozycji z wyjątkiem, a nie po
liczbie dostaw. IMPORT SHANGHAI ma stać na górze mimo najmniejszej liczby
dostaw — to jest wniosek, którego ta karta ma dostarczać. Kolejność po liczbie
zepchnęłaby go na dół.

FALON-TECH ma dostawę zdjętą **poza WERTIS**. Sprawdź dwie rzeczy: wchodzi do
liczby dostaw i **nie wchodzi** do mediany czasu, więc kolumna MEDIANA ma przy
nim myślnik. Nikt tej dostawy tutaj nie rozkładał, więc nie ma czego zmierzyć.

Kafel „z tego poza WERTIS" ma pokazać jeden i **nie ma być czerwony**:
zamknięcie poza WERTIS jest legalną drogą, nie wpadką.

Tabela „najczęstsze wyjątki" liczy po dacie zgłoszenia, nie po dacie domknięcia
dostawy. Otwarte i rozwiązane mają wspólną skalę słupków — inaczej pasek przy
jednym typie byłby dłuższy od paska przy innym mimo mniejszej liczby.

Przełącz okno na **30 dni**. Dostawcy sprzed miesiąca mają zniknąć z tabeli,
a mediana i udziały przeliczyć się na krótszym oknie.

### S78 — jedna kolejka i dwie tafle na SPRAWACH

Do 0.114.0 zakładka SPRAWY miała trzy kolejki: wspólną, kolejkę zwrotów
i skrzynkę pytań. Każda z własnym filtrem, wszystkie o tych samych sprawach.

Wejdź w `/biuro` → **SPRAWY** na oknie szerszym niż 1024 px. Widać dwie tafle
i żadnej przerwy między nimi: kolejka po lewej, szyna rejestrów po prawej.

**Strona nie ma się przewijać.** Przewijają się tafle, każda osobno. To jest
cała treść tej zmiany — sprawdź to najpierw.

W głowie kolejki stoją trzy narzędzia, które do 0.114.0 mieszkały w trzech
kartach: skan etykiety zwrotu, wyszukiwarka klientów i rząd trzech pobrań.
Zeskanuj `999` — odpowiedź ma przyjść tu, pod polem.

Rejestry w szynie są **zwinięte**. Rozwiń REJESTR ZWROTÓW: to jest archiwum,
więc czip „Rozliczone" ma pokazać zwroty, których w kolejce nie ma.

Otwórz sprawę z kolejki. Obok niej ma zostać **ta sama kolejka**, zwężona do
szyny, z podświetlonym wierszem otwartej sprawy. Szyna rejestrów schodzi.

Kliknij login klienta w kolejce. Karta klienta ma zająć całą szerokość okna
i też mieć własne przewijanie zamiast przewijania strony.

Poniżej **1024 px** konsoli nie ma: wszystko wraca do pionowego stosu kart
i strona przewija się normalnie. Tak ma być.
