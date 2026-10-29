import sql from "mssql";
import { db } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
import { brakKolumnyKorekty } from "./subiekt.mssql.js";
import { DNI_SPRZEDAZY, PORZADEK, wzorzecLike, zrodloSprzedazy, type SortBezZdjecia } from "./zdjecia.sgt.js";

/* ── Waga i wymiary kartoteki ────────────────────────────────────────────────
   Biuro mierzy towary, którym Subiekt nie zna wagi albo wymiarów, i wpisuje
   pomiar z panelu. Lista braków pyta Subiekt wprost, z tego samego powodu co
   lista bez zdjęcia: nasz read-model kartoteki tych kolumn nie niesie.

   Waga brutto siedzi w `tw_Masa`, netto w `tw_MasaNetto` (kg, money) — pola
   „Masa brutto/netto towaru w kg" z zakładki Miary. Wymiary siedzą w polach własnych
   `tw_PoleN` (varchar(50)), wskazanych kluczami `WYMIARY_POLE_*`. Pole własne
   to TEKST, więc piszemy go tak, jak wpisałby człowiek w Subiekcie: „12,5". */

/** Klucze pól wymiarów w kolejności, w jakiej mierzy się paczkę. */
export const WYMIARY = ["dlugosc", "szerokosc", "wysokosc"] as const;
export type Wymiar = (typeof WYMIARY)[number];

/**
 * Pomiar do zapisania. `null` = pole zostaje w Subiekcie bez zmian.
 *
 * Wymiary jadą LICZBĄ (cm), nie gotowym tekstem. Tekst do pola własnego
 * składa dopiero adapter, więc format „12,5" stoi w jednym miejscu
 * i nie rozjedzie się między kolejką, audytem i demo.
 */
export interface Pomiar {
  /** Waga z opakowaniem — `tw_Masa`. */
  bruttoKg: number | null;
  /** Waga samego towaru — `tw_MasaNetto`. */
  nettoKg: number | null;
  dlugosc: number | null;
  szerokosc: number | null;
  wysokosc: number | null;
}

export interface TowarBezWymiarow {
  twId: number;
  symbol: string;
  nazwa: string;
  ean: string | null;
  stan: number;
  sprzedaz: number;
  /** Wagi z kartoteki w kg; `null`, gdy pusta albo zero. */
  brutto: number | null;
  netto: number | null;
  /** Surowa treść pól własnych; `null`, gdy puste. Panel podpowiada z nich to, co już jest. */
  dlugosc: string | null;
  szerokosc: string | null;
  wysokosc: string | null;
}

/**
 * Tekst wymiaru do pola własnego: centymetry z przecinkiem, jedno miejsce
 * po nim, bez „,0" przy pełnych. Milimetr to dokładność miarki, a więcej
 * cyfr w polu udawałoby pomiar, którego nikt nie zrobił.
 */
