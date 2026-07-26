import { db } from "../db/db.js";

/* ── Raport wydajności per osoba (plan §7) ──────────────────────────────────

   OBOWIĄZEK FORMALNY, NIE OPCJA. Telemetria per pracownik to monitoring
   pracowniczy w rozumieniu Kodeksu pracy (art. 22² i nast.). Zanim ten raport
   zostanie użyty do czegokolwiek kadrowego, pracodawca musi mieć:
     • zapis w regulaminie pracy albo — gdy regulaminu nie ma — w obwieszczeniu,
     • uprzedzenie pracowników co najmniej 2 tygodnie przed uruchomieniem,
     • informację dla nowych osób przed dopuszczeniem do pracy.
   Bez tego dane są kwestionowalne w KAŻDYM zastosowaniu kadrowym. Kod tego nie
   blokuje — decyzja należy do pracodawcy — ale raport niesie tę informację
   w polu `podstawaPrawna`, żeby nie dało się jej przeoczyć przy pierwszym
   otwarciu zestawienia.

   TRZY REGUŁY, KTÓRYCH TEN RAPORT NIE ŁAMIE:

   1. ZGŁOSZONY PROBLEM NIE JEST BŁĘDEM ZGŁASZAJĄCEGO. Cały projekt wyjątków
      (uszkodzenie, brak kodu, rozjazd ilości) opiera się na tym, że opłaca się
      je zgłosić. Wystarczy raz policzyć `problem_raised` na czyjąś niekorzyść,
      żeby ludzie przestali zgłaszać — i wtedy problemy nie znikają, tylko
      przestają być widoczne. Dlatego zgłoszenia mają WŁASNĄ kolumnę, nigdy
      nie wchodzą do niczego, co wygląda na ocenę.

   2. APLIKACJA NIE MA ZDARZENIA „POMYŁKA". Nie ma tu kolumny „błędy", bo nie
      byłoby z czego jej policzyć — `location_mismatch` znaczy „adres w Subiekcie
      był nieaktualny", a to odkrycie, nie pomyłka. Zmyślona kolumna błędów jest
      gorsza niż jej brak: wygląda na fakt.

   3. MAŁA PRÓBKA TO NIE WYNIK. Tempo z pięciu pozycji jest szumem. Wiersz
      poniżej progu dostaje `wiarygodne: false` i nie ma prawa trafić do
      porównania.                                                              */

/** Przerwa dłuższa niż tyle minut nie jest pracą — patrz `czasAktywny`. */
export const PRZERWA_MIN = 15;

/** Poniżej tylu pozycji tempo jest szumem, nie wynikiem. */
export const PROG_WIARYGODNOSCI = 20;

export const PODSTAWA_PRAWNA =
  "Monitoring pracowniczy (Kodeks pracy art. 22² i nast.): wymaga zapisu " +
  "w regulaminie pracy albo obwieszczeniu oraz uprzedzenia pracowników " +
  "na 2 tygodnie przed uruchomieniem. Bez tego dane nie nadają się do " +
  "zastosowań kadrowych.";

/** Zdarzenia liczone jako wykonana pozycja — te same, co w `metrics()`. */
const PRACA = ["putaway_line_done", "putaway_confirm", "location_set", "location_removed"];

export interface WierszWydajnosci {
  userId: number | null;
  /** `null` dla zdarzeń sprzed kont — nie zgadujemy, kto to był. */
  osoba: string;
  pozycje: number;
  /** Czas aktywny w minutach (suma przerw ≤ PRZERWA_MIN między zdarzeniami). */
  minutyAktywne: number;
  /** Pozycje na godzinę pracy aktywnej; `null` gdy nie ma z czego liczyć. */
  tempo: number | null;
  /** Zgłoszone wyjątki. NIE jest to miara błędu — patrz reguła 1 na górze. */
  zgloszoneProblemy: number;
  /** Kody wpisane z ręki. Mówi o etykietach, nie o człowieku. */
  recznePrzepisania: number;
  /** Czy próbka jest wystarczająca, żeby `tempo` cokolwiek znaczyło. */
  wiarygodne: boolean;
}

export interface RaportWydajnosci {
  days: number;
  podstawaPrawna: string;
  progWiarygodnosci: number;
  wiersze: WierszWydajnosci[];
  /** Zdarzenia bez konta — widoczne jako liczba, nigdy doklejane do kogoś. */
  nieprzypisanychZdarzen: number;
}

const OKNO = (days: number) => `-${Math.max(1, Math.min(365, Math.trunc(days)))} days`;

