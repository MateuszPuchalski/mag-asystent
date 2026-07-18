import sql from "mssql";
import { db } from "../db/db.js";
import { mssqlWrite, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
import type { MmItem, SferaAdapter } from "./sfera.js";

/**
 * Zapis „plan B" ze spec §9 — bezpośredni UPDATE w bazie MSSQL Subiekta GT,
 * bez Sfery. Przeznaczony dla wersji edu (brak licencji Sfery) i jako
 * awaryjna ścieżka produkcyjna dla samej lokalizacji:
 *  • set_location → UPDATE tw__Towar SET <MSSQL_LOC_COLUMN>=@v WHERE tw_Id=@id
 *    osobnym loginem z GRANT UPDATE wyłącznie na tę kolumnę. Nowsze SGT nie
 *    mają natywnego tw_Lokalizacja — kolumna to jedno z pól dodatkowych
 *    tw_Pole1..8 (env MSSQL_LOC_COLUMN, domyślnie tw_Pole1) — patrz
 *    docs/subiekt-gt-edu-setup.md.
 *  • MM — NIE do zrobienia bezpiecznie po SQL (dokument + numeracja + skutki
 *    magazynowe to domena Sfery) → twardy błąd; zadanie ląduje w statusie
 *    'error' z czytelnym komunikatem.
 * Po udanym UPDATE lustrzana zmiana w lokalnym sgt_towar, żeby UI widział
 * nową lokalizację od razu, nie dopiero po następnym imporcie.
 */
export class SqlSferaAdapter implements SferaAdapter {
  async applySetLocation(twId: number, newValue: string): Promise<void> {
    const locCol = assertSafeColumn(config.mssql.locColumn);
    const pool = await mssqlWrite();
    const res = await pool
      .request()
      .input("id", sql.Int, twId)
      .input("v", sql.NVarChar, newValue)
      .query(`UPDATE tw__Towar SET ${locCol} = @v WHERE tw_Id = @id`);
    if (!res.rowsAffected[0]) {
      throw new Error(`Nie znaleziono towaru tw_Id=${twId} w bazie Subiekta`);
    }
    db().prepare("UPDATE sgt_towar SET lokalizacja = ? WHERE tw_id = ?").run(newValue, twId);
  }

  async createMM(_magFrom: number, _magTo: number, _items: MmItem[]): Promise<string> {
    throw new Error(
      "Dokument MM wymaga Sfery (COM) — niedostępne w trybie SQL / wersji edu. " +
        "Lokalizacje (set_location) działają; MM włącz po dokupieniu Sfery (SFERA_MODE=com)."
    );
  }
}
