import { db as defaultDb, type Db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Dokument sprzedaży przy zwrocie (0.174.0) ───────────────────────────────
   Ostatnia pozycja z listy biura zwrotów: „widoczny numer paragonu". Pracownik
   szuka go dziś ręcznie w Subiekcie, żeby wystawić korektę — a szuka po dacie
   i nazwisku, bo nic innego nie ma.

   Read-model `sgt_faktura` wskrzeszony w tym wydaniu daje CZYM szukać. Ten
   plik odpowiada na jedno pytanie: który z dokumentów w oknie jest sprzedażą
   z tego zwrotu.

   ZASADA NACZELNA: automat wiąże WYŁĄCZNIE pewność, resztę pokazuje jako
   poszlaki i czeka na człowieka. To ta sama doktryna co przy sygnaturze
   w 0.169.0 i z tego samego powodu — powiązanie prowadzi do KOREKTY, a zła
   korekta idzie do cudzej sprzedaży i cudzych pieniędzy.                    */

/** Ilu kandydatów najwyżej pokazujemy człowiekowi. */
const LIMIT_KANDYDATOW = 8;

/** Ile dni przed zwrotem szukać dokumentu. */
const OKNO_DNI = 60;

/**
 * `dok_NrPelnyOryg` to varchar(30), a identyfikator zamówienia Allegro jest
 * UUID-em o 36 znakach (`format: uuid` w schemacie). Integracja, która wpisuje
 * tam CAŁY numer, zapisze więc dokładnie trzydzieści pierwszych znaków.
 *
 * Ta liczba nie jest zgadywana i dlatego wolno po niej dopasowywać: krótszy
 * prefiks byłby zgadywaniem, bo „1234" pasuje do wszystkiego.
 */
const DLUGOSC_UCIETA = 30;

export interface KandydatFaktury {
  dokId: number;
  numer: string;
  typ: string;
  data: string;
  /** DLACZEGO ten dokument — człowiek wybiera ręcznie, więc ma widzieć powody. */
  powody: string[];
  /** Czy na dokumencie stoi numer zamówienia. TYLKO to wiąże automatycznie. */
  pewny: boolean;
}

export interface FakturaZwrotu {
  dokId: number | null;
  numer: string | null;
  typ: string | null;
  zrodlo: "numer" | "reczne" | null;
  at: string | null;
  przez: string | null;
}

interface WierszZwrotu {
  id: number;
  order_id: string | null;
  reference_number: string | null;
  created_at: string;
}

/**
 * Czy numer obcy z dokumentu wskazuje TEN zwrot.
 *
 * Dwie drogi i obie są dokładne. Albo numer zamówienia mieści się w numerze
 * obcym w całości, albo numer obcy jest jego początkiem UCIĘTYM DO TRZYDZIESTU
 * ZNAKÓW — czyli dokładnie tym, co zostaje z UUID-a w kolumnie varchar(30).
 *
 * Krótszego prefiksu nie uznajemy. „1234" pasowałoby do co drugiego dokumentu
 * w oknie, a fałszywe wiązanie kosztuje korektę do cudzej sprzedaży.
 */
export function numerWskazuje(nrOryg: string | null, szukane: string[]): boolean {
  const obcy = (nrOryg ?? "").trim().toLowerCase();
  if (obcy === "") return false;
  return szukane.some((s) => {
    if (s === "") return false;
    if (obcy.includes(s)) return true;
    return obcy.length === DLUGOSC_UCIETA && s.startsWith(obcy);
  });
}

/**
 * Kandydaci na dokument sprzedaży, z jawnym uzasadnieniem każdego.
 *
 * Sygnał rozstrzygający to numer zamówienia na dokumencie. Nakładka pozycji
 * jest POSZLAKĄ, nie dowodem: firma ogrodnicza sprzedaje ten sam sekator
 * dziesięć razy dziennie, więc „wszystkie zwracane towary są na tym dokumencie"
 * potrafi być prawdą o kilkunastu dokumentach naraz.
 */
export function kandydaciFaktury(zwrotId: number, database: Db = defaultDb()): KandydatFaktury[] {
  const z = database.prepare(
    "SELECT id, order_id, reference_number, created_at FROM zwrot_klienta WHERE id=?")
    .get(zwrotId) as WierszZwrotu | undefined;
  if (!z) return [];

  const koniec = String(z.created_at).slice(0, 10);
  const poczatek = new Date(Date.parse(koniec) - OKNO_DNI * 86_400_000)
    .toISOString().slice(0, 10);

  const dokumenty = database.prepare(
    `SELECT dok_id, typ, nr_pelny, nr_oryg, data_wyst FROM sgt_faktura
     WHERE data_wyst >= ? AND data_wyst <= ?`)
    .all(poczatek, koniec) as Array<{
      dok_id: number; typ: string; nr_pelny: string;
      nr_oryg: string | null; data_wyst: string;
    }>;
  if (dokumenty.length === 0) return [];

  /* Pozycje zwrotu liczą się PO KARTOTECE — sam identyfikator oferty Allegro
     nie ma jak trafić na dokument Subiekta. Zwrot bez potwierdzonej kartoteki
     nie ma więc czym dopasować po towarach i zostaje przy numerze. */
  const pozycjeZwrotu = database.prepare(
    `SELECT tw_id, SUM(ilosc) AS ilosc FROM zwrot_klienta_pozycja
     WHERE zwrot_id=? AND tw_id IS NOT NULL GROUP BY tw_id`)
    .all(zwrotId) as Array<{ tw_id: number; ilosc: number }>;

  /* Pozycje wszystkich kandydatów JEDNYM zapytaniem. Okno to dziesiątki
     tysięcy dokumentów, a SELECT per dokument byłby setkami zapytań na jedno
     otwarcie zwrotu. */
  const pozycjeDokow = new Map<number, Map<number, number>>();
  if (pozycjeZwrotu.length) {
    const wiersze = database.prepare(
      `SELECT dok_id, tw_id, SUM(ilosc) AS ilosc FROM sgt_faktura_pozycja
       WHERE dok_id IN (SELECT dok_id FROM sgt_faktura WHERE data_wyst >= ? AND data_wyst <= ?)
       GROUP BY dok_id, tw_id`).all(poczatek, koniec) as
      Array<{ dok_id: number; tw_id: number; ilosc: number }>;
    for (const w of wiersze) {
      let m = pozycjeDokow.get(Number(w.dok_id));
      if (!m) pozycjeDokow.set(Number(w.dok_id), (m = new Map()));
      m.set(Number(w.tw_id), Number(w.ilosc));
    }
  }

  const szukane = [z.order_id, z.reference_number]
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .map((s) => s.trim().toLowerCase());

  const kandydaci: KandydatFaktury[] = [];
  for (const dok of dokumenty) {
    const powody: string[] = [];
    const pewny = numerWskazuje(dok.nr_oryg, szukane);
    if (pewny) powody.push("numer zamówienia stoi na dokumencie");

    let komplet = false;
    if (pozycjeZwrotu.length) {
      const naDoku = pozycjeDokow.get(Number(dok.dok_id));
      komplet = !!naDoku && pozycjeZwrotu.every(
        (p) => (naDoku.get(Number(p.tw_id)) ?? 0) >= Number(p.ilosc));
      if (komplet) powody.push("wszystkie zwracane towary są na tym dokumencie");
    }

    if (powody.length === 0) continue;
    kandydaci.push({
      dokId: Number(dok.dok_id), numer: String(dok.nr_pelny),
      typ: String(dok.typ), data: String(dok.data_wyst), powody, pewny,
    });
  }

  /* Pewne najpierw, potem najświeższe. Data jest wyłącznie porządkiem listy —
     nie dolicza punktów, bo bliskość daty przy sprzedaży codziennej nie mówi
     nic poza tym, że firma pracowała. */
  kandydaci.sort((a, b) =>
    Number(b.pewny) - Number(a.pewny) || b.data.localeCompare(a.data));
  return kandydaci.slice(0, LIMIT_KANDYDATOW);
}

/** Dokument przypięty do zwrotu — snapshot, bo read-model czyści się importem. */
export function fakturaZwrotu(zwrotId: number, database: Db = defaultDb()): FakturaZwrotu {
  const w = database.prepare(
    `SELECT faktura_dok_id, faktura_numer, faktura_typ, faktura_zrodlo,
            faktura_at, faktura_przez FROM zwrot_klienta WHERE id=?`)
    .get(zwrotId) as Record<string, unknown> | undefined;
  return {
    dokId: w?.faktura_dok_id == null ? null : Number(w.faktura_dok_id),
    numer: (w?.faktura_numer as string) ?? null,
    typ: (w?.faktura_typ as string) ?? null,
    zrodlo: (w?.faktura_zrodlo as "numer" | "reczne") ?? null,
    at: (w?.faktura_at as string) ?? null,
    przez: (w?.faktura_przez as string) ?? null,
  };
}

/**
 * Wiązanie AUTOMATYCZNE: dokładnie jeden kandydat z numerem zamówienia.
 *
 * Dwóch pewnych naraz to spór, nie trafienie — a nakładka pozycji sama z siebie
 * nie wiąże nigdy. Wywoływane z taktu synchronizacji i z ręcznego dociągnięcia
 * zamówień, NIGDY z otwarcia ekranu: „zero zapisu przy patrzeniu" obowiązuje
 * też tutaj.
 *
 * Wskazania człowieka nie nadpisuje. Podszyłoby się pod cudzą decyzję — ta sama
 * zasada co przy pamięci wskazań oferta–kartoteka.
 */
export function zwiazFakture(zwrotId: number, database: Db = defaultDb(), teraz = new Date()): boolean {
  const stan = fakturaZwrotu(zwrotId, database);
  if (stan.dokId !== null) return false;

  const pewni = kandydaciFaktury(zwrotId, database).filter((k) => k.pewny);
  if (pewni.length !== 1) return false;
  const k = pewni[0];

  database.prepare(
    `UPDATE zwrot_klienta SET faktura_dok_id=?, faktura_numer=?, faktura_typ=?,
       faktura_zrodlo='numer', faktura_at=?, faktura_przez=? WHERE id=?`)
    .run(k.dokId, k.numer, k.typ, teraz.toISOString(), "automat (numer zamówienia)", zwrotId);
  logEvent("zwrot_faktura", "automat (numer zamówienia)", null,
    { zwrotId, dokId: k.dokId, numer: k.numer, zrodlo: "numer" }, null, database);
  return true;
}

/**
 * Wskazanie CZŁOWIEKA albo jego cofnięcie (`dokId === null`).
 *
 * Źródło zostaje `reczne` i widać je na ekranie. Projekt panelu §4.3 nie
 * pozwala, żeby wybór człowieka udawał fakt z danych — a przy dokumencie,
 * z którego powstanie korekta, ta różnica jest całą treścią.
 */
export function wskazFakture(
  database: Db, zwrotId: number, dokId: number | null,
  kto: { id: number; name: string }, teraz = new Date(),
): FakturaZwrotu {
  return transaction(database, () => {
    const z = database.prepare("SELECT id, zamkniety_at FROM zwrot_klienta WHERE id=?")
      .get(zwrotId) as { id: number; zamkniety_at: string | null } | undefined;
    if (!z) throw new Error("Nie znaleziono zwrotu");
    if (z.zamkniety_at) throw new Error("Zwrot jest zamknięty");

    if (dokId === null) {
      database.prepare(
        `UPDATE zwrot_klienta SET faktura_dok_id=NULL, faktura_numer=NULL,
           faktura_typ=NULL, faktura_zrodlo=NULL, faktura_at=NULL,
           faktura_przez=NULL WHERE id=?`).run(zwrotId);
      logEvent("zwrot_faktura_cofnieta", kto.name, null, { zwrotId }, kto.id, database);
      return fakturaZwrotu(zwrotId, database);
    }

    const dok = database.prepare("SELECT dok_id, typ, nr_pelny FROM sgt_faktura WHERE dok_id=?")
      .get(dokId) as { dok_id: number; typ: string; nr_pelny: string } | undefined;
    /* Dokument musi stać w read-modelu. Numer wpisany z palca byłby napisem,
       którego nikt nie odnajdzie w Subiekcie — a to jest cała jego rola. */
    if (!dok) throw new Error("Nie znam takiego dokumentu sprzedaży");

    database.prepare(
      `UPDATE zwrot_klienta SET faktura_dok_id=?, faktura_numer=?, faktura_typ=?,
         faktura_zrodlo='reczne', faktura_at=?, faktura_przez=? WHERE id=?`)
      .run(dok.dok_id, dok.nr_pelny, dok.typ, teraz.toISOString(), kto.name, zwrotId);
    logEvent("zwrot_faktura", kto.name, null,
      { zwrotId, dokId: dok.dok_id, numer: dok.nr_pelny, zrodlo: "reczne" },
      kto.id, database);
    return fakturaZwrotu(zwrotId, database);
  })();
}

/**
 * Wiąże wszystkie zwroty, którym numer zamówienia wskazuje jeden dokument.
 *
 * Idempotentne: rusza wyłącznie zwroty bez dokumentu, więc drugi przebieg nie
 * ma czego zmienić. Idzie taktem, nigdy z otwarcia ekranu — „zero zapisu przy
 * patrzeniu". Oddaje liczbę powiązanych, żeby dziennik taktu mówił, ile pracy
 * zdjął.
 *
 * Zwrot idzie WŁASNĄ transakcją: jeden wywrócony nie ma prawa zabrać
 * pozostałych (ta sama lekcja co przy wątkach skrzynki w 0.149.2).
 */
export function zwiazFakturyPewne(database: Db = defaultDb(), teraz = new Date()): number {
  const zwroty = database.prepare(
    `SELECT id FROM zwrot_klienta
     WHERE faktura_dok_id IS NULL AND zamkniety_at IS NULL`)
    .all() as Array<{ id: number }>;

  let powiazane = 0;
  for (const z of zwroty) {
    try {
      if (transaction(database, () => zwiazFakture(Number(z.id), database, teraz))()) {
        powiazane++;
      }
    } catch (e) {
      console.warn("[faktury] zwrot pominięty:", z.id, e instanceof Error ? e.message : e);
    }
  }
  return powiazane;
}
