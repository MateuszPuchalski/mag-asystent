# Historia zmian WERTIS

Numer wersji stoi w **jednym miejscu** — polu `version` w `package.json`
w korzeniu repo. Bierze go stamtąd serwer (`/api/health`) i APK
(`android/app/build.gradle.kts` czyta ten plik przy budowaniu i wylicza z niego
`versionCode`). Kolektor pokazuje obie wersje na dole ekranu.

Do sierpnia 2026 numer był wpisany w trzech miejscach z komentarzem „zgodnie
z wersją monorepo" — i właśnie tak przestał być zgodny: `0.3.0` przetrwało
sześć zmergowanych zmian, w tym takie, które wymagały nowego uprawnienia SQL.
Komentarz nie jest mechanizmem.

## Kiedy który człon rośnie

Ta skala mierzy **koszt wdrożenia u klienta**, a nie zgodność API. WERTIS nie ma
publicznego API — jedynym klientem jest własny kolektor. Pytanie, na które numer
ma odpowiadać, brzmi: *„czy przy tej aktualizacji muszę coś zrobić ręką?"*

| człon | kiedy | co to znaczy dla wdrożenia |
|---|---|---|
| **MINOR** (`0.X.0`) | nowa funkcja widoczna dla człowieka **albo** zmiana wymagająca działania przy wdrożeniu | przeczytaj wpis: pozycje **[wymaga działania]** mówią, co zrobić poza `git pull` |
| **PATCH** (`0.3.X`) | poprawka błędu, dokumentacja, refaktor bez śladu na ekranie | `git pull`, `npm ci`, `npm run build`, restart usług — nic więcej |
| **MAJOR** (`1.0.0`) | **dopiero gdy system pracuje na produkcji codziennie** | zostaje `0` do tego czasu; podbicie będzie decyzją właściciela, nie skutkiem ubocznym |

**Nowy APK to zawsze osobna czynność.** `git pull` przestawia serwer od razu,
kolektor czeka na rozesłanie przez MDM — dlatego pasek na dole ekranu pokazuje
obie wersje i podświetla rozjazd. To jest stan przejściowy, nie awaria.

---

## 0.44.1 — 14 sierpnia 2026

**Dotknięcie notatki nie robiło nic — i to samo dotyczyło „ZAKOŃCZ DOSTAWĘ".**
Zgłoszenie z magazynu dotyczyło notatki; drugiej usterki nikt jeszcze nie
zdążył zauważyć, bo siedziała w tym samym miejscu.

Oba arkusze — odpowiedzi na notatkę (0.43.0) i zakończenia dostawy (0.42.0) —
wylądowały **wewnątrz** bloku `przesunFor?.let { … }`, czyli w gałęzi, która
rysuje arkusz przesunięcia stanu. Rysowały się więc wyłącznie wtedy, gdy
otwarte było przesunięcie — czyli praktycznie nigdy. Dotknięcie notatki
ustawiało stan i na tym się kończyło.

Kod był przy tym **poprawną Kotlinem** i miał zbilansowane nawiasy, więc nie
złapał go ani kompilator, ani `kt_imports_check.py`, ani bramka `build` na CI.
Zagnieżdżenie jednego `?.let` w drugim jest legalne; złe jest tylko to, co
z niego wynika na ekranie.

Oba arkusze wróciły na poziom ekranu, obok pozostałych.

**[wymaga działania]** Nic po stronie serwera — poprawka jest wyłącznie
w kolektorze i wchodzi z **nowym APK**. Do tego czasu na notatkę nie da się
odpowiedzieć, więc dostawa z notatką się nie domknie.

---

## 0.44.0 — 14 sierpnia 2026

**Instalator dostaje tryb samej aktualizacji: `-Aktualizuj`.** Zatrzymuje
usługi, pobiera nową wersję, buduje i uruchamia z powrotem. Nie zadaje ani
jednego pytania.

Pełny przebieg instalatora też aktualizuje kod, ale robi przy tym jeszcze
siedem innych rzeczy: pyta o Subiekta, przelicza magazyny, sprawdza pole
lokalizacji, zakłada konto SQL, nadaje GRANT-y, przepisuje `wertis.env` i pyta
o konto administratora. Na działającej instalacji to jest siedem okazji do
zmiany czegoś, co działa — i siedem pytań do człowieka, który chciał tylko
wgrać nową wersję.

Czego ten tryb **nie dotyka**, wprost: bazy aplikacji (`server\data`), konta
SQL ani GRANT-ów, `wertis.env`, konfiguracji Subiekta, kont użytkowników,
reguły zapory i rejestracji usług w NSSM. Wszystko to już istnieje —
instalacja, której się nie stawia od nowa, nie potrzebuje niczego z tej listy.

Dwie decyzje warte zapisania. Usługi stoją przez **cały** czas budowania, a nie
tylko przy podmianie plików: `npm ci` kasuje `node_modules`, więc działający
worker traciłby moduły w locie — a objawem byłby proces, który padł „bez
powodu" w połowie aktualizacji. I dwie różne reakcje na błąd: po nieudanym
`git pull` usługi **wracają** na poprzedniej wersji (magazyn nie ma stać przez
nieudaną próbę), a po nieudanym budowaniu zostają **zatrzymane celowo**, bo
stary `dist` z nową bazą mieszałby dwie wersje.

**Wyszukiwarka w liście dostaw.** Filtruje po numerze faktury i po dostawcy.
Przy oknie trzydziestu dni lista ma kilkadziesiąt pozycji, a biuro dzwoni
z konkretnym numerem — przewijanie kciukiem w rękawicy jest wtedy najgorszą
możliwą odpowiedzią. Kolejność (do dokończenia → nowe → ukończone) liczy się po
odsianiu, więc wynik szukania zachowuje ten sam porządek co pełna lista.

Trzynaście nowych testów instalatora; pilnują głównie **nieobecności** — tego,
czego gałąź aktualizacji nie wywołuje. Dopisanie tam jednej linii ruszającej
konto SQL albo `wertis.env` nie wywraca niczego przy uruchomieniu i wyszłoby
dopiero na produkcji.

