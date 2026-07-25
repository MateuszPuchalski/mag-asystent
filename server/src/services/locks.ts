/* ── Blokady pozycji z TTL ───────────────────────────────────────────────────
   Przy natłoku dostaw jedną dostawę rozkłada kilka osób naraz. Lock na pozycji
   chroni przed dwukrotnym odłożeniem tego samego towaru, ale MUSI wygasać:
   magazynier odchodzi od wózka, gubi zasięg, kończy zmianę — pozycja
   zablokowana na zawsze byłaby gorsza od braku blokady.

   Ten sam mechanizm świeżości (TTL) służy do drugiej rzeczy: odróżnienia
   „ktoś pracuje TERAZ" od „leży zaczęte", na czym opiera się flaga
   „W trakcie sprawdzania" vs „Do sprawdzenia z zapisanym postępem"
   (patrz services/delivery-flag.ts).                                          */

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