/**
 * Czas aktywny z samych znaczników zdarzeń.
 *
 * Ani „od pierwszego do ostatniego zdarzenia" (liczyłoby rozładunek auta
 * i przerwę jako rozkładanie), ani suma czasów operacji (ich nie mamy).
 * Zamiast tego: suma odstępów między kolejnymi zdarzeniami, ale tylko tych
 * krótszych niż `PRZERWA_MIN`. Odstęp dłuższy = człowiek robił coś innego.
 *
 * Wynik jest z natury ZANIŻONY (ostatnia pozycja w serii nie dokłada nic),
 * co jest właściwym kierunkiem błędu: zawyżone tempo krzywdziłoby ludzi.
 */
export function czasAktywny(czasyMs: number[]): number {
  const s = [...czasyMs].sort((a, b) => a - b);
  let minuty = 0;
  for (let i = 1; i < s.length; i++) {
    const przerwa = (s[i] - s[i - 1]) / 60_000;
    if (przerwa <= PRZERWA_MIN) minuty += przerwa;
  }
  return minuty;
}

export function raportWydajnosci(days = 7): RaportWydajnosci {
  const od = OKNO(days);
  const d = db();

  // Grupujemy po `user_ref` (konto), NIE po `user_id` (tekst) — inaczej „Jan",
  // „jan" i „Jan K" byliby trzema osobami, co było powodem §7 w ogóle.
  const wiersze = d
    .prepare(
      `SELECT e.user_ref                                     AS userId,
              u.name                                         AS osoba,
              SUM(CASE WHEN e.type IN (${PRACA.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS pozycje,
              SUM(CASE WHEN e.type = 'problem_raised' THEN 1 ELSE 0 END)  AS problemy,
              SUM(CASE WHEN e.type = 'manual_entry'   THEN 1 ELSE 0 END)  AS reczne
         FROM events e
         JOIN app_user u ON u.user_id = e.user_ref
        WHERE e.created_at >= datetime('now', ?)
        GROUP BY e.user_ref, u.name
        ORDER BY pozycje DESC, u.name`
    )
    .all(...PRACA, od) as Array<{
    userId: number;
    osoba: string;
    pozycje: number;
    problemy: number;
    reczne: number;
  }>;

  /* Znaczniki czasu JEDNYM zapytaniem dla wszystkich osób naraz, nie po jednym
     na wiersz. Przy dziesięciu osobach różnica jest nieistotna, ale wzorzec
     „zapytanie w pętli" rośnie razem z zatrudnieniem, a tutaj kosztuje jeden
     `GROUP BY` po stronie kodu. */
  const znacznikiPer = new Map<number, number[]>();
  for (const r of d
    .prepare(
      `SELECT user_ref AS ref, created_at FROM events
        WHERE user_ref IS NOT NULL AND created_at >= datetime('now', ?)
          AND type IN (${PRACA.map(() => "?").join(",")})`
    )
    .all(od, ...PRACA) as Array<{ ref: number; created_at: string }>) {
    const t = Date.parse(r.created_at);
    if (Number.isNaN(t)) continue;
    const lista = znacznikiPer.get(r.ref);
    if (lista) lista.push(t);
    else znacznikiPer.set(r.ref, [t]);
  }

  const nieprzypisanych = (
    d
      .prepare(
        "SELECT COUNT(*) n FROM events WHERE user_ref IS NULL AND created_at >= datetime('now', ?)"
      )
      .get(od) as { n: number }
  ).n;

  return {
    days,
    podstawaPrawna: PODSTAWA_PRAWNA,
    progWiarygodnosci: PROG_WIARYGODNOSCI,
    nieprzypisanychZdarzen: nieprzypisanych,
    wiersze: wiersze.map((r) => {
      const minuty = czasAktywny(znacznikiPer.get(r.userId) ?? []);
      const wiarygodne = r.pozycje >= PROG_WIARYGODNOSCI && minuty > 0;
      return {
        userId: r.userId,
        osoba: r.osoba,
        pozycje: r.pozycje,
        minutyAktywne: Number(minuty.toFixed(1)),
        // tempo pokazujemy WYŁĄCZNIE dla wiarygodnej próbki — liczba obok
        // ostrzeżenia „mało danych" i tak zostałaby przeczytana jako wynik
        tempo: wiarygodne ? Number(((r.pozycje / minuty) * 60).toFixed(1)) : null,
        zgloszoneProblemy: r.problemy,
        recznePrzepisania: r.reczne,
        wiarygodne,
      };
    }),
  };
}
