import sql from "mssql";
import { db } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
import { brakKolumnyKorekty } from "./subiekt.mssql.js";
import {
  DNI_SPRZEDAZY, PORZADEK, SORTOWANIA_BEZ_ZDJECIA, wzorzecLike, zrodloSprzedazy,
} from "./zdjecia.sgt.js";

/* ── Waga i wymiary kartoteki ────────────────────────────────────────────────
   Biuro mierzy towary, którym Subiekt nie zna wagi albo wymiarów, i wpisuje
   pomiar z panelu. Lista braków pyta Subiekt wprost, z tego samego powodu co
   lista bez zdjęcia: nasz read-model kartoteki tych kolumn nie niesie.

   Waga brutto siedzi w `tw_Masa`, netto w `tw_MasaNetto` (kg, money) — pola
   „Masa brutto/netto towaru w kg" z zakładki Miary.

   Wymiary siedzą gdzie indziej: w polach własnych zakładki „Własne", czyli
   w `pw_Dane`, w wierszu `pwd_TypObiektu = -14` (towar) i `pwd_IdObiektu =
   tw_Id`. Kolumny `pwd_TekstNN` wskazują klucze `WYMIARY_POLE_*`, bo który
   tekst jest którym wymiarem, mówi definicja w `pw_Pole` danej firmy. Pole
   to TEKST, więc piszemy go tak, jak wpisałby człowiek w Subiekcie: „12,5".
   Sprawdzone na bazie firmy: Wysokość = Tekst01, Szerokość = Tekst02,
   Długość = Tekst03, wartości „5", „21,5", „22". */

/** `pwd_TypObiektu` kartoteki towarowej w polach własnych — z `pw_Pole` bazy firmy. */
export const TYP_TOWARU_PW = -14;

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

/**
 * Porządki listy wymiarów: te z listy bez zdjęcia i „lokalizacja".
 *
 * Lokalizacja jest dla kolektora. Magazynier mierzy przy regale, więc lista
 * w kolejności adresów to obchód hali, a nie skakanie między alejkami.
 */
export const SORTOWANIA_WYMIAROW = [...SORTOWANIA_BEZ_ZDJECIA, "lokalizacja"] as const;
export type SortWymiarow = (typeof SORTOWANIA_WYMIAROW)[number];

