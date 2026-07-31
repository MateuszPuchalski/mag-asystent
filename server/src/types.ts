export interface StockView {
  stan: number;       // stan SGT
  rez: number;        // rezerwacje
  avail: number;      // dostępne (stan - rez)
  pendingIn: number;  // ⏳ w drodze z kolejki (MM przychodzące)
  pendingOut: number; // ⏳ w kolejce (MM wychodzące)
  effective: number;  // stan skorygowany o kolejkę
}

/**
 * Zmiana lokalizacji czekająca w kolejce — pojedynczy kod, nie całe pole.
 * `pending` = worker to jeszcze zrobi; `error` = nie zrobi bez PONÓW.
 */
export interface PendingLocChange {
  code: string;
  kind: "add" | "remove";
  status: "pending" | "error";
  /** Zadanie kolejki — kolektor prowadzi z chipa prosto do PONÓW. */
  queueId: number;
}

import type { MagazynStan } from "./services/magazyny.js";
import type { WDostawie } from "./services/dostawy-towaru.js";
import type { ZamowioneUDostawcy } from "./services/zamowienia-towaru.js";

export interface ProductCard {
  id: number;
  sym: string;
  name: string;
  ean: string;
  unit: string;
  desc: string;
  /** Lokalizacje POTWIERDZONE — to, co naprawdę jest w Subiekcie. */
  locs: string[];
  /** Zmiany czekające w kolejce; `locs` celowo ich nie zawiera. */
  pendingLocs: PendingLocChange[];
  mag: StockView;
  mgp: StockView;
  /** Strefa zwrotów od klientów (magazyn Zwroty). */
  zwroty: StockView;
  /**
   * Pozostałe magazyny firmy — bez trójki z rolami i bez ukrytych w ustawieniach.
   * Do lipca 2026 karta znała wyłącznie MAG/MGP/Zwroty, więc „gdzie ten towar
   * jeszcze leży" było pytaniem bez odpowiedzi.
   */
  magazyny: MagazynStan[];
  /**
   * Przyjechało na dokumencie, ale jeszcze nie odłożone. Puste = wszystko, co
   * przyszło, leży już w regale.
   *
   * Odpowiada na pytanie, którego karta wcześniej nie zamykała: „stan mówi 12,
   * a półka jest pusta — gdzie to jest?". Przy dostawie krajowej towar figuruje
   * na MAG od chwili zaksięgowania dokumentu, więc kafel stanu nie odróżnia
   * „leży w regale" od „stoi na palecie w przyjęciach".
   */
  wDostawie: WDostawie[];
  /**
   * Otwarte zamówienia u dostawcy. Puste = nic nie jest w drodze.
   *
   * Druga połowa pytania „nie ma tego na półce": `wDostawie` mówi „przyjechało,
   * poszukaj w przyjęciach", to pole mówi „nie ma i trzeba poczekać". Zastąpiło
   * pole `ordered`, które importer produkcyjny wypełniał zerem na sztywno.
   */
  zamowione: ZamowioneUDostawcy[];
  /** Zamienniki wyczytane z `desc` — patrz `services/zamienniki.ts`. */
  zamienniki: Zamienniki;
}

/**
 * Zamienniki z opisu kartoteki, rozstrzygnięte kartoteką.
 *
 * `znane` to nasze towary — w nie da się kliknąć i przejść na ich kartę;
 * `obce` to numery OEM i katalogi innych producentów, których u siebie nie
 * mamy. Obcych jest zwykle więcej niż znanych (w całej kartotece 2304 tokeny,
 * z czego 478 nasze), ale zostają na karcie, bo to one idą w rozmowę
 * z dostawcą.
 */
export interface Zamienniki {
  znane: ProductRow[];
  obce: string[];
}

export interface ProductRow {
  id: number;
  sym: string;
  name: string;
  ean: string;
  mag: number;
  mgp: number;
  locs: string[];
  /**
   * Wypełniane WYŁĄCZNIE przy liście zawartości regału: czy ten towar właśnie
   * na tę półkę jedzie, czy z niej schodzi. W wynikach wyszukiwania `null` —
   * tam pytanie „której półki?" nie ma sensu.
   */
  pendingHere?: "add" | "remove" | "error" | null;
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

/* ── Tryb A: rozkładanie faktur zakupu (redesign v2.0) ──────────────────────
   Jednostką pracy jest dokument. Aplikacja zapisuje wyłącznie lokalizację
   (D1) — bez MM i bez zależności od bufora SGT.                             */

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
  | { kind: "locked"; code: string; lineId: number; lockedBy: string; sym: string; name: string }
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
