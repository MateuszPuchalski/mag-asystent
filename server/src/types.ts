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

/* ── Tryb A: rozkładanie dostaw i zwrotów (redesign v2.0) ───────────────────
   Jednostką pracy jest dokument. Przy dostawie krajowej aplikacja zapisuje
   wyłącznie lokalizację (D1) — bez MM i bez zależności od bufora SGT. Przy
   zwrocie dochodzi jeden MM Zwroty→MAG na każdy rozłożony KOSZYK.           */

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
  /** Nazwa flagi jak w Subiekcie — do pokazania człowiekowi. */
  flaga: string | null;
  /** Klucz stanu — stabilny, po nim kolektor dobiera kolor (nazwy są konfigurowalne). */
  flagaKey: string | null;
  /** Zbiorczy dokument zwrotów: rozkładanie koszykami, każdy domknięty MM-em. */
  zwrot: boolean;
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
  /** Zwroty: numer koszyka, z którego pozycję odłożono (null przy dostawie krajowej). */
  koszyk: string | null;
}

/** Koszyk zwrotu czekający na przesunięcie (rozłożony, jeszcze bez MM). */
export interface KoszykView {
  numer: string;
  /** Ile linii tego koszyka czeka na MM. */
  lines: number;
  /** Ile sztuk łącznie czeka na MM. */
  qty: number;
}

export interface DeliveryView {
  id: number;
  dokId: number;
  nrPelny: string;
  dostawca: string;
  dataWyst: string;
  status: string;
  /** Nazwa flagi jak w Subiekcie — do pokazania człowiekowi. */
  flaga: string | null;
  /** Klucz stanu — stabilny, po nim kolektor dobiera kolor. */
  flagaKey: string | null;
  /** `problems` ⊂ `done` — linie wyjęte z rutyny przez zgłoszony wyjątek (D8). */
  progress: { total: number; done: number; remaining: number; problems: number };
  /** Zbiorczy dokument zwrotów: rozkładanie koszykami, każdy domknięty MM-em. */
  zwrot: boolean;
  /** Koszyki rozłożone, ale jeszcze nieprzesunięte na MAG (puste przy dostawie krajowej). */
  koszyki: KoszykView[];
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
