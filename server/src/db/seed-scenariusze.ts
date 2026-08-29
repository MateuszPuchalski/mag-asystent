import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, transaction } from "./db.js";
import { config } from "../config.js";
import { hashSekret } from "../services/users.js";
import { kupujacyIdZMaski, przebudujSprawy } from "../services/sprawa.js";
import { dosypOsCzasu } from "../services/os-sprawy.js";
import { etykietyDostaw } from "../adapters/subiekt.seeded.js";

/* ── Seed scenariuszy — dane pod przypadki brzegowe ──────────────────────────
   `npm run seed` daje KARTOTEKĘ: 3415 prawdziwych towarów i kilkanaście
   dokumentów dostaw. Wystarcza do pokazu ścieżki codziennej i nie wystarcza do
   niczego więcej. Przypadki, na których aplikacja naprawdę się łamie — kolizja
   EAN, zadanie w błędzie, zdjęcie bez pliku, adres spoza wzorca —
   trzeba było dotąd zbudować ręcznie, za każdym razem od nowa, i w połowie
   z nich nie dało się tego zrobić z ekranu wcale (nikt nie wystawi z kolektora
   zadania w statusie `waiting_for_doc` sprzed pięciu dni).

   Ten skrypt buduje je wprost w bazie. Każdy przypadek ma numer, tytuł i punkt
   wejścia; katalog stoi niżej w `KATALOG` i jest tym samym katalogiem, co
   `docs/scenariusze-testowe.md` — pilnuje tego test, nie oko.

   TRZY REGUŁY, KTÓRE TEN SEED NA SIEBIE NAKŁADA:

   1. NIE TYKA DANYCH SPOZA SWOJEGO ZAKRESU. Kartoteki scenariuszy mają
      `tw_id >= 900001`, dokumenty `dok_id >= 9001`, konta swoje loginy.
      Uruchomienie go po `npm run seed` niczego z niego nie kasuje.
   2. JEST IDEMPOTENTNY. Każde uruchomienie kasuje NAJPIERW własne wiersze,
      potem buduje je od nowa. Wielokrotne odpalenie daje ten sam stan bazy,
      więc da się nim wrócić do punktu wyjścia w środku pracy.
   3. NIE URUCHAMIA SIĘ NA PRAWDZIWEJ BAZIE. `SGT_MODE=mssql` przerywa go bez
      zapisu: zakłada konta ze znanymi hasłami i wystawia gotowe tokeny sesji,
      czyli robi dokładnie to, czego na produkcji robić nie wolno.

   Dane są DETERMINISTYCZNE — zero `Math.random()`. Scenariusz, który raz na
   pięć uruchomień wygląda inaczej, jest gorszy niż jego brak: nie da się
   powiedzieć, czy zmiana na ekranie to skutek poprawki, czy losowania.       */

/* ── Zakresy identyfikatorów ────────────────────────────────────────────────
   Rozdział jest tu jedynym mechanizmem chroniącym dane z `npm run seed`.
   Kartoteka z eksportu numeruje się od 1 w górę (3415 pozycji), dokumenty
   dostaw i zamówienia — od 1 do kilkudziesięciu. Zakresy niżej stoją tak
   wysoko, żeby kartoteka mogła urosnąć dziesięciokrotnie i nadal się nie
   zderzyć.                                                                   */

/** Pierwsze `tw_id` kartotek scenariuszowych. */
export const TW_OD = 900_001;
/** Pierwszy `dok_id` dokumentów scenariuszowych (dostawy i zamówienia). */
export const DOK_OD = 9_001;
/** Pierwszy `dok_id` dokumentów WZ z historią pobrań (raport przeslotowania). */
export const DOK_WZ_OD = 20_001;
/** Pierwszy `dok_id` dokumentów sprzedaży (FS/PA) pod zwroty Allegro. */
export const DOK_SPRZ_OD = 30_001;
/** Przyjęcia na regał zwrotów (MM z Subiekta) — kosze z kartką na hali. */
export const DOK_MM_OD = 41_200;

/**
 * Symbol wydania z magazynu w read-modelu `sgt_*`.
 *
 * Stoi TUTAJ, bo tutaj powstają jedyne takie dokumenty w całym systemie:
 * importer MSSQL wciąga wyłącznie dostawy i zamówienia, więc na produkcji
 * `sgt_dokument` nie ma ani jednego WZ. `reslot-run.ts` czyta tę stałą,
 * zamiast powtarzać napis — dwie kopie rozjechałyby się przy pierwszej zmianie
 * i raport pokazałby zero pobrań bez słowa błędu.
 */
export const TYP_WZ = "WZ";

/* Magazyny bez roli — te same identyfikatory, co w `seed.ts`. Powtórzone
   świadomie: seed scenariuszy ma działać także na PUSTEJ bazie, więc nie może
   zakładać, że ktoś je wcześniej założył. `INSERT OR IGNORE` niżej sprawia, że
   uruchomienie po `npm run seed` zostawia tamte wiersze nietknięte. */
const MAG_SERWIS = 91;
const MAG_EKSPOZYCJA = 92;
const MAG_ARCHIWUM = 93;

/** Hasło wszystkich kont scenariuszowych. Jawne, bo to jest dane demo. */
export const HASLO_SCENARIUSZY = "wertis12345";

/** Loginy zakładane przez ten skrypt — po nich rozpoznaje własne konta. */
const LOGINY = ["jan.k", "ewa.b", "biuro.test", "admin.test", "zwolniony", "bez.hasla"];

/**
 * Nazwy, którymi podpisane są zdarzenia scenariuszy.
 *
 * Kasowanie idzie po tej liście, bo zdarzenie nie ma jak nieść znacznika:
 * jeden ze scenariuszy zapisuje CELOWO uszkodzony payload, więc marker
 * w środku JSON-a wypadłby akurat tam, gdzie jest najbardziej potrzebny.
 *
 * Skutek uboczny jest jawny: ponowne uruchomienie skryptu kasuje także
 * zdarzenia, które powstały przy TWOJEJ pracy na koncie scenariuszowym.
 */
const AUTORZY = [
  "Jan Kowalski",
  "Ewa Bąk",
  "Biuro (scenariusze)",
  // warianty tej samej osoby sprzed kont — materiał do `migrujHistorie`
  "Jan",
  "jan",
  "Jan K",
  "Administrator (scenariusze)",
];

/**
 * Wszystkie podpisy, jakie zostawiają scenariusze — do kasowania.
 *
 * Loginy dochodzą do nazw, bo NIEUDANE LOGOWANIE podpisuje się loginem: konta
 * jeszcze nie ma, więc nie ma czyjej nazwy wpisać. Bez nich każda próba
 * zalogowania się na `zwolniony` zostawiałaby wiersz, którego seed nie sprząta,
 * a migracja historii robiłaby z niego kolejne konto-widmo.
 */
const PODPISY = [...new Set([...AUTORZY, ...LOGINY])];

/* ── Katalog scenariuszy ─────────────────────────────────────────────────────
   Jedno źródło prawdy dla skryptu, konsoli i dokumentacji. `docs/scenariusze-
   testowe.md` opisuje każdy z nich krok po kroku, a test pilnuje, że opis
   istnieje dla KAŻDEGO — inaczej katalog rozjechałby się z dokumentacją przy
   pierwszym dopisanym scenariuszu. To ta sama lekcja, co `docs_check.py`.    */

export interface Scenariusz {
  /** Numer w katalogu, np. `S07`. Nie zmienia się — dokumentacja go cytuje. */
  id: string;
  obszar: string;
  tytul: string;
  /** Od czego zacząć na kolektorze albo w `curl`. */
  wejscie: string;
}

export const KATALOG: Scenariusz[] = [
  // ── skan i klasyfikacja kodu ──
  { id: "S01", obszar: "skan", tytul: "Kolizja EAN — dwie kartoteki, żadna na dokumencie", wejscie: "skan 5901234567890" },
  { id: "S02", obszar: "skan", tytul: "Kolizja EAN zawężona dokumentem (jeden kandydat w dostawie)", wejscie: "skan 5907654321098 w dokumencie FZ 9001" },
  { id: "S03", obszar: "skan", tytul: "Kartoteka bez kodu kreskowego", wejscie: "skan TEST-BEZ-EAN" },
  { id: "S04", obszar: "skan", tytul: "EAN ośmio- i czternastocyfrowy", wejscie: "skan 59012345 oraz 59012345678901" },
  { id: "S05", obszar: "skan", tytul: "Symbol w kształcie adresu regału", wejscie: "skan E05-03-02" },
  { id: "S06", obszar: "skan", tytul: "Symbol z jednym myślnikiem nie jest adresem", wejscie: "skan T32-0203" },
  { id: "S07", obszar: "skan", tytul: "Adres regału i miejsce paletowe", wejscie: "skan A01-02-03 oraz PAL-042" },
  { id: "S08", obszar: "skan", tytul: "Kod nieznany kartotece", wejscie: "skan 4006381333931" },

  // ── karta towaru ──
  { id: "S09", obszar: "karta", tytul: "Cztery adresy naraz — pastylka pickingowa i reszta", wejscie: "karta TEST-WIELE-LOK" },
  { id: "S10", obszar: "karta", tytul: "Kartoteka bez adresu", wejscie: "karta TEST-BEZ-LOK" },
  { id: "S11", obszar: "karta", tytul: "Pole lokalizacji na granicy 50 znaków", wejscie: "karta TEST-LOK-LIMIT" },
  { id: "S12", obszar: "karta", tytul: "Adres spoza wzorca w kartotece (literówka)", wejscie: "karta TEST-LOK-BLAD" },
  { id: "S13", obszar: "karta", tytul: "Stan ujemny", wejscie: "karta TEST-STAN-MINUS" },
  { id: "S14", obszar: "karta", tytul: "Rezerwacja większa niż stan", wejscie: "karta TEST-REZERWACJA" },
  { id: "S15", obszar: "karta", tytul: "Jednostka inna niż sztuka i ilość ułamkowa", wejscie: "karta TEST-ULAMEK" },
  { id: "S16", obszar: "karta", tytul: "Długa nazwa i znaki specjalne (druk, CSV)", wejscie: "karta TEST-ZNAKI" },
  { id: "S17", obszar: "karta", tytul: "Zamienniki: nasze, obce i zestaw z plusem", wejscie: "karta TEST-ZAMIENNIK" },
  { id: "S18", obszar: "karta", tytul: "Magazyny: pusty, ukryty i wszystkie naraz", wejscie: "karta TEST-WSZEDZIE" },
  { id: "S19", obszar: "karta", tytul: "Zamówienia u dostawcy: częściowe, bez terminu, po terminie", wejscie: "karta TEST-ZAMOWIONY" },

  // ── rozkładanie dostaw ──
  { id: "S20", obszar: "dostawa", tytul: "Dostawa nietknięta", wejscie: "zakładka DOSTAWY → FALON-TECH" },
  { id: "S21", obszar: "dostawa", tytul: "Dostawa w toku — pięć statusów linii naraz", wejscie: "zakładka DOSTAWY → STIHL Polska" },
  { id: "S24", obszar: "dostawa", tytul: "Dostawa zamknięta", wejscie: "zakładka DOSTAWY → HUSQVARNA" },
  { id: "S25", obszar: "dostawa", tytul: "Kontener na MGP w buforze — zostaje przesunięcie stanu", wejscie: "zakładka DOSTAWY → IMPORT SHANGHAI" },
  { id: "S26", obszar: "dostawa", tytul: "Ten sam towar w dwóch wierszach dokumentu", wejscie: "zakładka DOSTAWY → DWIE PARTIE" },
  { id: "S27", obszar: "dostawa", tytul: "Pozycja bez lokalizacji na końcu listy", wejscie: "zakładka DOSTAWY → FALON-TECH" },
  { id: "S28", obszar: "dostawa", tytul: "Dostawa czterdziestopozycyjna", wejscie: "zakładka DOSTAWY → DROBNICA" },
  { id: "S29", obszar: "dostawa", tytul: "Dostawa jednopozycyjna", wejscie: "zakładka DOSTAWY → JEDNA POZYCJA" },
  { id: "S30", obszar: "dostawa", tytul: "Dokument spoza okna 14 dni", wejscie: "GET /api/delivery/documents" },
  { id: "S31", obszar: "dostawa", tytul: "Dokument typu spoza DOK_TYPY_DOSTAW", wejscie: "DOK_TYPY_DOSTAW=1,10 i restart API" },
  { id: "S32", obszar: "dostawa", tytul: "Rozjazd adresu — ZAMIEŃ albo DODAJ", wejscie: "skan TEST-WIELE-LOK, potem półka C01-02-02" },
  { id: "S33", obszar: "dostawa", tytul: "Przesyłka: numer i protokół kuriera w trzech stanach", wejscie: "GET /api/delivery/:id" },

  // ── wyjątki ──
  { id: "S34", obszar: "wyjatki", tytul: "Pięć kategorii formularza niezgodności", wejscie: "GET /api/problems/unresolved" },
  { id: "S35", obszar: "wyjatki", tytul: "Klucze sprzed 0.21.0 — do nazwania, nie do zgłoszenia", wejscie: "protokół dostawy HUSQVARNA" },
  { id: "S36", obszar: "wyjatki", tytul: "Zdjęcie dowodowe na dysku", wejscie: "GET /api/problems/:id/photo" },
  { id: "S37", obszar: "wyjatki", tytul: "Zdjęcie, którego plik zniknął", wejscie: "GET /api/problems/:id/photo" },
  { id: "S38", obszar: "wyjatki", tytul: "Wyjątek rozwiązany i nierozwiązany", wejscie: "GET /api/problems/unresolved" },
  { id: "S39", obszar: "wyjatki", tytul: "Średnik i cudzysłów w opisie (eksport CSV)", wejscie: "GET /api/delivery/:id/problems.csv" },
  { id: "S40", obszar: "wyjatki", tytul: "Artykuł spoza dokumentu (bez linii)", wejscie: "protokół dostawy STIHL Polska" },

  // ── kolejka i worker ──
  { id: "S41", obszar: "kolejka", tytul: "Zadanie czekające na workera", wejscie: "pastylka Sfery → KOLEJKA" },
  { id: "S42", obszar: "kolejka", tytul: "Zadanie w backoffie po nieudanej próbie", wejscie: "pastylka Sfery → KOLEJKA" },
  { id: "S43", obszar: "kolejka", tytul: "Zadanie zawieszone w `processing` z uszkodzonym payloadem", wejscie: "GET /api/queue" },
  { id: "S44", obszar: "kolejka", tytul: "MM czekające na wyjście dokumentu z bufora", wejscie: "GET /api/queue" },
  { id: "S45", obszar: "kolejka", tytul: "Bufor trzyma zadanie od pięciu dni", wejscie: "npm run reconcile" },
  { id: "S46", obszar: "kolejka", tytul: "Zadanie w błędzie — czerwony chip i PONÓW", wejscie: "karta TEST-BLAD-ZAPISU" },
  { id: "S47", obszar: "kolejka", tytul: "Błąd starszy niż doba", wejscie: "npm run reconcile" },
  { id: "S48", obszar: "kolejka", tytul: "Zadanie nieznanego typu", wejscie: "log workera" },
  { id: "S49", obszar: "kolejka", tytul: "Kolejka jako rezerwacja stanu (drugie przesunięcie odmawia)", wejscie: "karta TEST-MGP → PRZESUŃ" },
  { id: "S50", obszar: "kolejka", tytul: "Rozjazd: zapis wszedł, kartoteka mówi co innego", wejscie: "npm run reconcile" },

  // ── konta, sesje, uprawnienia ──
  { id: "S51", obszar: "konta", tytul: "Trzy role na czterech kontach", wejscie: "logowanie jan.k / ewa.b / biuro.test / admin.test" },
  { id: "S52", obszar: "konta", tytul: "Konto wyłączone", wejscie: "logowanie zwolniony" },
  { id: "S53", obszar: "konta", tytul: "Konto-ślad bez loginu (migracja historii)", wejscie: "POST /api/users/migrate-history" },
  { id: "S54", obszar: "konta", tytul: "Konto z loginem, bez hasła", wejscie: "logowanie bez.hasla" },
  { id: "S55", obszar: "konta", tytul: "Sesje: czynna, unieważniona i sprzed dwóch miesięcy", wejscie: "x-session: scenariusz-jan" },
  { id: "S66", obszar: "konta", tytul: "Konto biurowe, hasło i wyłączenie konta — wyłącznie admin", wejscie: "POST /api/users z rolą biuro" },

  // ── audyt, metryki, wydajność ──
  { id: "S57", obszar: "audyt", tytul: "Dziennik ze wszystkimi typami zdarzeń", wejscie: "GET /api/events" },
  { id: "S58", obszar: "audyt", tytul: "Zdarzenia sprzed kont (bez `user_ref`)", wejscie: "GET /api/events?od=" },
  { id: "S59", obszar: "audyt", tytul: "Uszkodzony payload i wpis bez `locsPrzed`", wejscie: "GET /api/products/900011/history" },
  { id: "S60", obszar: "audyt", tytul: "Metryki: etykiety do przedruku i p95 powyżej celu", wejscie: "GET /api/metrics" },
  { id: "S61", obszar: "audyt", tytul: "Wydajność: próbka wiarygodna i za mała", wejscie: "GET /api/wydajnosc" },
  { id: "S62", obszar: "audyt", tytul: "Raport kolizji kodów kreskowych", wejscie: "GET /api/ean-conflicts" },

  // ── przeslotowanie ──
  { id: "S63", obszar: "reslot", tytul: "Historia pobrań: eksmisja i awans", wejscie: "npm run reslot -- --demo" },
  { id: "S64", obszar: "reslot", tytul: "Pobrania to wystąpienia, nie sztuki", wejscie: "npm run reslot -- --demo" },
  { id: "S65", obszar: "reslot", tytul: "Regał bez reguły strefy złotej", wejscie: "npm run reslot -- --demo" },

  // ── zwroty Allegro (adapter dev — ALLEGRO_MODE puste przy SGT_MODE=seeded) ──
  { id: "S67", obszar: "zwroty", tytul: "Zwrot dopasowany jednoznacznie (numer zamówienia na FS)", wejscie: "/biuro → ZWROTY → skan DEVWB0001" },
  { id: "S68", obszar: "zwroty", tytul: "Dwa kandydujące paragony — wybór ręczny; etykieta przewoźnika doręczającego", wejscie: "/biuro → ZWROTY → skan DEVTW0002" },
  { id: "S69", obszar: "zwroty", tytul: "Pozycja zwrotu spoza kartoteki i etykieta nieznana Allegro", wejscie: "/biuro → ZWROTY → skan DEVWB0003, potem dowolny inny kod" },

  // ── logo dostawcy ──
  { id: "S70", obszar: "dostawa", tytul: "Dostawca z logo i dostawca bez logo", wejscie: "zakładka DOSTAWY, potem /biuro → DOSTAWCY" },
  { id: "S71", obszar: "karta", tytul: "Zamienniki wypisane bez nagłówka", wejscie: "karta TEST-ZAMIENNIK-LISTA" },

  // ── rozkładanie zwrotów z regału ──
  { id: "S72", obszar: "zwroty", tytul: "Kosz z kartką: numer MM otwiera przyjęcie, ZAKOŃCZ nie wystawia dokumentu", wejscie: "kolektor → zakładka ZWROTY → numer 1209" },

  // ── pytania klientów ──
  { id: "S73", obszar: "pytania", tytul: "Skrzynka w trzech stanach: bez szkicu, szkic po poprawce, wysłane", wejscie: "/biuro → PYTANIA KLIENTÓW" },
  { id: "S74", obszar: "pytania", tytul: "Pytanie o towar spoza oferty — jedyne źródło listy braków", wejscie: "/biuro → ANALIZA → zakres „pytania klientów\"" },
  { id: "S75", obszar: "pytania", tytul: "Wykres tygodni, słupki proporcji i zdanie o szczycie — pytania rozłożone na dwa miesiące", wejscie: "/biuro → ANALIZA → zakres „pytania klientów\" → okno 90 dni" },
  { id: "S76", obszar: "zwroty", tytul: "Wgląd w zwroty stoi w ANALIZIE, nie w zakładce pracy", wejscie: "/biuro → ANALIZA → zakres „zwroty\"" },
  { id: "S77", obszar: "dostawy", tytul: "Analiza dostaw: u kogo się psuje, i dostawa zdjęta poza WERTIS", wejscie: "/biuro → ANALIZA → zakres „dostawy\"" },
  { id: "S78", obszar: "sprawy", tytul: "Jedna kolejka i dwie tafle: konsola SPRAW na wysokość okna", wejscie: "/biuro → SPRAWY" },
  { id: "S79", obszar: "konta", tytul: "Ustawienia jako jeden arkusz: sekcje bez zaokrągleń i bez przerw", wejscie: "/biuro → zębatka → USTAWIENIA" },
];

