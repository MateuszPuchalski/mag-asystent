import { db } from "../db/db.js";
import { config } from "../config.js";
import type { ProductRow } from "../types.js";
import { parseLocs } from "../locs.js";
import type {
  RawDocPosition,
  RawDocument,
  RawMagazyn,
  RawPosition,
  RawProduct,
  RawStock,
  RawStockRow,
  RawZamPosition,
  SubiektAdapter,
} from "./subiekt.js";

/**
 * `DOK_TYPY_DOSTAW` jako etykiety tekstowe read-modelu.
 *
 * Read-model trzyma typ dokumentu jako napis ('FZ'/'PZ'), a konfiguracja — jako
 * kod `dok_Typ` (1/10), bo taki stoi w bazie Subiekta. Tłumaczenie musi być
 * TUTAJ, w jednym miejscu: rozsypane po zapytaniach rozjechałoby się przy
 * pierwszej zmianie ustawienia.
 *
 * Kod spoza pary FZ/PZ wypada cicho — seed innych typów nie syntetyzuje,
 * a wpisanie ich do `DOK_TYPY_DOSTAW` dotyczy wyłącznie prawdziwej bazy.
 */
export function etykietyDostaw(): string[] {
  const { dokTypyDostaw, dokTypFZ, dokTypPZ } = config.mssql;
  return dokTypyDostaw
    .map((kod) => (kod === dokTypFZ ? "FZ" : kod === dokTypPZ ? "PZ" : null))
    .filter((s): s is "FZ" | "PZ" => s !== null);
}

/**
 * DEV/TEST — odczyt z tabel sgt_* (SQLite, seed z mag.xlsx).
 * Odzwierciedla SELECT-y ze spec §6, ale na lokalnym read-modelu.
 */
export class SeededSubiektAdapter implements SubiektAdapter {
  getProductById(twId: number): RawProduct | undefined {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE tw_id = ?")
      .get(twId) as RawProduct | undefined;
  }

  getProductByEan(ean: string): RawProduct | undefined {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE ean = ?")
      .get(ean) as RawProduct | undefined;
  }

  findProductsByEan(ean: string): RawProduct[] {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE ean = ? ORDER BY symbol")
      .all(ean) as unknown as RawProduct[];
  }

  getProductBySymbol(symbol: string): RawProduct | undefined {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE symbol = ? COLLATE NOCASE")
      .get(symbol) as RawProduct | undefined;
  }

