import { db } from "../db/db.js";
import { config } from "../config.js";

/* ── Statystyki zwrotów — wgląd, nie proces ──────────────────────────────────
   Karta RAPORT (`reklamacje.ts`) liczy PRZEBIEG: ile zwrotów jest nowych, ile
   dokumentów czeka w kolejce, jaka jest mediana czasu do rozliczenia. Żadna
   z tych liczb nie odpowiada na pytanie właściciela: KTÓRE PRODUKTY wracają
   najczęściej i czy z którymś jest problem.

   Ten plik odpowiada na tamto pytanie i tylko na nie. Cztery przekroje,
   wszystkie liczone na jedno żądanie, wszystkie w oknie podanym przez biuro.

   Najważniejsza rzecz w całym module to UCZCIWOŚĆ WSKAŹNIKA — patrz komentarz
   przy `sprzedazWOknie`. Liczba „zwrotów na sprzedaż" jest jedyną miarą, która
   mówi o problemie, i zarazem jedyną, która potrafi skłamać.                 */

/** Ile dni wstecz wolno pytać. Dłuższe okna nie mają pokrycia w sprzedaży. */
export const OKNA_DNI = [30, 90, 180] as const;

export interface ProduktZwrotow {
  /** NULL = pozycja bez dopasowanej kartoteki; grupuje się wtedy po nazwie. */
  twId: number | null;
  symbol: string;
  nazwa: string;
  /** Ile RAZY wrócił — liczba zwrotów, nie sztuk. */
  zwrotow: number;
  sztuk: number;
  /** Sprzedane sztuki w tym samym oknie; null = nie da się policzyć uczciwie. */
  sprzedanych: number | null;
  /** Udział zwrotów w sprzedaży (0.12 = 12%); null gdy brak mianownika. */
  wskaznik: number | null;
}

export interface StatystykiZwrotow {
  dni: number;
  /** Okno importu sprzedaży — po nim widać, czy wskaźnik ma pokrycie. */
  sprzedazOkno: number;
  produkty: ProduktZwrotow[];
  decyzje: Array<{ decyzja: string; pozycji: number; sztuk: number }>;
  tygodnie: Array<{ tydzien: string; ile: number }>;
  kupujacy: Array<{ login: string; zwrotow: number; sztuk: number }>;
}

/** Okno z żądania sprowadzone do jednej z dozwolonych wartości. */
export function oknoDni(raw: unknown): number {
  const n = Number(raw);
  return (OKNA_DNI as readonly number[]).includes(n) ? n : 90;
}

/**
 * Sprzedane sztuki per kartoteka w oknie — mianownik wskaźnika zwrotów.
 *
 * `null` zamiast mapy, gdy okno pytania jest DŁUŻSZE niż okno importu
 * sprzedaży (`DOK_SPRZEDAZ_DNI_WSTECZ`, domyślnie 90 dni). Read-model po
 * prostu nie zna wtedy starszych dokumentów, więc iloraz wyszedłby zawyżony:
 * licznik z pełnych 180 dni, mianownik z niepełnych 90. Lepiej nie pokazać
 * liczby, niż pokazać taką, po której ktoś wycofa dobrze sprzedający się
 * towar.
 */
function sprzedazWOknie(dni: number): Map<number, number> | null {
  if (dni > config.mssql.sprzedazDniWstecz) return null;
  const cutoff = new Date(Date.now() - dni * 86400_000).toISOString().slice(0, 10);
  const wiersze = db()
    .prepare(
      `SELECT p.tw_id, SUM(p.ilosc) AS sztuk
       FROM sgt_sprzedaz_pozycja p
       JOIN sgt_sprzedaz s ON s.dok_id = p.dok_id
       WHERE s.data_wyst >= ?
       GROUP BY p.tw_id`
    )
    .all(cutoff) as Array<{ tw_id: number; sztuk: number }>;
  return new Map(wiersze.map((w) => [w.tw_id, w.sztuk]));
}

/**
 * Cztery przekroje zwrotów w jednym żądaniu.
 *
 * Okno liczy się od `zwrot.utworzono_at`, czyli od PRZYJĘCIA paczki u nas,
 * a nie od zgłoszenia w Allegro. Tak samo jak raport procesu: interesuje nas
 * to, co przez magazyn faktycznie przeszło.
 */
