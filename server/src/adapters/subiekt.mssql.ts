import sql from "mssql";
import { db, nowIso, transaction } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";

/**
 * PRODUKCJA / edu — odczyt z bazy MSSQL Subiekta GT (spec §6, D2).
 *
 * Zamiast żywych SELECT-ów per żądanie (interfejs SubiektAdapter jest
 * synchroniczny, a driver `mssql` asynchroniczny) importujemy dane do
 * lokalnego read-modelu sgt_* — tych samych tabel, z których czyta
 * SeededSubiektAdapter. Import działa przy starcie API, co MSSQL_SYNC_MS
 * oraz na żądanie (POST /api/admin/resync). Stany na ekranie i tak są
 * korygowane o kolejkę (spec §5.1), więc krótki lag odświeżania jest
 * niewidoczny dla magazyniera.
 *
 * Login: read-only, GRANT SELECT wyłącznie na tw__Towar, tw_Stan,
 * dok__Dokument, dok_Pozycja, kh__Kontrahent.
 * Nazwy tabel i kolumn są zweryfikowane wprost z oficjalnego opisu struktury
 * InsERT GT dla wersji bazy 1.8731.31.6933 — patrz docs/subiekt-gt-struktura.md.
 * Zostaje do ustalenia na własnej bazie tylko to, czego dokumentacja nie
 * zawiera: id magazynów.
 *
 * UWAGA: nowsze wersje SGT (z polami KSeF) NIE MAJĄ natywnej kolumny
 * tw_Lokalizacja na tw__Towar — lokalizację trzyma się w jednym z ośmiu pól
 * własnych tw_Pole1..tw_Pole8 (varchar(50) każde, potwierdzone w strukturze);
 * który konkretnie, ustala się przy zakładaniu kartotek (env MSSQL_LOC_COLUMN,
 * domyślnie tw_Pole1).
 */

/**
 * Dokumenty dostaw, których NIE ROZŁOŻONO do końca — ich `dok_Id` po stronie
 * Subiekta.
 *
 * Okno importu obcina dokumenty po dacie wystawienia, ale niedokończona praca
 * nie ma prawa zniknąć z ekranu tylko dlatego, że dostawa przyjechała trzy
 * tygodnie temu. Brak dokumentu na liście wygląda przecież identycznie jak
 * dokument rozłożony — a to dwie zupełnie różne sytuacje.
 *
 * Stan „niedokończona" jest po NASZEJ stronie: Subiekt nie wie nic o postępie
 * rozkładania. Stąd odczyt z SQLite przed zapytaniem do MSSQL.
 */
function otwarteDokumenty(): number[] {
  return (
    db()
      .prepare("SELECT sgt_dok_id FROM delivery WHERE status = 'open'")
      .all() as Array<{ sgt_dok_id: number }>
  ).map((r) => Math.trunc(r.sgt_dok_id));
}

/**
 * Fragmenty `WHERE` dla zapytania o dokumenty. Wydzielone z zapytania, bo to
 * JEDYNA logika w tym imporcie — reszta jest wejściem/wyjściem, którego bez
 * serwera MSSQL nie da się przetestować.
 *
 * @param typy      kody `dok_Typ` uznawane za dostawę (`DOK_TYPY_DOSTAW`)
 * @param otwarte   `dok_Id` dostaw nierozłożonych do końca — wchodzą niezależnie
 *                  od okna dat
 */
export function budujFiltryDokumentow(
  typy: number[],
  otwarte: number[]
): { dostawyTypFilter: string; oknoFilter: string } {
  /* Pusta lista typów znaczy „ŻADEN typ", a nie „każdy". Literówka w ustawieniu
     ma dać pustą listę pracy — zauważalną od razu — a nie wpuścić na ekran
     magazyniera wszystkiego, co leży na magazynie. */
  const dostawyTypFilter = `d.dok_Typ IN (${
    typy.length ? typy.map((n) => Math.trunc(n)).join(",") : "NULL"
  })`;

  /* Przy braku otwartych dostaw CAŁA gałąź `OR` znika, bo `IN ()` jest błędem
     składni SQL, a nie zbiorem pustym — zapytanie wywaliłoby się w całości. */
  const oknoFilter = otwarte.length
    ? `(d.dok_DataWyst >= @cutoff OR d.dok_Id IN (${otwarte.map((n) => Math.trunc(n)).join(",")}))`
    : "d.dok_DataWyst >= @cutoff";

  return { dostawyTypFilter, oknoFilter };
}

