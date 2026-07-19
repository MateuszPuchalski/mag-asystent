import { useSyncExternalStore } from "react";
import { api, ApiError, getUser } from "./api";
import { toast } from "./store";

/* ── Bufor operacji zapisu na czas braku sieci ──────────────────────────────
   Kolektor gubi Wi-Fi przy metalowych regałach. Zamiast tracić skan, zapisujemy
   operację (zmiana lokalizacji / MM) w localStorage i wysyłamy po odzyskaniu
   połączenia (zdarzenie `online` + okresowy flush). Serwer i tak kolejkuje przez
   worker Sfery, więc bufor to tylko warstwa transportu.                        */

type SetLocationBody = Parameters<typeof api.setLocation>[1];
type MmBody = Parameters<typeof api.mm>[0];

type Op =
  | { id: string; kind: "setLocation"; productId: number; body: SetLocationBody; at: number; user?: string }
  | { id: string; kind: "mm"; body: MmBody; at: number; user?: string };

const KEY = "wertis_offline";
let buffer: Op[] = load();
const listeners = new Set<() => void>();
let flushing = false;
let counter = 0;

function load(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function persist() {
  localStorage.setItem(KEY, JSON.stringify(buffer));
  listeners.forEach((l) => l());
}
function nextId() {
  // brak Date.now-only losowości — wystarczy monotoniczny licznik + czas
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export const offline = {
  count: () => buffer.length,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
export function useOfflineCount(): number {
  return useSyncExternalStore(offline.subscribe, offline.count);
}

/** Czy błąd to awaria sieci (a nie odpowiedź serwera 4xx/5xx). */
function isNetworkError(e: unknown): boolean {
  return !(e instanceof ApiError);
}

async function send(op: Op): Promise<{ queueId?: number }> {
  // op.user: autor operacji z chwili zbuforowania — flush może nastąpić po
  // zmianie użytkownika na wspólnym urządzeniu
  if (op.kind === "setLocation") return api.setLocation(op.productId, op.body, op.user);
  return api.mm(op.body, op.user);
}

/** Usuń operację z bufora (COFNIJ przed wysłaniem). Zwraca czy istniała. */
export function remove(bufferId: string): boolean {
  const before = buffer.length;
  buffer = buffer.filter((o) => o.id !== bufferId);
  if (buffer.length !== before) persist();
  return buffer.length !== before;
}

/** Spróbuj wysłać całą kolejkę. Przy awarii sieci — przerwij i zostaw resztę. */
export async function flush(): Promise<void> {
  if (flushing || !navigator.onLine || buffer.length === 0) return;
  flushing = true;
  try {
    while (buffer.length) {
      const op = buffer[0];
      try {
        await send(op);
        buffer = buffer.slice(1);
        persist();
      } catch (e) {
        if (isNetworkError(e)) break; // nadal offline — spróbujemy później
        // serwer odrzucił (np. zła ilość) — usuń i zgłoś, nie blokuj kolejki
        buffer = buffer.slice(1);
        persist();
        toast(`Operacja z bufora odrzucona: ${e instanceof Error ? e.message : "błąd"}`);
      }
    }
  } finally {
    flushing = false;
  }
}

export interface RunResult {
  offline: boolean;
  queueId?: number; // id zadania w kolejce Sfery (online) — do COFNIJ
  bufferId?: string; // id operacji w buforze (offline) — do COFNIJ
}

/**
 * Wykonaj operację online; przy braku sieci — zbuforuj i zwróć znacznik offline.
 * Błędy serwera (ApiError) NIE są buforowane — propagują do UI (np. walidacja).
 */
export async function runOrBuffer(
  op: Omit<Extract<Op, { kind: "setLocation" }>, "id" | "at"> | Omit<Extract<Op, { kind: "mm" }>, "id" | "at">
): Promise<RunResult> {
  if (navigator.onLine) {
    try {
      const r = await send({ ...op, id: "tmp", at: 0 } as Op);
      return { offline: false, queueId: r.queueId };
    } catch (e) {
      if (!isNetworkError(e)) throw e; // realny błąd serwera → do UI
    }
  }
  const bufferId = nextId();
  buffer = [...buffer, { ...op, id: bufferId, at: Date.now(), user: getUser() } as Op];
  persist();
  return { offline: true, bufferId };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flush());
  setInterval(() => void flush(), 15000);
  void flush(); // próba na starcie
}
