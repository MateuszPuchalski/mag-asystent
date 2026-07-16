import { useSyncExternalStore } from "react";
import { beep } from "./feedback";
import type {
  LocMode,
  Product,
  QueueStatus,
  QueueTask,
  QueueType,
  Screen,
} from "./types";

const qs = new URLSearchParams(location.search);
export const WORKER_DELAY = Math.max(0.3, parseFloat(qs.get("delay") || "") || 1.8) * 1000;
export const SIM_ERRORS = qs.get("errors") === "1";
export const LOC_FIELD_LIMIT = 50; // COL_LENGTH('tw__Towar','tw_Lokalizacja')

interface State {
  screen: Screen;
  loading: boolean;
  products: Product[];
  query: string;
  curId: number | null;
  mode: LocMode;
  pendingLoc: string | null;
  pickOne: boolean;
  chipMenu: string | null;
  manualOpen: boolean;
  qty: number;
  recent: number[];
  queue: QueueTask[];
  nextQ: number;
  nextMM: number;
  toast: string | null;
  success: string | null;
}

const now = () =>
  new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

const initialRecent: number[] = JSON.parse(
  localStorage.getItem("wertis_recent") || "[]"
);

let state: State = {
  screen: "splash",
  loading: true,
  products: [],
  query: "",
  curId: null,
  mode: "loc",
  pendingLoc: null,
  pickOne: false,
  chipMenu: null,
  manualOpen: false,
  qty: 0,
  recent: initialRecent,
  queue: [
    { id: 3, type: "set_location", label: "Lokalizacja · W60-0401", detail: "E03-02-01 (dodano)", status: "error", errMsg: "Kartoteka otwarta w edycji (Subiekt)", time: "10:05" },
    { id: 2, type: "set_location", label: "Lokalizacja · FTC201", detail: "D01-02-02 (zastąpiono)", status: "done", time: "09:31" },
    { id: 1, type: "mm", label: "MM MGP→MAG · W09-0211", detail: "24 szt · dok. MM 46/07/2026", status: "done", time: "09:12" },
  ],
  nextQ: 10,
  nextMM: 47,
  toast: null,
  success: null,
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}

export const store = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}

export const cur = (s: State = state) =>
  s.products.find((p) => p.id === s.curId);

/* ── toast / sukces ──────────────────────────────────────────────────── */
let toastT: ReturnType<typeof setTimeout>;
let succT: ReturnType<typeof setTimeout>;
export function toast(msg: string) {
  clearTimeout(toastT);
  set({ toast: msg });
  toastT = setTimeout(() => set({ toast: null }), 2400);
}
function flashSuccess(msg: string) {
  clearTimeout(succT);
  set({ success: msg });
  beep(true);
  succT = setTimeout(() => set({ success: null }), 1500);
}

