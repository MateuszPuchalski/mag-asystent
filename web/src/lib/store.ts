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
  | "putawaySession"
  | "location";

export interface RecentEntry {
  id: number;
  sym: string;
  loc: string;
}

/** Pasek COFNIJ po auto-zapisie: queueId (online) lub bufferId (offline). */
export interface UndoInfo {
  msg: string;
  queueId?: number;
  bufferId?: string;
  warn?: string;
}

interface UiState {
  screen: Screen;
  curId: number | null;
  chipMenu: string | null;
  manualOpen: boolean;
  recent: RecentEntry[];
  sessionId: number | null;
  locCode: string | null; // podgląd zawartości lokalizacji
  queueReturn: Screen | null; // ekran, z którego otwarto kolejkę (powrót)
  toast: string | null;
  success: string | null;
  undo: UndoInfo | null;
}

const initialRecent: RecentEntry[] = JSON.parse(localStorage.getItem("wertis_recent") || "[]");

let state: UiState = {
  screen: "splash",
  curId: null,
  chipMenu: null,
  manualOpen: false,
  recent: initialRecent,
  sessionId: null,
  locCode: null,
  queueReturn: null,
  toast: null,
  success: null,
  undo: null,
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
  location: "home",
};
export const backTarget = (s: Screen): Screen | undefined =>
  s === "queue" ? state.queueReturn ?? "home" : BACK[s];
export function go(screen: Screen) {
  set({ screen });
}
export function goBack() {
  set({ screen: backTarget(state.screen) || "home", chipMenu: null, manualOpen: false });
}

/** Otwarcie kolejki Sfery z zapamiętaniem ekranu powrotu (pastylka statusu). */
export function openQueue() {
  if (state.screen === "queue") return;
  set({ screen: "queue", queueReturn: state.screen, chipMenu: null, manualOpen: false });
}

export function openProduct(id: number, meta?: { sym: string; loc: string }) {
  let recent = state.recent;
  if (meta) {
    recent = [{ id, sym: meta.sym, loc: meta.loc }, ...state.recent.filter((r) => r.id !== id)].slice(0, 4);
    localStorage.setItem("wertis_recent", JSON.stringify(recent));
  }
  set({ screen: "product", curId: id, chipMenu: null, recent });
}
export function openScanLoc() {
  set({ screen: "scanLoc", manualOpen: false, chipMenu: null });
}
export function openMM() {
  set({ screen: "mm", chipMenu: null });
}
export function openSession(sessionId: number) {
  set({ screen: "putawaySession", sessionId });
}
export function openLocation(code: string) {
  set({ screen: "location", locCode: code.trim().toUpperCase(), chipMenu: null });
}
export function setChipMenu(code: string | null) {
  set({ chipMenu: state.chipMenu === code ? null : code });
}
export function setManualOpen(v: boolean) {
  set({ manualOpen: v });
}

/* ── feedback (toast / sukces / undo) ────────────────────────────────── */
let toastT: ReturnType<typeof setTimeout>;
let succT: ReturnType<typeof setTimeout>;
let undoT: ReturnType<typeof setTimeout>;
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
/** Auto-zapis z możliwością cofnięcia — pasek znika po oknie karencji. */
export function showUndo(info: UndoInfo) {
  clearTimeout(undoT);
  set({ undo: info });
  undoT = setTimeout(() => set({ undo: null }), 6000);
}
export function hideUndo() {
  clearTimeout(undoT);
  set({ undo: null });
}
