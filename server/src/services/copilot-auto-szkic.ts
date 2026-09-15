import type { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { db as defaultDb } from "../db/db.js";
import { logEvent } from "./events.js";
import { subiekt as domyslnySubiekt } from "../context.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import {
  BladKluczaCopilota, BladLimituCopilota, BladPrzeciazeniaCopilota,
} from "../adapters/copilot.js";
import { nadawcaSzkicuAnthropic } from "../adapters/copilot.anthropic.js";
import { ulozSzkic, type AutorSzkicu, type NadawcaSzkicu } from "./copilot-szkic.js";

/**
 * Szkic sam dla nowego pytania pod ofertą (0.317.0).
 *
 * ── SKĄD TO WYDANIE ─────────────────────────────────────────────────────────
 * Właściciel: „make copilot run automatically on new questions". Do 0.315.0
 * szkic powstawał wyłącznie z kliknięcia „Ułóż odpowiedź", więc agent otwierał
 * rozmowę, czytał pytanie, klikał i czekał kilka sekund. Teraz propozycja
 * czeka na niego, zanim zdąży doczytać wiadomość klienta.
 *
 * ── DLACZEGO TYLKO PYTANIA POD OFERTĄ ───────────────────────────────────────
 * Rozstrzygnięcie właściciela. Wiadomość niosąca `relatesTo.offer.id` to
 * pytanie SPRZED zakupu, czyli dokładnie ten przypadek, w którym Copilot ma
 * komplet faktów: kartotekę oferty, treść aukcji, kandydatów doboru, a od
 * 0.270.0 także adres naszej aktywnej aukcji. Przy „dziękuję", zmianie adresu
 * albo reklamacji szkic z faktów doboru niewiele wnosi, a kosztuje tyle samo.
 *
 * ── DWA HAMULCE, BO NIKT JUŻ NIE KLIKA ──────────────────────────────────────
 * Kliknięcie było hamulcem samo w sobie: agent prosił o pracę dla siebie
 * i płacił za jedną rozmowę. Takt nie ma takiego ogranicznika, więc dostaje
 * dwa jawne: `autoNaPrzebieg` (ile na jeden przebieg) oraz `autoNaGodzine`
 * (twardy sufit), liczony z księgi `copilot_wywolanie` ŁĄCZNIE z wywołaniami
 * zakończonymi błędem — nieudane też kosztuje.
 *
 * Sufit godzinowy liczymy z KSIĘGI, nie z licznika w pamięci: restart usługi
 * zerowałby licznik, a rachunek u dostawcy nie.
 *
 * ── CZEGO TEN TAKT NIE ROBI ─────────────────────────────────────────────────
 * Nie nadpisuje szkicu, który już odpowiada na NAJNOWSZE pytanie klienta
 * NA AKTUALNYCH DANYCH. Świeżość mierzą dwa pola — te same, którymi ekran
 * mówi „klient dopisał" i „dane doboru zmieniły się od szkicu".
 *
 * DRUGIE POLE DOSZŁO W 0.339.0 i bez niego tamto wydanie byłoby połową
 * funkcji. Model rozpoznaje w pytaniu markę, model i nazwę części, a te dane
 * od 0.339.0 wchodzą do doboru SAME. Kandydatów liczy się jednak z danych,
 * które stały tam PRZED wywołaniem modelu, więc pierwszy szkic ich jeszcze
 * nie zna: klient pyta pod gaźnikiem A o gaźnik do innej maszyny, dane
 * wpadają, i nikt by po nie nie wrócił. Zmiana wersji doboru budzi takt,
 * a drugi szkic pisze się już z kandydatami.
 *
 * Pętli z tego nie ma: drugi przebieg zastaje pola wypełnione, więc nie
 * wpisuje nic, wersja doboru stoi i szkic przestaje być nieświeży.
 *
 * Nie wysyła niczego do klienta. Zasada nadrzędna nr 2 („człowiek wysyła
 * odpowiedź") nie ma tu wyjątku i mieć nie będzie.
 */

/**
 * Autor automatycznego szkicu. `id: null` to decyzja o źródle wyrażona
 * w danych: `przez_user_id` zostaje puste, a ekran pokazuje „automat".
 * Podpisanie takiego szkicu kontem zalogowanego agenta zafałszowałoby
 * jedyny pomiar, jaki mamy — jego ocenę przez człowieka.
 */
export const AUTOMAT: AutorSzkicu = { id: null, name: "automat" };

export interface AutoSzkicDeps {
  database?: DatabaseSync;
  nadaj?: NadawcaSzkicu;
  subiekt?: SubiektAdapter;
  naPrzebieg?: number;
  naGodzine?: number;
  now?: () => Date;
}

export interface WynikAutoSzkicow {
  ulozonych: number;
  /** Rozmowy, przy których wywołanie padło; szkic po prostu nie powstał. */
  bledow: number;
  /** Zdanie dla dziennika, gdy przebieg STANĄŁ. `null` = doszedł do końca. */
  przerwane: string | null;
  /** Ile zostało pod sufitem godzinowym w chwili startu przebiegu. */
  budzet: number;
}

