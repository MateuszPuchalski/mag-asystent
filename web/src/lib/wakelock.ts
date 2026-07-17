import { getSettings, subscribeSettings } from "./settings";

/* ── Wake Lock: ekran nie gaśnie podczas pracy ──────────────────────────────
   Kolektor to urządzenie robocze — odblokowywanie między regałami to strata
   czasu. Re-acquire po powrocie karty (hot-swap baterii / uśpienie).          */

export const wakeLockAvailable = typeof navigator !== "undefined" && "wakeLock" in navigator;

let sentinel: WakeLockSentinel | null = null;

async function acquire() {
  if (!wakeLockAvailable || !getSettings().wakeLock || sentinel) return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    /* np. karta w tle — spróbujemy przy visibilitychange */
  }
}

function release() {
  void sentinel?.release();
  sentinel = null;
}

let installed = false;
export function installWakeLock() {
  if (installed || !wakeLockAvailable) return;
  installed = true;
  void acquire();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void acquire();
  });
  subscribeSettings(() => {
    if (getSettings().wakeLock) void acquire();
    else release();
  });
}
