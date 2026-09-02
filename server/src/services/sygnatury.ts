import { transaction, type Db } from "../db/db.js";
import { zaproponujKartoteke } from "./dopasowanie-sku.js";
import { potwierdzKartoteke } from "./zwroty.js";

/* ── Pokrycie sygnatur (0.169.0) ─────────────────────────────────────────────
   Wiązanie oferty Allegro z kartoteką Subiekta po sygnaturze działa od 0.152.0:
   `offer.external.id` ląduje w `zamowienie_klienta_pozycja.sku`, a
   `kartotekaPoSku` szuka po nim symbolu. Czego do 0.168.0 NIE DAŁO SIĘ
   ZOBACZYĆ, to czy to wiązanie w ogóle trafia.

   Wynik był widoczny wyłącznie przy pojedynczej pozycji zwrotu i tylko wtedy,
   gdy kartoteki jeszcze nie było. Właściciel wypełniający sygnatury w Allegro
   nie miał jak sprawdzić, czy praca się opłaca — a odpowiedź jest w bazie,
   po jednym zapytaniu.

   WYŁĄCZNIE ODCZYT. Ani jednego INSERT-a; „zero zapisu przy patrzeniu"
   obowiązuje też diagnostykę.

   RAPORT MA LICZYĆ TO SAMO, CO ROBI MECHANIZM. Gdyby liczył inaczej —
   choćby dopuszczał symbol zdublowany jako trafienie — mówiłby o pokryciu,
   którego nie ma, a to gorsze niż brak raportu. Pilnuje tego test
   porównujący wynik wiersz po wierszu z `kartotekaPoSku`.                   */

/** Sygnatura, która nie prowadzi do jednej kartoteki — z powodem w liczbie. */
export interface WierszSygnatury {
  sygnatura: string;
  /** Nazwa oferty z Allegro; bierzemy jedną, bo służy tylko rozpoznaniu. */
  nazwa: string;
  /** Ile pozycji zamówień niesie tę sygnaturę. */
  pozycji: number;
  /** Ile kartotek Subiekta ma taki symbol: 0 = pudło, >1 = zdublowany. */
  kartotek: number;
}

export interface PokrycieSygnatur {
  /** Wszystkie pozycje pobranych zamówień. */
  pozycji: number;
  /** Pozycje, przy których sprzedawca nie wypełnił sygnatury. */
  bezSygnatury: number;
  /** Pozycje, których sygnatura prowadzi do DOKŁADNIE jednej kartoteki. */
  trafia: number;
  /** Ile różnych sygnatur widzieliśmy — mianownik pracy przy ofertach. */
  sygnatur: number;
  pudla: WierszSygnatury[];
  zdublowane: WierszSygnatury[];
}

/** Ile pozycji list pokazujemy. Raport ma kierować do roboty, nie być eksportem. */
export const LIMIT_LISTY = 20;

/**
 * Pokrycie sygnatur na wszystkich pobranych zamówieniach.
 *
 * Bez filtra po koncie kanału: panel obsługuje jedno konto sprzedawcy, a filtr
 * bez ekranu do wyboru konta byłby ustawieniem, którego nikt nie ustawi.
 *
 * Grupujemy PRZED sprawdzeniem kartoteki. Zapytanie o każdą pozycję z osobna
 * porównywałoby trzy i pół tysiąca symboli tyle razy, ile jest pozycji;
 * po grupowaniu — tyle razy, ile jest różnych sygnatur.
 */
export function pokrycieSygnatur(database: Db, limit = LIMIT_LISTY): PokrycieSygnatur {
  const ogolem = database.prepare(`SELECT COUNT(*) AS pozycji,
    SUM(CASE WHEN TRIM(COALESCE(sku,'')) = '' THEN 1 ELSE 0 END) AS bez
    FROM zamowienie_klienta_pozycja`).get() as { pozycji: number; bez: number | null };

  /* TRIM po OBU stronach i NOCASE — dokładnie jak `kartotekaPoSku`. Import
     Subiekta nie trimuje `tw_Symbol` (`mag_Symbol` tuż obok trimuje), więc
     symbol z białym znakiem na końcu inaczej nie trafiałby nigdy. */
  const wiersze = database.prepare(`
    WITH sygn AS (
      SELECT TRIM(sku) AS sygnatura, COUNT(*) AS pozycji, MIN(nazwa) AS nazwa
      FROM zamowienie_klienta_pozycja
      WHERE TRIM(COALESCE(sku,'')) <> ''
      GROUP BY TRIM(sku) COLLATE NOCASE
    )
    SELECT s.sygnatura, s.nazwa, s.pozycji,
      (SELECT COUNT(*) FROM sgt_towar t
        WHERE TRIM(t.symbol) = s.sygnatura COLLATE NOCASE) AS kartotek
    FROM sygn s ORDER BY s.pozycji DESC, s.sygnatura`)
    .all() as unknown as WierszSygnatury[];

  const trafia = wiersze
    .filter((w) => Number(w.kartotek) === 1)
    .reduce((suma, w) => suma + Number(w.pozycji), 0);

  return {
    pozycji: Number(ogolem.pozycji ?? 0),
    bezSygnatury: Number(ogolem.bez ?? 0),
    trafia,
    sygnatur: wiersze.length,
    /* Zdublowany symbol NIE JEST trafieniem i to nie jest szczegół:
       `kartotekaPoSku` odmawia wtedy wyboru, bo symbol miał być unikalny.
       Wrzucenie go do trafień obiecywałoby wiązanie, którego nie ma. */
    pudla: wiersze.filter((w) => Number(w.kartotek) === 0).slice(0, limit),
    zdublowane: wiersze.filter((w) => Number(w.kartotek) > 1).slice(0, limit),
  };
}

