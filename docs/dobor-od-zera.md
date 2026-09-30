# Dobór od zera

Decyzja właściciela z 29 września 2026: dotychczasowy dobór wychodzi
w całości, a nowy powstaje od pytania, na które ma odpowiadać. Ten dokument
jest jego opisem i kontraktem między serwerem a panelem.

## 1. Pytanie

Klient Allegro pyta o część do swojej maszyny. Agent biura ma wysłać jedną
z czterech odpowiedzi:

1. **Ta część.** Wybrana kartoteka i zdanie ze źródłem.
2. **Nie mamy.** Uczciwe „nie", nie porażka.
3. **Dopytać.** Wiadomo, czego brakuje, i agent o to pyta.
4. **Nie dotyczy.** Rozmowa nie jest pytaniem o dobór.

Wszystko inne jest środkiem do jednej z nich. Ekran pokazuje środki tylko
wtedy, gdy prowadzą do odpowiedzi.

## 2. Co wyszło i dlaczego

| Było | Powód usunięcia |
|---|---|
| Dziewięć statusów wybieranych ręcznie | Cztery wynikały z faktów, dwa nie miały żadnej logiki, jeden nie miał nadawcy |
| „Zatwierdź dobór" jako drugi krok | Rola eksperta zniesiona, więc drugie kliknięcie tego samego człowieka niczego nie chroniło |
| Jedenaście dróg na ekranie | To trzy różne pytania: co klient wskazał, co wiedza potwierdza, co jest podobne |
| Droga „zgodne wymiary" i parametry | Podpowiedź bez dowodu, a pole parametrów wypełniało się rzadko |
| Dwie karty Copilota w doborze | Dane wchodzą same od 0.341.0, a pasowanie to praca nad wiedzą |
| Wybór „do maszyny czy do silnika" | To utrzymanie bazy wiedzy, nie odpowiedź klientowi |
| Automatyczny start `searching` i jego cofanie | Stan wyliczany nie ma czego cofać |
| Raport skuteczności po jedenastu drogach | Nowy liczy wyniki i podstawy wyboru |

## 3. Co zostaje bez zmian

Reguły właściciela i blizny z incydentów obowiązują dalej:

- Automat **nigdy nie wybiera** części ani nie zatwierdza wiedzy.
- Roli eksperta nie ma. Decyduje każdy z biura.
- Zdanie do szkicu pisze **serwer**, ze źródłem i bez nazwiska (§14.3).
- Brak dowodu w bazie wiedzy oznacza przypuszczenie. Słowo „pasuje" bez
  „prawdopodobnie" wolno napisać tylko przy potwierdzonym wpisie.
