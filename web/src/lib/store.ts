import { useSyncExternalStore } from "react";

/* ── Store WYŁĄCZNIE stanu UI (nawigacja, tryb, feedback). ────────────────
   Dane (towary, kolejka, sesje) pochodzą z serwera przez TanStack Query —
   tu nie ma już żadnej symulacji ani mutacji danych.                        */

export type Screen =
  | "splash"
  | "home"
  | "product"
  | "scanLoc"
  | "mm"
  | "queue"
  | "putawayDocs"
  | "putawaySession";
export type LocMode = "loc" | "combo";

export interface RecentEntry {
  id: number;
  sym: string;
  loc: string;
}

interface UiState {
  screen: Screen;
  curId: number | null;
  mode: LocMode;
  chipMenu: string | null;
  manualOpen: boolean;
  recent: RecentEntry[];
  sessionId: number | null;
  toast: string | null;
  success: string | null;
}

const initialRecent: RecentEntry[] = JSON.parse(localStorage.getItem("wertis_recent") || "[]");

let state: UiState = {
  screen: "splash",
  curId: null,
  mode: "loc",
  chipMenu: null,
  manualOpen: false,
  recent: initialRecent,
  sessionId: null,
  toast: null,
  success: null,
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function set(patch: Partial<UiState>) {
  state = { ...state, ...patch };
  emit();
}

export const store = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
export function useUi<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}

/* ── nawigacja ───────────────────────────────────────────────────────── */
const BACK: Partial<Record<Screen, Screen>> = {
  product: "home",
  scanLoc: "product",
  mm: "product",
  putawaySession: "putawayDocs",
};
export const backTarget = (s: Screen) => BACK[s];
export function go(screen: Screen) {
  set({ screen });
}
export function goBack() {
  set({ screen: BACK[state.screen] || "home", chipMenu: null, manualOpen: false });
}

export function openProduct(id: number, meta?: { sym: string; loc: string }) {
  let recent = state.recent;
  if (meta) {
    recent = [{ id, sym: meta.sym, loc: meta.loc }, ...state.recent.filter((r) => r.id !== id)].slice(0, 4);
    localStorage.setItem("wertis_recent", JSON.stringify(recent));
  }
  set({ screen: "product", curId: id, chipMenu: null, recent });
}
export function openScanLoc(mode: LocMode) {
  set({ screen: "scanLoc", mode, manualOpen: false, chipMenu: null });
}
export function openMM() {
  set({ screen: "mm", chipMenu: null });
}
export function openSession(sessionId: number) {
  set({ screen: "putawaySession", sessionId });
}
export function setChipMenu(code: string | null) {
  set({ chipMenu: state.chipMenu === code ? null : code });
}
export function setManualOpen(v: boolean) {
  set({ manualOpen: v });
}

/* ── feedback (toast / sukces) ───────────────────────────────────────── */
let toastT: ReturnType<typeof setTimeout>;
let succT: ReturnType<typeof setTimeout>;
export function toast(msg: string) {
  clearTimeout(toastT);
  set({ toast: msg });
  toastT = setTimeout(() => set({ toast: null }), 2600);
}
export function flashSuccess(msg: string) {
  clearTimeout(succT);
  set({ success: msg });
  succT = setTimeout(() => set({ success: null }), 1500);
}
