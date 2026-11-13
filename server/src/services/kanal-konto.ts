import type { Db } from "../db/db.js";

/* ── Konto kanału — jedna funkcja dla wszystkich synchronizatorów ────────────
   Skrzynka i zwroty potrzebują tego samego wiersza `channel_account`. Druga
   kopia tej funkcji rozjechałaby się przy pierwszej zmianie klucza konta —
   wtedy rozmowy i zwroty tego samego sprzedawcy wylądowałyby na dwóch
   kontach i nic by tego nie zgłosiło.                                       */

/**
 * Wiersz `channel_account` dla konta Allegro; tworzy go, gdy go nie ma.
 *
 * Puste `externalAccountId` (konto niesparowane, testy) dostaje etykietę
 * `domyslne` — klucz naturalny nie może być pusty, a brak parowania nie ma
 * prawa wywalić synchronizatora na kluczu.
 */
export function kontoKanalu(database: Db, externalAccountId: string): number {
  const id = externalAccountId || "domyslne";
  database.prepare(`INSERT INTO channel_account(channel, external_account_id)
    VALUES ('allegro', ?) ON CONFLICT(channel, external_account_id) DO NOTHING`).run(id);
  return Number((database.prepare(
    "SELECT id FROM channel_account WHERE channel='allegro' AND external_account_id=?",
  ).get(id) as { id: number }).id);
}
