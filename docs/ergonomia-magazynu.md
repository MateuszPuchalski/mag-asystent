# Ergonomia pracy magazynowej — dekalog

Ten dokument rozstrzyga spory o kształt ekranów magazynowych. Nie jest zbiorem
porad. Jest listą reguł, po których poznaje się zmianę do przyjęcia i zmianę
do wycofania.

Projektujemy dla człowieka, który powtarza tę samą czynność setki razy
na zmianie. Nie projektujemy dla kogoś, kto widzi ekran pierwszy raz.
Nowość wizualna nie jest tu wartością.

Uwaga i pamięć człowieka, jego ruch i czas są zasobami rzadkimi. Interfejs
magazynowy ma oszczędzać wszystkie cztery naraz.

## Zakres

Dekalog obowiązuje kolektor (`android/`) i każdy ekran obsługiwany z towarem
w rękach. Tam liczy się zasięg ręki, rękawica, hałas i odległość do regału.

Biuro (`server/src/web/biuro.html`) i panel obsługi klienta (`panel/`) to praca
przy biurku. Obowiązują tam punkty 1, 2, 5, 6 i 10.

Punkty o celach dotyku, o koszcie fizycznym i o trasie biura NIE obowiązują.
Mysz na blacie ma inną charakterystykę niż kciuk w rękawicy.

**Pierwsze zastosowanie poza kolektorem: dopisanie produktu do zwrotu
(0.184.0).** Cztery punkty naraz:

- **5** — lista pokazuje RÓŻNICĘ zamówienia i zwrotu, nie całe zamówienie.
- **2** — otwiera się na żądanie, tak samo jak potrącenie.
- **6** — nie ma pola tekstowego; zamówienie jest granicą naturalną.
- **1** — przycisk stoi tam, gdzie operator zauważa brak.

Opis stoi w `docs/panel-obslugi-klienta.md` §25a.15.

> **Dlaczego to rozgraniczenie.** Bez niego dekalog albo nie dotyczy niczego,
> albo każe powiększać przyciski w tabeli, którą czyta się na siedząco.
> Reguła bez zakresu przestaje bramkować cokolwiek po pierwszym sporze.

## Dekalog

### 1. Najpierw przebieg pracy, potem ekran

Ekran idzie za czynnością fizyczną, nie odwrotnie. Kolejność jest zawsze ta
sama: gdzie idę, co identyfikuję, co biorę, ile, co dalej.

**U nas.** Rozkładanie prowadzi tą drogą: lista dostaw, pozycje dokumentu,
panel odkładania z adresem. Ekrany i powroty stoją w jednej mapie
(`android/core/src/main/kotlin/pl/wertis/kolektor/core/nav/NavModel.kt`).

**Zabrania.** Kazania człowiekowi szukać następnego kroku w programie, gdy
system ten krok zna.

### 2. Pokazuj tylko to, co potrzebne teraz

Na każdym kroku widać przede wszystkim to, co rozstrzyga bieżącą czynność.
Pierwszeństwo mają: lokalizacja, towar, ilość, czynność.

Reszta zostaje wizualnie drugorzędna albo ukryta. Rozpoznanie jest tańsze
od pamiętania. Nie każ pamiętać tego, co może zostać na ekranie.

**U nas.** Adres ma 28 sp w panelu odkładania i znika z wiersza dopiero wtedy,
gdy krzyczy niżej (`android/app/src/main/kotlin/pl/wertis/kolektor/ui/delivery/DeliveryLinesScreen.kt`).
Szczegóły chowa `Collapsible.kt`, a nie kolejny ekran.

**Zabrania.** Przenoszenia liczby sztuk do poprzedniego ekranu, gdy człowiek
liczy sztuki na tym.

### 3. Ograniczaj liczbę interakcji

Każdy tap, skan, sięgnięcie i przejście między ekranami kosztuje. Przy każdym
pytaj: czy system może to wywnioskować, czy zrobi to skan, czy krok da się
usunąć.

Nie żądaj potwierdzenia, gdy poprzednia czynność już potwierdziła wynik.
Optymalizuj dla użycia dziesięciotysięcznego, nie pierwszego.

**U nas.** Skan sam wybiera drogę: kod towaru otwiera kartę, kod regału
pokazuje zawartość miejsca
(`android/app/src/main/kotlin/pl/wertis/kolektor/ui/scan/ScanRouter.kt`).
Człowiek nie wybiera wcześniej trybu.