export function statystykiZwrotow(dni: number): StatystykiZwrotow {
  const d = db();
  const odKiedy = `-${dni} days`;
  const sprzedaz = sprzedazWOknie(dni);

  /* Grupowanie po kartotece, a dla pozycji bez niej — po nazwie ze snapshotu
     oferty. Towar spoza katalogu wraca tak samo jak każdy inny i wypadnięcie
     go ze statystyki byłoby cichym zafałszowaniem obrazu. */
  const wiersze = d
    .prepare(
      `SELECT p.tw_id,
              COALESCE(t.symbol, '') AS symbol,
              COALESCE(NULLIF(t.nazwa, ''), p.nazwa) AS nazwa,
              COUNT(DISTINCT p.zwrot_id) AS zwrotow,
              SUM(p.ilosc) AS sztuk
       FROM zwrot_pozycja p
       JOIN zwrot z ON z.id = p.zwrot_id
       LEFT JOIN sgt_towar t ON t.tw_id = p.tw_id
       WHERE z.utworzono_at >= datetime('now', ?)
       GROUP BY COALESCE(CAST(p.tw_id AS TEXT), 'x' || p.nazwa)
       ORDER BY zwrotow DESC, sztuk DESC
       LIMIT 25`
    )
    .all(odKiedy) as Array<Record<string, unknown>>;

  const produkty: ProduktZwrotow[] = wiersze.map((w) => {
    const twId = (w.tw_id as number) ?? null;
    const sztuk = w.sztuk as number;
    const sprzedanych = twId != null && sprzedaz ? sprzedaz.get(twId) ?? 0 : null;
    return {
      twId,
      symbol: w.symbol as string,
      nazwa: w.nazwa as string,
      zwrotow: w.zwrotow as number,
      sztuk,
      sprzedanych,
      /* Zero sprzedaży w oknie NIE daje wskaźnika 100% — towar mógł zostać
         sprzedany wcześniej, a wrócić teraz. Iloraz przez zero jest tu
         pytaniem bez odpowiedzi, nie odpowiedzią „wszystko wraca". */
      wskaznik: sprzedanych && sprzedanych > 0 ? sztuk / sprzedanych : null,
    };
  });

  const decyzje = (
    d
      .prepare(
        `SELECT COALESCE(NULLIF(p.decyzja, ''), 'nieocenione') AS decyzja,
                COUNT(*) AS pozycji, SUM(p.ilosc) AS sztuk
         FROM zwrot_pozycja p
         JOIN zwrot z ON z.id = p.zwrot_id
         WHERE z.utworzono_at >= datetime('now', ?)
         GROUP BY decyzja
         ORDER BY pozycji DESC`
      )
      .all(odKiedy) as Array<Record<string, unknown>>
  ).map((w) => ({
    decyzja: w.decyzja as string,
    pozycji: w.pozycji as number,
    sztuk: w.sztuk as number,
  }));

  /* Tydzień wg `%Y-%W`: wystarczy do słupków i nie wymaga własnej arytmetyki
     kalendarza. Podpis skracamy dopiero na ekranie.

     Tygodnie PUSTE muszą zostać na osi. Samo GROUP BY zwraca wyłącznie te
     z ruchem, więc spokojny tydzień znikał, a jego sąsiedzi stawali obok
     siebie — wykres pokazywałby wtedy równy rytm tam, gdzie była przerwa.
     Kalendarz z rekurencyjnego CTE daje komplet kluczy, a liczby dokładamy
     z drugiego zapytania. */
  const liczby = new Map(
    (
      d
        .prepare(
          `SELECT strftime('%Y-%W', utworzono_at) AS tydzien, COUNT(*) AS ile
           FROM zwrot
           WHERE utworzono_at >= datetime('now', ?)
           GROUP BY tydzien`
        )
        .all(odKiedy) as Array<{ tydzien: string; ile: number }>
    ).map((w) => [w.tydzien, w.ile])
  );
  const tygodnie = (
    d
      .prepare(
        `WITH RECURSIVE kalendarz(dzien) AS (
           SELECT date('now', ?)
           UNION ALL SELECT date(dzien, '+1 day') FROM kalendarz WHERE dzien < date('now')
         )
         SELECT DISTINCT strftime('%Y-%W', dzien) AS tydzien FROM kalendarz ORDER BY tydzien`
      )
      .all(odKiedy) as Array<{ tydzien: string }>
  ).map((w) => ({ tydzien: w.tydzien, ile: liczby.get(w.tydzien) ?? 0 }));

  /* Kupujący. To DANE OSOBOWE i karta w biurze mówi to wprost: lista służy
     wykrywaniu nadużyć, nie ocenianiu klientów. Login i tak widać na każdej
     karcie zwrotu, więc nowego zakresu danych tu nie ma — nowe jest
     zestawienie, i dlatego wymaga zdania o celu. */
  const kupujacy = (
    d
      .prepare(
        `SELECT z.kupujacy_login AS login,
                COUNT(DISTINCT z.id) AS zwrotow,
                COALESCE(SUM(p.ilosc), 0) AS sztuk
         FROM zwrot z
         LEFT JOIN zwrot_pozycja p ON p.zwrot_id = z.id
         WHERE z.utworzono_at >= datetime('now', ?)
           AND z.kupujacy_login IS NOT NULL AND z.kupujacy_login <> ''
         GROUP BY z.kupujacy_login
         HAVING zwrotow > 1
         ORDER BY zwrotow DESC, sztuk DESC
         LIMIT 10`
      )
      .all(odKiedy) as Array<Record<string, unknown>>
  ).map((w) => ({
    login: w.login as string,
    zwrotow: w.zwrotow as number,
    sztuk: w.sztuk as number,
  }));

  return {
    dni,
    sprzedazOkno: config.mssql.sprzedazDniWstecz,
    produkty,
    decyzje,
    tygodnie,
    kupujacy,
  };
}
