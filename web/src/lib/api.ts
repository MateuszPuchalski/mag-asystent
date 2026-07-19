/* Klient REST do serwera WERTIS. Nagłówek X-User z localStorage (spec §8). */

export interface StockView {
  stan: number;
  rez: number;
  avail: number;
  pendingIn: number;
  pendingOut: number;
  effective: number;
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
  zwroty?: StockView;
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
export type ScanResult =
  | { type: "product"; card: ProductCard }
  | { type: "search"; results: ProductRow[] }
  | { type: "notfound"; code: string };

export interface MovementEntry {
  type: string;
  user: string;
  at: string;
  detail: string;
}

export interface LocationsInfo {
  codes: string[];
  format: string;
  strict: boolean;
  allowManual: boolean;
}

export interface QueueItem {
  id: number;
  type: "set_location" | "mm" | "combo";
  status: "pending" | "processing" | "waiting_for_doc" | "done" | "error" | "cancelled";
  label: string;
  detail: string;
  errMsg: string | null;
  time: string;
}
export interface QueueResponse {
  items: QueueItem[];
  summary: { pending: number; error: number; done: number };
}

export interface PutawayDocument {
  docId: number;
  typ: string;
  nrPelny: string;
  dataWyst: string;
  dostawca: string;
  positions: number;
  /** Strefa źródłowa: dostawy (MGP) lub zwroty od klientów. */
  zone: "mgp" | "zwroty";
  session?: { id: number; status: string; progressPct: number };
}
export interface PutawayItem {
  id: number;
  twId: number;
  sym: string;
  name: string;
  targetLoc: string | null;
  qtyExpected: number;
  qtyDone: number;
  delta: number;
  mgpStan: number;
  status: "pending" | "on_cart" | "done" | "partial" | "skipped";
  skipReason: string | null;
  lockedBy: string | null;
  offDocument: boolean;
  stageQty: number | null;
  stageLoc: string | null;
}
export interface PutawayQueueAlert {
  id: number;
  type: "set_location" | "mm" | "combo";
  label: string;
  detail: string;
  errorMsg: string | null;
}
export interface PutawaySession {
  id: number;
  sourceDocId: number | null;
  sourceDocNumber: string | null;
  zone: "mgp" | "zwroty";
  status: string;
  progress: { total: number; done: number; remaining: number; onCart: number };
  queueAlerts: PutawayQueueAlert[];
  inFlight: number;
  items: PutawayItem[];
}

export function getUser(): string {
  return localStorage.getItem("wertis_user") || "magazynier";
}
export function setUser(u: string) {
  localStorage.setItem("wertis_user", u);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      // content-type tylko gdy wysyłamy ciało (Fastify odrzuca puste JSON body)
      ...(init?.body ? { "content-type": "application/json" } : {}),
      "x-user": getUser(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `Błąd ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* brak treści */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  scan: (code: string) => req<ScanResult>(`/api/products/scan/${encodeURIComponent(code)}`),
  search: (q: string) => req<{ results: ProductRow[] }>(`/api/products/search?q=${encodeURIComponent(q)}`),
  product: (id: number) => req<ProductCard>(`/api/products/${id}`),
  setLocation: (
    id: number,
    body: { action: "replace" | "add" | "remove" | "replace_one"; value?: string; replaced?: string },
    asUser?: string // operacja z bufora offline — przypisz do autora, nie bieżącego
  ) =>
    req<{ queueId: number }>(`/api/products/${id}/location`, {
      method: "POST",
      body: JSON.stringify(body),
      ...(asUser ? { headers: { "x-user": asUser } } : {}),
    }),
  mm: (body: { items: { twId: number; qty: number }[] }, asUser?: string) =>
    req<{ queueId: number; kind: string }>(`/api/mm`, {
      method: "POST",
      body: JSON.stringify(body),
      ...(asUser ? { headers: { "x-user": asUser } } : {}),
    }),
  history: (id: number) => req<{ entries: MovementEntry[] }>(`/api/products/${id}/history`),

  locations: () => req<LocationsInfo>(`/api/locations`),
  locationProducts: (code: string) =>
    req<{ code: string; products: ProductRow[] }>(`/api/locations/${encodeURIComponent(code)}/products`),

  deviceEvent: (body: { type: "device_drop" | "battery_low"; [k: string]: unknown }) =>
    req<{ ok: true }>(`/api/device/event`, { method: "POST", body: JSON.stringify(body) }),

  queue: () => req<QueueResponse>(`/api/queue`),
  retry: (id: number) => req<{ ok: true }>(`/api/queue/${id}/retry`, { method: "POST" }),
  cancel: (id: number) => req<{ ok: true }>(`/api/queue/${id}/cancel`, { method: "POST" }),

  putawayDocuments: () => req<{ documents: PutawayDocument[] }>(`/api/putaway/documents`),
  createSession: (body: { docId?: number; mode?: "all_mgp" }) =>
    req<{ sessionId: number }>(`/api/putaway/sessions`, { method: "POST", body: JSON.stringify(body) }),
  session: (id: number) => req<PutawaySession>(`/api/putaway/sessions/${id}`),
  cart: (sid: number, body: { twId: number; offDocument?: boolean }) =>
    req<any>(`/api/putaway/sessions/${sid}/cart`, { method: "POST", body: JSON.stringify(body) }),
  cartRemove: (sid: number, itemId: number) =>
    req<any>(`/api/putaway/sessions/${sid}/cart/remove`, { method: "POST", body: JSON.stringify({ itemId }) }),
  confirm: (sid: number, body: { itemId: number; qty: number; location: string; updateLoc?: boolean }) =>
    req<any>(`/api/putaway/sessions/${sid}/confirm`, { method: "POST", body: JSON.stringify(body) }),
  skip: (sid: number, body: { itemId: number; reason?: string }) =>
    req<any>(`/api/putaway/sessions/${sid}/skip`, { method: "POST", body: JSON.stringify(body) }),
  commitCart: (sid: number) =>
    req<{ queueIds: number[]; committed: number }>(`/api/putaway/sessions/${sid}/commit-cart`, { method: "POST" }),
  closeSession: (sid: number) =>
    req<{ status: string; summary: Record<string, number> }>(`/api/putaway/sessions/${sid}/close`, { method: "POST" }),
};
