import { useEffect, useRef } from "react";

/* ── Globalny router skanów ─────────────────────────────────────────────────
   Skaner kolektora to klawiatura: znaki + Enter. Jeden nasłuch na document
   zbiera wejście, gdy fokus NIE jest w polu tekstowym (pola obsługują Enter
   same), klasyfikuje kod (EAN / etykieta lokalizacji / tekst) i oddaje go
   aktywnemu ekranowi. Ekran rejestruje handler przez useScanHandler; zwrot
   false = przekaż niżej, aż do fallbacku (App: EAN→karta, LOC→zawartość). */

export type ScanKind = "ean" | "loc" | "text";
export interface Scan {
  code: string;
  kind: ScanKind;
}
/** true = skan obsłużony; false = przekaż do następnego handlera/fallbacku. */
export type ScanHandler = (scan: Scan) => boolean;

const EAN_RE = /^\d{8}$|^\d{12,14}$/;
export const LOC_PREFIX = (import.meta.env.VITE_SCAN_LOC_PREFIX ?? "LOC:") as string;
/** Przerwa między znakami większa niż to = nowy skan (skaner wpisuje <50 ms/znak). */
const GAP_MS = 300;
const MIN_LEN = 3;

/** Klasyfikacja zeskanowanego kodu. Prefiks LOC: rozstrzyga jednoznacznie. */
export function classify(raw: string): Scan {
  const trimmed = raw.trim();
  const up = trimmed.toUpperCase();
  if (LOC_PREFIX && up.startsWith(LOC_PREFIX.toUpperCase())) {
    return { code: up.slice(LOC_PREFIX.length), kind: "loc" };
  }
  if (EAN_RE.test(trimmed)) return { code: trimmed, kind: "ean" };
  if (/[A-Z]/.test(up) && !/\s/.test(up) && !/^\d+$/.test(up)) return { code: up, kind: "loc" };
  return { code: trimmed, kind: "text" };
}

const handlers: ScanHandler[] = []; // stos — ostatnio zarejestrowany ekran ma pierwszeństwo
let fallback: ScanHandler | null = null;

export function setFallbackScanHandler(h: ScanHandler) {
  fallback = h;
}

/** Wyślij skan do aktywnych handlerów (używane też przez kafle DEV). */
export function dispatchScan(scan: Scan) {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i](scan)) return;
  }
  fallback?.(scan);
}

/** Rejestracja handlera skanów na czas życia ekranu. */
export function useScanHandler(handler: ScanHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h: ScanHandler = (s) => ref.current(s);
    handlers.push(h);
    return () => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, []);
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

let installed = false;
export function installScanListener() {
  if (installed) return;
  installed = true;
  let buf = "";
  let last = 0;
  window.addEventListener("keydown", (e) => {
    if (isEditable(document.activeElement)) return; // pole samo obsłuży Enter
    const now = performance.now();
    if (now - last > GAP_MS) buf = "";
    last = now;
    if (e.key === "Enter") {
      const code = buf;
      buf = "";
      if (code.length >= MIN_LEN) {
        e.preventDefault();
        dispatchScan(classify(code));
      }
      return;
    }
    if (e.key.length === 1) buf += e.key;
  });
}
