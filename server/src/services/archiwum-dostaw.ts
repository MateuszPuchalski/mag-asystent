import { db } from "../db/db.js";
import { wyjatkiOtwarteWgDokumentu } from "./problems.js";
import type { DeliveryDocument } from "../types.js";

/* ── Archiwum dostaw dla biura ───────────────────────────────────────────────
   Lista rozkładania pokazuje okno importu — domyślnie czternaście dni. Dostawa
   starsza znika z panelu w całości: nie da się jej otworzyć, sprawdzić, kto
   odłożył pozycję, ani porównać z reklamacją, która przyszła miesiąc później.
   Biuro odpowiadało na takie pytania Subiektem obok, czyli w miejscu, które
   o odłożeniach nie wie nic.

   TO NIE JEST SZERSZE OKNO IMPORTU i to jest cała decyzja tego pliku. Import
   zaorywa read-model `sgt_*` przy każdym cyklu (patrz `subiekt.mssql.ts`),
   więc rozszerzenie okna kosztowałoby przy każdym imporcie tyle samo, co
   pierwszy — a przede wszystkim wpuściłoby dokumenty sprzed kwartału na LISTĘ
   PRACY kolektora, gdzie nie mają czego szukać.

   Odpowiedź leży w naszych własnych tabelach. `delivery` i `delivery_line`
   trzymają numer, dostawcę, datę dokumentu, każdą pozycję, adres faktyczny
   i nazwisko odkładającego — i NIGDY nie są czyszczone. Analiza dostaw
   (`analizaDostaw`) czyta stamtąd od dawna okna 30/90/180 dni. Ten serwis
   robi to samo dla listy.

   Granicą archiwum jest NIEOBECNOŚĆ w read-modelu, a nie liczba dni. Dzięki
   temu archiwum nie może się rozjechać z listą pracy: dokument jest dokładnie
   w jednym z dwóch miejsc, a zmiana `DOK_DNI_WSTECZ` przesuwa granicę w obu
   naraz. Data liczona osobno dawałaby przy każdej zmianie ustawienia albo
   dziurę, albo dublet.                                                       */

/** Ile wierszy archiwum jedzie na ekran za jednym razem. */
const LIMIT = 200;

export interface ArchiwumDostaw {
  documents: DeliveryDocument[];
  /** Ile dostaw pasuje do zapytania — także tych poza `limit`. */
  ile: number;
  limit: number;
}

/** Wiersz `delivery` z policzonym postępem — surowy kształt zapytania. */
interface WierszArchiwum {
  dokId: number;
  nrPelny: string;
  dataWyst: string;
  dostawca: string;
  status: string;
  linesTotal: number;
  linesDone: number;
}

/**
 * Wzorzec do `LIKE` ze znakami wieloznacznymi wyłączonymi.
 *
 * Bez tego wpisanie `%` w wyszukiwarkę zwracałoby CAŁE archiwum, a `_`
 * dopasowywałby dowolny znak — czyli szukanie działałoby inaczej, niż wygląda.
 */
function wzorzec(q: string): string {
  return `%${q.replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
}

/**
 * Dostawy, których dokumentu nie ma już w read-modelu — czyli starsze niż okno
 * importu.
 *
 * Dostawy zamknięte „poza WERTIS" zostają na liście, choć mają też swój czip.
 * Archiwum odpowiada na pytanie „co przyjechało", a nie „co zdjęto z listy":
 * pominięcie całej klasy dostaw czyniłoby z tej listy niepełną historię, czyli
 * dokładnie to, czego się po archiwum nie spodziewamy.
 *
 * @param q  fragment numeru dokumentu albo nazwy dostawcy; puste = wszystko
 */
export function archiwumDostaw(q = "", limit = LIMIT): ArchiwumDostaw {
  const szukane = q.trim();
  /* Filtr WYŁĄCZONY przy pustym zapytaniu, zamiast `LIKE '%%'`: pusty wzorzec
     odrzuciłby wiersze z NULL-owym dostawcą przez `COALESCE`… a nade wszystko
     czytelniej mówi, że wtedy nie filtrujemy wcale. */
  const filtr = szukane
    ? `AND (d.sgt_dok_numer LIKE @q ESCAPE '\\' OR COALESCE(d.dostawca,'') LIKE @q ESCAPE '\\')`
    : "";
  /* `LIKE` w SQLite ignoruje wielkość liter TYLKO dla ASCII — „Łuczniczka"
     znajdzie się po „uczni", ale nie po „łuczni" z małej litery. Numer
     dokumentu, czyli główny klucz szukania w biurze, jest w całości ASCII,
     a nazwę dostawcy widać na ekranie i przepisuje się ją wzrokiem. */
  const parametry: Record<string, string> = szukane ? { q: wzorzec(szukane) } : {};

  const { ile } = db()
    .prepare(
      `SELECT COUNT(*) AS ile
         FROM delivery d
         LEFT JOIN sgt_dokument s ON s.dok_id = d.sgt_dok_id
        WHERE s.dok_id IS NULL ${filtr}`
    )
    .get(parametry) as { ile: number };

  const wiersze = db()
    .prepare(
      `SELECT d.sgt_dok_id AS dokId,
              d.sgt_dok_numer AS nrPelny,
              COALESCE(d.data_dok, '') AS dataWyst,
              COALESCE(d.dostawca, '') AS dostawca,
              d.status AS status,
              COUNT(l.id) AS linesTotal,
              COALESCE(SUM(CASE WHEN l.status IN ('done','skipped','problem') THEN 1 ELSE 0 END), 0) AS linesDone
         FROM delivery d
         LEFT JOIN sgt_dokument s ON s.dok_id = d.sgt_dok_id
         LEFT JOIN delivery_line l ON l.delivery_id = d.id
        WHERE s.dok_id IS NULL ${filtr}
        GROUP BY d.id
        ORDER BY d.data_dok DESC, d.sgt_dok_id DESC
        LIMIT @limit`
    )
    .all({ ...parametry, limit: Math.max(1, Math.trunc(limit)) }) as unknown as WierszArchiwum[];

  const wyjatki = wyjatkiOtwarteWgDokumentu(wiersze.map((w) => w.dokId));

  return {
    documents: wiersze.map((w) => ({
      dokId: w.dokId,
      /* Typ dokumentu i płatnik zostały w Subiekcie — `delivery` ich nie
         przepisuje. Puste pole zamiast zgadywanego „FZ": lista i tak typu nie
         pokazuje, a `khId: null` znaczy dla panelu „nie pytaj o logo" i chroni
         przed serią 404 dokładnie tak, jak przy zwykłej liście. */
      typ: "",
      nrPelny: w.nrPelny,
      dataWyst: w.dataWyst,
      dostawca: w.dostawca,
      khId: null,
      maLogo: false,
      wyjatkiOtwarte: wyjatki.get(w.dokId) ?? 0,
      /* Snapshot pozycji JEST liczbą pozycji tej dostawy — faktury nie ma już
         z czego doliczyć, a dostawa zamknięta poza WERTIS nie ma linii wcale
         i uczciwie pokazuje zero. */
      positions: w.linesTotal,
      wBuforze: false,
      wPrzyjeciach: false,
      linesTotal: w.linesTotal,
      linesDone: w.linesDone,
      status: w.status,
    })),
    ile,
    limit,
  };
}
