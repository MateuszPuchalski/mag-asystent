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
 * dok__Dokument, dok_Pozycja, kh__Kontrahent, fl_Wartosc, fl__Flagi.
 * Nazwy tabel i kolumn są zweryfikowane wprost z oficjalnego opisu struktury
 * InsERT GT dla wersji bazy 1.8731.31.6933 — patrz docs/subiekt-gt-struktura.md.
 * Zostaje do ustalenia na własnej bazie tylko to, czego dokumentacja nie
 * zawiera: id magazynów oraz para (grupa flag, typ obiektu).
 *
 * UWAGA: nowsze wersje SGT (z polami KSeF) NIE MAJĄ natywnej kolumny
 * tw_Lokalizacja na tw__Towar — lokalizację trzyma się w jednym z ośmiu pól
 * własnych tw_Pole1..tw_Pole8 (varchar(50) każde, potwierdzone w strukturze);
 * który konkretnie, ustala się przy zakładaniu kartotek (env MSSQL_LOC_COLUMN,
 * domyślnie tw_Pole1).
 */

/** Okno importu dokumentów FZ/PZ [dni] — szersze niż 14 dni widoku (spec §5.4). */
const DOC_IMPORT_DAYS = 60;

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
  /** Flaga sprawdzenia faktury; NULL gdy kolumna nieskonfigurowana. */
  flaga: string | null;
}
interface PozRow {
  ob_DokHanId: number;
  ob_TowId: number;
  ob_IloscMag: number;
}

export interface ImportStats {
  towary: number;
  stany: number;
  dokumenty: number;
  pozycje: number;
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
  // dokumenty zwrotów: domyślnie ZW (dok_Typ 14), DOK_TYP_ZWROTY może rozszerzyć
  //
  // Flaga sprawdzenia faktury nie jest kolumną dokumentu — leży w `fl_Wartosc`
  // pod kluczem (grupa flag, typ obiektu, id dokumentu). Czytamy `flw_IdFlagi`,
  // czyli dokładnie tę wartość, którą sami tam wpisujemy; bez konfiguracji
  // grupy/typu wszystkie dokumenty mają flagę NULL i mechanizm „nadpisanie biura
  // wygrywa" po prostu nie ma czego porównywać ([WERYFIKUJ], DEPLOY §6).
  const flagJoin =
    c.flagGrupa && c.flagTypObiektu
      ? `LEFT JOIN fl_Wartosc fw ON fw.flw_IdObiektu = d.dok_Id
            AND fw.flw_IdGrupyFlag = ${Math.trunc(c.flagGrupa)}
            AND fw.flw_TypObiektu = ${Math.trunc(c.flagTypObiektu)}`
      : "";
  const flagSelect = flagJoin ? "CONVERT(varchar(20), fw.flw_IdFlagi)" : "NULL";
  const zwTypFilter = c.dokTypyZwroty.length
    ? ` AND d.dok_Typ IN (${c.dokTypyZwroty.map((n) => Math.trunc(n)).join(",")})`
    : "";
  const dokumenty = (
    await pool
      .request()
      .input("mag", sql.Int, config.magId.MAG)
      .input("mgp", sql.Int, config.magId.MGP)
      .input("zw", sql.Int, config.magId.ZWROTY)
      .input("fz", sql.Int, c.dokTypFZ)
      .input("pz", sql.Int, c.dokTypPZ)
      .input("cutoff", sql.VarChar, new Date(Date.now() - DOC_IMPORT_DAYS * 86400_000).toISOString().slice(0, 10))
      .query<DokRow>(
        `SELECT d.dok_Id, d.dok_Typ, d.dok_NrPelny,
                CONVERT(varchar(10), d.dok_DataWyst, 120) AS data_wyst,
                d.dok_MagId,
                ISNULL(k.kh_Symbol, '') AS dostawca,
                ${c.bufferExpr} AS w_buforze,
                ${flagSelect} AS flaga
         FROM dok__Dokument d
         LEFT JOIN kh__Kontrahent k ON k.kh_Id = d.dok_PlatnikId
         ${flagJoin}
         WHERE (
                 -- tryb A: dostawa krajowa księgowana wprost na MAG (sam adres, bez MM)
                 (d.dok_MagId = @mag AND d.dok_Typ IN (@fz, @pz))
                 -- tryb A (zwroty): zbiorczy dokument na mag. Zwroty; MM powstaje
                 -- dopiero przy zamknięciu koszyka, nie przy imporcie
              OR (d.dok_MagId = @zw${zwTypFilter})
                 -- tryb B: kontener na MGP — sesja z wózkiem i MM na rundę
              OR (d.dok_MagId = @mgp AND d.dok_Typ IN (@fz, @pz))
               )
           AND d.dok_DataWyst >= @cutoff`
      )
  ).recordset;

  const pozycje = dokumenty.length
    ? (
        await pool.request().query<PozRow>(
          `SELECT ob_DokHanId, ob_TowId, ob_IloscMag
           FROM dok_Pozycja
           WHERE ob_DokHanId IN (${dokumenty.map((d) => d.dok_Id).join(",")})`
        )
      ).recordset
    : [];

  // ── wpis do read-modelu sgt_* (wzorzec wipe+insert z seed.ts) ─────────────
  const d = db();
  const knownTw = new Set(towary.map((t) => t.tw_Id));

  const insTowar = d.prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, ordered, opis, lokalizacja)
     VALUES (@tw_id,@symbol,@nazwa,@ean,@unit,@ordered,@opis,@lokalizacja)`
  );
  const insStan = d.prepare(
    "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,?)"
  );
  const insDok = d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze, flaga)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insPoz = d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)");

  const apply = transaction(d, () => {
    for (const t of ["sgt_pozycja", "sgt_dokument", "sgt_stan", "sgt_towar", "sgt_magazyn"]) {
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
        // „Zamówione" nie ma prostej kolumny w tw_Stan (pochodzi z ZK/ZD) — 0
        ordered: 0,
        opis: t.tw_Opis ?? "",
        lokalizacja: t.tw_Lokalizacja ?? "",
      });
    }
    for (const s of stany) {
      if (!knownTw.has(s.st_TowId)) continue;
      insStan.run(s.st_TowId, s.st_MagId, s.st_Stan ?? 0, s.st_StanRez ?? 0);
    }
    for (const doc of dokumenty) {
      const typ =
        doc.dok_MagId === config.magId.ZWROTY
          ? "ZW"
          : doc.dok_Typ === c.dokTypFZ
            ? "FZ"
            : "PZ";
      insDok.run(
        doc.dok_Id,
        typ,
        doc.dok_NrPelny,
        doc.data_wyst,
        doc.dok_MagId,
        doc.dostawca ?? "",
        doc.w_buforze ? 1 : 0,
        doc.flaga ?? null
      );
    }
    for (const p of pozycje) {
      if (!knownTw.has(p.ob_TowId)) continue;
      insPoz.run(p.ob_DokHanId, p.ob_TowId, p.ob_IloscMag ?? 0);
    }
  });
  apply();

  lastImport = {
    towary: towary.length,
    stany: stany.length,
    dokumenty: dokumenty.length,
    pozycje: pozycje.length,
    at: nowIso(),
  };
  console.log(
    `[mssql] import: towary=${lastImport.towary}, stany=${lastImport.stany}, ` +
      `dokumenty=${lastImport.dokumenty}, pozycje=${lastImport.pozycje}`
  );
  return lastImport;
}
