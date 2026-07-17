import { api } from "./api";
import { getSettings } from "./settings";
import { store } from "./store";
import { performUndo } from "./undo";

/* ── Akcelerometr ───────────────────────────────────────────────────────────
   1. Shake-to-COFNIJ: potrząśnięcie cofa ostatni auto-zapis — aktywne TYLKO
      gdy widoczny jest pasek COFNIJ (okno karencji), więc ruch przy chodzeniu
      i odkładaniu urządzenia niczego nie psuje.
   2. Log upadków: swobodne spadanie + uderzenie → wpis audytowy device_drop
      (serwis widzi, który kolektor obrywa).                                   */

const SHAKE_MAG = 25; // m/s² — energiczne potrząśnięcie
const SHAKE_SAMPLES = 3;
const SHAKE_WINDOW_MS = 400;
const SHAKE_DEBOUNCE_MS = 1500;

const FREEFALL_MAG = 3; // m/s² — blisko zera podczas spadania
const FREEFALL_MIN_MS = 250;
const IMPACT_MAG = 30;
const DROP_DEBOUNCE_MS = 5000;

let installed = false;

export function installMotion() {
  if (installed || typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;
  installed = true;

  let spikes: number[] = [];
  let lastShake = 0;
  let freefallStart: number | null = null;
  let lastDrop = 0;

  window.addEventListener("devicemotion", (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const mag = Math.hypot(a.x, a.y, a.z);
    const now = performance.now();
    const s = getSettings();

    // shake → COFNIJ (tylko w oknie karencji)
    if (s.shakeUndo && mag > SHAKE_MAG) {
      spikes = [...spikes.filter((t) => now - t < SHAKE_WINDOW_MS), now];
      if (
        spikes.length >= SHAKE_SAMPLES &&
        now - lastShake > SHAKE_DEBOUNCE_MS &&
        store.getState().undo
      ) {
        lastShake = now;
        spikes = [];
        void performUndo();
      }
    }

    // swobodne spadanie → uderzenie = upadek urządzenia
    if (s.dropLog) {
      if (mag < FREEFALL_MAG) {
        freefallStart ??= now;
      } else {
        if (
          freefallStart != null &&
          now - freefallStart > FREEFALL_MIN_MS &&
          mag > IMPACT_MAG &&
          now - lastDrop > DROP_DEBOUNCE_MS
        ) {
          lastDrop = now;
          void api.deviceEvent({ type: "device_drop", fallMs: Math.round(now - freefallStart) }).catch(() => {});
        }
        freefallStart = null;
      }
    }
  });
}
