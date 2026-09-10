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
zamówienia, od 0.222.0 reklamacje (§25b), a od 0.245.0 także dyskusje (§25c) —
decyzją właściciela z 9 września 2026. Jedne i drugie przyjeżdżają tą samą listą
`/sale/issues` i różnią się polem `type`.

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

**Zdjęcie widać, nie klika się w nie (0.218.0).** Załącznik będący obrazem
rysuje się wprost na osi. 0.155.0 dołożyło samą nazwę pliku i na tym stanęło:
agent musiał kliknąć, zapisać plik na dysku i otworzyć go w przeglądarce zdjęć,
żeby zobaczyć treść pytania. W sklepie z częściami zdjęcie pękniętego elementu
bywa całym pytaniem, a nazwa pliku nie mówi o nim nic.

Obie drogi do pliku idą przez `fetch`, nie przez atrybut HTML. Sesja jedzie
nagłówkiem `x-session`, którego ani `<img src>`, ani `<a href>` nie niosą —
pierwsze wydanie podglądu (0.218.0) pokazywało przez to ikonę zepsutego obrazu,
a odnośnik pobrania oddawał surowy JSON „Brak sesji". Pobranie było zepsute
od 0.155.0 i wyglądało, jakby działało. Poprawka 0.219.1 wpina podgląd we
wspólną kolejkę obrazów (`useZdjecieZalacznika`), a pobranie w `pobierzPlik` —
token do adresu nie wchodzi, bo ścieżki lądują w logach i w historii.

Układ (`podglad`) podpowiada typ z Allegro ALBO nazwa pliku — od 0.248.0 nazwa
liczy się zawsze, bo telefony przysyłają `image/jpg` i `application/octet-stream`
przy `IMG_….jpg`; o wydaniu rozstrzyga sygnatura bajtów, a 415 panel zapamiętuje.

Podgląd ma WŁASNĄ trasę i węższą bramkę niż pobranie. Oddaje wyłącznie cztery
typy rastrowe (`image/jpeg`, `image/png`, `image/webp`, `image/gif`) i wyłącznie
przy stanie `SAFE`; `image/svg+xml` jest obrazem i dokumentem ze skryptem
naraz, więc listy nie przechodzi. Nagłówek `content-type` bierzemy z tej listy,
nie z pola `mime_type` przysłanego przez Allegro. Trasa pobrania zostaje bez
zmian, z `content-disposition: attachment` — dwa adresy, dwie odpowiedzi, każda
mówi o sobie prawdę.

**Jedna powłoka załącznika dla skrzynki i reklamacji (0.246.0).** Do tego
wydania to samo było narysowane dwa razy: skrzynka pokazywała zdjęcie w linii
ze zdaniem odmowy, a czat reklamacji kafel z lupą, który przy odmowie milczał.
Od 0.246.0 obie rozmowy rysują `towar/Zalacznik.tsx`: zdjęcie w linii,
kliknięcie powiększa, nazwa pliku pod spodem jest pobraniem, a pod nazwą stoi
zdanie odmowy z „Spróbuj ponownie" albo błąd pobrania. Powłoka nie woła haka
obrazu — hak zależy od źródła, więc woła go cienkie opakowanie w `Os.tsx`
i w `Czat.tsx`, tak jak `Kafel` przy kartotece.

**Autoodpowiedź biura jest zwinięta i oznaczona (0.218.0).** Skrzynka odbija
przychodzący list potwierdzeniem „Dziękujemy za kontakt": kilkanaście wierszy
z godzinami pracy, po polsku i po angielsku, zero zdań o sprawie klienta.
Rozwinięte na osi spycha pytanie poniżej krawędzi okna.

