import sql from "mssql";
import { db, nowIso } from "../db/db.js";
import { mssqlRead } from "../db/mssql.js";
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
 * dok__Dokument, dok_Pozycja, kh__Kontrahent. Wartości [WERYFIKUJ]
 * (dok_Typ FZ/PZ, mag_Id, flaga bufora) — env, patrz docs/subiekt-gt-edu-setup.md.
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

export async function importFromMssql(): Promise<ImportStats> {
  const pool = await mssqlRead();
  const c = config.mssql;

  const towary = (
    await pool.request().query<TowarRow>(
      `SELECT tw_Id, tw_Symbol, tw_Nazwa, tw_PodstKodKresk, tw_JednMiary,
              tw_Opis, tw_Lokalizacja
       FROM tw__Towar
       WHERE tw_Zablokowany = 0`
    )
  ).recordset;

  const stany = (
    await pool
      .request()
      .input("mag", sql.Int, config.magId.MAG)
      .input("mgp", sql.Int, config.magId.MGP)
      .query<StanRow>(
        `SELECT st_TowId, st_MagId, st_Stan, st_StanRez
         FROM tw_Stan WHERE st_MagId IN (@mag, @mgp)`
      )
  ).recordset;

  // dostawca: kh_Symbol jest pewny w każdej wersji SGT; pełna nazwa siedzi w
  // adr__Ekran (adr_NazwaPelna) — podmiana opisana w docs/subiekt-gt-edu-setup.md
  const dokumenty = (
    await pool
      .request()
      .input("mgp", sql.Int, config.magId.MGP)
      .input("fz", sql.Int, c.dokTypFZ)
      .input("pz", sql.Int, c.dokTypPZ)
      .input("cutoff", sql.VarChar, new Date(Date.now() - DOC_IMPORT_DAYS * 86400_000).toISOString().slice(0, 10))
      .query<DokRow>(
        `SELECT d.dok_Id, d.dok_Typ, d.dok_NrPelny,
                CONVERT(varchar(10), d.dok_DataWyst, 120) AS data_wyst,
                d.dok_MagId,
                ISNULL(k.kh_Symbol, '') AS dostawca,
                ${c.bufferExpr} AS w_buforze
         FROM dok__Dokument d
         LEFT JOIN kh__Kontrahent k ON k.kh_Id = d.dok_PlatnikId
         WHERE d.dok_MagId = @mgp AND d.dok_Typ IN (@fz, @pz)
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
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,?,?,?,?,?,?)`
  );
  const insPoz = d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)");

  const apply = d.transaction(() => {
    for (const t of ["sgt_pozycja", "sgt_dokument", "sgt_stan", "sgt_towar", "sgt_magazyn"]) {
      d.prepare(`DELETE FROM ${t}`).run();
    }
    d.prepare("INSERT INTO sgt_magazyn(mag_id, kod) VALUES (?,?)").run(config.magId.MAG, "MAG");
    d.prepare("INSERT INTO sgt_magazyn(mag_id, kod) VALUES (?,?)").run(config.magId.MGP, "MGP");

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
      insDok.run(
        doc.dok_Id,
        doc.dok_Typ === c.dokTypFZ ? "FZ" : "PZ",
        doc.dok_NrPelny,
        doc.data_wyst,
        doc.dok_MagId,
        doc.dostawca ?? "",
        doc.w_buforze ? 1 : 0
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