**[wymaga działania]** Nic — nowy tryb jest dodatkiem. Od następnej wersji
aktualizacja serwera to jeden wiersz, uruchomiony jako administrator:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Aktualizuj
```

---

## 0.43.0 — 14 sierpnia 2026

**Biuro może zostawić notatkę do dostawy, a rozkładający musi na nią
odpowiedzieć.** Dostawca dosyła czasem brak, którego nie ma na fakturze. Biuro
wie o tym z rozmowy albo z maila; człowiek przy palecie nie ma tego skąd
wiedzieć i musi sprawdzić, czy rzeczywiście dosłali. Do 0.43.0 jedyną drogą
było „powiedz Krzyśkowi, jak przyjdzie" — kanał, który gubi się przy zmianie
i nie zostawia po sobie ani śladu, ani odpowiedzi.

Notatka wisi na **dokumencie**, nie na lokalnym wierszu dostawy: biuro pisze ją,
zanim ktokolwiek otworzy rozkładanie, więc `delivery` zwykle jeszcze nie
istnieje. Przy okazji przeżywa zamknięcie „poza WERTIS" i jego cofnięcie.

**Odpowiedź jest obowiązkowa** i pilnują jej DWA miejsca, nie jedno. Oczywiste
to przycisk „ZAKOŃCZ DOSTAWĘ" — odmawia i cytuje treść notatki, żeby nie
trzeba jej było szukać. Drugie jest ważniejsze: **samoczynne domknięcie po
odłożeniu ostatniej pozycji**. Bramka pilnowana wyłącznie przy przycisku
obchodziłaby się przez zwykłe rozłożenie towaru, czyli przez najczęstszą
czynność w aplikacji i bez żadnej złej woli.

Na ekranie rozkładania notatka stoi **na górze**, przed podpowiedzią o skanie:
pytanie „czy dosłali trzy sztuki" trzeba przeczytać, zanim się zacznie, bo
odpowiedź bierze się z oglądania palety, a nie z pamięci pół godziny później.
Nieodpowiedziana jest bursztynowa i mówi wprost, że blokuje zamknięcie.

Odpowiedzi **nie da się podmienić**. To ona zdjęła blokadę z dokumentu, więc
zmieniona po fakcie zmieniałaby powód decyzji, która już zapadła — nowe
ustalenie to nowa notatka. Obie strony rozmowy idą do `events`.

Trzynaście nowych testów, serwer ma ich 577.

**[wymaga działania]** `git pull`, `npm run build` i restart usług — tabelę
`delivery_note` zakłada schemat przy starcie. Zmiany w kolektorze wchodzą
z **nowym APK**; do tego czasu notatki widać i pisze się je w `/biuro`, ale
odpowiedzieć nie ma jak, więc nie dodawaj ich przed rozesłaniem APK.

---

## 0.42.0 — 13 sierpnia 2026

**Trzy rzeczy w oknie dostawy: szukanie, częściowe odkładanie i zakończenie.**

**Częściowe odkładanie działało na serwerze od dawna — kolektor go nie używał.**
`putawayLine` przyjmuje ilość i sam nadaje status `partial`, ale skan półki
zawsze zamykał CAŁĄ pozycję. Trzy sztuki z dziesięciu na wierzchu kartonu nie
miały więc uczciwej odpowiedzi: albo odłożenie wszystkich dziesięciu
(nieprawda), albo wyjątek „zła ilość", czyli reklamacja do dostawcy o towarze,
który przyjechał w komplecie. W panelu odkładania są teraz **−** i **+**;
domyślnie idzie cała reszta, bo tak wygląda większość odłożeń. Przy okazji
poprawka w buforze offline: zapisywał `qtyDone = qtyDoc` niezależnie od ilości,
więc reszta partii znikała z listy pracy do czasu odpowiedzi serwera.

**Wyszukiwarka w oknie dostawy.** Filtruje po symbolu i nazwie. Droga
podstawowa to nadal skan — pole jest dla kartonu, którego kod nie chce zejść:
zdarty, zalany, zaklejony taśmą. Filtruje wyłącznie WIDOK: kolejność alejkowa,
sekcja „bez lokalizacji" i liczniki postępu liczą się z pełnej listy, bo „7
z 10" to stan dostawy, a nie stan ekranu.

**„ZAKOŃCZ DOSTAWĘ" — moment, którego nie było.** Dotąd dostawa domykała się
sama, gdy ostatnia pozycja stała się terminalna; praca porzucona w połowie
zostawała otwarta bez końca, a braki ilościowe nie zamieniały się w nic.
Magazynier, który znalazł 7 sztuk z 10, musiał pamiętać o osobnym zgłoszeniu —
jeśli nie pamiętał, różnica ginęła między dokumentem a półką.

Zakończenie robi dwie **świadomie różne** rzeczy:

- pozycja z częściowym odłożeniem → wyjątek **„zła ilość"**. Towar policzono
  i było go mniej: to fakt o dostawie i należy do protokołu rozbieżności;
- pozycja **nietknięta** → `pominięta`, **bez zgłoszenia**. Brak pracy to nie
  brak towaru — nikt tego kartonu nie otworzył, więc twierdzenie wobec dostawcy
  nie miałoby pokrycia. Karta towaru pokazuje ją dalej jako „w dostawie".

Przycisk otwiera najpierw **podsumowanie**: osobno lista idąca do dostawcy,
osobno pomijane, a przycisk potwierdzenia mówi wprost, ile zgłoszeń powstanie.
Zgłoszenie do dostawcy nie ma prawa powstać z przycisku, którego skutku nikt
nie widział.

Jedenaście nowych testów serwera, razem 564.

**[wymaga działania]** `git pull` i restart usług po stronie serwera; zmiany
w kolektorze wchodzą z **nowym APK**.

---

## 0.41.1 — 11 sierpnia 2026

**Baner „Serwer nie odpowiada" kłamał — serwer odpowiadał bez zarzutu.**
Zgłoszenie: baner wisi, choć wszystko działa. I działało: padał wyłącznie
odczyt kolejki Sfery.

Przyczyna nie ma nic wspólnego z siecią. Zadanie `set_ean` doszło po stronie
serwera w 0.37.0 i **nie doszło do enuma `QueueItemType`** w kolektorze. Pole
`type` nie miało wartości domyślnej, więc `coerceInputValues` nie miało czego
podstawić i nieznana wartość rzucała wyjątkiem. Skutek: pierwsze nadanie kodu
kreskowego wkładało do kolejki wiersz, którego kolektor nie umiał odczytać —
i od tej chwili **cała** odpowiedź `/api/queue` padała na deserializacji, co
1,5 sekundy, na każdym ekranie. Trzy porażki z rzędu zapalały baner i już nie
gasł.

Kosztowało to więcej niż jeden pasek na górze. Zamarzła pastylka kolejki,
a ekran KOLEJKA SFERY przestał pokazywać zadania **w błędzie** — czyli jedyne
miejsce, w którym widać, że zapis do Subiekta nie wszedł. Objaw wyglądał
przy tym jak słabe Wi-Fi przy regałach, więc mógł tak wyglądać miesiącami.

Poprawka jest dwuczęściowa i druga część jest ważniejsza:

- `set_ean` dochodzi do enuma pod własną nazwą,
- enum dostaje wartość `INNE`, a pole `type` **wartość domyślną**. Nieznany
  rodzaj zadania ląduje teraz w `INNE` i wiersz rysuje się normalnie —
  z `label` i `detail` od serwera — zamiast wywracać ekran. Rodzaj zadania
  dodany kiedyś po stronie serwera nie zabierze już ze sobą całej kolejki,
  a zadanie w błędzie zostanie widoczne razem z przyciskiem PONÓW.

Dwa nowe testy w `:core`: `set_ean` parsuje się pod swoją nazwą, a wiersz
o rodzaju z przyszłości nie zabiera ze sobą reszty listy. Razem 180.

**[wymaga działania]** Nic po stronie serwera — usterka była wyłącznie
w kolektorze i poprawka wchodzi z **nowym APK**. Do tego czasu obejście: baner
gaśnie sam, gdy w odpowiedzi `/api/queue` nie ma wiersza `set_ean` (czyli po
zejściu takich zadań z pierwszej setki), ale liczyć na to nie ma sensu.

---

## 0.41.0 — 11 sierpnia 2026

**Przycisk „ZMIEŃ LOKALIZACJĘ" znika z karty towaru.** Prowadził na ekran
skanu, który po zeskanowaniu półki robił dokładnie to samo, co ten sam skan
przy otwartej karcie: przy jednym adresie zastępował, przy kilku otwierał ten
sam arkusz. Duplikat, i to najgorszego rodzaju — bo był **największym
elementem karty**, choć ZASTĄP kasuje istniejący adres, a bezpieczne „+ DODAJ"
stoi wyżej jako mały chip. Waga na ekranie była odwrotna do ceny pomyłki.

Zostają dwie drogi do adresu i różnią się gestem, nie sąsiadującym przyciskiem:
**skan półki przy otwartej karcie** przenosi towar, **„+ DODAJ"** dokłada
kolejny adres.

Razem z przyciskiem wyszedł tryb zastępowania z ekranu skanu — nie miał już ani
jednego wołającego. Ekran ma teraz jedno znaczenie, więc znika stamtąd też
arkusz ZASTĄP/DODAJ (pytanie bez drugiej opcji) i nadpisywanie tytułu w pasku
górnym; pasek mówi „DODANIE LOKALIZACJI" na każdej drodze. Arkusz żyje dalej na
karcie towaru, gdzie skan przy kilku adresach jest realną decyzją.

**Cena tej zmiany, wprost:** ręczny wpis adresu przy PRZEPROWADZCE zniknął
razem z ekranem w trybie zastępowania. Przy zdartej etykiecie przeprowadzka to
teraz dwa kroki — „+ DODAJ" z wpisem ręcznym, potem USUŃ na starym chipie.
Skan półki działa jak dotąd, jednym gestem.

**Pastylka „+ DODAJ ADRES" ma tę samą bryłę co pastylka z adresem.** Obie stoją
w tym samym miejscu nagłówka i są tą samą rzeczą w dwóch stanach, a różniły się
cieniem i wysokością — karta towaru bez adresu wyglądała przez to jak inny
ekran, nie jak ta sama karta z pustym polem. Wysokość 52 dp, cień 3 dp, obrys
1,5 dp i wypełnienie przepisane wprost z `LocChip`. Napis został o dwa punkty
mniejszy od kodu adresu i to jedyna rozmyślna różnica: „+ DODAJ ADRES" ma
trzynaście znaków wobec dziewięciu w `A01-02-03` i przy pełnym rozmiarze
zjadłby wielokropek.

**[wymaga działania]** Nic po stronie serwera — to zmiana wyłącznie
w kolektorze i wchodzi z **nowym APK**.

---

## 0.40.0 — 11 sierpnia 2026

**Dostawę rozłożoną poza WERTIS można wreszcie zdjąć z listy.** Zgłoszenie
z magazynu: dostawy rozłożone starą aplikacją stoją w zakładce rozkładania
jako nietknięte, a karta towaru mówi „w dostawie, nierozłożone" o towarze,
który leży w regale.

Przyczyna jest w sposobie liczenia: postęp bierze się z `delivery_line`, więc
dokument, którego WERTIS nigdy nie widział, ma zero odłożone i całą ilość
zaległą. Sam z siebie nie wyzeruje się nigdy.

Gorzej — nie było z tego wyjścia. Dokument raz otwarty w WERTIS zostaje na
liście niezależnie od wieku (celowy wyjątek w imporcie: skrócenie okna nie ma
kasować niedokończonej pracy), a domyka się dopiero, gdy każda pozycja jest
odłożona, pominięta albo zgłoszona jako wyjątek. Towar już leży na półkach,
więc nikt tych pozycji nie zeskanuje. Jedyną drogą było zgłoszenie WYJĄTKU na
każdej z nich, czyli wpisanie fikcyjnych niezgodności do protokołów
rozbieżności — dokumentu księgowego. Narzędzie do sprzątania nie ma prawa
fałszować dowodów.

**Biuro dostaje przycisk „ROZŁOŻONE POZA WERTIS"** w panelu dokumentu, z polem
na powód. Dostawa znika z listy rozkładania i z linii „w dostawie" na karcie
towaru. Zamknięcie **nie udaje odłożenia**: nie dopisuje ani jednej pozycji,
nie zapisuje żadnego adresu, nie rusza Subiekta. Zamknięte leżą w osobnej
karcie z nazwiskiem, datą i powodem i wracają na listę jednym kliknięciem —
dostawa bez zapisanych pozycji wraca jako nietknięta, dostawa porzucona
w połowie wraca ze swoim postępem.

Status w bazie to `external`, a nie `done`, i to jest sedno. `done` znaczy
„ludzie odłożyli to tutaj i mamy z tego skany"; o takiej dostawie powiedzieć
się tego nie da. Jedna wartość na oba stany kazałaby czytać raporty odłożeń
jako pracę, której nikt nie wykonał.

Operacja jest zastrzeżona dla roli **`biuro`** i dostępna wyłącznie z `/biuro`
— nigdy z kolektora. Brygadzisty tu nie ma świadomie, choć zdejmuje cudze
locki: tamto przekłada pracę z rąk do rąk i zostaje na hali, a to orzeka, że
pracy nie ma. Skan nie wskrzesza zamkniętej dostawy po cichu — droga powrotna
prowadzi przez biuro.

Strona `/biuro` przestała tym samym być czystym odczytem, którym była od
0.18.0. Reguła nie zniknęła, tylko dostała jawną listę: test pilnuje, że
zapisy strony to dokładnie trzy rzeczy — logowanie, zamknięcie i cofnięcie.

**[wymaga działania]** Nic ponad `git pull` i restart usług. Kolumny `closed_by`
i `powod_zamkniecia` dokłada migracja przy starcie. **Nowy APK nie jest
potrzebny**: dokumenty odsiewa serwer, więc kolektor, który magazynierzy mają
dziś w rękach, przestanie je pokazywać od razu po restarcie.

---

## 0.39.1 — 11 sierpnia 2026

**„Ostatnio skanowane" pokazywało adres sprzed relokacji.** Zgłoszenie
z magazynu: wyszukać towar na ekranie głównym, wejść na kartę, zeskanować
półkę, wrócić — i pod „Ostatnio skanowane" stoi stary adres. Karta mówiła
jedno, ekran główny drugie, a nic na ekranie nie tłumaczyło, które jest
prawdą.

Lista jest migawką: wpis powstawał przy otwarciu karty i zapisywał adres
z tamtej chwili, po czym nigdy się nie odświeżał. Zły adres dożywał tak do
czterech kolejnych otwarć kart, bo dopiero piąte wypychało wpis z listy.

Teraz karta towaru odświeża swój wpis, gdy zmieni się adres albo nazwa.
Wpis idzie **za pastylką nagłówka** — za tym, co magazynier właśnie widział
— więc adres w drodze do Subiekta liczy się tak samo w obu miejscach.
Odświeżenie nie przestawia kolejności listy (kolejność mówi „co trzymałem
w ręku") i nie dopisuje towarów, których na liście nie ma.

Przy okazji: **dotknięcie pozycji listy gubiło jej nazwę.** Otwarcie karty
z „Ostatnio skanowane" zapisywało wpis bez pola `name`, więc towar, który
przed chwilą miał pod symbolem nazwę, zostawał już tylko z symbolem.

Reguły listy przeniesione do `:core` (`core/recent/OstatnioSkanowane.kt`)
razem z etykietą „brak lokalizacji", która stała wpisana z ręki w czterech
miejscach. Dziewięć nowych testów; `:core` ma ich 178.

**[wymaga działania]** Nic po stronie serwera — to zmiana wyłącznie
w kolektorze i wchodzi z **nowym APK**.

---

## 0.39.0 — 10 sierpnia 2026

**Linia „W dostawie" mówi też, od kogo ta dostawa jest.** Wiersz na karcie
towaru wygląda teraz tak: „W dostawie 6 szt — FZ 214/07/2026 · OGRÓD-POL ·
w toku".

Linia odpowiada na pytanie „stan mówi 12, a półka pusta — gdzie to jest?", więc
ma prowadzić do palety. Numer dokumentu tego nie robi: identyfikuje dostawę
w Subiekcie, ale w strefie przyjęć nie jest napisany nigdzie. Na palecie i na
kartonach widać dostawcę — i to jego magazynier czyta, szukając. Dotąd musiał
odłożyć telefon, wejść w zakładkę rozkładania i tam dopiero zobaczyć nazwę przy
tym samym dokumencie.

Dostawca stoi **między** numerem a statusem, nie na końcu. Koniec linii należy
do statusu („pominięte przy rozkładaniu", „zgłoszony problem") — to on ginie
przy zawijaniu, a niesie ostrzeżenie, że ktoś już się o tę pozycję potknął.
Dokument bez kontrahenta nie zostawia w linii wiszącej kropki.

Serwer miał tę wartość od początku — `kh_Symbol` jechał w tym samym wierszu
zapytania co numer i data, tylko nie wchodził do odpowiedzi. To ta sama
wartość, którą pokazuje lista rozkładania i linia „Zamówione u dostawcy”, więc
nazwa na karcie zgadza się z nazwą wszędzie indziej.

**[wymaga działania]** Nic ponad `git pull` — ale nazwa pojawi się na karcie
dopiero po **rozesłaniu nowego APK**. Starszy kolektor pomija nieznane pole
i rysuje linię jak dotąd, bez dostawcy.

---

## 0.38.1 — 10 sierpnia 2026

**Instalator nadaje uprawnienie do kodu kreskowego.** To on był przyczyną
odmowy `The UPDATE permission was denied on the column 'tw_PodstKodKresk'` na
produkcji: 0.37.0 dołożyło drugą kolumnę zapisu po stronie serwera, a kreator
dalej nadawał komplet sprzed tej zmiany.

**[wymaga działania]** Nic ponad `git pull` — ale **instalacja zastana dostaje
brakujący grant dopiero po ponownym uruchomieniu kreatora**. Skrypt jest
idempotentny, więc przebieg na działającej instalacji dokłada wyłącznie to,
czego brakuje. Kto nie chce uruchamiać kreatora, wykonuje jedną linię
z `docs/subiekt-gt-edu-setup.md` §2 i klika PONÓW na zadaniach w kolejce.

### Ta usterka miała już dwa precedensy i ten sam kształt

Liczba nadawanych grantów i liczba oczekiwanych rozjechały się w tym pliku
dwa razy wcześniej — po stronie ODCZYTU. Naprawiono to wtedy jedną listą
(`Get-WertisTabeleOdczytu`), z której idzie i skrypt, i próg weryfikacji.
Strona ZAPISU takiej listy nie miała: „jedna kolumna" stała wpisana z ręki
w trzech miejscach — w skrypcie, w progu i w teście — więc dołożenie drugiej
kolumny w serwerze nie miało jak pociągnąć instalatora za sobą.

Teraz zapis idzie z `Get-WertisKolumnyZapisu`, a próg i test liczą z tej samej
listy. Doszedł też test-regresja wprost na tę usterkę: uprawnienia sprzed
0.37.0 muszą zostać zgłoszone jako niekompletne, **z nazwą brakującej
kolumny** — bo „uprawnienia się nie zgadzają" nie mówi, którą linię GRANT-a
poprawić.

---

## 0.38.0 — 9 sierpnia 2026

Trzy rzeczy ze zgłoszeń po wdrożeniu 0.37.0. Jedna z nich to **cicha zmiana
danych w Subiekcie** — i to ona jest tu najważniejsza.

**[wymaga działania]** Nowy APK (dwie z trzech zmian są w kolektorze).
Poza tym `git pull`, `npm ci`, `npm run build`, restart usług.

### Ekran przetrwał przerwę i zamienił skan półki w zmianę lokalizacji

Magazynier otworzył kartę towaru, przełączył się do innej aplikacji, wrócił po
dwudziestu minutach i zeskanował etykietę regału, żeby sprawdzić jego zawartość.
Ale wciąż był na karcie towaru — a tam skan półki znaczy „ZMIEŃ LOKALIZACJĘ
TEGO TOWARU". Adres kartoteki zmienił się bez jednego pytania.

To nie była wina człowieka. Ekran przeżył przerwę, skaner nie ma pojęcia, że
minęło dwadzieścia minut, a zapis lokalizacji jest bezwarunkowy i nie ma po nim
cofnięcia. Od teraz **powrót po dłuższej niż dwuminutowej przerwie ląduje na
ekranie głównym**, gdzie skan półki pokazuje jej zawartość — czyli robi to,
czego ten człowiek chciał.

Próg, a nie „zawsze", i to jest świadomy wybór: powrót na główny po każdym
przełączeniu wyrzucałby z rozgrzebanej dostawy za każdym zerknięciem w inną
aplikację, czyli karałby rytm pracy za czynność bez żadnego ryzyka.
Niebezpieczna jest **przerwa, po której nie pamięta się, co było na ekranie** —
kilkanaście sekund pamięta się zawsze. Kreator kont jest wyjątkiem: to formularz
z wpisanymi danymi, a zakładanie konta nie reaguje na skan półki.

### Lokalizację poboczną da się uczynić podstawową

Pickingowa jest **pierwsza** lokalizacja z pola. Towar leżący w dwóch miejscach
zmienia „główne" wraz z rotacją, a jedyną drogą było dotąd skasowanie adresu
i nadanie go od nowa — czyli utrata informacji, że drugie miejsce istnieje.

Dotknięcie chipa lokalizacji daje teraz **PODSTAWOWA** obok USUŃ. Przycisk
pojawia się wyłącznie przy adresie, który podstawowy nie jest. Operacja
przestawia kolejność i **nic nie dopisuje ani nie kasuje**; prośba o podniesienie
adresu, którego towar nie ma, jest odmawiana (kolektor patrzy wtedy na inny stan
niż baza, a ciche dopisanie zamieniłoby ten rozjazd w zapis do kartoteki).

### Odmowa uprawnienia mówi teraz, co zrobić

Wdrożenie 0.37.0 potknęło się o komunikat `The UPDATE permission was denied on
the column 'tw_PodstKodKresk'` — prawdziwy, ale nie mówiący ANI SŁOWA o tym, co
z nim zrobić. Zadanie w kolejce niesie teraz gotowe polecenie:

> Konto SQL nie ma prawa zapisu do kolumny tw_PodstKodKresk. Wykonaj w SSMS na
> bazie podmiotu: `GRANT UPDATE ON dbo.tw__Towar (tw_PodstKodKresk) TO wertis;`
> — potem PONÓW to zadanie.

Oryginalny komunikat serwera SQL zostaje w drugim zdaniu: bez niego nie da się
odróżnić braku GRANT-u od `DENY` albo od wykonania polecenia na złej bazie. Ta
sama podpowiedź działa dla kolumny lokalizacji — brak GRANT-u wygląda tam
identycznie i tak samo nic nie mówił.

---

## 0.37.0 — 9 sierpnia 2026

**Kody kreskowe da się nadawać z kolektora.** Karton ma kod, kartoteka go nie ma
— do tej pory jedyną drogą było „zapamiętaj i powiedz biuru", czyli w praktyce
nic, a nazajutrz ten sam karton zatrzymywał pracę drugi raz.

**[wymaga działania]** **Nowe uprawnienie SQL i nowy APK.**

1. Na bazie Subiekta wykonaj (SSMS, konto administratora):
   ```sql
   GRANT UPDATE ON dbo.tw__Towar (tw_PodstKodKresk) TO wertis;
   ```
   Bez tego funkcja **nie pada** — kod działa na kolektorze od pierwszej chwili,
   a zapis do Subiekta czeka w kolejce ze statusem `error` i czytelnym
   komunikatem. Po nadaniu uprawnienia wystarczy PONÓW na zadaniu.
2. `git pull`, `npm ci`, `npm run build`, restart `wertis-api` i `wertis-worker`.
3. **Nowy APK** — cała obsługa nadawania jest w kolektorze.

### To jest rozszerzenie granicy zapisu i mówimy o tym wprost

Od początku projektu aplikacja zmieniała w bazie firmy **jedno** pole —
lokalizację. Teraz zmienia dwa. Zdanie „zapisuje jedną rzecz" zniknęło z README
i z opisu architektury, bo przestało być prawdziwe, a dokumentacja, która kłamie
o granicy zapisu, jest gorsza niż jej brak.

Nic poza tym się nie zmieniło: dalej zero `INSERT` do tabel dokumentów, zero
modyfikacji stanów, każdy zapis przez kolejkę i z wpisem w audycie.

### Zapis idzie dwiema drogami — i to nie jest dublowanie

Kod ląduje najpierw w bazie WERTIS (`ean_alias`), a dopiero potem, przez
kolejkę, w Subiekcie. Powód jest praktyczny: zapis do Subiekta bywa **opóźniony**
(worker pracuje sekwencyjnie) i bywa **niemożliwy** (brak GRANT-u). W obu
przypadkach skan ma zadziałać natychmiast — bo to jest jedyny powód, dla którego
ktoś ten kod nadał.

Kod nadany u nas jest **furtką, nie pierwszeństwem**: szukamy go dopiero wtedy,
gdy kartoteka Subiekta nie zwróciła ani jednego trafienia. Odwrotna kolejność
znaczyłaby, że kod nadany przy półce przykrywa kod z Subiekta — czyli że
magazynier cicho nadpisuje dane, których nie widzi.

### Trzy sytuacje, trzy różne odpowiedzi

- **Puste pole** — jeden skan i gotowe. Nic nie ginie, więc nie ma o co pytać.
- **Kartoteka ma już kod** — arkusz pokazuje `STARY → NOWY` i pyta wprost, bo
  stary kod zostaje na kartonach w hali i przestanie działać. Stary kod zapisuje
  się w audycie, więc na pytanie „czemu ten karton się nie skanuje" da się
  odpowiedzieć.
- **Kod należy do INNEJ kartoteki** — droga zamknięta, bez możliwości przejścia
  potwierdzeniem. Nadanie wyprodukowałoby kolizję (§4.5), czyli dokładnie ten
  defekt danych, który system mierzy i raportuje biuru. Próba jest przy okazji
  **zapisywana do rejestru kolizji** — widać ją, zanim zatrzyma pracę w alejce.

Zlanie dwóch ostatnich w jedno „na pewno?" byłoby najgorszym z uproszczeń:
pytanie wygląda tak samo, a odpowiedź „tak" raz naprawia kartotekę, a raz psuje
cudzą. Reguła siedzi w `:core` razem ze swoim testem.

### Gdzie się to nadaje

Dwa wejścia, oba w miejscu, w którym człowiek trzyma karton:

- **karta towaru** — linia „EAN —" była końcem drogi, teraz jest przyciskiem;
- **rozkładanie dostawy** — zeskanowany kod, którego kartoteka nie zna, zostaje
  zapamiętany; po dotknięciu właściwej pozycji z listy pojawia się propozycja
  nadania mu tego kodu. To jedyny moment, w którym wiadomo na pewno, że kod
  i towar do siebie pasują.

**Bez bufora offline** — świadomie, tak jak przesunięcie stanu. Pytanie „czy ten
kod nie należy już do innej kartoteki" musi paść, gdy człowiek stoi przy półce
i może odpowiedzieć, a nie godzinę później przy odbuforowaniu.

---

## 0.36.1 — 9 sierpnia 2026

**Poprawka: ten sam towar na dwóch dostawach pokazywał stary adres.** Magazynier
rozkładał pierwszą dostawę i nadawał towarowi nowy adres; w drugiej ten sam
towar dalej wskazywał starą półkę.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
`wertis-api`. **Bez nowego APK** — cała poprawka siedzi po stronie serwera.

### Przyczyny były dwie i każda osobno wystarczyła

1. **Zamrożony snapshot.** `lok_oczekiwana` zapisywała się RAZ, przy otwarciu
   dostawy. Dostawa otwarta wcześniej pokazywała stary adres już na zawsze —
   także długo po tym, jak kartoteka w Subiekcie była poprawna.
2. **Opóźnienie zapisu.** Nawet dostawa otwarta ZARAZ po odłożeniu widziała
   stary adres: zapis leżał jeszcze w kolejce, worker go nie wykonał,
   a read-model `sgt_towar` odświeża się dopiero przy kolejnej synchronizacji.

### Skutek nie kończył się na złym adresie

Rozjazd (§4.3) liczył się względem zamrożonej wartości, więc odłożenie towaru
pod adresem **aktualnym** podnosiło fałszywy alarm ZAMIEŃ/DODAJ i dopisywało
`location_mismatch` do raportu przepełnionych gniazd. Kolejność alejkowa idzie
po tym samym polu, czyli trasa przez halę prowadziła do starej półki.

Jedno działało dobrze i tak zostaje: **zduplikowany zapis do Subiekta nie
powstawał** — odłożenie sprawdza przed zakolejkowaniem żywą kartotekę.

### Co się zmieniło

Snapshot ma sens dla danych DOKUMENTU (co i ile przyjechało) — tam chroni pracę
przed korektą faktury w trakcie. Adres nie jest daną dokumentu, tylko kartoteki,
i zamrażanie go nie chroniło niczego. Od teraz:

- pozycja, której **nikt jeszcze nie ruszył**, bierze adres żywy: z kartoteki,
  skorygowany o zapisy czekające w kolejce — ta sama zasada, którą stosuje już
  karta towaru i zawartość regału;
- pozycja **tknięta** zachowuje swój adres z chwili pracy, bo to zapis tego,
  czego się wtedy spodziewaliśmy, i na nim stoi udokumentowany rozjazd;
- pozycja **częściowo odłożona** też go zachowuje: reszta partii ma dojechać
  tam, gdzie pojechała pierwsza połowa, a nie gonić kartotekę w połowie pracy.

Cena jest jawna: gdy ktoś zmieni adres w trakcie czyjejś pracy, wiersz może
przeskoczyć w kolejności. Przeskakuje jednak dokładnie wtedy, kiedy człowiek ma
o tym wiedzieć, a alternatywą jest wysłanie go do złego regału.

Zaufanie do kolejki jest **skończone w czasie** (dwa cykle importu). Bez tego
zadanie wykonane tydzień temu przebijałoby w nieskończoność adres zmieniony
potem ręcznie w Subiekcie.

---

## 0.36.0 — 9 sierpnia 2026

**Biuro wchodzi w fakturę.** Kliknięcie dostawy w podglądzie pokazuje jej
pozycje: zdjęcie kartoteki, ile odłożono z ilu, adres, kto odłożył i kiedy.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
`wertis-api`. **Bez nowego APK** — kolektor nie dostał ani jednego nowego pola
i to był warunek projektowy, nie przypadek (niżej).

### Pasek postępu nie odpowiadał na żadne pytanie

Lista dostaw mówiła „12/30" i na tym się kończyła. Które dwanaście, kto je
odłożył, gdzie faktycznie wylądowały — żeby to sprawdzić, trzeba było otworzyć
Subiekta obok. Najgorsze, że odpowiedzi leżały w bazie: kolumny `done_by`,
`done_at` i `lok_faktyczna` zapisywały się od 0.17.0 i **nie czytał ich nikt**.

Teraz wiersz dokumentu jest klikalny, a panel pokazuje pozycję po pozycji.
Trzy rzeczy poza samą listą:

- **Rozjazd adresu** jest wyróżniony na czerwono, z dopiskiem „zamiast X". To
  jedyna zmiana, jaką WERTIS zapisuje do Subiekta, więc biuro ma prawo widzieć
  ją przy fakturze, a nie tylko zbiorczo w rekoncyliacji.
- **„W rękach: X"** przy pozycji trzymanej właśnie przez kogoś — odpowiedź na
  „czemu to stoi", której nie było nigdzie.
- **Wyjątek w wierszu swojej pozycji**, ze zdjęciem dowodowym. Dotąd wyjątki
  żyły w osobnej sekcji i nie było widać, której pozycji faktury dotyczą.

### Wejść da się także w dokument, którego nikt nie zaczął

I to jest cała trudność tej zmiany. Otwarcie dostawy (`openDelivery`) jest
ZAPISEM: zakłada rekord, sprząta pozycje usługowe i przestawia dokument
z NIETKNIĘTA na W TOKU. Wywołanie go z biura sprawiłoby, że **samo patrzenie
zmienia stan magazynu** — lista pracy zapełniłaby się dostawami, których nikt
nie zaczął, a ludziom przy półce znikałyby blokady.

Podgląd czyta więc dwoma drogami: dokument otwarty wprost z bazy (snapshot jest
snapshotem — adres oczekiwany NIE jest odświeżany z kartoteki, bo na nim stoi
wykrywanie rozjazdu), a nietknięty przez tę samą funkcję, której użyje otwarcie.
Nagłówek mówi wprost, którą z dwóch list widzisz: druga jest prognozą i zmieni
się, gdy księgowość poprawi fakturę przed otwarciem.

Regułę „zero zapisu z podglądu" pilnuje teraz test, a nie tylko komentarz:
liczba zapisów w kodzie strony ma być równa **jeden** i jest nim logowanie.

### Dlaczego bez nowego APK

Kuszące byłoby dopisać `doneBy` do `DeliveryLineView`. Ale typy w `types.ts` są
lustrem DTO kolektora — zmiana wymusiłaby nowy APK i rozesłanie przez MDM
aplikacji, w której nic się nie zmieniło. Typy podglądu mieszkają więc
w `services/podglad-dostawy.ts` i czyta je wyłącznie strona biura.

### Zdjęcia po trzy naraz

Przy pierwszym trafieniu serwer ciągnie plik z Subiekta tą samą drogą, z której
korzystają kolektory stojące przy regale, więc otwarcie dużej dostawy nie ma
prawa ich zagłodzić. Brak zdjęcia pamiętamy — inaczej dokument z czterdziestoma
takimi kartotekami pytałby czterdzieści razy co pół minuty przez cały dzień.
Gdy `ZDJECIA_ZRODLO` jest puste, kolumna nie powstaje wcale: ramka „bez zdjęcia"
przy każdej pozycji mówiłaby o brakującej kartotece, choć brakuje ustawienia.

---

## 0.35.0 — 9 sierpnia 2026

**Pięć poprawek z hali.** Faktury do dokończenia na górze listy, odłożona
pozycja pokazuje adres, który dostała, stan magazynowy widać przy półce,
odłożone schodzą na dół, a wiersz „koszt transportu" znika z rozkładania.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
`wertis-api` i `wertis-worker`. **Nowy APK potrzebny** — trzy z pięciu zmian
siedzą w kolektorze.

### Faktury do dokończenia na górze

Lista dostaw szła dotąd po dacie dokumentu, więc rozgrzebana wczorajsza faktura
lądowała pod dzisiejszymi, których nikt jeszcze nie tknął. Teraz porządek jest
wprost o stanie pracy: **w toku → nowe → ukończone**, a wewnątrz grupy zostaje
kolejność z serwera. Reguła mieszka w `:core` (`ListaDokumentow.kt`), bo
„ukończona" to trzy różne rzeczy naraz — status dokumentu, licznik pozycji
i sam fakt, że ktoś zaczął.

### Odłożona pozycja pokazuje adres, który dostała

Towar bez lokalizacji w kartotece, odłożony i opatrzony adresem, dalej wyświetlał
**BRAK LOKALIZACJI**. Ekran czytał wyłącznie `locExpected` — snapshot z chwili
otwarcia dostawy, celowo niezmienny, bo na nim stoi wykrywanie rozjazdu i
kolejność listy. Brakowało drugiego pola: `locActual` mówi, gdzie towar
NAPRAWDĘ wylądował, i to ono wygrywa na zamkniętej pozycji. „BRAK" zostaje
zarezerwowany dla „jeszcze nigdzie".

### Stan magazynowy przy półce

Rozwinięty wiersz pokazuje, ile tego towaru już leży na hali i ile czeka
w przyjęciach. Odpowiada na pytanie zadawane przy regale — „czy tego już tam
coś nie ma" — bez schodzenia do karty towaru.

Stan jest SUROWY, bez korekty o kolejkę i rezerwacje: przy półce liczy się to,
co stoi fizycznie. Przy dostawie krajowej towar figuruje na MAG od zaksięgowania
dokumentu, więc `stanMag` zawiera już to, co magazynier niesie w rękach —
kolektor pisze o tym wprost („z tą dostawą"), zamiast liczyć za człowieka.

### Odłożone pozycje schodzą na dół

Odwrócona wcześniejsza decyzja i warto powiedzieć, czym za to płacimy. Do teraz
odłożone pozycje zostawały na swoim miejscu, tylko zwężone — z obawy, że
przenoszenie ich każe wierszom skakać po każdym zapisie. Praktyka pokazała drugą
stronę: dziesięć zwiniętych pasków dalej zajmuje ekran, więc przy większym
kartonie do pozycji „do zrobienia" trzeba się przewijać przez robotę wykonaną.

Skok kosztuje mniej, niż zakładano, bo następną pozycję bierze się SKANEM,
a skan trafia w towar po symbolu, nie w miejsce na ekranie. Dwa zabezpieczenia
zostają: **pozycja z problemem nie schodzi na dół** (wyjątek czeka na decyzję,
D8), a pozycje **bez lokalizacji** są osobną grupą tuż nad zrobionymi.

### Wiersz „koszt transportu" nie jest towarem

Na części faktur zakupu stoi pozycja o symbolu `PRZESYŁKA`. Nie ma jej czym
zeskanować ani gdzie położyć, a mimo to czekała do końca dnia jako jedyna
niezałatwiona linia i kazała komuś zgłaszać problem na coś, co problemem nie
jest. Teraz wypada ze **snapshotu** dostawy, czyli nie istnieje dla tej pracy
w ogóle.

To jest wyjątek od reguły „rozkładanie JEST sprawdzaniem faktury i liczy się
KAŻDĄ pozycję", więc cena jest jawna: dostawa z samą przesyłką zamyka się
natychmiast, a licznik pozycji jest o tę jedną mniejszy niż w Subiekcie.
Dlatego licznik PRZED otwarciem dostawy odsiewa dokładnie to samo — liczba
zmieniająca się od samego wejścia w ekran wyglądałaby jak zgubiona pozycja.

Rozpoznajemy po SYMBOLU, nie po opisie: opis jest polem swobodnym i różni się
między dostawcami. Lista symboli siedzi w `POZYCJE_NIE_TOWAROWE` (domyślnie
`PRZESYŁKA`, puste = funkcja wyłączona), a porównanie ignoruje wielkość liter,
polskie ogonki i myślniki — tym samym składaniem, którego używa wyszukiwarka.
Subiekt ma wprawdzie `tw_Rodzaj` z literą `U` dla usług i to byłoby źródło
pewniejsze, ale read-model tej kolumny nie ma; gdyby usług przybyło, jest to
właściwy następny krok.

Dostawy otwarte STARSZĄ wersją mają ten wiersz w snapshocie i bez sprzątania
zostałby tam na zawsze — dostawa raz otwarta nigdy nie wraca do gałęzi
snapshotującej. Wznowienie kasuje go, ale **wyłącznie z linii nietkniętych**:
jeśli ktoś zdążył na niej cokolwiek zrobić, to ślad ludzkiej decyzji i zostaje.

---

## 0.34.0 — 8 sierpnia 2026

**Wyszukiwarka wybacza.** Wpisany `gaznik` znajduje `gaźnik`, słowa mogą iść
w dowolnej kolejności, myślnik w symbolu nie ma znaczenia, a literówka nie
kończy szukania.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
`wertis-api`. **Bez nowego APK** — kolektor nie szuka lokalnie, tylko pyta
serwer, więc cała zmiana siedzi po jednej stronie.

### Zepsute były dwie rzeczy, nie jedna

Zgłoszenie brzmiało: „wpisuję gaznik i nie znajduje gaźnika". Przyczyna sięgała
głębiej, bo SQLite nie zna polskich liter w żadnej z funkcji, których
używaliśmy:

```
lower('GAŹNIK')                     → 'gaŹnik'
'gaźnik' = 'GAŹNIK' COLLATE NOCASE  → 0
```

Diakrytyki nie były składane — i to było zgłoszenie. Ale **wielkość liter też
nie działała dla polskich znaków**: wpisany `ŁAŃCUCH` nie znajdował kartoteki
`łańcuch`. Nikt tego nie zauważył, bo szuka się małymi literami.

Przy okazji wyszła trzecia, cicha wada: `%` i `_` wpisane w wyszukiwarkę
działały jako wieloznaczniki. Samo `%` zwracało całą kartotekę, a `Filtr 100%`
znajdowało też `Filtr 1005`.

### Cztery poziomy wyrozumiałości

**Polskie znaki i wielkość liter** — `gaznik`, `gaźnik`, `GAŹNIK` i `Gaznik`
znajdują to samo, w obie strony. Kartoteka zapisana bez ogonków też jest
znajdowana zapytaniem z ogonkami.

**Słowa w dowolnej kolejności** — `ssanie gaznik` znajduje `Gaźnik ssanie
ręczne`. Cała fraza w jednym kawałku wygrywa z rozproszonymi słowami, więc
kolejność nadal coś znaczy dla trafności, tylko nie decyduje o znalezieniu.

**Myślniki i spacje w symbolu** — `LS51139`, `ls51-139` i `LS51 139` to jedno
i to samo. Etykieta bywa zdarta, a numer przepisywany z ręki.

**Literówki, ale WYŁĄCZNIE gdy nic innego nie wyszło.** Odwrotność jest tu
świadoma: dopasowanie rozmyte wmieszane w ranking wypycha trafienia dokładne —
klasyczna wada wyszukiwarek, w których „gaz" wciąga „gips". Jako odpowiedź na
„nic nie znalazłem" nie ma czego zepsuć. Krótkie słowa nie dostają prawa do
literówki wcale: jeden błąd na trzech znakach zrównuje `kos`, `kot`, `koc`
i `kod`.

### Skan nigdy nie otworzy karty po literówce

Ścieżka skanu ma furtkę **wyłączoną** i to jest ważniejsze niż wygoda. Gdy skan
albo kod wpisany ręcznie daje dokładnie jeden wynik, serwer otwiera kartę bez
pytania — więc dopasowanie przybliżone prowadziłoby wprost do CUDZEJ kartoteki.
Zdarta etykieta, kod wpisany z błędem, jedno trafienie po literówce
i magazynier zapisuje adres półki nie na tym towarze. Zapis lokalizacji jest
bezwarunkowy i nie ma po nim cofnięcia.

### Pomiar zdecydował o kształcie rozwiązania

Pierwsza wersja składała obie kolumny łańcuchem osiemnastu `replace`. Na
prawdziwym katalogu demo (3415 kartotek, 2671 z polskimi znakami w nazwie)
kosztowało to **42–75 ms na zapytanie**, przy 5 ms wersji dotychczasowej.
Serwer jest jednowątkowy i w tym samym czasie odpowiada na odpytywanie listy
rozkładania, więc taki regres byłby widoczny na hali.

Nazwa idzie więc przez `GLOB` z klasami znaków (`[aAąĄ]`, `[zZźŹżŻ]`), który
niczego nie alokuje — tylko porównuje. Symbol nadal składamy, ale pełny łańcuch
liczy się wyłącznie dla wierszy ze znakiem spoza ASCII; w tej kartotece jest ich
**dwanaście na 3415**. Wynik: **10–12 ms** dla zapytania jednosłownego.

Gdyby kartoteka kiedyś urosła na tyle, że i to zacznie przeszkadzać, następnym
krokiem jest kolumna składana wyliczana przy imporcie — świadomie odrzucona
teraz, bo wymaga dopisania się do trzech miejsc zapisu, a każde przyszłe, które
o niej zapomni, robi towar po cichu niewyszukiwalnym.

## 0.33.1 — 8 sierpnia 2026

**Rysunek pudełka ustępuje zdjęciu.** W pasku listy rozkładania stały obok
siebie ikona pudełka i miniatura tego samego towaru.

**[wymaga działania]** Nowy APK przez MDM.

### Dwie ikony w jednym miejscu znaczyły to samo

Rysunek pudełka nie niósł nic — mówił „towar". Obok miniatury tego samego
towaru był powtórzeniem, bo zdjęcie mówi KTÓRY towar. Pojawia się teraz
wyłącznie wtedy, gdy kartoteka zdjęcia nie ma.

Ikony stanu zostają nietknięte i to jest granica tej zmiany. `Alert` mówi
„zgłoszony problem", `Check` mówi „odłożone" — zdjęcie żadnej z tych rzeczy nie
powie, więc podmiana zabrałaby z wiersza ostrzeżenie.

Rysunek zajmuje przy tym **tyle samo miejsca co miniatura**, choć sam jest
o połowę mniejszy. Bez tego wiersz przeskakiwałby w bok o 18 dp w chwili
doczytania zdjęcia — dokładnie ten ruch pod kciukiem, przed którym broni się
reszta tego ekranu.

Rozwinięty wiersz zostaje bez zmian. Jego zdjęcie stoi na drugim końcu paska,
w miejscu pastylki adresu, więc te dwa elementy nie sąsiadują.

## 0.33.0 — 8 sierpnia 2026

**Miniatura w pasku listy rozkładania i w ostatnio skanowanych.** Dwa miejsca,
w których zdjęcia jeszcze nie było, a decyzja „czy to ten towar" właśnie tam
zapada.

**[wymaga działania]** Nowy APK przez MDM. Po stronie serwera nic.

### Zdjęcie ma być tam, gdzie pada pytanie

Miniatury weszły wcześniej na kartę towaru, do wyników wyszukiwania, na listę
zawartości regału i do nagłówków arkuszy. W liście rozkładania stała jednak
wyłącznie w wierszu ROZWINIĘTYM — czyli po tym, jak człowiek już wybrał pozycję.

Zgłoszenie z magazynu wskazało moment wcześniejszy: pozycji szuka się wzrokiem
po pasku, zanim ręka sięgnie do kartonu. Miniatura stoi więc teraz po lewej
stronie symbolu w każdym pasku oczekującym. Rozwinięty wiersz ma swoją bez
zmian, w miejscu pastylki adresu.

Wiersz ZWINIĘTY jej nie dostaje. Pozycja jest odłożona, rozpoznawanie towaru nic
już nie wnosi, a pasek jest o połowę niższy właśnie po to, żeby dziesięć pozycji
drobnicy zmieściło się na ekranie.

Ikona stanu zostaje na swoim miejscu i to nie jest kompromis. Mówi „zrobione"
albo „zgłoszony problem" — co innego niż zdjęcie, które mówi „to ten towar".
Podmiana zabrałaby ostrzeżenie z wiersza.

Do tego lista ostatnio skanowanych: cztery pozycje, do których wraca się po
czymś, co przed chwilą trzymało się w ręku. Zdjęcia są tam już w cache'u, bo
kartę tego towaru otwierano chwilę wcześniej.

### Odczyt zdjęć z dysku schodzi z wątku rysującego

Usterka, którą odsłoniło dopiero wejście miniatur do list. Pobranie z sieci szło
na wątek dyskowy od początku, ale odczyt gotowego pliku — ścieżka NAJCZĘSTSZA,
bo plik zwykle już jest — zostawał na wątku wołającego. Przy jednym zdjęciu na
karcie nie miało to znaczenia. Jedno wejście na listę to i dwadzieścia odczytów
pod rząd, a wołane są z `LaunchedEffect`, czyli z wątku rysującego. Widać to
jako zacięcie przy przewijaniu.

## 0.32.1 — 8 sierpnia 2026

**Zdjęcie dodane w Subiekcie pojawia się nazajutrz, a nie po tygodniu.**
Do tego kartoteka z nietypowym zdjęciem głównym przestaje wyglądać na pustą.

**[wymaga działania]** Nic. Po aktualizacji nowe zdjęcia dochodzą same. Gdy
trzeba je zobaczyć od razu: `POST /api/admin/zdjecia/odswiez`.

### Dwie pamięci braku unieważniały się nawzajem

Kolektor pamięta „ta kartoteka zdjęcia nie ma" przez dobę i na tym stała
obietnica zapisana wprost w jego kodzie: zdjęcie dodane dziś w Subiekcie ma się
pokazać najdalej jutro. Serwer trzymał swój brak tak długo jak same zdjęcia,
czyli **tydzień** — jeden próg obsługiwał oba stany.

Skutek był taki, że obietnica nic nie znaczyła. Kolektor po dobie grzecznie
pytał, dostawał 404 z tygodniowej pamięci serwera i uzbrajał własny negatyw na
kolejne 24 godziny. I tak w kółko, aż do wygaśnięcia tego dłuższego progu.
Objawu nie było żadnego: zdjęcie po prostu nie pojawiało się przez tydzień,
a wszystko wyglądało na działające.

Rozdzielone. `ZDJECIA_BRAK_TTL_H` (12 godzin) dotyczy WYŁĄCZNIE stanu „nie ma
zdjęcia" — jedynego, który zmienia się przez dodanie czegoś w Subiekcie. Sam
obraz zmienia się rzadko i zostaje przy tygodniu. Konfiguracja odmawia startu,
gdy ktoś ustawi ten próg na dobę lub więcej, bo wracałby dokładnie ten błąd.

Doszło też wymuszenie: `POST /api/admin/zdjecia/odswiez` kasuje wpisy „brak"
i te po błędzie, zostawiając pobrane zdjęcia. Przy wdrożeniu, gdy sprawdza się
„czy już działa", kilkanaście godzin czekania nie jest odpowiedzią.

### Zdjęcie główne bywa czymś, czego nie da się narysować

Zakładka „Opis" w Subiekcie przyjmuje dowolną zawartość, więc jako główne
potrafi stać kontener OLE albo metaplik. Serwer brał dokładnie jeden wiersz,
nie rozpoznawał w nim obrazu i meldował „brak zdjęcia" — mimo normalnych
JPEG-ów leżących obok na tej samej kartotece.

Bierzemy teraz kilka pierwszych zdjęć w kolejności ustalonej przez Subiekt
i wybieramy pierwsze, które faktycznie jest obrazem. Liczba jest mała
świadomie: to są BLOB-y, a ciągnięcie pięciu skanów po to, żeby użyć jednego,
kosztowałoby więcej niż problem, który rozwiązuje.

Rozmiar celowo NIE jest tu kryterium. Zdjęcie za duże to nadal właściwe zdjęcie
kartoteki i zostaje przy nim zdanie mówiące, ile ważyło — po tej liczbie dobiera
się `ZDJECIA_MAX_KB`. Podmiana na inne ukryłaby powód, dla którego główne się
nie pokazuje.

## 0.32.0 — 8 sierpnia 2026

**Kreator sam włącza zdjęcia kartotek.** Sprawdza bazę, ustawia sześć kluczy
i nadaje siódmy grant — zamiast kazać przepisywać nazwy z dokumentacji.

**[wymaga działania]** Uruchom instalator z `-TylkoKonfiguracja`, żeby zdjęcia
włączyły się same. Kto wpisał klucze `ZDJECIA_*` ręką, nie musi robić nic —
scalanie z 0.31.2 zostawia je w spokoju. Miniatura wymaga APK **0.30.0 lub
nowszego**; serwer wyda zdjęcia od razu, starszy kolektor nie ma ich gdzie
narysować.

### Sześć kluczy do przepisania ręką było przeoczeniem

Gdy zdjęcia powstawały (0.30.0), nikt nie wiedział, gdzie Subiekt trzyma obraz.
Nazwy tabeli i kolumn nosiły znacznik `[WERYFIKUJ]`, więc kreator nie miał o co
zapytać — mógłby najwyżej kazać przepisać je z SSMS.

Rozpoznanie na bazie firmy zamknęło tamto pytanie w 0.31.0: `tw_ZdjecieTw`
z kolumnami `zd_IdTowar`, `zd_Zdjecie`, `zd_Glowne` i `zd_Id`. Skrypt uprawnień
od razu dostał siódmy `GRANT SELECT`. **Kreator nie dostał nic** i dalej o tym
nie wiedział, choć wszystkie sześć wartości było już znanych i stałych.
Uzasadnienie wygasło, a kod za nim nie poszedł.

Teraz kreator nie pyta, tylko sprawdza. Wymaga **kompletu czterech kolumn**,
nie samej obecności tabeli: bez `zd_Id` porządek traci rozstrzygalność, bo
`zd_IdTowar` jest kluczem obcym i przy kilku zdjęciach jednej kartoteki nie
domyka wyboru. Po wykryciu wypisuje, ile zdjęć i na ilu kartotekach znalazł.

### Siódmy grant na bazie bez tej tabeli kasował całe konto

Usterka wprowadzona razem z tamtym grantem i dotąd niewidoczna, bo w bazie
firmy tabela jest. Skrypt uprawnień idzie do serwera **jednym poleceniem**,
więc `GRANT SELECT` na nieistniejący obiekt przerywa wykonanie. Na instalacji
ze starszym Subiektem konto zostawało bez ani jednego uprawnienia, a instalator
proponował przekazanie skryptu administratorowi — skryptu, który u niego też by
się wywalił.

Grant jest teraz warunkowy, a próg weryfikacji idzie za tą samą decyzją. Obie
liczby biorą się z jednej listy, więc nie mają jak się rozjechać — ten rozjazd
zdarzył się już dwa razy i za każdym razem objawem było zdanie o niezgodnych
uprawnieniach po poprawnej instalacji.

### Kolumna ilości zrealizowanej: kreator sprawdza zamiast zgadywać

Domyślna nazwa `ob_IloscZrealizowana` była zgadnięta i zgadnięta źle — w tej
wersji bazy nie ma jej wcale, co potwierdził komplet 57 kolumn `dok_Pozycja`.
Poprawną wartością jest pusta, a dowiadywało się o tym z `/api/health` długo
po instalacji. Kreator ma otwarte połączenie i jedno zapytanie do `sys.columns`
rozstrzyga sprawę na miejscu.

Wymagało to poprawki w zapisie konfiguracji. Pusta wartość znaczyła dotąd
„nie ustawiono" i klucz nie wychodził do pliku — a przy kluczach o **niepustej
domyślnej** to jest różnica: brak wpisu przywraca wartość domyślną. Kreator nie
miał więc jak powiedzieć „tego nie ma". Dotyczyło to także `MSSQL_INSTANCE`,
gdzie pustka oznacza instancję domyślną i wracała do `INSERTGT` bez objawu.

## 0.31.2 — 8 sierpnia 2026

**Ponowne uruchomienie instalatora nie kasuje już ustawień dopisanych ręką.**
Wprowadza swoje zmiany i zostawia resztę pliku w spokoju.

**[wymaga działania]** Nic. Poprawka działa od pierwszego przebiegu po
aktualizacji; klucze, które zniknęły wcześniej, trzeba dopisać raz jeszcze.

### Plik ustawień był odtwarzany od zera

`Publish-WertisKonfiguracja` budowało `wertis.env` z listy odpowiedzi kreatora.
Klucz, o który kreator nie pyta, nie miał skąd się w tej liście wziąć — więc
znikał przy najbliższym przebiegu z `-TylkoKonfiguracja`. Dotyczyło to
dokładnie tych ustawień, które dokumentacja każe wpisać ręką: `DOK_TYPY_DOSTAW`,
`MSSQL_ZD_ZREAL_COLUMN` i komplet `ZDJECIA_*`.

Objawu nie było żadnego w chwili zdarzenia. Instalator meldował sukces, usługi
wstawały, a funkcja gasła — zakładka DOSTAWY wracała do samych FZ, sloty zdjęć
robiły się puste. Powiązanie tego z uruchomieniem kreatora sprzed tygodnia jest
pracą detektywistyczną, nie diagnozą.

### Zapis jest teraz scaleniem

Reguła mieści się w jednym zdaniu: **kreator wygrywa tam, gdzie ma zdanie**.
Klucz obecny w jego ustawieniach idzie z odpowiedzi — także wtedy, gdy jest
pusty, bo pusta nazwa instancji MSSQL znaczy „instancja domyślna" i stara
wartość musi wtedy zniknąć. Klucza, o który kreator nie pytał, funkcja nie
rusza.

Nie przeżywają dwie rzeczy i obie celowo. **Komentarze własne** — plik jest
generowany i nagłówek mówi to wprost. **Klucze od kont** (`ADMIN_LOGIN`,
`ADMIN_HASLO` i wycofany odpowiednik z 0.23.0) — sekret konta aplikacji idzie
przez API do bazy i nie ma prawa leżeć na dysku serwera. Skoro nieznany klucz przestał znaczyć
„zniknie", przebieg instalatora jest najlepszą okazją, żeby taki wpis wyczyścić.

Odczyt pliku robi `Read-WertisEnv` — odpowiednik `parseEnvFile`
z `server/src/env-file.ts`, bo obie strony muszą rozumieć tę samą składnię.
Instalator, który „nie widzi" klucza stosowanego przez aplikację, skasowałby go
mimo scalania. Zgodność parserów pilnują testy: apostrofy, cudzysłowy,
komentarz doklejony po białym znaku i `haslo#7` bez odstępu.

