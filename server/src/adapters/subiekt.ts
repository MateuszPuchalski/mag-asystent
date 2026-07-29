import type { ProductRow } from "../types.js";

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
  /**
   * Wiersze listy dla zbioru symboli — jedno zapytanie, nie N. Symbole nie
   * istniejące w kartotece po prostu nie wracają; to jest cały mechanizm
   * odsiewania numerów obcych przy zamiennikach z opisu.
   */
  getProductsBySymbols(symbols: string[]): ProductRow[];
  search(q: string, limit: number): ProductRow[];
  getStock(twId: number, magId: number): RawStock;
  /**
   * Wszystkie magazyny ze słownika Subiekta.
   *
   * Do lipca 2026 aplikacja znała DOKŁADNIE TRZY magazyny — te z `MAG_ID_*` —
   * i nie było to ograniczenie wyświetlania: importer filtrował `tw_Stan`
   * po tych trzech identyfikatorach, więc stany reszty nigdy nie trafiały do
   * read-modelu. Magazynier nie miał jak się dowiedzieć, że towar leży jeszcze
   * gdzie indziej.
   */
  listMagazyny(): RawMagazyn[];
  /** Stany towaru we WSZYSTKICH magazynach — do zestawienia na karcie. */
  getStockAll(twId: number): RawStockRow[];
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
  /**
   * Odwrotność `listDeliveryDocuments`: na których dostawach z ostatnich N dni
   * stoi TEN towar i w jakiej ilości.
   *
   * Ta metoda mieszka w adapterze, a nie w serwisie, z jednego powodu: warunek
   * „co w ogóle jest dostawą" musi zostać w jednym pliku obok
   * `listDeliveryDocuments`. Druga kopia tego kryterium rozjechałaby się przy
   * pierwszej zmianie, a objawem byłby towar policzony dwa razy albo wcale.
   */
  getDeliveryPositionsForProduct(twId: number, days: number): RawDocPosition[];
  /**
   * Otwarte zamówienia do dostawcy (ZD), na których stoi TEN towar.
   *
   * Bez parametru `days`: okno wycina już import (zamówienie bywa starsze niż
   * dostawa i wciąż otwarte), a drugie okno tutaj tylko ukryłoby część tego, co
   * importer uznał za aktualne — i to bez śladu na ekranie.
   */
  getOrdersForProduct(twId: number): RawZamPosition[];
  getDocument(docId: number): RawDocument | undefined;
  getDocumentPositions(docId: number): RawPosition[];
  /** Wykaz istniejących kodów lokalizacji (słownik dla walidacji/podpowiedzi). */
  listLocations(): string[];
  /** Towary, których pole lokalizacji zawiera dany kod (reverse lookup). */
  getProductsByLocation(code: string): ProductRow[];
}