  getProductsBySymbols(symbols: string[]): ProductRow[] {
    if (symbols.length === 0) return [];
    const dziury = symbols.map(() => "?").join(",");
    // `symbol COLLATE NOCASE IN (…)` — kolatacja PO stronie kolumny, żeby
    // zapytanie mogło skorzystać z ix_towar_symbol_nocase. Zapisane odwrotnie
    // (`IN (…) COLLATE NOCASE`) SQLite zejdzie do skanu całej kartoteki.
    const rows = db()
      .prepare(
        `SELECT t.tw_id AS id, t.symbol AS sym, t.nazwa AS name, t.ean AS ean,
                t.lokalizacja AS lok,
                COALESCE(mag.stan,0) AS mag, COALESCE(mgp.stan,0) AS mgp
         FROM sgt_towar t
         LEFT JOIN sgt_stan mag ON mag.tw_id = t.tw_id AND mag.mag_id = ?
         LEFT JOIN sgt_stan mgp ON mgp.tw_id = t.tw_id AND mgp.mag_id = ?
         WHERE t.symbol COLLATE NOCASE IN (${dziury})`
      )
      .all(config.magId.MAG, config.magId.MGP, ...symbols) as Array<{
      id: number; sym: string; name: string; ean: string; lok: string; mag: number; mgp: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sym: r.sym,
      name: r.name,
      ean: r.ean ?? "",
      mag: r.mag,
      mgp: r.mgp,
      locs: parseLocs(r.lok),
    }));
  }

  search(q: string, limit: number): ProductRow[] {
    // §5.1: symbol prefix > nazwa infix > końcówka EAN (dla ciągu numerycznego ≥5)
    const isNum = /^\d{5,}$/.test(q);
    const rows = db()
      .prepare(
        `SELECT t.tw_id AS id, t.symbol AS sym, t.nazwa AS name, t.ean AS ean,
                t.lokalizacja AS lok,
                COALESCE(mag.stan,0) AS mag, COALESCE(mgp.stan,0) AS mgp,
                CASE
                  WHEN lower(t.symbol) LIKE lower(?) || '%' THEN 0
                  WHEN lower(t.nazwa) LIKE '%' || lower(?) || '%' THEN 1
                  WHEN ? = 1 AND t.ean LIKE '%' || ? THEN 2
                  ELSE 9
                END AS rank
         FROM sgt_towar t
         LEFT JOIN sgt_stan mag ON mag.tw_id = t.tw_id AND mag.mag_id = ?
         LEFT JOIN sgt_stan mgp ON mgp.tw_id = t.tw_id AND mgp.mag_id = ?
         WHERE rank < 9
         ORDER BY rank, t.symbol
         LIMIT ?`
      )
      .all(
        q,
        q,
        isNum ? 1 : 0,
        q,
        config.magId.MAG,
        config.magId.MGP,
        limit
      ) as Array<{ id: number; sym: string; name: string; ean: string; lok: string; mag: number; mgp: number }>;
    return rows.map((r) => ({
      id: r.id,
      sym: r.sym,
      name: r.name,
      ean: r.ean ?? "",
      mag: r.mag,
      mgp: r.mgp,
      locs: parseLocs(r.lok),
    }));
  }

  getStock(twId: number, magId: number): RawStock {
    const row = db()
      .prepare("SELECT stan, stan_rez FROM sgt_stan WHERE tw_id = ? AND mag_id = ?")
      .get(twId, magId) as RawStock | undefined;
    return row ?? { stan: 0, stan_rez: 0 };
  }

  listMagazyny(): RawMagazyn[] {
    return db()
      .prepare("SELECT mag_id, kod, nazwa FROM sgt_magazyn ORDER BY mag_id")
      .all() as unknown as RawMagazyn[];
  }

  getStockAll(twId: number): RawStockRow[] {
    return db()
      .prepare("SELECT mag_id, stan, stan_rez FROM sgt_stan WHERE tw_id = ? ORDER BY mag_id")
      .all(twId) as unknown as RawStockRow[];
  }

  listPutawayDocuments(days: number): RawDocument[] {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return db()
      .prepare(
        `SELECT * FROM sgt_dokument
         WHERE mag_id = ? AND data_wyst >= ?
         ORDER BY data_wyst DESC, dok_id DESC`
      )
      .all(config.magId.MGP, cutoff) as unknown as RawDocument[];
  }

  listDeliveryDocuments(days: number): RawDocument[] {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    // O trybie decyduje MAGAZYN SKUTKU, nie typ dokumentu — i kryteria obu list
    // muszą pozostać ROZŁĄCZNE, inaczej ten sam dokument wisi w dwóch zakładkach
    // i można na nim pracować dwoma niekompatybilnymi ścieżkami naraz.
    //
    //   MAG    → tryb A, dostawa krajowa: towar już leży na hali, brakuje adresu (D1)
    //   Zwroty → tryb A, zwroty: adres jak wyżej + jeden MM na zamknięty koszyk
    //   MGP    → tryb B, kontener: sesja z wózkiem, MM na rundę
    // Typy dostaw biorą się z `DOK_TYPY_DOSTAW`, tak samo jak w adapterze MSSQL.
    // Para ('FZ','PZ') była tu ZASZYTA i czyniła demo niewiernym: zawężenie
    // konfiguracji do samych FZ nie robiło na tej liście żadnej różnicy, więc
    // pokaz i produkcja pokazywały co innego z tych samych ustawień.
    const etykiety = etykietyDostaw();
    const luki = etykiety.map(() => "?").join(",");
    return db()
      .prepare(
        `SELECT * FROM sgt_dokument
         WHERE ((typ IN (${luki}) AND mag_id = ?) OR mag_id = ?)
           AND data_wyst >= ?
         ORDER BY data_wyst DESC, dok_id DESC`
      )
      .all(...etykiety, config.magId.MAG, config.magId.ZWROTY, cutoff) as unknown as RawDocument[];
  }

  getDocument(docId: number): RawDocument | undefined {
    return db()
      .prepare("SELECT * FROM sgt_dokument WHERE dok_id = ?")
      .get(docId) as RawDocument | undefined;
  }

  getDeliveryPositionsForProduct(twId: number, days: number): RawDocPosition[] {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    // Warunek na dokumenty jest DOKŁADNIE ten sam co w `listDeliveryDocuments`
    // wyżej — i musi taki pozostać. To dwie strony jednego pytania: tamta metoda
    // pyta „które dostawy są do rozłożenia", ta „na których z nich stoi ten
    // towar". Rozjazd kryteriów pokazałby na karcie dokument, którego nie da się
    // otworzyć z zakładki rozkładania.
    const etykiety = etykietyDostaw();
    const luki = etykiety.map(() => "?").join(",");
    return db()
      .prepare(
        `SELECT d.dok_id, d.typ, d.nr_pelny, d.data_wyst, d.mag_id, d.dostawca,
                d.w_buforze, SUM(p.ilosc) AS ilosc
         FROM sgt_pozycja p
         JOIN sgt_dokument d ON d.dok_id = p.dok_id
         WHERE p.tw_id = ?
           AND ((d.typ IN (${luki}) AND d.mag_id = ?) OR d.mag_id = ?)
           AND d.data_wyst >= ?
         GROUP BY d.dok_id
         ORDER BY d.data_wyst DESC, d.dok_id DESC`
      )
      .all(twId, ...etykiety, config.magId.MAG, config.magId.ZWROTY, cutoff) as unknown as RawDocPosition[];
  }

  getOrdersForProduct(twId: number): RawZamPosition[] {
    /* Bez odsiewu po dacie i bez odejmowania `zreal` — jedno i drugie należy do
       warstw obok: okno wycina import, a regułę „zostało <= 0 wypada" ma serwis
       razem ze swoim testem. Adapter zwraca to, co stoi w read-modelu. */
    return db()
      .prepare(
        `SELECT z.dok_id, z.nr_pelny, z.data_wyst, z.termin, z.dostawca,
                SUM(p.ilosc) AS ilosc, SUM(p.zreal) AS zreal
         FROM sgt_zam_pozycja p
         JOIN sgt_zamowienie z ON z.dok_id = p.dok_id
         WHERE p.tw_id = ?
         GROUP BY z.dok_id`
      )
      .all(twId) as unknown as RawZamPosition[];
  }

  getDocumentPositions(docId: number): RawPosition[] {
    return db()
      .prepare("SELECT tw_id, ilosc FROM sgt_pozycja WHERE dok_id = ?")
      .all(docId) as unknown as RawPosition[];
  }

  listLocations(): string[] {
    const rows = db()
      .prepare("SELECT lokalizacja FROM sgt_towar WHERE lokalizacja <> ''")
      .all() as Array<{ lokalizacja: string }>;
    const set = new Set<string>();
    for (const r of rows) {
      for (const c of parseLocs(r.lokalizacja)) set.add(c);
    }
    return [...set].sort();
  }

  getProductsByLocation(code: string): ProductRow[] {
    // dopasowanie po całym kodzie w spacja-separated polu (granice słowa)
    const rows = db()
      .prepare(
        `SELECT t.tw_id AS id, t.symbol AS sym, t.nazwa AS name, t.ean AS ean,
                t.lokalizacja AS lok,
                COALESCE(mag.stan,0) AS mag, COALESCE(mgp.stan,0) AS mgp
         FROM sgt_towar t
         LEFT JOIN sgt_stan mag ON mag.tw_id = t.tw_id AND mag.mag_id = ?
         LEFT JOIN sgt_stan mgp ON mgp.tw_id = t.tw_id AND mgp.mag_id = ?
         WHERE ' ' || t.lokalizacja || ' ' LIKE '% ' || ? || ' %'
         ORDER BY t.symbol
         LIMIT 200`
      )
      .all(config.magId.MAG, config.magId.MGP, code) as Array<{
      id: number; sym: string; name: string; ean: string; lok: string; mag: number; mgp: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sym: r.sym,
      name: r.name,
      ean: r.ean ?? "",
      mag: r.mag,
      mgp: r.mgp,
      locs: parseLocs(r.lok),
    }));
  }
}
