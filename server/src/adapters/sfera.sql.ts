import sql from "mssql";
import { db } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
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
    const pool = await mssqlPool();
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
   * Flaga sprawdzenia faktury. NIE jest kolumną `dok__Dokument` — InsERT trzyma
   * flagi w osobnej parze tabel: `fl__Flagi` (definicja: `flg_Id`, `flg_Text`,
   * `flg_Numer` = ikona) i `fl_Wartosc` (przypisanie do obiektu). Klucz główny
   * `fl_Wartosc` jest złożony: (`flw_IdGrupyFlag`, `flw_TypObiektu`,
   * `flw_IdObiektu`) — jeden obiekt ma najwyżej jedną flagę w grupie, więc zapis
   * to MERGE: podmień, jeśli już jest, wstaw, jeśli nie.
   *
   * To zawężenie, nie rozszerzenie uprawnień: aplikacja przestaje potrzebować
   * jakiegokolwiek UPDATE na tabeli dokumentów. `fl_Wartosc` nie uczestniczy
   * w numeracji ani w skutkach magazynowych, więc zapis tutaj nie może naruszyć
   * integralności dokumentu — inaczej niż UPDATE w `dok__Dokument`.
   *
   * [WERYFIKUJ] para (grupa flag, typ obiektu) — jedyne, czego nie da się
   * odczytać z dokumentacji struktury; jeden SELECT na własnej bazie (DEPLOY §6).
   */
  async applyDocFlag(dokId: number, wartosc: string, klucz: string): Promise<void> {
    const { flagGrupa, flagTypObiektu } = config.mssql;
    if (!flagGrupa || !flagTypObiektu) {
      throw new Error(
        "Nie ustawiono MSSQL_FLAG_GRUPA / MSSQL_FLAG_TYP_OBIEKTU — nie wiadomo, " +
          "w której grupie flag `fl_Wartosc` siedzą flagi faktur zakupu. Ustal je " +
          "jednym SELECT-em na własnej bazie (DEPLOY §6) i uzupełnij env."
      );
    }
    if (!/^\d+$/.test(wartosc)) {
      throw new Error(
        `Wartość flagi „${klucz}" musi być liczbą (flg_Id z fl__Flagi), a jest „${wartosc}". ` +
          "Ustaw DOC_FLAG_*_SGT na identyfikatory flag z własnej bazy."
      );
    }
    const pool = await mssqlPool();
    const res = await pool
      .request()
      .input("grupa", sql.Int, Math.trunc(flagGrupa))
      .input("typ", sql.Int, Math.trunc(flagTypObiektu))
      .input("id", sql.Int, dokId)
      .input("flaga", sql.Int, Number(wartosc))
      .query(
        `MERGE fl_Wartosc AS t
         USING (SELECT @grupa AS g, @typ AS t, @id AS o) AS s
            ON t.flw_IdGrupyFlag = s.g AND t.flw_TypObiektu = s.t AND t.flw_IdObiektu = s.o
         WHEN MATCHED THEN
           UPDATE SET flw_IdFlagi = @flaga, flw_CzasOstatniejZmiany = GETDATE()
         WHEN NOT MATCHED THEN
           INSERT (flw_IdGrupyFlag, flw_TypObiektu, flw_IdObiektu, flw_IdFlagi, flw_CzasOstatniejZmiany)
           VALUES (@grupa, @typ, @id, @flaga, GETDATE());`
      );
    if (!res.rowsAffected[0]) {
      throw new Error(`Nie udało się zapisać flagi dokumentu dok_Id=${dokId}`);
    }
    db().prepare("UPDATE sgt_dokument SET flaga = ? WHERE dok_id = ?").run(wartosc, dokId);
  }

  async createMM(_magFrom: number, _magTo: number, _items: MmItem[]): Promise<string> {
    // MM nie da się bezpiecznie zrobić SQL-em (dokument + numeracja + skutki
    // magazynowe to domena Sfery). Docelowo tworzy je osobny worker Sfery (COM)
    // na Windows, czytający tę samą tabelę sfera_queue — kontrakt w
    // adapters/sfera.ts. Zadanie zostaje w kolejce ze statusem 'error' i PONÓW.
    throw new Error(
      "Dokument MM tworzy worker Sfery (osobny proces COM na Windows — kontrakt w adapters/sfera.ts). " +
        "Do czasu jego wdrożenia MM wystawia biuro w Subiekcie; lokalizacje i flagi działają normalnie."
    );
  }
}