/* ── kolejka Sfery (symulacja workera) ───────────────────────────────── */
function setQ(id: number, patch: Partial<QueueTask>) {
  set((s) => ({
    queue: s.queue.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}
function updProduct(id: number, patch: Partial<Product>) {
  set((s) => ({
    products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }));
}
function runTask(task: QueueTask) {
  setTimeout(() => setQ(task.id, { status: "processing" }), 700);
  setTimeout(() => {
    if (SIM_ERRORS && Math.random() < 0.45) {
      setQ(task.id, {
        status: "error",
        errMsg: "Zapis Sfery nieudany — kartoteka w edycji",
      });
      return;
    }
    const patch: Partial<QueueTask> = { status: "done" };
    if (task.type !== "set_location") {
      patch.detail = task.detail + " · dok. MM " + state.nextMM + "/07/2026";
      set({ nextMM: state.nextMM + 1 });
    }
    setQ(task.id, patch);
    task.apply?.();
  }, 700 + WORKER_DELAY);
}
function enqueue(
  type: QueueType,
  label: string,
  detail: string,
  apply: (() => void) | undefined,
  pid: number
) {
  const task: QueueTask = {
    id: state.nextQ,
    type,
    label,
    detail,
    status: "pending",
    time: now(),
    apply,
    pid,
  };
  set((s) => ({ queue: [task, ...s.queue], nextQ: s.nextQ + 1 }));
  runTask(task);
}
export function retryTask(id: number) {
  const t = state.queue.find((x) => x.id === id);
  if (!t) return;
  setQ(id, { status: "pending", errMsg: undefined, time: now() });
  runTask({ ...t, status: "pending" });
}

/* ── nawigacja ───────────────────────────────────────────────────────── */
const BACK: Partial<Record<Screen, Screen>> = {
  product: "home",
  scanLoc: "product",
  mm: "product",
};
export function go(screen: Screen) {
  set({ screen });
}
export function goBack() {
  set((s) => ({
    screen: BACK[s.screen] || "home",
    chipMenu: null,
    manualOpen: false,
    pendingLoc: null,
    pickOne: false,
  }));
}
export const backTarget = (s: Screen) => BACK[s];

/* ── operacje domenowe ───────────────────────────────────────────────── */
export function openProduct(id: number) {
  const recent = [id, ...state.recent.filter((r) => r !== id)].slice(0, 4);
  localStorage.setItem("wertis_recent", JSON.stringify(recent));
  set({ screen: "product", curId: id, query: "", chipMenu: null, recent });
}

function applyLoc(newLocs: string[], desc: string) {
  const p = cur();
  if (!p) return;
  if (newLocs.join(" ").length > LOC_FIELD_LIMIT) {
    toast(`Limit pola tw_Lokalizacja (${LOC_FIELD_LIMIT} znaków) — za dużo lokalizacji`);
    beep(false);
    return;
  }
  updProduct(p.id, { locs: newLocs });
  enqueue("set_location", "Lokalizacja · " + p.sym, desc, undefined, p.id);
  set({ screen: "product", pendingLoc: null, pickOne: false, manualOpen: false, chipMenu: null });
  flashSuccess("Lokalizacja zapisana");
}
function finishCombo(newLocs: string[], desc: string) {
  const p = cur();
  if (!p) return;
  if (newLocs.join(" ").length > LOC_FIELD_LIMIT) {
    toast(`Limit pola tw_Lokalizacja (${LOC_FIELD_LIMIT} znaków)`);
    beep(false);
    return;
  }
  const qty = p.mgp;
  const pid = p.id;
  updProduct(pid, { locs: newLocs });
  enqueue("combo", "Zasilenie · " + p.sym, qty + " szt → MAG · " + desc, () => {
    const x = state.products.find((o) => o.id === pid)!;
    updProduct(pid, { mgp: 0, mag: x.mag + qty });
  }, pid);
  set({ screen: "product", pendingLoc: null, pickOne: false, manualOpen: false });
  flashSuccess("Zasilenie w kolejce");
}
export function scanLocation(code: string) {
  const p = cur();
  if (!p) return;
  if (p.locs.includes(code) && state.mode === "loc") {
    toast("Towar już ma lokalizację " + code);
    return;
  }
  if (p.locs.length > 1) {
    set({ pendingLoc: code, pickOne: false });
    return;
  }
  if (state.mode === "combo") finishCombo([code], "lok. " + code + " (zastąpiono)");
  else applyLoc([code], code + " (zastąpiono " + (p.locs[0] || "brak") + ")");
}
export function dialogRoute(newLocs: string[], desc: string) {
  if (state.mode === "combo") finishCombo(newLocs, desc);
  else applyLoc(newLocs, desc);
}
export function removeChip(code: string) {
  const p = cur();
  if (!p) return;
  applyLoc(p.locs.filter((l) => l !== code), "(usunięto " + code + ")");
}
export function createMM(qty: number) {
  const p = cur();
  if (!p) return;
  const pid = p.id;
  enqueue("mm", "MM MGP→MAG · " + p.sym, qty + " szt", () => {
    const x = state.products.find((o) => o.id === pid)!;
    updProduct(pid, { mgp: x.mgp - qty, mag: x.mag + qty });
  }, pid);
  set({ screen: "product" });
  flashSuccess("MM w kolejce");
}

/* ── proste settery UI ───────────────────────────────────────────────── */
export function setQuery(q: string) { set({ query: q }); }
export function setQty(q: number) {
  const p = cur();
  const max = p ? p.mgp : 1;
  set({ qty: Math.max(1, Math.min(max, q)) });
}
export function toggleChipMenu(code: string) {
  set((s) => ({ chipMenu: s.chipMenu === code ? null : code }));
}
export function closeChipMenu() { set({ chipMenu: null }); }
export function openScanLoc(mode: LocMode) {
  set({ screen: "scanLoc", mode, manualOpen: false, chipMenu: null });
}
export function openMM() {
  const p = cur();
  if (!p) return;
  if (p.mgp === 0) { toast("Brak stanu na MGP"); return; }
  set({ screen: "mm", qty: p.mgp, chipMenu: null });
}
export function setManualOpen(v: boolean) { set({ manualOpen: v }); }
export function cancelDialog() { set({ pendingLoc: null, pickOne: false }); }
export function openPickOne() { set({ pickOne: true }); }

/* ── wyszukiwarka (logika jak SELECT ze spec §5.1) ───────────────────── */
export function searchProducts(q: string): Product[] {
  const ql = q.toLowerCase();
  const isNum = /^\d{5,}$/.test(q);
  const p = state.products;
  const symM = p.filter((x) => x.sym.toLowerCase().startsWith(ql));
  const nameM = p.filter((x) => !symM.includes(x) && x.name.toLowerCase().includes(ql));
  const eanM = isNum
    ? p.filter((x) => !symM.includes(x) && !nameM.includes(x) && x.ean.includes(q))
    : [];
  return [...symM, ...nameM, ...eanM].slice(0, 20);
}

/* rozpoznanie skanu: EAN → symbol → wyszukiwarka */
export function interpretScan(code: string) {
  const c = code.trim();
  if (!c) return;
  if (/^\d{8}$|^\d{12,14}$/.test(c)) {
    const p = state.products.find((x) => x.ean === c);
    if (p) { beep(true); openProduct(p.id); return; }
    toast("Nieznany kod EAN: " + c);
    beep(false);
    return;
  }
  const bySym = state.products.find((x) => x.sym.toLowerCase() === c.toLowerCase());
  if (bySym) { beep(true); openProduct(bySym.id); return; }
  const res = searchProducts(c);
  if (res.length === 1) { openProduct(res[0].id); return; }
  set({ query: c });
}

/* ── ładowanie danych ────────────────────────────────────────────────── */
export function loadProducts() {
  fetch("data/products.json")
    .then((r) => r.json())
    .then((rows: any[][]) => {
      const products: Product[] = rows.map((r, i) => ({
        id: i + 1,
        sym: r[0],
        name: r[1],
        ean: String(r[2] || ""),
        mag: r[3],
        rez: r[4],
        mgp: r[5],
        unit: r[6] || "szt.",
        ordered: r[7] || 0,
        locs: r[8] ? String(r[8]).split(" ").filter(Boolean) : [],
        desc: r[9] || "",
      }));
      set({ products, loading: false });
    })
    .catch(() => {
      set({ loading: false });
      toast("Nie udało się wczytać bazy towarów");
    });
}

export const nowTime = now;
export const queueStatusColor = (s: QueueStatus) => s;
