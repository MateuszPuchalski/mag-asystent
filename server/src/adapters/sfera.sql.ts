import sql from "mssql";
import { db } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
import type { MmItem, SferaAdapter } from "./sfera.js";
import { oznaczWSubiekcie, wlasneZdjecie } from "../services/zdjecia-wlasne.js";

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
/** Kolumna kodu kreskowego — stała, bo w Subiekcie nie ma tu wyboru. */
const KOLUMNA_EAN = "tw_PodstKodKresk";

/* ── Odmowa uprawnienia to NIE jest awaria, tylko brakująca linia GRANT-a ────
   Surowy komunikat MSSQL brzmi „The UPDATE permission was denied on the column
   … of the object …" i nie mówi ANI SŁOWA o tym, co z tym zrobić. Wdrożenie
   0.37.0 potknęło się dokładnie na tym: człowiek widział błąd w kolejce i nie
   miał jak zgadnąć, że brakuje jednej linii do wykonania w SSMS.

   Zamiana komunikatu na gotowe polecenie kosztuje nas nic, a oszczędza godzinę
   szukania. Oryginał zostaje w drugim zdaniu — bez niego nie da się odróżnić
   braku GRANT-u od DENY albo od złej bazy.                                    */
function opiszBlad(e: unknown, kolumna: string): string {
  const tresc = e instanceof Error ? e.message : String(e);
  if (!/permission was denied|odmowa|denied/i.test(tresc)) return tresc;
  return (
    `Konto SQL nie ma prawa zapisu do kolumny ${kolumna}. Wykonaj w SSMS ` +
    `na bazie podmiotu: GRANT UPDATE ON dbo.tw__Towar (${kolumna}) TO wertis; ` +
    `— potem PONÓW to zadanie. Komunikat serwera SQL: ${tresc}`
  );
}

/** Ta sama zamiana dla INSERT-u zdjęcia — inne prawo, więc inne polecenie. */
function opiszBladZdjecia(e: unknown, tabela: string): string {
  const tresc = e instanceof Error ? e.message : String(e);
  if (!/permission was denied|odmowa|denied/i.test(tresc)) return tresc;
  return (
    `Konto SQL nie ma prawa dopisywania do tabeli ${tabela}. Wykonaj w SSMS ` +
    `na bazie podmiotu: GRANT INSERT ON dbo.${tabela} TO wertis; ` +
    `— potem PONÓW to zadanie. Zdjęcie NIE ZGINĘŁO: leży w bazie WERTIS ` +
    `i widać je na karcie towaru. Komunikat serwera SQL: ${tresc}`
  );
}

/**
 * Treść INSERT-u dopisującego zdjęcie do kartoteki.
 *
 * WYDZIELONE, bo to JEDYNA logika tego modułu dająca się przetestować bez
 * serwera MSSQL — ten sam powód, dla którego osobno stoi `budujZapytanieBlob`
 * w `zdjecia.sgt.ts`. Wszystkie nazwy są `[WERYFIKUJ]` i przechodzą przez
 * `assertSafeColumn`: pochodzą z pliku konfiguracyjnego, czyli z wejścia.
 *
 * `zd_Glowne` NIE JEST tu na sztywno. Kartoteka może mieć kilka zdjęć, a odczyt
 * bierze główne; nowe ma być główne WYŁĄCZNIE wtedy, gdy żadnego jeszcze nie ma.
 * Rozstrzyga to `@glowne`, wyliczone przez wołającego w tej samej transakcji —
 * dwa zdjęcia oznaczone jako główne dałyby ETag skaczący przy każdym odczycie.
 *
 * Kolumna sumy kontrolnej wchodzi tylko wtedy, gdy ktoś ją nazwał. Algorytmu
 * `zd_CRC` repozytorium NIE ZNA, a własna liczba w tej kolumnie byłaby
 * zgadywaniem zapisanym do bazy firmy.
 */
export function budujZapytanieInsert(opts: {
  tabela: string;
  kolumna: string;
  klucz: string;
  glowne: string;
  crc?: string;
}): string {
  const t = assertSafeColumn(opts.tabela);
  const k = assertSafeColumn(opts.kolumna);
  const klucz = assertSafeColumn(opts.klucz);
  const glowne = assertSafeColumn(opts.glowne);
  const kolumny = [klucz, k, glowne];
  const wartosci = ["@id", "@obraz", "@glowne"];
  if (opts.crc) {
    kolumny.push(assertSafeColumn(opts.crc));
    wartosci.push("@crc");
  }
  return `INSERT INTO ${t} (${kolumny.join(", ")}) VALUES (${wartosci.join(", ")})`;
}

/** Ile zdjęć ma już ta kartoteka — od tego zależy `zd_Glowne` nowego wiersza. */
export function budujZapytanieLiczby(opts: { tabela: string; klucz: string }): string {
  const t = assertSafeColumn(opts.tabela);
  const klucz = assertSafeColumn(opts.klucz);
  return `SELECT COUNT(*) AS ile FROM ${t} WHERE ${klucz} = @id`;
}