**Zabrania.** Okna „czy na pewno" po czynności, którą potwierdził już sygnał
dźwiękowy i wibracja.

> **Granica tej reguły.** Oszczędność interakcji nie usprawiedliwia stanu
> ukrytego. Kontekst przyklejony do skanu oszczędzał siedem skanów na regał
> i pozwalał zapisać adres na niewłaściwy towar. Ten błąd jest cichy: nic nie
> wygląda na zepsute, dopóki ktoś nie pójdzie po ten towar. Wycofaliśmy go.

### 4. Częste czynności mają być łatwe fizycznie

Prawo Fittsa: czas trafienia rośnie, gdy cel maleje albo jest daleko.

Częste sterowanie ma być duże, blisko kciuka i zawsze w tym samym miejscu.
Czynność rzadka albo groźna może wymagać ruchu bardziej świadomego.

**U nas.** Minimalny cel dotyku to 48 dp i ma jedno źródło — `MinTap`
w `android/app/src/main/kotlin/pl/wertis/kolektor/ui/components/Common.kt`.
Pilnuje tego `tools/ergonomia_check.py`.

**Zabrania.** Celowania w mały przycisk podczas pracy powtarzalnej.

### 5. Ograniczaj liczbę decyzji

Prawo Hicka: czas decyzji rośnie z liczbą możliwości. Nie pokazuj pięciu opcji
tam, gdzie przebieg pracy dopuszcza jedną.

Aplikacja ma prowadzić człowieka. To nie człowiek ma nawigować po aplikacji.

**U nas.** Ekran główny nazywa się SKAN / SZUKAJ i nie jest menu. Skaner jest
domyślnym wejściem, klawiatura — awaryjnym.

**Zabrania.** Pytania „co chcesz teraz zrobić", gdy stan pracy zna odpowiedź.

### 6. Zapobiegaj błędom, zanim zaczniesz je tłumaczyć

Ograniczenie jest tańsze od komunikatu. Czynność błędna ma być niemożliwa albo
trudna, jeżeli da się to zrobić bez kalectwa dla reszty.

Komunikat błędu mówi trzy rzeczy po kolei: co jest nie tak, czego program
oczekiwał, co zrobić teraz. Sam kod techniczny nie jest komunikatem.

**U nas.** Lokalizacja to kategoria ZAMKNIĘTA: kod niepasujący do wzorca
z serwera nie jest adresem
(`android/core/src/main/kotlin/pl/wertis/kolektor/core/scan/Scan.kt`).
Wcześniej była kategorią domyślną i zapisywała widmowe adresy.

**Zabrania.** Gołego „Bad Request" na ekranie. Ten konkretny komunikat kupiliśmy
dwa razy i dlatego pilnują go dziś trzy niezależne strażnice.

### 7. Informuj bez wymuszania patrzenia

Człowiek na drabinie nie patrzy w ekran. Sygnał ma dotrzeć uchem albo ręką.

Używaj kilku kanałów naraz: obraz, dźwięk, wibracja, sygnał skanera. Nigdy nie
opieraj znaczenia na samym kolorze.

**U nas.** `android/app/src/main/kotlin/pl/wertis/kolektor/device/Feedback.kt`
niesie trzy sygnały: wybrano, zapisano, błąd. Każdy ma własną wysokość tonu
i własny wzór wibracji. Aplikacja ostrzega przy starcie, gdy kolektor jest
ściszony.

**Zabrania.** Rozróżniania sukcesu i błędu wyłącznie kolorem albo wyłącznie
długością tego samego tonu.

### 8. Licz koszt fizyczny

Ruch jest częścią interfejsu. Licz chodzenie, sięganie, schylanie się, skręty
tułowia, zmianę ręki i drogę między skanerem a ekranem.

Oceniaj iloczyn: częstość razy odległość razy siła razy postawa. Zmiana, która
kasuje setki ruchów na zmianę, jest warta więcej od zmiany ładniejszej.

**U nas.** Towar szybkorotujący należy do strefy złotej — poziomów na wysokości
rąk, bez drabiny i bez schylania.

**Zabrania.** Optymalizowania samych kliknięć, gdy rośnie liczba kroków między
regałem a wózkiem.

### 9. Optymalizuj całą trasę, nie pojedynczy ekran

