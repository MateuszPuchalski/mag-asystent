/* ── Blokady pozycji z TTL ───────────────────────────────────────────────────
   Przy natłoku dostaw jedną dostawę rozkłada kilka osób naraz. Lock na pozycji
   chroni przed dwukrotnym odłożeniem tego samego towaru, ale MUSI wygasać:
   magazynier odchodzi od wózka, gubi zasięg, kończy zmianę — pozycja
   zablokowana na zawsze byłaby gorsza od braku blokady.

   Świeżość (TTL) mówi też, czy ktoś pracuje przy dostawie TERAZ — na tym
   opiera się pokazanie „zajęte przez Annę" zamiast pustego wiersza.           */

/** Po tym czasie pozycja wraca do puli, nawet jeśli nikt jej nie zwolnił. */
export const LOCK_TTL_MS = 30 * 60 * 1000;

/** Czy znacznik czasu mieści się jeszcze w oknie TTL. */
export function isFresh(at: string | null | undefined, now: number = Date.now()): boolean {
  if (!at) return false;
  const t = Date.parse(at);
  return !Number.isNaN(t) && now - t < LOCK_TTL_MS;
}

/**
 * Kto trzyma pozycję, albo `null` gdy lock wygasł/nie istnieje.
 * Czas podajemy z zewnątrz w testach, żeby nie sterować zegarem systemowym.
 */
export function freshLock(
  lockedBy: string | null | undefined,
  lockedAt: string | null | undefined,
  now: number = Date.now()
): string | null {
  if (!lockedBy) return null;
  return isFresh(lockedAt, now) ? lockedBy : null;
}

/** Czy lock blokuje TEGO użytkownika (własny lock nigdy nie przeszkadza). */
export function lockedByOther(
  lockedBy: string | null | undefined,
  lockedAt: string | null | undefined,
  user: string,
  now: number = Date.now()
): string | null {
  const holder = freshLock(lockedBy, lockedAt, now);
  return holder && holder !== user ? holder : null;
}
