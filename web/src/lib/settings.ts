import { useSyncExternalStore } from "react";

/* ── Przełączniki funkcji urządzenia (Ustawienia) ───────────────────────────
   Jeden magazyn na localStorage. Funkcje sensorowe (głos, wake lock, shake,
   kamera…) czytają stan na bieżąco — wyłączenie działa natychmiast.          */

export interface Settings {
  voice: boolean; // głosowe prowadzenie (TTS)
  voiceCommands: boolean; // komendy głosowe (ASR offline, Whisper on-device)
  wakeLock: boolean; // ekran nie gaśnie podczas pracy
  shakeUndo: boolean; // potrząśnięcie = COFNIJ (w oknie karencji)
  dropLog: boolean; // log upadków urządzenia do audytu
  walkMode: boolean; // nakładka NASTĘPNE po zatwierdzeniu wózka
  batteryAssist: boolean; // podpowiedź hot-swap przy niskiej baterii
  cameraScan: boolean; // kamera jako skaner awaryjny
}

const KEY = "wertis_settings";
const DEFAULTS: Settings = {
  voice: true,
  voiceCommands: false, // opt-in: pierwsze użycie pobiera ~40 MB modelu
  wakeLock: true,
  shakeUndo: true,
  dropLog: true,
  walkMode: true,
  batteryAssist: true,
  cameraScan: true,
};

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

let state: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return state;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  state = { ...state, [key]: value };
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

export function subscribeSettings(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