Patrz na sekwencję: człowiek, urządzenie, regał, towar, wózek, następne
miejsce. Ekran optymalizowany osobno umie pogorszyć całość.

Trasa zbiórki i uzupełnień to nie sama odległość. Liczą się też zawroty,
nawroty, sięgnięcia, schylanie, niesiony ciężar i tłok w alejce.

**U nas.** Trasy nie liczymy jeszcze nigdzie w kodzie. Reguła stoi tu, żeby
pierwsza implementacja nie zaczęła od najkrótszej drogi jako jedynego celu.

**Zabrania.** Uznawania trasy najkrótszej za najtańszą bez pomiaru.

### 10. Mierz ergonomię, nie urodę

Jakość interfejsu magazynowego musi być mierzalna. Bez pomiaru wraca do stanu
wyjściowego przy pierwszej zmianie.

Miary są niżej. Przy każdej zmianie odpowiedz na jedno pytanie: czy skraca czas,
obniża wysiłek umysłowy, obniża wysiłek fizyczny albo zmniejsza liczbę błędów.

Odpowiedź „nie" znaczy, że zmiana czeka. Sama uroda nie jest odpowiedzią.

## Miary

Kolumna **stan** mówi prawdę o dziś, nie o planie.

| miara | skąd | stan |
|---|---|---|
| dotknięcia na pozycję | `/api/metrics`, pole `dotknieciaNaPozycje` | mierzone |
| czas skan → odpowiedź (p95) | `/api/metrics`, pole `p95OdpowiedziMs` | mierzone, próg 150 ms |
| etykiety do przedruku | `/api/metrics`, udział wejść ręcznych per regał | mierzone |
| towary bez czytelnego kodu | `/api/metrics`, udział wejść ręcznych per towar | mierzone |
| cele dotyku poniżej 48 dp | `tools/ergonomia_check.py` | bramkowane |
| liczba spojrzeń na ekran | — | niemierzone |
| droga na zmianie, nawroty | — | niemierzone |
| liczba schyleń i sięgnięć | — | niemierzone |

Czas skan → odpowiedź mierzy KLIENT, nie serwer. Pomiar serwerowy pomija sieć
i rysowanie ekranu, czyli akurat to, co boli przy metalowych regałach.

Powyżej mniej więcej 300 ms ludzie zaczynają skanować dwa razy. Podwójny skan
przy liczeniu sztuk to błąd ilościowy, który wychodzi dopiero przy remanencie.

## Co pilnuje skrypt, a co człowiek

`tools/ergonomia_check.py` mierzy JEDNĄ rzecz: cele dotyku na kolektorze.
Skrypt szuka łańcuchów `Modifier` z `clickable`, które same ustawiają wysokość
poniżej 48 dp.

Reszty dekalogu nie mierzy nikt automatycznie. Liczba decyzji, kolejność
informacji i koszt ruchu zostają do przeglądu przez człowieka.

To ta sama lekcja, co `-DryRun` w `instalator/README.md`. Narzędzie ma mówić,
czego NIE dowodzi. Zielony wynik nie znaczy, że ekran jest dobry.

### Zwolnienia są jawne

Cel mniejszy niż 48 dp wymaga komentarza `ergonomia:` z powodem, w tej samej
linii albo tuż nad łańcuchem. Bez powodu bramka jest czerwona.

Zwolnienie ma być trudniejsze od poprawki, ale możliwe. Punkt 4 sam dopuszcza
ruch bardziej świadomy przy czynności rzadkiej albo groźnej.

Dziś zwolnienia są trzy. Krzyżyk usuwający pozycję z kartonu jest mniejszy
celowo, bo kasuje pracę i stoi tuż przy poprawianiu ilości.

Krzyżyk zwijający wiersz dostawy jest drogą drugą, a nie jedyną. Ten sam skutek
daje powtórny tap w cały pasek.

Wejście w przesunięcie z MGP zostaje na 40 dp, bo pełne 48 rozpycha nagłówek
karty towaru. Było tam kiedyś 15 dp, więc 40 dp to i tak jest naprawa.

## Zasada rozstrzygająca

Przy wyborze między dwoma projektami wygrywa ten, który wymaga: mniej decyzji,
mniej interakcji, mniej uwagi, mniej pamiętania, mniej ruchu, mniej błędów.

Uroda liczy się dopiero po jasności, szybkości, bezpieczeństwie i ergonomii.
W tej kolejności, nie w innej.