/* ── Pomocniki czasu ─────────────────────────────────────────────────────────
   Wszystko liczy się OD DZISIAJ, nigdy od daty wpisanej na sztywno. Dane
   z zaszytą datą starzeją się same: dwa tygodnie po niej lista dostaw jest
   pusta, a przy pokazie wygląda to jak zepsuta aplikacja (patrz `seed.ts`).  */

const DZIEN_MS = 86_400_000;
const teraz = Date.now();

/** Data ISO (bez czasu) przesunięta o `dni` względem dziś. */
const dzien = (dni: number): string =>
  new Date(teraz + dni * DZIEN_MS).toISOString().slice(0, 10);

/** Znacznik czasu ISO przesunięty o `minut` względem teraz. */
const chwila = (minut: number): string => new Date(teraz + minut * 60_000).toISOString();

const mmrrrr = (iso: string): string => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/* ── Kartoteki scenariuszowe ────────────────────────────────────────────────
   Symbole zaczynają się od `TEST-` z jednym wyjątkiem (`E05-03-02`, S05), bo
   ten wyjątek JEST scenariuszem. Prefiks jest po to, żeby na liście wyników
   wyszukiwania dane scenariuszowe dało się odróżnić od prawdziwej kartoteki
   jednym spojrzeniem — pomylenie ich przy diagnozie kosztuje godzinę.        */

interface TowarSc {
  twId: number;
  symbol: string;
  nazwa: string;
  ean?: string;
  unit?: string;
  opis?: string;
  lok?: string;
  /** `[mag_id, stan, rezerwacja?]` — bez wpisu magazyn nie ma wiersza wcale. */
  stany?: Array<[number, number, number?]>;
}

const MAG = config.magId.MAG;
const MGP = config.magId.MGP;
const ZWROTY = config.magId.ZWROTY;

/** Pole lokalizacji o długości 49 znaków — o jeden kod od limitu 50. */
const LOK_PRZY_LIMICIE = "A01-02-03 B01-02-03 C01-02-03 D01-02-03 E01-02-03";

const TOWARY: TowarSc[] = [
  // S01 — ten sam EAN na dwóch kartotekach, żadna nie stoi na dokumencie
  { twId: 900_001, symbol: "TEST-KOLIZJA-A", nazwa: "Filtr powietrza — kolizja EAN (A)", ean: "5901234567890", lok: "A01-02-03", stany: [[MAG, 14]] },
  { twId: 900_002, symbol: "TEST-KOLIZJA-B", nazwa: "Filtr powietrza — kolizja EAN (B)", ean: "5901234567890", lok: "B02-03-04", stany: [[MAG, 3]] },
  // S02 — trzy kartoteki, jedna z nich stoi na dokumencie FZ 9001
  { twId: 900_003, symbol: "TEST-TRIO-1", nazwa: "Świeca zapłonowa — trio EAN (na dokumencie)", ean: "5907654321098", lok: "C01-02-02", stany: [[MAG, 40], [MGP, 12]] },
  { twId: 900_004, symbol: "TEST-TRIO-2", nazwa: "Świeca zapłonowa — trio EAN (2)", ean: "5907654321098", lok: "C01-02-03", stany: [[MAG, 5]] },
  { twId: 900_005, symbol: "TEST-TRIO-3", nazwa: "Świeca zapłonowa — trio EAN (3)", ean: "5907654321098", stany: [[MAG, 0]] },
  // S03, S04 — kartoteka bez kodu oraz EAN-8 i EAN-14
  { twId: 900_006, symbol: "TEST-BEZ-EAN", nazwa: "Podkładka bez kodu kreskowego", ean: "", lok: "A01-02-04", stany: [[MAG, 9], [MGP, 4]] },
  { twId: 900_007, symbol: "TEST-EAN8", nazwa: "Zawleczka w kodzie ośmiocyfrowym", ean: "59012345", lok: "A01-03-02", stany: [[MAG, 120]] },
  { twId: 900_008, symbol: "TEST-EAN14", nazwa: "Karton zbiorczy w kodzie czternastocyfrowym", ean: "59012345678901", lok: "PAL-042", stany: [[MAG, 6]] },
  // S05 — symbol o kształcie adresu; skan klasyfikuje go jako regał, nie towar
  { twId: 900_009, symbol: "E05-03-02", nazwa: "Kartoteka o symbolu w kształcie adresu", ean: "", lok: "B02-03-05", stany: [[MAG, 2]] },
  // S06 — jeden myślnik: to symbol, nie adres (W32-0203 z prawdziwej kartoteki)
  { twId: 900_010, symbol: "T32-0203", nazwa: "Symbol z jednym myślnikiem", ean: "", lok: "B02-03-06", stany: [[MAG, 30]] },
  // S09, S32 — cztery adresy: picking, drugi regał, paleta i regał w innej alejce
  { twId: 900_011, symbol: "TEST-WIELE-LOK", nazwa: "Towar na czterech adresach", ean: "5900000000011", lok: "A01-02-03 B02-03-04 PAL-042 H04-01-02", stany: [[MAG, 88], [MGP, 6]] },
  // S10 — kartoteka bez adresu (ścieżka BRAK LOK przy rozkładaniu)
  { twId: 900_012, symbol: "TEST-BEZ-LOK", nazwa: "Nowe SKU bez adresu", ean: "5900000000012", stany: [[MAG, 0], [MGP, 18]] },
  // S11 — pole na granicy limitu: kolejny kod już się nie zmieści w całości
  { twId: 900_013, symbol: "TEST-LOK-LIMIT", nazwa: "Pole lokalizacji tuż pod limitem", ean: "5900000000013", lok: LOK_PRZY_LIMICIE, stany: [[MAG, 4]] },
  // S12 — literówka w kartotece; skan nigdy jej nie dopasuje (docs/adresy-do-poprawy.md)
  { twId: 900_014, symbol: "TEST-LOK-BLAD", nazwa: "Adres spoza wzorca w kartotece", ean: "5900000000014", lok: "paletq29", stany: [[MAG, 7]] },
  // S13, S14 — stan ujemny oraz rezerwacja większa od stanu
  { twId: 900_015, symbol: "TEST-STAN-MINUS", nazwa: "Stan ujemny po korekcie w Subiekcie", ean: "5900000000015", lok: "C01-03-02", stany: [[MAG, -3]] },
  { twId: 900_016, symbol: "TEST-REZERWACJA", nazwa: "Rezerwacja większa niż stan", ean: "5900000000016", lok: "C01-03-03", stany: [[MAG, 5, 9]] },
  // S15 — metry i ilość ułamkowa
  { twId: 900_017, symbol: "TEST-ULAMEK", nazwa: "Wąż paliwowy na metry", ean: "5900000000017", unit: "m", lok: "D01-02-02", stany: [[MAG, 12.5]] },
  // S16 — długa nazwa i znaki, które psują CSV i wydruk protokołu
  {
    twId: 900_018,
    symbol: "TEST-ZNAKI",
    nazwa: 'Uszczelka „O-ring” 3/8"; wersja A — komplet 12 szt. do pilarek spalinowych serii W32 i W48 (zamiennik)',
    ean: "5900000000018",
    unit: "kpl.",
    lok: "D01-02-03",
    stany: [[MAG, 11]],
  },
  // S17 — zamienniki: jeden nasz, reszta obca; `+` łączy zestaw, nie rozdziela
  {
    twId: 900_019,
    symbol: "TEST-ZAMIENNIK",
    nazwa: "Sprzęgło odśrodkowe z zamiennikami w opisie",
    ean: "5900000000019",
    lok: "E05-02-03",
    opis: "Zamiennik: TEST-ZAMIENNIK-B // OEM-9988-XX, FTC242+92-009  OEM: 1234-5678  Modele: W32, W48",
    stany: [[MAG, 15]],
  },
  { twId: 900_020, symbol: "TEST-ZAMIENNIK-B", nazwa: "Sprzęgło odśrodkowe — zamiennik naszej kartoteki", ean: "5900000000020", lok: "E05-02-04", stany: [[MAG, 2]] },
  /* S71 — lista bez nagłówka (0.61.0). Opis nie mówi „Zamiennik", niesie sam
     ciąg po `//`. Trzeci człon jest obcy i ma po cichu odpaść: bez nagłówka
     nie wiadomo, czy to zamiennik, czy numer modelu. */
  {
    twId: 900_066,
    symbol: "TEST-ZAMIENNIK-LISTA",
    nazwa: "Filtr powietrza z listą zamienników bez nagłówka",
    ean: "5900000000066",
    lok: "E05-02-05",
    opis: "Filtr powietrza. TEST-LISTA-A // TEST-LISTA-B // OEM-7766-YY",
    stany: [[MAG, 9]],
  },
  { twId: 900_067, symbol: "TEST-LISTA-A", nazwa: "Filtr powietrza — pierwszy z listy", ean: "5900000000067", lok: "E05-02-06", stany: [[MAG, 4]] },
  { twId: 900_068, symbol: "TEST-LISTA-B", nazwa: "Filtr powietrza — drugi z listy", ean: "5900000000068", lok: "E05-02-07", stany: [[MAG, 1]] },
  // S18 — stan we wszystkich magazynach naraz; ARCH zostaje pusty i ukryty
  {
    twId: 900_021,
    symbol: "TEST-WSZEDZIE",
    nazwa: "Towar leżący we wszystkich magazynach",
    ean: "5900000000021",
    lok: "H04-01-02",
    stany: [[MAG, 25, 4], [MGP, 8], [ZWROTY, 3], [MAG_SERWIS, 2], [MAG_EKSPOZYCJA, 1]],
  },
  // S19 — zamówienia u dostawcy w czterech wariantach
  { twId: 900_022, symbol: "TEST-ZAMOWIONY", nazwa: "Towar zamówiony u dostawcy", ean: "5900000000022", lok: "H04-01-03", stany: [[MAG, 0]] },
  // S49 — stan na MGP pod przesunięcie; kolejka rezerwuje jego część
  { twId: 900_023, symbol: "TEST-MGP", nazwa: "Towar w strefie przyjęć do przesunięcia", ean: "5900000000023", lok: "J02-02-03", stany: [[MAG, 5], [MGP, 60]] },
  // S46 — kartoteka z nieudanym zapisem lokalizacji (czerwony chip)
  { twId: 900_024, symbol: "TEST-BLAD-ZAPISU", nazwa: "Towar z nieudanym zapisem adresu", ean: "5900000000024", lok: "J02-02-04", stany: [[MAG, 12]] },
  // S50 — kartoteka, w której zapis „wszedł", a pole mówi co innego
  { twId: 900_025, symbol: "TEST-ROZJAZD", nazwa: "Towar z rozjazdem adresu wobec kolejki", ean: "5900000000025", lok: "A02-02-02", stany: [[MAG, 30]] },
  // S63 — martwy towar w strefie złotej (A, poziom 3) → lista eksmisji
  { twId: 900_028, symbol: "TEST-ZLOTA-MARTWY", nazwa: "Martwy indeks w strefie złotej", ean: "5900000000028", lok: "A03-02-03", stany: [[MAG, 8]] },
  // S63 — szybkorotujący poza strefą (poziom 7 w alejce A) → lista awansów
  { twId: 900_029, symbol: "TEST-ROTUJACY", nazwa: "Szybkorotujący poza strefą złotą", ean: "5900000000029", lok: "A03-02-07", stany: [[MAG, 60]] },
  /* S64 — dwa pobrania po 200 szt: dużo sztuk, mało pracy. Adres leży poza
     strefą złotą TAK SAMO jak u szybkorotującego wyżej, żeby jedyną różnicą
     między nimi była liczba wystąpień na WZ — i żeby było widać, że to ona
     rozstrzyga o awansie, a nie suma wydanych sztuk. */
  { twId: 900_030, symbol: "TEST-DUZE-PACZKI", nazwa: "Wydawany rzadko, ale po 200 szt", ean: "5900000000030", lok: "B01-03-07", stany: [[MAG, 400]] },
  // S65 — regał, dla którego nie ma reguły strefy złotej (D06)
  { twId: 900_031, symbol: "TEST-BEZ-REGULY", nazwa: "Towar na regale bez reguły strefy", ean: "5900000000031", lok: "D06-01-02", stany: [[MAG, 5]] },
  // S26 — ten sam towar w dwóch wierszach dokumentu
  { twId: 900_032, symbol: "TEST-DWIE-PARTIE", nazwa: "Towar w dwóch wierszach faktury", ean: "5900000000032", lok: "C01-02-04", stany: [[MAG, 0], [MGP, 8]] },
  // S29 — jedyna pozycja dokumentu jednopozycyjnego
  { twId: 900_033, symbol: "TEST-JEDNA-POZ", nazwa: "Jedyna pozycja dostawy", ean: "5900000000033", lok: "D01-03-02", stany: [[MAG, 0], [MGP, 3]] },
  // S30, S31 — dokument spoza okna i dokument typu spoza filtru
  { twId: 900_034, symbol: "TEST-POZA-OKNEM", nazwa: "Towar z dostawy sprzed 20 dni", ean: "5900000000034", lok: "D01-03-03", stany: [[MAG, 4]] },
  { twId: 900_035, symbol: "TEST-TYP-PZ", nazwa: "Towar z dokumentu PZ", ean: "5900000000035", lok: "E05-03-03", stany: [[MAG, 4]] },
  // S21 — pozycje dostawy w toku, po jednej na każdy status linii
  { twId: 900_036, symbol: "TEST-LINIA-TODO", nazwa: "Pozycja jeszcze nietknięta", ean: "5900000000036", lok: "F02-02-04", stany: [[MAG, 10], [MGP, 6]] },
  { twId: 900_037, symbol: "TEST-LINIA-DONE", nazwa: "Pozycja odłożona w całości", ean: "5900000000037", lok: "F02-02-08", stany: [[MAG, 10], [MGP, 6]] },
  { twId: 900_038, symbol: "TEST-LINIA-PART", nazwa: "Pozycja odłożona częściowo", ean: "5900000000038", lok: "G01-02-03", stany: [[MAG, 10], [MGP, 6]] },
  { twId: 900_039, symbol: "TEST-LINIA-SKIP", nazwa: "Pozycja pominięta", ean: "5900000000039", lok: "G01-02-07", stany: [[MAG, 10], [MGP, 6]] },
  { twId: 900_040, symbol: "TEST-LINIA-PROBLEM", nazwa: "Pozycja ze zgłoszonym wyjątkiem", ean: "5900000000040", lok: "H04-02-02", stany: [[MAG, 10], [MGP, 6]] },
  /* Druga pozycja w statusie `problem`, bo „zła ilość" MUSI wskazywać linię
     dokumentu — a linia z wyjątkiem ma w bazie status `problem`. Wpięcie tego
     zgłoszenia w pozycję odłożoną częściowo dałoby stan, którego aplikacja nie
     umie wyprodukować, czyli dane demo kłamiące o własnych regułach. */
  { twId: 900_044, symbol: "TEST-LINIA-ILOSC", nazwa: "Pozycja z rozbieżną ilością", ean: "5900000000044", lok: "H04-02-03", stany: [[MAG, 10], [MGP, 6]] },
  // S25 — pozycje kontenera na MGP
  { twId: 900_041, symbol: "TEST-KONTENER-1", nazwa: "Pozycja kontenera importowego (1)", ean: "5900000000041", lok: "J02-03-02", stany: [[MGP, 120]] },
  { twId: 900_042, symbol: "TEST-KONTENER-2", nazwa: "Pozycja kontenera importowego (2)", ean: "5900000000042", stany: [[MGP, 60]] },
  { twId: 900_043, symbol: "TEST-KONTENER-3", nazwa: "Pozycja kontenera importowego (3)", ean: "5900000000043", lok: "J02-03-04", stany: [[MGP, 24]] },
];

