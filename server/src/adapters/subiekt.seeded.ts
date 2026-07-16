import { db } from "../db/db.js";
import { config } from "../config.js";
import type { ProductRow } from "../types.js";
import type {
  RawDocument,
  RawPosition,
  RawProduct,
  RawStock,
  SubiektAdapter,
} from "./subiekt.js";

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

  getProductBySymbol(symbol: string): RawProduct | undefined {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE symbol = ? COLLATE NOCASE")
      .get(symbol) as RawProduct | undefined;
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
      locs: r.lok ? r.lok.split(" ").filter(Boolean) : [],
    }));
  }

  getStock(twId: number, magId: number): RawStock {
    const row = db()
      .prepare("SELECT stan, stan_rez FROM sgt_stan WHERE tw_id = ? AND mag_id = ?")
      .get(twId, magId) as RawStock | undefined;
    return row ?? { stan: 0, stan_rez: 0 };
  }

  listPutawayDocuments(days: number): RawDocument[] {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return db()
      .prepare(
        `SELECT * FROM sgt_dokument
         WHERE mag_id = ? AND data_wyst >= ?
         ORDER BY data_wyst DESC, dok_id DESC`
      )
      .all(config.magId.MGP, cutoff) as RawDocument[];
  }

  getDocument(docId: number): RawDocument | undefined {
    return db()
      .prepare("SELECT * FROM sgt_dokument WHERE dok_id = ?")
      .get(docId) as RawDocument | undefined;
  }

  getDocumentPositions(docId: number): RawPosition[] {
    return db()
      .prepare("SELECT tw_id, ilosc FROM sgt_pozycja WHERE dok_id = ?")
      .all(docId) as RawPosition[];
  }

  listMgpStockProducts(): RawPosition[] {
    return db()
      .prepare(
        "SELECT tw_id, stan AS ilosc FROM sgt_stan WHERE mag_id = ? AND stan > 0"
      )
      .all(config.magId.MGP) as RawPosition[];
  }
}