## 0.31.1 — 8 sierpnia 2026

**Godziny w logach przestają być dwie godziny do tyłu, a wyniki wyszukiwania
zaczynają się od tego, co realnie leży na półce.** Oba zgłoszenia z magazynu.

**[wymaga działania]** Nic obowiązkowego. Serwer wyświetla godziny w strefie
`Europe/Warsaw`; gdyby magazyn stał gdzie indziej, zmienia to `STREFA_CZASU`
w `wertis.env`. Nowy APK przez MDM — poprawka czasu na karcie towaru siedzi
po stronie kolektora.

### Czas: zapis w UTC zostaje, pokazywanie było błędem

Znaczniki w bazie są i pozostają w UTC — na tym stoi sortowanie po
`created_at`, progi rekoncyliacji i porównania leksykalne. Błąd był w warstwie
wyświetlania: godzinę wycinano z ciągu ISO (`.slice(11, 16)`, `at.drop(11)`),
czyli pokazywano czas z Greenwich przy zegarze wskazującym czas polski. Latem
dawało to dwie godziny wstecz, zimą jedną.

Objaw mylił podwójnie. Zapis sprzed chwili wyglądał na sprzed dwóch godzin, co
przy diagnozie „czy to weszło" prowadzi w złą stronę. Przy wpisach z okolic
północy myliła się też **data**: operacja o 01:30 czasu polskiego ma w bazie
23:30 UTC dnia poprzedniego i tak właśnie pokazywała się w historii.

Konwersję dostały trzy miejsca: kolejka na kolektorze (`src/czas.ts`, strefa
z ustawienia — nie ze strefy maszyny, bo serwer bywa stawiany z angielskiego
obrazu), historia na karcie towaru (`:core`, strefa urządzenia) i dziennik
w podglądzie biura (strefa przeglądarki). Znacznik bez strefy — starszy format
bez `Z` — wraca niezmieniony: zgadywanie strefy dla takiego wpisu byłoby gorsze
niż jego dosłowne powtórzenie.

Przy okazji data na **formularzu reklamacyjnym dla dostawcy**: wystawiony po
północy nosiłby datę dnia poprzedniego.

### Wyszukiwanie: najpierw to, co jest

Z ~3600 kartotek aktywnych jest ~1000, więc dwie trzecie trafień to kartoteki
martwe — zerowy stan na hali i w przyjęciach. Sortowanie po samym symbolu
wypychało je na górę alfabetem i magazynier przewijał listę, żeby dojść do
jedynej pozycji, którą można podać klientowi.

Wewnątrz tej samej trafności decyduje teraz **łączny stan** hali i przyjęć,
malejąco. Trafność zostaje kryterium pierwszym i to jest świadome: wpisany
symbol ma wygrać z przypadkowym trafieniem w nazwie, choćby tamto miało pełny
magazyn — inaczej szukanie po symbolu przestałoby działać. Symbol zostaje
ostatnim kryterium, żeby kolejność przy równym stanie była powtarzalna.

---

## 0.31.0 — 8 sierpnia 2026

**Wiadomo, gdzie Subiekt trzyma zdjęcia kartotek: `tw_ZdjecieTw`.** Ustalone
zapytaniami na bazie firmy, więc `ZDJECIA_*` przestają być zgadywanką —
komplet gotowych wartości leży w `wertis.env.example` i w opisie struktury.
Tabela ma `zd_IdTowar` (klucz obcy), `zd_Zdjecie` (obraz), `zd_Glowne`
(odpowiednik „Ustaw jako główną") i `zd_Id`.

**[wymaga działania]** Żeby włączyć zdjęcia: uruchom ponownie skrypt uprawnień
(doszedł **siódmy `GRANT SELECT`**, na `tw_ZdjecieTw`) albo instalator
z `-TylkoKonfiguracja`, wpisz sześć kluczy `ZDJECIA_*` do `wertis.env`
i zrestartuj `wertis-api`. Bez tego nic się nie zmienia.

### Klucz obcy nie rozstrzyga, które zdjęcie wziąć

Prawdziwa struktura obnażyła błąd, którego nie dało się zobaczyć bez niej.
Zapytanie kończyło porządek na kolumnie klucza, a w osobnej tabeli klucz jest
**obcy** — `zd_IdTowar` jest ten sam dla wszystkich zdjęć jednego towaru. Przy
dwóch zdjęciach bez flagi „główne" baza zwracałaby raz jedno, raz drugie;
objawem nie byłby błąd, tylko skaczący ETag i kolektory ściągające obraz przy
każdym wejściu na kartę — dokładnie to, czemu cały ten cache ma zapobiegać.

Porządek domyka teraz `ZDJECIA_KOLUMNA_KOLEJNOSC` (`zd_Id`), a **brak tego
ustawienia przy osobnej tabeli zatrzymuje start serwera**. Reguła jest
w walidacji, nie w komentarzu, bo tej pomyłki nie widać z ekranu.

### Lista tabel zamiast dwóch liczb, które się rozjeżdżają

Dodanie siódmego grantu natychmiast wywróciło test dopisany w 0.29.2 — próg
`Test-WertisUprawnienia` znowu został w tyle za skryptem i niepełny komplet
uprawnień znowu by przeszedł. To ten sam rozjazd co poprzednio, drugi raz pod
rząd, więc tym razem naprawa nie polega na przestawieniu liczby.

Tabele odczytu mieszkają teraz w **jednej liście** (`$script:WertisTabeleOdczytu`).
Skrypt generuje z niej granty, sprawdzenie bierze z niej próg, a testy liczą
z niej oczekiwanie. Dopisanie tabeli przestawia wszystko naraz — rozjazd nie
ma już jak powstać. Kreator przestał też podawać liczbę wpisaną w tekst
komunikatu.

### Czego przy okazji nie ma

`tw__Towar.tw_Logo` to `binary(50)` — pięćdziesiąt bajtów, więc nie zdjęcie.
Osobnej kolumny kolejności w `tw_ZdjecieTw` nie ma; „Sortuj" w Subiekcie
operuje kolejnością wierszy, którą odtwarza `zd_Id`. Są za to `zd_CRC`
i `tw_Zmiana.zt_ZmianaZdjecie` — pozwolą kiedyś wykrywać zmianę zdjęcia bez
pobierania obrazu, dziś rewalidację robi TTL.

---

## 0.30.0 — 8 sierpnia 2026

**Karta towaru pokazuje zdjęcie z Subiekta.** Magazynier po skanie widział
dotąd sam tekst, a nazwy się powtarzają — „nóż kosiarki" ma kilkanaście
kartotek. Zdjęcie odpowiada na pytanie zadawane przed wszystkimi innymi: czy
to na pewno TEN towar. Miniatura stoi w nagłówku karty, dotknięcie otwiera ją
na pełny ekran.

**[wymaga działania — opcjonalne]** Funkcja jest **domyślnie wyłączona**
i niczego nie zmienia, dopóki nie wskaże się źródła. Uruchomienie wymaga
ustalenia na własnej bazie, gdzie Subiekt trzyma zdjęcie — zapytania
w `docs/subiekt-gt-struktura.md`, rozdział „Gdzie Subiekt trzyma zdjęcie
kartoteki". Gdy zdjęcia leżą w osobnej tabeli, dochodzi **siódmy
`GRANT SELECT`** i ponowne uruchomienie skryptu uprawnień. Do tego nowe APK
przez MDM.

### Czego repozytorium nie wiedziało

Opis struktury InsERT GT nie wymienia ani jednej kolumny binarnej na
`tw__Towar`, a `tw_Opis` jest polem tekstowym — czyta je parser zamienników.
Gdzie naprawdę siedzi obraz, ustala się więc na kopii bazy; wszystkie nazwy
tabel i kolumn są `[WERYFIKUJ]` i mieszkają w JEDNYM pliku
(`adapters/zdjecia.sgt.ts`), tak jak wywołania COM w workerze Sfery.

Zakładka „Opis" w Subiekcie rozstrzygnęła jedną rzecz od razu: obok podglądu
stoją „Ustaw jako główną", „Sortuj" i strzałki, czyli **kartoteka może mieć
kilka zdjęć**. Kolektor pokazuje jedno i ma to być to samo, które biuro widzi
jako główne — stąd osobne ustawienia kolumny „główne" i kolumny kolejności.
Wybór bez ustalonego porządku byłby gorszy niż brak zdjęcia: `TOP 1` zwracałby
za każdym razem co innego, ETag skakałby, a kolektory pobierałyby obraz od
nowa przy każdym wejściu na kartę.

### Pół gigabajta, które nigdy nie jedzie

3415 kartotek po ~150 kB to ~500 MB. Import działa co 60 sekund na maszynie,
na której biuro wystawia faktury, więc zdjęcia **nie wchodzą do niego wcale**.
Zamiast tego cache przelotowy: pierwsze otwarcie karty pobiera jedno zdjęcie,
kolejne przez tydzień nie pytają o nic. Zmiana otwiera 100–300 kartotek, nie
3415 — pół gigabajta zamienia się w kilkaset pojedynczych zapytań po kluczu
głównym, wspólnych dla wszystkich kolektorów.

Cache siedzi w `server/data/zdjecia/` — **osobno od `data/photos/`**, i to nie
jest porządkowanie. Tamto są dowody do reklamacji, których nie wolno skasować
nigdy; to jest cache, który kasuje się sam po przekroczeniu limitu. Jeden
katalog na dwa takie cykle życia kończy się skasowanym dowodem.

### Zdjęcie jedzie przez Wi-Fi raz na towar

Karta jest odpytywana co dwie sekundy, więc zdjęcie nie mogło być jej polem —
150 kB w base64 w tym cyklu to ponad 4 MB na minutę z jednego kolektora. Jest
osobną trasą z ETagiem: kolejne wejście na kartę kończy się odpowiedzią „to
samo, co masz" o rozmiarze nagłówka. Kolektor trzyma pliki w pamięci trwałej
(nie w cache'u systemowym, który Android czyści właśnie wtedy, gdy brakuje
miejsca) — dzięki temu zdjęcie jest na ekranie także w martwej strefie hali.

Kartoteka bez zdjęcia jest zapamiętywana jako **potwierdzony brak**, na dobę.
Bez tego setki takich kartotek pytałyby Subiekta przy każdym otwarciu karty.
Błąd źródła to co innego niż brak zdjęcia i ponawia się po minutach, nie po
tygodniu — inaczej awaria sieci zapisałaby się jako trwale pusta karta.

### Slot ma stały rozmiar we wszystkich stanach

Ładowanie, zdjęcie, kartoteka bez zdjęcia i brak zasięgu wyglądają różnie, ale
zajmują tyle samo miejsca: element wskakujący po chwili przesuwa cele dotyku
pod kciukiem. Braku zdjęcia świadomie nie odróżniamy od braku zasięgu — dla
człowieka przy regale ta różnica nie jest wykonalna, a o braku sieci kolektor
mówi już globalnie.

---

## 0.29.2 — 8 sierpnia 2026

<!-- docs_check: historia -->
**Instalator przestaje meldować własną poprawną instalację jako niekompletną.**
`Test-WertisUprawnienia` żądało siedmiu `GRANT SELECT`, a skrypt uprawnień
nadaje sześć — od 0.16.0, kiedy razem z flagą sprawdzenia faktury wypadły
granty `fl_Wartosc` i `fl__Flagi`. Skrypt zszedł do sześciu, próg został przy
siedmiu i nikt tego nie zauważył, bo obie liczby żyły osobno.

Skutek dla instalującego: konto SQL z **kompletem** uprawnień nadanych przez
ten sam instalator kończyło etap czerwonym zdaniem „uprawnienia nie zgadzają
się z oczekiwanymi", a poniżej podpowiedzią „ma być 7". Naprawa jest jedną
cyfrą; wartość mają dopiero testy.

### Liczba bierze się teraz ze skryptu, nie z pamięci

Dwa nowe testy w `instalator/testy.ps1` **liczą granty w tekście skryptu**
i tę samą liczbę podają progowi. Rozjazd drugi raz nie przejdzie, a dopisanie
siódmego grantu (np. tabeli ze zdjęciami kartotek) przestawi oba naraz.
Trzeci test pilnuje reguły ważniejszej niż liczba tabel: prawo zapisu do
`dok__Dokument` ma odrzucać ocenę, choćby SELECT-ów było dość.

Przy okazji dwa zdania kreatora z tej samej epoki — jedno wymieniało kolumnę,
której instalator nie nadaje od 0.16.0, drugie podpowiadało siódemkę.

**[wymaga działania]** Nic — `git pull`, ponowne zbudowanie instalatora
(`instalator/build.ps1`), jeśli używasz wersji `.exe`.

---

## 0.29.1 — 8 sierpnia 2026

**Dokumentacja dogoniła workera Sfery.** Audyt `docs/architektura.md` przeciw
kodowi 0.29.0 znalazł osiemnaście rozjazdów — od „przyszłego workera COM",
który już istnieje, przez „zero modyfikacji stanów" (nieprawdziwe przy
`SFERA_WORKER=1`), po stare liczby tabel, typów zdarzeń, testów i workflowów.
Dokument mówi teraz prawdę: trzeci proces jest na diagramie, granica zapisu
nazywa oba warianty, niezmiennik „adres przed sprzedawalnością" wskazuje
swojego nowego strażnika (guard w zapytaniu wyboru), a lista `[WERYFIKUJ]`
jest kompletna. Przy okazji poprawione przestarzałe zdania „worker Sfery czeka
na wdrożenie" w pięciu innych dokumentach.