export interface TowarBezWymiarow {
  twId: number;
  symbol: string;
  nazwa: string;
  ean: string | null;
  stan: number;
  sprzedaz: number;
  /** Surowa zawartość pola lokalizacji (adresy rozdzielone spacją); `null`, gdy pusta. */
  lokalizacja: string | null;
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
 * UPDATE wag kartoteki — tylko te, które człowiek zważył; `null`, gdy żadnej.
 *
 * Pole pominięte w pomiarze zostaje nietknięte, a nie wyczyszczone. Towar
 * z wagą wpisaną przez dostawcę dostaje same wymiary i nie traci wagi.
 */
export function budujZapytanieWag(p: Pomiar): string | null {
  const ustaw: string[] = [];
  if (p.bruttoKg !== null) ustaw.push("tw_Masa = @brutto");
  if (p.nettoKg !== null) ustaw.push("tw_MasaNetto = @netto");
  if (ustaw.length === 0) return null;
  return `UPDATE tw__Towar SET ${ustaw.join(", ")} WHERE tw_Id = @id`;
}

/**
 * Zapis wymiarów do `pw_Dane` — UPDATE wiersza towaru albo INSERT, gdy go nie ma.
 *
 * Towar bez żadnego pola własnego nie ma wiersza wcale, a to właśnie towary
 * bez wymiarów. Blokada `UPDLOCK, HOLDLOCK` na sprawdzeniu nie pozwala dwóm
 * zadaniom dopisać dwóch wierszy temu samemu towarowi.
 *
 * `zLicznika`: klucz `pwd_Id` nie jest IDENTITY i numer wydaje licznik
 * Subiekta w `ins_ident`, jak przy zdjęciach (`budujZapytanieInsert`
 * w `sfera.sql.ts`). Licznik spóźniony względem tabeli dogania `MAX + 1`.
 * Przy kolumnie IDENTITY numer nadaje baza, a licznika nie ruszamy.
 */
export function budujZapytanieWymiarow(p: Pomiar, pola: Record<Wymiar, string>, zLicznika: boolean): string | null {
  const zmierzone = WYMIARY.filter((w) => p[w] !== null);
  if (zmierzone.length === 0) return null;
  const kolumny = zmierzone.map((w) => assertSafeColumn(pola[w]));
  const wartosci = zmierzone.map((w) => `@${w}`);
  const gdzie = "pwd_TypObiektu = @typ AND pwd_IdObiektu = @id";
  const wstaw = zLicznika
    ? [
        "  DECLARE @maks int, @nowe int;",
        "  SELECT @maks = ISNULL(MAX(pwd_Id), 0) FROM pw_Dane WITH (UPDLOCK, HOLDLOCK);",
        "  SELECT @nowe = ido_wartosc FROM ins_ident WITH (UPDLOCK, HOLDLOCK) WHERE ido_nazwa = 'pw_Dane';",
        "  IF @nowe IS NULL OR @nowe <= @maks SET @nowe = @maks + 1;",
        "  UPDATE ins_ident SET ido_wartosc = @nowe + 1 WHERE ido_nazwa = 'pw_Dane';",
        `  INSERT INTO pw_Dane (pwd_Id, pwd_TypObiektu, pwd_IdObiektu, ${kolumny.join(", ")}) ` +
          `VALUES (@nowe, @typ, @id, ${wartosci.join(", ")});`,
      ]
    : [
        `  INSERT INTO pw_Dane (pwd_TypObiektu, pwd_IdObiektu, ${kolumny.join(", ")}) ` +
          `VALUES (@typ, @id, ${wartosci.join(", ")});`,
      ];
  return [
    `IF EXISTS (SELECT 1 FROM pw_Dane WITH (UPDLOCK, HOLDLOCK) WHERE ${gdzie})`,
    `  UPDATE pw_Dane SET ${kolumny.map((k, i) => `${k} = ${wartosci[i]}`).join(", ")} WHERE ${gdzie};`,
    "ELSE",
    "BEGIN",
    ...wstaw,
    "END",
  ].join("\n");
}

/**
 * Wymiary towaru z `pw_Dane` jako kolumny `pw.dlugosc`, `pw.szerokosc`, `pw.wysokosc`.
 *
 * OUTER APPLY z TOP 1, a nie złączenie: drugi wiersz pól własnych tego samego
 * towaru zdublowałby go na liście i w liczniku. Brak wiersza daje NULL-e,
 * czyli „brak wymiarów", bo tak wygląda towar, któremu nikt nic nie wpisał.
 */
export function zrodloWymiarow(pola: Record<Wymiar, string>): string {
  const [d, s, w] = WYMIARY.map((k) => assertSafeColumn(pola[k]));
  return (
    `OUTER APPLY (SELECT TOP 1 ${d} AS dlugosc, ${s} AS szerokosc, ${w} AS wysokosc ` +
    `FROM pw_Dane WITH (NOLOCK) WHERE pwd_TypObiektu = ${TYP_TOWARU_PW} AND pwd_IdObiektu = t.tw_Id ` +
    "ORDER BY pwd_Id) pw"
  );
}

/* Puste pole własne to NULL albo same spacje; waga zero to brak wagi. */
const pustyTekst = (k: Wymiar) => `LTRIM(RTRIM(ISNULL(pw.${k}, ''))) = ''`;

/**
 * Strona i licznik kartotek, którym brakuje którejś wagi albo wymiaru.
 *
 * Ten sam kształt co lista bez zdjęcia: tylko niezablokowane, stan i sprzedaż
 * sumowane w podzapytaniach, porządek domknięty `tw_Id`.
 */
export function budujZapytanieBezWymiarow(opts: {
  pola: Record<Wymiar, string>;
  /** Kolumna lokalizacji (`MSSQL_LOC_COLUMN`) — do wiersza i do obchodu po regałach. */
  lokalizacja: string;
  zFiltrem: boolean;
  sortuj?: SortWymiarow;
  naStanie?: boolean;
  sprzedane?: boolean;
  sprzedaz?: { fs: number; pa: number; odnosnik?: string };
}): { strona: string; razem: string } {
  const wymiary = zrodloWymiarow(opts.pola);
  const zrodlo = zrodloSprzedazy(opts.sprzedaz ?? { fs: 2, pa: 21 });
  const brak = ["ISNULL(t.tw_Masa, 0) <= 0", "ISNULL(t.tw_MasaNetto, 0) <= 0", ...WYMIARY.map(pustyTekst)]
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
  const loc = assertSafeColumn(opts.lokalizacja);
  /* Towar bez adresu na końcu obchodu: nie ma do czego podejść. */
  const porzadek = opts.sortuj === "lokalizacja"
    ? `CASE WHEN LTRIM(RTRIM(ISNULL(t.${loc}, ''))) = '' THEN 1 ELSE 0 END, t.${loc}, t.tw_Id`
    : PORZADEK[opts.sortuj ?? "sprzedaz"] ?? PORZADEK.sprzedaz;
  return {
    strona:
      "SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, " +
      "t.tw_PodstKodKresk AS ean, ISNULL(s.stan, 0) AS stan, ISNULL(sp.sprzedaz, 0) AS sprzedaz, " +
      `t.${loc} AS lokalizacja, ` +
      "t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, pw.dlugosc, pw.szerokosc, pw.wysokosc " +
      `FROM tw__Towar t WITH (NOLOCK) ${wymiary} ${stan} ${sprzedaz} ${gdzie} ` +
      `ORDER BY ${porzadek} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    razem: `SELECT COUNT(*) AS razem FROM tw__Towar t WITH (NOLOCK) ${wymiary} ${gdzie}`,
  };
}

export interface ZapytanieListy {
  q: string;
  limit: number;
  offset: number;
  sortuj: SortWymiarow;
  naStanie: boolean;
  sprzedane: boolean;
}

type WierszListy = {
  twId: number; symbol: string; nazwa: string; ean: string | null;
  stan: number | string | null; sprzedaz: number | string | null; lokalizacja: string | null;
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
    lokalizacja: tekstLubNull(w.lokalizacja),
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
    lokalizacja: m.locColumn,
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

/** Towar z obecną wagą i wymiarami — do audytu przed zapisem i do karty w kolektorze. */
export type StanKartoteki = Pick<
  TowarBezWymiarow,
  "twId" | "symbol" | "nazwa" | "ean" | "lokalizacja" | "brutto" | "netto" | "dlugosc" | "szerokosc" | "wysokosc"
>;

/**
 * Obecna waga i wymiary jednej kartoteki z Subiekta; `null` = nie ma takiego
 * towaru. Czytamy je w chwili zapisu, a nie z ciała żądania: audyt „co stało
 * przed" ma mówić o bazie firmy, nie o tym, co pamiętała przeglądarka.
 */
export async function stanKartoteki(twId: number): Promise<StanKartoteki | null> {
  const pool = await mssqlPool();
  const r = await pool
    .request()
    .input("id", sql.Int, twId)
    .query<WierszListy>(
      "SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, t.tw_PodstKodKresk AS ean, " +
        `0 AS stan, 0 AS sprzedaz, t.${assertSafeColumn(config.mssql.locColumn)} AS lokalizacja, ` +
        "t.tw_Masa AS brutto, t.tw_MasaNetto AS netto, " +
        "pw.dlugosc, pw.szerokosc, pw.wysokosc " +
        `FROM tw__Towar t WITH (NOLOCK) ${zrodloWymiarow(polaWymiarow())} WHERE t.tw_Id = @id`
    );
  const wiersz = r.recordset[0];
  return wiersz ? naPozycje(wiersz) : null;
}

/* ── Demo (SGT_MODE=seeded) ──────────────────────────────────────────────────
   Bez bazy Subiekta waga i wymiary żyją w kolumnach `sgt_towar`, które
   wypełnia wyłącznie `DevSferaAdapter`. Dzięki temu ekran i kolejkę da się
   przejść od listy do zapisu bez Subiekta. Sprzedaży demo nie zna, więc
   porządek „sprzedaż" schodzi do stanu. */

const PORZADEK_DEMO: Record<SortWymiarow, string> = {
  lokalizacja: "CASE WHEN TRIM(t.lokalizacja) = '' THEN 1 ELSE 0 END, t.lokalizacja, t.tw_id",
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
              0 AS sprzedaz, t.lokalizacja, t.masa AS brutto, t.masa_netto AS netto, t.wym_dlugosc AS dlugosc, t.wym_szerokosc AS szerokosc,
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
      `SELECT tw_id AS twId, symbol, nazwa, ean, 0 AS stan, 0 AS sprzedaz, lokalizacja, masa AS brutto, masa_netto AS netto,
              wym_dlugosc AS dlugosc, wym_szerokosc AS szerokosc, wym_wysokosc AS wysokosc
       FROM sgt_towar WHERE tw_id = ?`
    )
    .get(twId) as WierszListy | undefined;
  return wiersz ? naPozycje(wiersz) : null;
}