/** Czterdzieści drobnic do dostawy S28 — generowane, bo liczy się tylko ich liczba. */
const TW_DROBNICA_OD = 900_101;
const DROBNICA: TowarSc[] = Array.from({ length: 40 }, (_, i) => {
  const nr = String(i + 1).padStart(2, "0");
  /* Adresy rozłożone po alejkach A–E, żeby sortowanie listy po lokalizacji
     miało co porządkować. Co siódma pozycja BEZ adresu — sekcja „bez
     lokalizacji" na końcu listy ma być widoczna także przy długiej dostawie. */
  const alejka = "ABCDE"[i % 5];
  const lok = i % 7 === 6 ? "" : `${alejka}0${(i % 4) + 1}-0${(i % 5) + 1}-0${(i % 3) + 2}`;
  return {
    twId: TW_DROBNICA_OD + i,
    symbol: `TEST-DROBNICA-${nr}`,
    nazwa: `Drobnica ${nr} — pozycja dostawy czterdziestopozycyjnej`,
    ean: `59000001000${nr}`,
    lok,
    stany: [[MAG, 2 + (i % 9)] as [number, number], [MGP, 1 + (i % 5)] as [number, number]],
  };
});

/* ── Zdjęcie dowodowe ────────────────────────────────────────────────────────
   Najmniejszy poprawny JPEG. Treść nie ma znaczenia — znaczenie ma to, że plik
   ISTNIEJE i da się go pobrać trasą `/api/problems/:id/photo`, bo scenariusz
   S37 sprawdza dokładnie odwrotny przypadek: referencję bez pliku.           */
const JPEG_1PX =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const FOTO_USZKODZENIE = "scenariusz-uszkodzenie.jpg";
const FOTO_BLEDNY = "scenariusz-bledny-artykul.jpg";
const FOTO_HISTORYCZNE = "scenariusz-nieznany-kod.jpg";
/** Referencja BEZ pliku — S37. Nic go nie tworzy i to jest cały scenariusz. */
const FOTO_BRAK_PLIKU = "scenariusz-plik-skasowany.jpg";

export interface Podsumowanie {
  towary: number;
  dokumenty: number;
  dostawy: number;
  linie: number;
  wyjatki: number;
  kolejka: number;
  konta: number;
  zdarzenia: number;
  zamowienia: number;
  dokumentyWz: number;
  pozycjeWz: number;
  sprzedaz: number;
  przyjecia: number;
  pytania: number;
  /** Domknięte dostawy historyczne pod zakres DOSTAWY w ANALIZIE (0.100.0). */
  historiaDostaw: number;
}

/**
 * Buduje wszystkie scenariusze. Zwraca liczniki — konsola je wypisuje, a test
 * na nich sprawdza, że seed nie zaczął po cichu budować mniej.
 */
export function zbudujScenariusze(): Podsumowanie {
  if (config.sgtMode === "mssql") {
    throw new Error(
      "SGT_MODE=mssql — seed scenariuszy zakłada konta ze znanym hasłem i gotowe " +
        "tokeny sesji. Na bazie podpiętej do Subiekta nie ma prawa się uruchomić."
    );
  }

  const d = db();
  wyczysc();

  const licz = {
    towary: 0, dokumenty: 0, dostawy: 0, linie: 0, wyjatki: 0, kolejka: 0,
    konta: 0, zdarzenia: 0, zamowienia: 0, dokumentyWz: 0, pozycjeWz: 0,
    sprzedaz: 0, przyjecia: 0, pytania: 0, historiaDostaw: 0,
  };

  const wszystkieTowary = [...TOWARY, ...DROBNICA];

  transaction(d, () => {
    magazyny();
    licz.towary = kartoteki(wszystkieTowary);
    const dok = dokumenty();
    licz.dokumenty = dok.dokumentow;
    licz.dostawy = dok.dostaw;
    licz.linie = dok.linii;
    licz.wyjatki = wyjatki(dok.idDostaw);
    licz.zamowienia = zamowienia();
    licz.konta = konta();
    licz.kolejka = kolejka();
    licz.zdarzenia = dziennik();
    kolizjeEan();
    const wz = historiaPobran();
    licz.dokumentyWz = wz.dokumentow;
    licz.pozycjeWz = wz.pozycji;
    licz.sprzedaz = sprzedazDemo();
    licz.przyjecia = przyjeciaDemo();
    licz.pytania = pytaniaDemo();
    licz.historiaDostaw = historiaDostaw();
    logoDostawcow();
  })();

  /* Nakładka spraw dogania świeżo zasiane rejestry (0.128.0) — poza
     transakcją seeda, bo rekoncyliacja otwiera własną. */
  przebudujSprawy();
  /* Trzy szablony na start (0.133.0) — demo pustej listy uczy, że funkcji
     nie ma. Treści są celowo ZWYKŁE: tak pisze agent, gdy nie ma czasu. */
  szablonyDemo();
  /* Oś czasu z tego samego powodu (0.130.0): demo bez historii pokazywałoby
     pustą sekcję w każdej sprawie i wyglądało na zepsute. Dosypka czyta
     wyłącznie stemple, które seed właśnie zapisał. */
  dosypOsCzasu();

  // Zdjęcia leżą POZA transakcją — to dysk, nie baza, i wycofanie transakcji
  // i tak by ich nie usunęło. Kolejność (baza, potem pliki) jest bezpieczniejsza:
  // referencja bez pliku ma w tym seedzie własny scenariusz i nie jest awarią.
  zdjecia();

  return licz;
}

/* ── Kasowanie własnych danych ──────────────────────────────────────────────
   Kolejność wynika z kluczy obcych (`PRAGMA foreign_keys = ON`): najpierw
   dzieci, potem rodzice. `problem` wskazuje na `delivery_line` i `delivery`,
   `device_session` na `app_user`, `sgt_pozycja` na `sgt_dokument`.           */
function wyczysc(): void {
  const d = db();
  const luki = (n: number) => Array.from({ length: n }, () => "?").join(",");

  transaction(d, () => {
    d.prepare(
      `DELETE FROM problem WHERE delivery_id IN
         (SELECT id FROM delivery WHERE sgt_dok_id >= ?)`
    ).run(DOK_OD);
    d.prepare(
      `DELETE FROM delivery_line WHERE delivery_id IN
         (SELECT id FROM delivery WHERE sgt_dok_id >= ?)`
    ).run(DOK_OD);
    d.prepare("DELETE FROM delivery WHERE sgt_dok_id >= ?").run(DOK_OD);

    d.prepare("DELETE FROM sgt_pozycja WHERE dok_id >= ?").run(DOK_OD);
    d.prepare("DELETE FROM sgt_dokument WHERE dok_id >= ?").run(DOK_OD);
    d.prepare("DELETE FROM sgt_zam_pozycja WHERE dok_id >= ?").run(DOK_OD);
    d.prepare("DELETE FROM sgt_zamowienie WHERE dok_id >= ?").run(DOK_OD);

    d.prepare("DELETE FROM sgt_sprzedaz_pozycja WHERE dok_id >= ?").run(DOK_SPRZ_OD);
    d.prepare("DELETE FROM sgt_sprzedaz WHERE dok_id >= ?").run(DOK_SPRZ_OD);
    /* Kosze z dokumentu i same dokumenty — w tej kolejności, bo kosz wskazuje
       przyjęcie, a jego pozycje wskazują kosz. */
    d.prepare(
      "DELETE FROM kosz_pozycja WHERE kosz_id IN (SELECT id FROM kosz WHERE mm_dok_id >= ?)"
    ).run(DOK_MM_OD);
    d.prepare("DELETE FROM kosz WHERE mm_dok_id >= ?").run(DOK_MM_OD);
    d.prepare("DELETE FROM przyjecie_pominiete WHERE dok_id >= ?").run(DOK_MM_OD);
    d.prepare("DELETE FROM sgt_mm_zwrot_pozycja WHERE dok_id >= ?").run(DOK_MM_OD);
    d.prepare("DELETE FROM sgt_mm_zwrot WHERE dok_id >= ?").run(DOK_MM_OD);
    /* Zwroty założone z adaptera dev (skan DEVWB…) — kasowane po znaczniku
       `dev-ret-`, żeby ponowne uruchomienie wracało do punktu wyjścia także
       w zakładce ZWROTY. Zwroty ręczne z innych etykiet zostają. */
    d.prepare(
      `DELETE FROM zwrot_zam_pozycja WHERE zwrot_id IN
         (SELECT id FROM zwrot WHERE allegro_return_id LIKE 'dev-ret-%')`
    ).run();
    d.prepare(
      `DELETE FROM zwrot_pozycja WHERE zwrot_id IN
         (SELECT id FROM zwrot WHERE allegro_return_id LIKE 'dev-ret-%')`
    ).run();
    d.prepare("DELETE FROM zwrot WHERE allegro_return_id LIKE 'dev-ret-%'").run();
    /* Pytania scenariuszowe po przedrostku `dev-msg-`, tak samo jak zwroty
       po `dev-ret-`. `dopasowanie` wskazuje na `pytanie`, więc idzie pierwsze. */
    d.prepare(
      `DELETE FROM dopasowanie WHERE pytanie_id IN
         (SELECT id FROM pytanie WHERE wiadomosc_id LIKE 'dev-msg-%')`
    ).run();
    d.prepare("DELETE FROM pytanie WHERE wiadomosc_id LIKE 'dev-msg-%'").run();

    d.prepare("DELETE FROM sgt_stan WHERE tw_id >= ?").run(TW_OD);
    d.prepare("DELETE FROM sgt_towar WHERE tw_id >= ?").run(TW_OD);

    d.prepare("DELETE FROM sfera_queue WHERE tw_id >= ?").run(TW_OD);
    d.prepare(`DELETE FROM events WHERE user_id IN (${luki(PODPISY.length)})`).run(...PODPISY);
    d.prepare(
      `DELETE FROM device_session WHERE user_id IN
         (SELECT user_id FROM app_user WHERE login IN (${luki(LOGINY.length)}))`
    ).run(...LOGINY);
    d.prepare(`DELETE FROM app_user WHERE login IN (${luki(LOGINY.length)})`).run(...LOGINY);
    /* Konta bez loginu podpisane nazwą ze scenariuszy: konto-ślad zakładane
       niżej ORAZ to, co z tych samych nazw zrobiła migracja historii
       (`POST /api/users/migrate-history` — scenariusz S53). Bez tej linii każde
       uruchomienie seedu zostawiałoby po sobie kolejne konto-widmo. */
    d.prepare(
      `DELETE FROM app_user WHERE login IS NULL AND name IN (${luki(PODPISY.length)})`
    ).run(...PODPISY);

    d.prepare("DELETE FROM ean_conflict WHERE ean IN (?,?)").run(
      "5901234567890",
      "5907654321098"
    );
  })();
}