**Podgląd biura przestał kłamać w dwóch miejscach.** Zadanie ANULOWANE
pokazywało się jako „W DRODZE" (bursztyn obiecywał zapis, który świadomie
wycofano — teraz szara odznaka), a nowy rodzaj rekoncyliacji `mm_czeka`
wyświetlał surowy identyfikator zamiast nazwy.

**[wymaga działania]** Nic — `git pull`, `npm ci`, `npm run build`, restart
usług.

---

## 0.29.0 — 7 sierpnia 2026

**Przesunięcia magazynowe dostają wykonawcę: worker Sfery (`sfera-worker/`).**
Dokument MM — jedyna operacja, której nie da się bezpiecznie wystawić SQL-em —
ma teraz swój proces: osobna usługa Windows w C#/.NET, czytająca tę samą
kolejkę `sfera_queue` i wykonująca wyłącznie zadania `mm` przez COM Sfery.
Wymaga licencji Sfery; wywołania COM są oznaczone `[WERYFIKUJ]` i czekają na
potwierdzenie na maszynie testowej (wszystkie w jednym pliku
`sfera-worker/src/SferaComAdapter.cs`).

**[wymaga działania]** Nic dla istniejących instalacji: nowy przełącznik
`SFERA_WORKER` jest domyślnie **wyłączony** i wszystko działa jak dotąd
(MM kończy się czytelnym błędem, dokument wystawia biuro). Automatyzacja MM
to świadoma ścieżka: budowa exe wg `sfera-worker/README.md`, checklist
`[WERYFIKUJ]`, bramki z `docs/wdrozenie.md` („Dołączenie workera Sfery") —
wszystko najpierw na kopii bazy.

### Dlaczego

Rozkładanie kontenera kończyło się połowicznie: adres na półce zapisany,
a stan wisiał na MGP do ręcznego MM w biurze — każde przesunięcie lądowało
w kolejce jako czerwony błąd z przyciskiem PONÓW, który generował dokładnie
ten sam błąd. Sfera jest jedyną bezpieczną drogą do dokumentu MM (numeracja,
skutki magazynowe, wycena), a COM Sfery żyje tylko na Windows z Subiektem —
stąd osobny proces w C#, nie kod w serwerze Node.

### Podział pracy pilnowany z obu stron

Przy `SFERA_WORKER=1` worker Node **nie dotyka** zadań `mm` (filtr
w `pickTask`) — inaczej ubijałby je padającym adapterem SQL, zanim worker
Sfery zdąży je wziąć. Filtr to celowo `type <> 'mm'`, nie `= 'set_location'`:
zadanie nieznanego typu nadal dostaje czytelny błąd od Node'a zamiast wisieć
w ciszy.

### Niezmiennik „adres przed sprzedawalnością" przestał być dziełem przypadku

Przy jednym workerze kolejność wykonania była kolejnością wstawienia
(`ORDER BY id`) — dwa niezależne pollery łamią to konstrukcyjnie. Worker Sfery
pomija więc MM, dopóki wcześniejsze niewykonane `set_location` tego samego
towaru nie wejdzie; poprzednik w `error` **blokuje** (stan bezpieczny to
„adres zapisany, stan czeka"), a blokadę mierzy rekoncyliacja (nowy rodzaj
`mm_czeka`) i `/api/health`, więc nie ma cichego zakleszczenia. Zapytania
wyboru zadania mieszkają w `sfera-worker/sql/` i są wykonywane przez OBA
światy: C# jako zasób wbudowany, testy Node (`sfera-pick.test.ts`) wprost
z plików — jedno źródło prawdy, mierzone w CI bez dotneta.

### Bez nowych statusów, z pełnym audytem

Cały cykl życia mm mieści się w dotychczasowych statusach — enum na kolektorze
nie zna wartości domyślnej i nowy status wywróciłby deserializację na każdym
urządzeniu. Worker Sfery pisze te same zdarzenia audytowe
(`queue_retry`/`queue_applied`/`queue_failed`) z autorem z wiersza kolejki
i melduje się w `process_state` jak pozostałe procesy; `/api/health` przy
włączonym przełączniku raportuje blok `sfera` i zaległe MM. Padnięcie w trakcie
zapisu NIE wraca automatycznie do kolejki — zadanie ląduje w `error`
z ostrzeżeniem o możliwym duplikacie, bo COM mógł zdążyć z `Zapisz()`, a SQLite
nie; decyzję podejmuje człowiek (PONÓW).

### Instalator stawia trzecią usługę, gdy jest co stawiać

Gdy zbudowany `wertis-sfera-worker.exe` leży w `<katalog>\sfera-worker\`,
kreator pyta o włączenie, dopisuje `SFERA_WORKER`/`SFERA_OPERATOR*` do
`wertis.env` i rejestruje usługę `wertis-sfera`; bez exe — jedna linia
informacji i nic się nie zmienia. Restart i deinstalacja obejmują trzecią
usługę tylko wtedy, gdy istnieje.

---

## 0.28.0 — 4 sierpnia 2026

**Dostawca z własnym drukiem reklamacyjnym dostaje SWÓJ formularz.** Przycisk
FORMULARZ w podglądzie biura rozpoznaje dostawcę z dokumentu FZ: GEKO dostaje
swój „Protokół zgłoszenia reklamacji B2B" (tabela pozioma, przypisy, klauzula
RODO), PARTNER — swój protokół opisowy, strona na każdy wyjątek. Pozostali
dostawcy dostają protokół WERTIS jak dotąd.

**[wymaga działania]** Nic obowiązkowego. Warto raz wpisać dane firmy
(nazwa, NIP, adres, osoba kontaktowa) w sekcji REKLAMACJE podglądu biura —
nadrukują się na formularzach zamiast pustych kropek.

### Dlaczego

Serwis dostawcy rozpatruje reklamację ze SWOJEGO druku. Protokół WERTIS był
dla niego załącznikiem do przepisania: biuro przepisywało numer faktury, kod
towaru i opis usterki ręcznie do formularza GEKO albo PARTNER. Teraz wydruk
wychodzi od razu na właściwym druku, z wypełnionym tym, co system wie —
numer FZ, kod i nazwa towaru, ilość, rodzaj rozbieżności, opis.

Checkboxy zostają puste świadomie. Rodzaj usterki (mechaniczna/elektryczna)
i dowód zakupu klienta ostatecznego to wiedza biura, nie magazynu — udawanie,
że system ją ma, skończyłoby się błędnie zaznaczonym drukiem u dostawcy.

### Dane firmy żyją w przeglądarce

Druki dostawców pytają o dane zgłaszającego: nazwę firmy, NIP, adres, osobę
kontaktową. System ich nigdzie nie miał, bo nie są danymi magazynu. Mieszkają
teraz w localStorage przeglądarki biura, obok tokenu sesji — serwer nie musi
wiedzieć, jak firma się nazywa. Bez wpisanych danych formularz drukuje się
z kropkami do ręcznego uzupełnienia, jak oryginał.

### Rozpoznanie po nazwie, nie po identyfikatorze

Szablon wybiera fragment nazwy dostawcy (`GEKO`, `PARTNER`) z dokumentu FZ,
nie sztywny identyfikator kontrahenta. Nazwa rejestrowa w Subiekcie bywa
korygowana, a fragment przeżywa takie korekty. Zdjęcia dowodowe idą aneksem
za formularzem — na każdym z trzech szablonów tak samo.

---

## 0.27.0 — 4 sierpnia 2026

**Podgląd biura pokazuje metryki, kolejkę, rekoncyliacja i ślad audytowy.**
Trzy zakładki i pasek stanu widoczny z każdej z nich.

**[wymaga działania]** Nic. Zmiana dotyczy jednej strony HTML, którą serwuje
API — bez nowego APK i bez nowych uprawnień.

### Dlaczego

Te dane istniały od dawna i były dostępne **wyłącznie przez `curl`**.
Dokumentacja pisała o tym wprost: „metryki, rekoncyliacja i audyt są dostępne
przez REST", co w praktyce znaczyło, że nie oglądał ich nikt poza osobą, która
pisała ten kod. Biuro dostawało dwie karty o dostawach i nic więcej.

Najgorzej wypadał przez to `queue_failed` — najważniejszy wpis w całym
dzienniku. Magazynier zrobił swoje, kolektor przyjął, a do bazy firmy nic nie
weszło. Do dziś dowiadywało się o tym biuro, które akurat wpisało adres kolejki
w przeglądarce.

### Pasek stanu odpowiada na cztery pytania naraz

Wersja i tryb serwera, czy worker żyje, ile zadań stoi w błędzie, ile rozjazdów
zna rekoncyliacja. Stoi nad zakładkami, bo pytanie „czy zapisy wchodzą do
Subiekta" nie należy do żadnej z nich osobno. Kliknięcie prowadzi do szczegółu.

Martwy worker jest tu wyróżniony celowo: to jedyny stan, w którym aplikacja
wygląda na sprawną, a **żaden zapis nie dociera do bazy firmy**.

### Co świadomie zostało poza stroną

**Ponowienie zadania z kolejki.** Byłoby zapisem do Subiekta wykonanym przez
osobę, która nie stoi przy półce i nie wie, czy towar tam leży. Zasada „operacje
wykonuje się na kolektorze" jest starsza niż te zakładki i one jej nie zmieniają.

**Raport wydajności per osoba.** `GET /api/wydajnosc` istnieje i zostaje pod
REST-em. To monitoring pracowniczy w rozumieniu Kodeksu pracy (art. 22²):
wymaga zapisu w regulaminie i uprzedzenia ludzi na dwa tygodnie przed
uruchomieniem. Przycisk obok metryk zrobiłby z tego obowiązku przypadek, więc
pilnuje tego osobny test strony.

**Ślad audytowy zostaje za rolą.** Zakładka DZIENNIK czyta `GET /api/events`,
więc magazynier zalogowany w biurze zobaczy tam odmowę, a nie dane. Jedyną
trasą czytaną bez sesji jest `/api/health` — mówi o procesie, nie o towarze
ani o ludziach.

## 0.26.0 — 4 sierpnia 2026

**Mniej warstw, jedna kopia każdej reguły.** Przegląd architektury zdjął
z kodu to, co utrzymywało się bez pokrycia w potrzebie: fabrykę adaptera
o jednej implementacji, cztery kopie składania CSV, dwa moduły raportowe
z tą samą regułą w dwóch formach i dwa zakończone okresy przejściowe.

**[wymaga działania]** Nic. Nowego APK nie potrzeba — kolektor się nie
zmienił. Trasa `/sw.js` znika, ale komputery biura przeszły już przez jej
sprzątający skrypt.

### Co wypadło i dlaczego

**Fabryka i interfejs adaptera odczytu.** `makeSubiektAdapter()` od zawsze
zwracał jedną klasę, a interfejs miał jedną implementację — do tego część
serwisów i tak sięga do tabel `sgt_*` bezpośrednio. Została sama klasa
i alias typu; obietnica „podmienisz implementację", której nikt nie mógł
spełnić, zniknęła.

**Cztery kopie escapowania CSV.** Audyt, problemy, reslot i rekoncyliacja
składały pliki każde po swojemu i kopie zaczęły się rozjeżdżać w szczegółach
cytowania. Teraz jest jeden `services/csv.ts`; separatory zostały jak były
(`;` dla biura, `,` dla audytu — RFC 4180).

**Dwa moduły raportowe.** `metrics.ts` i `wydajnosc.ts` liczyły z tej samej
tabeli `events` i każdy niósł własną formę reguły odsiewu podwójnego
liczenia — a rozjazd tych kopii zawyżałby raport mierzący ludzi.
W `services/raporty.ts` reguła istnieje w jednym egzemplarzu. Trasy
`/api/metrics` i `/api/wydajnosc` odpowiadają dokładnie tym samym co dotąd.

**Wsady roczne w buildzie produkcyjnym.** `reslot` i `reconcile` chodzą
z checkoutu przez `npm run` — tak mówi ich własna dokumentacja. Wypadły
z `dist` i ze skryptów `start:*`; usługa niesie tylko to, co naprawdę chodzi
jako usługa.

**Dwa okresy przejściowe.** Trasa `/sw.js` (pogrzeb PWA usuniętej w 0.3.0)
zrobiła swoje. Klucze problemów sprzed 0.21.0 przestały być zapisywalne —
wszystkie kolektory mają już nowe APK. Etykiety historyczne zostają:
wyjątki z bazy muszą mieć nazwę na protokole dla dostawcy.

### Dokumentacja: jedno źródło prawdy na temat

Instrukcje operacyjne mieszkają teraz wyłącznie w `DEPLOY.md` — instalator
jako właściwa droga, procedura ręczna jako jego dokumentacja odniesienia,
plus nowy §8 o odinstalowaniu. `docs/wdrozenie.md` zwęża się do wdrożenia
organizacyjnego i nie zawiera ani jednego bloku poleceń. README oddał
treści krok-po-kroku i przestał twierdzić, że bufor offline używa Room —
to plik JSON + WorkManager, jak było od początku.

Audyt lustra DTO (`Dtos.kt` ↔ `types.ts`) pokazał, że każdy typ jest
używany — nie było czego wycinać. Nagłówki obu plików mówią teraz o sobie
nawzajem, zamiast odsyłać do klienta webowego usuniętego w 0.3.0.

Świadomie NIE ruszone: mechanika MM z `waiting_for_doc` (kolejka z błędem
„MM wystawia biuro" jest listą zadań biura), `env-file.ts`, narzędzia
w `tools/` i instalator.

---

## 0.25.0 — 4 sierpnia 2026

**`npm run seed:scenariusze` buduje 66 przypadków brzegowych w bazie demo.**
Kolizję kodów, cudzą blokadę pozycji, zadanie w błędzie sprzed trzech dni,
zdjęcie bez pliku i adres spoza wzorca — wszystko naraz, jednym poleceniem.

**[wymaga działania]** Nic. Nowego APK nie potrzeba, a na produkcji ten skrypt
się nie uruchomi.

### Dlaczego

`npm run seed` zasila kartotekę i kilkanaście dostaw. Wystarcza to do ścieżki
codziennej i do niczego więcej. Sprawdzenie wyjątku, kolejki albo rekoncyliacji
wymagało zbudowania stanu ręcznie — a po każdym skasowaniu bazy od nowa.

Części z tych stanów nie dało się zbudować z ekranu **wcale**. Nikt nie wystawi
z kolektora zadania, które czeka w buforze od pięciu dni, ani zdarzenia sprzed
wprowadzenia kont. Właśnie te przypadki są najdroższe w naprawie, bo nikt ich
nie ogląda przed wdrożeniem.

### Katalog jest jednym bytem, nie dwoma

Scenariusze mają numery (`S01`–`S66`), a ich opisy leżą
w `docs/scenariusze-testowe.md`. Zgodności katalogu z dokumentacją pilnuje test,
nie oko: scenariusz bez opisu i opis bez scenariusza zapalają się na czerwono.

To ta sama decyzja, co przy `tools/docs_check.py`. Komentarz „pamiętaj
zaktualizować" nie jest mechanizmem.

### Trzy reguły, które ten seed na siebie nakłada

**Nie tyka danych spoza swojego zakresu.** Kartoteki scenariuszy mają `tw_id` od
900001, dokumenty `dok_id` od 9001, konta własne loginy. Uruchomienie po
`npm run seed` niczego z niego nie kasuje.

**Jest idempotentny.** Każde uruchomienie kasuje najpierw własne wiersze, potem
buduje je od nowa. Da się nim wrócić do punktu wyjścia w środku pracy, bez
kasowania bazy.

**Nie uruchomi się przy `SGT_MODE=mssql`.** Zakłada konta ze znanym hasłem
i wystawia gotowe tokeny sesji, czyli robi dokładnie to, czego na bazie firmy
robić nie wolno. Odmowa jest tu jedynym zabezpieczeniem, bo polecenie wygląda
równie niewinnie jak `npm run seed`.

### Raport przeslotowania w końcu ma co liczyć

`npm run reslot -- --demo` odmawiał wypisania list eksmisji, awansów
i likwidacji — zawsze, od pierwszego dnia. Bezpiecznik działał poprawnie: bez
historii pobrań każdy indeks wygląda na martwy, więc raport kazałby opróżnić całą
strefę złotą. Tyle że seed nie zawierał **ani jednego** dokumentu WZ, więc
jedyna funkcja mierząca pracę magazynu nie dawała się zobaczyć przed wdrożeniem.

Seed scenariuszy zasila historię pobrań i ostatnie zakupy, więc raport wypisuje
wszystkie cztery listy. Liczby są syntetyczne i tak trzeba je czytać: nadają się
do sprawdzenia raportu, nigdy do decyzji o magazynie.

### Czego ten seed NIE zastępuje

Nie jest testem. Nie sprawdza niczego sam i nie zapali się na czerwono, gdy
aplikacja się zepsuje — daje wyłącznie stan, w którym da się to zobaczyć okiem.
Testy jednostkowe zostają tam, gdzie były.

### Poprawka po zderzeniu z 0.24.0
<!-- docs_check: historia -->

Ten wpis stał przez chwilę pod numerem 0.24.0, czyli pod cudzym. Obie zmiany
powstawały równolegle i scalenie skleiło je pod jednym nagłówkiem, a razem z nimi
weszła na `main` czerwona kontrola dokumentacji: `docs/scenariusze-testowe.md`
nazywał `tryb_serwisowy_start`, wycofany w 0.24.0 tego samego dnia.

Scenariusze idą za kodem, więc dziennik demo niesie dziś zdarzenia zarządzania
kontami (`user_created`, `user_active_changed`), a nie tryb serwisowy. Doszła
też **czwarta rola**: konto `admin.test` i scenariusz S66 na trzy operacje, które
umie sam admin — konto biurowe, odebranie hasła i wyłączenie konta.

Konta `admin` z `npm run seed` seed scenariuszy nie tyka. Nie zna jego hasła,
a podmiana cudzego byłaby najgorszym możliwym skutkiem polecenia, które ma
wyłącznie dopisywać dane.

---

## 0.24.0 — 4 sierpnia 2026
<!-- docs_check: historia -->

**Konto administratora zakłada instalator, a loguje się ono jak każde inne.**
Tryb serwisowy z 0.23.0 zostaje wycofany po jednym wydaniu.

**[wymaga działania]** Nowy APK. Jeśli gdziekolwiek ustawiłeś `WERTIS_ADMIN=1` —
usuń wpis; zmienna nie robi już nic, a jej obecność myli przy następnej
diagnozie.

### Dlaczego z powrotem

0.23.0 rozwiązywała prawdziwy problem — świeża baza nie ma konta — ale
rozwiązywała go **obejściem bramki**: brak sesji przestawał znaczyć „odmowa".
Cena była nazwana już wtedy i właściciel ją teraz odrzucił: dziennik z takiego
okresu nie mówi, kto co zrobił, a instalacja z zapomnianą flagą stoi otworem dla
całej sieci hali.

Problem zostaje ten sam, więc rozwiązujemy go tam, gdzie powstaje: **konto ma
istnieć, a nie być udawane**. Instalator pyta instalującego o login i hasło
i zakłada konto zaraz po starcie usług. `npm run seed` robi to samo dla pracy
nad kodem — hasło bierze z `ADMIN_HASLO` albo losuje i pokazuje raz.

Instalator hasła **nie wypisuje, tylko o nie pyta** — i to jest cała różnica
wobec zdania, które stało dotąd w `instalator/README.md` („nie zakłada kont
pracowników, bo wypisywanie loginów i haseł na monitorze byłoby krokiem w złą
stronę"). Zdanie zostało odwrócone świadomie.

### Czwarta rola i dziura, która wyszła po drodze

Rola `admin` może dwie rzeczy więcej niż biuro: zakładać konta **o roli `biuro`
i `admin`** oraz wyłączać konta i odbierać hasła. Poza tym jest równa biuru —
audytu ani raportu wydajności świadomie nie dostaje, bo raport o pracy ludzi
zostaje tam, gdzie był.

To rozdzielenie zamyka dziurę, która istniała wcześniej i nie była hipotezą:
„zarządzanie kontami" było **jedną** operacją, więc biuro zakładało konto biura
z własnym hasłem. Rola strzegąca tożsamości rozdawała ją sama sobie.

Druga rzecz wyszła przy pisaniu tej zmiany i była poważniejsza: `POST /api/users`
brał `role` prosto z ciała żądania, `createUser` wkładał je do `INSERT`, a kolumna
`role` nie ma `CHECK`. **Do bazy wchodziło dowolne słowo, łącznie z `admin`.**
Dopóki tak było, cała ta zmiana byłaby dekoracją. Rola jest teraz sprawdzana
przeciw zamkniętej liście i to jest najważniejszy nowy test w tym wydaniu.

### Cena, którą warto znać

**Biuro nie zresetuje hasła magazynierowi, który je zapomniał** — musi poprosić
admina. To wynika wprost z wyboru właściciela, a nie ze splotu okoliczności;
przeniesienie `:id/haslo` z powrotem do biura jest zmianą jednej linii
w `WYMAGANA_ROLA`.

Pierwsze konto na pustej bazie dostaje teraz rolę `admin`, nie `biuro` —
inaczej instalacja postawiona kreatorem na kolektorze nie miałaby jak dorobić
się kogokolwiek, kto zakłada konta biura.

### Co zostaje z 0.23.0

Refaktor sesji. Bramka rozpoznaje sesję raz na żądanie i trasy czytają wynik
z kontekstu zamiast pytać bazę po raz drugi — to była zmiana niezależna od
trybu i przeżyła jego wycofanie.

### Przy okazji: dwa testy instalatora nigdy się nie wykonały

<!-- docs_check: historia -->

`instalator/testy.ps1` kończy się `exit 0`, a dwa testy dopisane w 0.23.0 stały
**po** tej linii. W opisie PR-a napisałem, że przełącznika „pilnuje jego własny
zestaw testów" — to była nieprawda i wychodzi dopiero teraz. Martwy kod za
`exit 0` usunięty, nowe testy stoją przed sekcją wyniku.

**Znalezione, poza zakresem:** `GET /api/wydajnosc` nie sprawdza roli, choć
komentarz obok mówi „dla biura, nie dla kolektora". Dane per pracownik są dziś
dostępne każdej zalogowanej sesji. Nie ruszam tego w tym wydaniu, ale to jest do
zrobienia.

---

## 0.23.0 — 4 sierpnia 2026

<!-- docs_check: historia -->

> **Wycofane w 0.24.0**, po jednym wydaniu. Wpis zostaje, bo „wprowadziliśmy
> i wycofaliśmy" jest samo w sobie informacją — a powody, dla których to
> rozwiązanie wyglądało dobrze, warto mieć zapisane obok powodów, dla których
> nie wystarczyło.

**Przełącznik `WERTIS_ADMIN=1` wyłącza logowanie w całości — na kolektorze
i w podglądzie biura naraz.** Do pracy nad kodem, nigdy u klienta.

**[wymaga działania]** Nowy APK. Zmiennej nie ustawiaj na produkcji; instalator
jej nie zapisuje.

### Dlaczego

<!-- docs_check: historia -->

Postawienie WERTIS od zera kończy się krokiem, którego nie da się
zautomatyzować: ktoś musi ręcznie założyć pierwsze konto. Seed go nie zakłada,
instalator też nie. Przy bazie kasowanej kilka razy dziennie to piąty krok
w czterokrokowej procedurze — i wykonywany **dwa razy**, bo podgląd biura ma
własne logowanie i na pustej bazie jest ślepym zaułkiem.

### Konto bez hasła, i to jest sedno

<!-- docs_check: historia -->

Operacje w tym trybie podpisuje konto `ADMIN (TRYB SERWISOWY)`. Jest prawdziwym
wierszem w bazie, bo dziennik zdarzeń wskazuje na konta kluczem obcym — ale
**nie ma ani loginu, ani hasła**:

- nie da się nim zalogować żadną drogą, także po ręcznym nadaniu hasła;
- nie ma domyślnego hasła do wycieknięcia;
- nie dostaje tokenu sesji, więc **wyłączenie przełącznika odbiera dostęp
  natychmiast** — nie ma czego unieważniać.

Reguła „żadnych domyślnych haseł" zostaje więc nienaruszona. Zapisaliśmy ją
przy okazji wprost w `DEPLOY.md`, bo dotąd trzymał się jej wyłącznie kod.

### Co świadomie tracimy

<!-- docs_check: historia -->

**Dziennik z tego okresu nie mówi, kto co zrobił.** Wszystko jest podpisane
jedną nazwą — dlatego nazwa krzyczy, żeby historia z trybu serwisowego była
odróżnialna od pracy ludzi także za pół roku. Zalogowanie się prawdziwym kontem
dalej działa i wtedy operacje dostają nazwisko.

**Dwa skutki przeżywają wyłączenie przełącznika**: konta założone w tym trybie
i hasła w nim ustawione. Sam dostęp znika z chwilą wyłączenia, te dwie rzeczy
nie.

### Widać z trzech stron

<!-- docs_check: historia -->

Czerwony pasek na każdym ekranie kolektora i w biurze, `ok: false`
w `/api/health` z ostrzeżeniem na pierwszym miejscu, wpis
`tryb_serwisowy_start` w dzienniku. Przy `SGT_MODE=mssql` ostrzeżenie jest
ostrzejsze, ale tryb **nie jest blokowany**: Subiekt edu też jest trybem
`mssql`, a to jedyne środowisko, dla którego ten przełącznik powstał.

Sam wiersz `ADMIN (TRYB SERWISOWY)` w tabeli kont jest dowodem, że tryb
kiedykolwiek na tej instalacji chodził — konto powstaje wyłącznie przy włączonej
fladze.

### Przy okazji: trasy przestały pytać bazę o sesję

<!-- docs_check: historia -->

<!-- docs_check: historia -->

Bramka rozpoznaje sesję raz na żądanie, a osiem miejsc w czterech plikach
pytało o nią PONOWNIE, każde po swojemu. Poza podwójnym zapytaniem do bazy
znaczyło to, że „kto pyta" miało osiem niezależnych odpowiedzi zamiast jednej —
i tryb serwisowy wpuszczałby do odczytów, a odbijał od zarządzania kontami
i audytu. Odkryte przy pisaniu tej zmiany, naprawione osobnym commitem przed
nią.

---

## 0.22.1 — 4 sierpnia 2026

Dwa miejsca, w których konfiguracja obiecywała elastyczność, a kod jej nie
dowoził. Nic tu nie zmienia ekranu — to poprawki, których objawem byłby
dokument pod cudzą nazwą albo karta towaru milcząca o dostawie.

### Typ dokumentu tłumaczył się w dwóch miejscach, każde po swojemu

<!-- docs_check: historia -->

Subiekt trzyma typ dokumentu jako liczbę, read-model jako napis. Tłumaczenie
stało w dwóch plikach i **oba miały inny błąd**:

- importer (`adapters/subiekt.mssql.ts`) miał gałąź `else` — każdy kod inny niż
  FZ lądował w bazie jako **`PZ`**, czyli pod cudzą nazwą;
- odczyt (`adapters/subiekt.seeded.ts`) miał filtr — kod spoza pary FZ/PZ
  **wypadał** z listy etykiet.

Skutkiem było to, że dopisanie trzeciego typu do `DOK_TYPY_DOSTAW` — czynność
na jedno ustawienie — dawało dokumenty z fałszywym symbolem na ekranie
magazyniera, bez jednego słowa błędu po drodze. Test pilnował przy tym starego
zachowania, więc **utrwalał błąd zamiast go łapać**.

Teraz jedno źródło prawdy (`adapters/typy-dokumentow.ts`). Kod bez nazwy
dostaje symbol `TYP-<kod>`: brzydki, ale widoczny i nieudający niczego innego.
Że czegoś nie nazwano, mówi `/api/health` — razem z osobną uwagą o kodzie
zamówienia do dostawcy wpisanym między dostawy, bo to pomyłka co do znaczenia,
nie co do nazwy.

### Okno dostaw było w dwóch miejscach

`services/dostawy-towaru.ts` miał własną stałą `14` z komentarzem „tyle samo,
co lista w zakładce rozkładania" — czyli zgodności pilnowało zdanie, nie
mechanizm. Po zmianie `DOK_DNI_WSTECZ` na 30 karta towaru mówiłaby „nic nie
przyszło" o dokumencie wiszącym obok w zakładce rozkładania. Okno idzie teraz
z konfiguracji.

---

## 0.22.0 — 4 sierpnia 2026

<!-- docs_check: historia -->

**Kontener rozkłada się jak każda inna dostawa, a przesunięcie stanu przestało
być końcem sesji — stało się osobną czynnością dostępną z karty towaru.**

**[wymaga działania]** Nowy APK oraz kopia bazy przed aktualizacją: migracja
kasuje dwie tabele (szczegóły niżej).

### Dlaczego, skoro pół roku temu zapisaliśmy coś przeciwnego

<!-- docs_check: historia -->

Wpis 0.17.0 mówi wprost: *„tryb B (kontener, 4× w roku) zostaje nietknięty"*.
Wtedy była to decyzja poprawna — tryb kontenerowy był **jedynym konsumentem**
dokumentu MM, więc jego usunięcie zabrałoby MM ostatnie wejście.

Zmieniło się to, że proporcje przestały się bronić. Dwie tabele, dziesięć
funkcji serwisu, osiem tras i 803 linie Compose obsługiwały proces zdarzający
się cztery razy w roku — i cała ta machineria prowadziła do jednego wywołania,
które na produkcji rzuca wyjątkiem, bo workera Sfery nie ma.

Jednocześnie najzwyklejszego pytania nie dało się zadać: **„towar leży na MGP,
jak go przenieść na halę, nie otwierając sesji kontenerowej"**. Trasa
`POST /api/mm` istniała i została wycięta właśnie dlatego, że jedynym wejściem
miał być wózek.

### Co znika

<!-- docs_check: historia -->

Sesja z wózkiem w całości: `putaway_sessions` i `putaway_items`,
`services/putaway.ts` (441 linii), `routes/putaway.ts` (82), osiem metod API,
osiemnaście DTO kolektora, dwa ekrany i **tryb marszu** — nakładka „NASTĘPNE"
po zatwierdzeniu wózka, która istniała wyłącznie w sesji. `enum Screen` schodzi
z 13 na 11.

Zakładka KONTENERY też znika. Dokumenty z MGP wpadają do zwykłej listy dostaw,
oznaczone pastylką **przyjęcia**.

### Co świadomie tracimy

**Jeden dokument MM na rundę wózka.** Przesunięcie powstaje teraz per pozycja,
więc przy tysiącu kartonów będzie ich znacznie więcej niż kilkanaście. To jest
największa cena tej zmiany i trzeba ją znać przed najbliższym kontenerem.

**Historię sesji.** Migracja kasuje obie tabele, więc odpowiedź na pytanie „kto
rozkładał kontener w marcu" znika. Zdarzenia w dzienniku (`putaway_session_open`,
`putaway_confirm`, `putaway_commit_cart`) **zostają** — dziennik pamięta
czynność, traci tylko jej szczegóły, a `sessionId` w ich treści nie wskazuje już
na nic.

**Dodawanie towaru spoza dokumentu**, „pomiń z powodem" i zamknięcie sesji
z rozliczeniem. Pierwsze zastąpiło zgłoszenie „artykuł niezamówiony" z 0.21.0,
które robi to lepiej: trafia do formularza reklamacyjnego, a nie do wózka.

**Kontener kosztuje teraz dwa przejścia**: adresy przy rozkładaniu, potem
przesunięcia. Skrót „PRZESUŃ NA HALĘ" w wierszu dostawy skraca drugie z nich do
jednego dotknięcia, ale go nie eliminuje.

W zamian kontener dostaje wszystko, czego sesja z wózkiem nie miała nigdy:
zgłaszanie wyjątków ze zdjęciem, przycisk INNA ILOŚĆ, eksport problemów do CSV,
panel rozjazdu lokalizacji i auto-domknięcie dokumentu.

### Przesunięcie stanu

Jedna trasa, `POST /api/przesuniecie`, dla dowolnej pary magazynów. Wychodzi
z trzech miejsc: kafla magazynu na karcie towaru, podlinijki „MGP N" w nagłówku
karty oraz z rozwiniętego wiersza kontenera.

- **Kolejka jest zarazem rezerwacją.** Dostępne to stan minus przesunięcia
  czekające na workera, więc drugie przesunięcie widzi już pomniejszony stan.
  Bez tego dwa zgłoszenia zrobione przed przejściem kolejki wysłałyby sumę
  większą niż stan, a odmowa przyszłaby godzinę później i bez człowieka przy
  palecie.
- **Adres przed stanem.** `set_location` idzie do kolejki przed `mm` — ten sam
  niezmiennik, który wcześniej pilnował rundy wózka, razem z uzasadnieniem.
- **Skan półki obowiązkowy przy celu MAG, zabroniony przy innym.** Pole
  lokalizacji w kartotece jest jedno na towar i opisuje regał na hali; zapisane
  przy przesunięciu na inny magazyn wskazywałoby półkę, na której towaru nie ma.
- **Bez bufora offline**, świadomie inaczej niż zapis lokalizacji. Bufor
  przechowuje intencję, a walidacja liczy się w chwili zapisu.

Siedemnaście testów serwera i dziewięć w `:core`. Tryb kontenerowy nie miał ani
jednego testu serwera przez cały czas swojego istnienia.

### Czego ta zmiana NIE naprawia

**Dokument MM na produkcji dalej się nie tworzy.** Worker Sfery to Etap 2
wdrożenia i nie powstał; zadanie po trzech próbach ląduje w `error`, a dokument
wystawia biuro. Nowość polega na tym, że **arkusz mówi o tym przed dotknięciem
przycisku**, a nie po fakcie czerwoną pastylką kolejki.

**Adres po przesunięciu Z hali nie jest czyszczony.** Stan na MAG może spaść do
zera, a adres w kartotece zostaje — to zasila problem, który mierzy raport
przeslotowania. Czyszczenie adresu przy stanie zero to osobna decyzja.

**`waiting_for_doc` rezerwuje stan bez limitu czasu.** Zadanie wstrzymane na
dokumencie w buforze liczy się do „w drodze", a rekoncyliacja sygnalizuje je
dopiero po 72 godzinach.

### Stare bazy

<!-- docs_check: historia -->

Migracja kasuje `putaway_items`, a potem `putaway_sessions` — **w tej
kolejności**, bo baza chodzi z `PRAGMA foreign_keys = ON` i rodzic skasowany
przed dzieckiem wywaliłby start API oraz workera naraz. Kolumna
`sfera_queue.session_id` **zostaje** jako martwa: kolumn ze starych baz się nie
kasuje, a przebudowa tabeli trzymanej otwartej przez workera kosztowałaby bez
żadnego zysku. Ten sam wybór co przy 0.17.0.

Seed nadawał kontenerowi typ `PZ` z parzystości, a domyślne `DOK_TYPY_DOSTAW`
zna tylko `FZ`. Po objęciu MGP filtrem typu kontener wypadłby z demo bez jednego
słowa błędu — typ idzie teraz z konfiguracji.

---

## 0.21.0 — 3 sierpnia 2026

Zgłoszenie niezgodności na kolektorze zbiera teraz **dokładnie to, czego żąda
firmowy formularz „Niezgodność w dostawie"**. Do tej pory były to dwa różne
zestawy pól: magazynier wypełniał jeden przy palecie, biuro przepisywało drugi
do formularza dla dostawcy, a różnicę uzupełniało z pamięci i po fakcie.

**[wymaga działania]** Nowy APK. Do czasu rozesłania przez MDM kolektory ze
starym APK zgłaszają po staremu — serwer to przyjmuje, patrz niżej.

### Pięć kategorii z formularza zamiast siedmiu własnych typów

<!-- docs_check: historia -->

Lista zgłoszeń to teraz: **błędny artykuł**, **brak w przesyłce**, **uszkodzone
w transporcie**, **zła ilość**, **artykuł niezamówiony**. `wrong_item`
i `damaged` zachowały klucze, bo znaczą to samo co w formularzu — zmiana klucza
osierociłaby historię bez żadnego zysku.

Odchodzą: „za mało" i „za dużo" (zastąpione przez „złą ilość", która niesie
obie liczby naraz), „brak miejsca" i „nieznany kod". **Strata jest realna:**
magazynier traci sposób na powiedzenie „nie mam gdzie tego położyć". Kolizja
EAN ma własny mechanizm (`GET /api/ean-conflicts`) i nie potrzebowała pozycji
na tej liście.

Przy okazji doszło coś, czego wcześniej nie dało się zgłosić w ogóle: **artykuł
spoza dokumentu**. Skan towaru, którego nie ma na fakturze, kończył się toastem
„X nie jest w tym dokumencie" i niczym więcej. Teraz jest zgłoszeniem
z numerem katalogowym.

### Serwer przyjmuje stare klucze, choć kolektor ich nie oferuje

<!-- docs_check: historia -->

`git pull` przestawia serwer od razu, a APK czeka na MDM. Gdyby serwer odrzucał
`qty_short`, każdy nierozesłany kolektor dostawałby 400 przy palecie, w rękawicy,
w środku dostawy — przez cały czas wdrożenia. Klucze sprzed 0.21.0 są więc dalej
zapisywalne i **na zawsze nazywalne**: protokół dla dostawcy nie może pokazywać
surowego `qty_short`. Listę `TYPY_HISTORYCZNE` da się skasować, gdy wszystkie
kolektory będą miały nowy APK.

### Co arkusz pyta, a czego nie

Ilości wymaga **każda** kategoria — tak jak formularz. Zdjęcie zostaje
obowiązkowe przy uszkodzeniu i błędnym artykule. Nowe pola:

- **numer katalogowy** artykułu spoza dokumentu (błędny / niezamówiony) — nie
  ma linii, z której dałoby się go odczytać;
- **„a miało przyjść"** przy błędnym artykule — zwinięte, bo formularz ma to
  pole jako opcjonalne;
- **numer przesyłki i protokół kuriera** — pytane RAZ na dostawę i zapisywane
  na dostawie (`POST /api/delivery/:id/przesylka`), nie przy zgłoszeniu.
  Przesyłka jest jedna; wpisana przy każdym uszkodzonym artykule z osobna
  mogłaby się różnić sama ze sobą.

Nie pyta o numer faktury, dostawcę ani numer katalogowy pozycji z dokumentu —
to wszystko już jest w bazie. **Symbol z Subiekta JEST numerem katalogowym
dostawcy**, więc pytanie o niego byłoby przepisywaniem z ekranu na ekran.

Zgłoszenie zapisuje też **ilość z dokumentu jako snapshot**. Odczyt „na żywo"
przy druku protokołu pokazywałby stan po ewentualnej korekcie faktury
w Subiekcie, a protokół ma mówić, co widzieliśmy przy palecie.

### Czego ta zmiana NIE robi

Pole formularza **„Co zrobić z…?"** (do zwrotu / zafakturować / dołożyć do
kolejnego zamówienia / pilnie przysłać / korekta) zostaje po stronie biura —
decyzja handlowa nie zapada przy palecie. Kolumny na nią nie ma: kanał bez
odbiorcy to dokładnie ten kształt, który repo wycięło w 0.16.0 i 0.17.0.

Protokół dla dostawcy w `/biuro` i eksport CSV **zostały bez zmian**. Nowe pola
są w bazie i w API, ale nie na wydruku — dołożenie ich to osobna zmiana jednego
pliku.

### Ryzyko, które zostaje

Zgłoszenie **nie ma bufora offline** — arkusz woła API synchronicznie. Przy
uszkodzeniu z numerem przesyłki to najdłuższa ścieżka w aplikacji, a zerwane
Wi-Fi kasuje całość. Dlatego numer przesyłki idzie na serwer **przed**
zgłoszeniem: jeśli sieć padnie w połowie, zostaje to, czym przewoźnik odnajduje
paczkę.

---

## 0.20.1 — 3 sierpnia 2026

Przygotowanie pod przebudowę zgłaszania niezgodności w dostawie na wzór
firmowego formularza reklamacyjnego. Nic tu jeszcze nie zmienia ekranu — to
dwie rzeczy, bez których ta przebudowa poszłaby na ślepo.

### Wyjątki dostają testy po stronie serwera

`raiseProblem`, `resolveProblem` i `exportCsv` nie miały ani jednego. Reguły
kolektora (`core/problem/ProblemModel.kt`) mają test od początku, ale są
uprzejmością wobec człowieka w alejce, a nie bramką: stary APK albo `curl`
z sieci hali trafia wprost do serwisu. Trzynaście testów pilnuje teraz
walidacji, skutku dla linii dostawy, ponownego rozwiązania wyjątku oraz CSV —
łącznie z tym, że średnik wpisany w opis nie rozwala kolumn.

### Słownik typów zamiast trzech kopii

<!-- docs_check: historia -->

Lista typów wyjątku żyła w trzech miejscach: `services/problems.ts`,
`ProblemModel.kt` i `biuro.html`. Zgodności pilnował tylko test kotlinowy, więc
dopisanie typu na serwerze zostawiało stronę biura z surowym kluczem
(`qty_short`) na protokole dla dostawcy — i nikt by tego nie zauważył przed
wysłaniem.

`ProblemView` niesie teraz `typLabel` prosto z serwera, a strona biura straciła
własny słownik. Kolektor swoją kopię **zachowuje świadomie**: etykiety muszą być
na ekranie także wtedy, gdy Wi-Fi padło w połowie hali. Dwie kopie zamiast
trzech, obie z testem.

### [wymaga działania] przy wdrożeniu

`git pull`, `npm ci`, `npm run build`, restart usług. Bez zmian w bazie i bez
nowego APK — starszy kolektor po prostu ignoruje nowe pole.

## 0.20.0 — 1 sierpnia 2026

<!-- docs_check: historia -->

Wejście do WERTIS to **login i hasło** — na kolektorze, w biurze i w curl-u.
Skan plakietki `PRC-0007-3` i PIN przy operacjach nieodwracalnych wychodzą
z aplikacji.

### Dlaczego

Plakietka była szybka: jeden skan, około sekundy, bez wpisywania czegokolwiek
w rękawicach. Była też własnym, osobnym mechanizmem w firmie, która wszędzie
indziej loguje się loginem i hasłem — czyli drugą rzeczą do wytłumaczenia
każdej nowej osobie i drugim zbiorem etykiet do wydrukowania i pilnowania.

Cena jest realna i warto ją znać: wejście na kolektor kosztuje teraz kilkanaście
sekund zamiast jednej, a razem z PIN-em znika drugi czynnik przy operacjach,
których nie da się cofnąć. Porzucony zalogowany kolektor pozwala obcej osobie
na wszystko, co może jego właściciel.

### Co się zmienia w API

<!-- docs_check: historia -->

| było | jest |
|---|---|
| `POST /api/auth/badge` | `POST /api/auth/login` z ciałem `{login, haslo}` |
| `POST /api/auth/handover` | znika — zmiana osoby to wylogowanie i zalogowanie |
| `POST /api/users/:id/pin` | `POST /api/users/:id/haslo` |
| `pinAutora` w ciele żądania | nic — rozstrzyga rola z sesji |
| — | `POST /api/auth/haslo` do zmiany własnego hasła |

Hasło leży wyłącznie jako hasz (scrypt, sól per konto), minimum osiem znaków,
bez wymagań na wielkie litery i znaki specjalne. Nieznany login i błędne hasło
dają jeden komunikat i ten sam czas odpowiedzi. Pięć nieudanych prób zamyka
login na minutę — odpowiedzią jest 429, nie 401, bo kolektor po 401 kasuje
operację z bufora offline.

### Hasło mogło wyciec do logu serwera

Przy okazji wyszła dziura, która istniała już wcześniej.
`WedgeKeySource.textFieldFocused` było flagą `bool` ustawianą przez każde pole
tekstowe. Kolejność zdarzeń fokusu między dwoma polami nie jest gwarantowana,
więc spóźnione „stracił fokus" zostawiłoby zbieranie znaków włączone przy
aktywnym polu hasła — a wtedy wpisane hasło pojechałoby jako skan do
wyszukiwarki towarów i wylądowało w `events`. Flaga jest teraz licznikiem,
a na ekranie logowania skaner jest wyłączony.

### [wymaga działania] przy wdrożeniu

`git pull`, `npm ci`, `npm run build`, restart usług, nowy APK przez MDM.

1. **Migracja bazy jest automatyczna, ale kasuje wszystkie sesje.** Zrób
   aktualizację **poza godzinami pracy** i upewnij się, że kolektory wysłały
   bufor (`GET /api/queue` pusty) — operacja czekająca w buforze offline ginie
   przy odmowie 401.
2. **Konta zakłada się od nowa.** Stare zostają jako ślady w audycie: bez
   loginu i bez hasła, żeby `events.user_ref` miało na co wskazywać. Furtka
   pierwszego konta otwiera się sama, bo liczy konta z loginem — załóż konto
   biura z kolektora (**ZAŁÓŻ KONTA**) albo curl-em z DEPLOY §5a.
3. **Plakietki idą do kosza.** Zeskanowane na ekranie głównym pojadą teraz jako
   zwykły tekst do wyszukiwarki towarów.

## 0.19.0 — 1 sierpnia 2026

<!-- docs_check: historia -->

Serwer odpowiada pod `/sw.js` skryptem, który **grzebie starą aplikację
webową**. Nic poza tym się nie zmienia.

### Skasowany kod potrafi dalej stać na ekranie

Aplikacja webowa („Kolektor magazynowy · prototyp v0.2") wyszła z repo
26 lipca w 0.3.0 — katalog `web/`, trasy `/lookup` i `/`, `@fastify/static`.
Mimo to na komputerze, który ją kiedyś otworzył, dalej wita splash z napisem
„Dotknij, aby rozpocząć". Była PWA: `vite-plugin-pwa` zostawił service workera
z precache całej powłoki, a taki worker odpowiada na żądanie **zanim** ruszy ono
do sieci. Kasowanie kodu na serwerze nie mogło tego naprawić, bo serwer o tych
żądaniach nie wiedział.

Wyjście prowadzi przez ten sam adres, spod którego worker został zainstalowany.
Przeglądarka sama sprawdza `sw.js` przy wejściu na stronę, a nowy skrypt bez
rejestracji zdarzeń wymiata poprzednika: kasuje cache, wyrejestrowuje się
i przeładowuje otwarte karty. Po tym `/` pokazuje to, co ma pokazywać —
przekierowanie do podglądu biura.

To jednorazowe sprzątanie, nie funkcja. Trasa może zniknąć, gdy żaden komputer
w firmie nie będzie już miał starej PWA.

### [wymaga działania] przy wdrożeniu

`git pull`, `npm ci`, `npm run build`, restart usług. Potem na każdym komputerze
biura raz wejść na `http://serwer:3001/` i odświeżyć. Jeśli aplikacja była
**zainstalowana** jako osobne okno, trzeba ją odinstalować w przeglądarce
(Chrome → Ustawienia → Aplikacje).

## 0.18.0 — 1 sierpnia 2026

Biuro dostaje **podgląd pod `/biuro`** — pierwszy własny ekran od usunięcia
`/lookup`. Wycięcie flagi faktury (0.16.0) zamknęło jedyny kanał, którym biuro
widziało stan dostaw; CSV i REST istniały dalej, ale „wywołaj curlem z tokenem"
nie jest interfejsem dla księgowości.

### Co pokazuje

Dwie sekcje, sam odczyt:

- **DOSTAWY** — status rozkładania per dokument: nietknięta / w toku /
  rozłożona, pasek postępu, plakietka bufora, szukajka po numerze i dostawcy.
- **REKLAMACJE** — nierozwiązane wyjątki pogrupowane po dokumencie, z dwoma
  wyjściami: **protokół rozbieżności do wydruku** (tabela wyjątków + zdjęcia
  dowodowe + miejsca na podpisy) i **CSV** do arkusza.

Protokół w końcu domyka pętlę zdjęć dowodowych: kolektor je wysyłał, serwer
składował — a obejrzeć ich nie było gdzie. Teraz lądują na wydruku reklamacji,
czyli dokładnie tam, po co powstały.

### Jak to jest zbudowane — i czego świadomie NIE ma

Jedna strona HTML bez builda i frameworka (`server/src/web/biuro.html`),
serwowana przez API. Logowanie badge'em jak na kolektorze; dane czytane
istniejącymi trasami z tokenem sesji w nagłówku. Strona nie ma własnych
uprawnień ani żadnego zapisu — poprzedni podgląd zniknął razem z całym
klientem PWA, bo dwa fronty to dwa razy utrzymanie, więc nowy nie ma prawa
być drugim frontem.

Zdjęcia pozostają za sesją: strona pobiera je fetchem i wstawia jako blob —
nic nie jest publiczne w LAN. Wróciła trasa `GET /api/delivery/:id/problems`
(wycięta w 0.17.0 jako „bez klienta") — teraz ma klienta.

### [wymaga działania] przy wdrożeniu

`git pull`, `npm ci`, `npm run build`, restart usług. Adres dla biura:
`http://serwer:3001/biuro` (korzeń przekierowuje tamże). Konto dla biura
zakłada się jak każde inne — na kolektorze albo przez `POST /api/users`
(DEPLOY §5a); rola `biuro` nie jest wymagana do samego podglądu.

## 0.17.0 — 31 lipca 2026

<!-- docs_check: historia -->

Po wycięciu flagi padło pytanie, czy takich niepotrzebności jest w repo więcej.
Przegląd trzech warstw znalazł je w trzech kształtach. Ten wpis usuwa te, które
nie miały ani jednego konsumenta.

### Zwroty koszykami — machineria bez wejścia

Kompletna ścieżka po obu stronach: numer koszyka przy każdym odłożeniu, pasek
otwartych koszyków, domykanie przyciskiem, rozliczenie ilościami, czwarta
kontrola nocnej rekoncyliacji. **Wejścia do niej nie było od d131f75** —
zakładka DOSTAWY filtrowała zwroty, a komentarz nazywał to „ukryciem wejścia,
nie wycofaniem funkcji".

Przywrócenie wejścia nie wchodziło w grę, bo funkcja wróciłaby ZEPSUTA:
domknięcie koszyka kolejkuje MM, a dokumentów MM na produkcji nie da się dziś
wystawić. Dostawa zwrotowa zostawałaby w `open` na zawsze.

Zwroty rozlicza więc biuro w Subiekcie — tak jak faktycznie robi od roku.
Karta towaru przestaje obiecywać „zwrot, czeka na rozłożenie". **Magazyn Zwroty
zostaje**: kafel „gdzie jeszcze leży" ma nadal sens, zmienia się tylko podpis.

### Klucz wiersza faktury — zalążek kanału, który już odrzuciliśmy

<!-- docs_check: historia -->

`delivery_line.sgt_pozycje` (0.13.0) zapisywało się przy każdym otwarciu
dostawy i nie było czytane przez ani jedno miejsce w kodzie. Powstało pod
„opis różnic przy pozycji faktury", czyli **ten sam kanał do biura, który
wypadł w 0.16.0** — tylko droższy: docelowy zapis wymagałby prawa zapisu do
tabeli z ilościami i cenami.

Wypada razem z `MSSQL_POZ_ID_COLUMN`, dwoma podejściami w imporcie pozycji,
jednym komunikatem w `/api/health` i rozdziałem dokumentacji, który opisywał
niezaimplementowaną funkcję na 144 liniach.

### Drobny martwy kod

Kolumny pisane i nieczytane, cztery funkcje `:core` bez wołającego, trzy
deklaracje Retrofit bez ani jednego wywołania i pięć pól DTO bez czytelnika.
Przy okazji znika duplikat listy typów wyjątków — kolektor trzymał własną kopię
obok serwerowej, a wołał wyłącznie swoją.

Cyfra kontrolna badge'a ma teraz **jedną** implementację (serwer, z wektorami
w testach). Kolektor rozpoznaje sam kształt kodu — i tylko tego potrzebuje.

### Czego świadomie NIE ruszamy

**MM i worker Sfery.** Około 450 linii serwera prowadzi do wywołania, które na
produkcji zawsze rzuca wyjątek. To jest niedokończone, nie zbędne — tryb B
(kontener, 4× w roku) zostaje nietknięty razem z `waiting_for_doc`.

**Zdjęcia dowodowe i raporty dostępne tylko curlem.** Ślad audytowy ma wartość
dowodową także wtedy, gdy nikt go nie ogląda co tydzień.

### [wymaga działania] przy wdrożeniu

<!-- docs_check: historia -->

Zero pracy przy bazie Subiekta — ta zmiana **nie dotyka uprawnień**. Z
`wertis.env` można usunąć `MSSQL_POZ_ID_COLUMN` i `DOK_TYP_ZWROTY`; serwer ich
nie czyta. Poza tym `git pull`, `npm ci`, `npm run build` i restart usług.

Stare bazy zachowują nieużywane kolumny (`koszyk`, `mm_ilosc`, `mm_queue_id`,
`sgt_pozycje`, `ob_id`) — wszystkie nullowalne, nikt ich nie czyta, a
`DROP COLUMN` w SQLite przepisuje tabelę. Nowe bazy powstają bez nich.

## 0.16.0 — 31 lipca 2026

<!-- docs_check: historia -->

**Flaga sprawdzenia faktury wychodzi z aplikacji w całości.** Aplikacja nie
zapisuje już do bazy Subiekta niczego poza polem lokalizacji na kartotece —
reguła „tylko lokalizacja" nie ma od dziś ani jednego wyjątku.

### Dlaczego, skoro dzień wcześniej ją naprawialiśmy

Bo naprawa odpowiedziała na inne pytanie niż to, które padło potem: czy WERTIS
w ogóle **potrzebuje** flag, żeby kontrolować dostawy. Nie potrzebuje. Kontrolę
niesie w całości `delivery_line` — co odłożone, gdzie, przez kogo i z jakim
wyjątkiem. Flaga nigdy nie była do tego potrzebna ani magazynierowi, ani
serwerowi.

Flaga była kanałem do **biura**: kolumną „FW" na liście faktur zakupu, czyli
jedynym miejscem, w którym księgowość widziała stan rozkładania. Za ten jeden
kanał płaciło się około 1 275 liniami w 30 plikach, sześcioma zmiennymi env,
dwoma prawami zapisu do bazy firmy, tabelą read-modelu i typem zadania
w kolejce. Właściciel zdecydował, że kanał nie jest tego wart.

### Co znika

Serwis `delivery-flag.ts` w całości, `applyDocFlag` z obu adapterów zapisu
(w tym MERGE do tabeli przypisań flag), typ zadania w kolejce razem z gałęzią
workera i kompensacją, tabela słownika flag, kolumny `flaga`, `flaga_wyslana`
i `active_at`, pola `flaga`/`flagaKey` w dwóch DTO, pastylka na kolektorze,
sześć zmiennych env, krok kreatora w instalatorze i dwa `GRANT`-y.

Znika też cała klasa błędów wokół wykrywania „biuro nadpisało flagę" — łącznie
z tym z 0.14.0, w którym zwolniony worker potrafił porzucić dostawę magazyniera.

### Co świadomie tracimy

Biuro nie zobaczy już stanu rozkładania w Subiekcie. Zostaje `/api/events`
i eksport CSV, czyli surowe zdarzenia, a nie odpowiedź „czy FZ/123 sprawdzona"
jednym spojrzeniem. Kolektor przestaje też odróżniać fakturę rozłożoną poza
aplikacją od nietkniętej — pokazuje wyłącznie własny postęp.

### Stare bazy i stare kolejki

Kolumn nie kasujemy z istniejących plików `.db`: wszystkie są nullowalne, nic
ich nie czyta, a `DROP COLUMN` w SQLite przepisuje tabelę. Nowe bazy powstają
bez nich. Dawne dostawy w statusie `abandoned` zostają — ustawiał go usunięty
mechanizm, a przepisywanie historii byłoby gorsze od jednej martwej wartości.

Kolektor **nadal rozumie** dawny typ zadania na ekranie kolejki. Pole `type`
nie ma wartości domyślnej, więc usunięcie go z modelu wywracałoby ten ekran na
każdej instalacji z historią.

### [wymaga działania] odbierz uprawnienia zapisu

<!-- docs_check: historia -->

Po aktualizacji, na serwerze SQL firmy:

```sql
REVOKE INSERT, UPDATE ON dbo.fl_Wartosc FROM wertis;
REVOKE SELECT         ON dbo.fl_Wartosc FROM wertis;
REVOKE SELECT         ON dbo.fl__Flagi  FROM wertis;
```

Konto WERTIS-a zostaje wtedy z **jednym** prawem zapisu w całej bazie: `UPDATE`
na jednej kolumnie kartoteki. Wpisy `MSSQL_FLAG_*` i `DOC_FLAG_*` w `wertis.env`
można usunąć — serwer ich nie czyta. Flagi postawione wcześniej **zostają na
fakturach**; nic ich nie sprząta, bo to informacja biura, nie nasza.

Poza tym `git pull`, `npm ci`, `npm run build` i restart usług. APK bez pastylki
rozsyła MDM osobno.

## 0.15.0 — 31 lipca 2026

Karta towaru mieści się teraz na jednym ekranie. Wcześniej była kolumną sekcji
rozwijaną przewijaniem: dwa kafle stanów po pół ekranu, pod nimi dostawy,
zamówienia, magazyny, lokalizacje, przycisk, zamienniki i historia. Codzienne
pytanie brzmi „ile jest i gdzie leży", a odpowiedź na drugą jego połowę leżała
poniżej zgięcia ekranu.

### Nagłówek odpowiada na oba pytania naraz

Symbol stoi pierwszy i największy — to jedyny identyfikator używany przy
regale. Pod nim wielka liczba dostępnych sztuk, obok niej pastylka adresu
pickingowego. Rezerwacja, stan łączny i MGP zeszły do jednej podlinijki, bo
sięga się po nie dopiero wtedy, gdy liczba nie zgadza się z półką.

Pastylka adresu to ten sam komponent, co chipy pod spodem (`LocChip(big)`).
Dzięki temu niesie te same cztery stany zapisu: przekreślenie przy schodzącym
adresie, ⏳ przy dochodzącym, czerwony puls przy nieudanym zapisie. Osobny
widget znaczyłby, że stany trzeba napisać dwa razy — a wtedy rozjeżdżają się
przy pierwszej zmianie.

Towar bez adresu dostaje na tym samym miejscu bursztynową pastylkę
**„+ DODAJ ADRES"**, która prowadzi wprost do skanu półki. Kartoteka bez adresu
znaczy, że towar leży gdzieś na hali i nikt poza znalazcą nie wie gdzie — to
zadanie do wykonania, nie fakt do przyjęcia. Napis „brak lokalizacji" mówił to
samo, tyle że kazał szukać czynności gdzie indziej. Rząd chipów pod spodem
wtedy znika: „+ DODAJ" przeniósł się do nagłówka, a licznik pokazywałby
„0/50 zn.", czyli liczbę, która niczego nie ogranicza.

### Trzy sekcje zwijane zamiast czterech sekcji stale otwartych

HISTORIA, POZOSTAŁE MAGAZYNY oraz ZAMIENNIKI I OPIS są zwinięte po wejściu na
kartę. Każda niesie podsumowanie w nagłówku (`ost. Jan K · 07-28`,
`SKLEP 3 · SERWIS 0`, `24-04003 · MAG 4`), więc w typowym dniu nie trzeba
otwierać żadnej. Sekcja bez danych nie pokazuje się wcale — wyszarzony nagłówek
byłby obietnicą treści, której nie ma.

Wejście w zamiennik zwija je z powrotem: to inny towar i inne pytanie.

Opis kartoteki zszedł z góry ekranu do sekcji zamienników. Jest prozą z numerami
obcymi i dopiskami sprzed lat — czyta się go przy rozmowie z dostawcą, nie przy
regale, a dwa wiersze pod EAN-em i tak go ucinały.

### Dostawy i zamówienia w jednej karcie, po jednej linii

„W dostawie" i „Zamówione u dostawcy" dzielą jedną powierzchnię. Rozróżnia je
tusz i ikona: bursztyn przy dostawie, bo jest co zrobić — towar leży
w przyjęciach; szarość przy zamówieniu, bo nie ma i trzeba poczekać. Każdy
dokument to jedna linia z numerem, ilością i statusem; data wystawienia
wypadła, bo numer niesie miesiąc i rok.

Teksty tych linii oraz podsumowania sekcji liczy `:core`
(`core/product/KartaTekst.kt`, 21 testów). To reguły „co pokazać, gdy danych
brak albo jest ich osiem", a moduł `:app` nie ma testów w ogóle.

### Co zniknęło z ekranu

Kafel ZWROTY OD KLIENTÓW (stan wchodzi jako pierwszy wiersz POZOSTAŁYCH
MAGAZYNÓW, z dopiskiem), pasek „W kolejce Sfery N szt", linia „⏳ czeka na
zapis w Subiekcie" oraz podpowiedź o skanowaniu spod chipów. Sygnał nieudanego
zapisu zostaje tam, gdzie był zawsze: pulsujący chip prowadzący do kolejki.

## 0.14.0 — 31 lipca 2026

Flaga sprawdzenia faktury **wraca z Subiekta na kolektor**. Do tej pory szła
wyłącznie w jedną stronę, więc faktura oznaczona przez biuro wyglądała na
kolektorze dokładnie tak samo jak nietknięta: bez pastylki, na górze listy
pracy. Magazynier dostawał do rozłożenia dostawę, którą ktoś już rozłożył.

### Jedna flaga, dwa prawdziwe źródła

Aplikacja czytała `sgt_dokument.flaga` tylko po to, żeby wykryć nadpisanie
przez biuro — i tylko dla dostaw, które sama wcześniej oznaczyła. Dokument bez
wiersza w `delivery` nie miał więc na ekranie żadnego stanu, choć w Subiekcie
stan miał.

Pierwszeństwo rozstrzyga jedna czysta reguła (`widokFlagi`): dopóki aplikacja
prowadzi dokument, wygrywa jej wyliczenie, bo między policzeniem flagi a jej
zapisem stoi kolejka. Poza tym wygrywa Subiekt — i to w dwóch sytuacjach:
dokumentu nikt tu nie otwierał albo biuro przejęło flagę.

Sprawdzona faktura schodzi teraz na dół zakładki DOSTAWY, szarzeje i dostaje
ptaszek — tak samo jak dostawa rozłożona na kolektorze. Reguła mieszka
w `:core`, bo jest regułą, a nie wyglądem.

### Zwolniony worker nie porzuca już dostawy

Przy okazji wyszedł błąd starszy niż ta zmiana. `officeOverride` porównywał
Subiekta z tym, co sami wysłaliśmy, **nie patrząc na kolejkę**. Zadanie
czekające na workera wyglądało więc jak decyzja biura: aplikacja porzucała
własną dostawę zaraz po otwarciu, a flaga tej faktury nie zmieniała się już
nigdy.

Najłatwiej trafiała w to faktura z flagą postawioną wcześniej ręcznie — czyli
dokładnie ta, od której zaczyna się ten wpis. Teraz porównanie czeka, aż
kolejka opustoszeje.

### Obce flagi firmy mają nazwy

<!-- docs_check: historia -->

Firma trzyma w `fl__Flagi` więcej flag niż cztery nasze. Taka flaga pokazuje
się z nazwą ze słownika, ale **bez koloru stanu** — o fladze spoza tego procesu
wiadomo tylko tyle, że biuro ją postawiło. Słownik importuje się z `fl__Flagi`
do nowej tabeli read-modelu `sgt_flaga`.

Brak `GRANT SELECT` na `fl__Flagi` nie wywraca importu: pastylka zostaje bez
nazwy, a `/api/health` mówi, czego brakuje. Skrypt uprawnień nadaje to prawo
od dawna, więc typowa instalacja nie wymaga niczego.

### [wymaga działania] tylko gdy flagi nie były skonfigurowane

<!-- docs_check: historia -->

`MSSQL_FLAG_GRUPA` i `MSSQL_FLAG_TYP_OBIEKTU` rządzą teraz także **odczytem**.
Puste znaczą, że kolektor nie zobaczy żadnej flagi biura i każda faktura będzie
wyglądać na niesprawdzoną. Ustala się je jednym zapytaniem (DEPLOY §6).

Poza tym `git pull`, `npm ci`, `npm run build` i restart usług. Nowa tabela
powstaje sama przy starcie; APK z pastylkami rozsyła MDM osobno.

## 0.13.0 — 31 lipca 2026

WERTIS umie teraz wskazać **konkretny wiersz faktury**. Nic to jeszcze nie
zmienia na ekranie — to warunek konieczny zapisu opisu różnic do Subiekta,
policzony osobno, żeby tamta zmiana nie niosła przy okazji migracji schematu.

### Dlaczego to nie jest jedna kolumna

<!-- docs_check: historia -->

Naturalny odruch to dopisać `ob_id` do linii roboczej. **Byłby błędny.**
`openDelivery` agreguje ten sam towar z kilku wierszy dokumentu w jedną linię —
świadomie, bo magazynier ma przed sobą jedną paletę i ma ją zobaczyć raz.
W Subiekcie duplikat jest normalny: dwie ceny, dwie partie, dwa wiersze.

Linia dostaje więc `sgt_pozycje` — **listę** identyfikatorów, posortowaną
rosnąco. Sortowanie nie jest kosmetyką: czyni „pierwszą pozycję tego towaru"
pojęciem rozstrzygalnym, gdy przyjdzie wybrać komórkę zapisu.

Agregacja została nietknięta. Rozbicie na wiersz-per-pozycję pokazałoby ten sam
towar dwa razy przy jednej palecie — regresja w interfejsie wprowadzona po to,
żeby uprościć zapis, którego jeszcze nie ma.

### [wymaga działania] Nazwa kolumny jest ZAŁOŻENIEM

<!-- docs_check: historia -->

Nowe `MSSQL_POZ_ID_COLUMN`, domyślnie `ob_Id`. Nasz opis struktury tej kolumny
nie wymienia, więc domyślna jest **szóstym `[WERYFIKUJ]`** — dokładnie w tej
samej sytuacji `ob_IloscZrealizowana` okazało się zgadnięte źle.

Sprawdza to jedno zapytanie o komplet kolumn `dok_Pozycja`, to samo, które
odpowiada na pytanie o „Opis dostawy" (`docs/subiekt-gt-struktura.md`).

Brak kolumny **nie wywraca importu**: pozycje wczytują się bez identyfikatora,
`sgt_pozycje` zostaje puste, a `/api/health` mówi o tym wprost. Cisza byłaby tu
groźna — opis różnic trafiłby kiedyś w niewłaściwy wiersz i wyglądałby jak
zwykły wpis.

### Migracja

Kolumny dochodzą same, przez `migrate()` w `db/db.ts` — ten sam mechanizm co
przy `events.user_ref`. Sprawdzone na bazie założonej na schemacie sprzed
zmiany: kolumny dochodzą, dane zostają, **stare wiersze mają `NULL`**, a nie
zmyśloną wartość. Historii się nie dopisuje wstecz.

Seed dostał fakturę z **tym samym towarem w dwóch wierszach** — bez niej ścieżka,
dla której cała ta zmiana powstała, nie miałaby w demo ani jednego przebiegu.

---

## 0.12.3 — 31 lipca 2026

Zakładka rozkładania nazywa się teraz **DOSTAWY**, pokazuje **same faktury
zakupu** i przestaje kłamać o oknie czasowym.

### „ROZKŁADANIE" → „DOSTAWY"

Magazyn mówi „dostawy", nie „rozkładanie". Zmiana obejmuje etykietę zakładki
w dolnym pasku i tytuł ekranu; ścieżka pracy się nie zmienia.

### Tylko FZ, i to naprawdę tylko FZ

Domyślne `DOK_TYPY_DOSTAW` zmieniło się z `1,10` na `1`. U tego klienta towar
wchodzi wyłącznie fakturą zakupu, a PZ pochodzi z innego procesu i na liście
pracy magazyniera było szumem. Firmy przyjmujące obiema drogami wracają do
`DOK_TYPY_DOSTAW=1,10` — to nadal jedno ustawienie, nie zmiana kodu.

Samo przestawienie domyślnego by nie wystarczyło: adapter **seeded** miał parę
`('FZ','PZ')` ZASZYTĄ w dwóch zapytaniach i ustawienia nie czytał. Demo
pokazywało więc co innego niż produkcja z tej samej konfiguracji. Tłumaczenie
kodów `dok_Typ` na etykiety read-modelu jest teraz w jednym miejscu
(`etykietyDostaw`), z asercjami — w tym na kod spoza pary FZ/PZ, który wcześniej
wpadłby do SQL jako `null` i milczkiem opróżnił listę.

Zwroty znikają z tej zakładki. Serwerowa ścieżka koszyków i MM **zostaje
nietknięta** — to ukrycie wejścia, nie wycofanie funkcji.

### `DOK_DNI_WSTECZ` działało tylko w połowie

Trasa `/api/delivery/documents` miała `listDocuments(14)` zaszyte na sztywno,
więc ustawienie rządziło importem, ale nie zakresem samej listy:
`DOK_DNI_WSTECZ=30` nie pokazywało ani jednego dokumentu więcej. Teraz lista
bierze okno z konfiguracji.

Ta sama czternastka stała też w nagłówku kolektora („DOSTAWY FZ/PZ · OSTATNIE
14 DNI") — trzecie miejsce, w którym mogła się rozjechać, i jedyne, które
człowiek widzi. Serwer podaje teraz `dniWstecz` w odpowiedzi, a nagłówek go
pokazuje zamiast zgadywać.

### Gdzie biuro trzyma opis różnic — zwiad, nie implementacja

Rozbieżności z faktury magazyn wpisuje ręcznie w kolumnie **„Opis dostawy"**,
która — wbrew pierwszemu założeniu — stoi w siatce **pozycji** dokumentu, nie
w nagłówku. Opis dotyczy więc konkretnego towaru, co dobrze pasuje do wyjątków
WERTIS (`problem.line_id`).

`docs/subiekt-gt-struktura.md` dostał rozdział z procedurą ustalenia, gdzie to
pole mieszka (dwa niezależne tropy: po etykiecie i po zasianym znaczniku) oraz
**piąty znacznik `[WERYFIKUJ]`**. Rozdział mówi wprost, czego repo nie wie:
kolumn tekstowych `dok_Pozycja` nikt nie badał, a z `tw_Pole1..8` nie wynika
istnienie analogicznych pól na pozycji.

Odnotowana przy okazji luka: WERTIS **nie importuje identyfikatora pozycji**.
Dopasowanie po parze (dokument, towar) nie jest bezpieczne, bo ten sam towar
potrafi stać na fakturze w dwóch wierszach. Zapis do tego pola wymaga więc
zmiany schematu — policzonej osobno, po zwiadzie.

---

## 0.12.2 — 31 lipca 2026

Deinstalacja u klienta stanęła na ostatnim kroku: „jakiś proces używa tego
folderu". Usługi zeszły, reguła zapory zniknęła, `C:\wertis` został.

### Katalog trzymały dwie rzeczy naraz

**Powłoka wewnątrz.** Wcześniejsze etapy każą wpisać `cd C:\wertis`, a Windows
nie kasuje katalogu, w którym stoi proces. Instalator nie mówił o tym nic.
Teraz sprawdza katalog roboczy i ostrzega **przed** pytaniem o zgodę — po
zgodzie człowiek potwierdziłby deinstalację, która i tak nie dojdzie do końca.

**Osierocony `node.exe`.** `nssm remove` wyrejestrowuje usługę, ale gdy proces
wisiał (a wisiał — stąd `SERVICE_PAUSED`), zostaje z otwartymi uchwytami.
Deinstalacja zatrzymuje teraz procesy uruchomione z kasowanego katalogu, zanim
ruszy pliki: zablokowany plik wywraca także przenoszenie śladu audytowego, nie
tylko kasowanie.

Zasięg jest wąski celowo — liczy się plik wykonywalny **wewnątrz** kasowanego
katalogu. `node.exe` z `C:\Program Files` obsługujący cudzą aplikację jest poza
zasięgiem z definicji.

### Porównanie ścieżek, które musiało być dokładne

Prefiks bez separatora na końcu robi z `C:\wertis2\node.exe` mieszkańca
`C:\wertis` — czyli deinstalacja WERTIS ubija cudzy proces. To ta sama klasa
błędu co `Split-Path` na korzeniu dysku z 0.11.0. `Test-SciezkaWewnatrz` jest
czystą funkcją i ma własne asercje; sabotaż tego jednego porównania wywraca
dwa testy naraz.

### „Pliki w użyciu" mówi teraz, jakie

Komunikat bez nazwy winowajcy kończy się kasowaniem katalogu ręką, czyli
ominięciem bramki bezpieczeństwa. Instalator wypisuje nazwy i PID-y tego, co
trzyma katalog, a gdy lista jest pusta — kieruje do `resmon`, bo uchwyt trzyma
wtedy okno Eksploratora albo edytor, nie proces z plikiem w środku.

### Polecenia deinstalacji nie dało się wkleić

`docs/wdrozenie.md` podawał `.\wertis-instalator.ps1 -Odinstaluj`, a Windows
odpowiada na to `running scripts is disabled on this system` — i tak też
skończyło się u klienta. Instrukcja przy instalacji kieruje do `URUCHOM.cmd`,
ale deinstalacja potrzebuje argumentów, więc tamta osłona jej nie obejmuje.
Wszystkie polecenia w tej sekcji mają teraz `-ExecutionPolicy Bypass` wprost.

CI dostał przebieg próbny deinstalacji na **podrobionej instalacji**, gdzie
bramka się zgadza. Poprzedni wariant szedł na nieistniejącym katalogu i mijał
skanowanie procesów bokiem. Nowy woła `Get-Process` na prawdziwej tablicy
procesów — część z nich nie oddaje `.Path` i to wywracało pierwszą wersję kodu.

---

## 0.12.1 — 30 lipca 2026

`Login failed for user 'wertis'` — po instalacji, która zameldowała sukces.

### Idempotencja, która rozjeżdżała hasło

Skrypt uprawnień zakładał konto tak:

```sql
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wertis')
    CREATE LOGIN [wertis] WITH PASSWORD = '<nowe losowe>', CHECK_POLICY = ON;
```

Wygląda na bezpieczne przy ponownym uruchomieniu i takie było — **co do
istnienia konta, ale nie co do poświadczeń**.

Login jest obiektem **instancji**, więc przeżywa nieudany przebieg kreatora
i skasowanie bazy. Pierwsze podejście u klienta wywaliło się na literówce
w nazwie instancji, ale login zdążył powstać. Drugi przebieg trafił w
`IF NOT EXISTS`, pominął `CREATE LOGIN` i **zostawił stare hasło** — podczas
gdy instalator zapisał do `wertis.env` świeżo wylosowane.

Teraz istniejący login dostaje `ALTER LOGIN ... WITH PASSWORD` i `ENABLE`.
Wyłączone konto daje dokładnie ten sam objaw i tę samą ciszę.

### Weryfikacja sprawdzała uprawnienia, nie logowanie

<!-- docs_check: historia -->

To jest właściwa przyczyna tego, że awaria wyszła dopiero przy starcie usługi.
`Get-WertisUprawnienia` odpytuje `sys.database_permissions` **połączeniem
administratora**, więc odpowiada na pytanie „czy konto ma prawa" — nigdy „czy
da się na nie zalogować". Kreator meldował więc:

```
[ok] Konto gotowe: 8 tabel do odczytu, zapis tylko tw_Pole2 i fl_Wartosc.
```

o koncie, którego hasła nikt nie potwierdził.

Instalator otwiera teraz **osobne połączenie na tych poświadczeniach, które za
chwilę trafią do pliku**, i wykonuje `SELECT 1`. Nieudana próba jest błędem
kreatora z gotowym `ALTER LOGIN` do wklejenia — zamiast `Login failed for user`
w logu usługi, kwadrans później.

Gdy próba się nie uda, instalator idzie ścieżką „konto czeka na administratora"
i zapisuje skrypt do przekazania. Skrypt zawiera już `ALTER LOGIN`, więc jego
wykonanie naprawia dokładnie ten przypadek.

### Naprawa istniejącej instalacji

Ponowne uruchomienie kreatora (`-TylkoKonfiguracja`) wystarcza — przestawi
hasło i sprawdzi logowanie. Ręcznie, w SSMS:

```sql
ALTER LOGIN [wertis] WITH PASSWORD = 'hasło z wertis.env';
```

Po tym `nssm stop` i `nssm start` obu usług. Samo `start` nie wyjdzie ze stanu
`SERVICE_PAUSED`, w który NSSM wpada po kilku szybkich awariach startu.

## 0.12.0 — 30 lipca 2026

<!-- docs_check: historia -->

Kreator przeszedł do końca na prawdziwej bazie i wylądował na danych demo.

```
[ok] Konto gotowe: 8 tabel do odczytu, zapis tylko tw_Pole2 i fl_Wartosc.
[ok] Zapisano C:\wertis\wertis.env (17 ustawień).
[!]  Tryb: seeded - to DANE DEMO. Nic nie trafia do Subiekta.
```

**To jest dokładnie ta awaria, której cała architektura konfiguracji miała
zapobiec** — opisana słowo w słowo w komentarzu `env-file.ts`: *„rozjazd nie
dawał żadnego objawu, worker pisze do lokalnego SQLite i ZGŁASZA SUKCES.
Na kolektorze zielono, w Subiekcie zero zmian"*.

### Przyczyna: dwa ustawienia NSSM o tej samej nazwie w połowie

| ustawienie | co robi |
|---|---|
| `AppEnvironmentExtra` | **dokłada** zmienne do środowiska procesu |
| `AppEnvironment` | **zastępuje** je w całości |

Instalator kasował **wyłącznie pierwsze**. Instalacja, która kiedyś użyła
drugiego, przechodziła przez kreator nietknięta: plik dostawał `SGT_MODE=mssql`,
był poprawnie wczytany, a proces i tak startował w trybie `seeded` — bo
środowisko ma nad plikiem pierwszeństwo (zwykła semantyka dotenv).

Od tej wersji lecą **oba**, listą w jednej stałej, którą asertuje
`instalator/testy.ps1`.

### `/api/health` przestaje milczeć

`loadEnvFile()` **już liczył** listę przykrytych kluczy — i wyrzucał ją do
kosza. To jedyne pole, które nazwałoby tę awarię z jednego spojrzenia.

- **`configPrzykryte`** — które klucze z pliku przegrały ze środowiskiem.
  Same nazwy, **nigdy wartości**: w pliku leży `MSSQL_PASSWORD`. Pilnuje tego
  osobny test.
- **wpis w `problemy`**, gdy przykryty jest klucz zmieniający zachowanie
  (`SGT_MODE`, `MSSQL_*`). Wtedy `ok` jest fałszywe, a zdanie mówi, co zrobić.

Alarm milczy tam, gdzie nadpisywanie środowiskiem jest normalną drogą — bez
pliku (`npm run dev`, testy) i dla kluczy pokroju `LOG_LEVEL`. Bramka, która
krzyczy bez powodu, uczy ignorować `problemy`.

### Kreator nazywa rozjazd błędem, nie wyborem

Gdy instalator właśnie zapisał `SGT_MODE=mssql`, a `/api/health` melduje
`seeded`, to jest **błąd instalacji**. Dotąd leciał jako `[!]` z tekstem
o poprawnym wariancie pilotażowym — czyli mylił w tym akurat przypadku
najbardziej. Teraz wypisuje przykryte klucze i polecenie, którym się je czyści.

### Weryfikacja

Nowa bramka **sabotowana w dwie strony**: wyjęcie `SGT_MODE` z listy kluczy
krytycznych i wpuszczenie wartości do komunikatu czerwienią dokładnie te dwie
asercje, które mają czerwienić — w tym tę o niewyciekaniu hasła.

**[wymaga działania]** Sam `git pull` naprawia przyszłe instalacje. Maszyna już
dotknięta wymaga wyczyszczenia środowiska usług:

```powershell
nssm reset wertis-api AppEnvironment ; nssm reset wertis-worker AppEnvironment
nssm restart wertis-api ; nssm restart wertis-worker
```

Ponowne uruchomienie kreatora robi to samo przy okazji.

## 0.11.0 — 30 lipca 2026

Odinstalowanie jednym poleceniem — i uczciwa lista tego, czego ono **nie cofa**.

```powershell
.\wertis-instalator.ps1 -Odinstaluj
```

Do tej pory deinstalacji nie było w żadnej postaci: ani przełącznika, ani
sekcji dokumentacji, ani jednego `nssm remove` w całym repozytorium.

### Zdanie, które kłamało

`docs/wdrozenie.md` obiecywał przy Etapie 0:

> **Wycofanie:** odinstalowanie usług. Nic poza tym nie powstało.

**To była nieprawda.** Po Etapie 0 zostawał katalog `C:\wertis` z całym klonem
repo i `node_modules`, dwie usługi Windows, reguła zapory, `tools\nssm.exe`,
baza SQLite, katalog logów oraz zainstalowane systemowo Node i Git. Człowiek,
który zaufałby temu zdaniu przy pilocie, zostawał z instalacją, o której nie wie.

### Czego deinstalacja NIE cofa

To jest połowa wartości tej zmiany i skrypt wypisuje to na końcu przebiegu:

| co zostaje | dlaczego |
|---|---|
| **wartości w bazie Subiekta** | to dane firmy, nie aplikacji — odwraca je wyłącznie kopia bazy |
| **login SQL `wertis`** | stoi na poziomie **instancji**, więc pomyłka dotknęłaby wszystkich baz |
| **ustawienia SQL Servera** | uwierzytelnianie mieszane, TCP i SQL Browser bywają używane przez inne aplikacje |
| **Node.js i Git** | instalator dokłada je systemowo |

Pierwszy wiersz jest sednem. **Odinstalowanie aplikacji nie jest cofnięciem jej
pracy.** Pole lokalizacji na kartotekach i flagi na fakturach zostają dokładnie
tam, gdzie je wpisała.

### Ślad audytowy przeżywa deinstalację

Domyślnie `server\data` — baza z historią zmian, zdjęcia problemów, kolejka —
zostaje **przeniesiony obok** do `C:\wertis-dane-<data>`, a skrypt wypisuje tę
ścieżkę. Historia bywa potrzebna długo po tym, jak aplikacja zniknie z maszyny;
`docs/wdrozenie.md` czyni z niej jedyne źródło odpowiedzi na „co stało w polu
przed zmianą".

Skasowanie wymaga osobnego przełącznika `-UsunDane` i drugiego potwierdzenia.

### Bramka, bez której tego kodu nie wolno byłoby wypuścić

`Remove-Item -Recurse -Force` dostaje ścieżkę z parametru. To ta sama klasa
błędu, na której instalator wywalił się u klienta 27 lipca (`New-Item -Path
"C:\"`) — tylko że tam kosztowała nieudaną instalację, a tutaj kosztowałaby dysk.

Dlatego kasowanie wymaga **rozpoznania instalacji**: katalog musi zawierać
`server` oraz `.git` albo `wertis.env`. Sam `server` to za mało, bo bywa
w cudzych projektach. Korzeń dysku, `C:\Windows` i literówka w `-Katalog`
dostają odmowę z powodem, a nie usunięcie.

Decyzja jest wyprowadzona do czystej funkcji `Get-WertisPlanDeinstalacji`, więc
stoi za nią **dziesięć asercji** w `instalator/testy.ps1` — w większości na
odmowach, nie na sukcesach.

### Kolejność, która nie wynika z kodu

Usługi → `nssm remove` → zapora → katalog. Odwrotnie się nie da: `nssm.exe` leży
**wewnątrz** kasowanego katalogu, a działający `node.exe` trzyma uchwyty do
plików. Bez `confirm` w `nssm remove` NSSM otwiera okno dialogowe i skrypt wisi
w nieskończoność.

**Czego to nie dowodzi.** Samego usuwania nie da się sprawdzić poza Windowsem
z usługami — `-DryRun` z założenia pomija każdy krok wykonawczy. CI parsuje
skrypty, uruchamia asercje i przechodzi gałąź deinstalacji w trybie próbnym.
Pierwsze prawdziwe uruchomienie na maszynie testowej jest jedynym pełnym testem,
i dlatego dokument opisuje też **drogę ręczną**.

## 0.10.1 — 30 lipca 2026

Jak sprawdzić, **które z ośmiu pól własnych jest lokalizacją** — i cztery inne
ustawienia, o które kreator nie pyta wcale.

`docs/subiekt-gt-struktura.md` dostał rozdział „Jak ustalić wszystkie wartości",
ułożony **w kolejności pytań kreatora**. Podział idzie po tym, kto ustala
wartość, bo to rozstrzyga, czy trzeba cokolwiek zrobić ręką.

| grupa | co robisz |
|---|---|
| kreator ustala sam | potwierdzasz wybór z listy |
| kreator pyta wprost | wpisujesz |
| **kreator NIE pyta** | **dopisujesz do `wertis.env`** |
| ustalone ze struktury | nic |

Trzecia grupa jest sednem. Kreator kończy się słowem „Gotowe", więc brak tych
pięciu wartości **nie daje żadnego sygnału**. `MSSQL_PORT` jest tam luką osobnego
rodzaju: stoi na liście zapisu, ale żaden krok kreatora go nie przypisuje.

### Pole lokalizacji — pytanie, którego dotąd nie umiał zadać żaden dokument

Worker nadpisuje wskazaną kolumnę **bezwarunkowo**. Zapytania, które by na to
odpowiadało, nie było w żadnym pliku — istniało wyłącznie wewnątrz instalatora.
`DEPLOY.md` opisywał problem słowami i nie podawał ani jednego `SELECT`-a.

Zapytanie w dokumencie odpowiada teraz na trzy pytania, nie na dwa. Trzecie jest
najważniejsze: **czy któreś pole już zawiera adresy półek**. Magazyn, który dziś
jakoś notuje lokalizacje, robi to najczęściej w polu własnym — a wskazanie wtedy
innego pola daje dwa źródła prawdy o tym samym.

To samo rozpoznanie trafiło **do kreatora**, bo to w nim zapada decyzja.
`Get-WertisPolaDodatkowe` liczy dodatkowo wartości w kształcie regału
(`A01-02-03`) albo palety (`PAL-042`), tymi samymi wzorcami, którymi aplikacja
rozpoznaje skan.

Podpowiedź Enterem przestaje przez to padać na pierwsze puste pole:

- pole z adresami wygrywa z pustym,
- przy braku adresów reguła wraca do pierwszego pustego,
- **pole zajęte cudzymi danymi nie jest podpowiadane wcale** — dotąd kreator
  podpowiadał tam `tw_Pole1`, czyli akurat kasowanie danych firmy,
- dwa pola z adresami to remis i brak podpowiedzi, bo to człowiek musi
  rozstrzygnąć, które obowiązuje.

Ostrzeżenie przed nadpisaniem pyta teraz o to, co **naprawdę zniknie**: liczy
wartości, które nie wyglądają na adres. Straszenie adresami, które aplikacja
i tak przejmuje, uczyłoby klikać „tak" także tam, gdzie ostrzeżenie jest prawdziwe.

### Kolumna ilości zrealizowanej: `[WERYFIKUJ]` → ustalenie

Dokument mówił, że `ob_IloscZrealizowana` to „nazwa prawdopodobna, nie
potwierdzona". Została sprawdzona i jest **błędna**: pełna lista 57 kolumn
`dok_Pozycja` z bazy 1.8731.31.6933 nie zawiera stopnia realizacji w żadnym polu.
Poprawną wartością na tej wersji jest **pusta**.

Zapytanie w dokumencie było przy okazji **źródłem tej pomyłki**: filtr
`LIKE 'ob_Ilosc%'` przegapiłby kolumnę nazwaną inaczej. Nowa wersja wypisuje
wszystkie kolumny.

### Liczniki przestają być prozą

Trzy miejsca myliły się co do samych siebie — preambuła `struktura.md` mówiła
„cztery" przy pięciu znacznikach, `DEPLOY.md` „trzy" przy czterech punktach,
a komentarz w `config.ts` trzymał na liście `[WERYFIKUJ]` bufor rozstrzygnięty
pół roku wcześniej.

Poprawienie ich nie wystarcza, bo rozjadą się znowu. `tools/docs_check.py`
sprawdza teraz, że liczebnik w preambule zgadza się z liczbą znaczników — to ta
sama klasa zgnilizny, dla której cały ten skrypt powstał.

### Jedno miejsce zamiast dwóch

Pięć bloków SQL stało w `DEPLOY.md` i w `struktura.md` naraz, a czytelnik nie
miał jak poznać, która wersja jest aktualna — jedna z nich była błędna przez pół
roku. §6 mówi teraz **kiedy i po co**, `struktura.md` — **jak**.

**Czego to nie dowodzi.** Zmian w `sql.ps1` i w kreatorze nie da się sprawdzić
poza Windowsem z Subiektem: w CI nie ma `pwsh` z połączeniem do SQL, a `-DryRun`
do bazy się nie łączy. Regułę podpowiedzi pokrywa dziewięć asercji w
`instalator/testy.ps1`, ale samo zapytanie weryfikuje dopiero pierwsze prawdziwe
uruchomienie. Dlatego wersja z dokumentu zostaje jako droga niezależna.

## 0.10.0 — 30 lipca 2026

Co było w polu lokalizacji przed zmianą — w każdej z trzech ścieżek.

W `docs/wdrozenie.md` z 0.9.0 stało zdanie, że cofnięcie zmiany lokalizacji
opiera się wyłącznie o kopię bazy, bo audyt nie zna wartości sprzed zmiany.
**Research pokazał, że to zdanie było zbyt optymistyczne** — luka dotyczyła
trzech ścieżek, a na dwóch była szersza, niż napisałem.

| ścieżka | co wiedziała o polu |
|---|---|
| karta towaru | nową zawartość, **nie starą** |
| linia dostawy, tryb A | tylko kod półki, **żadnej zawartości pola** |
| koszyk, tryb B | **nic** — same `queueIds` |

### Dodane

- **`locsPrzed` i `zrodlo` w zdarzeniach lokalizacji.** Wartość sprzed zmiany
  jest zapisywana **surowa**, nie przepuszczona przez `parseLocs`: przywrócenie
  polega na wpisaniu z powrotem dokładnie tego, co w polu stało, a wartość
  znormalizowana byłaby rekonstrukcją.

- **Rozkładanie pojawia się w historii na karcie towaru.** Dotąd karta milczała
  o zmianach, których nie zrobiono z niej samej — a rozkładanie jest najczęstszą
  drogą, którą to pole się zmienia. Historia pokazuje teraz przejście
  `A01-02-03 → B05-01-02` z oznaczeniem źródła.

### Poprawione

- **Zdarzenie powstaje w JEDNYM miejscu — `enqueueSetLocation`.** Dane audytowe
  są tam **parametrem wymaganym**, więc zapisu lokalizacji nie da się
  zakolejkować bez śladu. Czwarta ścieżka, dopisana za pół roku, dostanie wpis
  bez pamiętania o tym. Dotąd każde z trzech miejsc logowało co innego i właśnie
  tak powstała ta luka.

- **Podwójne liczenie pracy w raporcie wydajności.** Ta zmiana sama je stworzyła:
  rozłożenie jednej linii daje teraz `putaway_line_done` ORAZ `location_set`,
  czyli dwa wiersze z jednej czynności człowieka. Bez odsiania raport zawyżałby
  tempo **każdemu, kto rozkłada** — czyli całej hali.

  W raporcie mierzącym ludzi zawyżenie jest gorsze niż brak liczby: trafia do
  rozmowy o pracy i nikt nie ma jak go zauważyć. Zdarzenia lokalizacji liczą się
  więc tylko z karty; rozkładanie ma już swoje.

### Uwagi

- **Wpisy sprzed tej zmiany nie mają `locsPrzed` ani `zrodlo`** i tak zostaje.
  Historia formatuje się wtedy po staremu, a liczniki traktują je jak zmiany
  z karty — bo wtedy tylko karta te zdarzenia emitowała.
- **Audyt nie jest mechanizmem przywracania.** Mówi, co wpisać; wpisać trzeba
  samemu. Przy większej liczbie kartotek kopia bazy zostaje jedyną rozsądną
  drogą, i `docs/wdrozenie.md` mówi to dalej wprost.
- Testy: 267 → **281**. Sabotażem sprawdzone cztery reguły: znormalizowana
  wartość „przed", podwójny wpis z trasy karty, brak emisji dla dostawy
  i koszyka oraz powrót podwójnego liczenia w raporcie.

---

## 0.9.0 — 29 lipca 2026

Procedura wdrożenia na produkcji plus dwie usterki, które ta procedura wykryła.

Pytanie brzmiało: *„jak bezpiecznie wprowadzić aplikację w firmie"*. Okazało
się, że **mechanizmy bezpiecznego wdrożenia już były** — brakowało dokumentu,
który każe ich użyć w odpowiedniej kolejności. Obie usterki niżej wyszły na
kopii bazy, gdzie kosztowały jedno zapytanie SQL.

### Dodane

- **`docs/wdrozenie.md` — sześć etapów z bramkami.** Od demo, przez kopię bazy,
  po jeden regał na produkcji. Każdy etap ma **zdanie sprawdzalne**, a nie
  wrażenie, że wygląda dobrze, oraz opisany sposób wycofania.

  Najważniejsze narzędzie było na miejscu od początku: `wertis-api`
  i `wertis-worker` to osobne usługi, a **worker jest jedynym procesem
  zapisującym do Subiekta**. Zatrzymanie go daje przebieg próbny na żywych
  danych — aplikacja czyta produkcję, kolejkuje zamierzone zapisy i nie wykonuje
  żadnego, a `/api/queue` staje się ich podglądem.

  Dokument mówi też wprost dwie rzeczy, które łatwo przemilczeć: **kopia bazy na
  tej samej instancji nie izoluje wszystkiego** (login powstaje na poziomie
  instancji), a **`sa` nie jest wymagane** — Enter pomija pytanie, a instalator
  zapisuje gotowy skrypt dla administratora bazy.

- **`DOK_TYPY_DOSTAW`** — typy dokumentów na liście rozkładania jako lista,
  domyślnie `1,10`.

- **`DOK_DNI_WSTECZ`** — okno importu dokumentów, **domyślnie 14** zamiast
  zaszytych 60.

### Poprawione

- **Para FZ/PZ była ZASZYTA w zapytaniu importu**, choć zwroty tuż obok miały już
  listę z konfiguracji. Niespójność, nie decyzja projektowa. Firma przyjmująca
  towar wyłącznie na FZ widziała na liście pracy magazyniera dokumenty
  z zupełnie innego procesu i nie mogła ich wyłączyć bez zmiany kodu.

- **Skrócenie okna importu kasowałoby niedokończoną pracę.** Okno obcina
  dokumenty po dacie wystawienia, więc przejście z 60 dni na 14 usunęłoby
  z ekranu dostawę sprzed trzech tygodni, której nikt nie rozłożył do końca.

  Okno ma teraz **wyjątek dla dostaw otwartych** — zostają widoczne niezależnie
  od wieku. Brak dostawy na liście wygląda identycznie jak dostawa rozłożona,
  a to dwie zupełnie różne sytuacje.

- **`MSSQL_ZD_ZREAL_COLUMN` może nie mieć żadnej poprawnej wartości.** Domyślne
  `ob_IloscZrealizowana` było oznaczone `[WERYFIKUJ]` i okazało się zgadnięte
  źle: na bazie 1.8731.31.6933 `dok_Pozycja` **nie niesie stopnia realizacji
  w żadnym z 57 pól**. Poprawnym ustawieniem jest wtedy wartość pusta, i tak to
  teraz opisują `DEPLOY.md` §6 oraz `wertis.env.example`.

  Zostawiona nazwa nieistniejącej kolumny daje to samo zachowanie plus
  ostrzeżenie, którego nie da się spełnić — a takie uczą ignorowania ostrzeżeń.

- **`docs/wdrozenie.md` wchodzi pod bramkę stylu.** Lista dokumentów w
  `tools/styl_check.py` jest zaszyta, więc nowy plik nie byłby sprawdzany —
  a wykonuje go człowiek pod presją, na cudzej maszynie, często pierwszy raz.

### Uwagi

- Testy: 260 → **267**. Budowanie fragmentów `WHERE` wydzielone jako czysta
  funkcja, bo bez serwera MSSQL to jedyna testowalna część importu.
  Sabotażem sprawdzone trzy reguły: powrót zaszytej pary FZ/PZ, usunięcie
  wyjątku na otwarte dostawy i wpuszczenie wszystkiego przy pustej liście typów.
- **Ilość odebraną dałoby się policzyć inaczej.** W `dok_Pozycja` jest
  `ob_DoId` — w Subiekcie pozycja dokumentu realizującego wskazuje nim pozycję
  realizowaną. To **hipoteza niezweryfikowana**; wymaga sprawdzenia na
  częściowo odebranym zamówieniu i jest zmianą kodu, nie ustawienia.

---

## 0.8.2 — 29 lipca 2026

Suma kontrolna NSSM wpisana — strażnik z 0.8.1 działa w obie strony.

W 0.8.1 stała `SUMA_NSSM_ZIP` została **celowo pusta**, bo `nssm.cc` nie było
osiągalne ze środowiska, w którym powstawał tamten kod. Wartość policzył runner
Windows w CI, pobierając plik wprost ze źródła:
`727d1e42275c605e0f04aba98095c38a8e1e46def453cdffce42869428aa6743`.

**Czego ta suma dowodzi, a czego nie.** Nie jest dowodem, że `nssm.cc` było
w tamtej chwili nienaruszone — to zaufanie przy pierwszym użyciu. Jest natomiast
gwarancją, że **od tamtej chwili plik się nie zmienił**.

### Poprawione

- **Krok CI stracił `continue-on-error`** i to jest sedno tej zmiany. Z pustą
  sumą krok tylko meldował wartość, więc pobłażliwość nic nie kosztowała.
  Z wpisaną — `continue-on-error` czyniłby strażnika **bezzębnym**: podmieniony
  plik dawałby zielone CI.

  Rozdzielone są za to dwa różne zdarzenia: **niedostępna sieć to nie to samo,
  co podmieniony plik**. Nieosiągalne `nssm.cc` daje ostrzeżenie i przepuszcza;
  niezgodna suma zatrzymuje budowę.

- **Wydanie powstawało PUSTE.** Workflow instalatora nie miał bloku
  `permissions`, więc `github.token` dostawał dostęp tylko do odczytu,
  a `gh release upload` kończył się `HTTP 403: Resource not accessible by
  integration`. Tag się tworzył, **plików przy nim nie było** — a to jedyna
  droga, którą instalator trafia do człowieka.

  Znalezione przy okazji, w logach nieudanego biegu z 12:56, nie zgłoszone.
  Dodane `contents: write` na poziomie zadania.

### Uwagi

- Przebieg próbny w CI potwierdził, że `-DryRun` **pomija pobieranie**, więc
  weryfikacja sum nie zmienia zachowania trybu próbnego.

---

## 0.8.1 — 29 lipca 2026

Antywirus zablokował instalator — i przy okazji wyszła realna dziura.

Zgłoszenie brzmiało: *„antywirus zablokował wertis-instalator.ps1, IDP.Generic,
zarażony"*. Audyt źródła: **plik jest czysty**. Zero kodu wykonywanego z sieci
(`IEX`, `DownloadString`, base64, `-EncodedCommand`), zero osadzonych binariów,
poprawny UTF-8 w całości, trzy adresy zewnętrzne — własne repo, `nodejs.org`,
`nssm.cc`. `IDP.Generic` to detekcja heurystyczna: ocenia zachowanie, nie
sygnaturę.

Instalator wykonuje sześć czynności, które razem dają profil droppera: pobiera
archiwum i uruchamia z niego plik, instaluje MSI po cichu (`/qn`), rozpakowuje
`SecureString` do jawnego hasła, nadpisuje TLS, podnosi uprawnienia i zakłada
usługi. Do tego **NSSM sam jest narzędziem dwojakiego użytku** — malware zakłada
nim usługi dla przetrwania restartu. Antywirus zachował się poprawnie.

### Poprawione

- **Pobierane pliki nie były w ŻADEN sposób weryfikowane.** Instalator ściągał
  instalator Node'a i `nssm.exe`, po czym uruchamiał je **z uprawnieniami
  administratora** — bez sprawdzenia, co właściwie przyszło. Przejęcie DNS
  w sieci klienta albo włamanie na serwer wydań wystarczyło, żeby ta maszyna
  wykonała cudzy kod jako SYSTEM.

  **To była realna dziura, nie fałszywy alarm** — znaleziona przy okazji, nie
  zgłoszona. Obie pozycje mają teraz sprawdzaną sumę SHA-256 **przed
  uruchomieniem**; niezgodność przerywa instalację i kasuje pobrany plik.

  Suma Node'a pochodzi z oficjalnego `SHASUMS256.txt` na nodejs.org. Suma NSSM
  została **celowo zostawiona pusta**: `nssm.cc` nie było osiągalne ze
  środowiska, w którym powstawał ten kod, a wpisanie wartości „z pamięci"
  dałoby weryfikację **pozorną** — gorszą od jawnego jej braku, bo wyglądającą
  na zabezpieczenie. Dopóki jest pusta, instalator ostrzega i wypisuje
  policzoną wartość. Ustala ją nowy krok CI na maszynie mającej dostęp do
  `nssm.cc`; późniejsza zmiana sumy **zatrzymuje budowę**, bo wymaga oczu
  człowieka.

### Dodane

- **`instalator/README.md` — sekcja „Antywirus zablokował instalator".** Co
  znaczy `IDP.Generic`, tabela sześciu zachowań, które go wywołują, jak
  **samodzielnie zweryfikować** plik (`.ps1` to czysty tekst — da się go
  przeczytać), gdzie zgłosić fałszywy alarm i **czego nie robić** (nie
  wykluczać całego katalogu, nie wyłączać ochrony).

  Osobno wypisane, **kiedy zacząć się naprawdę martwić**: base64,
  `Invoke-Expression`, `-EncodedCommand` albo adres spoza znanej trójki. Bez
  tego akapitu instrukcja „to fałszywka, kliknij zezwól" uczyłaby ignorowania
  antywirusa — czyli dokładnie odwrotnie, niż trzeba.

### Uwagi

- **`.exe` z `ps2exe` jest flagowany znacznie częściej niż `.ps1`.** Wydanie
  niesie oba; przy blokadzie używaj skryptu.
- **Wycięcie NSSM zostaje jako opcja.** Usunęłoby naraz pobieranie obcej
  binarki, zależność od `nssm.cc` i najczęściej flagowany składnik. Wymaga
  jednak przepisania rejestracji usług na Harmonogram zadań i **sprawdzenia na
  prawdziwym Windowsie** — a to jest mechanizm, od którego zależy uruchomienie
  produktu u klienta, więc nie idzie w ciemno razem z poprawką dokumentacji.

---

## 0.8.0 — 29 lipca 2026

Ślad audytowy odpowiada na reklamację faktem, a nie hipotezą.

Wymaganie brzmiało: *„za miesiąc ktoś powie «aplikacja mi zjadła 30 sztuk» —
chcesz mieć odpowiedź"*. Okazało się, że dane w większości **już były**: `events`
zbierał 28 typów zdarzeń od pierwszego dnia instalacji, z osobą, kontem,
urządzeniem i czasem, i nic ich nie kasuje. Brakowało czterech rzeczy — i to one
były robotą, nie „logowanie".

### Dodane

- **Trasa audytu `GET /api/events` i eksport CSV.** Filtr po osobie, towarze,
  urządzeniu, typie zdarzenia i zakresie dat. To był największy brak: odpowiedź
  na reklamację wymagała dotąd `sqlite3` na serwerze, czyli praktycznie nie
  istniała.

  Bramka na rolę **brygadzisty albo biura**, bez PIN-u — wzorem `GET
  /api/users`, gdzie PIN chroni zmiany, a nie odczyt. Log mówi, kto ile
  zeskanował, więc jest narzędziem nadzoru i hala go nie ogląda. **Kto wyniesie
  CSV, sam trafia do śladu** (`audyt_eksport`).

- **Wynik zapisu do Subiekta.** Worker zapisuje `queue_applied` (weszło i o
  której), `queue_retry` (nie weszło, wróci) i `queue_failed` (nie weszło
  i już nie wejdzie). `sfera_queue` dostała kolumnę `created_by_ref`, bo worker
  działa poza żądaniem i bez niej umiałby podać tylko nazwę, a nie konto.

- **`GET /api/health` mierzy wzrost historii** — liczba zdarzeń, data
  najstarszego i rozmiar bazy. Nie czyścimy `events` i to jest decyzja, ale
  „rośnie w nieskończoność" bez licznika kończy się pełnym dyskiem.

- **Indeks `ix_events_tw_time`.** „Co się działo z tym towarem" to najczęstsze
  pytanie przy reklamacji, a `tw_id` nie miało **żadnego** indeksu — nawet
  historia na karcie towaru skanowała całą tabelę.

### Poprawione

- **Bufor offline kasował operacje przy przejściowym błędzie serwera.**
  `OfflineQueue` klasyfikował `isNetworkError(e) = e !is ApiError`, więc
  **`ApiError(500)` nie był błędem sieci** — `flush()` wyrzucał operację
  z bufora i wołał lokalny toast. Restart serwera albo 503 spod reverse proxy
  zjadał zeskanowaną pracę magazyniera: bez śladu, bez ostrzeżenia, bez szansy
  na powtórkę.

  Teraz 5xx, 408 i 429 znaczą „serwer choruje, operacja jest zdrowa" —
  **zostaje w buforze** i wraca przy następnym flushu. Dopiero 4xx (żądanie
  wadliwe, ponowienie nic nie da) ją usuwa, i **melduje na serwer**
  (`klient_odrzucona`) z czasem wykonania na kolektorze, nie dosłania. Licznik
  `proby` pilnuje, żeby jedna chora operacja nie zamroziła kolejki na zawsze.

- **Odrzucone żądania nie zostawiały śladu.** 400 za przekroczony limit pola,
  zły kod półki czy nieznany towar wracały do kolektora i znikały — „skanowałem
  i się nie zapisało" nie miało po stronie serwera żadnego potwierdzenia. Hook
  `onSend` zapisuje je jako `http_rejected` z metodą, ścieżką, statusem
  i powodem.

  **Ciała żądania NIE zapisujemy i to jest zasada, nie przeoczenie** — przez
  `POST /api/users` przechodzi PIN. Pilnuje tego osobna asercja: log
  audytowy z PIN-ami w środku jest gorszy niż brak logu. `401` na `GET` jest
  pomijane, bo karta odpytuje serwer co 2 s i wygasła sesja utopiłaby resztę
  audytu w szumie; `401` na zapisie **jest** logowane.

- **Zdarzenia ilościowe niosą wartość sprzed zmiany** (`qtyPrzed`). Dotąd był
  sam stan po, więc „było 30, jest 0" trzeba było odtwarzać z całej sekwencji
  i ufać, że żadne zdarzenie nie zginęło.

### Czego to NIE naprawia

Operacja wykonana **bez Wi-Fi** żyje w pliku na kolektorze aż do połączenia.
Zginie urządzenie przed odzyskaniem sieci — śladu nie ma i **żadna zmiana po
stronie serwera tego nie zmieni**. Lukę zawęża to, że buforowana jest wyłącznie
zmiana lokalizacji; skany i rozkładanie offline po prostu nie działają.

### Uwagi

- Log audytowy jest narzędziem nadzoru. Warto powiedzieć zespołowi, że istnieje
  — cichy nadzór jest gorszy od jawnego.
- `klient_odrzucona` to **relacja urządzenia**, nie fakt zaobserwowany przez
  serwer. Prefiks `klient_` trzyma tę różnicę na wierzchu.
- Testy: 244 → **260** serwera, 92 → **96** w `:core`. Sabotażem sprawdzone:
  zdjęcie warunku metody przy `401` zapala 2 asercje, dopisanie ciała żądania
  do logu — asercję o PIN-ie, powrót starej klasyfikacji błędów — asercję 5xx.

---

## 0.7.0 — 29 lipca 2026

Karta towaru mówi, czego nie ma na półce, bo jeszcze nie przyjechało od dostawcy.

### Dodane

- **Sekcja „ZAMÓWIONE U DOSTAWCY" na karcie towaru.** Numer zamówienia, ilość
  pozostała do dostarczenia, termin i dostawca. Domyka pytanie otwarte przez
  0.6.0: tamta zmiana odpowiadała „towar przyjechał, poszukaj w przyjęciach",
  ta odpowiada „towaru nie ma i trzeba poczekać".

  Sekcja stoi **pod** „W DOSTAWIE, NIEROZŁOŻONE" i ma spokojne tło zamiast
  bursztynowego. Bursztyn na tej karcie znaczy „zrób coś teraz"; zamówienie nie
  daje żadnej czynności. Ten sam kolor w obu miejscach kazałby magazynierowi
  szukać towaru, którego w budynku nie ma.

  Zamówienie zrealizowane w całości znika z listy — pytanie brzmi „czego
  jeszcze nie ma", a nie „co zamówiono". Kolejność idzie po **terminie**, nie po
  dacie wystawienia; zamówienia bez terminu lądują na końcu z dopiskiem „termin
  nieznany", bo to uczciwsze niż podstawienie daty wystawienia w miejsce
  obietnicy dostawy.

### Poprawione

- **Napis „zam. u dostawcy" na kaflu MGP nie zapalił się nigdy na produkcji.**
  Karta brała go z pola `ordered`, a importer MSSQL wpisywał w nie **zero na
  sztywno** — „zamówione" nie ma w Subiekcie prostej kolumny, pochodzi
  z dokumentów ZD. Napis działał wyłącznie w trybie demo, gdzie seed czytał tę
  liczbę z arkusza. Czyli funkcja istniała dokładnie tam, gdzie nikt jej nie
  potrzebował.

  Pole `ordered` zniknęło z serwera, DTO i kafla. Ta sama liczba z arkusza
  zasila teraz syntetyczne zamówienia w seedzie, więc demo i produkcja chodzą
  **tym samym torem** — czego wcześniej nie robiły.

### Do sprawdzenia na własnej bazie

- **[wymaga działania — opcjonalne]** Doszły dwa `[WERYFIKUJ]` (łącznie cztery,
  `docs/subiekt-gt-struktura.md`). Bez nich karta działa, tylko mniej dokładnie:

  - `DOK_STATUS_ZD_OTWARTE` — opis struktury InsERT mówi tylko „5..8 —
    zamówienia (różne stany realizacji)" i nie rozpisuje ich. Domyślne bierze
    wszystkie cztery i jest **założeniem, nie ustaleniem**.
  - `MSSQL_ZD_ZREAL_COLUMN` — nazwy kolumny z ilością już odebraną nie ma
    w naszym opisie struktury. Gdy nie istnieje, import **nie przerywa się**:
    wpisuje zero, `/api/health` zgłasza zdanie z nazwą do poprawienia, a karta
    opisuje ilość jako oszacowanie. Zamówienie odebrane w połowie wygląda wtedy
    na nietknięte — dlatego to tryb awaryjny, nie docelowy.

  Oba `SELECT`-y są w DEPLOY §6. **Nowych uprawnień SQL nie trzeba** — ZD leży
  w tych samych tabelach co dostawy.

### Uwagi

- ZK (zamówienie **od klienta**, `dok_Typ = 16`) celowo poza zakresem. To ruch
  w drugą stronę i pokrywa go rezerwacja na kaflu MAG; wciągnięcie go do sekcji
  o nazwie „zamówione u dostawcy" pomyliłoby dwa przeciwne kierunki.
- Kolumna `sgt_towar.ordered` **zostaje w bazie** jako martwa. `DROP COLUMN`
  w SQLite to przepisanie tabeli, a kod jej już nie czyta ani nie zapisuje.
- Testy: 244 serwera (doszło 9), 92 w `:core` (doszły 2). Reguły „zrealizowane
  znika" i „kolejność po terminie" sprawdzone sabotażem — odwrócenie sortowania
  zapala dwie asercje, usunięcie odejmowania cztery.

---

## 0.6.1 — 29 lipca 2026

Instalator pokazuje, która baza Subiekta jest produkcyjna, a która jest jej kopią.

### Poprawione

- **Kreator nie odróżniał podmiotu od kopii.** Listował bazy alfabetycznie,
  a po wyborze sprawdzał obecność czterech tabel Subiekta. Kopia ma dokładnie
  te same tabele, więc przechodziła bez słowa — a sortowanie po nazwie potrafiło
  postawić ją **nad** produkcyjną.

  > **Dlaczego to bolało.** Pomyłka nie dawała objawu: konto SQL powstawało na
  > kopii, aplikacja czytała nieaktualne stany i zapisywała lokalizacje
  > w martwą bazę, a wszystko wyglądało poprawnie. Dowiedziałby się o tym
  > dopiero magazynier, któremu stany nie zgadzają się z półką.

- **Lista niesie teraz datę ostatniego dokumentu, liczbę dokumentów i datę
  utworzenia bazy**, posortowana od najświeższej. Żywa baza ma dzisiejszy
  dokument, kopia stoi na dniu zrzutu.
- **Podpowiedź Enterem tylko przy ściśle najświeższej bazie.** Dwie kopie z tego
  samego dnia podpowiedzi nie dostają — byłaby rzutem monetą udającym radę.
- **Ostrzeżenie po wyborze bazy z dokumentem starszym niż tydzień**, z potwierdzeniem
  domyślnie na „nie". Baza bez ani jednego dokumentu ma osobny komunikat: świeży
  podmiot jest pusty, a nie podejrzany.

Obie liczby są tanie celowo: `TOP 1 ... ORDER BY dok_Id DESC` idzie po kluczu
głównym, a licznik dokumentów bierze się z `sys.partitions`. `COUNT(*)` na
serwerze, z którego biuro właśnie korzysta, to nie jest cena za podpowiedź.

### Pod spodem

- `instalator/testy.ps1` — 14 nowych asercji na funkcjach czystych (21 → 35 przebiegów)
  (`Format-WertisEtykietaBazy`, `Sort-WertisBazy`, `Get-WertisSugerowanaBaza`,
  `Test-WertisBazaPodejrzana`). Decyzja i formatowanie są osobno od SQL-a
  właśnie po to, żeby reguła „przy remisie nie podpowiadaj" miała asercję,
  a nie komentarz.

**Wdrożenie: nic.** Zmiana dotyczy wyłącznie `instalator/**` i dokumentacji.
Działający system, konfiguracja i APK zostają bez zmian — dlatego PATCH,
mimo że osoba uruchamiająca instalator zobaczy inny ekran.

---

## 0.6.0 — 29 lipca 2026

Karta towaru mówi, czy towar przyszedł, ale nie leży jeszcze w regale.

### Nowe

- **„W dostawie, nierozłożone" na karcie towaru.** Pod kaflami stanów doszła
  sekcja z numerem dokumentu, datą i ilością, której jeszcze nie odłożono.
  Liczy się z dwóch źródeł: co przyszło (`sgt_pozycja`) minus co trafiło
  w regał (`delivery_line.ilosc_odlozona`). Okno to 14 dni, jak lista
  w zakładce rozkładania.

  > **Dlaczego.** Przy dostawie krajowej skutek magazynowy niesie sam dokument
  > w Subiekcie, więc towar figuruje na MAG od zaksięgowania. Kafel „MAG ·
  > DOSTĘPNE" pokazywał 12 szt przy pustej półce i nie mówił, że sześć z nich
  > stoi na palecie w przyjęciach. Odpowiadał na pytanie POZORNIE, a to gorsze
  > od milczenia.

- **Pominięte pozycje i te ze zgłoszonym wyjątkiem ZOSTAJĄ na liście.** Tak samo
  nie ma ich w regale, a magazynier, który właśnie ich szuka, ma prawo wiedzieć,
  że ktoś się już o nie potknął.

**Sekcja jest nieklikalna i to jest decyzja.** Wejście w dokument z karty
towaru wołałoby `openDelivery`, a ta trasa przestawia flagę faktury w Subiekcie
na „W trakcie sprawdzania". Biuro widziałoby, że ktoś sprawdza fakturę, bo
magazynier zajrzał na kartę towaru.

### Poza zakresem, świadomie

Kontener na MGP — idzie osobnym torem (`putaway_*`) i widać go na własnym kaflu
strefy przyjęć. Dokładanie go tutaj dublowałoby tę samą liczbę na jednym ekranie.

**Zamówienia u dostawcy (ZK/ZD) to osobna zmiana.** Karta odpowiada dziś na
„przyjechało, ale nie na półce", a nie na „nie ma w firmie, ale jedzie". Przy
okazji wyszło, że importer wpisuje `ordered: 0` na sztywno
(`subiekt.mssql.ts:246`), więc podpis „zam. u dostawcy" na kaflu MGP na
prawdziwych danych **nigdy się nie pokazuje**.

### Pod spodem

- Testy serwera 220 → 235: `services/dostawy-towaru.test.ts` (12 przypadków)
  i `routes/karta-towaru.test.ts` (przejście pola przez trasę).
- Adapter dostał `getDeliveryPositionsForProduct` — odwrotność
  `listDeliveryDocuments`, w tym samym pliku i z tym samym warunkiem `WHERE`.

**Nowy APK jest potrzebny**, inaczej kolektor nie narysuje sekcji. Serwer
wysyła pole niezależnie od wersji aplikacji.

---

## 0.5.0 — 27 lipca 2026

Ekran blokady po bezczynności zniknął. Sesja urządzenia nie wygasa sama.

### Zmiana zachowania

- **Kolektor nie pokazuje już ekranu „Sesja zablokowana".** Do tej pory
  dziesięć minut bez ruchu przełączało go na pełnoekranowy komunikat, a powrót
  do pracy kosztował skan badge'a. Kolektor odłożony na regale na całą przerwę
  wraca dziś do otwartej dostawy bez niczego.
- **Sesja kończy się wyłącznie jawną decyzją** — wylogowaniem z Ustawień albo
  przejęciem pracy cudzym badge'em. Blokada nigdy nie gubiła postępu, więc jej
  jedynym mierzalnym skutkiem był ten skan.
- **Tożsamości pilnuje dalej to, co pilnowało naprawdę:** skan cudzego badge'a
  nie przełącza po cichu — pyta człowieka i zapisuje przejęcie w `events`.

**Nowy APK nie jest do tego potrzebny.** Blokadę zgłaszał serwer, więc starsze
kolektory przestają ją pokazywać zaraz po restarcie usług. APK z tego wydania
usuwa już tylko martwy kod po stronie aplikacji.

### Usunięte

<!-- docs_check: historia -->

- `POST /api/auth/unlock` — trasa nie ma czego odblokowywać.
- Odpowiedzi `/api/auth/badge` i `/api/auth/me` nie niosą już `blokadaMin`
  ani `zablokowana`.
- Bramka `423 Sesja zablokowana` w `context.ts`. Razem z nią odpadł wyjątek dla
  `x-buffered-user`, który istniał wyłącznie po to, żeby wysyłka z bufora
  offline nie ginęła na zablokowanej sesji. Sam nagłówek **zostaje** — dalej
  rozstrzyga, kto podpisuje operację wykonaną poza zasięgiem.
- Stan `SessionState.Zablokowana` i akcja `BadgeAction.Odblokuj` w `:core`.

`device_session.last_seen` zostaje, ale niczego już nie bramkuje: to jedyny
ślad, kiedy dany kolektor się odezwał, i przydaje się przy pytaniu „to jedno
urządzenie czy wszystkie?".

### Pod spodem

- Testy serwera 223 → 220, testy `:core` 92 → 90. W obu miejscach doszła
  regresja na usunięty TTL: sesja bezczynna od godziny **pisze tak samo jak
  świeża**, a wcześniej dostawała 423.

---

## 0.4.1 — 27 lipca 2026

Dokumentacja przepisana według reguł ASD-STE100 w zakresie, jaki da się
przenieść na polski. PATCH, bo na ekranie nic się nie zmienia — `git pull`,
`npm ci`, `npm run build`, restart usług.

### Nowe

- **[`docs/slownik.md`](docs/slownik.md)** — jedno miejsce z regułami pisania
  dokumentacji i słowniczkiem terminów. Mówi też wprost, których reguł STE
  **nie** stosujemy, bo zależą od angielskiego. Zgodności ze standardem nie
  deklarujemy: poza angielskim nie da się jej spełnić.
- **`tools/styl_check.py`** — mierzy trzy reguły ze słownika: długość zdania
  (20 wyrazów w kroku procedury, 25 w prozie), długość akapitu i odrzucone
  warianty terminów. Bramkuje CI obok `docs_check.py`.

### Poprawione

- **Osiem dokumentów przepisanych.** Instrukcja została krótka i rozkazująca,
  a „dlaczego" zeszło pod nią do osobnych bloków. Najdłuższe zdanie w repo
  spadło z 52 do 25 wyrazów, ostrzeżenia stoją teraz **przed** krokiem, a
  40-pozycyjna checklista smoke-testu ma jedną rzecz do sprawdzenia na pozycję.
- **`README.md` mówił `better-sqlite3`** — moduł natywny zniknął w 0.4.0
  na rzecz wbudowanego `node:sqlite`.
- **`instalator/README.md` mówił o `SELECT` na siedmiu tabelach** — od 0.4.0
  jest ich osiem (`sl_Magazyn`).
- **CI nie uruchamiało się przy zmianie samego `DEPLOY.md`.** `docs_check.py`
  czytał ten plik od zawsze, ale nie było go w `paths` workflow — razem
  z `CHANGELOG.md` i `instalator/README.md`.

Poza zakresem świadomie zostały `docs/architektura.md`,
`docs/porownanie-asystent.md` i ten plik: to uzasadnienia decyzji, a limit
długości zdania wycina z nich dokładnie tę treść, dla której powstały.

---

## 0.4.0 — 27 lipca 2026

Pierwsze wydanie z numerem, który cokolwiek znaczy. Zbiera sześć zmian
zmergowanych po `0.3.0`.

### Wymaga działania

<!-- docs_check: historia -->

- **[wymaga działania] Nowe uprawnienie SQL: `GRANT SELECT ON dbo.sl_Magazyn`.**
  Bez niego karta towaru pokazuje tylko MAG, MGP i Zwroty, a `/api/health`
  mówi o tym w `problemy`. Aplikacja działa dalej — uruchom ponownie skrypt
  z [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md) §2 albo
  instalator z `-TylkoKonfiguracja`.
- **[wymaga działania] API wymaga sesji.** Skrypty i `curl` uderzające w `/api/*`
  potrzebują teraz nagłówka `x-session` — poza czterema trasami
  (`GET /api/health`, `GET /api/setup`, `POST /api/auth/badge`,
  `POST /api/users` przy pustej bazie).
- **[wymaga działania] Konfiguracja przeniesiona do `wertis.env` na dysku.**
  `AppEnvironmentExtra` w usługach przestało być używane; instalator je kasuje,
  bo zmienne środowiskowe przykrywają plik.
- **[wymaga działania] Node ≥ 22.5.** Serwer używa wbudowanego `node:sqlite`.

### Nowe

- **Wszystkie magazyny na karcie towaru** — sekcja „pozostałe magazyny"
  odpowiada na pytanie „gdzie ten towar jeszcze leży". Biuro może wybrane
  ukryć: Ustawienia → Magazyny (konto biura + PIN). MAG, MGP i Zwroty zostają
  zawsze, bo prowadzą rozkładanie.
- **Instalator Windows** — jeden `.exe` zamiast ~500 linii poleceń: usługi,
  zapora, kreator konfiguracji odpytujący bazę Subiekta i konto SQL
  o uprawnieniach kolumnowych. [`instalator/README.md`](instalator/README.md).
- **Wersje widoczne na dole ekranu** — aplikacji i serwera, z podświetleniem
  rozjazdu.

### Poprawione

- **Bramka sesji na całym API.** Wcześniej sesji wymagały trzy trasy;
  `POST /api/products/:id/location` (zmiana lokalizacji w Subiekcie)
  i `GET /api/wydajnosc` (dane per pracownik) przechodziły bez tokenu,
  podpisując operację nagłówkiem `x-user` albo słowem „anonim".
- **`SQLITE_BUSY` przy dwóch procesach** — `busy_timeout` i `BEGIN IMMEDIATE`.
  Objawem były losowe 500 i zadania w statusie `error`, bez wzorca.
- **Żądanie bez pola `action` dawało 500 zamiast 400** — znalezione przez nowe
  testy tras.
- **Instalator wywracał się przy domyślnym `C:\wertis`** — `New-Item` na
  korzeniu dysku. Do tego brak sprawdzenia kodu wyjścia `git clone`, przez co
  nieudany klon meldował sukces i padał dwa kroki dalej.
- **Zero modułów natywnych** — `better-sqlite3` zastąpione wbudowanym
  `node:sqlite`, więc `npm ci` na Windows nie kompiluje już niczego.
- **Rozjazd trybu API i workera widoczny w `/api/health`** — wcześniej worker
  pracujący na danych demo wyglądał identycznie jak poprawny.

### Pod spodem

- Testy serwera 153 → 223, w tym pierwsze testy tras HTTP (`app.inject()`)
  i kolejki Sfery. Instalator dostał 21 asercji.
- `docs_check.py` pilnuje teraz także katalogu `instalator/` i zgodności wersji.

---

## 0.3.0 i wcześniej

Historia sprzed wprowadzenia tego pliku — patrz `git log` oraz opisy PR-ów.