export class SqlSferaAdapter implements SferaAdapter {
  async applySetLocation(twId: number, newValue: string): Promise<void> {
    const locCol = assertSafeColumn(config.mssql.locColumn);
    const pool = await mssqlPool();
    let res;
    try {
      res = await pool
        .request()
        .input("id", sql.Int, twId)
        .input("v", sql.NVarChar, newValue)
        .query(`UPDATE tw__Towar SET ${locCol} = @v WHERE tw_Id = @id`);
    } catch (e) {
      // ta sama podpowiedź co przy kodzie kreskowym — brak GRANT-u na kolumnę
      // lokalizacji wygląda identycznie i tak samo nic nie mówi
      throw new Error(opiszBlad(e, locCol));
    }
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
    let res;
    try {
      res = await pool
        .request()
        .input("id", sql.Int, twId)
        .input("v", sql.NVarChar, ean)
        .query("UPDATE tw__Towar SET tw_PodstKodKresk = @v WHERE tw_Id = @id");
    } catch (e) {
      throw new Error(opiszBlad(e, KOLUMNA_EAN));
    }
    if (!res.rowsAffected[0]) {
      throw new Error(`Nie znaleziono towaru tw_Id=${twId} w bazie Subiekta`);
    }
    db().prepare("UPDATE sgt_towar SET ean = ? WHERE tw_id = ?").run(ean, twId);
  }

  /**
   * Dopisanie zdjęcia do kartoteki (0.88.0).
   *
   * Bajty bierzemy z `zdjecie_wlasne`, nie z payloadu zadania — patrz komentarz
   * przy `applySetZdjecie` w `sfera.ts`.
   *
   * `zd_Glowne` liczymy W TEJ SAMEJ TRANSAKCJI co INSERT. Dwa kolektory
   * dodające zdjęcia dwóch różnych towarów nie przeszkadzają sobie, ale dwa
   * zadania na TEN SAM towar bez transakcji mogłyby oznaczyć dwa wiersze jako
   * główne — a wtedy odczyt zwraca raz jedno, raz drugie i ETag skacze przy
   * każdym wejściu na kartę.
   *
   * PNG jedzie do bazy Z PRZEZROCZYSTOŚCIĄ. Jak podgląd Subiekta rysuje kanał
   * alfa — [WERYFIKUJ] na kartotece próbnej PRZED produkcją (DEPLOY §6).
   */
  async applySetZdjecie(twId: number): Promise<void> {
    const c = config.zdjecia;
    const wlasne = wlasneZdjecie(twId);
    if (!wlasne) {
      /* Zdjęcie zniknęło między zakolejkowaniem a wykonaniem — ktoś je podmienił
         i zadanie tamtego zapisu zrobi to samo. Cichy sukces jest tu poprawny:
         błąd kazałby człowiekowi ponawiać coś, co jest już nieaktualne. */
      return;
    }

    const pool = await mssqlPool();
    const trans = pool.transaction();
    await trans.begin();
    try {
      const ile = await trans
        .request()
        .input("id", sql.Int, twId)
        .query(budujZapytanieLiczby({ tabela: c.tabela, klucz: c.kolumnaKlucza }));
      const pierwsze = Number(ile.recordset[0]?.ile ?? 0) === 0;

      const zapytanie = budujZapytanieInsert({
        tabela: c.tabela,
        kolumna: c.kolumna,
        klucz: c.kolumnaKlucza,
        glowne: c.kolumnaGlowne,
        crc: c.kolumnaCrc || undefined,
      });
      const req = trans
        .request()
        .input("id", sql.Int, twId)
        .input("obraz", sql.VarBinary(sql.MAX), wlasne.obraz)
        .input("glowne", sql.Bit, pierwsze);
      if (c.kolumnaCrc) req.input("crc", sql.Int, null);
      await req.query(zapytanie);
      await trans.commit();
    } catch (e) {
      await trans.rollback().catch(() => undefined);
      throw new Error(opiszBladZdjecia(e, c.tabela));
    }

    /* Wiersz w WERTIS znika DOPIERO TERAZ — od tej chwili źródłem jest znowu
       Subiekt. Cache zdjęcia kasujemy razem z nim, bo plik na dysku niesie
       jeszcze naszą kopię i bez tego karta pokazywałaby ją do końca TTL. */
    oznaczWSubiekcie(twId);
    db().prepare("DELETE FROM zdjecie_cache WHERE tw_id = ?").run(twId);
  }

  async createKorektaZwrotu(): Promise<never> {
    /* Ten sam powód co przy MM, tylko mocniejszy: korekta sprzedaży to
       dokument z numeracją, VAT-em i skutkiem magazynowym. SQL-em da się to
       wyłącznie zepsuć. Zadanie ląduje w 'error' z przyciskiem PONÓW, a do
       czasu wdrożenia workera korektę i MM wystawia biuro ręcznie w Subiekcie
       — karta zwrotu mówi wtedy wprost, czego brakuje. */
    throw new Error(
      "Korektę zwrotu i MM na bufor tworzy worker Sfery (usługa wertis-sfera — wdrożenie: DEPLOY §6 etap 2). " +
        "Bez niego oba dokumenty wystawia biuro w Subiekcie; reszta karty zwrotu działa normalnie."
    );
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