function magazyny(): void {
  const ins = db().prepare(
    "INSERT OR IGNORE INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)"
  );
  ins.run(MAG, "MAG", "Magazyn główny");
  ins.run(MGP, "MGP", "Strefa przyjęć");
  ins.run(ZWROTY, "ZWROTY", "Zwroty od klientów");
  ins.run(MAG_SERWIS, "SERWIS", "Serwis i reklamacje");
  ins.run(MAG_EKSPOZYCJA, "EKSPO", "Ekspozycja / salon");
  ins.run(MAG_ARCHIWUM, "ARCH", "Magazyn sezonowy");

  /* S18 — magazyn ukryty. Brak wiersza znaczy „widoczny", więc zapisujemy
     wyłącznie ukrycie. Sezonowy nadaje się do tego najlepiej: jest pusty, więc
     jego zniknięcie z karty nie chowa żadnej liczby, którą ktoś śledzi. */
  db()
    .prepare(
      `INSERT INTO magazyn_widocznosc(mag_id, ukryty, at, przez) VALUES (?,1,?,?)
       ON CONFLICT(mag_id) DO UPDATE SET ukryty=1, at=excluded.at, przez=excluded.przez`
    )
    .run(MAG_ARCHIWUM, chwila(-60), "Biuro (scenariusze)");
}

function kartoteki(lista: TowarSc[]): number {
  const insTowar = db().prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, opis, lokalizacja)
     VALUES (?,?,?,?,?,?,?)`
  );
  const insStan = db().prepare(
    "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,?)"
  );
  for (const t of lista) {
    insTowar.run(
      t.twId, t.symbol, t.nazwa, t.ean ?? "", t.unit ?? "szt.", t.opis ?? "", t.lok ?? ""
    );
    for (const [magId, stan, rez] of t.stany ?? []) insStan.run(t.twId, magId, stan, rez ?? 0);
  }
  return lista.length;
}

/* ── Dostawy ────────────────────────────────────────────────────────────────
   Część dokumentów zostaje NIEOTWARTA (bez wiersza w `delivery`) — otwarcie
   jest częścią scenariusza i to na nim widać snapshot pozycji. Reszta ma
   postęp zbudowany wprost, bo stanów typu „linia zajęta 40 minut temu przez
   kogoś innego" nie da się wyklikać z jednego kolektora.                     */

interface DokumentSc {
  dokId: number;
  typ: string;
  dostawca: string;
  dniWstecz: number;
  magId: number;
  /** Identyfikator kontrahenta — po nim przypina się logo dostawcy (S70). */
  khId?: number;
  wBuforze?: boolean;
  /** `[tw_id, ilość]`; ten sam towar wolno podać dwa razy (S26). */
  pozycje: Array<[number, number]>;
}

/** Symbol pierwszego typu z `DOK_TYPY_DOSTAW` — lista dostaw filtruje po nim. */
const TYP_DOSTAWY = etykietyDostaw()[0] ?? "FZ";

const DOKUMENTY: DokumentSc[] = [
  // S20, S02, S27 — dostawa nietknięta; jedna pozycja bez adresu, jedna z trio EAN
  {
    dokId: 9_001, typ: TYP_DOSTAWY, dostawca: "FALON-TECH", dniWstecz: 0, magId: MAG, khId: 8_001,
    pozycje: [[900_003, 12], [900_006, 8], [900_011, 24], [900_012, 18]],
  },
  // S21, S32 — dostawa w toku ze wszystkimi statusami linii
  {
    dokId: 9_002, typ: TYP_DOSTAWY, dostawca: "STIHL Polska", dniWstecz: 1, magId: MAG, khId: 8_002,
    pozycje: [
      [900_036, 6], [900_037, 6], [900_038, 6], [900_039, 6], [900_040, 6], [900_044, 6],
    ],
  },
  // S24, S35 — dostawa zamknięta z wyjątkami historycznymi
  {
    dokId: 9_003, typ: TYP_DOSTAWY, dostawca: "HUSQVARNA", dniWstecz: 3, magId: MAG,
    pozycje: [[900_007, 24], [900_008, 6]],
  },
  // S25, S44 — kontener na MGP, w buforze; po rozłożeniu zostaje przesunięcie
  {
    dokId: 9_004, typ: TYP_DOSTAWY, dostawca: "IMPORT SHANGHAI", dniWstecz: 2, magId: MGP,
    wBuforze: true,
    pozycje: [[900_041, 120], [900_042, 60], [900_043, 24]],
  },
  // S26, S15 — ten sam towar dwa razy, ilość ułamkowa i duża paczka
  {
    dokId: 9_005, typ: TYP_DOSTAWY, dostawca: "DWIE PARTIE sp. z o.o.", dniWstecz: 0, magId: MAG,
    pozycje: [[900_032, 3], [900_032, 5], [900_017, 2.5], [900_007, 480]],
  },
  // S29 — dostawa jednopozycyjna
  {
    dokId: 9_007, typ: TYP_DOSTAWY, dostawca: "JEDNA POZYCJA", dniWstecz: 0, magId: MAG,
    pozycje: [[900_033, 3]],
  },
  // S30 — dokument spoza okna DOK_DNI_WSTECZ
  {
    dokId: 9_008, typ: TYP_DOSTAWY, dostawca: "POZA OKNEM", dniWstecz: 20, magId: MAG,
    pozycje: [[900_034, 4]],
  },
  // S31 — typ dokumentu spoza DOK_TYPY_DOSTAW (domyślnie sama FZ)
  {
    dokId: 9_009, typ: "PZ", dostawca: "TYP SPOZA FILTRU", dniWstecz: 0, magId: MAG,
    pozycje: [[900_035, 4]],
  },
];

/** S28 — czterdzieści pozycji drobnicy na jednym dokumencie. */
const DOK_DROBNICA: DokumentSc = {
  dokId: 9_006, typ: TYP_DOSTAWY, dostawca: "DROBNICA", dniWstecz: 0, magId: MAG,
  pozycje: DROBNICA.map((t, i) => [t.twId, 1 + (i % 12)] as [number, number]),
};

/* ── S70: logo dostawcy ─────────────────────────────────────────────────────
   FALON-TECH (`kh_id` 8001) ma logo, STIHL Polska (8002) nie — żeby na jednej
   liście dostaw dało się zobaczyć OBA warianty wiersza: kafelek z logo i ten
   dotychczasowy, z ikoną stanu.

   Obraz to najmniejszy poprawny PNG, 1×1. Chodzi o ŚCIEŻKĘ, a nie o ładny
   rysunek: seed ma dowieść, że kolumna, trasa, flaga `maLogo` i wiersz w
   kolektorze spinają się w całość.                                          */
const LOGO_PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function logoDostawcow(): void {
  const obraz = Buffer.from(LOGO_PNG_1X1, "base64");
  const etag = createHash("sha1").update(obraz).digest("hex");
  const teraz = new Date().toISOString();
  db()
    .prepare(
      `INSERT OR REPLACE INTO dostawca_logo(kh_id, nazwa, obraz, bajtow, etag, dodane_at, dodane_by)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(8_001, "FALON-TECH", obraz, obraz.length, etag, teraz, "seed");
}

function dokumenty(): { dokumentow: number; dostaw: number; linii: number; idDostaw: Map<number, number> } {
  const d = db();
  const insDok = d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, kh_id, w_buforze)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insPoz = d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)");

  const lista = [...DOKUMENTY, DOK_DROBNICA];
  for (const dok of lista) {
    const data = dzien(-dok.dniWstecz);
    insDok.run(
      dok.dokId,
      dok.typ,
      `${dok.typ} ${dok.dokId}/${mmrrrr(data)}`,
      data,
      dok.magId,
      dok.dostawca,
      dok.khId ?? null,
      dok.wBuforze ? 1 : 0
    );
    for (const [twId, ilosc] of dok.pozycje) insPoz.run(dok.dokId, twId, ilosc);
  }

  const postep = postepDostaw();
  return {
    dokumentow: lista.length,
    dostaw: postep.dostaw,
    linii: postep.linii,
    idDostaw: postep.idDostaw,
  };
}

/* Rozkładanie zapisane wprost. `delivery_line.lok_oczekiwana` jest snapshotem
   pola z kartoteki z chwili otwarcia — kopiujemy je tak samo, jak zrobiłby to
   `openDelivery`, bo scenariusz o rozjeździe adresu (S32) mierzy różnicę
   między tym snapshotem a zeskanowaną półką. */
