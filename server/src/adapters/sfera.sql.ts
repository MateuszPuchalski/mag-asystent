import sql from "mssql";
import { db } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
import type { MmItem, SferaAdapter } from "./sfera.js";

/**
 * Zapis „plan B" ze spec §9 — bezpośredni UPDATE w bazie MSSQL Subiekta GT,
 * bez Sfery. Przeznaczony dla wersji edu (brak licencji Sfery) i jako
 * awaryjna ścieżka produkcyjna dla lokalizacji — jedynego pola, które ten
 * proces w bazie firmy zmienia:
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
   * Kod kreskowy — DRUGIE i ostatnie pole, które ten proces zmienia w bazie
   * firmy (0.37.0).
   *
   * Kolumna jest STAŁA (`tw_PodstKodKresk`), więc nie przechodzi przez
   * `assertSafeColumn` ani przez ustawienie: nie ma tu czego pomylić, a nazwa
   * w kodzie jest zarazem dokumentacją wymaganego GRANT-u. Konto bez
   * `GRANT UPDATE ON dbo.tw__Towar (tw_PodstKodKresk)` dostanie tu błąd
   * uprawnień i zadanie wyląduje w `error` — funkcja NIE PADA, bo kod działa
   * na kolektorze przez `ean_alias`, a biuro widzi w kolejce, czego brakuje.
   */
  async applySetEan(twId: number, ean: string): Promise<void> {
    const pool = await mssqlPool();
    const res = await pool
      .request()
      .input("id", sql.Int, twId)
      .input("v", sql.NVarChar, ean)
      .query("UPDATE tw__Towar SET tw_PodstKodKresk = @v WHERE tw_Id = @id");
    if (!res.rowsAffected[0]) {
      throw new Error(`Nie znaleziono towaru tw_Id=${twId} w bazie Subiekta`);
    }
    db().prepare("UPDATE sgt_towar SET ean = ? WHERE tw_id = ?").run(ean, twId);
  }

  async createMM(_magFrom: number, _magTo: number, _items: MmItem[]): Promise<string> {
    // MM nie da się bezpiecznie zrobić SQL-em (dokument + numeracja + skutki
    // magazynowe to domena Sfery). Tworzy je worker Sfery — gotowy proces C#
    // w sfera-worker/, czytający tę samą tabelę sfera_queue. Przy SFERA_WORKER=1
    // pickTask w ogóle nie odda mm temu procesowi, więc ten wyjątek działa
    // wyłącznie w instalacjach BEZ wdrożonego workera Sfery — i wtedy zadanie
    // ląduje w 'error' z PONÓW, a dokument wystawia biuro.
    throw new Error(
      "Dokument MM tworzy worker Sfery (usługa wertis-sfera — wdrożenie: DEPLOY §6 etap 2, sfera-worker/README.md). " +
        "Do czasu jego wdrożenia MM wystawia biuro w Subiekcie; lokalizacje działają normalnie."
    );
  }
}
