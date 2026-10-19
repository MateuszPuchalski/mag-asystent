# Sellasist — integracja

Przez Sellasist przechodzą wszystkie zamówienia firmy. Tam powstają statusy
realizacji, koszyki i etykiety przewoźnika. WERTIS czyta z niego cztery rzeczy
i pisze jedną. Integracja weszła w 0.592.0. Włączenie opisuje DEPLOY.md,
w sekcji „Sellasist".

Kształt API czytamy z pliku `docs/sellasist/api.yaml`, nie z pamięci. To ta
sama zasada co przy Allegro, opisana w `docs/sellasist/README.md`.

## Co integracja robi

| funkcja | skąd | gdzie widać |
|---|---|---|
| numer dosyłki | etykieta na zamówieniu albo jego kopii | karta sprawy na profilu klienta |
| zbiórki do strefy złotej | koszyk zebranego zamówienia | Analiza → Strefa złota, karta towaru |
| liczba spakowanych paczek | pierwsza etykieta zamówienia | Analiza → Strefa złota |
| „czy wyjdzie dziś" | status, braki i etykieta | fakt w szkicu Copilota |
| notatka do zamówienia | agent na profilu klienta | Sellasist, przy zamówieniu |

Notatka to jedyny zapis do Sellasist. Status, koszyk i etykiety zostają
w rękach magazynu, a automat ich nie dotyka.

## Jak to działa

**Lustro zamówień** (`server/src/services/sellasist-sync.ts`). Webhooków
Sellasist nie ma, a lista zamówień filtruje po dacie złożenia, nie zmiany.
Ticker czyta więc dziennik zmian (`GET /orders_logs`) od kursora. Zmienione
zamówienia trafiają do kolejki, a ich szczegóły pobiera po trzydzieści na
przebieg. Kursor nie czeka na szczegóły, więc setka zmian naraz nie zatrzymuje
dziennika.

**Zebrane i spakowane.** Statusy definiuje firma w swoim Sellasist, więc kod
ich nie zgaduje. Numery statusu „zebrane" stoją w `SELLASIST_STATUSY_ZEBRANE`.
Bez nich dniem zbiórki jest dzień pierwszej etykiety. Spakowane znaczy
wydrukowaną pierwszą etykietę. Obie daty nigdy nie przesuwają się w przód.

**Zbiórki.** Numer pozycji koszyka w API to ten sam numer co „ID Koszyka"
w eksporcie CSV. Wiersz z API i wiersz z pliku nie dublują się więc
w tabeli `zbiorka`, a wiersz wgrany wcześniej wygrywa. Import CSV zostaje
drogą zapasową.

**Dosyłka** (`server/src/services/sellasist-dosylka.ts`). Etykieta dosyłki
ląduje przy oryginale albo przy kopii zamówienia. Sprawdzamy obie drogi.
Kandydaci z Sellasist dołączają do numerów z Allegro i przechodzą tę samą
regułę wyboru (`wybierzNumer`). Numer obecny w obu systemach zapisujemy jako
numer z Allegro, bo klient widzi go przy zamówieniu. Sellasist, który nie
odpowiada, nie zabiera wykrycia z samego Allegro.

**„Czy wyjdzie dziś"** (`server/src/services/realizacja-zamowienia.ts`).
Etykieta wydrukowana dziś daje obietnicę wysyłki dziś, nawet bez terminu
z Allegro. Etykieta z wcześniejszego dnia daje zdanie „paczka wyszła albo
czeka na kuriera". Braki do skompletowania zdejmują obietnicę. Przed szkicem
serwer odświeża zamówienie, gdy lustro jest starsze niż dziesięć minut.

## Prywatność

Z kupującego przechodzi wyłącznie login. Pełna polityka stoi
w `docs/obsluga-klienta.md`, w sekcji „Polityka danych Sellasist".

## Do potwierdzenia sondą

Schemat zostawia otwarte cztery rzeczy. Odpowiada na nie
`npm --prefix server run sellasist:sonda` na żywym koncie:

1. Czy `external_id` zamówień z Allegro to numer formularza zakupu. Po nim
   wiążemy Sellasist z zamówieniami, zwrotami i rozmowami.
2. Czy daty przychodzą w czasie polskim, bez strefy.
3. Czy `object_id` przy zmianie statusu to nowy status zamówienia.
4. Na którą drogę trafia etykieta dosyłki: oryginał czy kopia.

Do czasu sondy integracja działa na odczycie schematu, a nie na obserwacji.