/**
 * Rozmowy czekające na szkic: NAJSTARSZE PIERWSZE.
 *
 * Kolejność nie jest obojętna. Agent pracuje kolejkę od najdłużej czekającego
 * i gdyby takt układał od najnowszych, znajdowałby tam same rozmowy bez
 * propozycji. Przy zaległej skrzynce oznacza to wolniejsze nadrabianie i to
 * jest właściwy kompromis: lepiej, żeby szkice pojawiały się tam, gdzie ktoś
 * zaraz spojrzy.
 *
 * Warunek świeżości to `IFNULL(s.message_id,-1) <> m.id`, czyli „szkic nie
 * odpowiada na tę wiadomość". Obejmuje oba przypadki naraz: brak szkicu
 * i szkic sprzed dopisku klienta.
 *
 * `auto_odpowiedz=0` odsiewa echo naszego potwierdzenia (0.227.0): liczona
 * jako wiadomość klienta kazałaby układać szkic na własną autoodpowiedź.
 */
const CZEKAJACE = `
  SELECT c.id AS rozmowa
    FROM conversation c
    JOIN message m ON m.id = (
      SELECT m2.id FROM message m2
       WHERE m2.conversation_id = c.id AND m2.auto_odpowiedz = 0
       ORDER BY m2.sent_at DESC, m2.id DESC LIMIT 1)
    LEFT JOIN szkic_copilota s ON s.conversation_id = c.id
    LEFT JOIN dobor_rozmowy d ON d.conversation_id = c.id
   WHERE m.direction = 'incoming'
     AND m.related_object_type = 'OFFER'
     AND m.related_object_id IS NOT NULL
     AND (IFNULL(s.message_id, -1) <> m.id
        /* Jeden, nie zero: rozmowa BEZ wiersza doboru ma wersję 1, tak jak
           mówi doborRozmowy(). Zero dawałoby wieczną nieświeżość każdej
           rozmowy, w której nikt nic nie wpisał, czyli większości.
           Bez odwrotnych apostrofów: to wnętrze szablonu SQL. */
        OR IFNULL(s.dobor_wersja, 1) <> IFNULL(d.wersja, 1))
   ORDER BY m.sent_at, m.id
   LIMIT ?`;

/** Ile wywołań szkicu poszło w ostatniej godzinie — z księgi, razem z błędami. */
function zuzyteWGodzinie(database: DatabaseSync): number {
  return Number((database.prepare(
    `SELECT count(*) n FROM copilot_wywolanie
      WHERE zadanie='szkic' AND at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hours')`)
    .get() as { n: number }).n);
}

/**
 * Jeden przebieg taktu. Wołany WYŁĄCZNIE z `main()` — `buildApp()` nie ma
 * prawa strzelać ani do Allegro, ani do dostawcy modelu.
 *
 * Błąd przy JEDNEJ rozmowie nie przerywa przebiegu: szkic po prostu nie
 * powstaje, a powód stoi już w księdze wywołań, którą pisze `ulozSzkic`.
 * Limit i brak klucza PRZERYWAJĄ — dalsze wywołania pogłębiłyby przerwę
 * albo kosztowały bez szansy powodzenia. Ta sama reguła, co przy partii
 * klasyfikacji.
 */
export async function ulozZalegleSzkice(deps: AutoSzkicDeps = {}): Promise<WynikAutoSzkicow> {
  const database = deps.database ?? defaultDb();
  const naPrzebieg = deps.naPrzebieg ?? config.copilot.autoNaPrzebieg;
  const naGodzine = deps.naGodzine ?? config.copilot.autoNaGodzine;
  const now = deps.now ?? (() => new Date());

  const budzet = Math.max(0, naGodzine - zuzyteWGodzinie(database));
  const ile = Math.min(naPrzebieg, budzet);
  if (ile === 0) {
    /* Sufit wyczerpany. Cisza w dzienniku byłaby tu gorsza od wpisu: rachunek
       rośnie, a nikt nie wie, że takt stoi. */
    logEvent("copilot_auto_szkic_sufit", AUTOMAT.name, null,
      { naGodzine, zuzyte: naGodzine - budzet }, null, database);
    return { ulozonych: 0, bledow: 0, przerwane: "sufit godzinowy wyczerpany", budzet };
  }

  const rozmowy = (database.prepare(CZEKAJACE).all(ile) as Array<{ rozmowa: number }>)
    .map((r) => Number(r.rozmowa));
  if (rozmowy.length === 0) return { ulozonych: 0, bledow: 0, przerwane: null, budzet };

  const nadaj = deps.nadaj ?? nadawcaSzkicuAnthropic;
  const subiekt = deps.subiekt ?? domyslnySubiekt;
  let ulozonych = 0; let bledow = 0; let przerwane: string | null = null;

  for (const rozmowa of rozmowy) {
    try {
      await ulozSzkic(rozmowa, AUTOMAT, nadaj, subiekt, now());
      ulozonych++;
    } catch (e) {
      /* Limit, brak klucza i przeciążenie kończą PRZEBIEG. Reszta (szkic
         odrzucony przez sprawdzenie, rozmowa bez wiadomości) dotyczy JEDNEJ
         rozmowy i nie ma powodu zabierać pozostałych. */
      if (e instanceof BladLimituCopilota || e instanceof BladKluczaCopilota
        || e instanceof BladPrzeciazeniaCopilota) {
        przerwane = e instanceof Error ? e.message : String(e);
        break;
      }
      bledow++;
    }
  }

  /* Zdarzenie zbiorcze na przebieg, nie na rozmowę: pojedyncze szkice zapisuje
     już `ulozSzkic`, a tu liczy się, ile takt zrobił i czy stanął. */
  if (ulozonych || bledow || przerwane) {
    logEvent("copilot_auto_szkic", AUTOMAT.name, null,
      { ulozonych, bledow, przerwane, budzet }, null, database);
  }
  return { ulozonych, bledow, przerwane, budzet };
}
