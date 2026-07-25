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
  mag_id: number;
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
  /**
   * WSZYSTKIE kartoteki o danym kodzie EAN. W kartotece istnieją kody wskazujące
   * na >1 SKU, więc ścieżki operacyjne muszą widzieć komplet kandydatów i same
   * rozstrzygnąć (D7) — nigdy „pierwsze dopasowanie".
   */
  findProductsByEan(ean: string): RawProduct[];
  getProductBySymbol(symbol: string): RawProduct | undefined;
  search(q: string, limit: number): ProductRow[];
  getStock(twId: number, magId: number): RawStock;
  /** Tryb B: kontenery na MGP z ostatnich N dni — sesja z wózkiem i MM na rundę (spec §5.4). */
  listPutawayDocuments(days: number): RawDocument[];
  /**
   * Tryb A z ostatnich N dni: dostawy krajowe FZ/PZ księgowane wprost na MAG
   * oraz zbiorcze dokumenty zwrotów na magazynie Zwroty. Dokumenty w buforze
   * też, bo rozkładanie nie czeka na księgowość (D1).
   *
   * Kryteria tej listy i `listPutawayDocuments` MUSZĄ być rozłączne — dokument
   * widoczny w obu zakładkach dałoby się rozłożyć dwiema niekompatybilnymi
   * ścieżkami naraz.
   */
  listDeliveryDocuments(days: number): RawDocument[];
  getDocument(docId: number): RawDocument | undefined;
  getDocumentPositions(docId: number): RawPosition[];
  /** Wykaz istniejących kodów lokalizacji (słownik dla walidacji/podpowiedzi). */
  listLocations(): string[];
  /** Towary, których pole lokalizacji zawiera dany kod (reverse lookup). */
  getProductsByLocation(code: string): ProductRow[];
}