Zwijamy, a NIE kasujemy. Autoodpowiedź jest faktem w rozmowie — dowodzi, że
list dotarł, i tłumaczy klientowi kontakt bez treści; ukryta kazałaby przy
sporze szukać prawdy poza panelem. Rozpoznajemy ją po zdaniu, które sama o
sobie mówi („ta wiadomość jest generowana automatycznie", w obu językach),
i wyłącznie przy wiadomościach WYCHODZĄCYCH: klient odpisujący z cytatem
naszego potwierdzenia niesie ten sam podpis, a jego wiadomość jest pytaniem.

**Podpis wiadomości klienta to jego LOGIN (0.219.2).** Do 0.219.1 podpis brał
temat wątku (`conversation.subject`). Na koncie właściciela temat bywa równy
loginowi, więc ekran wyglądał poprawnie — i właśnie dlatego było groźnie: przy
wątku o temacie „Zaworek zwrotny" wiadomość klienta podpisywała się nazwą
części, a nie tym, kto ją napisał.

Login stoi w `allegro_inbox_thread.interlocutor_login`, złączonym po
identyfikatorze wątku — to samo źródło, z którego czyta zakładka KLIENT.
Gdy wątek nie niesie rozmówcy, podpis schodzi na temat, a potem na słowo
„Klient": wątek bez rozmówcy istnieje i ekran nie ma prawa udawać, że wie
więcej.

**Stopka firmowa zwinięta pod odpowiedzią (0.219.1).** Każda nasza wiadomość
kończy się blokiem: nazwa spółki, adres, NIP, KRS, REGON, telefon. Siedem
wierszy, w każdej wiadomości te same. Przy trzech odpowiedziach w wątku stopka
zajmowała na osi więcej miejsca niż wszystko, co naprawdę napisaliśmy.

Cięcie zaczyna się na NAZWIE SPÓŁKI i bierze ostatnie jej wystąpienie: agent
bywa, że wymienia firmę w zdaniu, a cięcie od pierwszego trafienia zjadłoby
połowę odpowiedzi. Podpis człowieka („Z poważaniem, Mateusz") zostaje w treści,
bo mówi, z kim klient rozmawiał, i przy sporze jest tym, czego się szuka.
Reguła obowiązuje wyłącznie wiadomości wychodzące — z tego samego powodu, co
przy autoodpowiedzi.

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

**Rozmowa:** `new`, `open`, `waiting_for_customer`, `waiting_for_us`,
`waiting_for_internal`, `snoozed`, `resolved`, `closed`, `spam`.

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
tickera. Rozmowa po minionym terminie wraca jako żywa i niesie znacznik
„po terminie", bo inaczej niczym nie różniłaby się od świeżo otwartej.

### 7.2. Kto ma następny ruch — WYLICZANE, nie klikane (0.225.0)

Właściciel: „w większości nie powinienem był robić tego ręcznie — otwarta,
czeka na klienta, czeka na nas powinno być odczytywane z wiadomości". Miał
rację: kto ma następny ruch, widać po ostatniej wiadomości. Ustawianie tego
z ręki było przepisywaniem faktu, który już stoi w wątku, a jedynym możliwym
wynikiem takiej pracy jest pomyłka.

Cztery stany — `new`, `open`, `waiting_for_customer`, `waiting_for_us` —
liczą się przy ODCZYCIE z kierunku ostatniej wiadomości. Ostatnia od klienta
znaczy `waiting_for_us`, ostatnia nasza znaczy `waiting_for_customer`. Wątek
bez ani jednej wiadomości zostaje przy stanie zapisanym: nie ma z czego
wywieść ruchu, a ekran nie zgaduje.

Regułę trzyma `statusZKierunku` w `services/conversations.ts` i wołają ją dwa
miejsca: `statusRozmowy` przy jednej rozmowie i `naRozmowe` przy całej liście.
Druga kopia rozjechałaby się przy pierwszej poprawce, a objawem byłaby kolejka
mówiąca co innego niż rozmowa po kliknięciu.

**AUTOODPOWIEDŹ NIE JEST NASZYM RUCHEM (0.227.0).** Odbicie „Dziękujemy za
kontakt" wychodzi samo, w sekundę po pytaniu, i nie odpowiada na nic. Liczone
jako nasza wiadomość przestawiało rozmowę na „czeka na klienta" i zdejmowało ją
z listy tych, które czekają na odpowiedź — pytanie ginęło przez to, że skrzynka
grzecznie potwierdziła jego odbiór. Ten sam błąd zerował licznik dopisków
klienta w wierszu kolejki.

Znacznik liczy się RAZ, przy zapisie wiadomości (`message.auto_odpowiedz`),
przez `czyAutoresponder`. Odczyt go tylko czyta, a SQL nie powtarza reguły —
dwie kopie rozjechałyby się przy pierwszej poprawce. Migracja wypełnia kolumnę
wstecz i mówi w dzienniku, ile wiadomości oznaczyła.

**TO WYDANIE BYŁO PUSTE PRZEZ SIEDEM MIESIĘCY (sprostowanie z 0.257.0).**
Znacznik ustawiał wyłącznie `zapiszWiadomosc`, a synchronizator skrzynki tej
funkcji nie woła i nigdy nie wołał — ma własną wstawkę, z kolumnami powiązań.
Wiersz wchodził więc bez `auto_odpowiedz`, czyli z `DEFAULT 0`, i flagę
dosypywała dopiero migracja przy najbliższym starcie procesu. Między
restartami usterka z 0.227.0 działała dokładnie tak, jak przed poprawką.
Regułę trzyma teraz `flagaAutoodpowiedzi` w `conversations.ts` — jedna funkcja
z kierunkiem w środku, wołana przez obie drogi zapisu.

**PASEK O NOWEJ WIADOMOŚCI TYLKO PRZY KLIENCIE (0.228.0).** Panel zapalał go
na każde zdarzenie `message.created` — także na naszą odpowiedź wracającą
z synchronizacji i na autoodpowiedź. Agent odpisywał i po chwili dostawał od
panelu wiadomość, że odpisał mu klient. Zdarzenie niesie odtąd kierunek
i znacznik odbicia; nasze wiadomości dociągają rozmowę po cichu, bez alarmu.

**TEN PASEK NIE ZAPALIŁ SIĘ ANI RAZU (sprostowanie z 0.257.0).** Ta sama
przyczyna, co wyżej. Panel zapala go wyłącznie przy `odKlienta` w zdarzeniu,
a pole ustawiał tylko `zapiszWiadomosc`. Synchronizator publikował
`message.created` z samymi identyfikatorami, więc warunek był fałszywy dla
KAŻDEJ prawdziwej wiadomości z Allegro i zostawało ciche odświeżenie rozmowy.
Wydanie 0.228.0 zawęziło alarm, którego nie było. Od 0.257.0 zdarzenie
z synchronizatora niesie `odKlienta` i `automatyczna`, liczone z tej samej
flagi `isInterlocutor`, która wyznacza kierunek wiadomości.

**Werdykty człowieka przebijają wyliczenie.** `snoozed`, `resolved`, `closed`
i `spam` zostają, choćby ostatnia wiadomość była klienta — inaczej nie dałoby
się domknąć żadnej sprawy. Przebija je także `waiting_for_internal`: nie
wynika z wiadomości, tylko ze zlecenia pomiaru, i zdejmuje go dopiero wynik
z hali.

**NOWA WIADOMOŚĆ BUDZI TEŻ ZAMKNIĘTĄ (0.257.0).** Do 0.256.0 `closed` i `spam`
stały poza zbiorem `BUDZONE`, z argumentem, że werdykt cofnięty automatem
kazałby zamykać tę samą rozmowę w kółko. Argument mylił dwa koszty. Ponowne
zamknięcie to jedno kliknięcie. Przepadłe pytanie klienta to sprawa, o której
nikt się nie dowie: rozmowa wypadała ze wszystkich kubełków roboczych i stała
już tylko w „Wszystkie", gdzie się nie pracuje. Klient, który pisze dalej,
mówi wprost, że sprawa nie jest skończona.

**„Zamknięta" wraca do puli, „Rozwiązana" do prowadzącego.** Obudzenie
z `closed` zdejmuje `assigned_user_id`, więc rozmowa ląduje w kubełku
„Nieprzypisane" i bierze ją, kto wolny. To jedyna rzecz, którą oba werdykty
się różnią, i dlatego oba mają dalej sens: „Rozwiązana" znaczy „załatwiłem,
wraca do mnie", „Zamknięta" — „skończyłem z tym, bierze kto inny". Wiersz
w `conversation_assignment` się przy tym ZAMYKA, a nie znika, a `version`
rośnie, bo ekran sprzed zwolnienia przestał być świeży.

`spam` zostaje jedynym werdyktem, którego nic nie cofa. To po niego sięga się,
gdy ktoś zasypuje skrzynkę; gdyby wracał, biuro nie miałoby czym uciszyć
natręta.

**Trasa przyjmuje TYLKO statusy ręczne** (`STATUSY_RECZNE`): cztery werdykty
plus `open` jako droga powrotna, znacząca „oddaj sterowanie rozmowie". Bez tej
piątej pozycji werdykt „Rozwiązana" trzymałby rozmowę, dopóki klient sam nie
napisze, a pomyłki nie dałoby się cofnąć. Bramka stoi na trasie, a nie
w serwisie, bo `ustawStatus` wołają też zdarzenia po naszej stronie i te mają
prawo pisać stan wprost.

**AUDYT MÓWI O KOLUMNIE, nie o wyliczeniu.** Zmiany statusu porównują wartość
zapisaną (`statusZapisany`), inaczej zdjęcie werdyktu zapisałoby w dzienniku
przejście „czeka na klienta → otwarta", którego nikt nie zrobił.

`waiting_for_internal` nazywa się na ekranie **„Czeka na halę"**, nie „Czeka
na nas". Stara etykieta kłamała o tym, na co rozmowa czeka, i stała w menu
obok „Otwartej" jak coś do wybrania ręką.

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

Przyrost trzeci etapu F (§14.7) tego statusu NIE użył i nie użyje. Rozpoznanie
danych jest propozycją w wierszu szkicu, a nie stanem doboru: dobór dostaje
wartości dopiero na kliknięcie agenta, drogą zwykłego zapisu, więc przechodzi
z `not_started` wprost do `searching`. Status stoi w `CHECK` jako rezerwa.

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

**Odpowiedź OZNACZA WĄTEK JAKO PRZECZYTANY w Allegro (0.195.0).** Do 0.194.1
tego kroku nie było wcale, więc wątek załatwiony w panelu zostawał
nieprzeczytany w Centrum Wiadomości. Im lepiej działał panel, tym bardziej
kłamał licznik po tamtej stronie.

Znacznik idzie PO wysyłce i tylko po udanej. Nie idzie przy otwarciu rozmowy:
„zero zapisu przy patrzeniu" obowiązuje także zapisy do cudzego systemu,
a przeczytana ma znaczyć „odpisaliśmy", nie „ktoś zajrzał". Odmowa oznaczenia
nie wywraca wysyłki — wiadomość jest już u klienta, więc porażka idzie do
audytu i tam zostaje.

**Odpowiedź może nieść ZAŁĄCZNIKI (0.195.0).** Przy pytaniach o części zdjęcie
bywa całą odpowiedzią. Plik idzie do Allegro przy DODANIU, nie przy wysyłce:
odmowę typu albo rozmiaru agent ma zobaczyć wtedy, gdy jeszcze da się wybrać
inny. Identyfikatory wchodzą do klucza idempotencji — bez tego „ten sam tekst
z innym zdjęciem" trafiałby na strażnika dubletu, a zdjęcie po cichu nie
poszłoby do klienta.

Załączniki wiszą przy ROZMOWIE, nie w przeglądarce, bo szkic jest
współdzielony z zespołem (§6.4). Po udanej wysyłce znikają razem ze szkicem;
po nieudanej zostają.

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
│ Nieprzypisane   │ Klient                    │ Oferta i towar       │
│ Moje            │ Agent                     │   oferta Allegro     │
│ Oczekujące      │ Komentarze                │   towar z Subiekta   │
│ Po terminie     │ Zadania i wyniki          │   opis kartoteki     │
│                 │                           │ Dobór części         │
│                 │                           │ Klient               │
│                 │                           │ Wiedza               │
└─────────────────┴───────────────────────────┴──────────────────────┘
```

**Ekran mieści się w OKNIE, a przewijają się kolumny (0.165.0).** Do 0.164.0
przewijał się dokument, czyli wszystkie kolumny naraz: żeby dojść do dołu
dowodów przy zwrocie, operator zjeżdżał z oczu kolejce i paskowi decyzji.
Makieta `docs/projekt-widokow/Main.dc.html` rysowała to poprawnie od początku.

**Rama stała na jednej jednostce i to ją przewróciło (0.233.0).** Wysokość
okna trzymało samo `lg:h-dvh`. Przeglądarka, która nie zna `dvh`, nie ignoruje
jej po kawałku — wyrzuca całą deklarację. `lg:min-h-0` skasowało już wtedy
`min-h-screen`, więc ramie nie zostawał ŻADEN limit: przewijał się cały
dokument razem z nagłówkiem, dokładnie jak przed 0.165.0.

Wyglądało to na zepsuty układ, a nie na brak obsługi jednostki, bo kolumny
dalej stały obok siebie — `lg:grid-cols` liczy w pikselach i działa wszędzie.
Zgłoszenie właściciela: „dlaczego mogę przesunąć w dół". Zmierzone na żywej
przeglądarce: bez `dvh` dokument rósł o 182 px.

0.233.0 dołożyło do tego zapas `100vh` pod `@supports` — i **to nie zamknęło
usterki**. Właściciel wrócił z nagraniem: „nadal mogę swobodnie przesuwać".

**Rama nie używa już żadnej jednostki okna (0.236.0).** `vh` mierzy okno
UKŁADU, a ono bywa wyższe niż okno WIDOCZNE — dokładnie ten przypadek wymienia
komentarz z 0.165.0 jako powód, dla którego wybrano wtedy `dvh`. Zapas z
0.233.0 był więc drugim zakładem o to, co przeglądarka rozumie i jak liczy,
zamiast wyjściem z zakładu.

`position: fixed` z `inset: 0` zakładem nie jest: to definicja kadru
widocznego, znana każdej przeglądarce od kilkunastu lat, wolna od różnicy
między oknem układu a oknem widocznym i od pytania, czy jednostka jest
obsługiwana. `lg:min-h-0` musi ZOSTAĆ — bez niego `min-h-screen`, czyli
`min-height: 100vh`, wpuściłoby `vh` z powrotem tylnymi drzwiami.

Modale (`fixed inset-0`) pozycjonują się teraz względem ramy, nie względem
okna. Zmierzone, nie założone: przy oknie 1918×966 modal wypada `1918×966`
w punkcie `0,0`, a jego treść na środku — czyli bez różnicy na ekranie.

Pilnują tego dwa testy o rozdzielonych rolach. `panel/e2e/dym.spec.ts` mierzy
niezmiennik pikselowy w prawdziwej przeglądarce: wstawia do ramy 5000 px
treści i sprawdza, że dokument dalej się nie przewija. `panel/src/RamaOkna.test.ts`
pilnuje, żeby JSX nie wrócił do klasy Tailwinda z jednostką i żeby nie zniknęło
`lg:min-h-0`.

Warto zapisać, dlaczego pierwsza poprawka przeszła wszystkie bramki i nie
pomogła: dopóki rama stała na jednostce okna, żaden test w Chromium nie mógł
jej podważyć — Chromium zna `dvh` i `vh` i liczy je równo z oknem widocznym.
Niezmiennik „rama równa się kadrowi" da się sprawdzić wszędzie; „jednostka
znaczy to samo wszędzie" nie dało się sprawdzić nigdzie.

**Nagłówek zawija się, zamiast znikać poza kadrem (0.233.0).** Rama jest
`overflow-hidden`, więc to, co nie mieści się w szerokości, nie dostaje paska
przewijania — przestaje istnieć dla myszy. Pasek potrzebuje 1112 px, więc
poniżej ~1150 px zębatka ustawień i wylogowanie leżały poza oknem i nie dało
się w nie kliknąć. Żadnego sygnału o tym na ekranie nie było.

`flex-wrap` kosztuje drugi rząd na wąskim oknie (117 px zamiast 65 px) i to
jest cena świadoma: rząd zabiera kilkadziesiąt pikseli, brak wylogowania
zabiera całą funkcję.

**Skrzynka ma trzy kolumny od 0.180.0.** Do 0.179.0 miała dwie, a kontekst —
oferta, towar i zamówienie — leżał w środkowej, nad osią. Cztery bloki jeden
pod drugim spychały pytanie klienta poniżej krawędzi okna, czyli chowały to,
po co agent otwiera rozmowę.

**Kolumna kontekstu ma DWIE zakładki od 0.198.0: „Oferta i towar" oraz
„Dobór".** Wcześniej oferta i towar stały osobno. Zakładka „Oferta" to
jedenaście linijek w kolumnie wysokiej na osiemset pikseli, a zdjęcie, stan,
półka i parametry kartoteki leżały schowane obok. Właściciel przysłał zrzut,
na którym klient pyta o wymiar gwintu, a parametr „Gwint" stoi w niewidocznej
zakładce.

Argument za rozdziałem brzmiał: to dwa równorzędne tematy, więc niech się nie
przewijają nawzajem. Trzyma się on, dopóki obie karty są wysokie. „Dobór"
zostaje osobno, bo to nie karta faktów, tylko robota z własnymi krokami
i przyciskami.

**„Klient" i „Wiedza" WRACAJĄ z makiety (0.216.0)** — decyzja właściciela,
która unieważnia oba powody odmowy z 0.198.0, a nie idzie wbrew nim.

Wiedzy odmawialiśmy, bo dowody stały już w „Doborze", a druga zakładka z tą
samą treścią kazałaby zgadywać, w której szukać. Argument był słuszny, więc
dowody STAMTĄD WYSZŁY: stoją w jednym miejscu, nie w dwóch. Dobór został
robotą, Wiedza jest kartą faktów pod szkic — sięga się po nią także wtedy,
gdy dobór dawno domknięto i nikt nie przewija jego kroków. U góry stoi
klauzula §14.3: twierdzenie bez źródła jest przypuszczeniem. Zdanie ma stać
tam, gdzie agent pisze, a nie tylko w tym dokumencie.

Klientowi odmawialiśmy zdaniem „nie ma bytu". Było prawdziwe o TABELI i
fałszywe o danych: login kupującego wiąże jego zamówienia (`zamowienie_klienta`),
jego rozmowy (`allegro_inbox_thread.interlocutor_login`) i maszyny z domkniętych
doborów (`dobor_rozmowy`). Zakładka jest czystym odczytem i NIE ZAKŁADA ANI
JEDNEJ NOWEJ TABELI — osobny rejestr maszyn trzeba by utrzymywać przy każdej
poprawce doboru, czyli ten sam kształt, który w 0.128.0 kosztował cztery tabele
nakładki spraw.

Maszyna liczy się jako ustalona dopiero z doborem `confirmed`: w trakcie agent
wpisuje markę, zanim cokolwiek ustali. Ta sama maszyna z kilku rozmów zostaje
jedna, z NAJSTARSZĄ — pytanie brzmi „od kiedy to wiemy". Wątek bez loginu mówi,
że nie wiemy, czyja to historia; pusta oś byłaby wtedy kłamstwem o kliencie,
który kupuje u nas od lat.

Po co to biuru: odpowiedź „ten szarpak pasuje" waży inaczej, gdy ten sam klient
kupił go rok temu do tej samej kosiarki. §11.3 nazywa to wprost —
`sprzedaz_weryfikacja` jest rodzajem dowodu.

**Ekran bierze CAŁĄ szerokość okna od 0.198.0.** Wcześniej `<main>` miał
`max-w-[1500px]` i wyśrodkowanie. Ogranicznik przyszedł z makiety i nikt go
nigdy nie uzasadnił. Na monitorze 1920 oddawał 210 pikseli na margines z każdej
strony, na 2560 — po 530, a kolumny stały wąskie mimo wolnego miejsca.

Rosną kolumny SKRAJNE, nie środkowa. W kolejce i w kontekście szerokość zamienia
się w treść: mniej uciętych nazw, więcej wiersza tabeli, szersze zdjęcie.
W środku zamieniłaby się w dłuższą linijkę, a linijka na sto dwadzieścia znaków
czyta się gorzej. Wypowiedzi mają więc własny próg 75 znaków i dosuwają się do
przeciwnych krawędzi: klient do lewej, my do prawej. Strona kolumny mówi, kto
mówi, zanim wzrok dojdzie do podpisu.

Szerokości kolumn stoją w JEDNYM miejscu (`SIATKA_TRZECH_KOLUMN` w `panel/src/ui`).
Do 0.197.4 skrzynka miała kolejkę 22 rem, a zwroty 320 px — rozjazd, którego
nikt nie zdecydował, choć ta sekcja wymienia szerokości wprost.

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

**Treść pytania jest w wierszu PIERWSZA (0.193.0).** Do 0.192.0 najgrubszym
drukiem stał login kupującego, a pytanie leżało pod nim, mniejsze i szare.
Login Allegro nie mówi nic — „Kupujący 44300444" to nie jest osoba, którą się
zna. Triaż robi się po treści, więc login zszedł do podpisu obok czasu.

Nad treścią zostają plakietki, bo odpowiadają na pytanie zadawane PRZED
czytaniem: czy tę rozmowę w ogóle brać. Czas oczekiwania stoi w prawym rogu
tej samej linii — razem z PILNE tworzy jedyną parę sygnałów, po której układa
się kolejność pracy. Nieprzeczytana wiadomość to KROPKA, nie słowo: „NOWE"
obok plakietki „NOWA" mówiło dwa różne fakty jednym wyrazem.

**Obecność ŁATA wiersz, nie ściąga listy (0.196.0).** Zdarzenie obecności —
wejście, wyjście, „pisze" — zmienia w kolejce jedną rzecz: znacznik „ktoś tu
siedzi". Do 0.195.0 robiło to przez ponowne pobranie CAŁEJ listy, a
`listaRozmow()` nie ma `LIMIT`-u. Pomiar na tym repo: 100 rozmów to 54 kB,
1000 — 537 kB, 5000 — 2688 kB. „Pisze" jest dławione co pięć sekund, więc
kolega redagujący odpowiedź ściągał to wszystkim co pięć sekund.

Teraz zdarzenie podmienia pole w cache'u panelu. Reguła „kto trzyma" nie
powstaje w panelu drugi raz: serwer oddaje obecnych posortowanych po czasie
wejścia, a znacznik bierze pierwszego z listy. Pozostałe zdarzenia — nowa
wiadomość, przejęcie, wynik z hali — odświeżają kolejkę tak jak dotąd, bo od
nich zależy, za co agent się bierze.

`staleTime` tego NIE załatwia i to jest zmierzone, nie założone:
`invalidateQueries` znaczy zapytanie stałe niezależnie od niego i odświeża
aktywne obserwacje tak samo.

**Kolejka ma wyszukiwanie (0.195.0).** Kubełek mówi „czyje to", kategoria
„o czym to", a pytania „czy TA rozmowa gdzieś tu jest" nie zadawał nikt, bo
nie było jak. Pole zawęża po loginie, treści ostatniej wiadomości i po
prowadzącym; liczy się w pamięci ekranu, jak kubełki. Pusty wynik cytuje
frazę — literówkę widać dopiero wtedy, gdy się ją zobaczy.

**Oś rozmowy zjeżdża na dół sama (0.260.0).** Serwer oddaje wpisy od
najstarszego, a panel do 0.259.0 nie przewijał osi ani razu: w `panel/src`
nie było ani jednego `scrollTop`. Otwarcie rozmowy dłuższej niż okno stawiało
agenta na jej najstarszej wiadomości. Celem zjazdu jest DÓŁ listy, nie ostatnie
pytanie klienta — skok na pytanie chowałby wszystko, co po nim padło. Przycisk
„Pokaż" pod banerem nowej wiadomości zjeżdża osobnym licznikiem, bo sam nowy
wpis dogania wyłącznie agenta, który i tak stał na dole.

**Pytanie klienta przypina się nad edytorem, ale tylko poza kadrem (0.260.0).**
W kolumnie rozmowy przewija się jedynie oś; nagłówek, pasek zdarzeń i edytor
stoją. Pasek (`skrzynka/PrzypietePytanie.tsx`) pokazuje ostatnią wypowiedź
KLIENTA przyciętą do dwóch wierszy. Wchodzi wyłącznie wtedy, gdy tamta
wypowiedź wypadła z kadru: widoczny zawsze dublowałby zdanie o krok wyżej,
a warunkowy sam niesie treść „odjechałeś od pytania". Decyduje o tym
`IntersectionObserver`, którego jsdom nie ma — atrapa stoi
w `panel/src/test/kadr.ts` i nie udaje układu.

**Notatka wewnętrzna nazywa się notatką (0.260.0).** Edytor mówił „Komentarz
wewnętrzny" i „Dodaj komentarz", a oś rozmowy w tym samym oknie — „NOTATKA
WEWNĘTRZNA". Reklamacje i dyskusje mają `notatka` w API od dawna. Decyzja
właściciela: notatka. Nazwy w kodzie zostają, bo ekran ich nie pokazuje.

**Drabina typograficzna ma cztery szczeble nazwane ROLĄ (0.258.0).**
`text-podpis` 11/16 (metadane, plakietka), `text-tresc` 15/22 (to, co się
czyta), `text-naglowek` 17/24 (nagłówek karty i sekcji), `text-tytul` 24/30
(tytuł ekranu). Wybiera się rolę, nie rozmiar. Para z interlinią jest
obowiązkowa: arbitralne `text-[NNpx]` nie mają w Tailwindzie domyślnej
interlinii i dziedziczą 1,5 z przeglądarki.

**Poza drabiną zostają dwie rzeczy i to są decyzje (0.258.0).** `text-xs`
to szczebel KONTROLKI — przycisku, chipa, komunikatu przy polu — bo tam 12 px
jest właściwe. Liczby (`text-2xl`, `text-lg`) też zostają: liczba nie jest
tekstem, a jej rozmiar wynika z odległości, z jakiej ma być czytelna.
Nowe arbitralne `text-[NNpx]` bramkuje `panel/src/Skala.test.ts`; zwolnienie
wymaga komentarza `skala: <powód>`.

**Nagłówek sekcji i etykieta wartości to DWIE role (0.256.0).** Nagłówek nazywa
blok i jest pogrubiony (`NaglowekSekcji`); etykieta nazywa jedną wartość stojącą
obok i pogrubiona nie jest (`EtykietaWartosci`). Waga to jedyne, co je rozróżnia,
gdy obie są drobne i w wersalikach. Oba mieszkają w `panel/src/ui/index.tsx`
i tam jest jedyne prawowite miejsce na ten łańcuch klas — pilnuje tego
`panel/src/ui/NaglowekSekcji.test.tsx`. Plakietka, etykieta na osi rozmowy
i nagłówek tabeli mają wersaliki, ale są osobnymi rolami.

**Szarość tekstu ma DWA stopnie, bo tło rozstrzyga (0.255.0).** `body` ma
`bg-slate-100`, więc tekst poza kartą siedzi na szarym. Na bieli wystarcza
`slate-500` (4.76:1), na `slate-100` musi być `slate-600` (6.92:1) — tam
`slate-500` daje 4.34:1 przy progu 4.5. `slate-400` nie przechodzi nigdzie
i zostaje wyłącznie na ikonach, które progu dla pisma nie mają. Pilnuje tego
`panel/src/Kontrast.test.ts`; zwolnienie wymaga komentarza `kontrast: <powód>`.

**Bursztyn marki jest TŁEM, nie pismem (0.255.0).** `#F7A600` na bieli daje
2.02:1, a pod ciemnym pismem — 7.10:1. `bg-wertis-amber` zostaje;
`text-wertis-amber` jest zakazane, a ostrzeżenia biorą `ranga-uwaga`.

**Znak Allegro zastępuje wyraz w odnośnikach (0.252.0).** Cztery odnośniki
„Otwórz w Allegro" dostają znak słowny marki. Zastępuje on wyraz, bo jest
napisem — obok tego wyrazu byłby jego powtórzeniem. Nazwę dla czytnika ekranu
niesie `aria-label` na kotwicy. Ścieżka pochodzi z pakietu `simple-icons`
w wersji 16.30.0 i jest materiałem cudzym: nie rysujemy jej z pamięci i nie
poprawiamy. Jest wklejona, bo hotlink do serwerów Allegro jest tu zakazany
od 0.210.0.

**Plakietka należy się WYJĄTKOWI, nie normie (0.251.0).** Wiersz zaczynał się od
plakietki statusu, a w kubełkach roboczych status jest praktycznie stały. „CZEKA
NA NAS" stało w każdym wierszu z rzędu, czyli emfaza szła na słowo, które niczego
nie rozróżnia. Górny rząd pojawia się teraz tylko przy fladze „pilne" albo przy
statusie, którego z reszty wiersza odczytać się nie da. Status bez plakietki
schodzi do podpisu — §4.3 pozwala fakt wyciszyć, nie pozwala go schować.

**Zegar mierzy NASZ dług, nie wiek rozmowy (0.251.0).** `czekaOdMs` liczy się od
ostatniej wiadomości klienta, więc po naszej odpowiedzi dalej rośnie. Wiersz
pisał „czeka 15 g" o rozmowie, w której piłka jest po drugiej stronie. Zegar
chodzi teraz tylko przy statusach naszego ruchu. Data ostatniej wiadomości
ustępuje mu miejsca, bo przy „czeka na nas" oba znaczniki opisują tę samą
wiadomość. Gdy zegara nie ma, data wraca.

**Stan spoczynku Copilota nie dostaje pasma (0.251.0).** Wyłączony Copilot i
rozpoznany kubełek zajmowały po pełnym paśmie, żeby donieść o braku roboty.
Oba fakty niesie teraz znak w nagłówku kolejki, w podpowiedzi i w `aria-label`.
Pasmo wraca, gdy jest co rozpoznać, gdy partia trwa i gdy ma wynik.

**Data synchronizacji jest podpisem, nie pasmem (0.193.0).** Pasm sterujących
nad listą było pięć i zjadały ćwierć wysokości kolumny. Tę samą datę niesie
pigułka w pasku górnym, na każdym ekranie panelu.

**Fragment to ostatnia wiadomość KLIENTA, z jej datą (0.167.0).** Do 0.165.0
wiersz brał ostatnią wiadomość jakąkolwiek, więc autoodpowiedź konta Allegro
zasłaniała pytanie, a data pod nią była datą wątku. Gdy klient nic nie napisał,
stoi nasza wiadomość z podpisem „Biuro". Kolejność listy dalej niesie datę
wątku — tę samą, którą właściciel widzi w panelu sprzedawcy.

**Kolejność jest przełącznikiem (0.215.0).** Domyślna zostaje: PILNE, potem
najdłużej czekające pytanie. Drugi porządek, „od najnowszych", odpowiada na
inne pytanie — „co właśnie przyszło" — tym samym wzorem, co data nadania przy
zwrotach. PILNE zostaje na górze w obu porządkach, bo flaga ręczna przebija
automat. Wybór pamięta przeglądarka stanowiska, nie serwer: kolejność to nawyk
człowieka przy biurku, a nie fakt o rozmowie.

### 10.3. Oś rozmowy

Oś zawiera wiadomości klienta, odpowiedzi firmy, komentarze wewnętrzne, zmiany
przypisania, zmianę statusu, utworzenie zadania, przejęcie przez magazyniera,
wynik magazyniera oraz przygotowanie i wysłanie odpowiedzi. Każdy rodzaj
zdarzenia wygląda inaczej.

**„Wygląda inaczej" znaczy CZTERY CECHY (0.193.0).** Makieta rozróżnia karty
tłem, ramką, ikoną i wcięciem, a do tego podpisuje rodzaj: „Klient · Allegro",
„Odpowiedź firmy". Front do 0.192.0 miał jedną cechę z czterech — tło #ffffff
kontra #f8fafc przy tej samej ramce. Różnica niewidoczna na ekranie.

Wychodziło z tego, że najwyraźniejszym wpisem osi była notatka wewnętrzna,
czyli rzecz, której klient nie zobaczy. Najsłabszym — podział „kto to
powiedział". Wcięcia idą z makiety: klient odsunięty od prawej, firma od lewej.

**Wpis niesie godzinę.** Pole `at` jechało w kontrakcie od początku, a oś go
nie pokazywała. Bez godziny nie widać, czy między pytaniem a odpowiedzią
minęła minuta, czy trzy dni.

### 10.3b. Zdarzenia sprawy zeszły z osi do paska (0.243.0)

Zgłoszenie właściciela: przenieść wszystkie zmiany statusu do jednego rzędu
pod oknem wiadomości, jak oś czasu, a kliknięcie ma prowadzić do tego miejsca
w rozmowie.

Do 0.242.0 zmiana statusu, sklejenie sprawy i każdy krok doboru stały między
wypowiedziami jako kreski. Przy jednym zdarzeniu to jest znak, że sprawa
przeszła dalej; przy dziewięciu — ściana szarego tekstu, przez którą trzeba
się przewinąć do zdania klienta. Na zrzucie od właściciela dwa takie bloki
zajmują więcej miejsca niż obie wypowiedzi razem.

**Oś zostaje ROZMOWĄ, pasek zostaje PRZEBIEGIEM.** To dwa różne pytania: „co
klient napisał" i „jak sprawa szła". Pierwsze czyta się po kolei, drugie ogarnia
jednym spojrzeniem — dlatego jedno jest kolumną, a drugie rzędem.

**Kliknięcie wraca na oś**, bo inaczej rozdzielenie gubiłoby to, co kreska
niosła najlepiej: MIEJSCE, w którym stan się zmienił. Celem skoku jest pierwsza
wypowiedź PO zdarzeniu; gdy zdarzenie jest ostatnie, celem zostaje ostatnia
wypowiedź przed nim, bo przycisk bez skutku jest gorszy niż brak przycisku.
Podświetlenie celu GAŚNIE po chwili — trwałe byłoby stanem, którego nikt nie
zdejmuje.

**Chip niesie stan DOCELOWY, nie przejście, a rodzaj niesie barwa.** Pierwsza
wersja pokazywała pełne zdanie z osi i to była pomyłka zmierzona, nie
przeczuta: dziewięć zdarzeń dało 1343 px nadmiaru w poziomie przy kolumnie na
680 px, czyli widać było trzy z dziewięciu. Po skróceniu — 471 px i sześć
z dziewięciu. Stan poprzedni stoi w chipie obok, po lewej; prefiks „dobór: "
kosztował siedem znaków na każdym chipie i mówił to samo co kolor.

**Serwis podaje zdarzenie ROZŁOŻONE NA KLUCZE** (`zdarzenie` obok `tresc`),
a polszczyznę składa panel ze słownika w `skrzynka/statusy.ts`. Panel nie ma
prawa rozbierać `tresc`: to jest zdanie dla człowieka, nie format danych.
`tresc` zostaje nietknięta, bo niesie ją podpowiedź chipa razem z autorem
i godziną — dane do sprawdzenia, nie do przeglądania.

### 10.3a. Zlecenie dla hali jako blok osi (0.226.0)

Akapit wyżej wymienia „utworzenie zadania" wśród zdarzeń osi od pierwszego
wydania tego dokumentu. Front nigdy tego nie robił. Oś pokazywała sam WYNIK
z magazynu; prośba, która go wywołała, nie zostawiała po sobie nic. Zgłoszenie
właściciela: „zlecenie zmierzenia też powinno zostać pokazane jako blok
w wiadomości".

**Zlecenie i wynik to DWA wpisy, nie jeden.** To dwa momenty i dwie osoby.
Sklejenie ich w jeden kafelek kłamałoby o czasie: oś jest chronologiczna,
a między prośbą a odpowiedzią hali mija godzina albo dzień. Zlecenie stoi
pod swoim `utworzono_at`, wynik pod swoim.

**Widać je w KAŻDYM stanie, nie tylko po wykonaniu.** Zlecenie bez wyniku to
najważniejszy przypadek: rozmowa czeka na halę i agent musi wiedzieć, że czeka.
Gdyby blok pojawiał się dopiero z wynikiem, jedyny stan wymagający decyzji
byłby niewidoczny.

**Barwa niesie stan.** Bursztyn znaczy „czekamy", zieleń wyniku „przyszło".
Zlecenie wykonane albo anulowane gaśnie do szarości — jego rola się skończyła,
a odpowiedź stoi niżej i to ona ma przyciągać wzrok.

**Godzina stoi przy zleceniu, choć wynik jej nie ma.** Wynik jest ostatnim, co
się wydarzyło. Otwarte zlecenie ma WIEK, a „czeka na halę" od dziesięciu minut
i od wczoraj to dwie różne decyzje wobec klienta.

**Ikona idzie z rodzaju zadania**: miarka, aparat, lupa, notes. Rozmowa bywa
długa i agent przewija ją wzrokiem. Jeden kształt dla czterech próśb kazałby
czytać nagłówek, żeby odróżnić pomiar od zdjęcia.

Blok niesie tytuł, instrukcję słowo w słowo, kafel kartoteki (§25a.6a), znacznik
`pilne` i podpis magazyniera, który zadanie przejął. Instrukcja jest dosłowna,
bo po niej widać, czy wynik odpowiada na zadane pytanie. Blok NIE ma przycisku
„wstaw do szkicu" — do szkicu wstawia się wynik, nie prośbę o niego.

### 10.3c. Kolumna kontekstu (0.249.0)

Kolumna odpowiada na jedno pytanie: **czy mamy to na półce i gdzie**. Odpowiedź
— `Dostępny` i `Lokalizacja` — leżała w ośmiowierszowej tabeli 12 px, w tej
samej wadze co `Identyfikatory brak`. Jedno jest decyzją, drugie zapasową
ścieżką wyszukiwania.

**Dostępny jest liczbą, nie wierszem tabeli.** Rozstrzyga, czy odpowiedź brzmi
„wysyłamy dziś", więc ma być widoczny z drugiego końca biurka. Lokalizacja
stoi obok jako plakietka — to jedyna wartość z tej grupy, którą ktoś przepisuje
na kartkę i niesie na halę. Stan i rezerwacje schodzą pod spód drobnym drukiem:
one tę liczbę TŁUMACZĄ, nie zastępują. Reszta zostaje w całości, bo §4.3 nie
pozwala chować faktów, ale wartości „brak" gasną — brak identyfikatorów jest
normą, a norma nie ma prawa wyglądać jak ustalenie.

**Trzy nagłówki tej samej rangi mają jeden kształt.** „Oferta" i „Zamówienie"
były `<b>` w 14 px przy ikonie 15 px, „Źródło: Subiekt GT" — plakietką
z obwódką. Nagłówek CICHNIE do etykiety zamiast rosnąć: treścią sekcji jest
nazwa towaru i to ona ma być w niej najgłośniejsza. Wspólny kształt niesie
`NaglowekSekcji` w `ui/index.tsx`.

**Dwa odnośniki „Otwórz w Allegro" przestały być jedynym błękitem w kolumnie.**
Ciągnęły wzrok mocniej niż nazwa towaru, a to nawigacja, nie treść. UUID
zamówienia jest skrócony do ośmiu znaków — całość zostaje w podpowiedzi
i pod przyciskiem kopiowania.

**Podpis źródeł zdjęć mieści się w jednej linii**, nadal nazywając oba źródła.
§4.3 żąda, żeby przy każdym fakcie było widać źródło — nie żąda zdania
złożonego. Dwa wiersze szarej prozy ważyły więcej niż sama pozycja zamówienia.

### 10.4. Edytor odpowiedzi

**Rzędy edytora (0.249.0).** Właściciel: „niepotrzebnie ułóż odpowiedź i add
attachment mają swój własny rząd". Miał rację — dwa rzędy szły na pomoc przy
pisaniu i na czynność od święta. Copilot wraca do rzędu przełącznika trybu,
spinacz do rzędu działań: pięć rzędów schodzi do trzech.

0.247.0 próbowało już przenieść Copilota i **zostało wycofane**, bo z Copilotem
wyłączonym komponent renderuje zdanie z serwera, nie przycisk, i łamało rząd
na dwa wiersze. Wycofanie leczyło objaw. Przyczyną było to, że jeden komponent
zwracał raz przycisk, raz akapit, więc wołający nie miał jak wiedzieć, ile
miejsca zajmie. Teraz `PrzyciskSzkicu` nie zajmuje nigdy więcej niż jednej
linii — zdanie się ucina, a całość zostaje w podpowiedzi.

Spinacz wymagał rozdzielenia `ZalacznikiWysylki` na dwa komponenty: przycisk
z ukrytym polem pliku (należy do rzędu działań) i listę dołożonych plików
(należy do komponowanej wiadomości). Do 0.248.0 stały razem, więc przycisk
ciągnął listę ze sobą i musiał zająć własny rząd.

Zmierzone: edytor 288 → 222 px, oś rozmowy 247 → 313 px. **66 px dla rozmowy.**

**Hierarchia panelu odpowiedzi (0.247.0).** Właściciel: „improve answering
question panel in terms of visual hierarchy, get some principles from
Refactoring UI". Panel niósł wszystko w dwóch stopniach pisma (12 i 14 px)
i pięciu obramowanych przyciskach o równej wadze — żadna rzecz nie była
pierwsza, więc oko zaczynało od lewego górnego rogu, nie od tego, co ważne.
Poniżej to, co zmieniono, i zasada, która za tym stoi. Żadna nie dokłada
funkcji: każda zmienia wagę tego, co już było.

**Login jest tematem ekranu.** Rośnie do 19 px i ciemnieje do `wertis-ink`;
„Twoja rozmowa" schodzi do drugiego wiersza w 12 px. Skala urosła z dwóch
stopni do czterech. Przejęcie ZOSTAJE przyciskiem w pierwszym wierszu — przy
rozmowie niczyjej to jest działanie główne ekranu, nie metadana.

**Pytanie klienta jest jedyną kartą z cieniem.** Wypowiedzi różniły się tłem
`#ffffff` kontra `#f8fafc` przy identycznej obwódce — różnica na granicy
widoczności, choć to rozróżnienie jest jedynym powodem, dla którego oś ma dwie
strony. Nie dało się rozjaśnić pytania (jest już białe), więc COFA SIĘ nasza
odpowiedź: traci obwódkę, tekst schodzi na szarość.

**Jedno działanie jest najgłośniejsze.** Wysyłka to jedyna droga, którą treść
wychodzi z WERTIS na zewnątrz, a wyglądała jak sąsiad „ZAPISZ SZKIC" — ta sama
wysokość, waga i krój. Dostaje większy stopień pisma, wyższy padding i cień;
zapis szkicu schodzi do zwykłego tekstu. Wersaliki znikają: „WYŚLIJ DO KLIENTA"
to ciąg prostokątów bez wydźwięku liter wystających nad linię.

**Trzy przyciski przestają być przyciskami.** „Przypisz do sprawy" to odnośnik
w wierszu metadanych, „zapisz szkic" — tekst, „dołącz plik" — spinacz 34 × 34
z nazwą w `aria-label` i ograniczeniem formatu w podpowiedzi. Zdanie „Rozmowa
nie należy do żadnej sprawy" zajmowało pełny pas, żeby powiedzieć, czego NIE MA;
brak sprawy jest stanem domyślnym, więc ekran informował o normie.

**Przełącznik trybu jest JEDNYM elementem.** Dwa luźne przyciski o równej wadze
nie mówiły, że wybiera się jeden z dwóch. Bieżnia z wyniesionym kafelkiem
aktywnym to kształt znany z każdego innego programu, więc nie wymaga czytania.

**Pole ma wyglądać na miejsce do pisania**: 80 → 88 px, tekst 14 → 15 px.
Załączniki przenoszą się NAD rząd działań — należą do komponowanej wiadomości,
a rząd działań ma być ostatni, żeby wzrok kończył na wysyłce.

Zmierzone na żywym panelu: nagłówek, pasy i edytor zajmowały 554 px, teraz 532 px
— rozmowa zyskuje 22 px MIMO większego pola do pisania. Oszczędność z pasa
sprawy i rzędu załączników poszła w znacznej części w to pole, i tak miało być.

Jedna próba została WYCOFANA w trakcie: przeniesienie przycisku Copilota do
rzędu przełącznika wyglądało dobrze z Copilotem włączonym i rozpadało się
z wyłączonym, bo wtedy komponent renderuje zdanie z serwera, nie przycisk.

**Rozdzielenie trybów (0.157.0).** Przełącznik ma dwa tryby i każdy ma WŁASNE
pole oraz własny przycisk. W trybie komentarza przycisk wysyłki nie istnieje
w drzewie — wyłączony da się kliknąć, gdy stan rozjedzie się o ułamek sekundy;
nieistniejącego nie da się nigdy. Osobne pola znaczą też, że przełączenie
trybu nie przenosi notatki do szkicu, który idzie do klienta.

**Załączniki tylko w trybie odpowiedzi (0.195.0).** Komentarz wewnętrzny
nigdzie nie wychodzi, więc dołączony do niego plik nie miałby dokąd pójść,
a przycisk obok notatki sugerowałby, że ma. Pasek pokazuje nazwę, rozmiar
i autora — szkic jest wspólny, więc plik kolegi ma wyglądać inaczej niż własny.
Przy cudzej rozmowie pasek jest wyłączony, tak samo jak szkic.

Komentowanie NIE wymaga prowadzenia rozmowy: notatka zespołu to nie odpowiedź,
a kolega ma prawo dopisać „to ten sam klient co wczoraj" bez przejmowania
sprawy.

Zwykły tekst, szablony, szkic ze sztucznej inteligencji, licznik znaków,
podgląd, historia wersji, ostrzeżenie o zmianie rozmowy, wstawienie wyniku
magazyniera, wstawienie parametrów produktu i przełączenie na komentarz
wewnętrzny.

**Z tej listy działa w 0.231.0:** licznik znaków, ostrzeżenie o dopisku
klienta, wstawienie wyniku magazyniera, wstawienie zdania doboru ze źródłem,
wstawienie parametrów produktu, przełączenie trybu i szkic ze sztucznej
inteligencji — przycisk „Ułóż odpowiedź" nad polem, opisany w §14.6.

Wstawka parametrów bierze tożsamość towaru i dostępność. NIE bierze półki,
rezerwacji ani rozbicia na magazyny. Szkic czyta klient, a adres regału mówi
obcemu, jak zbudowany jest nasz magazyn.

Nie ma szablonów, podglądu ani historii wersji szkicu.

**Szkic Copilota nie wchodzi do pola sam (0.231.0).** Propozycja stoi w karcie
pod polem, a do szkicu agenta trafia na jedno z dwóch kliknięć. „Wstaw"
dopisuje z nową linią — ten sam kontrakt, co każda wstawka. „Zastąp" jest
jedyną świadomą drogą nadpisania i pojawia się tylko, gdy jest co nadpisać.
„Odrzuć" chowa kartę. Każde z tych kliknięć jest werdyktem liczonym w pomiarze.
W trybie komentarza ani przycisku, ani karty nie ma w drzewie.

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

**Co działa od przyrostu trzeciego etapu F (§14.7).** Copilot rozpoznaje
markę, model, wariant, rocznik, numer seryjny, silnik, numer OEM, nazwę części
i parametry z treści rozmowy — przy tym samym wywołaniu, które układa szkic.
Serwer sprawdza każdą wartość przeciw rozmowie. Zakładka Dobór pokazuje je
kartą „Copilot rozpoznał w rozmowie", a „Wpisz do danych" zapisuje je jednym
kliknięciem w PUSTE pola. Słowo agenta zostaje; różnicę karta tylko nazywa.
Od przyrostu czwartego (§14.8) Copilot rozpoznaje też parę część→część
i agent proponuje ją jednym kliknięciem do kolejki wiedzy. Zdjęcia i OCR
czekają.

### 11.2. Kandydaci

Kolejność wyszukiwania: dokładny symbol, EAN, numer OEM, potwierdzone
zastosowanie, zastosowanie przez silnik, pasowanie do części klienta,
zamiennik, zgodne wymiary, wyszukiwanie pełnotekstowe, wyszukiwanie
semantyczne.

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
`Stare SKU`, a od 0.234.0 także `Zamiennik:`). Numer bez kartoteki nie znika: staje się kandydatem bez wiersza,
bez stanu i bez przycisku Wybierz. Decyzja właściciela: „nie mamy tego" jest
odpowiedzią dla klienta, a puste miejsce na liście nią nie jest. Pełny tekst
to indeks FTS5 `towar_fts` po symbolu, nazwie i opisie, z rankingiem bm25.
Pyta wyłącznie o dane wpisane przez agenta, nigdy o treść wiadomości (blizna
„szarpaka"). Marka i model podnoszą ranking, ale go nie warunkują. Trafienie
po treści ma pewność „wymaga danych" — to podpowiedź, nie dowód. Bez FTS5
w SQLite szczebel jest pominięty z powodem, a karta pokrycia to pokazuje.

**Co działa od 0.241.0: szczebel „zgodne wymiary".** Blizna z 9.09.2026:
klient pytał na ofercie linki do COMBI 48-53 o „linkę napędową 148 cm
zakończoną sprężyną". Katalog MIAŁ tę linkę — 18-11010 i 470002 „Linka
napędu Castel Garden 81000668/1 1170x1480" — a szkic Copilota opisał linkę
z oferty jako „prawdopodobną" i poprosił o tabliczkę. Model zrobił jedyne,
co doktryna pozwala: fakty niosły kartotekę oferty i jej zamienniki, a numeru
spoza faktów nazwać nie wolno. Luka siedziała w szczeblach: żaden nie czytał
parametrów doboru, pełny tekst pyta o słowa, a „148 cm" nigdzie nie stawało
się „1480". Ten szczebel stał w tym zdaniu wyżej od dawna — teraz ma kod.

Wymiary czyta się z tabeli `wymiar_kartoteki`, odbudowanej z NAZW i OPISÓW
kartotek po każdym imporcie (wzór `towar_identyfikator`). Parser jest
deterministyczny: liczba z jednostką („40 cm", „102 MM", „2,5m") i para
„1170x1480"; metry wyłącznie małą literą, bo „1330M" to model Mountfield;
para z trzech cyfr, bo „M12x1,5" to gwint. Milimetry całkowite. Wejście
idzie WYŁĄCZNIE z parametrów doboru wpisanych przez agenta („długość:
148 cm"), nigdy z treści wiadomości (blizna „szarpaka"). Jednostka jest
obowiązkowa — „148" nie mówi, czy to centymetry — a dopasowanie jest
dokładne co do milimetra: tolerancja byłaby zgadywaniem, a szczebel i tak
mówi „wymaga danych". Kandydat cytuje zapis z kartoteki: „zgodny wymiar
1480 mm (długość: 148 cm) w nazwie kartoteki „1170x1480” — nie dowód".
Trzy powody pominięcia, bo trzy różne rzeczy może zrobić agent: wpisać
parametr, dopisać jednostkę, poczekać na odbudowę indeksu. Copilot podaje
wymiary z rozmowy w `daneDoboru` (§14.7); po „Wpisz do danych" szczebel
je czyta. Po wdrożeniu tabelę zakłada start serwera — ostatni wpis audytu
przebudowy bez klucza `wymiary` znaczy, że pochodne są sprzed tego wydania.

**Co działa od wydania 0.229.0: szczebel „przez silnik".** Części ogrodnicze
mają problem dwupoziomowy. Filtr, gaźnik, świeca i linka rozrusznika pasują do
SILNIKA, a kupujący zna wyłącznie model kosiarki. Bez tego szczebla pytanie
„filtr do NAC LS 46-450" nie ma jak trafić na filtr Loncina, choć oba wpisy
leżą w bazie obok siebie. Szczebel stoi zaraz za zastosowaniem do maszyny
i przed ofertą, bo łańcuch ma o jedno ogniwo więcej.

Szczebel idzie WYŁĄCZNIE przez zatwierdzoną zabudowę (§12). Pola
`dobor_rozmowy.silnik` nie czyta: to wolny tekst, a „B&S 450E" nigdy nie
trafi na „Briggs & Stratton 450E". Rozbijanie go na markę i nazwę byłoby tym
samym zgadywaniem, które właściciel odrzucił przy sekcjach „Modele:".
Wpisany tekst służy do czego innego — karmi listę luk na ekranie Silniki
i podpowiedź pod polem w zakładce Dobór.

**Od 0.238.0 most między tekstem a modelem jest LUDZKI: słownik silników**
(§12). Biuro zapisuje, że „B&S 450E" znaczy silnik Briggs & Stratton 450E,
a system dopasowuje tekst dokładnie po zwinięciu pisowni — bez rozbijania
i bez furtki na literówki. Alias nie karmi szczebla: prowadzi tylko do
propozycji zabudowy jednym kliknięciem pod polem „Silnik", z dowodem
`rozmowa` (klient podał silnik), więc z pewnością „prawdopodobne". Rozstrzyga
człowiek w Wiedza → Silniki, dopiero wtedy szczebel rusza.

**Od 0.239.0 szczebel ma paliwo z nazw kartotek: tokeny silników** (§12).
Zabudowa mówi, jaki silnik stoi w maszynie, ale kandydatów daje dopiero
zastosowanie części DO SILNIKA — a tych było tyle, ile biuro wpisało ręcznie.
Tymczasem nazwy kartotek mówią wprost „Gaźnik do silników HONDA GX160".
Biuro wpisuje token „GX160" = Honda GX160, przegląda listę kartotek z tym
słowem w nazwie i jednym kliknięciem zatwierdza zaznaczone. Kandydat z tokenu
ma pewność „potwierdzone", bo dowodem jest decyzja biura, nie ślad rozmowy.

Pominięcie tego szczebla jest produktem, nie porażką: powód pominięcia to
jedyna droga, którą agent dowie się o luce, więc prowadzi o krok dalej.
Tekst bez aliasu: „„Lonci v200" nie ma w słowniku silników, dopisz go
w Wiedza → Silniki". Alias bez pary: „to silnik Loncin V200 wg słownika, ale
nikt nie zatwierdził, że stoi w tej maszynie — zaproponuj zabudowę pod polem
Silnik". Silnik znany, ale bez zastosowań, daje `sprawdzona: true` z zerem
wyników — to dwie różne prawdy.

**Co działa od wydania 0.230.0: szczebel „pasuje do części".** Firma sprzedaje
dużo gaźników, a klient pyta: „czy ta uszczelka pasuje do mojego gaźnika?".
Do 0.229.0 baza nie znała ŻADNEJ relacji część↔część — zastosowanie wiąże
część z modelem, zabudowa model z modelem. Jedyną relacją między kartotekami
był zamiennik, liczony z opisu i jednokierunkowy. Odpowiedź na to pytanie
brał agent z pamięci albo z katalogu na drugim monitorze.

Szczebel czyta zatwierdzone pasowania (§12) do KOTWIC. Kotwica to kartoteka
trafiona w tym przebiegu przez symbol, EAN albo numer OEM wpisany przez agenta,
oraz kartoteka oferty. Nigdy treść wiadomości — blizna „szarpaka". Bez
kotwicy szczebel jest pominięty z powodem „agent nie wpisał symbolu ani
numeru, a rozmowa nie ma kartoteki oferty". Kotwica bez pasowań daje
`sprawdzona: true` z zerem. Wyników nie filtruje się po nazwie części: gaźnik
ma trzy uszczelki, membranę i zestaw naprawczy, a agent czyta nazwy sam.

Szczebel stoi PRZED ofertą, choć dziś oferta bije zastosowanie. Powód to
scenariusz odwrotny: oferta jest uszczelką, klient pyta „pasuje do W09-0211?".
Symbol wpisany przez agenta daje gaźnik jako kotwicę, a pasowanie oddaje
uszczelkę oferty. Gdyby oferta stała wyżej, dedup po `twId` zostawiłby zdanie
„kartoteka oferty…", a dowód pasowania zniknąłby ze szkicu.

Pewność trafienia wprost to pewność wiersza. Trafienie PRZEZ ZAMIENNIK
(§12) nigdy nie jest `potwierdzone` — zamiennik gaźnika bywa produktem
nadrzędnym z innym rozstawem uszczelki. Negatywne pasowania do kotwicy idą do
sekcji negatywów i do ostrzeżeń kandydata, scalane, nie nadpisywane.

Odpowiedź kandydatów niesie listę `kotwice`. Panel potrzebuje jej do przycisku
„Pasuje do W09-0211" przy wybranym kandydacie — jedynego miejsca, gdzie
pasowanie rodzi się z pracy. Kierunek jest narzucony: wybrany pasuje DO
kotwicy. Automatu przy ZATWIERDŹ DOBÓR nie ma: rola części jest nieznana,
a kotwica bywa samą częścią, gdy klient pyta o dostępność gaźnika.

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

**Łańcuch przez silnik rządzi się INNĄ regułą: najsłabszego ogniwa.** Powyższa
reguła dotyczy JEDNEGO twierdzenia i wygrywa w niej najmocniejszy dowód.
Kandydat z drogi `silnik` niesie twierdzenia DWA — „część pasuje do silnika"
oraz „silnik stoi w tej maszynie" — i jest wart tyle, co jego słabsze ogniwo.
`potwierdzone` wymaga więc dowodu technicznego po obu stronach. Ta rozbieżność
jest celowa; nie należy jej „naprawiać" na spójność.

**Maszyna z kilkoma silnikami nigdy nie daje `potwierdzone`.** Klient zna
model kosiarki, nie wersję silnikową. Każdy kandydat z tej drogi niesie wtedy
ostrzeżenie „potwierdź z tabliczki znamionowej", a pewność spada do
`prawdopodobne`. Milcząca pewność w tym miejscu kończy się zwrotem „nie
pasuje" — czyli psuje właśnie tę miarę, którą dobór ma poprawiać.

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

Ta sama lista powodów obowiązuje pasowanie części (0.230.0). Dwa z nich —
`niewlasciwy_rozstaw` i `srednica_ok_inne_mocowanie` — są wręcz kształtu
uszczelkowego. „Nie, ta jest od strony kolektora" to odpowiedź, którą
właściciel chce dawać klientowi, więc negatyw wszedł do tabeli od razu.
Dołożenie go później oznaczałoby przebudowę tabeli.

## 12. Baza wiedzy

Projekt wymieniał dziesięć bytów: `Manufacturer`, `MachineModel`,
`EngineModel`, `Part`, `PartIdentifier`, `Fitment`, `FitmentEvidence`,
`Measurement`, `KnowledgeDocument`, `KnowledgeRevision`. Kod ma JEDENAŚCIE
tabel, nazwami z kodu: `model_urzadzenia`, `zastosowanie`,
`dowod_zastosowania` (E2), `towar_identyfikator` i `model_z_opisu` (E3),
`zabudowa_silnika` (0.229.0), `pasowanie_czesci` (0.230.0), `alias_silnika`
(0.238.0), `token_silnika` z `token_silnika_kartoteka` (0.239.0) oraz
`wymiar_kartoteki` (0.241.0, pochodna nazw i opisów jak identyfikatory).
Każda z pozostałych byłaby dziś tabelą bez czytelnika — blizna 0.157.0. Nazwa
`dopasowanie` jest spalona (§15) i nie wraca.

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

**Zabudowa silnika** (`zabudowa_silnika`, 0.229.0) mówi, który silnik stoi
w której maszynie. Relacja jest wiele do wielu: jedna kosiarka bywa sprzedawana
w dwóch wersjach silnikowych, a jeden silnik stoi w setkach maszyn. Cykl życia
i podpisy ma te same co zastosowanie, rozstrzyga wyłącznie człowiek z biura,
a wycofanie wymaga powodu ZAWSZE — cofnięcie pary gasi całą gałąź kandydatów
naraz.

Dlaczego to nie jest wiersz w `zastosowanie`: tam `tw_id` znaczy kartoteka
Subiekta i wierzy w to cała warstwa odczytu. Wiersz, w którym `tw_id` znaczy
„model", zatruwałby każdego z tych czytelników po cichu.

Dlaczego dowód stoi w wierszu, a nie w `dowod_zastosowania`: dowody zabudowy
się nie kumulują. „Ten silnik stoi w tej kosiarce" ma jedno źródło naraz — IPL,
tabliczkę albo katalog dealera. Drugie źródło albo mówi to samo, albo mówi co
innego, a wtedy chcemy nowego wiersza z `zastepuje_id`, nie dopisku. Dowód jest
obowiązkowy, więc para bez niego nie powstaje wcale.

**Skąd biorą się pary.** Ekran Wiedza → Silniki układa listę luk: maszyny
z doborów, od najczęściej pytanych, z surowymi łańcuchami wpisanymi w pole
„Silnik" i licznikiem. Ranking liczy się z pól WPISANYCH PRZEZ AGENTA
w zakładce Dobór, nigdy z treści wiadomości klienta (blizna „szarpaka").
Automat nie rozbija tych łańcuchów na markę i nazwę — markę i nazwę wpisuje
człowiek, tak jak przy sekcjach „Modele:".

**Słownik silników** (`alias_silnika`, 0.238.0) to to, co człowiek wpisał
o tych łańcuchach: „B&S 450E" = silnik Briggs & Stratton 450E. Powód: po
0.237.0 Copilot wpisuje silnik z rozmowy do pola, a „Lonci v200" dalej był
tylko notatką. Dopasowanie jest dokładne po `zwin()`, tą samą normalizacją,
co klucz modelu i `towar_identyfikator`. Alias nie ma cyklu życia — jest
zapisem ręki biura, nie propozycją automatu, więc pomyłkę się usuwa. Czip na
liście luk ze słownikiem wypełnia formularz zabudowy modelem; czip bez
słownika otwiera formularz z zaznaczonym „zapamiętaj w słowniku", bo
człowiek, który właśnie wpisuje markę i nazwę, mówi, co ten tekst znaczy.
Alias nigdy nie wskazuje maszyny (pilnuje serwis) i nigdy nie karmi
szczebla wprost: w zakładce Dobór daje jedno zdanie i przycisk „Zaproponuj
zabudowę" z dowodem `rozmowa`, a szczebel rusza po zatwierdzeniu pary.
Alias marki bez modelu („Lonci" = Loncin) nie istnieje — to byłoby
rozbijanie.

**Tokeny silników w nazwach kartotek** (`token_silnika`,
`token_silnika_kartoteka`, 0.239.0) to drugi słownik, zapowiedziany
w 0.230.0. Alias mówi, co znaczy tekst z pola „Silnik"; token mówi, co znaczy
słowo w NAZWIE kartoteki: „GX160" = silnik Honda GX160. To dwie tabele, nie
jedna z flagą, bo alias jest dokładnym tekstem pola, a token podłańcuchem
nazwy — jedna kolumna niosłaby dwie prawdy. Serwer dopasowuje token do nazw
po `zwin()` przy dodaniu i po każdym imporcie, nigdy przy odczycie; wiersz na
parę (token, kartoteka) ma cykl jak `model_z_opisu`: `nowa` czeka na decyzję,
`zatwierdzona` wskazuje zastosowanie, `pominieta` nie wraca po imporcie,
a `nowa` znika, gdy kartoteka przestaje pasować. Dopasowanie idzie WYŁĄCZNIE
po nazwie, nigdy po opisie: opis bywa notatką i mówi też „nie pasuje do…".

Decyzja właściciela: **jedno kliknięcie zatwierdza zaznaczone.** Biuro widzi
listę kartotek z tokenem w nazwie, odznacza te, które nie pasują, i klika.
Zaznaczone dostają ZATWIERDZONE zastosowanie do silnika, odznaczone idą do
pominiętych. Propozycję i rozstrzygnięcie robi ten sam człowiek w jednej
transakcji — wolno, bo zatwierdza każdy z biura, także autor (Q5); nowe jest
tylko to, że oba zapisy idą za jednym kliknięciem. Ślad jest pełny:
`zaproponowal` = `rozstrzygnal`, źródło `opis`, dowód `decyzja_biura`
z tokenem i nazwą kartoteki. Automat dalej nie zgaduje marki z tokenu
(0.186.0) — lista kartotek jest podglądem decyzji człowieka, nie propozycją
automatu. Usunięcie tokenu nie cofa zastosowań: to fakty z dowodem, cofa się
je osobno przez wycofanie. Rozstrzygnięcie idzie hurtem jedną trasą, bo
decyzja dotyczy listy przejrzanej naraz. Sekcja stoi na ekranie Wiedza →
Z opisów jako druga sekcja tego samego widoku; zakładka liczy sekcje
„Modele:" i kartoteki z tokenem razem, bo to jedna praca tego samego
człowieka.

Druga droga to zatwierdzenie doboru. Do 0.229.0 hak wpisywał `rodzaj:
"maszyna"` na sztywno, więc żadne zastosowanie do silnika nie mogło powstać
z pracy, a szczebel „przez silnik" zwracałby zero na zawsze. Od tego wydania
agent wybiera przy zatwierdzeniu, czy wiedza ma urosnąć przy maszynie, czy przy
jej silniku. Opcja silnikowa pojawia się wyłącznie przy zatwierdzonej
zabudowie. Część silnikowa zapisana raz przy jednej kosiarce odpowiada odtąd
na pytania o wszystkie maszyny z tym samym silnikiem.

**Pasowanie części** (`pasowanie_czesci`, 0.230.0) mówi, że część `tw_id`
pasuje DO części `do_tw_id`: uszczelka do gaźnika, membrana do gaźnika,
łącznik do kolektora. Kierunek jest semantyczny — gaźnik nie „pasuje do
uszczelki" — a odczyt symetryczny: ekran gaźnika czyta `pasujace`, ekran
uszczelki `pasujeDo`. Wiersz niesie ROLĘ z listy zamkniętej (`uszczelka`,
`membrana`, `zestaw_naprawczy`, `lacznik`, `element_zestawu`, `inne`)
i POZYCJĘ jako wolny tekst: „od strony filtra", „między dystansem". Jeden
gaźnik GX160 ma trzy różne uszczelki i pozycja jest jedynym, co je rozróżnia.
Enum pozycji byłby trzecią listą do pilnowania dla czterech wierszy.

Rola należy do CZĘŚCI, a zapisujemy ją w relacji tylko dlatego, że nazwa
kartoteki to wolny tekst. Automat NIE wyprowadza roli z nazwy — to ta sama
pułapka, co rozbijanie „B&S 450E". Dowód stoi w wierszu jak przy zabudowie,
z tego samego powodu: jedno źródło naraz. Polaryzacja i powody z §11.4
obowiązują od pierwszego wydania. Cykl życia, podpisy i rozstrzyganie te same
co przy zastosowaniu; wycofanie negatywu wymaga powodu, pozytywu — nie, bo
pasowanie nie gasi żadnej gałęzi kandydatów.

Dlaczego to nie jest wiersz w `zastosowanie`: tam drugi koniec to MODEL,
a wiersz z kartoteką w tym miejscu zatruwałby po cichu każdego czytelnika
zastosowań. Dlaczego nie `dopasowanie_czesci`: nazwa `dopasowanie` jest
spalona (§15).

**Przechodniość przez zamiennik** liczy się PRZY ODCZYCIE, na głębokość
jeden, po obu stronach, nigdy jako `potwierdzone`. Uszczelka stoi w kartotece
pod czterema symbolami od czterech dostawców, z wzajemnym „Zamiennik:" —
231 takich skupisk. Zapisanie pasowania do jednej z nich ma odpowiedzieć
o wszystkie. Nie materializujemy tego: zamiennik jest efemeryczny, parsowany
z opisu po każdym imporcie, a odczyt pyta o jedną kartotekę. Czytamy TEN
opis: jeśli opis Y′ wymienia Y, a Y nie wymienia Y′, przy odczycie Y nie ma
nic. Wprost bije przechodnie po `twId`.

**Skąd biorą się pasowania.** Z pracy: przycisk „Pasuje do …" przy wybranym
kandydacie w Doborze, gdy kotwica jest inna niż wybrany (§11.2); propozycja
niesie rozmowę i dowód `rozmowa`. Z ręki: Wiedza → Sprawdź kartotekę →
„Dopisz pasowanie", z radiem kierunku i dowodem technicznym. Propozycje
czekają w kolejce Wiedza jako druga sekcja „Pasowania części" — ta sama
decyzja tego samego człowieka, nie szósta zakładka. Z Copilota (§14.8): model
nazywa parę symbolami z faktów, serwer sprawdza oba końce po kartotekach
z kontekstu, agent klika „Zaproponuj pasowanie"; źródło `copilot`, podpis
agenta, pastylka w kolejce. Źródło `opis` stoi w `CHECK` bez nadawcy,
precedensem `zastosowanie`.

**Historia wersji** bez `KnowledgeRevision`: poprawka to nowy wiersz
z `zastepuje_id`, a stary schodzi na `wycofane` przy zatwierdzeniu nowego.
Dziennik `events` niesie pełny wiersz przy każdej zmianie.

**Identyfikatory** (`towar_identyfikator`, E3) to numery OEM, numery
oryginału, katalogi obce, stare SKU i numery z sekcji zamienników.

**Sekcja zamienników niesie numery obcych katalogów (0.234.0).** Eksport
kartotek z 8 września pokazał, gdzie leży druga połowa mostka „numer klienta →
towar". Etykiet `Zamiennik:`, `Zamiennie:` i `ZAM:` jest w opisach tyle samo
co `OEM:` — po około czterysta każdej. Czytał je jednak wyłącznie parser
zamienników, a ten zostawia z listy tylko NASZE kartoteki i wyrzuca resztę.
Numer obcego katalogu stał więc w opisie i nie prowadził do niczego.

Na pełnej kartotece daje to 1701 numerów przy 1742 czytanych dotąd ze
wszystkich pozostałych sekcji razem — indeks urósł dwukrotnie, do 973 kartotek.
Rodzaj jest osobny (`zamiennik`, podpis „z zamienników"), bo sekcja zamienników
jest słabszym świadectwem niż numer producenta, a §11.3 każe pokazywać źródło.
Nasze symbole z tej listy do tabeli NIE wchodzą: pokazuje je sekcja
zamienników, a szukanie po numerze i tak trafia w kartotekę po symbolu. Z opisu biorą się po każdym imporcie
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

Podpis dowodu w szkicu dla klienta niesie rodzaj i datę, bez nazwiska
pracownika — z obu dróg: wstawki „ze źródłem" z Doboru i szkicu Copilota
(0.232.1, decyzja właściciela). Ekran biura autora pokazuje nadal.

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
znikał jako `[telefon]`. Klasyfikacji ten numer nie był potrzebny, ale
przyrost ekstrakcji (§14.7) regułę zawęził: dziewięć cyfr tuż po słowie OEM,
nr, numer, symbol albo kod zostaje. Cena: telefon podany jako „nr 601…" bez
słowa „tel" przejdzie do dostawcy. Pilnuje tego test.

**Zużycie zapisujemy od pierwszego wywołania**, w tokenach, nie w złotówkach.
Kwota w bazie jest kłamstwem od dnia zmiany cennika; liczba tokenów jest
faktem na zawsze. Osobna księga `copilot_wywolanie` liczy też próby nieudane,
bo one kosztują i nie dają odpowiedzi. Trafność mierzy werdykt człowieka
(`ocena`) przy plakietce w otwartej rozmowie. Podsumowanie za zębatką zawsze
podaje `n` i liczbę nieocenionych.

Partię zatrzymują CZTERY POWODY, wszystkie opisujące stan dostawcy albo
łącza, a nie tej jednej rozmowy: limit (429), zły klucz (401), przeciążenie
(529 i inne 5xx) oraz brak połączenia. Następna rozmowa dostałaby identyczną
odpowiedź, więc partia staje po pierwszej próbie. Wcześniejsze wyniki zostają,
a trasa oddaje 200 z wypełnionym polem `przerwane` — ekran pokazuje wtedy
zdanie o przerwie RAZEM z liczbą już rozpoznanych rozmów.

Ponowień sami nie dokładamy: SDK dostawcy ponawia 5xx dwa razy, więc błąd,
który do nas dotarł, przeżył już trzy podejścia. Na ekran idzie zdanie mówiące,
co zrobić; identyfikator żądania i typ błędu trafiają do księgi
`copilot_wywolanie`, nie na ekran.

Copilot jest **wyłączony domyślnie**, a brak klucza nie zatrzymuje startu.
Klucz stoi wyłącznie w `ANTHROPIC_API_KEY` i nie ma go w konfiguracji serwera
(blizna 0.84.1).

### 14.6. Co działa: szkic odpowiedzi z faktów (etap F, przyrost drugi)

Decyzja właściciela z 7 września 2026: „w oknie odpowiedzi powinien być
guzik, który konstruuje odpowiedź z pomocą AI, kartotek etc.". Przycisk
„Ułóż odpowiedź" stoi nad polem szkicu, w jednej rozmowie, na jedno
kliknięcie. Nie ma kroku „to kosztuje": agent prosi o pracę dla siebie,
a nie uruchamia partię na dwadzieścia rozmów.

**Serwer układa FAKTY, model pisze prozę, serwer sprawdza wynik.** Fakty (F1,
F2, …) powstają ze zdań, które serwer już pisze dla ekranu: kartoteka oferty
z dostępnością dziś, treść oferty od 0.253.0, dane doboru wpisane przez
agenta, kandydaci i negatywy ze zdaniem źródła, zastosowania, silniki,
pasowania, pomiary z tej rozmowy. Model cytuje identyfikatory faktów, a serwer
SPRAWDZA wynik w kodzie: każdy cytowany fakt musi istnieć, a długość nie może
przekroczyć limitu wysyłki.
Odwołania „(F3)" znikają z treści dopiero po tym sprawdzeniu (0.232.1) —
model pisze je zawsze, klient nie widzi ich nigdy.
**Wiedza własna modelu: swoboda kupiona jawnością (0.253.0).** Do 0.252.0
reguła brzmiała „model nie zna dopasowań z pamięci", a każdy numer spoza
faktów odrzucał cały szkic. Właściciel zdjął ten zakaz i postawił warunek:
„pełna swoboda, ale niech przy tym załącza źródła, sztywno oceniany poziom
pewności".

Zakaz zamienił się w rachunek. Każde twierdzenie techniczne stoi w polu
`twierdzenia` z podpisem źródła: baza, opis oferty albo wiedza modelu. Numer
niepokryty żadnym zadeklarowanym twierdzeniem dalej odrzuca szkic — powodem
nie jest już „wymyślony", tylko „agent nie ma jak go sprawdzić".

Pewność przyznaje serwer, nie model, i tu leży cała sztywność tej oceny. Sufit
zależy od źródła: baza może być „pewna", opis oferty najwyżej
„prawdopodobny", wiedza modelu zawsze „niepewna". W dół model może zawsze.
Bez sufitu ocena byłaby jego zdaniem o sobie samym.

**Granica: co należy do klienta, a co do biura (0.254.0).** Pierwszy szkic
z prawdziwej rozmowy o cewce do FS56 był rzeczowy i mówił klientowi trzy
rzeczy, które go nie dotyczą: że zapisujemy jego model, że nie mamy czegoś
potwierdzonego w kartotece i ile sztuk leży dziś na półce.

Każde z tych zdań jest zdaniem o NAS. Klient pyta, czy część pasuje; nie prosił
o sprawozdanie z naszej pracy ani o stan magazynu, a „dla informacji: dostępne
8 szt." przy części, która może nie pasować, brzmi jak namawianie do zakupu.
Wniosek zostaje, uzasadnienie się skraca: zamiast „nie mamy potwierdzenia
w kartotece" idzie zdanie o tym, co rozstrzygnie sprawę. Stan naszej wiedzy
opisuje `zastrzezenia`, które czyta wyłącznie agent. Dostępność podajemy, gdy
klient o nią PYTA.

**Okazja do uzupełnienia kartoteki (0.254.0).** Ta sama rozmowa pokazała drugą
rzecz. Oferta wymieniała jedenaście modeli zgodnych, a kartoteka znała dwa —
i był to jedyny moment, w którym obie listy stanęły obok siebie. Właściciel:
„jeśli jakieś numery są w ofercie, a nie ma w kartotece, zaznacz — to jest
organiczna okazja do uzupełnienia danych".

Liczy to KOD, nie model: `lukiZOferty` porównuje oznaczenia z oferty
z wszystkim, co już wiemy. Lista braków wyliczana przez model raz by była,
a raz nie — i przestałaby być listą braków. Do faktów NIE wchodzi, więc model
nie ma jak jej klientowi napisać; agent widzi ją paskiem pod szkicem.

**Rachunek stoi w osobnym oknie, nie w tekście.** Klient ma dostać gładką
odpowiedź, agent — to, na czym ona stoi. Okno „Skąd to wiem"
(`skrzynka/ProcesCopilota.tsx`) wisi pod szkicem i otwiera się samo tylko
wtedy, gdy pada choć jedno zdanie spoza bazy. Szkic w całości oparty o bazę
nie zabiera agentowi ani jednego ruchu — plakietka należy się wyjątkowi,
nie normie.

**Treść oferty w faktach (0.253.0).** Właściciel: „często oferta ma w sobie
opis, do jakich wersji pasuje, wymiary z oferty, dane techniczne". Opis,
parametry i lista zgodności dociągają się leniwie, przy kliknięciu „Ułóż
odpowiedź", i trzymają tydzień — ta końcówka kosztuje żądanie na ofertę.
Fakt z oferty mówi o sobie, że jest SŁOWEM SPRZEDAWCY: gdy przeczy
kartotece, rację ma kartoteka, bo opis bywa starszy od towaru.

Szkic, który łamie te reguły, jest odrzucony ze zdaniem dla agenta i wierszem
`blad` w księdze. Zła proza kosztuje „brzmi nieładnie"; numer bez źródła
kosztowałby zwrot — i tego drugiego kod nie przepuszcza.

**Gdy fakty nie rozstrzygają, szkic pyta.** Serwer dokłada do faktów pytania
z intake per typ części (nóż, pasek, filtr, linka, rozrusznik, gaźnik
z uszczelką), wybrane po nazwie części z DANYCH DOBORU, nigdy z treści
wiadomości. Słownik pytań jest kodem, nie promptem. Przy wyborze
z potwierdzonym dowodem pytań nie ma — udawałyby niewiedzę. Szkic pyta
tylko o to, czego rozmowa jeszcze nie zawiera (0.232.2). Model z rozmowy,
którego nie ma w faktach, wracał do agenta jako zastrzeżenie „wpisz go do
doboru"; od przyrostu trzeciego wraca jako propozycja danych doboru (§14.7).

**Do dostawcy idzie cały wątek, zamaskowany, z sufitem.** Decyzja
właściciela; zapis w polityce danych skrzynki (`docs/obsluga-klienta.md`).
Nasze wychodzące też przechodzą przez maskowanie, stopka jest wycięta, sufit
to dwanaście wiadomości albo sześć tysięcy znaków od najnowszej. Fakty NIE
przechodzą przez `zamaskuj()`: reguła „dziewięć cyfr to telefon" zjadłaby
numery OEM. Bezpieczeństwo faktów bierze się z konstrukcji i ma własny typ
`FaktyBezpieczne`, który produkuje jeden plik. Podpisy dowodów jadą bez
nazwiska pracownika. Login do maskowania bierze się z wątku Allegro, nie
z tematu rozmowy — to naprawa błędu klasyfikacji, która przy temacie będącym
tytułem oferty zostawiała login w treści.

**Propozycja ma własną tabelę `szkic_copilota`**, jeden wiersz na rozmowę,
z tego samego powodu, dla którego klasyfikacja ma swoją: `conversation.version`
pilnuje szkicu agenta i 409 w trakcie pisania byłby katastrofą. Wiersz niesie
`message_id`, na którym powstał — dopisek klienta czyni propozycję nieświeżą
i karta to mówi. Księga `copilot_wywolanie` dostaje zadanie `szkic`; pomiar
zza zębatki rozbija koszt po zadaniu, bo jeden szkic kosztuje kilkadziesiąt
razy więcej niż etykieta.

**Miarą szkicu jest jego los.** Wstawiony albo zastąpiony znaczy, że agent go
użył; odrzucony — że napisał sam. Ten odsetek, nie liczba wywołań, mówi, czy
przycisk jest wart pieniędzy. „Confidence bez konsekwencji to dekoracja" —
z tej samej krytyki.

**SZKIC PRZESTAJE BRZMIEĆ JAK MASZYNA (0.259.0).** Właściciel pokazał szkic
o sprzęgło do Mini Pocket i powiedział, że wygląda zbyt mocno na AI. Nie
chodziło o słownictwo. W tamtym tekście nie było ani jednego podejrzanego
słowa, a mimo to widać było maszynę. Trzy z czterech śladów brały się wprost
z naszego polecenia, więc to nie jest skarga na model.

**Przypis źródłowy wyciekał do klienta.** Szkic zawierał „(opis oferty)".
Reguła 1 każe legitymować każde twierdzenie źródłem, reguła 1a każe znakować
je w tekście, więc model uogólnił i zaczął nazywać źródło słowami. Kod zdejmuje
z treści wyłącznie kształt „(F3)", więc przypis napisany słowami przechodził
przez wszystkie sita. To łamało decyzję z 0.253.0: rachunek źródeł czyta agent
w oknie „Skąd to wiem", bo klient ma dostać gładką odpowiedź. Reguła 1c nazywa
teraz te nawiasy wprost i ich zakazuje.

**Odpowiedź ma być proporcjonalna do pytania.** Klient zadał pytanie zamknięte
i dostał pięć próśb o dane oraz dwie listy po trzy pozycje. Reguła 3 filtrowała
tylko powtórki i nie miała żadnego sufitu. To jest wada handlowa, nie
stylistyczna: klient gotowy kupić wychodził z zadaniem domowym. Reguły 3c i 3d
mówią teraz, żeby prosić o dane wyłącznie wtedy, gdy bez nich nie da się
odpowiedzieć, i żeby nie dopisywać porad, o które nikt nie prosił.

**Lista dostaje hamulec, myślnik zakaz.** Polecenie z 0.253.0 kazało robić listę
przy wyliczaniu części i kroków; reguła zostaje, ale tylko gdy zdanie pozycji
nie pomieści. Półpauza jest osobno zakazana, bo nie ma jej na klawiaturze
i sprzedawca jej nie stawia.

**Czego to wydanie NIE robi i ile to kosztuje.** Decyzja właściciela brzmiała
„tylko polecenie". Nie ma więc ani strażnika pilnującego, że te zakazy
zostaną w pliku, ani czyszczenia wyniku. Zakaz półpauzy jest z całej piątki
najsłabszy, bo plik polecenia ma kilkadziesiąt półpauz we własnym tekście
i model czyta je jako wzorzec. Gdy myślnik będzie wracał, to jest pierwsze
miejsce do sprawdzenia.

**KARTOTEKA NIE MÓWI, CO JEST W PACZCE (0.261.0).** Szkic o filtr powietrza
do Craftsmana LT2000 napisał klientowi sprostowanie: pod tą ofertą jest sam
filtr główny, mimo że opis wspomina o komplecie z przedfiltrem. Opis aukcji
deklaruje komplet filtr plus przedfiltr.

**Model nie zmyślił faktu, tylko podpisał faktem swój wniosek.** Twierdzenie
brzmiało „przedfiltr jest osobną pozycją 04-01015, a nie częścią tej oferty",
źródło `fakty`, odwołanie F6, pewność `pewne`. Pierwszy człon stoi w F6.
Drugiego F6 nie mówi wcale.

**To jest dziura w danych, nie w modelu.** W bazie nie ma pojęcia „co jest
w pudełku". Oferta ma jedną kartotekę, kandydaci to części alternatywne,
a tabela pasowań opisuje relację część do części, nie skład zestawu
sprzedażowego. Kartoteka opisująca jedną część nie może zaprzeczyć zdaniu
o zawartości aukcji, bo się o niej nie wypowiada. Reguła 2b kazała uznać to
za sprzeczność i powiedzieć klientowi wprost.

**Koszt był handlowy.** Powiedzieliśmy kupującemu, że w paczce jest mniej,
niż deklaruje nasza własna aukcja. Opis oferty jest częścią tego, co
sprzedajemy, więc wiadomość obsługi mówiąca co innego jest problemem,
a nie sprostowaniem. Co jest w paczce, wie magazyn.

**Reguła 2b dostaje granicę, 2c mówi resztę.** Kartoteka wygrywa, gdy przeczy
opisowi w tej samej właściwości tej samej części: wymiar, numer, dopasowanie.
O zawartości oferty milczy. Rozbieżność o skład zestawu idzie wyłącznie do
zastrzeżeń dla agenta i szkic nie prostuje jej klientowi. Gdy klient pyta
wprost o zawartość, odpowiada tym, co deklaruje oferta.

**Sufit pewności liczy się ze źródła, nie z treści.** `ustalPewnosc` porównuje
zadeklarowany poziom z sufitem dla źródła i nie sprawdza, czy teza wynika
z faktu. Zdanie sklejone z faktu i z wniosku bierze przez to pewność faktu dla
obu członów. Reguła 1b każe teraz rozbić takie zdanie na dwa twierdzenia.
Kod tego nie sprawdzi tanio, bo musiałby ocenić wynikanie; miarą jest
`obnizona`, która liczy, jak często model zawyża.

### 14.7. Co działa: dane doboru z rozmowy (etap F, przyrost trzeci)

Pytanie właściciela z 8 września 2026, nad szkicem o śrubę noża do kosiarki
Faworyt GTV51N196L-4W1 z silnikiem „Lonci v200": „dlaczego dane wejściowe nie
zostały wprowadzone automatycznie ze szkicu?". Model czytał te dane i odsyłał
agenta do przepisywania. Bez nich żaden szczebel doboru nie szukał.

**Trzy decyzje właściciela.** Rozpoznanie idzie RAZEM ze szkicem — to samo
wywołanie „Ułóż odpowiedź", zero dodatkowego kosztu. Jedno kliknięcie
wpisuje: karta w zakładce Dobór pokazuje wartości, a „Wpisz do danych"
zapisuje je w puste pola. Maskowanie zawężone po kontekście: dziewięć cyfr
tuż po OEM, nr, numer, symbol albo kod nie jest telefonem (§14.5).

**Model oddaje, serwer sprawdza, agent wpisuje.** Model wpisuje do
`daneDoboru` dane maszyny i części dosłownie tak, jak napisał je klient.
Serwer sprawdza każdą wartość przeciw ZAMASKOWANEMU wątkowi, czyli temu, co
model widział: każdy token z cyfrą musi stać w rozmowie po zwinięciu
separatorów, a każde słowo musi mieć swoje pierwsze cztery litery w rozmowie.
Wartość spoza rozmowy wypada z propozycji, a szkic zostaje — jest wart
pieniędzy sam w sobie. Liczba wyrzuconych idzie do dziennika jako miara tego,
ile model zmyśla. Wartość zamaskowana nie ma jak wrócić.

**Tylko puste pola.** Propozycja mieszka w wierszu `szkic_copilota`, nie
w `dobor_rozmowy`. Kliknięcie „Wpisz do danych" idzie drogą ręcznego zapisu:
wersja doboru rośnie, dziennik dostaje `dobor_dane`, status przechodzi
z `not_started` do `searching`, a wyścig kończy się tym samym 409. Słowo
agenta zostaje; pola, które ma inaczej niż model, karta wymienia jednym
zdaniem i nie nadpisuje. Blizna szarpaka nietknięta: szczeble czytają
wyłącznie `dobor_rozmowy`, a tam trafia tylko to, co agent kliknął.

**Los propozycji jest miarą.** `wpisane` albo `odrzucone` liczy się osobno
od losu szkicu, bo dobry szkic bywa ze złym modelem i odwrotnie. Pomiar zza
zębatki mówi, w ilu szkicach model coś rozpoznał i co agent z tym zrobił.
Karta szkicu w edytorze tylko mówi, jakie pola rozpoznano — bez drugiego
przycisku, bo dane wpisuje się tam, gdzie stoją. Zmiana danych doboru po
szkicu czyni go nieświeżym tak samo jak dopisek klienta: pastylka mówi
„ułóż ponownie", bo fakty są inne.

### 14.8. Co działa: Copilot proponuje pasowania (etap F, przyrost czwarty)

Zapowiedź z 0.230.0 („Copilot proponujący pasowania czeka"). Od 0.230.0
pasowanie część↔część ma tabelę, kolejkę i przycisk „Pasuje do…" w Doborze,
ale rodziło się wyłącznie z ręki agenta. Klient mówi wprost: „mam gaźnik
W09-0211, potrzebuję uszczelki od strony filtra". Model to czytał, a wiedza
przepadała, bo nikt nie klikał formularza.

**Trzy decyzje właściciela.** Agent proponuje jednym kliknięciem — wzór
danych doboru z §14.7: model oddaje, serwer sprawdza, człowiek klika. Oba
końce pary muszą być kartotekami z FAKTÓW tej rozmowy: kartoteka oferty,
kandydaci, kotwice z wpisanych symboli, strony cytowanych pasowań. Tylko
polaryzacja „pasuje" — negatyw wymaga powodu z listy zamkniętej, a model nie
ma go skąd wziąć.

**Model nazywa, serwer sprawdza po faktach.** Model wpisuje do `pasowanie`
oba SYMBOLE dosłownie z faktów, rolę z listy i pozycję słowami klienta.
Serwer trzyma BIAŁĄ LISTĘ kartotek, które sam położył na stole, i dopasowuje
symbole po `zwin()`. Symbol spoza listy, ta sama kartoteka po obu stronach,
rola spoza listy albo para już żywa w bazie — w dowolnej polaryzacji —
wypada z propozycją, a powód idzie do dziennika jako etykieta. Pozycja
zostaje tylko, gdy stoi w rozmowie: fakt intake wymienia „od strony filtra",
więc model mógłby przepisać ją z faktu. Szkic zostaje w każdym z tych
przypadków. Żadnego szukania symbolu w treści wiadomości (blizna szarpaka).

**Agent klika, biuro rozstrzyga.** Karta „Copilot rozpoznał pasowanie"
w zakładce Dobór pokazuje oba końce z kaflami, rolę i pozycję. „Zaproponuj
pasowanie" kładzie parę w kolejce Wiedza drogą `zaproponujPasowanie`, ze
źródłem `copilot`, dowodem `rozmowa` i PODPISEM AGENTA — za wpis odpowiada
człowiek (§14.2), a źródło niesie pochodzenie dla pomiaru i pastylki
„z Copilota" w kolejce. Pewność „prawdopodobne", jak przy każdej parze
z rozmowy. Dubel nie jest błędem: para wpisana ręcznie między szkicem
a kliknięciem daje ocenę `zaproponowane` bez drugiego wiersza. Zła rola
albo pozycja to „Odrzuć" i formularz „Pasuje do…" obok. Karta szkicu
w edytorze tylko mówi o parze, bez drugiego przycisku.

**Los propozycji jest miarą.** Pomiar liczy pary rozpoznane, zaproponowane
i odrzucone osobno od losu szkicu i danych. Właściwa miara jakości stoi
obok: ile par ze źródłem `copilot` biuro ZATWIERDZIŁO.

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
zabudowa_silnika         pasowanie_czesci        alias_silnika
token_silnika            token_silnika_kartoteka wymiar_kartoteki
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
GET    /api/obsluga/reklamacje
GET    /api/obsluga/reklamacje/:id
GET    /api/obsluga/reklamacje/:id/zalaczniki/:zid
GET    /api/obsluga/reklamacje/:id/zalaczniki/:zid/podglad
POST   /api/obsluga/reklamacje/synchronizuj
POST   /api/obsluga/reklamacje/:id/prowadze
POST   /api/obsluga/reklamacje/:id/notatka
POST   /api/obsluga/reklamacje/:id/odpowiedz
POST   /api/obsluga/reklamacje/:id/werdykt
POST   /api/obsluga/reklamacje/:id/zwrot-towaru
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
stoi (§14.5). Przyrost drugi — szkic z dowodami — stoi od 0.231.0 (§14.6).
Przyrost trzeci — dane doboru z rozmowy — stoi (§14.7). Przyrost czwarty —
Copilot proponuje pasowania — stoi (§14.8). OCR, kandydaci i porównanie
czekają.

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

Korektę wystawia człowiek w Subiekcie. Do 0.201.0 panel zapisywał jej NUMER
przepisany ręką, bo zadanie `korekta_zwrot` w kolejce Sfery potrzebuje
identyfikatora dokumentu SPRZEDAŻY, a read-model trzymał wyłącznie zakupy.

**Ten powód wygasł.** Read-model sprzedaży wrócił w 0.174.0, a w 0.201.0 doszła
kolumna `dok_DoDokId` — dokument korygowany. Numer czyta więc automat, a pole
w panelu zostaje dla przypadków, w których pewności nie ma: dwóch korekt do
jednej faktury albo braku wskazanego dokumentu sprzedaży.

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

### 25a.4c. Pytanie kubełka stoi RAZ (0.214.0)

Nagłówek otwartego zwrotu powtarzał pytanie kubełka — „Przyjąć czy odrzucić?"
bezpośrednio nad przyciskami PRZYJMIJ i ODRZUĆ. Pytanie i odpowiedź o dwa
centymetry od siebie to dekalog ergonomii, punkt 5: nie każ mówić dwa razy
tego samego.

Pytanie zostaje NAD LISTĄ i w podpowiedzi zakładki — tam nazywa kubełek,
w którym się stoi, i nic go nie powtarza. Nagłówek niesie tożsamość zwrotu:
numer i login kupującego, czyli to, co się z niego przepisuje.

### 25a.5. Cofnięcie zamiast potwierdzenia

Potwierdzenie dostają dwie rzeczy nieodwracalne: oddanie pieniędzy i odmowa
zwrotu. Reszta ma cofnięcie, dopóki zapis czeka w kolejce.

**Drabina cofania (0.202.0).** Każdy kubełek cofa dokładnie ten krok, który go
wprowadził. Schodzi się po jednym szczeblu, tą samą drogą, którą się weszło:

| kubełek | co cofa | dokąd wraca |
|---|---|---|
| ZAMKNIĘTY | cofnij korektę | DO KOREKTY |
| DO KOREKTY | popraw kwotę | DO ZWROTU |
| DO ZWROTU, DO OCENY | cofnij ocenę | DO OCENY |
| DO OCENY, nic nieocenione | cofnij przyjęcie | DECYZJA |

Dwóch szczebli naraz nie trzeba zabraniać — sam kształt na to nie pozwala.
Kubełek wynika ze stanu, a bramka wersji odrzuca zwrot zamknięty, więc kwoty
spod zapisanej korekty nie da się ruszyć, dopóki korekta stoi.

Ocena i kwota są NIEZALEŻNE. Cofnięcie oceny zostawia kwotę, więc po ponownym
ocenieniu zwrot wraca prosto do DO KOREKTY, bez powtarzania wyceny: ocena jest
faktem o towarze, kwota o pieniądzach.

Dwie rzeczy cofnięcia NIE mają, i obie mówią, dlaczego:

- **Pozycja na zamkniętym koszyku.** Dokument MM pojechał na halę. Ekran
  nazywa kosz, żeby człowiek wiedział, na którym papierze szukać. Do 0.202.0
  zmiana oceny przechodziła tu po cichu i zostawiała towar na cudzym
  dokumencie.
- **Kwota, przeciw której poszły pieniądze.** Wiersz zwrotu płatności jest
  jedynym śladem po przelewie. Różnicę dopłaca się w panelu Allegro.
- **Odmowa zwrotu.** Poszła do klienta jako oświadczenie, a drugiej takiej
  samej Allegro nie przyjmie (422). Dlatego to ona ma potwierdzenie w formie
  wpisanego powodu — cofnięcie ma przyjęcie, nie ona.

Cofnięcie przyjęcia jest ostatnim szczeblem i pokazuje się TYLKO wtedy, gdy
nikt jeszcze nic nie ocenił. To jedno zdanie w kubełku DO OCENY, nie ramka
z decyzją: pytanie tego ekranu dalej zadaje wiersz produktu. Przyjęcie idzie
jednym kliknięciem, bez pytania o nic — i tak zostaje, bo tak wygląda typowy
zwrot. Kliknięcie bez pytania musi jednak mieć drogę powrotną.

### 25a.5a. Czego proces zwrotu wciąż nie domyka

Przegląd z 0.210.0. Trzy luki zamknięte w tym wydaniu, cztery zostają otwarte
i każda czeka na decyzję, a nie na kod.

**Odmowa: dwa różne kroki, oba potrzebne.** Nasz werdykt `odrzucony` jest
decyzją biura i nigdzie nie wychodzi — Allegro nie zna pojęcia „odrzuć zwrot".
Klienta zawiadamia dopiero ODMÓW WYPŁATY: to ta końcówka niesie kod i powód,
a wiadomość do klienta wysyła Allegro. Pasek pieniędzy stoi na zwrocie
odrzuconym tak samo jak na każdym innym, więc droga jest pod ręką — ale nic nie
przypomina o jej przejściu, a sam werdykt do niczego nie zobowiązuje.

**Utylizacja od 0.211.0 ma własny koszyk.** Decyzja właściciela: towar z tej
oceny idzie na magazyn odpadu. Droga jest ta sama co przy zwrotach — biuro
zbiera do pudła, zamyka, MM wychodzi po komplecie korekt — różni się WYŁĄCZNIE
magazynem docelowym. Bramka korekty obowiązuje tak samo, bo towar wraca na
magazyn główny dopiero po niej.

Numer magazynu stoi w `MAG_ID_ODP` i **nie ma domyślnej wartości**. Zero znaczy
wyłączone: zgadnięty numer wystawiłby dokument przesuwający złom w cudze
miejsce, a MM się nie cofa jednym kliknięciem.

**Pobranie nie ma gdzie zostawić śladu.** Panel mówi „oddaj przelewem"
i kończy; `zwrot_pieniedzy_id` wypełnia wyłącznie ścieżka Allegro. Zwrot
domyka się korektą, ale bez zapisu, czy klient dostał pieniądze.

**Rozjazd ilości liczy BIURO od 0.212.0.** Decyzja właściciela: „biuro zajmuje
się otwieraniem i procesowaniem zwrotów". Przy pozycji z więcej niż jedną sztuką
stoi „wróciło mniej, niż zgłosił"; wpisana liczba wchodzi do kwoty i na dokument
MM, a wiersz kolejki dostaje sygnał. Puste to NIE zero: zero jest zdaniem
„zgłosił dwie, nie wróciła żadna", puste znaczy „nikt jeszcze nie otworzył
kartonu".

Więcej niż zgłoszono odpada. Nadmiar z kartonu jest INNĄ pozycją i ma własną
drogę (`dopiszPozycje` od 0.184.0); podniesienie liczby tutaj wypłaciłoby za
sztuki, o których zwrocie klient nigdy nie napisał.

Sygnał rozjazdu KWOTY dalej nie łapie jednego przypadku: pozycja dołożona przez
Allegro po wycenie ma `w_zwrocie = 0` i sumy nie rusza, a odróżnić jej od
świadomie odznaczonej nie sposób, bo pozycja nie ma daty dopisania.

### 25a.6. Zamówienie i zdjęcia

Zwrot niesie sam numer zamówienia, więc panel dociąga jego treść i pokazuje
**całe zamówienie**, zaznaczając pozycje, które wracają. „Kupił trzy, oddaje
jedną" jest kontekstem decyzji, a nie ciekawostką.

Stamtąd bierze się też koszt dostawy — składnik kwoty pełnej, którego zwrot
sam nie zna — oraz SKU sprzedawcy (`offer.external.id`), czyli mostek do
kartoteki Subiekta. Bez kartoteki nie ma zdjęcia: cache obrazów jest
kluczowany po `tw_id`.

**Jedno trafienie po sygnaturze łączy samo (0.219.0).** Do 0.218.0 obowiązywało
„automat proponuje, człowiek zatwierdza" i dopasowanie po SKU czekało na
kliknięcie. Zwroty wiązały je same od 0.169.0, dobór brał za kandydata bez
klikania, a skrzynka kazała klikać po stan i półkę. Właściciel zdecydował:
sygnatura trafiająca w dokładnie jedną kartotekę jest powiązaniem, z podpisem
„SKU oferty". Zero i wiele trafień daje brak, nigdy zgadywanie; po nazwie
towaru w KARTOTECE nie dopasowujemy nigdy. Propozycje z zapasowych dróg
(jedyna pozycja, zgodna nazwa) dalej czekają na człowieka.

**Zwroty pobiera się też ręcznie (0.232.0).** Takt zwrotów chodzi pięć razy
rzadziej niż skrzynka, bo zwrot ma termin liczony w dniach. Biuro, które
właśnie przyjęło paczkę, wie o zwrocie wcześniej niż panel — i czekało na
wiersz kilkanaście minut. Przycisk „Synchronizuj" stoi w paśmie filtrów
kolejki, przy „Pobierz CSV": osobny pasek nad listą zjadałby wiersze, a to
one są treścią tej kolumny. Przerwy, o którą poprosiło Allegro kodem 429,
przycisk nie omija; po przebiegu wiąże zaległości tak samo jak takt.

**Wiązanie nie zależy od Allegro (0.220.0).** Automat sygnatur chodzi taktem
synchronizacji i do 0.219.1 stał w nim jako ciąg dalszy po pobraniu. Wyjątek
z pobierania — wygasły token, limit, jeden felerny rekord — zabierał go ze
sobą przy każdym przebiegu. Zwroty zapisane wcześniej zostawały, więc kolejka
wyglądała zdrowo, a przy każdej pozycji stało „Bez kartoteki" z gotową
propozycją obok. Wiązanie idzie teraz w `finally`, każdy krok pod własnym
parasolem (`services/wiazania.ts`), a licznik nagłówka rozdziela dwa różne
czekania: „czeka na automat" znaczy usterkę, „czeka na zatwierdzenie" — pracę
biura. Gdy synchronizacja stoi, pasek mówi to wprost. Przycisk „Dociągnij
teraz" jest jedyną ręczną drogą do wiązania, więc stoi też przy zamówieniu
już pobranym.

**Pamięć wskazań (0.154.0).** Wskazanie zapamiętuje parę oferta–kartoteka,
a następny zwrot tej samej oferty dostaje ją bez pytania o zamówienie. To
jedyna zmiana, która realnie zdejmuje pracę powtarzalną; źródłem jest wtedy
człowiek, nie SKU, i ekran tak to podpisuje.

**Pamięć obowiązuje, dopóki sygnatura jest ta sama (0.219.0).** Sprzedawca
przepina sygnaturę oferty, gdy towar od jednego dostawcy się wyczerpie. Para
zapamiętana przy dawnej sygnaturze mówi wtedy o towarze, którego pod tym
numerem już nie ma, więc ustępuje nowej sygnaturze — a zdanie źródła mówi,
co ustąpiło i komu. Wiersz pamięta sygnaturę z chwili wskazania
(`sku_wtedy`); wiersze sprzed 0.219.0 obowiązują jak dotąd. Bez snapshotu
oferty pamięci nie ma czym podważyć.

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

Zdjęcie widać w czterech miejscach: miniatura w wierszu kolejki, kafel przy
pozycji w kolumnie dowodów, kafel w bloku PROPOZYCJI kartoteki (0.203.0)
i powiększenie po kliknięciu. Kafel ma stały rozmiar także wtedy, gdy zdjęcia
nie ma — rosnący przesuwałby wiersze pod kursorem.

Obraz propozycji stoi WEWNĄTRZ jej ramki, nie na wierszu. Kafel wiersza należy
do kartoteki potwierdzonej; wyniesiony na wiersz obraz propozycji udawałby
fakt, a §4.3 nie pozwala, żeby wybór automatu wyglądał jak dana z Allegro.

### 25a.6b. Zdjęcie z oferty Allegro (0.213.0)

Kartoteka odpowiada na pytanie „co mamy na półce". Oferta odpowiada na inne:
„co klient WIDZIAŁ, kupując". Zbieżność nie jest przesądzona i właśnie ta
różnica bywa treścią sporu — „na zdjęciu było inaczej".

Adres zdjęcia listingowego jedzie w odpowiedzi `GET /sale/offers`, po którą
i tak idziemy po tytuł i cenę, więc funkcja nie kosztuje żądań. Do 0.210.0
pole wypadało przy mapowaniu.

**Zakaz z 0.178.0 obowiązuje dalej i dotyczył czego innego.** Brzmiał: obrazek
z serwera Allegro znaczyłby wyjście przeglądarki biura poza własną sieć. To jest
zakaz hotlinka. Panel nie dostaje adresu w `allegroimg.com`; po plik idzie
serwer i podaje go z trasy `/api/obsluga/oferta/:externalId/zdjecie`, tak jak
od 0.30.0 podaje zdjęcia kartotek.

Zdjęcie stoi w dwóch miejscach i w obu ma PODPIS, bo źródła się nie mieszają
(§4.3): w bloku oferty przy rozmowie, nad blokiem towaru z Subiekta, oraz przy
pozycji zwrotu, obok kafla kartoteki. Stany braku rozróżnia §25a.6c.

**Trzecie miejsce: pozycja zamówienia przy rozmowie (0.215.0).** Właściciel
przysłał zrzut rozmowy z samym zamówieniem — kolumna nie miała ani zdjęcia,
ani kartoteki. Pozycja niesie teraz oba źródła obok siebie, jak pozycja
zwrotu: kafel oferty Allegro i kafel kartoteki Subiekta, z podpisem pod listą.
Kartotekę za pozycją daje ten sam mostek, co dla oferty rozmowy: pamięć
wskazań, a bez niej SKU z formularza zakupu.

**Skąd numer oferty rozmowy (0.215.0).** Trzy drogi, w tej kolejności:
wskazanie agenta, numer z wiadomości klienta, jedyna pozycja zamówienia. Do
0.213.0 wskazanie ręczne zapisywało się w zdarzeniu, a blok oferty go nie
czytał. Zamówienie z jedną pozycją nie ma czego mylić, więc jego oferta jest
ofertą rozmowy — z podpisem „z jedynej pozycji zamówienia". Przy kilku
pozycjach panel nie zgaduje: przy każdej stoi „Wskaż jako ofertę rozmowy",
a wybór zapisuje się jako decyzja człowieka. SKU pozycji jest zapasem dla
mostka, dopóki takt ofert nie dociągnie snapshotu.

**Przy zwrocie numer oferty bierze się z pozycji ZAMÓWIENIA.** `offerId`
pozycji zwrotu należy do przestrzeni, której nie znamy (`[WERYFIKUJ]`
w `docs/allegro-ksztalt.md`), więc pytanie nim trafiałoby raz na dziesięć.
Droga idzie przez pozycję zamówienia — tym samym dopasowaniem po obu
kolumnach, którym idzie SKU.

To zakrywa dziurę, której kartoteka zakryć nie umie. Pytanie sprzed zakupu
przychodzi bez kartoteki, a większość kartotek i tak zdjęcia nie ma; oferta ma
je prawie zawsze.

### 25a.6d. Zdjęcie przy pozycji ZAMÓWIENIA (0.217.0)

Decyzja właściciela: „wszędzie, gdzie jest odniesienie do produktu, powinno być
zdjęcie". Listy pozycji zamówienia — w kolumnie dowodów zwrotu, przy rozmowie
i wśród kandydatów do dopisania — wymieniały towary samym tekstem.

Kafel jest MNIEJSZY niż przy pozycji zwrotu, 32 px wobec 72. To hierarchia,
nie oszczędność: pozycja zwrotu to praca, pozycja zamówienia to jej kontekst.

Stoi tam WYŁĄCZNIE zdjęcie oferty. Co mamy na półce, mówi kolumna środkowa
przy pozycji zwrotu; powtórzenie tego obok byłoby szumem.

Nazwa idzie przed ceną i wolno jej zająć dwa wiersze. Kolumna ma 21 rem przy
węższym oknie, a kafel zabiera z niej 32 px — przy jednym wierszu zostawało
„NAKRĘTKA DO…", czyli nazwa, z której nie da się rozpoznać towaru.

### 25a.6c. Trzy stany zdjęcia oferty (0.214.0)

„Bez zdjęcia" znaczyło trzy rzeczy naraz i myliło najgorszą z możliwych.
Zgłoszenie właściciela: przy pozycji zwrotu stały dwa puste kafle, a oferta
miała na Allegro zdjęcie.

Przyczyna była w warunku świeżości. Snapshot odświeżamy raz na dobę, a kolumna
z adresem weszła w 0.213.0 — więc wiersz zapisany wcześniej był „świeży"
i „bez adresu" naraz. Snapshot NIEKOMPLETNY nie jest snapshotem świeżym: brak
adresu jest teraz trzecim powodem pobrania.

Kolumna niesie trzy wartości: `NULL` — nikt jeszcze nie pytał; `''` —
pytaliśmy i Allegro nie podało obrazu; adres — mamy obraz. To ta sama różnica,
którą przy SKU oferty robi `dopasowanie-sku.ts`.

Kafel mówi, na co się czeka: **zegar** — obraz dociągnie najbliższa
synchronizacja; **„bez zdjęcia"** — Allegro nie ma obrazu tej oferty;
**koszyk** — pozycja nie wiąże się z żadną linią zamówienia. Trasy nie pytamy
tam, gdzie serwer już wie, że nie ma o co.

### 25a.6a. Zdjęcia w całej obsłudze (0.203.0)

Do 0.202.0 kafel stał wyłącznie tam, gdzie kartoteka była już rozstrzygnięta:
w kolejce zwrotów, przy pozycji zwrotu i przy kartotece potwierdzonej przy
rozmowie. Miejsca, w których człowiek DECYDUJE, obrazu nie miały.

Zdjęcie doszło więc do kandydatów doboru, negatywnych dopasowań, wybranej
kartoteki doboru, wyników wyszukiwarki kartotek, obu propozycji kartoteki
(przy rozmowie i przy pozycji zwrotu), karty zadania terenowego oraz obu kart
bazy wiedzy. Wszystkie biorą obraz z trasy `/api/products/:twId/zdjecie` —
z Allegro nie pobieramy nic (§ oferta przy rozmowie).

Wyszukiwarka jest tu jedną zmianą dla pięciu ekranów: doboru, kartoteki przy
rozmowie, zlecenia pomiaru, sprawdzenia wiedzy i nowej propozycji.

**Nazwa przed symbolem.** Wiersz kandydata i wynik wyszukiwarki zaczynały się
od symbolu, a nazwa leżała pod nim, w rozmiarze podpisu. Symbol jedzie na
dokument i na halę, więc zostaje — ale rozpoznaje się część po nazwie i po
obrazku, nie po kodzie magazynowym.

**Kolejka rozmów zdjęcia NIE dostaje i to jest decyzja.** Triaż w skrzynce robi
się po pilności, czasie oczekiwania i treści pytania — nie po tym, jak wygląda
towar. Rozmowa nie niesie zresztą kartoteki na liście: wywodzi się ją z oferty
dopiero po otwarciu. Zdjęcie wchodzi tam, gdzie pada pytanie „czy to ta
część", czyli o jeden ekran dalej. Zdjęcie z oferty (0.213.0) tego nie zmienia:
snapshot oferty przy rozmowie też powstaje dopiero po otwarciu.

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

Od 0.207.0 stoją w DWÓCH różnych miejscach, bo odpowiadają na dwa różne
pytania. Login jest w NAGŁÓWKU sprawy, razem z numerem zwrotu: to tożsamość,
czyli pierwsze, co się czyta, i jedyne, co się przepisuje. Przewoźnik zszedł do
PACZKI ZWROTNEJ, bo mówi o paczce, nie o zwrocie. Sekcja „Zwrot" po prawej
przestała istnieć — numer stał dotąd w dwóch miejscach naraz.

**Numer zwrotu prowadzi do Centrum Sprzedaży**, wyszukany po sobie samym.
Zakres dat listy startuje od dnia zgłoszenia tego zwrotu; stała granica
wycięłaby starszy zwrot i wyszukanie oddałoby pustkę mimo trafionego numeru.

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

**W drugą stronę: zwrot przy rozmowie (0.221.0).** Klient często pyta pod
zamówieniem o zwrot, którego dokonał — „czy paczka doszła", „kiedy pieniądze".
Do 0.220.0 agent szedł na ekran Zwroty i szukał zwrotu ręcznie. Teraz zwroty
tego zamówienia stoją w kolumnie „Oferta i towar", pod zamówieniem, tym samym
mostkiem i tym samym składem wiersza, co w kolejce zwrotów: kubełek, sygnały,
termin, paczka, pozycje, decyzja i kwota. Praca nad zwrotem zostaje na ekranie
Zwroty; odnośnik prowadzi prosto do tego zwrotu. Po loginie nie dobieramy —
ta sama blizna.

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

### 25a.17. Koszyk zwrotów i dokument MM (0.193.0)

Właściciel opisał obieg, który biuro robi ręką od lat:

> „gdy agent zasiada do zwrotów, to otwiera pustą MM i dodaje kolejno
> przedmioty ze zwrotów; gdy koszyk się zapełni, zamyka MM i tak w kółko"

Panel jest teraz tą pustą MM. Numer dokumentu wraca z Subiekta, więc kartka
z liczbą pisaną odręcznie przestaje być potrzebna.

**Dokłada OCENA, nie osobny przycisk.** Naciśnięcie „Na stan", które operator
i tak wykonuje przy towarze, JEST dołożeniem do koszyka. Osobny przycisk
kazałby powiedzieć dwa razy to samo — dekalog ergonomii, punkt 5. To zarazem
odpowiedź na pytanie o prędkość decyzji: najszybsza jest ta, której nie
podejmuje się dwa razy.

**Do koszyka wchodzi wyłącznie „na stan"** — decyzja właściciela. Utylizacja
ma zejść ze stanu, więc MM na regał zwrotów byłby dla niej ruchem w złą
stronę. Przecena zostaje na razie poza tą ścieżką.

**Koszyk jest jeden na operatora** — druga decyzja właściciela. Fizyczny kosz
stoi przy jednym biurku, więc dwie osoby przy zwrotach nie mieszają towaru
w jednym dokumencie.

**Pozycja bez kartoteki na dokument nie wejdzie** i ekran mówi to wprost.
MM przesuwa stany kartotek, a nie nazwy. Ocena zapisuje się mimo to, bo jest
faktem o towarze; cicha strata kończyłaby się kartonem na hali z towarem
spoza dokumentu.

**Domknięcie zamyka kosz OD RAZU, a numer dochodzi później.** Hala ma wtedy
co rozkładać, nie czekając na Subiekta. Kolektor bierze kosz tą samą drogą co
kosze z dokumentu — po statusie, bez zmian po swojej stronie.

**Dlaczego to wraca dopiero teraz.** Ścieżka koszyków istniała i wypadła
w 0.17.0 z jednym twardym powodem: *„domknięcie koszyka kolejkuje MM,
a dokumentów MM na produkcji nie da się dziś wystawić"*. Ten powód wygasł —
worker Sfery ma prawdziwe `CreateMM`. Schemat `kosz` czekał bez zmian: status
`otwarty` nosi w komentarzu zdanie „biuro dokłada zwroty", które przez rok nie
miało kto wykonać.

Reguła „tylko lokalizacja" z 0.16.0 nie jest złamana. Dotyczy ona SUROWYCH
zapisów do bazy Subiekta, a dokumenty idą osobnym, przyjętym kanałem — przez
Sferę, tak samo jak korekta zwrotu.

### 25a.8. Czego panel nie wie

Kwoty pełnej nie znamy, dopóki zamówienie nie zostanie pobrane — i ekran mówi
to wprost, zamiast pokazywać sumę pozycji jako całość.

## 25b. Reklamacje klienckie

Rozdział dopisany w 0.222.0. Opisuje trzeci ekran obsługi i odpowiada na
pytanie, które §26 zostawiało otwarte: czy prowadzimy dyskusje.

### 25b.1. Czym jest reklamacja

Sprawą posprzedażową, która żyje w całości w Allegro. Inaczej niż zwrot,
nie ma drugiego obiegu w Subiekcie: nie ma korekty, nie ma MM, nie ma paczki
na regale. Panel niczego tu nie spina — dokłada to, czego Centrum Sprzedaży
nie daje: kolejkę z priorytetem, właściciela sprawy i notatkę z ustaleń.

Reklamacja to NIE ZWROT i nie wolno ich skleić. Odstąpienie od umowy
i rękojmia to dwa różne tytuły prawne, dwie różne rozmowy z klientem i dwa
różne terminy. Sklejenie ich w jeden rekord kosztowało już nakładkę spraw.
Reklamacja nie zakłada więc zwrotu i go nie wiąże; pokazuje tylko zwroty tego
samego ZAMÓWIENIA, tym samym mostkiem co rozmowa od 0.221.0.

### 25b.2. Dlaczego najpierw tylko reklamacje

`/sale/issues` niesie dyskusje i reklamacje pod jednym zasobem, rozróżnione
polem `type`. Właściciel zdecydował 6 września 2026, że panel prowadzi
wyłącznie reklamacje: mają zegar, mają formalny werdykt i to one gniją
niezauważone. Dyskusja jest rozmową, a rozmowy panel już ma.

**Decyzja została odwrócona 9 września 2026.** Dyskusje dostają własny ekran
(§25c). Obie daty zostają tutaj, bo pierwsza z nich tłumaczy kształt kodu przez
trzy wydania, a druga mówi, dlaczego ten kształt się zmienił.

Trzy dni starczyły, bo liczby okazały się nie po stronie pierwszej decyzji.
Sonda z żywego konta pokazała **35 dyskusji na 65 reklamacji**, w tym 25
w stanie `DISPUTE_ONGOING`. To nie jest ogon rozkładu.

Zdanie „rozmowy panel już ma" też się nie broni: dyskusja nie jest wątkiem
z Centrum Wiadomości. Ma formalny status Allegro, ma flagę `chatActive`,
nie ma flagi przeczytania, odpowiada się w niej inną końcówką i bywa
**trójstronna** — doradca Allegro odezwał się w 61 sprawach na 100.

### 25b.3. Kolejka bramek

Ekran nie jest rejestrem. Praca dzieli się na kubełki, a w każdym stoi jedno
pytanie, więc operator nie wybiera akcji z menu — odpowiada.

| kubełek | pytanie | skąd |
|---|---|---|
| DO DECYZJI | uznać czy odrzucić? | `CLAIM_SUBMITTED` bez naszego werdyktu |
| DO ODPOWIEDZI | co odpisać klientowi? | rozstrzygnięta, a ostatnie słowo było klienta |
| ROZSTRZYGNIĘTE | — | `CLAIM_ACCEPTED`, `CLAIM_REJECTED` albo werdykt z panelu, który wyszedł |

**Werdykt z panelu zamyka sprawę od razu, nie za takt synchronizacji.**
Po „WYŚLIJ WERDYKT" wiersz przechodzi do ROZSTRZYGNIĘTYCH, zanim Allegro
odda `CLAIM_*` — inaczej dwie osoby przy dwóch biurkach widziałyby ją jako
otwartą jeszcze przez minutę. Los niepewny (timeout) liczy się jak wydany,
bo drugiego strzału i tak nie oddamy; porażka kodem zostawia sprawę w DO
DECYZJI z sygnałem, bo wiadomo, że nic nie poszło.

**DO DECYZJI trzyma także sprawy z nową wiadomością od klienta.** Obowiązek
wobec terminu jest jeden i to on rządzi kolejnością pracy; „klient czeka" jest
przy takim wierszu SYGNAŁEM, a nie osobną kolejką. Przeniesienie go do
DO ODPOWIEDZI zaniżyłoby licznik spraw z zegarem — czyli jedyną liczbę, dla
której ten ekran powstał.

Strzałki chodzą po kolejce, cyfry przełączają kubełek, a przełączenie kubełka
przestawia też kursor na jego pierwszą sprawę. Skróty milkną, gdy ognisko stoi
w polu tekstowym: inaczej cyfra wpisana w notatkę zmieniałaby listę.

### 25b.4. Zegar

**Czytamy go, nie liczymy.** `decisionDueDate` jest terminem na uznanie albo
odrzucenie reklamacji i przychodzi z Allegro przy każdej sprawie tego typu.
Implementacja skasowana w 0.140.0 liczyła ustawowe czternaście dni sama, bo
komentarz obok twierdził, że ten zasób żadnego zegara nie oddaje. Liczba wzięta
z naszego kodu rozjeżdżałaby się z tą, którą widzi kupujący — a rozstrzyga jego.

Brak terminu MÓWI o sobie („bez terminu"), zamiast zostawiać puste miejsce
w kolumnie pilności. Puste miejsce czyta się jako „zdąży się", czyli odwrotnie,
niż trzeba.

### 25b.5. Sygnały

Dziewięć, każdy z jednym powodem istnienia:

- **termin** — decyzja za trzy dni albo mniej; przy sprawie rozstrzygniętej milczy.
- **klient czeka** — ostatnie słowo było klienta, ruch należy do nas.
- **doradca** — w rozmowie jest doradca Allegro. Sonda widziała go w 61 sprawach
  na 100, więc to przypadek typowy, a nie brzegowy; zmienia ton odpowiedzi,
  bo czyta ją trzecia strona.
- **czat zamknięty** — Allegro nowej wiadomości nie przyjmie (10 spraw na 100).
- **zwrot towaru** — sprzedawca zażądał odesłania. POKAZUJEMY, nie obsługujemy.
- **status?** — wartość spoza `PostPurchaseIssueStatus`. Nie jest błędem: sprawa
  wchodzi do kolejki, a sygnał prosi właściciela o potwierdzenie na żywym koncie.
- **werdykt czeka** — nasz werdykt wyszedł (albo mógł wyjść), a `status_allegro`
  nie pokazuje jeszcze `CLAIM_*`. Gaśnie z synchronizacją, nie z naszej ręki.
- **werdykt nieudany** — Allegro odmówiło kodem; sprawa wraca do DO DECYZJI
  i wolno spróbować raz jeszcze.
- **towar?** — uznana z panelu, a kupujący nie wie, czy odsyłać towar: ani my
  nie zajęliśmy stanowiska, ani `returnRequired` nic nie mówi.

### 25b.6. Układ

Trzy kolumny, jak §10.1 i jak zwroty — trzy ekrany obsługi mają mieć jeden
nawyk, nie trzy. Kolumna dowodów ma SEKCJE, nie zakładki: to jedna lista
faktów o jednej sprawie, więc czyta się ją w całości (ta sama decyzja co przy
zwrocie w 0.180.0).

Środek okna niesie ZGŁOSZENIE I ROZMOWĘ, bo po to agent otwiera ten ekran.
Rola autora jest podpisem, a nie ozdobą: rozmowa bywa trójstronna i bez
wyraźnego podpisu agent odpowiadałby doradcy tak, jak odpowiada klientowi.

**Zdjęcia są w trzech miejscach (0.223.0) i w każdym z innego powodu.**
Wiersz kolejki niesie obraz OFERTY, bo reklamacja dotyczy jednej rzeczy
i „pękła obudowa" przy zdjęciu kosiarki czyta się w biegu. Kolumna dowodów
stawia obok siebie ofertę i kartotekę — przy „niezgodny z opisem", czyli
siedemnastu sprawach na sto, różnica między nimi bywa całą sprawą. Oś rozmowy
rysuje zdjęcia klienta wprost, bo zdjęcie pękniętego elementu bywa całym
zgłoszeniem; typ rozstrzyga sygnatura pliku, nie jego nazwa. Od 0.246.0 oś
reklamacji i oś skrzynki rysują załącznik tą samą powłoką (§4.2): odmowa
Allegro stoi pod nazwą pliku zdaniem z serwera i daje „Spróbuj ponownie",
a nieudane pobranie mówi o sobie zamiast milczeć.

Rozmowa dociąga się taktem, nie wejściem na ekran, więc świeża sprawa bywa
przez chwilę niepełna. Ekran mówi to wprost, zamiast pokazywać urwaną rozmowę
jak całą.

### 25b.7. Odpowiedź w rozmowie (0.224.0)

Przyrost drugi zamyka połowę pętli: **odpowiedź wychodzi z panelu**. Agent
widzi sprawę, termin, towar i zdjęcie usterki w jednym oknie, więc nie ma po
co otwierać Centrum Sprzedaży, żeby napisać jedno zdanie.

Wysyłamy `type: "REGULAR"` i sam tekst. Bez załączników wychodzących i bez
typów `RETURN_*` — te są formalnym stanowiskiem sprzedawcy wobec kupującego
i idą razem z werdyktem, nie przed nim (§25b.8).

**Klucz idempotencji liczy SERWER, nigdy panel.** Gdyby podawał go klient,
dwie zakładki dałyby kupującemu dwie odpowiedzi. Jeden wiersz w kolejce
`reklamacja_outbox` opisuje jedną PRÓBĘ, a nie jedną wysłaną wiadomość, więc
timeout zostawia ślad `send_uncertain` zamiast ciszy.

Trzy powody odmowy i każdy każe co innego zrobić:

| powód | co widzi agent |
|---|---|
| rozmowa zamknięta po stronie Allegro | zdanie zamiast pola do pisania |
| rozjazd wersji sprawy | zdanie pod polem: odśwież i spróbuj jeszcze raz |
| ktoś dopisał wiadomość | dialog z jawną zgodą, szkic nietknięty |

Trzeci przypadek to blizna 0.110.0 i dialog jest ten sam, co w skrzynce —
z jedną różnicą: nazywa autora dopisku. Rozmowa reklamacyjna bywa trójstronna,
więc dopisał ją czasem doradca Allegro, a nie kupujący.

**Punktem odniesienia świeżości jest ostatnia NIE nasza wiadomość** — o roli
innej niż `SELLER`, więc także doradcy. Własna odpowiedź punktu nie przesuwa,
inaczej druga wiadomość z rzędu wyglądałaby na spóźnioną. Doradca odpisał
w 61 sprawach na 100, a jego zdanie zmienia to, co należy napisać, dokładnie
tak samo jak dopisek klienta.

Limit `text` to 20 000 znaków i **panel blokuje przed wysłaniem**, bo zna go
ze specyfikacji. W skrzynce limit 2000 pilnuje wyłącznie serwer, więc tam agent
dowiaduje się o przekroczeniu dopiero po kliknięciu.

`status_allegro` nie jest przestawiany po wysyłce. Należy do Allegro, a sprawa
wychodzi z DO ODPOWIEDZI przy najbliższej synchronizacji.

### 25b.8. Werdykt do Allegro (przyrost trzeci, 0.242.0)

Kryterium §25 „bez otwierania panelu Allegro" jest przy reklamacji spełnione:
uznanie albo odrzucenie wychodzi z paska nad rozmową przez
`POST /sale/issues/{id}/status` (`ClaimStatusChangeRequest`,
`required: [status, message]`). Decyzje właściciela z 9.09.2026: częściowy
zwrot pieniędzy WCHODZI z kwotą wpisaną przez agenta; po uznaniu jest krok
„towar do odesłania?".

**Dwa przyciski, potem lista.** „UZNAJĘ" otwiera cztery `ACCEPTED_*`,
„ODRZUCAM" siedem `REJECTED_*`; jedenaście pozycji w jednym `select` to
jedenaście decyzji naraz. Etykiety po polsku stoją w `reklamacje/statusy.ts`
(lista wyboru) i w `services/reklamacje.ts` (zdanie na wierszu). Kod spoza
mapy nie kompiluje się.

**Wiadomość jest wymagana i czyta ją kupujący.** Allegro nie przyjmie
werdyktu bez niej, więc panel mówi to przy polu, a nie po kliknięciu. Limit
20 000 znaków jak w czacie — schemat `message` nie ogranicza, a agent nie ma
uczyć się dwóch liczb dla dwóch pól tego samego ekranu. Kopia wiadomości
zostaje na wierszu z przyciskiem „Kopiuj", bo Allegro nie oddaje jej w czacie.

**Kwota tylko przy częściowym zwrocie, w groszach, z sufitem nazwanym
zdaniem.** Serwer pilnuje `> 0` i sufitu: kwota, o którą prosił klient (gdy
prosił o częściowy zwrot i ją podał), inaczej cena oferty × `offer.quantity`
(kolumna `ilosc`), inaczej bez sufitu — bez ilości NIE zgadujemy jednej
sztuki. Kwota przy innym werdykcie to błąd, nie cicha utrata. Na drut idzie
`partialRefund: { amount: "40.00", currency }` — `amount` jako tekst, bo tak
mówi schemat `Price`.

**Potwierdzenie zamiast cofnięcia (§25a.5).** Allegro drugiego werdyktu
w tej samej sprawie nie przyjmie, więc przycisk „WYŚLIJ WERDYKT" bramkuje
zgoda: „Rozumiem: werdykt jest nieodwracalny i razem z wiadomością trafia do
kupującego". Trasa stoi za `autoryzuj("reklamacja_werdykt")` (biuro, admin)
z wpisem `privileged` — jak oddanie pieniędzy przy zwrocie. Wersja sprawy
z ekranu jest obowiązkowa: werdykt bez wiedzy, na co agent patrzył, to werdykt
w ciemno.

**Los próby stoi na wierszu, nie w outboxie.** Werdykt jest jeden na sprawę,
więc tabela prób miałaby jeden wiersz na klucz. `werdykt_status` przechodzi
`sending` → `sent` / `send_failed` (odmowa kodem; wolno ponowić) /
`send_uncertain` (timeout; drugiego strzału NIE MA, pasek mówi „sprawdź
w Centrum Sprzedaży, nie wysyłaj drugi raz"). Próba zapisana ZANIM wyjdzie,
strzał poza transakcją. `status_allegro` zostaje własnością Allegro:
synchronizacja potwierdza `send_uncertain` → `sent`, gdy odda tę samą gałąź
(`CLAIM_ACCEPTED` przy uznaniu), a przy gałęzi przeciwnej nazywa porażkę —
werdykt zapadł poza panelem. Zieleń „Potwierdzony przez Allegro" należy się
dopiero statusowi z synchronizacji (wzór pieniędzy z 0.209.0).

**Werdykt z Centrum Sprzedaży nie udaje naszego.** `werdykt` pusty przy
`CLAIM_ACCEPTED` to sprawa rozstrzygnięta poza panelem i pasek mówi to wprost;
czipa w kolejce taka sprawa nie ma. Pochodzenie decyzji jest informacją.

**Krok „towar do odesłania?" po uznaniu.** Dwa przyciski, zdanie startowe do
edycji, wysyłka tą samą kolejką co odpowiedź (`reklamacja_outbox.typ`:
`RETURN_REQUIRED_CUSTOM` albo `RETURN_NOT_REQUIRED`), z tą samą świeżością
i tym samym dialogiem po dopisku. Decyzja zapisuje się na wierszu po wyjściu
próby i tylko raz; `returnRequired` z Allegro jest jej potwierdzeniem, nie
założeniem — `[WERYFIKUJ]` w `docs/allegro-ksztalt.md`: specyfikacja nie
łączy `RETURN_*` z `returnRequired` ani jednym zdaniem.

**Do dziennika idą długości i kody, nigdy treść:** `reklamacja_werdykt_proba`
(werdykt, liczba znaków, kwota), `reklamacja_werdykt` (los, kod HTTP),
`reklamacja_zwrot_towaru` (decyzja, liczba znaków), `privileged` (operacja).

### 25b.9. Czego panel nie wie

Czy rozmowa mieści się w stu wiadomościach — sonda tej sekcji nie zdjęła
(`[WERYFIKUJ]` w `docs/allegro-ksztalt.md`). Do której przestrzeni należy
`offer.id` przy sprawie: przykład w specyfikacji pokazuje UUID, a sonda zwykły
tekst.

Z tej listy zeszło w 0.226.1 pytanie o adres sprawy w Centrum Sprzedaży.
Odpowiedź: wzorzec zgadnięty z analogii do zwrotu NIE otwierał niczego —
sprawa ma własną stronę `/claims/{uuid}?sellerId={id}`, a numer czytelny
w adresie jest bezużyteczny.

## 25c. Dyskusje

Zaprojektowane 9 września 2026, zbudowane w 0.245.0. Jeden przyrost, nie trzy:
maszyneria reklamacji stała już gotowa, więc do napisania został model pracy
i ekran, a nie integracja.

### 25c.1. Czym jest dyskusja

Rozmową posprzedażową, którą kupujący otwiera przy zamówieniu, gdy coś poszło
nie tak, a nie chce jeszcze składać reklamacji. Allegro trzyma ją tym samym
zasobem co reklamację i różnicuje polem `type`.

**Dyskusja to NIE reklamacja i nie wolno ich skleić.** Reklamacja ma zegar,
formalny werdykt i tytuł prawny. Dyskusja nie ma żadnego z tych trzech: pola
`decisionDueDate`, `statusDueDate`, `reason`, `right`, `expectations`
i `referenceNumber` są dla niej w schemacie opisane jako puste. Sklejenie ich
jedną plakietką kosztowało już wydanie — blizna 0.121.0.

Trzecią stroną rozmowy bywa **doradca Allegro**. Sonda widziała go jako autora
ostatniej wypowiedzi w 61 sprawach na 100. To przypadek typowy, nie brzegowy.

### 25c.2. Co panel dokłada

To samo, czego Centrum Sprzedaży nie daje: kolejkę z porządkiem, właściciela
sprawy i notatkę z ustaleń. Panel niczego tu nie spina z Subiektem — dyskusja
żyje w całości w Allegro.

### 25c.3. Kolejka bramek

Ekran nie jest rejestrem. Praca dzieli się na kubełki, a w każdym stoi jedno
pytanie — operator nie wybiera akcji z menu, tylko odpowiada.

| kubełek | pytanie | skąd |
|---|---|---|
| DO ODPOWIEDZI | co odpisać? | rozmowa otwarta, ostatnie słowo NIE nasze |
| CZEKA NA KLIENTA | — | rozmowa otwarta, ostatnie słowo nasze |
| ZAMKNIĘTE | — | `DISPUTE_CLOSED` albo rozmowa zamknięta przez Allegro |

Trzy kubełki, tyle samo co przy reklamacjach, więc klawisze `1`–`3` zachowują
naturę. Strzałki chodzą po kolejce, cyfry przełączają kubełek, a przełączenie
przestawia kursor na pierwszą sprawę. Skróty milkną w polu tekstowym.

**Doradca Allegro stawia piłkę po NASZEJ stronie** i to jest jedyna reguła,
która różni ten ekran od reklamacji. Tam `ALLEGRO_ADVISOR_REPLIED` jest samym
sygnałem. Gdyby tak zostało tutaj, większość dyskusji siedziałaby w CZEKA NA
KLIENTA, podczas gdy czeka Allegro.

### 25c.4. Pilność bez zegara

Allegro nie oddaje dla dyskusji żadnego terminu. Porządek liczymy więc sami
i mówimy o tym wprost.

Miarą jest **czas od ostatniej NIE naszej wiadomości** — czyli od kiedy ruch
należy do nas. Na wierszu stoi zdanie „czeka 5 dni". Gdy ruch należy do
klienta albo rozmowa jest zamknięta, nie stoi nic: liczba bez znaczenia jest
gorsza od jej braku.

**To nie jest termin i nie wolno go tak nazwać ani tak pokazać.** Blizna
0.121.0 to ustawowy zegar czternastu dni liczony przez nas samych, rozjeżdżający
się z tym, co widział kupujący. Tutaj liczymy fakt o WŁASNEJ skrzynce, nie
zobowiązanie wobec klienta — i dlatego zdanie mówi „czeka", a nie „zostało".
Ranga wizualna jest inna niż czerwony termin reklamacji.

Próg wyróżnienia to trzy dni, ta sama liczba co przy terminie reklamacji.
Agent nie ma uczyć się dwóch progów na dwóch ekranach tego samego panelu.

Kolejka idzie od najdłużej czekających. Sprawy, w których ruch należy do
klienta, stoją za nimi — nie czekają na nas, więc nie mają pilności.

### 25c.5. Sygnały

Pięć, każdy z jednym powodem istnienia.

**Klient czeka** — ruch należy do nas. **Doradca** — ostatnie słowo miało
Allegro; zmienia ton odpowiedzi, bo czyta ją trzecia strona. **Czat zamknięty**
— `chatActive` jest fałszem, więc nie wyjdzie stąd ani wiadomość, ani prośba
o zakończenie. **Nierozstrzygnięta** — `DISPUTE_UNRESOLVED`; sonda nie widziała
ani jednej na sto, więc gdy się pojawi, jest wiadomością samą w sobie.
**Status?** — wartość spoza `PostPurchaseIssueStatus`, czyli sygnał, że lista
w kodzie się zestarzała.

Odpadają wszystkie sygnały reklamacyjne: termin, zwrot towaru i trzy o losie
werdyktu. Dyskusja żadnego z tych bytów nie ma.

### 25c.6. Układ

Trzy kolumny, jak §10.1, jak zwroty i jak reklamacje. Cztery ekrany obsługi
mają mieć jeden nawyk, nie cztery. Kolumna faktów ma **sekcje, nie zakładki**:
to jedna lista faktów o jednej sprawie.

Środek okna niesie rozmowę, bo po to agent otwiera ten ekran. Rola autora jest
podpisem, a nie ozdobą — bez wyraźnego podpisu agent odpowiadałby doradcy tak,
jak odpowiada klientowi.

Dwie różnice wobec ekranu reklamacji, obie wymuszone przez dane:

**Wiersz kolejki nie ma zdjęcia oferty.** Pole `offer` jest w schemacie opisane
jako nieobecne przy dyskusji. Zamiast obrazu stoi numer zamówienia.

**Kolumna faktów jest chudsza i ma to powiedzieć.** Dyskusja nie niesie powodu,
oczekiwania, prawa ani kwoty. Zostaje kupujący, zamówienie razem ze zwrotami
tego samego zamówienia, data otwarcia, status, załączniki, notatka biura i „kto
prowadzi". Puste miejsce po polach, których nie ma, byłoby gorsze od zdania.

### 25c.7. Odpowiedź w rozmowie

Wychodzi z panelu, tą samą maszynerią co odpowiedź w reklamacji: `type:
"REGULAR"`, limit 20 000 znaków sprawdzany PRZED wysłaniem, klucz idempotencji
liczony przez serwer, jeden wiersz na próbę.

Bramka `chatActive` stoi przed strzałem, żeby agent zobaczył zdanie zamiast
surowego kodu 409. Przy zamkniętej rozmowie **edytora nie ma w drzewie** — nie
jest wyłączony. Pole, w które wolno pisać, a którego nie da się wysłać, jest
obietnicą bez pokrycia.

Punktem odniesienia świeżości jest ostatnia NIE nasza wiadomość, więc także
wypowiedź doradcy. Załączników wychodzących nie ma.

### 25c.8. Prośba o zakończenie

Jedyna operacja zapisu, którą Allegro przewiduje **wyłącznie dla dyskusji**.
Werdykt tu nie istnieje: `POST /sale/issues/{id}/status` ma w specyfikacji
adnotację „Not a valid operation for disputes".

**Przycisk nazywa się POPROŚ O ZAKOŃCZENIE, nie ZAKOŃCZ.** Enum nazywa tę
wartość `END_REQUEST` — żądaniem zakończenia. Ani schemat, ani opis nigdzie nie
obiecują, że dyskusja zamknie się od naszego kliknięcia. Przycisk obiecujący
więcej, niż mówi specyfikacja, to ten sam rodzaj zgadywania, który do 0.155.0
trzymał w kodzie adres `/sale/disputes/{id}/messages` — adres, którego Allegro
nigdy nie miało.

Wiadomość jest wymagana i czyta ją kupujący. Limit ten sam co w czacie.

`status_allegro` nie jest przestawiany po wysyłce. Należy do Allegro,
a potwierdzenie przynosi synchronizacja — jak zieleń przy pieniądzach z 0.209.0
i przy werdykcie z 0.242.0.

Los prośby ma WŁASNE kolumny, nie `werdykt_*`. Werdykt rozstrzyga reklamację
jedną z jedenastu wartości; prośba niczego nie rozstrzyga. Jedna kolumna na oba
znaczenia kazałaby czytać ten sam zapis raz jako decyzję, raz jako pytanie.

Stany są DWA: „poszła" i „poszła, ale Allegro nie potwierdziło". Porażka kodem
nie dotyka sprawy — zostaje w skrzynce nadawczej, a agent może spróbować raz
jeszcze. Na wierszu stoi wyłącznie to, po czym drugiej próby robić NIE WOLNO.

Potwierdzenie zamiast cofnięcia: „Rozumiem: prośba o zakończenie trafia do
kupującego i nie da się jej cofnąć". Trasa stoi za rolą biura i zostawia wpis
`privileged`. Wersja sprawy z ekranu jest obowiązkowa.

### 25c.9. Co dzielimy z reklamacjami

Jedna tabela, bo Allegro ma jedną przestrzeń identyfikatorów: `{issueId}` jest
w specyfikacji opisane jako „Dispute or claim identifier". Rozróżnia je kolumna
`typ`, a każde zapytanie po obu stronach musi ją nieść — pilnuje tego strażnik
czytający ŹRÓDŁO obu serwisów. Zwolnienie istnieje dla zapisów stojących za
bramką i wymaga zdania z powodem, jak przy celach dotyku na kolektorze.

Jedna synchronizacja, bo obie sprawy przyjeżdżają jedną listą. Drugi przycisk
„synchronizuj teraz" byłby drugim żądaniem o to samo i drugą drogą w limit 429,
więc ekran dyskusji pokazuje stan wspólnego przebiegu i odsyła po odświeżenie
do reklamacji.

Jedna skrzynka nadawcza i jeden klucz idempotencji. Jedne trasy załączników —
klucz jest tym samym wierszem tej samej tabeli, a bramka roli identyczna.

Jeden czat, ten sam komponent. Czyta on ze sprawy TRZY pola i tyle bierze;
gdyby brał całą reklamację, dyskusja musiałaby mu podać dwadzieścia pól
z `null`, z których żadne nie jest o niej prawdą.

Jedna rzecz jest ROZŁĄCZNA i to celowo: nazwy zdarzeń w dzienniku.
`dyskusja_prowadzi`, `dyskusja_notatka`, `dyskusja_odpowiedz`
i `dyskusja_zakonczenie` mówią, z którego ekranu padło kliknięcie. `events`
nie ma retencji i czyta się je po latach.

### 25c.10. Czego panel nie wie

**Co `END_REQUEST` robi naprawdę.** Sonda nigdy tej operacji nie wykonała.
Z nazwy wynika prośba, ze statusu `DISPUTE_CLOSED` — możliwy skutek natychmiastowy.
Znacznik `[WERYFIKUJ]` stoi przy tym w `docs/allegro-ksztalt.md` i schodzi
dopiero po pierwszym udanym zakończeniu na żywym koncie.

**Czy rozmowa mieści się w stu wiadomościach** — to samo pytanie co przy
reklamacji i ta sama odpowiedź: nie wiemy.

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

Pytanie „czy obsługujemy też dyskusje" zeszło z niej dwa razy i za każdym
razem inaczej. W 0.222.0: NIE — panel prowadzi wyłącznie reklamacje.
9 września 2026: **TAK**, dyskusje dostają własną zakładkę (§25c). Pierwsza
odpowiedź stoi tu dalej, bo tłumaczy kod trzech wydań.

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
| Jawna zgoda „odpowiedz mimo to" przy cudzym uchwycie | **działa** od 0.224.1 | flaga `mimoObecnosci` w ciele wysyłki; do 0.224.0 trasa jej nie deklarowała i gubiła, więc miękka blokada działała jak twarda |
| Szyna zdarzeń do panelu | **działa** od 0.144.0 | `GET /api/conversations/events` |
| Zadania terenowe i kolektor | **działa** od 0.141.0 | `zadanie_terenowe`, `FieldTasksScreen.kt` |
| Wynik z hali na osi rozmowy | **działa** od 0.144.0 | `conversation_event`, `field_task_result` |
| Wyszukiwarka towaru w panelu | **działa** od 0.145.0 | `panel/src/wyszukiwarka.tsx` |
| Kartoteka wywiedziona z oferty | **działa** od 0.152.0 | `services/dopasowanie-sku.ts`, `offer.external.id` |
| Powód braku kartoteki i licznik | **działa** od 0.154.0 | `Dopasowanie.powod`, `bilansKartotek` |
| Pamięć wskazań oferta–kartoteka | **działa** od 0.154.0 | `oferta_kartoteka`, wzorzec `ean_alias`; od 0.219.0 ważna tylko przy tej samej sygnaturze (`pamiecAktualna`) |
| Przestrzeń identyfikatora oferty w zwrocie | **niepotwierdzona** | złączenie po obu kolumnach, `poKolumnie` |
| Statusy rozmowy (§7) | **działa** od 0.158.0 | `conversation.status`, `ustawStatus`, kubełki kolejki |
| Uchwyt rozmowy — przydział na czas oglądania | **działa** od 0.159.0 | `conversation-realtime.ts`, w pamięci |
| Odpowiedź przydziela rozmowę na stałe | **działa** od 0.159.0 | `services/wysylka.ts` |
| `waiting_for_internal` z pomiaru i wyniku hali | **działa** od 0.159.0 | `zlecPomiar`, `dopiszZdarzenieWyniku` |
| Kto ma ruch — wyliczane z ostatniej wiadomości | **działa** od 0.225.0 | `statusZKierunku`; trasa przyjmuje tylko `STATUSY_RECZNE` |
| Autoodpowiedź nie liczy się jako nasz ruch | **działa** od 0.227.0 | `message.auto_odpowiedz`, liczone przy zapisie w `zapiszWiadomosc` |
| Pasek o nowej wiadomości tylko przy kliencie | **działa** od 0.228.0 | kierunek w zdarzeniu `message.created` |
| Login kopiuje się kliknięciem | **działa** od 0.228.0 | `LoginKlienta`, `ui/kopiuj.ts` — droga zapasowa dla HTTP |
| Statusy doboru (§7) | **działa** od E1 | `dobor_rozmowy.status`, `services/dobor.ts`, zakładka „Dobór" |
| Kandydaci doboru (§11.2) | **działa** od E3 | `services/kandydaci.ts`: symbol, EAN, OEM, zastosowanie, silnik (0.229.0), pasowanie (0.230.0), oferta, zamiennik, zgodne wymiary (0.241.0), pełny tekst; numer OEM spoza opisów to kandydat bez kartoteki |
| Wymiary z kartotek (§11.2) | **działa** od 0.241.0 | `wymiar_kartoteki`, `services/wymiary.ts`: parser nazw i opisów po imporcie, szczebel „zgodne wymiary" z parametrów doboru, wiersz w pokryciu wiedzy |
| Identyfikatory z opisów (OEM, nr oryg., stare SKU, zamienniki) | **działa** od 0.186.0 | `towar_identyfikator`, `services/identyfikatory.ts`, przebudowa po imporcie w `po-imporcie.ts`; sekcje `Zamiennik:` od 0.234.0 |
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
| Zabudowa silnika (§12) | **działa** od 0.229.0 | `zabudowa_silnika`, `services/silniki.ts`, zakładka „Silniki" na ekranie Wiedza z listą luk |
| Słownik silników (§12) | **działa** od 0.238.0 | `alias_silnika`, `silnikZTekstu` w `services/silniki.ts`, sekcja „Słownik silników" na ekranie Silniki, przycisk „Zaproponuj zabudowę" pod polem Silnik w Doborze |
| Tokeny silników w nazwach kartotek (§12) | **działa** od 0.239.0 | `token_silnika`, `token_silnika_kartoteka`, `services/tokeny-silnikow.ts`, sekcja „Tokeny silników w nazwach kartotek" na ekranie Z opisów, hak po imporcie |
| Pasowanie części (§12) | **działa** od 0.230.0 | `pasowanie_czesci`, `services/pasowania.ts`; przycisk „Pasuje do…" w Doborze, sekcja w kolejce Wiedza, blok przy kartotece w rozmowie |
| Ekran Wiedza — kolejka propozycji | **działa** od E2 | `panel/src/ekrany/Wiedza.tsx`, zakładka w pasku z licznikiem |
| Dowody i negatywy przy doborze | **działa** od E2 | `skrzynka/Dobor.tsx`: dowody wybranej kartoteki, sekcja negatywów, pomiary do wiedzy |
| Copilot — klasyfikacja wiadomości (§14.5) | **działa** od F | `services/copilot-klasyfikacja.ts`, `klasyfikacja_rozmowy`, `copilot_wywolanie`, `skrzynka/Copilot.tsx`; wyłączony domyślnie |
| Copilot — szkic odpowiedzi z faktów (§14.6) | **działa** od 0.231.0 | `services/copilot-szkic.ts`, `szkic_copilota`, przycisk „Ułóż odpowiedź" w edytorze, karta `skrzynka/SzkicCopilota.tsx`; od 0.253.0 wiedza własna modelu wolna, ale każde twierdzenie ma źródło, a pewność przyznaje serwer |
| Copilot — propozycja pasowania z rozmowy (§14.8) | **działa** od 0.240.0 | `pasowanie` w odpowiedzi szkicu, kolumny `pasowanie_propozycja`/`pasowanie_ocena` w `szkic_copilota`, karta „Copilot rozpoznał pasowanie" w `skrzynka/Dobor.tsx`, pastylka „z Copilota" w kolejce; proponuje agent, rozstrzyga biuro |
| Copilot — dane doboru z rozmowy (§14.7) | **działa** od przyrostu trzeciego | `daneDoboru` w odpowiedzi szkicu, kolumny `dane_doboru`/`dane_ocena` w `szkic_copilota`, karta „Copilot rozpoznał w rozmowie" w `skrzynka/Dobor.tsx`; wpisuje agent, tylko w puste pola |
| Copilot — OCR, kandydaci, porównanie (§14.1) | **projekt** | etap F, przyrosty dalsze |
| Front na TanStack, Router, shadcn | **działa** od 0.146.0 | `panel/src/api/`, `panel/src/ui/` |
| Testy frontu (Vitest, Playwright) | **działa** od 0.146.0 | `panel/src/**/*.test.tsx`, `panel/e2e/` |
| Audyt mutacji rozmowy | **działa** od 0.145.1 | `logEvent` w `services/conversations.ts` |
| Status synchronizacji (§7) | **działa** od 0.147.0 | `statusSynchronizacji` |
| Trwały alarm synchronizacji (§21) | **działa** od 0.147.0 | `skrzynka/AlarmSynchronizacji.tsx` |
| Ustawienia obsługi za zębatką (§21) | **działa** od 0.168.0 | `panel/src/ekrany/Ustawienia.tsx`, trasa `/obsluga/ustawienia` |
| Wiązanie kartoteki po sygnaturze BEZ zatwierdzania | **działa** od 0.169.0 | `zwiazPewne` w `services/sygnatury.ts`; od 0.220.0 pod parasolem `powiazZaleglosci`, więc błąd Allegro go nie zabiera |
| Pokrycie sygnatur na ekranie ustawień | **działa** od 0.169.0 | `GET /api/obsluga/sygnatury`, `panel/src/ustawienia/PokrycieSygnatur.tsx` |
| Ekran przegranego przejęcia (§6.2) | **działa** od 0.147.0 | `skrzynka/KonfliktPrzejecia.tsx` |
| Wymuszone przekazanie z powodem | **działa** od 0.147.0 | `przekazRozmowe`, rola `admin` |
| Ręczne wskazanie oferty | **działa** od 0.147.0 | `wskazOferte`, `conversation_event` |
| Podgląd kolejki = ostatnia wiadomość klienta | **działa** od 0.167.0 | `LISTA` w `services/skrzynka.ts`, `ostatniaOdKlienta` |
| Zamówienie przy rozmowie (`relatesTo.order`) | **działa** od 0.167.0 | `message.related_order_id`, `skrzynka/ZamowienieRozmowy.tsx`; od 0.215.0 pozycja ze zdjęciem oferty, kartoteką i „Wskaż" |
| Oferta przy rozmowie (`relatesTo.offer`) | **działa** od 0.178.0 | `offer_snapshot`, `services/allegro-oferty-sync.ts`, `skrzynka/OfertaRozmowy.tsx`; od 0.215.0 także ze wskazania agenta i z jedynej pozycji zamówienia |
| Kolejność listy rozmów — przełącznik „od najnowszych" | **działa** od 0.215.0 | `skrzynka/Kolejka.tsx`, `odNajnowszych`; domyślnie PILNE i najdłużej czekające |
| Nazwa towaru przy ofercie w rozmowie | **z oferty** od 0.178.0 | `nazwaOferty` — snapshot, a bez niego pozycja zamówienia |
| Kartoteka Subiekta przy rozmowie | **działa** od 0.179.0 | `kartotekaOferty`, `skrzynka/TowarRozmowy.tsx` — stan, półka, zdjęcie; od 0.219.0 jedno trafienie po SKU bez „Zatwierdź" |
| Trzy kolumny w skrzynce (§10.1) | **działa** od 0.180.0 | `skrzynka/Kontekst.tsx`; od 0.198.0 zakładki „Oferta i towar" oraz „Dobór" |
| Opis kartoteki przy rozmowie | **działa** od 0.198.0 | `skrzynka/TowarRozmowy.tsx`, pole `desc` z `/api/products/:twId` |
| Wiersz kolejki wg §10.2 | **częściowo** od 0.181.0 | priorytet, czas oczekiwania, dopiski, zadanie, od E1 status doboru; bez terminu |
| Historia przypisań rozmowy | **działa** od 0.145.1 | `conversation_assignment` |
| Dokument sprzedaży (FS/PA) przy zwrocie | **działa** od 0.174.0 | `sgt_faktura`, `services/faktury.ts` |
| Data doręczenia paczki zwrotnej | **działa** od 0.187.0 | `services/allegro-tracking.ts`, `zwrot_klienta.dostarczono_at` |
| Produkt dopisany do zwrotu przez biuro | **działa** od 0.184.0 | `dopiszPozycje`, `zwrot_klienta_pozycja.zrodlo` |
| Paczka nieodebrana jako osobny byt | **działa** od 0.172.0 | `zwrot_klienta.zrodlo`, `zarejestrujNieodebrana` |
| Zwroty klienckie — odczyt i kolejka | **działa** od 0.150.0 | `services/zwroty.ts`, `panel/src/zwroty/` |
| Synchronizacja zwrotów z Allegro | **działa** od 0.150.0 | `services/allegro-zwroty-sync.ts` |
| Ręczna synchronizacja zwrotów | **działa** od 0.232.0 | `POST /api/obsluga/zwroty/synchronizuj`, przycisk w paśmie filtrów kolejki |
| Kształt zwrotów z dokumentacji, nie z sondy | **niepotwierdzony** | `[WERYFIKUJ]` w `docs/allegro-ksztalt.md` |
| Termin ustawowy w rekoncyliacji | **działa** od 0.210.0 | `zwrotyPoTerminie` w `services/reconcile.ts`; do 0.209.0 pilnował go wyłącznie kolor wiersza |
| Sygnał rozjazdu kwoty z pozycjami | **działa** od 0.210.0 | `kwotaRozjechana`; synchronizator nadpisuje ilość i cenę, kwoty nie przelicza nic |
| Powód odmowy widoczny na zwrocie | **działa** od 0.210.0 | `werdyktPowod`; zapisywał się do bazy i nikt go nie czytał |
| Odmowa zwrotu dociera do klienta | **działa** przez ODMÓW WYPŁATY | werdykt biura jest wewnętrzny; klienta zawiadamia Allegro po zgłoszeniu odmowy wypłaty |
| Utylizacja schodzi ze stanu | **działa** od 0.211.0 | koszyk odpadu, MM z magazynu głównego na `MAG_ID_ODP`; bez tego wpisu wyłączone |
| Ślad po zwrocie pieniędzy przy pobraniu | **nie działa** | `zwrot_pieniedzy_id` wypełnia wyłącznie ścieżka Allegro |
| Rozjazd ilości zgłoszonej i zwróconej | **działa** od 0.212.0 | `zapiszIloscZwrocona`, `ilosc_zwrocona`; liczy biuro przy rozpakowaniu |
| Werdykt biura przy zwrocie | **działa** od 0.156.0 | `rozstrzygnijZwrot`, odmowa wymaga powodu |
| Ocena towaru przy zwrocie | **działa** od 0.156.0 | `ocenPozycje`, `stan`/`utylizacja` — przecena zdjęta w 0.209.0 |
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
| Zwrot tego zamówienia przy rozmowie | **działa** od 0.221.0 | `osRozmowy.zwroty` z `listaZwrotow` po zamówieniu, `skrzynka/ZwrotRozmowy.tsx` |
| Zakładka WSZYSTKIE, filtr przewoźnika, eksport CSV | **działa** od 0.169.0 | `csvZwrotow`, `GET /api/obsluga/zwroty/csv` |
| Załączniki wiadomości — ODCZYT | **działa** od 0.155.0 | `message_attachment`, `GET /api/obsluga/zalaczniki/:id` |
| Zdjęcie klienta widoczne wprost na osi | **działa** od 0.218.0, naprawione w 0.244.0 | `GET /api/obsluga/zalaczniki/:id/podglad` — typ z SYGNATURY bajtów (`rozpoznajMime` × `TYPY_PODGLADU`, także WebP), tylko `SAFE`; odmowa Allegro to 502 ze zdaniem pod nazwą pliku i „Spróbuj ponownie", nie pusta linia; od 0.246.0 kliknięcie powiększa (`towar/Zalacznik.tsx`, wspólne z reklamacjami) |
| Pobranie załącznika Centrum Wiadomości z `api.allegro.pl` | **działa** od 0.248.0 (kandydat od 0.244.0) | `kandydaciPobrania`: `downloadAttachmentGET` BEZ `Accept` (swagger: odpowiedź `*/*`), zapisany `url` jako zapas; sonda właściciela 10 września: 200 `image/jpeg`, z `Accept` 406, `upload.allegro.pl` 403 |
| Załączniki odświeżane przy każdym przebiegu | **działa** od 0.244.0 | `zapiszZalaczniki` upsert po `(message_id, file_name)`, dociąg wątków ze stanem `NEW` (sufit 5), dosypka z lądowiska przy starcie |
| Autoodpowiedź biura zwinięta na osi | **działa** od 0.218.0 | `czyAutoresponder`, pole `automatyczna` w `WpisOsi` |
| Stopka firmowa zwinięta pod odpowiedzią | **działa** od 0.219.1 | `podzielStopke`, pole `stopka` w `WpisOsi` |
| Podpis wiadomości klienta niesie jego login | **działa** od 0.219.2 | `allegro_inbox_thread.interlocutor_login` w zapytaniu osi |
| Załączniki przy odpowiedzi — WYSYŁKA | **działa** od 0.195.0 | `wysylka_zalacznik`, `services/zalaczniki-wysylki.ts`, `skrzynka/Zalaczniki.tsx`; dwukrokowe wgranie do Allegro |
| Wątek oznaczany jako przeczytany w Allegro | **działa** od 0.195.0 | `oznaczPrzeczytanyWAllegro`, `PUT /messaging/threads/{id}/read` po udanej wysyłce |
| Obecność łata wiersz kolejki zamiast pobierać listę | **działa** od 0.196.0 | `setQueryData` w `api/zdarzenia.ts`; pomiar ładunku w `CHANGELOG.md` |
| Wyszukiwanie w kolejce rozmów | **działa** od 0.195.0 | filtr w pamięci ekranu, `skrzynka/Kolejka.tsx` — login, treść, prowadzący |
| Zamówienie klienta przy zwrocie | **działa** od 0.152.0 | `services/allegro-zamowienia-sync.ts` |
| Ręczne dociągnięcie zamówień | **działa** od 0.154.0 | `POST /api/obsluga/zwroty/zamowienia` |
| Zdjęcia towaru w panelu obsługi | **działa** od 0.152.0 | `panel/src/zwroty/useZdjecie.ts` |
| Odnośniki do panelu sprzedawcy | **niepotwierdzone** | `[WERYFIKUJ]`, wzorce w `ALLEGRO_PANEL_*` |
| Czyszczenie lądowisk z danych osobowych | **działa** od 0.152.0 | `services/allegro-oczyszczanie.ts` |
| Zwrot pieniędzy i odmowa w Allegro | **działa** od 0.190.0 | `services/zwrot-pieniedzy.ts`, `panel/src/zwroty/Pieniadze.tsx`; `commandId` stały na zwrot, uprawnienie `payments:write` |
| Numer korekty czytany z Subiekta | **działa** od 0.201.0 | `zwiazKorektyPewne` po `dok_DoDokId`; wiąże tylko pewność, bramki jak u człowieka |
| Automat WYSTAWIANIA korekty przez Sferę | **poza zasięgiem** | pytanie do księgowości: `PAk`, `ZW` czy `ZWn` przy paragonie |
| Rabat transakcyjny — stan przy pozycji | **działa** od 0.164.0 | `services/rabaty.ts`, `allegro_rabat`, `zwrot_klienta.status_allegro` |
| Rabat transakcyjny — złożenie wniosku | **działa** od 0.164.0 | PIERWSZY zapis do Allegro; wymaga `allegro:api:orders:write` |
| Anulowanie wniosku o rabat | **niepotrzebne** | decyzja właściciela: Allegro anuluje wniosek samo |
| Reklamacje — odczyt, kolejka i czat | **działa** od 0.222.0 | `services/reklamacje.ts`, `services/allegro-reklamacje-sync.ts`, `panel/src/reklamacje/` |
| Termin decyzji przy reklamacji | **z Allegro** od 0.222.0 | `decisionDueDate`; sprzed 0.140.0 liczyliśmy go sami i było to błędem |
| Dyskusje (`type: "DISPUTE"`) | **działa** od 0.245.0 | §25c; `services/dyskusje.ts`, `panel/src/dyskusje/` |
| Prośba o zakończenie dyskusji (`END_REQUEST`) | **działa** od 0.245.0, `[WERYFIKUJ]` | `services/dyskusja-zakonczenie.ts` |
| Odpowiedź w czacie reklamacji | **działa** od 0.224.0 | `services/reklamacje-wysylka.ts`, `reklamacja_outbox`, `reklamacje/Edytor.tsx`; `type: "REGULAR"`, sam tekst, limit 20 000 znaków |
| Klucz idempotencji wspólny dla skrzynki i reklamacji | **działa** od 0.224.0 | `services/idempotencja.ts`; liczy go SERWER, format `snd-` nietknięty |
| Świeżość liczona od ostatniej NIE naszej wiadomości | **działa** od 0.224.0 | rola inna niż `SELLER`, więc także doradcy Allegro |
| Werdykt reklamacji do Allegro | **działa** od 0.242.0 | `services/reklamacja-werdykt.ts`, `reklamacje/Werdykt.tsx`; `POST /sale/issues/{id}/status`, jedenaście wartości, kwota przy częściowym, `autoryzuj("reklamacja_werdykt")`, los na wierszu |
| Krok „towar do odesłania?" po uznaniu | **działa** od 0.242.0 | `RETURN_REQUIRED_CUSTOM` / `RETURN_NOT_REQUIRED` przez `reklamacja_outbox.typ`; `[WERYFIKUJ]` mapowanie na `returnRequired` |
| Podgląd załącznika reklamacji na osi | **działa** od 0.223.0, wyrównane w 0.246.0 | typ z SYGNATURY pliku (`rozpoznajMime` × `TYPY_PODGLADU`); przechodzą JPEG, PNG, GIF; od 0.246.0 ta sama powłoka co w skrzynce (`towar/Zalacznik.tsx`), odmowa Allegro 502 / awaria drogi 503 ze zdaniem i „Spróbuj ponownie" (`routes/pobranie.ts`), błąd pobrania widoczny |
| Zdjęcie oferty i kartoteki przy reklamacji | **działa** od 0.223.0 | `offer_snapshot` i `oferta_kartoteka` w kolejce, dwa kafle w dowodach |
| Raport sondy w repo | **działa** od 0.164.0 | `docs/allegro-sonda.md`, obserwacja z 2 września |
