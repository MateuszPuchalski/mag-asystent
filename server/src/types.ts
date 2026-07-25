export interface StockView {
  stan: number;       // stan SGT
  rez: number;        // rezerwacje
  avail: number;      // dostępne (stan - rez)
  pendingIn: number;  // ⏳ w drodze z kolejki (MM przychodzące)
  pendingOut: number; // ⏳ w kolejce (MM wychodzące)
  effective: number;  // stan skorygowany o kolejkę
}

export interface ProductCard {
  id: number;
  sym: string;
  name: string;
  ean: string;
  unit: string;
  ordered: number;
  desc: string;
  locs: string[];
  mag: StockView;
  mgp: StockView;
  /** Strefa zwrotów od klientów (magazyn Zwroty). */
  zwroty: StockView;
}

export interface ProductRow {
  id: number;
  sym: string;
  name: string;
  ean: string;
  mag: number;
  mgp: number;
  locs: string[];
}

export interface PutawayDocument {
  docId: number;
  typ: string;
  nrPelny: string;
  dataWyst: string;
  dostawca: string;
  positions: number;
  /** Strefa źródłowa dokumentu: dostawy (MGP) lub zwroty od klientów. */
  zone: "mgp" | "zwroty";
  /**
   * Towary z dokumentu są już na MAG (biuro wykonało MM MGP→MAG przed
   * rozłożeniem): strefa źródłowa pusta, a stan jest na magazynie głównym.
   * Dostawa nadal wymaga rozłożenia — tylko bez MM, sam set_location.
   */
  onMag?: boolean;
  session?: { id: number; status: string; progressPct: number };
}

export interface PutawayItemView {
  id: number;
  twId: number;
  sym: string;
  name: string;
  targetLoc: string | null;
  qtyExpected: number;
  qtyDone: number;
  delta: number;
  mgpStan: number;
  status: string;
  skipReason: string | null;
  lockedBy: string | null;
  offDocument: boolean;
  stageQty: number | null;
  stageLoc: string | null;
}

/* ── Tryb A: rozkładanie dostaw (redesign v2.0) ─────────────────────────────
   Jednostką pracy jest dokument FZ/PZ; aplikacja zapisuje wyłącznie
   lokalizację (D1) — bez MM i bez zależności od bufora SGT.                 */

export interface DeliveryDocument {
  dokId: number;
  typ: string;
  nrPelny: string;
  dataWyst: string;
  dostawca: string;
  positions: number;
  /** Dokument w buforze SGT — nadal można na nim pracować (D1). */
  wBuforze: boolean;
  linesTotal: number;
  linesDone: number;
  status: string | null;
}

export interface DeliveryLineView {
  id: number;
  twId: number;
  sym: string;
  name: string;
  qtyDoc: number;
  qtyDone: number;
  locExpected: string | null;
  locActual: string | null;
  status: string;
  /** Litera alejki (nagłówek sekcji listy) albo null przy braku lokalizacji. */
  aisle: string | null;
}

export interface DeliveryView {
  id: number;
  dokId: number;
  nrPelny: string;
  dostawca: string;
  dataWyst: string;
  status: string;
  progress: { total: number; done: number; remaining: number };
  lines: DeliveryLineView[];
}

/** Kandydat przy niejednoznacznym kodzie kreskowym (D7). */
export interface EanCandidate {
  twId: number;
  sym: string;
  name: string;
  inDocument: boolean;
  qtyDoc: number | null;
  locExpected: string | null;
}

/** Wynik skanu towaru w kontekście dostawy. */
export type ScanResolution =
  | { kind: "line"; line: DeliveryLineView }
  | { kind: "conflict"; code: string; candidates: EanCandidate[] }
  | { kind: "off_document"; code: string; twId: number; sym: string; name: string }
  | { kind: "unknown"; code: string };