- Kandydatów szuka się wyłącznie z **danych doboru**, nigdy z treści
  wiadomości. Wyszukiwanie po symbolu bez literówek (blizna „szarpaka").
- Trafienie po numerze jest oznaczone jako mocne (blizna koła pasowego TC38).
- Wpis bez wariantu jest drugą próbą i daje najwyżej „prawdopodobne".
- Maszyna z kilkoma silnikami nie daje „potwierdzone".
- Numer bez kartoteki nie znika, bo „nie mamy" jest odpowiedzią.
- Źródła danych zostają: baza wiedzy, identyfikatory, silniki, pasowania,
  warunki zastosowań i indeks pełnotekstowy.

## 4. Model

### 4.1. Dane doboru

Osiem pól: marka, model, wariant, rocznik, numer seryjny, silnik, numer
części (`oem`) i nazwa części (`nazwaCzesci`). Copilot wpisuje je sam w puste
pola. Agent je sprawdza i poprawia.

Zmiana marki, modelu, wariantu, rocznika albo numeru seryjnego zdejmuje
wybraną część. Wybór dotyczył innej maszyny.

### 4.2. Wynik

Jeden z czterech: `czesc`, `brak`, `dopytac`, `nie_dotyczy`, albo brak
wyniku. Ustawia go wyłącznie człowiek.

Stan dla kolejki i kokpitu jest **wyliczany**, nigdy zapisywany:

| Stan | Kiedy |
|---|---|
| `pusty` | brak wyniku i puste dane |
| `otwarty` | brak wyniku, dane są |
| `czesc`, `brak`, `dopytac`, `nie_dotyczy` | wynik |

### 4.3. Kandydaci w trzech grupach

| Grupa | Skąd | Pewność |
|---|---|---|
| `numer` — wskazane przez klienta | symbol, EAN, numer z tabeli identyfikatorów, kartoteka oferty, zamienniki | `prawdopodobne`, zamiennik z opisu `do_sprawdzenia` |
| `wiedza` — z bazy wiedzy | zastosowanie do maszyny, przez silnik, pasowanie do części klienta | z wpisu |
| `podobne` — po nazwie | indeks pełnotekstowy | `do_sprawdzenia` |

Kartoteka trafiona kilka razy stoi raz, w pierwszej grupie z kolejności
numer, wiedza, podobne. Dostaje najmocniejszą pewność ze wszystkich źródeł,
a ich zdania idą do pola `takze`.

Kolejność w grupie: pewność, potem dostępność malejąco, potem symbol.

### 4.4. Wiedza rośnie z pracy

Ustawienie wyniku `czesc` przy znanej marce i modelu tworzy **propozycję**
zastosowania z dowodem „rozmowa", nigdy fakt. Zejście z tej części wycofuje
własną, nierozstrzygniętą propozycję. Obie rzeczy dzieją się w jednej
transakcji z wynikiem.

## 5. Kontrakt

### 5.1. Typy

```ts
type DaneDoboru = {
  marka: string | null; model: string | null; wariant: string | null;
  rocznik: string | null; nrSeryjny: string | null; silnik: string | null;
  oem: string | null; nazwaCzesci: string | null;
};
type WynikDoboru = "czesc" | "brak" | "dopytac" | "nie_dotyczy";
type StanDoboru = "pusty" | "otwarty" | WynikDoboru;
type PodstawaWyboru = "numer" | "wiedza" | "podobne" | "reczny";

type Dobor = {
  stan: StanDoboru;
  wynik: WynikDoboru | null;
  wersja: number;
  dane: DaneDoboru;
  /** Tylko przy wyniku `czesc`. */
  wybrany: { twId: number; symbol: string; podstawa: PodstawaWyboru; zdanieDoSzkicu: string } | null;
  /** Tylko przy wyniku `dopytac`. */
  dopytac: string | null;
  zmienil: string | null;
  /** Ostatni zapis zrobił automat, nie człowiek. */
  zmienilAutomat: boolean;
  zmienionoAt: string | null;
};

type GrupaKandydata = "numer" | "wiedza" | "podobne";
type PewnoscKandydata = "potwierdzone" | "prawdopodobne" | "do_sprawdzenia";
type KandydatDoboru = {
  twId: number; symbol: string; nazwa: string;
  /** Dostępne na magazynie głównym; `null` = brak stanu. */
  stan: number | null;
  grupa: GrupaKandydata; pewnosc: PewnoscKandydata;
  /** Jedno zdanie: skąd ten kandydat. */
  powod: string;
  /** Zdania innych źródeł, które trafiły w tę samą kartotekę. */
  takze: string[];
  /** Zastrzeżenia: warunek, kilka silników, negatyw z wiedzy. */
  ostrzezenia: string[];
};
type KandydaciDoboru = {
  kandydaci: KandydatDoboru[];
  /** Numery z pola `oem` bez kartoteki. Nie da się ich wybrać. */
  bezKartoteki: Array<{ numer: string; zdanie: string }>;
  negatywne: Array<{ twId: number; symbol: string; nazwa: string | null; powod: string; zrodlo: string }>;
  /** Czego zabrakło do szukania, zdaniami. Pusta lista = sprawdzono wszystko. */
  brakuje: string[];
};

type MiaryDoboru = {
  dni: number;
  /** Ostatni wynik każdej rozmowy z oknem, z dziennika zdarzeń. */
  wyniki: Record<WynikDoboru, number>;
  /** Podstawy przy wyniku `czesc`. */
  podstawy: Record<PodstawaWyboru, number>;
  /** Stan dziś: rozmowy w stanie `otwarty`. */
  otwarte: number;
};
```

### 5.2. Trasy

| Metoda i ścieżka | Ciało | Odpowiedź |
|---|---|---|
| `GET /api/obsluga/rozmowy/:id/dobor/kandydaci` | — | `KandydaciDoboru` |
| `PUT /api/obsluga/rozmowy/:id/dobor/dane` | `{ dane: Partial<DaneDoboru>, expectedVersion }` | `Dobor` |
| `PUT /api/obsluga/rozmowy/:id/dobor/wynik` | `{ wynik: WynikDoboru \| null, twId?, podstawa?, dopytac?, expectedVersion }` | `Dobor` |
| `GET /api/obsluga/rozmowy/:id/dobor/wiedza` | — | jak dotąd, bez `silnikZPola` |
| `POST /api/obsluga/rozmowy/:id/dobor/pomiar-do-wiedzy` | jak dotąd | jak dotąd |
| `GET /api/obsluga/miary-doboru?dni=30` | — | `MiaryDoboru` |

`Dobor` jedzie też w odczycie rozmowy, jak dotąd. Wiersz kolejki niesie
`dobor: StanDoboru`. Nieaktualna wersja daje 409 tym samym mechanizmem, co
dotąd (`ConversationConflict`).

Wynik `czesc` wymaga `twId` i `podstawa`. Wynik `dopytac` wymaga
niepustego `dopytac`. Wynik `null` otwiera dobór ponownie.

### 5.3. Zdarzenia

- Oś rozmowy: `dobor_wynik` z `{ przed, po, symbol, podstawa, autor }`.
  Oś tłumaczy stare zdarzenia `dobor_status_changed` na nowe stany, więc
  panel zna tylko nowe nazwy.
- Dziennik: `dobor_dane` i `dobor_wynik`.

### 5.4. Baza

Nowa tabela `dobor`. Migracja kopiuje wiersze z `dobor_rozmowy` raz,
tłumacząc status i drogę na wynik i podstawę. Stara tabela zostaje
nietknięta do następnego wydania. Powód: powrót do poprzedniej wersji musi
zastać jej dane.

## 6. Ekran

```
Dobór                                                     ● Otwarty
┌ Czego szuka klient ───────────────────────────────────── Popraw ┐
│ Maszyna  NAC LS 46-450 HS (2019) · silnik B&S 450E               │
│ Część    szarpak rozrusznika · nr 532 19 93-77                   │
└──────────────────────────────────────────────────────────────────┘
Wskazane przez klienta
  [zdjęcie] Szarpak rozrusznika            dostępne 28   [Wybierz]
            532199377 · trafienie po numerze z opisu kartoteki
Z bazy wiedzy
  [zdjęcie] …                              dostępne 3    [Wybierz]
Podobne po nazwie (2) ▸
Nie pasuje: …
─────────────────────────────────────────────────────────────────────
[Nie mamy]  [Dopytaj o…]  [Nie dotyczy]      wskaż z wyszukiwarki
```

Po wyborze wynik zastępuje listę: część, zdanie ze źródłem, „Wstaw do
odpowiedzi", „Zleć pomiar" i „Zmień". Lista wraca po „Zmień".

Karta pasowania rozpoznanego przez Copilota przeszła do wiersza „Wiedza".

## 7. Czego ten dobór nie wie

- Nie ma danych z produkcji o tym, które grupy dają wybierane części.
  Miary doboru zaczynają je zbierać od tego wydania.
- Stare zdarzenia wyboru mówią o drogach, nie o grupach. Miary liczą tylko
  zdarzenia `dobor_wynik`.