function postepDostaw(): { dostaw: number; linii: number; idDostaw: Map<number, number> } {
  const d = db();
  const idDostaw = new Map<number, number>();
  let linii = 0;

  const insDostawa = d.prepare(
    `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, status, opened_at,
                          closed_at, source_mag_id, nr_przesylki, kurier_protokol, przesylka_at, przesylka_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insLinia = d.prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona,
                               lok_oczekiwana, lok_faktyczna, status, done_at, done_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const wszystkie = new Map([...TOWARY, ...DROBNICA].map((t) => [t.twId, t]));
  /* Snapshot tego, co `openDelivery` skopiowałoby z kartoteki: symbol, nazwa
     i PIERWSZY kod z pola lokalizacji (adres pickingowy). */
  const towar = (twId: number) => {
    const t = wszystkie.get(twId);
    return { sym: t?.symbol ?? String(twId), nazwa: t?.nazwa ?? "", lok: (t?.lok ?? "").split(" ")[0] || null };
  };

  const otworz = (dok: DokumentSc, status: string, opened: string, closed: string | null,
                  przesylka: { nr: string | null; protokol: string | null }) => {
    const data = dzien(-dok.dniWstecz);
    const id = Number(
      insDostawa.run(
        dok.dokId,
        `${dok.typ} ${dok.dokId}/${mmrrrr(data)}`,
        dok.dostawca,
        data,
        status,
        opened,
        closed,
        dok.magId,
        przesylka.nr,
        przesylka.protokol,
        przesylka.nr || przesylka.protokol ? opened : null,
        przesylka.nr || przesylka.protokol ? "Jan Kowalski" : null
      ).lastInsertRowid
    );
    idDostaw.set(dok.dokId, id);
    return id;
  };

  // ── S21, S33: dostawa w toku ──
  const wToku = DOKUMENTY.find((x) => x.dokId === 9_002)!;
  const idWToku = otworz(wToku, "open", chwila(-95), null, {
    nr: "PL-2026-08-000431",
    protokol: "tak",
  });
  /* Pięć statusów w jednej dostawie. `done` i `partial` mają wypełnione
     `lok_faktyczna`, bo skan półki JEST dowodem odłożenia — linia bez niego
     wyglądałaby na odłożoną donikąd. */
  const linie: Array<[number, number, number, string, string | null]> = [
    // [tw_id, ilosc_dok, ilosc_odlozona, status, lok_faktyczna]
    [900_036, 6, 0, "todo", null],
    [900_037, 6, 6, "done", "F02-02-08"],
    [900_038, 6, 2, "partial", "G01-02-03"],
    [900_039, 6, 0, "skipped", null],
    [900_040, 6, 0, "problem", null],
    [900_044, 6, 0, "problem", null],
  ];
  for (const [twId, dok, odlozone, status, lokFakt] of linie) {
    const t = towar(twId);
    insLinia.run(
      idWToku, twId, t.sym, t.nazwa, dok, odlozone, t.lok, lokFakt, status,
      status === "done" || status === "partial" ? chwila(-60) : null,
      status === "done" || status === "partial" ? "Jan Kowalski" : null
    );
    linii++;
  }

  // ── S24, S35: dostawa zamknięta ──
  const zamknieta = DOKUMENTY.find((x) => x.dokId === 9_003)!;
  const idZamknietej = otworz(zamknieta, "done", chwila(-3 * 1440), chwila(-3 * 1440 + 70), {
    nr: "PL-2026-07-009912",
    protokol: "nie",
  });
  for (const [twId, ilosc] of zamknieta.pozycje) {
    const t = towar(twId);
    insLinia.run(
      idZamknietej, twId, t.sym, t.nazwa, ilosc, ilosc, t.lok, t.lok, "done",
      chwila(-3 * 1440 + 60), "Jan Kowalski"
    );
    linii++;
  }

  // ── S25: kontener na MGP, rozłożony w połowie ──
  const kontener = DOKUMENTY.find((x) => x.dokId === 9_004)!;
  const idKontenera = otworz(kontener, "open", chwila(-2 * 1440), null, { nr: null, protokol: null });
  kontener.pozycje.forEach(([twId, ilosc], i) => {
    const t = towar(twId);
    const done = i === 0;
    insLinia.run(
      idKontenera, twId, t.sym, t.nazwa, ilosc, done ? ilosc : 0, t.lok,
      done ? t.lok : null, done ? "done" : "todo",
      done ? chwila(-2 * 1440 + 30) : null, done ? "Ewa Bąk" : null
    );
    linii++;
  });

  // ── S30: dokument spoza okna, z NIEDOKOŃCZONĄ pracą ──
  const pozaOknem = DOKUMENTY.find((x) => x.dokId === 9_008)!;
  const idPozaOknem = otworz(pozaOknem, "open", chwila(-20 * 1440), null, { nr: null, protokol: null });
  for (const [twId, ilosc] of pozaOknem.pozycje) {
    const t = towar(twId);
    insLinia.run(idPozaOknem, twId, t.sym, t.nazwa, ilosc, 0, t.lok, null, "todo", null, null);
    linii++;
  }

  return { dostaw: idDostaw.size, linii, idDostaw };
}

/* ── Historia domkniętych dostaw (S77) ──────────────────────────────────────
   Ziarno miało JEDNĄ domkniętą dostawę, u jednego dostawcy, w jednym tygodniu.
   Do 0.99.0 nikomu to nie przeszkadzało: panel pokazywał dostawy po jednej,
   w kontekście otwartej faktury. Zakres DOSTAWY w ANALIZIE (0.100.0) zadaje
   pytanie „u kogo się psuje" — a na to jedna dostawa nie odpowiada wcale:
   tabela dostawców miała jeden wiersz, wykres tygodni jeden słupek, a udziału
   wyjątków nie dało się z niczym porównać.

   Ta sama luka, przez którą skrzynka pytań stała pusta do 0.96.0, a wykres
   tygodni pokazywał jeden słupek do 0.99.0. Trzeci raz ta sama lekcja: ekran
   zestawień trzeba zasiać INACZEJ niż ekran pojedynczej sprawy.

   Jedna z dostaw ma status `external` — zdjęta z listy bez ani jednego skanu.
   Ma wejść do LICZBY dostaw i NIE wejść do mediany czasu, i to jest jedyny
   sposób, żeby tę regułę zobaczyć na ekranie.                                */

/** Pierwszy `dok_id` historycznych dostaw; sprząta je ten sam próg `DOK_OD`. */
const DOK_HISTORIA_OD = 9_100;

function historiaDostaw(): number {
  const d = db();
  const insDok = d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,?,?,?,?,?,0)`
  );
  const insDostawa = d.prepare(
    `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, status,
                          opened_at, closed_at, closed_by, powod_zamkniecia, source_mag_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const insLinia = d.prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok,
                               ilosc_odlozona, lok_oczekiwana, lok_faktyczna, status, done_at, done_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const wszystkie = new Map([...TOWARY, ...DROBNICA].map((t) => [t.twId, t]));

  /* [dostawca, dni wstecz, godzin rozkładania, pozycji, z wyjątkiem, poza WERTIS]
     Udziały wyjątków dobrane tak, żeby tabela miała CO sortować: IMPORT
     SHANGHAI wychodzi najgorzej mimo najmniejszej liczby dostaw i to jest
     dokładnie wniosek, którego ta karta ma dostarczać. */
  const HISTORIA: Array<[string, number, number, number, number, boolean]> = [
    ["STIHL Polska", 6, 20, 8, 0, false],
    ["STIHL Polska", 13, 26, 10, 1, false],
    ["STIHL Polska", 27, 18, 6, 0, false],
    ["HUSQVARNA", 9, 44, 12, 2, false],
    ["HUSQVARNA", 21, 30, 9, 1, false],
    ["IMPORT SHANGHAI", 16, 96, 6, 3, false],
    ["IMPORT SHANGHAI", 34, 120, 4, 2, false],
    ["FALON-TECH", 41, 0, 5, 0, true],
  ];

  const twIds = [...wszystkie.keys()].slice(0, 12);
  let ile = 0;
  HISTORIA.forEach(([dostawca, dniWstecz, godzin, pozycji, zWyjatkiem, poza], i) => {
    const dokId = DOK_HISTORIA_OD + i;
    const data = dzien(-dniWstecz);
    const numer = `${TYP_DOSTAWY} ${dokId}/${mmrrrr(data)}`;
    insDok.run(dokId, TYP_DOSTAWY, numer, data, MAG, dostawca);

    const otwarto = chwila(-dniWstecz * 1440);
    const id = Number(
      insDostawa.run(
        dokId, numer, dostawca, data,
        poza ? "external" : "done",
        otwarto,
        chwila(-dniWstecz * 1440 + godzin * 60),
        poza ? "Biuro (scenariusze)" : "Jan Kowalski",
        /* Powód jest WYMAGANY przy zamknięciu poza WERTIS — to jedyna operacja
           zdejmująca dostawę z listy bez skanu, więc pole „dlaczego" jest tu
           całym dowodem. Ziarno bez niego opisywałoby stan nieosiągalny. */
        poza ? "Rozłożone bezpośrednio z palety przy rampie" : null,
        MAG
      ).lastInsertRowid
    );

    for (let j = 0; j < pozycji; j++) {
      const twId = twIds[j % twIds.length];
      const t = wszystkie.get(twId);
      const lok = (t?.lok ?? "").split(" ")[0] || null;
      const problem = j < zWyjatkiem;
      /* Dostawa zdjęta poza WERTIS nie ma ANI JEDNEGO skanu — jej pozycje
         zostają `todo`. Wpisanie im `done` byłoby wpisaniem pracy, której nikt
         w tej aplikacji nie wykonał, a to jest cała różnica między `external`
         a `done` (patrz komentarz przy `delivery.status`). */
      const status = poza ? "todo" : problem ? "problem" : "done";
      insLinia.run(
        id, twId, t?.symbol ?? String(twId), t?.nazwa ?? "", 4,
        status === "done" ? 4 : 0, lok, status === "done" ? lok : null, status,
        status === "done" ? chwila(-dniWstecz * 1440 + godzin * 30) : null,
        status === "done" ? "Jan Kowalski" : null
      );
    }
    ile++;
  });
  return ile;
}

/* ── Wyjątki ────────────────────────────────────────────────────────────────
   Pięć kategorii formularza + pięć kluczy historycznych. Te drugie są tu po to,
   żeby protokół dla dostawcy dało się wydrukować z wierszem sprzed 0.21.0
   i sprawdzić, że pokazuje etykietę, a nie surowy klucz `qty_short`.         */
function wyjatki(idDostaw: Map<number, number>): number {
  const d = db();
  const idWToku = idDostaw.get(9_002)!;
  const idZamknietej = idDostaw.get(9_003)!;

  const linia = (deliveryId: number, twId: number): number | null => {
    const r = d
      .prepare("SELECT id FROM delivery_line WHERE delivery_id=? AND tw_id=?")
      .get(deliveryId, twId) as { id: number } | undefined;
    return r?.id ?? null;
  };
  const iloscDok = (lineId: number | null): number | null => {
    if (!lineId) return null;
    const r = d.prepare("SELECT ilosc_dok FROM delivery_line WHERE id=?").get(lineId) as
      | { ilosc_dok: number }
      | undefined;
    return r?.ilosc_dok ?? null;
  };

  const ins = d.prepare(
    `INSERT INTO problem(delivery_id, line_id, typ, ilosc, sym_obcy, zamiast_ilosc, ilosc_dok,
                         opis, foto_ref, created_at, created_by, resolved_at, resolved_note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  const liniaProblem = linia(idWToku, 900_040);
  const liniaIlosc = linia(idWToku, 900_044);

  const wiersze: Array<{
    delivery: number; line: number | null; typ: string; ilosc: number | null;
    symObcy?: string | null; zamiast?: number | null; opis?: string | null;
    foto?: string | null; minut: number; kto: string; rozwiazany?: string | null;
  }> = [
    // S34 — pięć kategorii formularza „Niezgodność w dostawie"
    {
      delivery: idWToku, line: liniaProblem, typ: "wrong_item", ilosc: 6,
      symObcy: "OEM-77-521", zamiast: 6, foto: FOTO_BLEDNY, minut: -80, kto: "Jan Kowalski",
      opis: "Przyszła inna średnica; etykieta dostawcy zgadza się z kartonem, nie z towarem",
    },
    {
      // uszkodzenie dotyczy paczki, nie pozycji z dokumentu — stąd brak linii
      delivery: idWToku, line: null, typ: "damaged", ilosc: 2, foto: FOTO_USZKODZENIE,
      minut: -70, kto: "Jan Kowalski",
      // S39 — średnik i cudzysłów w opisie: eksport CSV musi je ująć w cudzysłowy
      opis: 'Karton przemoczony; dwie sztuki z pękniętą obudową — kierowca powiedział "spisz i tak"',
    },
    { delivery: idWToku, line: null, typ: "missing_item", ilosc: 4, minut: -65, kto: "Jan Kowalski",
      opis: "Na liście przewozowym jest, w paczce nie ma" },
    {
      delivery: idWToku, line: liniaIlosc, typ: "qty_mismatch", ilosc: 4,
      minut: -60, kto: "Jan Kowalski", opis: "Policzone dwa razy, za każdym razem 4 zamiast 6",
    },
    // S40 — artykuł spoza dokumentu: nie ma linii, jest numer katalogowy
    { delivery: idWToku, line: null, typ: "extra_item", ilosc: 1, symObcy: "KAR00149",
      minut: -55, kto: "Ewa Bąk", opis: "Przyjechało dodatkowo, nikt tego nie zamawiał" },
    // S37 — referencja do zdjęcia, którego na dysku NIE MA
    { delivery: idWToku, line: null, typ: "damaged", ilosc: 1, foto: FOTO_BRAK_PLIKU,
      minut: -50, kto: "Ewa Bąk", opis: "Zdjęcie zrobione, plik przepadł przy synchronizacji" },

    // S35 — klucze sprzed 0.21.0; kolektor ich nie oferuje, serwer je zna
    { delivery: idZamknietej, line: null, typ: "qty_short", ilosc: 2, minut: -3 * 1440 + 40,
      kto: "Jan Kowalski", opis: "Wpis sprzed zmiany formularza",
      rozwiazany: "Dostawca dosłał 2 szt następną paczką" },
    { delivery: idZamknietej, line: null, typ: "qty_over", ilosc: 1, minut: -3 * 1440 + 45, kto: "Jan Kowalski" },
    { delivery: idZamknietej, line: null, typ: "no_space", ilosc: 3, minut: -3 * 1440 + 50, kto: "Jan Kowalski" },
    { delivery: idZamknietej, line: null, typ: "unknown_barcode", ilosc: 1, foto: FOTO_HISTORYCZNE,
      minut: -3 * 1440 + 55, kto: "Ewa Bąk" },
    { delivery: idZamknietej, line: null, typ: "ean_conflict", ilosc: 1, minut: -3 * 1440 + 58, kto: "Ewa Bąk" },
  ];

  for (const w of wiersze) {
    ins.run(
      w.delivery, w.line, w.typ, w.ilosc, w.symObcy ?? null, w.zamiast ?? null,
      iloscDok(w.line), w.opis ?? null, w.foto ?? null, chwila(w.minut), w.kto,
      w.rozwiazany ? chwila(w.minut + 120) : null, w.rozwiazany ?? null
    );
  }
  return wiersze.length;
}

/* ── Zamówienia do dostawcy ─────────────────────────────────────────────────
   Cztery warianty na JEDNYM towarze, bo karta ma je rozróżniać obok siebie:
   po terminie, w terminie, bez terminu i zrealizowane w całości (to ostatnie
   MA zniknąć z listy — brak wiersza jest tu wynikiem, nie brakiem danych).   */
function zamowienia(): number {
  const d = db();
  const insZam = d.prepare(
    `INSERT INTO sgt_zamowienie(dok_id, nr_pelny, data_wyst, termin, dostawca) VALUES (?,?,?,?,?)`
  );
  const insPoz = d.prepare(
    "INSERT INTO sgt_zam_pozycja(dok_id, tw_id, ilosc, zreal) VALUES (?,?,?,?)"
  );

  const zam: Array<[number, number, string | null, string, number, number]> = [
    // [dok_id, dni wstecz, termin, dostawca, ilość, zrealizowane]
    [9_001, 30, dzien(-4), "FALON-TECH", 20, 0],          // po terminie — dostawca się spóźnia
    [9_002, 12, dzien(9), "STIHL Polska", 50, 20],        // częściowo zrealizowane → zostało 30
    [9_003, 20, null, "HUSQVARNA", 8, 0],                 // bez terminu → koniec listy
    [9_004, 40, dzien(-20), "IMPORT SHANGHAI", 100, 100], // odebrane w całości → znika z karty
  ];
  for (const [dokId, wstecz, termin, dostawca, ilosc, zreal] of zam) {
    const data = dzien(-wstecz);
    insZam.run(dokId, `ZD ${dokId}/${mmrrrr(data)}`, data, termin, dostawca);
    insPoz.run(dokId, 900_022, ilosc, zreal);
  }
  return zam.length;
}

/* ── Konta i sesje ──────────────────────────────────────────────────────────
   Hasło jest jedno i jawne. Konta scenariuszowe istnieją po to, żeby dało się
   sprawdzić RÓŻNICE między rolami — a nie po to, żeby chronić cokolwiek.     */

/**
 * Konto-ślad z migracji: ani loginu, ani hasła.
 *
 * Nazwa jest DOKŁADNIE jednym z wariantów z dziennika i to jest tu sedno.
 * `migrujHistorie` dopasowuje po nazwie znormalizowanej, nie po podobieństwie,
 * więc zdarzenia podpisane „Jan K" podepną się pod ten wiersz zamiast założyć
 * kolejny. Dwa pozostałe warianty („Jan", „jan") zejdą się w jedno NOWE konto —
 * i to też jest wynik scenariusza, nie jego usterka.
 */
const KONTO_SLAD = "Jan K";

function konta(): number {
  const d = db();
  const ins = d.prepare(
    "INSERT INTO app_user(login, haslo_hash, name, role, active, created_at) VALUES (?,?,?,?,?,?)"
  );
  const hash = hashSekret(HASLO_SCENARIUSZY);

  const lista: Array<[string | null, string | null, string, string, number]> = [
    ["jan.k", hash, "Jan Kowalski", "magazynier", 1],
    ["ewa.b", hash, "Ewa Bąk", "magazynier", 1],
    ["biuro.test", hash, "Biuro (scenariusze)", "biuro", 1],
    /* Czwarta rola z 0.24.0. Login jest inny niż `admin`, bo tamten zakłada
       `npm run seed` — dwa konta o jednym loginie nie przeszłyby przez UNIQUE,
       a podmiana cudzego hasła byłaby najgorszym możliwym skutkiem seedu. */
    ["admin.test", hash, "Administrator (scenariusze)", "admin", 1],
    // S52 — konto wyłączone: hasło się zgadza, wejścia nie ma
    ["zwolniony", hash, "Marek Odszedł", "magazynier", 0],
    // S54 — login jest, hasła nie ma; takie konto nie zaloguje się nigdy
    ["bez.hasla", null, "Konto bez hasła", "magazynier", 1],
    // S53 — konto-ślad z migracji historii: ani loginu, ani hasła
    [null, null, KONTO_SLAD, "magazynier", 1],
  ];
  const idPoLoginie = new Map<string, number>();
  for (const [login, haslo, name, role, active] of lista) {
    const id = Number(ins.run(login, haslo, name, role, active, chwila(-90 * 1440)).lastInsertRowid);
    if (login) idPoLoginie.set(login, id);
    if (name === "Jan Kowalski") idJana = id;
    if (name === "Ewa Bąk") idEwy = id;
    if (name === "Biuro (scenariusze)") idBiura = id;
    if (name === "Administrator (scenariusze)") idAdmina = id;
    if (name === "Marek Odszedł") idZwolnionego = id;
  }

  /* S55 — trzy sesje w trzech stanach. Tokeny są czytelne, żeby dało się nimi
     wołać `curl` bez logowania; w trybie `seeded` to jest cała ich rola. */
  const insSesja = d.prepare(
    `INSERT INTO device_session(token, user_id, device_id, created_at, last_seen, revoked_at)
     VALUES (?,?,?,?,?,?)`
  );
  insSesja.run("scenariusz-jan", idPoLoginie.get("jan.k")!, "KOLEKTOR-01", chwila(-120), chwila(-3), null);
  insSesja.run("scenariusz-ewa", idPoLoginie.get("ewa.b")!, "KOLEKTOR-02", chwila(-240), chwila(-30), null);
  insSesja.run("scenariusz-biuro", idPoLoginie.get("biuro.test")!, null, chwila(-60), chwila(-1), null);
  insSesja.run("scenariusz-admin", idPoLoginie.get("admin.test")!, null, chwila(-60), chwila(-2), null);
  // sesja unieważniona — token istnieje, a nie otwiera niczego
  insSesja.run("scenariusz-uniewazniona", idPoLoginie.get("jan.k")!, "KOLEKTOR-03", chwila(-1440), chwila(-1400), chwila(-1380));
  // sesja sprzed dwóch miesięcy — `last_seen` niczego nie bramkuje, jest śladem
  insSesja.run("scenariusz-stara", idPoLoginie.get("jan.k")!, "KOLEKTOR-04", chwila(-60 * 1440), chwila(-60 * 1440), null);

  return lista.length;
}

/* Identyfikatory kont scenariuszowych — potrzebne dziennikowi i kolejce, żeby
   `user_ref` i `created_by_ref` wskazywały na konto, a nie tylko na napis. */
let idJana = 0;
let idEwy = 0;
let idBiura = 0;
let idAdmina = 0;
let idZwolnionego = 0;

/* ── Kolejka Sfery ──────────────────────────────────────────────────────────
   Każdy status z osobna, plus trzy przypadki, których z kolektora wystawić się
   nie da: uszkodzony payload, zadanie nieznanego typu i wiersz `done`, którego
   skutku nie widać w kartotece (materiał dla rekoncyliacji).                 */
function kolejka(): number {
  const ins = db().prepare(
    `INSERT INTO sfera_queue(type, payload, status, attempts, error_msg, sgt_doc_number, label, detail,
                             tw_id, source_doc_id, created_by, created_by_ref, created_at,
                             next_attempt_at, processed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  const zadania: Array<{
    typ: string; payload: string; status: string; proby?: number; blad?: string | null;
    docNo?: string | null; label: string; detail: string; twId: number; docId?: number | null;
    kto: string; ref: number; utworzone: number; nastepna?: number | null; przetworzone?: number | null;
  }> = [
    /* S41 — świeże zadanie czekające na workera. Wartość RÓŻNI SIĘ od pola
       w kartotece i to jest tu sedno: karta rysuje chipy z różnicy, więc
       zadanie zapisujące to samo, co już stoi w Subiekcie, nie pokazałoby ani
       chipa dochodzącego, ani schodzącego. Ten wpis daje oba naraz. */
    {
      typ: "set_location", payload: JSON.stringify({ twId: 900_011, newValue: "C01-02-02 B02-03-04 PAL-042 H04-01-02" }),
      status: "pending", label: "Lokalizacja · TEST-WIELE-LOK", detail: "C01-02-02 (karta)",
      twId: 900_011, kto: "Jan Kowalski", ref: idJana, utworzone: -2,
    },
    // S42 — pierwsza próba nieudana, następna za dwie minuty (backoff 5 s/30 s/2 min)
    {
      typ: "set_location", payload: JSON.stringify({ twId: 900_013, newValue: LOK_PRZY_LIMICIE }),
      status: "pending", proby: 1, blad: "Zapis Sfery nieudany — kartoteka w edycji (Subiekt)",
      label: "Lokalizacja · TEST-LOK-LIMIT", detail: "A01-02-03 (karta)",
      twId: 900_013, kto: "Jan Kowalski", ref: idJana, utworzone: -8, nastepna: 2,
    },
    // S43 — worker padł w połowie i zostawił zadanie w `processing`; payload celowo
    // nieparsowalny, bo `pendingMmByTw` musi taki wiersz przeżyć, nie wywalić kartę
    {
      typ: "mm", payload: "{to nie jest JSON", status: "processing",
      label: "Przesunięcie · TEST-MGP", detail: "10 szt MGP→MAG",
      twId: 900_023, kto: "Ewa Bąk", ref: idEwy, utworzone: -40,
    },
    // S44 — MM czeka na wyjście dokumentu 9004 z bufora
    {
      typ: "mm", payload: JSON.stringify({ magFrom: MGP, magTo: MAG, items: [{ twId: 900_041, qty: 40 }] }),
      status: "waiting_for_doc", label: "Przesunięcie · TEST-KONTENER-1", detail: "40 szt MGP→MAG",
      twId: 900_041, docId: 9_004, kto: "Ewa Bąk", ref: idEwy, utworzone: -30, nastepna: 1,
    },
    // S45 — to samo, ale od pięciu dni: rekoncyliacja ma je wyłowić
    {
      typ: "mm", payload: JSON.stringify({ magFrom: MGP, magTo: MAG, items: [{ twId: 900_043, qty: 24 }] }),
      status: "waiting_for_doc", label: "Przesunięcie · TEST-KONTENER-3", detail: "24 szt MGP→MAG",
      twId: 900_043, docId: 9_004, kto: "Ewa Bąk", ref: idEwy, utworzone: -5 * 1440, nastepna: 1,
    },
    // zapis udany i zgodny z kartoteką — tło dla rekoncyliacji (ma go pominąć)
    {
      typ: "set_location", payload: JSON.stringify({ twId: 900_021, newValue: "H04-01-02" }),
      status: "done", label: "Lokalizacja · TEST-WSZEDZIE", detail: "H04-01-02 (dostawa)",
      twId: 900_021, kto: "Jan Kowalski", ref: idJana, utworzone: -180, przetworzone: -179,
    },
    // S50 — zapis „wszedł", a w kartotece stoi co innego: rozjazd do wyłowienia
    {
      typ: "set_location", payload: JSON.stringify({ twId: 900_025, newValue: "F02-02-04" }),
      status: "done", label: "Lokalizacja · TEST-ROZJAZD", detail: "F02-02-04 (karta)",
      twId: 900_025, kto: "Jan Kowalski", ref: idJana, utworzone: -200, przetworzone: -199,
    },
    // S46 — błąd świeży: czerwony chip na karcie, PONÓW w kolejce
    {
      typ: "set_location", payload: JSON.stringify({ twId: 900_024, newValue: "J02-02-09" }),
      status: "error", proby: 3, blad: "Zapis Sfery nieudany — kartoteka w edycji (Subiekt)",
      label: "Lokalizacja · TEST-BLAD-ZAPISU", detail: "J02-02-09 (karta)",
      twId: 900_024, kto: "Jan Kowalski", ref: idJana, utworzone: -25, przetworzone: -20,
    },
    // S47 — błąd sprzed trzech dni: nikt go nie ponowił, rekoncyliacja ma krzyknąć
    {
      typ: "mm", payload: JSON.stringify({ magFrom: MGP, magTo: MAG, items: [{ twId: 900_042, qty: 12 }] }),
      status: "error", proby: 3, blad: "Worker Sfery (COM) niedostępny — dokument MM wystawia biuro",
      label: "Przesunięcie · TEST-KONTENER-2", detail: "12 szt MGP→MAG",
      twId: 900_042, kto: "Ewa Bąk", ref: idEwy, utworzone: -3 * 1440 - 60, przetworzone: -3 * 1440,
    },
    // S48 — typ, którego worker nie zna; kończy się czytelnym błędem, nie ciszą
    {
      typ: "przecena", payload: JSON.stringify({ twId: 900_007, cena: 12.5 }),
      status: "pending", label: "Zadanie nieznanego typu", detail: "worker ma je odrzucić",
      twId: 900_007, kto: "Biuro (scenariusze)", ref: idBiura, utworzone: -1,
    },
    // S49 — kolejka jest rezerwacją: 40 z 60 szt na MGP jest już zajęte
    {
      typ: "mm", payload: JSON.stringify({ magFrom: MGP, magTo: MAG, items: [{ twId: 900_023, qty: 40 }] }),
      status: "pending", label: "Przesunięcie · TEST-MGP", detail: "40 szt MGP→MAG",
      twId: 900_023, kto: "Jan Kowalski", ref: idJana, utworzone: -5,
    },
  ];

  for (const z of zadania) {
    ins.run(
      z.typ, z.payload, z.status, z.proby ?? 0, z.blad ?? null, z.docNo ?? null,
      z.label, z.detail, z.twId, z.docId ?? null, z.kto, z.ref,
      chwila(z.utworzone),
      z.nastepna == null ? null : chwila(z.nastepna),
      z.przetworzone == null ? null : chwila(z.przetworzone)
    );
  }
  return zadania.length;
}

/* ── Dziennik zdarzeń ───────────────────────────────────────────────────────
   Dziennik jest jedyną odpowiedzią na „aplikacja zjadła mi 30 sztuk", więc
   scenariusze muszą pokryć KAŻDY typ, który filtruje audyt — łącznie z tymi,
   których nikt nie wywoła ręcznie (`queue_failed`, `http_rejected`).

   Trzy wiersze są celowo zepsute albo niekompletne: uszkodzony payload, wpis
   bez `locsPrzed` (historia sprzed sierpnia 2026) i zdarzenia bez konta.
   Każdy z nich ma w kodzie gałąź, której nic innego nie sprawdza.            */
function dziennik(): number {
  const ins = db().prepare(
    "INSERT INTO events(type, tw_id, payload, user_id, device_id, user_ref, created_at) VALUES (?,?,?,?,?,?,?)"
  );
  let n = 0;
  const zdarzenie = (
    typ: string, kto: string, ref: number | null, twId: number | null,
    payload: unknown, minut: number, device: string | null = "KOLEKTOR-01"
  ) => {
    ins.run(
      typ, twId,
      typeof payload === "string" ? payload : payload == null ? null : JSON.stringify(payload),
      kto, device, ref, chwila(minut)
    );
    n++;
  };

  // ── S57: po jednym wierszu każdego typu ──
  zdarzenie("login", "Jan Kowalski", idJana, null, { login: "jan.k", role: "magazynier" }, -200);
  zdarzenie("login_failed", "jan.k", null, null, { login: "jan.k" }, -205);
  zdarzenie("scan", "Jan Kowalski", idJana, null, { code: "5900000000011", kind: "EAN" }, -190);
  zdarzenie("delivery_open", "Jan Kowalski", idJana, null, { deliveryId: 1, dokId: 9_002 }, -95);
  zdarzenie("putaway_line_done", "Jan Kowalski", idJana, 900_037, { lineId: 2, qty: 6, location: "F02-02-08", status: "done" }, -60);
  zdarzenie("location_mismatch", "Jan Kowalski", idJana, 900_038, { expected: "G01-02-03", actual: "G01-02-07" }, -58);
  zdarzenie("location_set", "Jan Kowalski", idJana, 900_011, { locsPrzed: "B02-03-04", result: "A01-02-03 B02-03-04", zrodlo: "karta", action: "add", value: "A01-02-03", queueId: 1 }, -55);
  zdarzenie("location_removed", "Jan Kowalski", idJana, 900_011, { locsPrzed: "A01-02-03 PAL-042", result: "A01-02-03", zrodlo: "karta", action: "remove", value: "PAL-042" }, -54);
  zdarzenie("przesuniecie", "Ewa Bąk", idEwy, 900_023, { magFrom: MGP, magTo: MAG, kodFrom: "MGP", kodTo: "MAG", qty: 40, dostepnePrzed: 60, location: "J02-02-03" }, -5, "KOLEKTOR-02");
  zdarzenie("problem_raised", "Jan Kowalski", idJana, null, { problemId: 1, typ: "damaged", lineId: 6 }, -70);
  zdarzenie("problem_resolved", "Biuro (scenariusze)", idBiura, null, { problemId: 7 }, -3 * 1440 + 160, null);
  zdarzenie("przesylka_zapisana", "Jan Kowalski", idJana, null, { deliveryId: 1, kurierProtokol: "tak" }, -90);
  zdarzenie("delivery_done", "Jan Kowalski", idJana, null, { deliveryId: 2 }, -3 * 1440 + 70);
  zdarzenie("ean_conflict", "Jan Kowalski", idJana, null, { ean: "5901234567890", candidates: [900_001, 900_002] }, -45);
  zdarzenie("ean_conflict_autoresolved", "Jan Kowalski", idJana, 900_003, { ean: "5907654321098", candidates: [900_003, 900_004, 900_005] }, -44);
  zdarzenie("privileged", "Biuro (scenariusze)", idBiura, null, { operacja: "domkniecie_dostawy" }, -41, null);
  zdarzenie("queue_applied", "Jan Kowalski", idJana, 900_021, { queueId: 6, typ: "set_location", docNo: null, proby: 0 }, -179, null);
  zdarzenie("queue_retry", "Jan Kowalski", idJana, 900_013, { queueId: 2, typ: "set_location", proba: 1, max: 3, blad: "Kartoteka w edycji" }, -8, null);
  zdarzenie("queue_failed", "Jan Kowalski", idJana, 900_024, { queueId: 8, typ: "set_location", proby: 3, blad: "Kartoteka w edycji" }, -20, null);
  zdarzenie("http_rejected", "Jan Kowalski", idJana, null, { method: "POST", url: "/api/delivery/lines/6/putaway", status: 409 }, -35);
  zdarzenie("device_drop", "Jan Kowalski", idJana, null, { g: 5.8, bateria: 41 }, -30);
  /* Trzy zdarzenia zarządzania kontami. Podpisuje je ADMIN, bo od 0.24.0 tylko
     ta rola może zakładać konta biurowe, odbierać hasło i wyłączać konto —
     i tylko na niej widać różnicę wobec biura. */
  zdarzenie("user_created", "Administrator (scenariusze)", idAdmina, null, { userId: idBiura, role: "biuro" }, -3 * 1440, null);
  zdarzenie("user_haslo_changed", "Administrator (scenariusze)", idAdmina, null, { userId: idJana, wlasne: false }, -1440, null);
  zdarzenie("user_active_changed", "Administrator (scenariusze)", idAdmina, null, { userId: idZwolnionego, active: false }, -1400, null);
  zdarzenie("magazyny_widocznosc", "Biuro (scenariusze)", idBiura, null, { ukryte: [MAG_ARCHIWUM], kody: ["ARCH"] }, -60, null);
  zdarzenie("audyt_eksport", "Biuro (scenariusze)", idBiura, null, { filtr: { od: "2026-08-01" }, wierszy: 96 }, -15, null);
  zdarzenie("search", "Jan Kowalski", idJana, null, { q: "filtr" }, -185);
  zdarzenie("klient_odrzucona", "Jan Kowalski", idJana, null, { rodzaj: "offline_putaway", powod: "brak sesji przy odbuforowaniu", status: 401 }, -33);

  // ── S58: historia sprzed kont — trzy warianty jednej osoby, bez `user_ref` ──
  zdarzenie("scan", "Jan", null, 900_011, { code: "TEST-WIELE-LOK", kind: "TEXT" }, -40 * 1440, "KOLEKTOR-01");
  zdarzenie("location_set", "jan", null, 900_011, { action: "add", value: "PAL-042", result: "PAL-042" }, -40 * 1440 + 5, "KOLEKTOR-01");
  zdarzenie("scan", "Jan K", null, 900_007, { code: "59012345", kind: "EAN" }, -39 * 1440, "KOLEKTOR-02");

  // ── S59: dwa wiersze, na których historia karty musi się NIE wywrócić ──
  // payload nie do sparsowania — `productHistory` ma pokazać wpis bez szczegółu
  zdarzenie("location_set", "Jan Kowalski", idJana, 900_011, "{ucięty payload", -35 * 1440);
  // wpis sprzed `locsPrzed`: formatowanie schodzi do „→ wartość"
  zdarzenie("location_set", "Jan Kowalski", idJana, 900_011, { action: "replace", value: "B02-03-04", result: "B02-03-04" }, -34 * 1440);

  // ── S60: metryki ──
  /* Etykieta regału B02-03-04 wpisywana z ręki sześć razy na dziesięć skanów —
     to jest ten raport, dla którego `manual_entry` jest osobnym typem. */
  for (let i = 0; i < 6; i++) {
    zdarzenie("manual_entry", "Jan Kowalski", idJana, null, { code: "B02-03-04", kind: "LOC", screen: "dostawa" }, -100 - i);
  }
  for (let i = 0; i < 4; i++) {
    zdarzenie("scan", "Jan Kowalski", idJana, null, { code: "B02-03-04", kind: "LOC" }, -110 - i);
  }
  // kartoteka bez czytelnego kodu: wpisywana, nigdy skanowana
  for (let i = 0; i < 3; i++) {
    zdarzenie("manual_entry", "Ewa Bąk", idEwy, null, { code: "T32-0203", kind: "TEXT", screen: "skan" }, -120 - i, "KOLEKTOR-02");
  }
  /* Czasy skan → odpowiedź. Cel to p95 < 150 ms, a ten rozkład go PRZEKRACZA
     (p95 = 420 ms) — metryka ma czasem świecić na czerwono, inaczej nie wiadomo,
     czy w ogóle działa. */
  for (const ms of [88, 92, 96, 101, 104, 110, 118, 124, 131, 140, 152, 168, 190, 220, 260, 310, 360, 420, 480, 520]) {
    zdarzenie("scan_timing", "Jan Kowalski", idJana, null, { ms }, -130);
  }

  // ── S61: wydajność — jedna próbka wiarygodna, druga poniżej progu ──
  /* Jan: 26 odłożeń w dwóch seriach z 40-minutową przerwą w środku. Przerwa
     jest tu treścią scenariusza: `czasAktywny` ma ją ODCIĄĆ, więc tempo liczy
     się z czasu pracy, a nie z okna „od pierwszego do ostatniego zdarzenia". */
  for (let i = 0; i < 13; i++) {
    zdarzenie("putaway_line_done", "Jan Kowalski", idJana, 900_036, { lineId: 1, qty: 1, status: "done" }, -300 + i * 3);
  }
  for (let i = 0; i < 13; i++) {
    zdarzenie("putaway_line_done", "Jan Kowalski", idJana, 900_036, { lineId: 1, qty: 1, status: "done" }, -220 + i * 3);
  }
  // Ewa: osiem pozycji, czyli poniżej progu 20 — wiersz ma dostać `wiarygodne: false`
  for (let i = 0; i < 8; i++) {
    zdarzenie("putaway_line_done", "Ewa Bąk", idEwy, 900_041, { lineId: 9, qty: 1, status: "done" }, -180 + i * 4, "KOLEKTOR-02");
  }

  return n;
}

/* ── Kolizje kodów kreskowych ───────────────────────────────────────────────
   Raport dla biura mierzy, ile razy dany kod ZATRZYMAŁ pracę. Dwa kody, dwa
   różne kształty: jeden zatrzymuje zawsze, drugi bywa zawężany dokumentem.   */
function kolizjeEan(): void {
  const ins = db().prepare(
    "INSERT INTO ean_conflict(ean, tw_ids, auto, seen_at) VALUES (?,?,?,?)"
  );
  for (let i = 0; i < 4; i++) {
    ins.run("5901234567890", JSON.stringify([900_001, 900_002]), 0, chwila(-45 - i * 60));
  }
  ins.run("5907654321098", JSON.stringify([900_003, 900_004, 900_005]), 1, chwila(-44));
  ins.run("5907654321098", JSON.stringify([900_003, 900_004, 900_005]), 0, chwila(-400));
}

/* ── Historia pobrań (dokumenty WZ) ─────────────────────────────────────────
   Raport przeslotowania miał w trybie demo bezpiecznik: bez historii pobrań
   odmawiał wypisania list 1–3, bo każdy indeks wyglądałby na martwy. Odmawiał
   ZAWSZE, bo seed nie zawierał ani jednego WZ — czyli jedyna funkcja licząca
   pracę magazynu nie dawała się w ogóle zobaczyć przed wdrożeniem.

   Pobrania są syntetyczne i tak mają być rozumiane. Rozkład jest jednak
   ZBLIŻONY do prawdy o tym magazynie: około 30% kartotek rusza się w ogóle,
   a garstka odpowiada za większość wystąpień. Zero losowości — udział wynika
   z `tw_id`, więc dwa uruchomienia dają tę samą historię.                    */

/** Deterministyczny rozrzut 0–999 z `tw_id`; mnożnik Knutha, bez losowości. */
const rozrzut = (twId: number): number => (twId * 2_654_435_761) % 1000;

/** Ile razy dana kartoteka pojawiła się na WZ przez ostatnie 12 miesięcy. */
function pobraniaDla(twId: number): number {
  const h = rozrzut(twId);
  if (h < 700) return 0;          // ~70% kartotek nie rusza się wcale
  if (h < 950) return 1 + (h % 4); // wolnorotujące: 1–4 wystąpienia
  return 12 + (h % 34);            // szybkorotujące: 12–45 wystąpień
}

/** Ile dokumentów WZ rozkłada na siebie całą historię. */
const WZ_DOKUMENTOW = 120;

function historiaPobran(): { dokumentow: number; pozycji: number } {
  const d = db();
  const insDok = d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,?,?,?,?,?,0)`
  );
  const insPoz = d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)");

  for (let i = 0; i < WZ_DOKUMENTOW; i++) {
    // 120 dokumentów co trzy dni wstecz — równy rok historii
    const data = dzien(-3 * i);
    insDok.run(DOK_WZ_OD + i, TYP_WZ, `${TYP_WZ} ${1000 + i}/${mmrrrr(data)}`, data, MAG, "Wydania z magazynu");
  }

  /* Kartoteki z kolejki: prawdziwe (z `npm run seed`) i scenariuszowe.
     Na pustej bazie pierwsza grupa jest pusta i to jest w porządku — raport
     policzy wtedy same scenariusze S63–S65. */
  const towary = d
    .prepare("SELECT tw_id FROM sgt_towar WHERE lokalizacja <> '' ORDER BY tw_id")
    .all() as Array<{ tw_id: number }>;

  /* Kontrolowane przypadki mają liczby WPISANE, nie wyliczone: to na nich stoi
     opis w dokumentacji, więc nie wolno im zależeć od funkcji rozrzutu. */
  const wymuszone = new Map<number, { pobran: number; sztuk: number }>([
    [900_028, { pobran: 0, sztuk: 0 }],    // S63 — martwy w strefie złotej
    [900_029, { pobran: 40, sztuk: 1 }],   // S63 — szybkorotujący poza strefą
    [900_030, { pobran: 2, sztuk: 200 }],  // S64 — mało pobrań, dużo sztuk
    [900_031, { pobran: 0, sztuk: 0 }],    // S65 — regał bez reguły
  ]);

  let pozycji = 0;
  for (const { tw_id } of towary) {
    const wym = wymuszone.get(tw_id);
    const ile = wym ? wym.pobran : pobraniaDla(tw_id);
    const sztuk = wym ? wym.sztuk : 1 + (rozrzut(tw_id) % 3);
    for (let i = 0; i < ile; i++) {
      // rozrzucenie po dokumentach wprost z identyfikatorów — powtarzalne
      const dok = DOK_WZ_OD + ((tw_id * 7 + i * 13) % WZ_DOKUMENTOW);
      insPoz.run(dok, tw_id, sztuk);
      pozycji++;
    }
  }
  return { dokumentow: WZ_DOKUMENTOW, pozycji };
}

/* ── Zdjęcia dowodowe ───────────────────────────────────────────────────────
   Trzy pliki na dysku i JEDNA referencja bez pliku (S37). Trasa zdjęcia musi
   odróżniać te przypadki, bo w firmie zdarzy się dokładnie to: kopia bazy bez
   katalogu `data/photos`.                                                    */
/* ── S67–S69: sprzedaż pod zwroty Allegro ───────────────────────────────────
   Dokumenty FS/PA w read-modelu `sgt_sprzedaz` — dokładnie to, co na produkcji
   przyniósłby importer MSSQL. Zestrojone 1:1 z fikcyjnymi zwrotami adaptera
   dev (`adapters/allegro.dev.ts`): numery zamówień, symbole i ilości muszą się
   zgadzać, bo scenariusze mierzą właśnie dopasowanie. */
function sprzedazDemo(): number {
  const d = db();
  const insDok = d.prepare(
    `INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, uwagi, mag_id)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insPoz = d.prepare(
    "INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)"
  );

  // S67 — FS z numerem zamówienia Allegro w numerze obcym: dopasowanie auto
  // Magazyn sprzedaży wprost: to on jest źródłem MM na bufor zwrotowy (Etap 2).
  insDok.run(DOK_SPRZ_OD, "FS", `FS ${DOK_SPRZ_OD}/${mmrrrr(dzien(-10))}`, "dev-ord-1", dzien(-10), "ALLEGRO", null, config.magId.MAG);
  insPoz.run(DOK_SPRZ_OD, 900_036, 1); // TEST-LINIA-TODO
  insPoz.run(DOK_SPRZ_OD, 900_037, 2); // TEST-LINIA-DONE

  /* S68 — DWA paragony z tym samym towarem, żaden bez numeru zamówienia nie
     wygrywa sam: szczegół zwrotu pokazuje kandydatów i czeka na wybór ręką. */
  insDok.run(DOK_SPRZ_OD + 1, "PA", `PA ${DOK_SPRZ_OD + 1}/${mmrrrr(dzien(-12))}`, null, dzien(-12), "DETAL", null, config.magId.MAG);
  insPoz.run(DOK_SPRZ_OD + 1, 900_029, 1); // TEST-ROTUJACY
  insDok.run(DOK_SPRZ_OD + 2, "PA", `PA ${DOK_SPRZ_OD + 2}/${mmrrrr(dzien(-20))}`, null, dzien(-20), "DETAL", null, config.magId.MAG);
  insPoz.run(DOK_SPRZ_OD + 2, 900_029, 1);

  return 3;
}

/**
 * Przyjęcia na regał zwrotów — kosze, których numer magazyn nosi na kartce.
 *
 * Numery wzorowane na prawdziwych („MM 1240/MAG/2026"), bo to po nich
 * magazynier szuka kosza i tak samo wygląda pole na kolektorze.
 */
function przyjeciaDemo(): number {
  const d = db();
  const insDok = d.prepare(
    `INSERT INTO sgt_mm_zwrot(dok_id, nr_pelny, numer, data_wyst, mag_z, mag_do)
     VALUES (?,?,?,?,?,?)`
  );
  const insPoz = d.prepare(
    `INSERT INTO sgt_mm_zwrot_pozycja(dok_id, tw_id, ilosc, symbol, nazwa)
     VALUES (?,?,?,?,?)`
  );
  const kosze: Array<[number, number, Array<[number, number]>]> = [
    // [dok_id, dni temu, [[tw_id, ilość], …]]
    /* Trzecia pozycja pierwszego kosza (900_099) NIE MA kartoteki w ziarnie —
       tak wygląda towar zablokowany w Subiekcie, a właśnie taki najczęściej
       wraca na regał zwrotów. Kosz ma go pokazać z nazwą ze snapshotu. */
    [DOK_MM_OD, -1, [[900_036, 1], [900_037, 2], [900_099, 1]]],
    [DOK_MM_OD + 5, -3, [[900_029, 2]]],
    // kosz sprzed wdrożenia — na nim admin ćwiczy „JUŻ ROZŁOŻONY"
    [DOK_MM_OD + 9, -12, [[900_036, 3], [900_037, 1]]],
  ];
  for (const [dokId, dni, pozycje] of kosze) {
    const numer = String(dokId - DOK_MM_OD + 1200);
    insDok.run(
      dokId,
      `MM ${numer}/MAG/${new Date().getFullYear()}`,
      numer,
      dzien(dni),
      config.magId.MAG,
      config.magId.ZWROTY
    );
    for (const [twId, ilosc] of pozycje) {
      const t = d.prepare("SELECT symbol, nazwa FROM sgt_towar WHERE tw_id = ?").get(twId) as
        | { symbol: string; nazwa: string }
        | undefined;
      insPoz.run(
        dokId,
        twId,
        ilosc,
        t?.symbol ?? "TEST-ZABLOKOWANY",
        t?.nazwa ?? "Towar wycofany ze sprzedaży (kartoteka zablokowana)"
      );
    }
  }
  return kosze.length;
}

/* ── Skrzynka pytań klientów (S73, S74) ──────────────────────────────────────
 * Do 0.96.0 seed nie zakładał ANI JEDNEGO pytania, więc zakładka PYTANIA
 * KLIENTÓW pokazywała w demo pustą skrzynkę i trzech stref nie dało się na
 * niej obejrzeć — one włączają się dopiero przy otwartej sprawie. Ta sama
 * pustka zdarza się w biurze w spokojny dzień; różnica polega na tym, że tam
 * jest prawdą, a tu ukrywała pół zakładki przed każdym, kto ją sprawdzał.
 *
 * Trzy pytania pokrywają trzy stany, którymi szyna się różni: bez szkicu,
 * ze szkicem po poprawce człowieka i wysłane. Czwarte pyta o towar, którego
 * nie mamy — to jedyne źródło danych dla listy „pytali o towar spoza oferty".
 */
function pytaniaDemo(): number {
  const d = db();
  const wstaw = d.prepare(
    `INSERT INTO pytanie(zrodlo, thread_id, wiadomosc_id, kupujacy_login, kupujacy_id,
                         oferta_id, oferta_tytul, tresc, otrzymano_at, status,
                         szkic_ai, szkic_at, odpowiedz, wyslano_at, odpowiedzial,
                         edytowano, kategoria, urzadzenie, produkty_json,
                         w_ofercie, utworzono_at, utworzono_przez, prowadzi, prowadzi_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  /* `wiadomosc_id` z przedrostkiem `dev-msg-` — po nim kasuje je `wyczysc()`,
     tak samo jak zwroty po `dev-ret-`. Pytania wklejone ręcznie zostają. */
  const pytania = [
    {
      // S73a — sprawa BEZ szkicu: stan „czeka na szkic", pusta szyna kontekstu
      msg: "dev-msg-0001", login: "client:44112097", minut: -1440,
      oferta: "GAŹNIK DO STIHL MS 180 GAŹNIK ZAMA DO PIŁY STIHL 017 018 MS170 MS180 FILTR",
      tresc: "Dzień dobry, czy ten gaźnik pasuje do MS 170 z 2019 roku? I czy w komplecie jest filtr paliwa?",
      status: "nowe", szkic: null, odpowiedz: null, edytowano: 0,
      kategoria: "dobor-czesci", urzadzenie: "STIHL MS 170",
      produkty: [], wOfercie: null, prowadzi: null,
    },
    {
      // S73b — szkic PO poprawce człowieka: szyna szkicu ma być zgaszona
      msg: "dev-msg-0002", login: "client:44251880", minut: -300,
      oferta: "OLEJ BRIGGS STRATTON 0,6L SAE30 KOSIARKI AGREGATU TRAKTORKA CZTEROSUWOWYCH",
      tresc: "Witam, ile takich olejów potrzeba na wymianę w kosiarce spalinowej? Starczy jedna butelka?",
      status: "szkic",
      szkic: "Dzień dobry, do wymiany w kosiarce spalinowej wystarcza jedna butelka 0,6 l. Pozdrawiamy, WERTIS",
      odpowiedz: "Dzień dobry, do typowej kosiarki spalinowej wystarcza jedna butelka 0,6 l — miska olejowa mieści zwykle 0,5–0,6 l. Pozdrawiamy, WERTIS",
      edytowano: 1, kategoria: "dobor-czesci", urzadzenie: null,
      produkty: [{ twId: 900_017, symbol: "TEST-ULAMEK" }], wOfercie: 1,
      prowadzi: "Ewa Bąk",
    },
    {
      // S73c — sprawa ZAŁATWIONA: liczy się do mediany czasu odpowiedzi
      msg: "dev-msg-0003", login: "client:44300104", minut: -2880,
      oferta: "ŚWIECA ZAPŁONOWA do kosiarek i agregatów — trio EAN",
      tresc: "witam czy można wysłać do Chorwacji i na kiedy by było i jaki koszt wysyłki oczywiście płatność z góry",
      status: "wyslane",
      szkic: "Dzień dobry, tak, wysyłamy do Chorwacji. Pozdrawiamy, WERTIS",
      odpowiedz: "Dzień dobry, tak, wysyłamy do Chorwacji — paczka kurierska DPD, koszt 89 zł, czas dostawy 4–6 dni roboczych. Płatność z góry przelewem, wysyłka następnego dnia roboczego po zaksięgowaniu. Pozdrawiamy, WERTIS",
      edytowano: 1, kategoria: "dostawa-wysylka", urzadzenie: null,
      produkty: [{ twId: 900_003, symbol: "TEST-TRIO-1" }], wOfercie: 1,
      prowadzi: null, wyslaneMinut: -2820, odpowiedzial: "Jan Kowalski",
    },
    {
      // S74 — pytanie o towar SPOZA oferty: jedyne dane pod listę braków
      msg: "dev-msg-0004", login: "client:44380022", minut: -4320,
      oferta: null,
      tresc: "Szukam noża do kosiarki NAC LS46-127 o długości 46 cm. Macie taki?",
      status: "wyslane",
      szkic: "Dzień dobry, niestety nie mamy tego noża w ofercie. Pozdrawiamy, WERTIS",
      odpowiedz: "Dzień dobry, niestety nie mamy tego noża w ofercie. Pozdrawiamy, WERTIS",
      edytowano: 0, kategoria: "dobor-czesci", urzadzenie: "NAC LS46-127",
      produkty: [], wOfercie: 0,
      prowadzi: null, wyslaneMinut: -4260, odpowiedzial: "Ewa Bąk",
    },
    /* ── Tło pod ANALIZĘ (0.99.0) ────────────────────────────────────────────
       Cztery pytania wyżej stoją w jednym tygodniu i opisują STANY sprawy —
       to ich zadanie. Wykres tygodni, słupki proporcji i zdanie o szczycie
       potrzebują czegoś innego: rozrzutu w czasie i różnych towarów. Bez tego
       zakładka pokazywała jeden słupek i cztery jednakowe paski, czyli nie
       dawało się zobaczyć, czy w ogóle działa. Ta sama luka, przez którą
       skrzynka pytań stała pusta do 0.96.0. */
    {
      msg: "dev-msg-0005", login: "client:44112097", minut: -14_400,
      oferta: "GAŹNIK DO STIHL MS 180 GAŹNIK ZAMA DO PIŁY STIHL 017 018 MS170 MS180 FILTR",
      tresc: "Dzień dobry, czy do MS 180 pasuje ten sam gaźnik co do 170? Piła z 2016 roku.",
      status: "wyslane",
      szkic: "Dzień dobry, tak — te modele mają wspólny gaźnik. Pozdrawiamy, WERTIS",
      odpowiedz: "Dzień dobry, tak — MS 170 i MS 180 mają wspólny gaźnik Zama C1Q-S57B. Pozdrawiamy, WERTIS",
      edytowano: 1, kategoria: "dobor-czesci", urzadzenie: "STIHL MS 180",
      produkty: [{ twId: 900_003, symbol: "TEST-TRIO-1" }], wOfercie: 1,
      prowadzi: null, wyslaneMinut: -14_100, odpowiedzial: "Jan Kowalski",
    },
    {
      msg: "dev-msg-0006", login: "client:44251880", minut: -24_000,
      oferta: "OLEJ BRIGGS STRATTON 0,6L SAE30 KOSIARKI AGREGATU TRAKTORKA CZTEROSUWOWYCH",
      tresc: "Czy ten olej nadaje się do agregatu prądotwórczego, czy tylko do kosiarki?",
      status: "wyslane",
      szkic: "Dzień dobry, nadaje się także do agregatów. Pozdrawiamy, WERTIS",
      odpowiedz: "Dzień dobry, nadaje się także do agregatów czterosuwowych. Pozdrawiamy, WERTIS",
      edytowano: 0, kategoria: "dobor-czesci", urzadzenie: null,
      produkty: [{ twId: 900_017, symbol: "TEST-ULAMEK" }], wOfercie: 1,
      prowadzi: null, wyslaneMinut: -23_940, odpowiedzial: "Ewa Bąk",
    },
    {
      msg: "dev-msg-0007", login: "client:44380022", minut: -33_600,
      oferta: null,
      tresc: "Potrzebuję rozrusznika linkowego do agregatu Loncin G200F. Da się zamówić?",
      status: "wyslane",
      szkic: "Dzień dobry, nie prowadzimy części do Loncin. Pozdrawiamy, WERTIS",
      odpowiedz: "Dzień dobry, nie prowadzimy części do Loncin. Pozdrawiamy, WERTIS",
      edytowano: 0, kategoria: "dobor-czesci", urzadzenie: "Loncin G200F",
      produkty: [], wOfercie: 0,
      prowadzi: null, wyslaneMinut: -33_540, odpowiedzial: "Jan Kowalski",
    },
    {
      msg: "dev-msg-0008", login: "client:44300104", minut: -46_000,
      oferta: "ŚWIECA ZAPŁONOWA do kosiarek i agregatów — trio EAN",
      tresc: "Jaki jest odstęp elektrod w tej świecy? Instrukcja podaje 0,7 mm.",
      status: "wyslane",
      szkic: "Dzień dobry, odstęp fabryczny to 0,7 mm. Pozdrawiamy, WERTIS",
      odpowiedz: "Dzień dobry, odstęp fabryczny to 0,7 mm i tak jest ustawiona. Pozdrawiamy, WERTIS",
      edytowano: 1, kategoria: "dobor-czesci", urzadzenie: null,
      produkty: [{ twId: 900_003, symbol: "TEST-TRIO-1" }], wOfercie: 1,
      prowadzi: null, wyslaneMinut: -45_900, odpowiedzial: "Ewa Bąk",
    },
    {
      msg: "dev-msg-0009", login: "client:44112097", minut: -60_000,
      oferta: null,
      tresc: "Szukam gaźnika do pilarki Stihl MS 181 C-BE, oznaczenie C1Q-S137. Jest na stanie?",
      status: "wyslane",
      szkic: "Dzień dobry, nie mamy tego gaźnika. Pozdrawiamy, WERTIS",
      odpowiedz: "Dzień dobry, nie mamy tego gaźnika w ofercie. Pozdrawiamy, WERTIS",
      edytowano: 0, kategoria: "dobor-czesci", urzadzenie: "STIHL MS 181 C-BE",
      produkty: [], wOfercie: 0,
      prowadzi: null, wyslaneMinut: -59_940, odpowiedzial: "Jan Kowalski",
    },
    {
      /* Para do PODPOWIEDZI „ten sam kupujący" (0.128.0): maska 44300001 to
         jan_wraca — kupujący zwrotu dev-ret-1 z adaptera dev. Pytanie nie ma
         zamówienia, więc NIE sklei się automatem — ma się tylko podpowiedzieć
         przy jego zwrocie i dyskusji. */
      msg: "dev-msg-0010", login: "client:44300001", minut: -900,
      oferta: "ŚRUBA MOCUJĄCA ZESTAW MONTAŻOWY",
      tresc: "Dzień dobry, w zestawie zabrakło śruby mocującej — czy mogą Państwo dosłać?",
      status: "nowe", szkic: null, odpowiedz: null, edytowano: 0,
      kategoria: null, urzadzenie: null,
      produkty: [], wOfercie: null, prowadzi: null,
    },
  ];

  for (const p of pytania) {
    wstaw.run(
      "allegro", `dev-thread-${p.msg.slice(-4)}`, p.msg, p.login,
      kupujacyIdZMaski(p.login),
      null, p.oferta, p.tresc, chwila(p.minut), p.status,
      p.szkic, p.szkic ? chwila(p.minut + 2) : null,
      p.odpowiedz,
      "wyslaneMinut" in p ? chwila(p.wyslaneMinut as number) : null,
      "odpowiedzial" in p ? (p.odpowiedzial as string) : null,
      p.edytowano, p.kategoria, p.urzadzenie, JSON.stringify(p.produkty),
      p.wOfercie, chwila(p.minut), "Biuro (scenariusze)",
      p.prowadzi, p.prowadzi ? chwila(p.minut + 5) : null
    );
  }

  /* Potwierdzone dopasowania maszyna→część. Pierwsze jest tu od 0.96.0, żeby
     sekcja „skąd to dopasowanie" miała co pokazać poza samymi frazami; reszta
     doszła w 0.99.0 pod kafel „potwierdzonych dopasowań" w ANALIZIE. Kafel
     liczący zawsze jeden nie pokazuje, czy działa — ani czy działa filtr
     OSOBA, który jako jedyny z przekrojów produktowych go obejmuje. Stąd dwa
     nazwiska i różne daty. */
  const dopasuj = d.prepare(
    `INSERT OR IGNORE INTO dopasowanie(urzadzenie, symbol, tw_id, pytanie_id,
                                       potwierdzono_at, potwierdzono_przez)
     VALUES (?,?,?,(SELECT id FROM pytanie WHERE wiadomosc_id = ?),?,?)`
  );
  for (const [urzadzenie, symbol, twId, msg, minut, kto] of [
    ["STIHL MS 170", "TEST-TRIO-1", 900_003, "dev-msg-0003", -2800, "Jan Kowalski"],
    ["STIHL MS 180", "TEST-TRIO-1", 900_003, "dev-msg-0005", -14_050, "Jan Kowalski"],
    ["STIHL MS 180", "TEST-KOLIZJA-A", 900_001, "dev-msg-0005", -14_040, "Jan Kowalski"],
    ["NAC LS46-127", "TEST-ULAMEK", 900_017, "dev-msg-0004", -4200, "Ewa Bąk"],
    ["BRIGGS 550E", "TEST-ULAMEK", 900_017, "dev-msg-0006", -23_900, "Ewa Bąk"],
  ] as Array<[string, string, number, string, number, string]>) {
    dopasuj.run(urzadzenie, symbol, twId, msg, chwila(minut), kto);
  }

  return pytania.length;
}

function zdjecia(): void {
  const dir = path.resolve(path.dirname(config.dbPath), "photos");
  fs.mkdirSync(dir, { recursive: true });
  const bajty = Buffer.from(JPEG_1PX, "base64");
  for (const nazwa of [FOTO_USZKODZENIE, FOTO_BLEDNY, FOTO_HISTORYCZNE]) {
    fs.writeFileSync(path.join(dir, nazwa), bajty);
  }
  // FOTO_BRAK_PLIKU celowo NIE powstaje; gdyby został po wcześniejszym
  // uruchomieniu z inną zawartością, kasujemy go, żeby scenariusz był ten sam
  fs.rmSync(path.join(dir, FOTO_BRAK_PLIKU), { force: true });
}

/* ── Wypis dla człowieka ────────────────────────────────────────────────────
   Katalog na koniec, nie na początek: po uruchomieniu chce się wiedzieć, CO
   teraz da się sprawdzić i od czego zacząć.                                  */
function wypisz(licz: Podsumowanie): void {
  console.log(
    `[scenariusze] kartoteki=${licz.towary} dokumenty=${licz.dokumenty} dostawy=${licz.dostawy} ` +
      `linie=${licz.linie} wyjątki=${licz.wyjatki} kolejka=${licz.kolejka} konta=${licz.konta} ` +
      `zdarzenia=${licz.zdarzenia} zamówienia=${licz.zamowienia}`
  );
  console.log(`[scenariusze] historia pobrań: WZ=${licz.dokumentyWz}, pozycji=${licz.pozycjeWz}`);
  console.log(`[scenariusze] sprzedaż pod zwroty Allegro: dokumentów=${licz.sprzedaz}`);
  console.log(`[scenariusze] przyjęcia na regał zwrotów (kosze z kartką): ${licz.przyjecia}`);
  console.log(`[scenariusze] domknięte dostawy historyczne (analiza dostaw): ${licz.historiaDostaw}`);
  console.log(`[scenariusze] pytania klientów w skrzynce: ${licz.pytania}`);
  console.log("");
  let obszar = "";
  for (const s of KATALOG) {
    if (s.obszar !== obszar) {
      obszar = s.obszar;
      console.log(`── ${obszar.toUpperCase()} ${"─".repeat(Math.max(0, 66 - obszar.length))}`);
    }
    console.log(`  ${s.id}  ${s.tytul}\n        ↳ ${s.wejscie}`);
  }
  console.log("");
  console.log(`[scenariusze] konta: ${LOGINY.join(", ")} — hasło „${HASLO_SCENARIUSZY}"`);
  console.log(
    "[scenariusze] gotowe tokeny: scenariusz-jan (magazynier), scenariusz-ewa (magazynier), " +
      "scenariusz-biuro (biuro), scenariusz-admin (admin)"
  );
  console.log("[scenariusze] opis krok po kroku: docs/scenariusze-testowe.md");
}

/* Uruchomienie WYŁĄCZNIE wprost z wiersza poleceń. Import z testu ma dać sam
   katalog i funkcję — inaczej samo `import` przebudowałoby bazę. */
const wprost =
  !!process.argv[1] &&
  path.basename(process.argv[1]).replace(/\.(ts|js)$/, "") === "seed-scenariusze";

if (wprost) {
  if (process.argv.includes("--lista")) {
    for (const s of KATALOG) console.log(`${s.id}\t${s.obszar}\t${s.tytul}\t${s.wejscie}`);
  } else {
    wypisz(zbudujScenariusze());
  }
}

/** Szablony odpowiedzi na start (0.133.0) — trzy najczęstsze sytuacje. */
function szablonyDemo(): void {
  const d = db();
  if ((d.prepare("SELECT COUNT(*) AS n FROM szablon").get() as { n: number }).n > 0) return;
  const teraz = new Date().toISOString();
  const wstaw = d.prepare(
    `INSERT INTO szablon (nazwa, kanal, tresc, autor, utworzono_at, aktualizowano_at)
     VALUES (?,?,?, 'seed', ?, ?)`
  );
  const szablony: Array<[string, string, string]> = [
    [
      "Zwrot przyjęty",
      "dowolny",
      "Dzień dobry {{klient}},\n\npaczka ze zwrotem {{zwrot}} do zamówienia {{zamowienie}} " +
        "dotarła do nas i jest w trakcie sprawdzania. O decyzji dam znać w tej rozmowie.\n\n" +
        "Pozdrawiam\n{{ja}}",
    ],
    [
      "Prośba o numer zamówienia",
      "pytanie",
      "Dzień dobry,\n\nżeby sprawdzić sprawę, potrzebuję numeru zamówienia — jest w Allegro " +
        "w zakładce „Moje zakupy”. Odpiszę od razu, gdy go otrzymam.\n\nPozdrawiam\n{{ja}}",
    ],
    [
      "Środki wracają dziś",
      "dyskusja",
      "Dzień dobry {{klient}},\n\nzwrot został rozliczony — środki wracają dziś tą samą drogą, " +
        "którą przyszła płatność. Zaksięgowanie po stronie banku trwa zwykle do dwóch dni " +
        "roboczych.\n\nPozdrawiam\n{{ja}}",
    ],
  ];
  for (const [nazwa, kanal, tresc] of szablony) wstaw.run(nazwa, kanal, tresc, teraz, teraz);
}