/**
 * Okno importu zamówień do dostawcy [dni] — WŁASNE, szersze niż dla dostaw.
 * Zamówienie bywa starsze niż dwa miesiące i wciąż otwarte, a jest ich o rząd
 * wielkości mniej niż dokumentów, więc szersze okno nic nie kosztuje.
 */
const ZAM_IMPORT_DAYS = 180;

interface TowarRow {
  tw_Id: number;
  tw_Symbol: string;
  tw_Nazwa: string;
  tw_PodstKodKresk: string | null;
  tw_JednMiary: string | null;
  tw_Opis: string | null;
  tw_Lokalizacja: string | null;
}
interface StanRow {
  st_TowId: number;
  st_MagId: number;
  st_Stan: number;
  st_StanRez: number;
}
interface DokRow {
  dok_Id: number;
  dok_Typ: number;
  dok_NrPelny: string;
  data_wyst: string;
  dok_MagId: number;
  dostawca: string | null;
  w_buforze: number;
}
interface PozRow {
  ob_DokHanId: number;
  ob_TowId: number;
  ob_IloscMag: number;
  /** Klucz wiersza faktury; NULL gdy kolumny nie ma albo zrezygnowano z niej. */
  ob_id: number | null;
}

interface ZamRow {
  dok_Id: number;
  dok_NrPelny: string;
  data_wyst: string;
  termin: string | null;
  dok_Status: number;
  dostawca: string | null;
}
interface ZamPozRow {
  ob_DokHanId: number;
  ob_TowId: number;
  ob_IloscMag: number;
  zreal: number;
}

export interface ImportStats {
  towary: number;
  stany: number;
  dokumenty: number;
  pozycje: number;
  zamowienia: number;
  zamPozycje: number;
  at: string;
}

/** Znacznik ostatniego udanego importu (do /api/health). */
export let lastImport: ImportStats | null = null;

/**
 * Ustawiane, gdy login nie ma `GRANT SELECT ON dbo.sl_Magazyn`.
 *
 * Czytane przez `/api/health` — bo objawem braku uprawnienia jest „karta
 * pokazuje tylko trzy magazyny", czyli dokładnie to, co było przed zmianą.
 * Bez tego komunikatu nikt by nie skojarzył, że trzeba ponownie uruchomić
 * skrypt uprawnień.
 */
export let brakDostepuDoMagazynow: string | null = null;

/**
 * Ustawiane, gdy `dok_Pozycja` nie ma kolumny z ilością zrealizowaną
 * (`MSSQL_ZD_ZREAL_COLUMN`).
 *
 * Czytane przez `/api/health` i przenoszone na kartę jako `szacunek`. Bez tej
 * kolumny zamówienie zrealizowane w połowie pokazuje pełną ilość — magazynier
 * musi wiedzieć, że liczba jest górnym oszacowaniem, a nie tym, co przyjedzie.
 */
export let brakKolumnyZrealizowano: string | null = null;

/** Czy ostatni import umiał odczytać ilość zrealizowaną. Czyta serwis karty. */
export const zrealWiarygodne = () => brakKolumnyZrealizowano === null;

/**
 * Ustawiane, gdy `dok_Pozycja` nie ma kolumny klucza pozycji
 * (`MSSQL_POZ_ID_COLUMN`).
 *
 * Czytane przez `/api/health`. Bez tej kolumny nie da się wskazać KONKRETNEGO
 * wiersza faktury, a ten sam towar potrafi stać na niej dwa razy. Cisza byłaby
 * tu groźna: opis różnic trafiłby kiedyś w niewłaściwą pozycję i nikt by tego
 * nie zauważył, bo wygląda to jak zwykły wpis.
 */
