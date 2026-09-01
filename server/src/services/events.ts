import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { currentDevice, currentUserRef } from "../context.js";

/**
 * Log zdarzeń — audyt każdego skanu i decyzji (spec §7, §12).
 *
 * `device_id` dochodzi z kontekstu żądania, nie z parametru: przeciąganie go
 * przez wszystkie warstwy usług kosztowałoby więcej, niż wnosi pole
 * diagnostyczne. Poza żądaniem (worker) jest `null` i to jest poprawne.
 */
export function logEvent(
  type: string,
  userId: string,
  twId: number | null = null,
  payload: unknown = null,
  /**
   * Konto autora, gdy NIE jest nim właściciel bieżącej sesji — operacja
   * z bufora offline wykonana przed zmianą zmiany (patrz `autorOperacji`).
   * `undefined` = zwykła ścieżka, konto bierzemy z sesji.
   */
  userRef?: number | null,
  /**
   * Baza, do której idzie wpis. Domyślnie globalna — ale serwisy rozmów
   * przyjmują bazę parametrem, żeby ich testy stały na bazie w pamięci.
   * Bez tego audyt mutacji rozmowy pisałby gdzie indziej niż sama mutacja,
   * czyli poza transakcją, która ją obejmuje.
   */
  database: DatabaseSync = db()
): void {
  database
    .prepare(
      "INSERT INTO events(type, tw_id, payload, user_id, device_id, user_ref) VALUES (?,?,?,?,?,?)"
    )
    .run(
      type,
      twId,
      payload == null ? null : JSON.stringify(payload),
      userId,
      currentDevice(),
      userRef === undefined ? currentUserRef() : userRef
    );
}

export interface MovementEntry {
  type: string;
  user: string;
  at: string;
  detail: string;
}

/** Historia ruchów lokalizacji/MM danego towaru (dla karty na kolektorze). */
export function productHistory(twId: number, limit = 20): MovementEntry[] {
  const rows = db()
    .prepare(
      `SELECT type, user_id, payload, created_at FROM events
       WHERE tw_id = ? AND type IN ('location_set','location_removed','mm_queued')
       ORDER BY id DESC LIMIT ?`
    )
    .all(twId, limit) as Array<{ type: string; user_id: string; payload: string | null; created_at: string }>;
  return rows.map((r) => {
    let p: any = {};
    try {
      p = r.payload ? JSON.parse(r.payload) : {};
    } catch {
      /* uszkodzony payload */
    }
    let detail = "";
    if (r.type === "location_set") {
      /* Para „przed → po" mówi więcej niż sama nowa wartość: przy reklamacji
         pytanie brzmi, co z pola ZNIKNĘŁO, a nie co w nim jest teraz.

         `locsPrzed` doszło w sierpniu 2026 i STARE WIERSZE GO NIE MAJĄ — dlatego
         formatowanie schodzi wtedy do dotychczasowego. Historia sprzed zmiany
         musi się dalej wyświetlać, a nie znikać ani wywracać ekranu. */
      if (p.locsPrzed != null && p.result) detail = `${p.locsPrzed || "(puste)"} → ${p.result}`;
      else if (p.result) detail = `→ ${p.result}`;
      else detail = `${p.action ?? ""} ${p.value ?? ""}`.trim();
      // źródło zmiany: bez tego wpis z rozkładania jest nieodróżnialny od karty
      if (p.zrodlo && p.zrodlo !== "karta") detail += ` (${p.zrodlo})`;
    } else if (r.type === "location_removed") detail = `usunięto ${p.value ?? ""}`.trim();
    // mm_queued zostaje tylko dla historycznych wpisów (route /api/mm usunięty)
    else if (r.type === "mm_queued") detail = "MM MGP→MAG";
    return { type: r.type, user: r.user_id, at: r.created_at, detail };
  });
}
