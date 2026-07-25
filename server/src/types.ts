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
  /** Strefa źródłowa dokumentu: kontenery (MGP) lub zwroty od klientów. */
  zone: "mgp" | "zwroty";
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
  /** Flaga sprawdzenia faktury — ten sam stan, który biuro widzi w Subiekcie. */
  flaga: string | null;
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
  /** Flaga sprawdzenia faktury — ten sam stan, który biuro widzi w Subiekcie. */
  flaga: string | null;
  /** `problems` ⊂ `done` — linie wyjęte z rutyny przez zgłoszony wyjątek (D8). */
  progress: { total: number; done: number; remaining: number; problems: number };
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
  /** Linię trzyma teraz ktoś inny — nie odbieramy jej po cichu. */
  | { kind: "locked"; code: string; lockedBy: string; sym: string; name: string }
  | { kind: "unknown"; code: string };

/* ── Faza 2: wyjątki (D8) ───────────────────────────────────────────────── */

export type ProblemType =
  | "qty_short"
  | "qty_over"
  | "damaged"
  | "wrong_item"
  | "no_space"
  | "unknown_barcode"
  | "ean_conflict";

export interface ProblemView {
  id: number;
  deliveryId: number | null;
  lineId: number | null;
  typ: string;
  qty: number | null;
  opis: string | null;
  hasPhoto: boolean;
  createdAt: string;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  /** Kontekst do listy „nierozwiązane" — bez wchodzenia w dostawę. */
  docNumber: string | null;
  sym: string | null;
  name: string | null;
}

/** Wybór operatora przy skanie innej półki niż oczekiwana (§4.3). */
export type LocApplyAction = "add" | "replace";
