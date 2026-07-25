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

  /**
   * Flaga sprawdzenia faktury tą samą drogą co lokalizacja: jedna kolumna,
   * osobny login, `GRANT UPDATE` wyłącznie na nią.
   *
   * [WERYFIKUJ] `MSSQL_DOC_FLAG_COLUMN` — nie ustaliliśmy, gdzie firma trzyma tę
   * flagę (wbudowana flaga dokumentu / pole własne / słownik). Dopóki kolumna nie
   * jest ustawiona, zadanie kończy się czytelnym błędem zamiast pisać na oślep
   * w losową kolumnę tabeli dokumentów.
   */
  async applyDocFlag(dokId: number, wartosc: string, klucz: string): Promise<void> {
    if (!config.mssql.docFlagColumn) {
      throw new Error(
        "Nie ustawiono MSSQL_DOC_FLAG_COLUMN — nie wiadomo, w której kolumnie " +
          "dok__Dokument siedzi flaga sprawdzenia. Ustal ją na własnej bazie " +
          "(docs/subiekt-gt-edu-setup.md) i uzupełnij env."
      );
    }
    if (!wartosc) {
      throw new Error(
        `Brak wartości SGT dla flagi „${klucz}" — ustaw DOC_FLAG_*_SGT. ` +
          "Flagi wbudowane Subiekta są identyfikowane liczbą, nie nazwą."
      );
    }
    const col = assertSafeColumn(config.mssql.docFlagColumn);
    const pool = await mssqlWrite();
    const res = await pool
      .request()
      .input("id", sql.Int, dokId)
      // typ dobieramy do wartości: flagi wbudowane to liczba, pole własne — tekst
      .input("v", /^\d+$/.test(wartosc) ? sql.Int : sql.NVarChar, /^\d+$/.test(wartosc) ? Number(wartosc) : wartosc)
      .query(`UPDATE dok__Dokument SET ${col} = @v WHERE dok_Id = @id`);
    if (!res.rowsAffected[0]) {
      throw new Error(`Nie znaleziono dokumentu dok_Id=${dokId} w bazie Subiekta`);
    }
    db().prepare("UPDATE sgt_dokument SET flaga = ? WHERE dok_id = ?").run(wartosc, dokId);
  }

  async createMM(_magFrom: number, _magTo: number, _items: MmItem[]): Promise<string> {
    throw new Error(
      "Dokument MM wymaga Sfery (COM) — niedostępne w trybie SQL / wersji edu. " +
        "Lokalizacje (set_location) działają; MM włącz po dokupieniu Sfery (SFERA_MODE=com)."
    );
  }
}
