import type { SeededSubiektAdapter } from "./subiekt.seeded.js";

/** Wiersz kartoteki + surowe stany (przed korektą o kolejkę). */
export interface RawProduct {
  tw_id: number;
  symbol: string;
  nazwa: string;
  ean: string;
  unit: string;
  opis: string;
  lokalizacja: string;
}
export interface RawStock {
  stan: number;
  stan_rez: number;
}
/** Magazyn ze słownika Subiekta (`sl_Magazyn`). */
export interface RawMagazyn {
  mag_id: number;
  /** `mag_Symbol` — krótki kod, ten sam, który biuro widzi w Subiekcie. */
  kod: string;
  nazwa: string;
}
/** Stan jednego towaru w jednym magazynie — do zestawienia „gdzie jeszcze leży". */
export interface RawStockRow extends RawStock {
  mag_id: number;
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

/** Pozycja JEDNEGO towaru wraz z dokumentem, na którym stoi. */
export interface RawDocPosition extends RawDocument {
  /** Suma ilości z tego dokumentu — ten sam towar bywa w kilku pozycjach. */
  ilosc: number;
}

/** Pozycja JEDNEGO towaru na otwartym zamówieniu do dostawcy (ZD). */
export interface RawZamPosition {
  dok_id: number;
  nr_pelny: string;
  data_wyst: string;
  /** Termin realizacji; `null` gdy kolumna nieskonfigurowana albo pusta. */
  termin: string | null;
  dostawca: string;
  /** Suma zamówiona — ten sam towar bywa w kilku pozycjach zamówienia. */
  ilosc: number;
  /** Suma zrealizowana. Zero, gdy baza nie udostępnia tej kolumny. */
  zreal: number;
}

/**
 * SubiektAdapter — odczyt kartoteki Subiekta GT (spec §6).
 *
 * Jedyna implementacja to `SeededSubiektAdapter` — SELECT-y zawsze idą po
 * lokalnym read-modelu sgt_* (SQLite). Tryb SGT_MODE zmienia tylko źródło
 * zasilenia read-modelu: seed z mag.xlsx albo import z MSSQL
 * (subiekt.mssql.ts). Alias typu zamiast interfejsu, bo drugiej implementacji
 * nigdy nie było, a część serwisów i tak sięga do sgt_* bezpośrednio —
 * adapter zbiera zapytania kartotekowe, nie szczelnie strzeże granicy.
 */
export type SubiektAdapter = SeededSubiektAdapter;