export let brakKolumnyIdPozycji: string | null = null;

interface MagRow {
  mag_Id: number;
  mag_Symbol: string;
  mag_Nazwa: string;
}

async function pobierzMagazyny(pool: sql.ConnectionPool): Promise<MagRow[]> {
  try {
    const r = await pool
      .request()
      .query<MagRow>("SELECT mag_Id, mag_Symbol, mag_Nazwa FROM sl_Magazyn");
    brakDostepuDoMagazynow = null;
    return r.recordset;
  } catch (e) {
    /* Degradacja do stanu sprzed zmiany: trzy magazyny z konfiguracji, bez
       nazw ze słownika. Aplikacja działa dalej — traci tylko zestawienie
       „gdzie jeszcze leży". */
    brakDostepuDoMagazynow =
      "Brak GRANT SELECT na sl_Magazyn — karta towaru pokazuje tylko MAG, MGP " +
      "i Zwroty. Uruchom ponownie skrypt uprawnień (DEPLOY §6) albo instalator " +
      "z -TylkoKonfiguracja.";
    console.warn(`[mssql] ${brakDostepuDoMagazynow} (${e instanceof Error ? e.message : e})`);
    return [
      { mag_Id: config.magId.MAG, mag_Symbol: "MAG", mag_Nazwa: "Magazyn główny" },
      { mag_Id: config.magId.MGP, mag_Symbol: "MGP", mag_Nazwa: "Strefa przyjęć" },
      { mag_Id: config.magId.ZWROTY, mag_Symbol: "ZWROTY", mag_Nazwa: "Zwroty od klientów" },
    ];
  }
}

/**
 * Otwarte zamówienia do dostawcy wraz z pozycjami.
 *
 * Te same tabele co reszta importu (`dok__Dokument`, `dok_Pozycja`,
 * `kh__Kontrahent`), więc ZERO nowych GRANT-ów — konsekwencja tego, że adapter
 * MSSQL jest wyłącznie importerem, a odczyty idą przez read-model.
 */
