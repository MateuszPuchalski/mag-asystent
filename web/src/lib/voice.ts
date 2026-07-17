import { getSettings } from "./settings";

/* ── Głosowe prowadzenie (TTS) ──────────────────────────────────────────────
   Magazynier słyszy dokąd iść i co się zapisało — bez patrzenia w ekran.
   Polski TTS działa offline na Androidzie (silnik Google). Feature-detected;
   wyłączany przełącznikiem `voice` w Ustawieniach.                            */

export const voiceAvailable = typeof window !== "undefined" && "speechSynthesis" in window;

export function speak(text: string) {
  if (!voiceAvailable || !getSettings().voice) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pl-PL";
  u.rate = 1.05;
  window.speechSynthesis.cancel(); // skan-po-skanie: nie kolejkuj zaległych komunikatów
  window.speechSynthesis.speak(u);
}

/** „E08-03-01" → „E 08, 03, 01" — czytelne dla TTS oznaczenie regału. */
export function spellLoc(code: string): string {
  return code
    .replace(/([A-Z]+)(\d)/g, "$1 $2")
    .replace(/-/g, ", ");
}
