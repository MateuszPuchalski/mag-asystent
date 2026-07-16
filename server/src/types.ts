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
  status: string;
  skipReason: string | null;
  lockedBy: string | null;
  offDocument: boolean;
  stageQty: number | null;
  stageLoc: string | null;
}