export function tekstWymiaru(cm: number): string {
  return (Math.round(cm * 10) / 10).toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

/** Pola własne wymiarów z konfiguracji, po sprawdzeniu nazw. */
export function polaWymiarow(): Record<Wymiar, string> {
  const w = config.wymiary;
  return {
    dlugosc: assertSafeColumn(w.poleDlugosc),
    szerokosc: assertSafeColumn(w.poleSzerokosc),
    wysokosc: assertSafeColumn(w.poleWysokosc),
  };
}

/**
 * UPDATE pomiaru — tylko kolumny, które człowiek zmierzył.
 *
 * Pole pominięte w pomiarze zostaje nietknięte, a nie wyczyszczone. Towar
 * z wagą wpisaną przez dostawcę dostaje same wymiary i nie traci wagi.
 * Zwraca `null`, gdy nie ma czego zapisać.
 */
export function budujZapytanieZapisu(p: Pomiar, pola: Record<Wymiar, string>): string | null {
  const ustaw: string[] = [];
  if (p.bruttoKg !== null) ustaw.push("tw_Masa = @brutto");
  if (p.nettoKg !== null) ustaw.push("tw_MasaNetto = @netto");
  for (const w of WYMIARY) {
    if (p[w] !== null) ustaw.push(`${assertSafeColumn(pola[w])} = @${w}`);
  }
  if (ustaw.length === 0) return null;
  return `UPDATE tw__Towar SET ${ustaw.join(", ")} WHERE tw_Id = @id`;
}

/* Puste pole własne to NULL albo same spacje; waga zero to brak wagi. */
const pustyTekst = (k: string) => `LTRIM(RTRIM(ISNULL(t.${k}, ''))) = ''`;

/**
 * Strona i licznik kartotek, którym brakuje którejś wagi albo wymiaru.
 *
 * Ten sam kształt co lista bez zdjęcia: tylko niezablokowane, stan i sprzedaż
 * sumowane w podzapytaniach, porządek domknięty `tw_Id`.
 */
export function budujZapytanieBezWymiarow(opts: {
  pola: Record<Wymiar, string>;
  zFiltrem: boolean;
  sortuj?: SortBezZdjecia;
  naStanie?: boolean;
  sprzedane?: boolean;
  sprzedaz?: { fs: number; pa: number; odnosnik?: string };
}): { strona: string; razem: string } {
  const pola = WYMIARY.map((w) => assertSafeColumn(opts.pola[w]));
  const zrodlo = zrodloSprzedazy(opts.sprzedaz ?? { fs: 2, pa: 21 });
  const brak = ["ISNULL(t.tw_Masa, 0) <= 0", "ISNULL(t.tw_MasaNetto, 0) <= 0", ...pola.map(pustyTekst)]
    .join(" OR ");
  const warunki = ["t.tw_Zablokowany = 0", `(${brak})`];
  if (opts.zFiltrem) {
    warunki.push(
      "(t.tw_Symbol LIKE @q ESCAPE '!' OR t.tw_Nazwa LIKE @q ESCAPE '!' OR t.tw_PodstKodKresk LIKE @q ESCAPE '!')"
    );
  }
  if (opts.naStanie) {
    warunki.push("EXISTS (SELECT 1 FROM tw_Stan st WITH (NOLOCK) WHERE st.st_TowId = t.tw_Id AND st.st_Stan > 0)");
  }
  if (opts.sprzedane) {
    warunki.push(`EXISTS (SELECT 1 ${zrodlo} AND p.ob_TowId = t.tw_Id AND p.ob_IloscMag > 0)`);
  }
  const gdzie = `WHERE ${warunki.join(" AND ")}`;
  const stan =
    "LEFT JOIN (SELECT st_TowId, SUM(st_Stan) AS stan FROM tw_Stan WITH (NOLOCK) GROUP BY st_TowId) s " +
    "ON s.st_TowId = t.tw_Id";
  const sprzedaz =
    `LEFT JOIN (SELECT p.ob_TowId, SUM(p.ob_IloscMag) AS sprzedaz ${zrodlo} GROUP BY p.ob_TowId) sp ` +
    "ON sp.ob_TowId = t.tw_Id";
  const porzadek = PORZADEK[opts.sortuj ?? "sprzedaz"] ?? PORZADEK.sprzedaz;
  const [d, s, w] = pola;
  return {
    strona:
      "SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, " +
      "t.tw_PodstKodKresk AS ean, ISNULL(s.stan, 0) AS stan, ISNULL(sp.sprzedaz, 0) AS sprzedaz, " +
      `t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, t.${d} AS dlugosc, t.${s} AS szerokosc, t.${w} AS wysokosc ` +
      `FROM tw__Towar t WITH (NOLOCK) ${stan} ${sprzedaz} ${gdzie} ` +
      `ORDER BY ${porzadek} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    razem: `SELECT COUNT(*) AS razem FROM tw__Towar t WITH (NOLOCK) ${gdzie}`,
  };
}

export interface ZapytanieListy {
  q: string;
  limit: number;
  offset: number;
  sortuj: SortBezZdjecia;
  naStanie: boolean;
  sprzedane: boolean;
}

type WierszListy = {
  twId: number; symbol: string; nazwa: string; ean: string | null;
  stan: number | string | null; sprzedaz: number | string | null;
  brutto: number | string | null; netto: number | string | null;
  dlugosc: string | null; szerokosc: string | null; wysokosc: string | null;
};

const tekstLubNull = (v: string | null) => (v && v.trim() ? v.trim() : null);

function naPozycje(w: WierszListy): TowarBezWymiarow {
  /* Money przychodzi ze sterownika liczbą albo tekstem — stąd Number(). Zero to brak. */
  const waga = (v: number | string | null) => { const n = Number(v ?? 0) || 0; return n > 0 ? n : null; };
  return {
    twId: w.twId,
    symbol: w.symbol,
    nazwa: w.nazwa,
    ean: tekstLubNull(w.ean),
    stan: Number(w.stan ?? 0) || 0,
    sprzedaz: Number(w.sprzedaz ?? 0) || 0,
    brutto: waga(w.brutto),
    netto: waga(w.netto),
    dlugosc: tekstLubNull(w.dlugosc),
    szerokosc: tekstLubNull(w.szerokosc),
    wysokosc: tekstLubNull(w.wysokosc),
  };
}

/** Strona kartotek bez wagi albo wymiarów prosto z Subiekta; wyjątek = nie dało się zapytać. */
export async function towaryBezWymiarow(z: ZapytanieListy): Promise<{ razem: number; pozycje: TowarBezWymiarow[] }> {
  const m = config.mssql;
  /* Odnośnik faktury do paragonu tylko wtedy, gdy import go znalazł —
     kolumna, której nie ma, wywróciłaby listę błędem 207. */
  const odnosnik = m.korektaColumn && !brakKolumnyKorekty ? m.korektaColumn : undefined;
  const zapytania = budujZapytanieBezWymiarow({
    pola: polaWymiarow(),
    zFiltrem: z.q !== "",
    sortuj: z.sortuj,
    naStanie: z.naStanie,
    sprzedane: z.sprzedane,
    sprzedaz: { fs: m.dokTypFS, pa: m.dokTypPA, odnosnik },
  });
  const od = new Date(Date.now() - DNI_SPRZEDAZY * 86400_000).toISOString().slice(0, 10);
  const pool = await mssqlPool();
  const zapytanie = () => {
    const r = pool.request().input("odSprzedazy", sql.VarChar(10), od);
    if (z.q !== "") r.input("q", sql.NVarChar(200), wzorzecLike(z.q));
    return r;
  };
  const strona = await zapytanie()
    .input("offset", sql.Int, z.offset)
    .input("limit", sql.Int, z.limit)
    .query<WierszListy>(zapytania.strona);
  const razem = await zapytanie().query<{ razem: number }>(zapytania.razem);
  return {
    razem: Number(razem.recordset[0]?.razem ?? 0),
    pozycje: strona.recordset.map(naPozycje),
  };
}

/** Towar z obecną wagą i wymiarami — przed zapisem, do audytu. */
export type StanKartoteki = Pick<TowarBezWymiarow, "twId" | "symbol" | "brutto" | "netto" | "dlugosc" | "szerokosc" | "wysokosc">;

/**
 * Obecna waga i wymiary jednej kartoteki z Subiekta; `null` = nie ma takiego
 * towaru. Czytamy je w chwili zapisu, a nie z ciała żądania: audyt „co stało
 * przed" ma mówić o bazie firmy, nie o tym, co pamiętała przeglądarka.
 */
export async function stanKartoteki(twId: number): Promise<StanKartoteki | null> {
  const [d, s, w] = WYMIARY.map((k) => polaWymiarow()[k]);
  const pool = await mssqlPool();
  const r = await pool
    .request()
    .input("id", sql.Int, twId)
    .query<WierszListy>(
      "SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, t.tw_PodstKodKresk AS ean, " +
        `0 AS stan, 0 AS sprzedaz, t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, t.${d} AS dlugosc, t.${s} AS szerokosc, t.${w} AS wysokosc ` +
        "FROM tw__Towar t WITH (NOLOCK) WHERE t.tw_Id = @id"
    );
  const wiersz = r.recordset[0];
  return wiersz ? naPozycje(wiersz) : null;
}

/* ── Demo (SGT_MODE=seeded) ──────────────────────────────────────────────────
   Bez bazy Subiekta waga i wymiary żyją w kolumnach `sgt_towar`, które
   wypełnia wyłącznie `DevSferaAdapter`. Dzięki temu ekran i kolejkę da się
   przejść od listy do zapisu bez Subiekta. Sprzedaży demo nie zna, więc
   porządek „sprzedaż" schodzi do stanu. */

const PORZADEK_DEMO: Record<SortBezZdjecia, string> = {
  sprzedaz: "stan DESC, t.symbol, t.tw_id",
  stan: "stan DESC, t.symbol, t.tw_id",
  symbol: "t.symbol, t.tw_id",
  nazwa: "t.nazwa, t.tw_id",
  najnowsze: "t.tw_id DESC",
};

export async function towaryBezWymiarowDemo(z: ZapytanieListy): Promise<{ razem: number; pozycje: TowarBezWymiarow[] }> {
  const warunki = [
    "(IFNULL(t.masa, 0) <= 0 OR IFNULL(t.masa_netto, 0) <= 0 OR TRIM(IFNULL(t.wym_dlugosc, '')) = '' " +
      "OR TRIM(IFNULL(t.wym_szerokosc, '')) = '' OR TRIM(IFNULL(t.wym_wysokosc, '')) = '')",
  ];
  const parametry: Array<string | number> = [];
  if (z.q !== "") {
    warunki.push("(t.symbol LIKE ? ESCAPE '!' OR t.nazwa LIKE ? ESCAPE '!' OR IFNULL(t.ean, '') LIKE ? ESCAPE '!')");
    const wz = wzorzecLike(z.q);
    parametry.push(wz, wz, wz);
  }
  if (z.naStanie) {
    warunki.push("EXISTS (SELECT 1 FROM sgt_stan st WHERE st.tw_id = t.tw_id AND st.stan > 0)");
  }
  /* Demo nie ma sprzedaży — filtr „sprzedane" zostawia pustą listę, jak zrobiłby to Subiekt bez dokumentów. */
  if (z.sprzedane) warunki.push("0");
  const gdzie = `WHERE ${warunki.join(" AND ")}`;
  const d = db();
  const razem = d.prepare(`SELECT COUNT(*) AS razem FROM sgt_towar t ${gdzie}`).get(...parametry) as { razem: number };
  const wiersze = d
    .prepare(
      `SELECT t.tw_id AS twId, t.symbol, t.nazwa, t.ean,
              (SELECT IFNULL(SUM(stan), 0) FROM sgt_stan st WHERE st.tw_id = t.tw_id) AS stan,
              0 AS sprzedaz, t.masa AS brutto, t.masa_netto AS netto, t.wym_dlugosc AS dlugosc, t.wym_szerokosc AS szerokosc,
              t.wym_wysokosc AS wysokosc
       FROM sgt_towar t ${gdzie}
       ORDER BY ${PORZADEK_DEMO[z.sortuj] ?? PORZADEK_DEMO.sprzedaz} LIMIT ? OFFSET ?`
    )
    .all(...parametry, z.limit, z.offset) as WierszListy[];
  return { razem: Number(razem.razem), pozycje: wiersze.map(naPozycje) };
}

export async function stanKartotekiDemo(twId: number): Promise<StanKartoteki | null> {
  const wiersz = db()
    .prepare(
      `SELECT tw_id AS twId, symbol, nazwa, ean, 0 AS stan, 0 AS sprzedaz, masa AS brutto, masa_netto AS netto,
              wym_dlugosc AS dlugosc, wym_szerokosc AS szerokosc, wym_wysokosc AS wysokosc
       FROM sgt_towar WHERE tw_id = ?`
    )
    .get(twId) as WierszListy | undefined;
  return wiersz ? naPozycje(wiersz) : null;
}
