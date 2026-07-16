import type { ProductRow } from "../types.js";
import type {
  RawDocument,
  RawPosition,
  RawProduct,
  RawStock,
  SubiektAdapter,
} from "./subiekt.js";

/**
 * PRODUKCJA — odczyt bezpośrednio z bazy MSSQL Subiekta GT (spec §6, D2).
 * Login SQL read-only, GRANT SELECT tylko na potrzebne tabele.
 *
 * NIE uruchamiane w tym środowisku (brak Subiekta/MSSQL). Szkielet gotowy do
 * podpięcia na maszynie z Subiektem: dodać zależność `mssql`, ustawić
 * SGT_MODE=mssql i połączenie w configu, po czym zaimplementować metody wg
 * zapytań poniżej. Nazwy kolumn oznaczone [WERYFIKUJ] — różnią się między
 * wersjami SGT (spec §6, §11).
 *
 * Przykładowe zapytania (do wykonania przez pulę połączeń `mssql`):
 *
 *   -- kartoteka po EAN
 *   SELECT tw_Id, tw_Symbol, tw_Nazwa, tw_PodstKodKresk, tw_Lokalizacja,
 *          tw_JednMiary, tw_Opis
 *   FROM tw__Towar WHERE tw_PodstKodKresk = @ean AND tw_Zablokowany = 0
 *
 *   -- wyszukiwarka (spec §5.1)
 *   SELECT TOP 20 tw_Id, tw_Symbol, tw_Nazwa, tw_PodstKodKresk, tw_Lokalizacja
 *   FROM tw__Towar
 *   WHERE tw_Symbol LIKE @q + '%' OR tw_Nazwa LIKE '%' + @q + '%'
 *      OR (@isNum = 1 AND tw_PodstKodKresk LIKE '%' + @q)
 *   ORDER BY CASE WHEN tw_Symbol LIKE @q + '%' THEN 0 ELSE 1 END, tw_Symbol
 *
 *   -- stany
 *   SELECT st_Stan, st_StanRez FROM tw_Stan
 *   WHERE st_TowId = @twId AND st_MagId = @magId
 *
 *   -- dokumenty FZ/PZ na MGP z 14 dni (ustal dok_Typ dla FZ/PZ — [WERYFIKUJ KRYTYCZNE])
 *   SELECT dok_Id, dok_Typ, dok_NrPelny, dok_DataWyst, dok_MagId, kh_Nazwa, <flaga bufora>
 *   FROM dok__Dokument d LEFT JOIN kh__Kontrahent k ON k.kh_Id = d.dok_PlatnikId
 *   WHERE dok_MagId = @mgpId AND dok_Typ IN (@fz,@pz) AND dok_DataWyst >= @cutoff
 *   ORDER BY dok_DataWyst DESC
 *
 *   -- pozycje dokumentu
 *   SELECT ob_TowId, ob_IloscMag FROM dok_Pozycja WHERE ob_DokHanId = @dokId
 */
export class MssqlSubiektAdapter implements SubiektAdapter {
  constructor() {
    throw new Error(
      "MssqlSubiektAdapter: skonfiguruj połączenie MSSQL i zaimplementuj SELECT-y (§6). " +
        "Nieuruchamialny bez maszyny z Subiektem GT."
    );
  }
  getProductById(_twId: number): RawProduct | undefined {
    throw new Error("not implemented");
  }
  getProductByEan(_ean: string): RawProduct | undefined {
    throw new Error("not implemented");
  }
  getProductBySymbol(_symbol: string): RawProduct | undefined {
    throw new Error("not implemented");
  }
  search(_q: string, _limit: number): ProductRow[] {
    throw new Error("not implemented");
  }
  getStock(_twId: number, _magId: number): RawStock {
    throw new Error("not implemented");
  }
  listPutawayDocuments(_days: number): RawDocument[] {
    throw new Error("not implemented");
  }
  getDocument(_docId: number): RawDocument | undefined {
    throw new Error("not implemented");
  }
  getDocumentPositions(_docId: number): RawPosition[] {
    throw new Error("not implemented");
  }
  listMgpStockProducts(): RawPosition[] {
    throw new Error("not implemented");
  }
}
