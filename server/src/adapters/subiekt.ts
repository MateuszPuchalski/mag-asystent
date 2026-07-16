import type { ProductRow } from "../types.js";

/** Wiersz kartoteki + surowe stany (przed korektą o kolejkę). */
export interface RawProduct {
  tw_id: number;
  symbol: string;
  nazwa: string;
  ean: string;
  unit: string;
  ordered: number;
  opis: string;
  lokalizacja: string;
}
export interface RawStock {
  stan: number;
  stan_rez: number;
}
export interface RawDocument {
  dok_id: number;
  typ: string;
  nr_pelny: string;
  data_wyst: string;
  dostawca: string;
  w_buforze: number;
}
export interface RawPosition {
  tw_id: number;
  ilosc: number;
}

/**
 * SubiektAdapter — granica odczytu z Subiekta GT (spec §6).
 * DEV: SELECT z tabel sgt_* (SQLite, seed z mag.xlsx).
 * PROD: SELECT read-only z MSSQL (subiekt.mssql.ts).
 */
export interface SubiektAdapter {
  getProductById(twId: number): RawProduct | undefined;
  getProductByEan(ean: string): RawProduct | undefined;
  getProductBySymbol(symbol: string): RawProduct | undefined;
  search(q: string, limit: number): ProductRow[];
  getStock(twId: number, magId: number): RawStock;
  /** Dokumenty FZ/PZ na magazyn MGP z ostatnich N dni (spec §5.4). */
  listPutawayDocuments(days: number): RawDocument[];
  getDocument(docId: number): RawDocument | undefined;
  getDocumentPositions(docId: number): RawPosition[];
  /** Towary o stanie MGP > 0 (tryb „całe MGP"). */
  listMgpStockProducts(): RawPosition[];
}
