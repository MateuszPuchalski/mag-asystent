import { db, nextMmNumber } from "../db/db.js";
import type { MmItem, SferaAdapter } from "./sfera.js";

/**
 * DEV — „zapis Sfery" realizowany jako mutacja tabel sgt_* (SQLite).
 * Odwzorowuje efekt, który w produkcji wykonałaby Sfera na bazie Subiekta:
 *  • set_location → UPDATE sgt_towar.lokalizacja,
 *  • MM → przesunięcie stanu magFrom→magTo + nadanie numeru dokumentu MM.
 * Dzięki temu cały przepływ jest realny end-to-end w tym środowisku.
 */
export class DevSferaAdapter implements SferaAdapter {
  async applySetLocation(twId: number, newValue: string): Promise<void> {
    const res = db()
      .prepare("UPDATE sgt_towar SET lokalizacja = ? WHERE tw_id = ?")
      .run(newValue, twId);
    if (res.changes === 0) throw new Error(`Nie znaleziono towaru tw_id=${twId}`);
  }

  async createMM(magFrom: number, magTo: number, items: MmItem[]): Promise<string> {
    const d = db();
    const tx = d.transaction(() => {
      for (const it of items) {
        const from = d
          .prepare("SELECT stan FROM sgt_stan WHERE tw_id = ? AND mag_id = ?")
          .get(it.twId, magFrom) as { stan: number } | undefined;
        if (!from) throw new Error(`Brak stanu źródłowego tw_id=${it.twId}`);
        if (from.stan < it.qty) {
          throw new Error(`Za mało w magazynie źródłowym dla tw_id=${it.twId}: ${from.stan} < ${it.qty}`);
        }
        d.prepare("UPDATE sgt_stan SET stan = stan - ? WHERE tw_id = ? AND mag_id = ?")
          .run(it.qty, it.twId, magFrom);
        // upsert stanu docelowego
        const to = d
          .prepare("SELECT stan FROM sgt_stan WHERE tw_id = ? AND mag_id = ?")
          .get(it.twId, magTo);
        if (to) {
          d.prepare("UPDATE sgt_stan SET stan = stan + ? WHERE tw_id = ? AND mag_id = ?")
            .run(it.qty, it.twId, magTo);
        } else {
          d.prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,0)")
            .run(it.twId, magTo, it.qty);
        }
      }
    });
    tx();
    return nextMmNumber();
  }
}