async function pobierzZamowienia(
  pool: sql.ConnectionPool
): Promise<{ zamowienia: ZamRow[]; zamPozycje: ZamPozRow[] }> {
  const c = config.mssql;
  const statusy = c.dokStatusyZDOtwarte.map((n) => Math.trunc(n));
  if (statusy.length === 0) return { zamowienia: [], zamPozycje: [] };

  const terminSelect = c.zdTerminColumn
    ? `CONVERT(varchar(10), d.${assertSafeColumn(c.zdTerminColumn)}, 120)`
    : "NULL";
  const cutoff = new Date(Date.now() - ZAM_IMPORT_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);

  const zamowienia = (
    await pool
      .request()
      .input("zd", sql.Int, c.dokTypZD)
      .input("cutoff", sql.VarChar, cutoff)
      .query<ZamRow>(
        `SELECT d.dok_Id, d.dok_NrPelny,
                CONVERT(varchar(10), d.dok_DataWyst, 120) AS data_wyst,
                ${terminSelect} AS termin,
                d.dok_Status,
                ISNULL(k.kh_Symbol, '') AS dostawca
         FROM dok__Dokument d
         LEFT JOIN kh__Kontrahent k ON k.kh_Id = d.dok_PlatnikId
         WHERE d.dok_Typ = @zd
           AND d.dok_Status IN (${statusy.join(",")})
           AND d.dok_DataWyst >= @cutoff`
      )
  ).recordset;

  if (zamowienia.length === 0) return { zamowienia, zamPozycje: [] };
  const ids = zamowienia.map((z) => z.dok_Id).join(",");

  /* Ilość zrealizowana: najpierw z kolumną, a gdy jej nie ma — DRUGIE PODEJŚCIE
     bez niej. Wyjątek nie może tu wywrócić całej synchronizacji, bo stany
     i lokalizacje są ważniejsze od zamówień; ale nie może też przejść bez echa,
     stąd komunikat czytany przez /api/health. */
  if (c.zdZrealColumn) {
    const zrealCol = assertSafeColumn(c.zdZrealColumn);
    try {
      const zamPozycje = (
        await pool.request().query<ZamPozRow>(
          `SELECT ob_DokHanId, ob_TowId, ob_IloscMag, ${zrealCol} AS zreal
           FROM dok_Pozycja WHERE ob_DokHanId IN (${ids})`
        )
      ).recordset;
      brakKolumnyZrealizowano = null;
      return { zamowienia, zamPozycje };
    } catch (e) {
      brakKolumnyZrealizowano =
        `Kolumna ${zrealCol} nie istnieje w dok_Pozycja — zamówienia u dostawcy ` +
        "pokazują ilość ZAMÓWIONĄ, bez odjęcia już odebranej. Sprawdź nazwę " +
        "kolumny na własnej bazie i ustaw MSSQL_ZD_ZREAL_COLUMN (DEPLOY §6).";
      console.warn(
        `[mssql] ${brakKolumnyZrealizowano} (${e instanceof Error ? e.message : e})`
      );
    }
  } else {
    brakKolumnyZrealizowano = null; // puste = świadoma rezygnacja, nie awaria
  }

  const zamPozycje = (
    await pool.request().query<ZamPozRow>(
      `SELECT ob_DokHanId, ob_TowId, ob_IloscMag, 0 AS zreal
       FROM dok_Pozycja WHERE ob_DokHanId IN (${ids})`
    )
  ).recordset;
  return { zamowienia, zamPozycje };
}

/**
 * Pozycje dostaw, z identyfikatorem wiersza faktury albo bez niego.
 *
 * Ten sam wzorzec dwóch podejść co przy ilości zrealizowanej wyżej: najpierw
 * z kolumną, a gdy jej nie ma — jeszcze raz bez niej, z komunikatem do
 * /api/health. Pozycje dostaw są rdzeniem listy rozkładania, więc brak jednej
 * kolumny NIE MOŻE wywrócić importu — ale nie może też przejść w ciszy.
 */
async function pobierzPozycje(pool: sql.ConnectionPool, dokIds: number[]): Promise<PozRow[]> {
  const ids = dokIds.join(",");
  const c = config.mssql;

  if (c.pozIdColumn) {
    const idCol = assertSafeColumn(c.pozIdColumn);
    try {
      const r = (
        await pool.request().query<PozRow>(
          `SELECT ob_DokHanId, ob_TowId, ob_IloscMag, ${idCol} AS ob_id
           FROM dok_Pozycja WHERE ob_DokHanId IN (${ids})`
        )
      ).recordset;
      brakKolumnyIdPozycji = null;
      return r;
    } catch (e) {
      brakKolumnyIdPozycji =
        `Kolumna ${idCol} nie istnieje w dok_Pozycja — nie da się wskazać ` +
        "KONKRETNEGO wiersza faktury, a ten sam towar potrafi stać na niej " +
        "dwa razy. Sprawdź nazwę klucza pozycji na własnej bazie i ustaw " +
        "MSSQL_POZ_ID_COLUMN (docs/subiekt-gt-struktura.md).";
      console.warn(`[mssql] ${brakKolumnyIdPozycji} (${e instanceof Error ? e.message : e})`);
    }
  } else {
    brakKolumnyIdPozycji = null; // puste = świadoma rezygnacja, nie awaria
  }

  return (
    await pool.request().query<PozRow>(
      `SELECT ob_DokHanId, ob_TowId, ob_IloscMag, NULL AS ob_id
       FROM dok_Pozycja WHERE ob_DokHanId IN (${ids})`
    )
  ).recordset;
}

