import { useEffect, useRef } from "react";

/* ── Komendy głosowe: parser + dispatcher ───────────────────────────────────
   Parser jest czystym TS (testowalny bez przeglądarki): normalizacja PL,
   liczebniki słownie 1–999, dopasowanie do słownika synonimów z tolerancją
   literówek (Levenshtein ≤ 2 — Whisper-tiny bywa niedokładny po polsku).
   Dispatcher — wzorzec stosu handlerów jak w lib/scanner.ts: ekran obsługuje
   swoje komendy, reszta spada do fallbacku globalnego (App).                 */

export type CommandKind = "undo" | "back" | "queue" | "stock" | "skip" | "qty";
export interface Command {
  kind: CommandKind;
  value?: number;
}
/** true = obsłużone; false = przekaż niżej. */
export type CommandHandler = (cmd: Command) => boolean;

const PL_DIACRITICS: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => PL_DIACRITICS[c] ?? c)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Odległość Levenshteina (małe słowa — prosta implementacja wystarcza). */
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

/** Tolerancja zależna od długości słowa (krótkie muszą pasować dokładniej). */
function fuzzyEq(word: string, target: string): boolean {
  const tol = target.length <= 4 ? 0 : target.length <= 6 ? 1 : 2;
  return lev(word, target) <= tol;
}

/* liczebniki polskie (po normalizacji, bez diakrytyków) */
const UNITS: Record<string, number> = {
  zero: 0, jeden: 1, jedna: 1, dwa: 2, dwie: 2, trzy: 3, cztery: 4, piec: 5,
  szesc: 6, siedem: 7, osiem: 8, dziewiec: 9,
};
const TEENS: Record<string, number> = {
  dziesiec: 10, jedenascie: 11, dwanascie: 12, trzynascie: 13, czternascie: 14,
  pietnascie: 15, szesnascie: 16, siedemnascie: 17, osiemnascie: 18, dziewietnascie: 19,
};
const TENS: Record<string, number> = {
  dwadziescia: 20, trzydziesci: 30, czterdziesci: 40, piecdziesiat: 50,
  szescdziesiat: 60, siedemdziesiat: 70, osiemdziesiat: 80, dziewiecdziesiat: 90,
};
const HUNDREDS: Record<string, number> = {
  sto: 100, dwiescie: 200, trzysta: 300, czterysta: 400, piecset: 500,
  szescset: 600, siedemset: 700, osiemset: 800, dziewiecset: 900,
};

function matchIn(word: string, dict: Record<string, number>): number | null {
  for (const [k, v] of Object.entries(dict)) if (fuzzyEq(word, k)) return v;
  return null;
}

/** Liczba z tekstu: cyfry („23") lub słownie („dwadzieścia trzy"), 0–999. */
export function parsePolishNumber(text: string): number | null {
  const words = normalize(text).split(" ").filter(Boolean);
  const digits = words.find((w) => /^\d{1,3}$/.test(w));
  if (digits) return Number(digits);

  let total = 0;
  let found = false;
  for (const w of words) {
    const h = matchIn(w, HUNDREDS);
    if (h != null) { total += h; found = true; continue; }
    const t = matchIn(w, TEENS);
    if (t != null) { total += t; found = true; continue; }
    const d = matchIn(w, TENS);
    if (d != null) { total += d; found = true; continue; }
    const u = matchIn(w, UNITS);
    if (u != null) { total += u; found = true; continue; }
  }
  return found ? total : null;
}

/* słownik komend: kind → synonimy (po normalizacji) */
const VERBS: Array<{ kind: CommandKind; words: string[] }> = [
  { kind: "undo", words: ["cofnij", "cofniecie", "anuluj", "wycofaj"] },
  { kind: "back", words: ["wroc", "zamknij", "wstecz", "powrot"] },
  { kind: "queue", words: ["kolejka", "zadania"] },
  { kind: "stock", words: ["stan", "stany", "ile"] },
  { kind: "skip", words: ["pomin", "dalej", "nastepny", "nastepna"] },
];

/** Transkrypt → komenda. Liczba bez czasownika = ustawienie ilości. */
export function parseCommand(transcript: string): Command | null {
  const text = normalize(transcript);
  if (!text) return null;
  const words = text.split(" ");

  for (const v of VERBS) {
    for (const w of words) {
      for (const t of v.words) {
        if (fuzzyEq(w, t)) return { kind: v.kind };
      }
    }
  }
  const n = parsePolishNumber(text);
  if (n != null && n > 0) return { kind: "qty", value: n };
  return null;
}

/* ── dispatcher (stos handlerów per ekran + fallback globalny) ──────────── */
const handlers: CommandHandler[] = [];
let fallback: CommandHandler | null = null;

export function setFallbackCommandHandler(h: CommandHandler) {
  fallback = h;
}

export function dispatchCommand(cmd: Command): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i](cmd)) return true;
  }
  return fallback?.(cmd) ?? false;
}

export function useCommandHandler(handler: CommandHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h: CommandHandler = (c) => ref.current(c);
    handlers.push(h);
    return () => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, []);
}