/* ── Wiązanie bez klikania (0.169.0) ────────────────────────────────────────
   Decyzja właściciela: „zrób, abym nie musiał zatwierdzać kartotek".

   Do 0.168.0 automat liczył propozycję, a wiązał człowiek — jedno kliknięcie
   na każdą pozycję zwrotu, także wtedy, gdy sygnatura wskazywała dokładnie
   jedną kartotekę i nie było czego rozstrzygać. Teraz taki przypadek wiąże
   się sam, ze źródłem `sku` w `tw_zrodlo`, więc dalej widać, że to automat.

   WIĄŻE SIĘ WYŁĄCZNIE PEWNOŚĆ `sku`. Pozostałe stopnie zostają propozycją
   i to nie jest ostrożność na zapas:

     - `jedyna_pozycja` i `nazwa_w_zamowieniu` są ZGADYWANIEM. Powiązanie
       prowadzi do korekty stanu w Subiekcie, więc pomyłka wraca towarem na
       złej półce, nie czerwonym napisem na ekranie.
     - `pamiec` niesie decyzję człowieka podjętą na INNYM zwrocie i wiązałaby
       się sama chętnie, ale uczciwej wartości dla `tw_zrodlo` nie ma:
       `reczne` twierdziłoby, że ktoś kliknął TĘ pozycję, a `sku` — że trafiła
       sygnatura. Trzecia wartość to migracja i zmiana w panelu, czyli osobna
       decyzja, nie skutek uboczny tej.
     - symbol zdublowany nie wiąże się nigdy, bo `kartotekaPoSku` odmawia
       wyboru; raport pokrycia wypisuje takie sygnatury osobno.

   Człowiek zachowuje ostatnie słowo: `POST .../kartoteka` z `twId: null`
   zdejmuje powiązanie razem z pamięcią, a wskazanie ręczne je nadpisuje.

   NIE WOŁA SIĘ TEGO Z ODCZYTU. „Zero zapisu przy patrzeniu" obowiązuje tu
   tak samo jak w magazynie — wiązanie idzie z taktu synchronizacji i z jawnej
   akcji „dociągnij zamówienia", nie z otwarcia ekranu.                      */

/** Kto podpisuje wiązanie w audycie. Nie imię człowieka — to nie on kliknął. */
export const AUTOMAT = "automat (sygnatura)";

/**
 * Wiąże wszystkie pozycje zwrotów, którym sygnatura wskazuje jedną kartotekę.
 *
 * Idempotentne: rusza wyłącznie pozycje bez `tw_id`, więc drugi przebieg nie
 * ma czego zmienić. Oddaje liczbę powiązanych — dziennik taktu ma powiedzieć,
 * ile pracy zdjął, a zero nie jest wtedy warte linii.
 */
export function zwiazPewne(database: Db, teraz = new Date()): number {
  const pozycje = database.prepare(`SELECT p.id, p.offer_id, p.nazwa,
      z.channel_account_id, z.order_id
    FROM zwrot_klienta_pozycja p
    JOIN zwrot_klienta z ON z.id = p.zwrot_id
    WHERE p.tw_id IS NULL`).all() as unknown as Array<{
      id: number; offer_id: string | null; nazwa: string;
      channel_account_id: number; order_id: string | null;
    }>;

  let powiazane = 0;
  for (const p of pozycje) {
    const d = zaproponujKartoteke(database, {
      channelAccountId: Number(p.channel_account_id),
      orderId: p.order_id, offerId: p.offer_id, nazwa: String(p.nazwa),
    });
    if (d.pewnosc !== "sku" || d.twId === null) continue;
    /* Pozycja idzie WŁASNĄ transakcją: jedna wywrócona (skasowany w tym czasie
       zwrot, znikły towar) nie ma prawa zabrać pozostałych — ta sama lekcja
       co przy wątkach skrzynki w 0.149.2. */
    try {
      transaction(database, () => potwierdzKartoteke(
        database, Number(p.id), d.twId, "sku",
        { id: null, name: AUTOMAT }, teraz, false,
      ))();
      powiazane++;
    } catch (e) {
      console.warn("[sygnatury] pozycja pominięta:", p.id,
        e instanceof Error ? e.message : e);
    }
  }
  return powiazane;
}