export async function importFromMssql(): Promise<ImportStats> {
  const pool = await mssqlPool();
  const c = config.mssql;
  // nowsze SGT nie mają natywnego tw_Lokalizacja — alias na skonfigurowane
  // pole dodatkowe (domyślnie tw_Pole1), żeby reszta kodu widziała stałą nazwę
  const locCol = assertSafeColumn(c.locColumn);

  const towary = (
    await pool.request().query<TowarRow>(
      `SELECT tw_Id, tw_Symbol, tw_Nazwa, tw_PodstKodKresk, tw_JednMiary,
              tw_Opis, ${locCol} AS tw_Lokalizacja
       FROM tw__Towar
       WHERE tw_Zablokowany = 0`
    )
  ).recordset;

  /* Magazyny ze słownika. NOWY GRANT: `GRANT SELECT ON dbo.sl_Magazyn`.
     Instalacja sprzed lipca 2026 go NIE MA, a `git pull` nie ma prawa jej
     wywrócić — dlatego brak uprawnienia degraduje import do dawnego
     zachowania (trzy magazyny z konfiguracji) i melduje się zdaniem
     w /api/health, zamiast przerywać synchronizację. */
  const magazyny = await pobierzMagazyny(pool);

  /* Stany WSZYSTKICH magazynów, nie tylko trzech z rolami. Wcześniejszy filtr
     `st_MagId IN (@mag,@mgp,@zw)` sprawiał, że reszta nigdy nie trafiała do
     read-modelu — karta towaru fizycznie nie miała skąd wziąć informacji, że
     towar leży gdzie indziej. Przy 3415 kartotekach i kilku magazynach to
     nadal kilkadziesiąt tysięcy wierszy, czyli dla SQLite nic. */
  const stany = (
    await pool.request().query<StanRow>(
      `SELECT st_TowId, st_MagId, st_Stan, st_StanRez FROM tw_Stan`
    )
  ).recordset;

  // dostawca: kh_Symbol jest pewny w każdej wersji SGT; pełna nazwa siedzi w
  // adr__Ekran (adr_NazwaPelna) — podmiana opisana w docs/subiekt-gt-edu-setup.md
  //
  const { dostawyTypFilter, oknoFilter } = budujFiltryDokumentow(
    c.dokTypyDostaw,
    otwarteDokumenty()
  );
  const dokumenty = (
    await pool
      .request()
      .input("mag", sql.Int, config.magId.MAG)
      .input("mgp", sql.Int, config.magId.MGP)
      .input("cutoff", sql.VarChar, new Date(Date.now() - c.dokDniWstecz * 86400_000).toISOString().slice(0, 10))
      .query<DokRow>(
        `SELECT d.dok_Id, d.dok_Typ, d.dok_NrPelny,
                CONVERT(varchar(10), d.dok_DataWyst, 120) AS data_wyst,
                d.dok_MagId,
                ISNULL(k.kh_Symbol, '') AS dostawca,
                ${c.bufferExpr} AS w_buforze
         FROM dok__Dokument d
         LEFT JOIN kh__Kontrahent k ON k.kh_Id = d.dok_PlatnikId
         WHERE (
                 -- tryb A: dostawa krajowa księgowana wprost na MAG (sam adres, bez MM)
                 (d.dok_MagId = @mag AND ${dostawyTypFilter})
                 -- tryb B: kontener na MGP — sesja z wózkiem i MM na rundę
              OR (d.dok_MagId = @mgp AND ${dostawyTypFilter})
               )
           AND ${oknoFilter}`
      )
  ).recordset;

  const pozycje = dokumenty.length ? await pobierzPozycje(pool, dokumenty.map((d) => d.dok_Id)) : [];

  const { zamowienia, zamPozycje } = await pobierzZamowienia(pool);

  // ── wpis do read-modelu sgt_* (wzorzec wipe+insert z seed.ts) ─────────────
  const d = db();
  const knownTw = new Set(towary.map((t) => t.tw_Id));

  const insTowar = d.prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, opis, lokalizacja)
     VALUES (@tw_id,@symbol,@nazwa,@ean,@unit,@opis,@lokalizacja)`
  );
  const insStan = d.prepare(
    "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,?)"
  );
  const insDok = d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,?,?,?,?,?,?)`
  );
  const insPoz = d.prepare(
    "INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc, ob_id) VALUES (?,?,?,?)"
  );
  const insZam = d.prepare(
    `INSERT INTO sgt_zamowienie(dok_id, nr_pelny, data_wyst, termin, dostawca, status)
     VALUES (?,?,?,?,?,?)`
  );
  const insZamPoz = d.prepare(
    "INSERT INTO sgt_zam_pozycja(dok_id, tw_id, ilosc, zreal) VALUES (?,?,?,?)"
  );

  const apply = transaction(d, () => {
    /* Kolejność ma znaczenie: pozycje przed nagłówkami, bo trzyma je klucz obcy. */
    for (const t of [
      "sgt_zam_pozycja", "sgt_zamowienie",
      "sgt_pozycja", "sgt_dokument", "sgt_stan", "sgt_towar", "sgt_magazyn",
    ]) {
      d.prepare(`DELETE FROM ${t}`).run();
    }
    const insMag = d.prepare("INSERT INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)");
    for (const m of magazyny) {
      insMag.run(m.mag_Id, (m.mag_Symbol ?? "").trim() || `MAG${m.mag_Id}`, (m.mag_Nazwa ?? "").trim());
    }

    for (const t of towary) {
      insTowar.run({
        tw_id: t.tw_Id,
        symbol: t.tw_Symbol ?? "",
        nazwa: t.tw_Nazwa ?? "",
        ean: t.tw_PodstKodKresk ?? "",
        unit: t.tw_JednMiary || "szt.",
        opis: t.tw_Opis ?? "",
        lokalizacja: t.tw_Lokalizacja ?? "",
      });
    }
    for (const s of stany) {
      if (!knownTw.has(s.st_TowId)) continue;
      insStan.run(s.st_TowId, s.st_MagId, s.st_Stan ?? 0, s.st_StanRez ?? 0);
    }
    for (const doc of dokumenty) {
      const typ = doc.dok_Typ === c.dokTypFZ ? "FZ" : "PZ";
      insDok.run(
        doc.dok_Id,
        typ,
        doc.dok_NrPelny,
        doc.data_wyst,
        doc.dok_MagId,
        doc.dostawca ?? "",
        doc.w_buforze ? 1 : 0
      );
    }
    for (const p of pozycje) {
      if (!knownTw.has(p.ob_TowId)) continue;
      insPoz.run(p.ob_DokHanId, p.ob_TowId, p.ob_IloscMag ?? 0, p.ob_id ?? null);
    }
    for (const z of zamowienia) {
      insZam.run(
        z.dok_Id,
        z.dok_NrPelny,
        z.data_wyst,
        z.termin || null,
        z.dostawca ?? "",
        z.dok_Status ?? 0
      );
    }
    for (const p of zamPozycje) {
      if (!knownTw.has(p.ob_TowId)) continue;
      insZamPoz.run(p.ob_DokHanId, p.ob_TowId, p.ob_IloscMag ?? 0, p.zreal ?? 0);
    }
  });
  apply();

  lastImport = {
    towary: towary.length,
    stany: stany.length,
    dokumenty: dokumenty.length,
    pozycje: pozycje.length,
    zamowienia: zamowienia.length,
    zamPozycje: zamPozycje.length,
    at: nowIso(),
  };
  console.log(
    `[mssql] import: towary=${lastImport.towary}, stany=${lastImport.stany}, ` +
      `dokumenty=${lastImport.dokumenty}, pozycje=${lastImport.pozycje}, ` +
      `zamowienia=${lastImport.zamowienia}, zamPozycje=${lastImport.zamPozycje}`
  );
  return lastImport;
}
