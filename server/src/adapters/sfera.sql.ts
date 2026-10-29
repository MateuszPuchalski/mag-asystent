import sql from "mssql";
import zlib from "node:zlib";
import { db } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
import type { MmItem, SferaAdapter } from "./sfera.js";
import { oznaczWSubiekcie, wlasneZdjecie } from "../services/zdjecia-wlasne.js";
import { WYMIARY, budujZapytanieZapisu, polaWymiarow, tekstWymiaru, type Pomiar } from "./wymiary.sgt.js";

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
    `Konto SQL nie ma prawa dopisania zdjęcia. Wykonaj w SSMS na bazie ` +
    `podmiotu: GRANT INSERT ON dbo.${tabela} TO wertis; ` +
    `GRANT SELECT ON dbo.ins_ident TO wertis; ` +
    `GRANT UPDATE ON dbo.ins_ident (ido_wartosc) TO wertis; ` +
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
 * Kolumna sumy kontrolnej wchodzi tylko wtedy, gdy ktoś ją nazwał. W bazie
 * firmy `zd_CRC` jest NOT NULL, więc tam nazwana być musi — patrz `config.ts`.
 *
 * Klucz wiersza (`zd_Id`) nie jest IDENTITY: numer wydaje licznik Subiekta
 * w `ins_ident`, a INSERT bez niego pada na NOT NULL. Bierzemy go w tym samym
 * wsadzie, pod blokadą licznika i tabeli. Dwa zadania naraz dostałyby inaczej
 * ten sam numer, a Subiekt własnym zapisem zderzyłby się z naszym.
 *
 * `ido_wartosc` to NASTĘPNY wolny numer: na bazie firmy licznik stał na 6281
 * przy `MAX(zd_Id)` = 6280. Licznik spóźniony względem tabeli nie wydaje
 * numeru zajętego — wtedy bierzemy MAX + 1 i licznik go dogania.
 */
export function budujZapytanieInsert(opts: {
  tabela: string;
  kolumna: string;
  klucz: string;
  glowne: string;
  idWiersza: string;
  crc?: string;
}): string {
  const t = assertSafeColumn(opts.tabela);
  const k = assertSafeColumn(opts.kolumna);
  const klucz = assertSafeColumn(opts.klucz);
  const glowne = assertSafeColumn(opts.glowne);
  const idw = assertSafeColumn(opts.idWiersza);
  const kolumny = [idw, klucz, k, glowne];
  const wartosci = ["@nowe", "@id", "@obraz", "@glowne"];
  if (opts.crc) {
    kolumny.push(assertSafeColumn(opts.crc));
    wartosci.push("@crc");
  }
  return [
    "DECLARE @maks int, @nowe int;",
    `SELECT @maks = ISNULL(MAX(${idw}), 0) FROM ${t} WITH (UPDLOCK, HOLDLOCK);`,
    "SELECT @nowe = ido_wartosc FROM ins_ident WITH (UPDLOCK, HOLDLOCK) WHERE ido_nazwa = @licznik;",
    "IF @nowe IS NULL OR @nowe <= @maks SET @nowe = @maks + 1;",
    "UPDATE ins_ident SET ido_wartosc = @nowe + 1 WHERE ido_nazwa = @licznik;",
    `INSERT INTO ${t} (${kolumny.join(", ")}) VALUES (${wartosci.join(", ")});`,
    "SELECT @nowe AS zdId;",
  ].join("\n");
}

/**
 * Suma kontrolna obrazu dla `zd_CRC`: CRC32 bajtów jako `int` ze znakiem.
 *
 * [WERYFIKUJ] Algorytmu Subiekta nie sprawdzono na żywej bazie. CRC32 to
 * najpewniejszy kandydat dla kolumny `int` o tej nazwie. Kolumna jest NOT
 * NULL, więc jakąś wartość wpisać trzeba, a ta przynajmniej zmienia się
 * razem z obrazem.
 */
export function sumaZdjecia(obraz: Buffer): number {
  return zlib.crc32(obraz) | 0;
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
   * Waga i wymiary — jeden UPDATE na wszystkie zmierzone kolumny.
   *
   * Jeden, a nie cztery: pomiar to jedna czynność i ma wejść cały albo
   * wcale. Kartoteka z wagą bez wymiarów wypadłaby z listy braków dopiero
   * po drugim zadaniu, a ponowienie w środku pisałoby połowę drugi raz.
   *
   * Lustra w `sgt_towar` nie ma, bo lista braków czyta Subiekt wprost.
   */
  async applySetWymiary(twId: number, pomiar: Pomiar): Promise<void> {
    const pola = polaWymiarow();
    const zapytanie = budujZapytanieZapisu(pomiar, pola);
    if (!zapytanie) return;
    const kolumny = ["tw_Masa", ...WYMIARY.map((w) => pola[w])].join(", ");
    const pool = await mssqlPool();
    const req = pool.request().input("id", sql.Int, twId);
    /* `tw_Masa` to decimal; cztery miejsca po przecinku mieszczą gram bez zaokrąglenia. */
    if (pomiar.masaKg !== null) req.input("masa", sql.Decimal(19, 4), pomiar.masaKg);
    for (const w of WYMIARY) {
      const cm = pomiar[w];
      if (cm !== null) req.input(w, sql.VarChar(50), tekstWymiaru(cm));
    }
    let res;
    try {
      res = await req.query(zapytanie);
    } catch (e) {
      throw new Error(opiszBlad(e, kolumny));
    }
    if (!res.rowsAffected[0]) {
      throw new Error(`Nie znaleziono towaru tw_Id=${twId} w bazie Subiekta`);
    }
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
        idWiersza: c.kolumnaKolejnosc,
        crc: c.kolumnaCrc || undefined,
      });
      const req = trans
        .request()
        .input("id", sql.Int, twId)
        .input("obraz", sql.VarBinary(sql.MAX), wlasne.obraz)
        .input("glowne", sql.Bit, pierwsze)
        /* Licznik Subiekta nazywa się jak tabela, której numery wydaje. */
        .input("licznik", sql.VarChar(50), c.tabela);
      if (c.kolumnaCrc) req.input("crc", sql.Int, sumaZdjecia(wlasne.obraz));
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
