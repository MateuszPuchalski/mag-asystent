import { db } from "../db/db.js";

/* ── Raporty liczone ze zdarzeń: metryki systemu i wydajność osób ───────────
   Do 0.25.0 były to dwa moduły (`metrics.ts`, `wydajnosc.ts`), które
   dublowały okno czasowe i — groźniej — regułę odsiewu podwójnego liczenia,
   każdy w innej formie. Rozjazd tych kopii zawyżałby raport mierzący ludzi,
   więc reguła mieszka teraz w JEDNYM miejscu (`bezDubli`), a oba raporty
   z niej korzystają.

   Dwa raporty pozostają OSOBNYMI funkcjami z osobnymi trasami, bo opisują
   co innego: `metrics()` mówi o SYSTEMIE (etykiety, czasy odpowiedzi),
   `raportWydajnosci()` o LUDZIACH — i tylko ten drugi niesie obowiązek
   formalny z Kodeksu pracy.                                                  */

const OKNO = (days: number) => `-${Math.max(1, Math.min(365, Math.trunc(days)))} days`;

/** Zdarzenia liczone jako wykonana pozycja — wspólne dla obu raportów. */
const PRACA = ["putaway_line_done", "putaway_confirm", "location_set", "location_removed"];

/**
 * Warunek odsiewający PODWÓJNE LICZENIE tej samej czynności.
 *
 * Od sierpnia 2026 `location_set` powstaje także przy rozkładaniu, bo emituje je
 * `enqueueSetLocation` wspólne dla trzech ścieżek. Rozłożenie jednej linii daje
 * więc `putaway_line_done` ORAZ `location_set` — jedną czynność człowieka, dwa
 * wiersze. Bez tego warunku raporty zawyżałyby tempo każdemu, kto rozkłada,
 * czyli całej hali.
 *
 * W raporcie MIERZĄCYM LUDZI zawyżenie jest gorsze niż brak liczby: cichy błąd
 * w tę stronę trafia do rozmowy o pracy, a nikt nie ma jak go zauważyć.
 *
 * Wpisy sprzed tej zmiany nie mają `zrodlo` i są zmianami z karty — wtedy tylko
 * ona je emitowała. Stąd `IS NULL` w warunku, a nie pominięcie starych danych.
 */
const bezDubli = (alias: string) => `(${alias}type NOT IN ('location_set','location_removed')
       OR json_extract(${alias}payload,'$.zrodlo') IS NULL
       OR json_extract(${alias}payload,'$.zrodlo') = 'karta')`;

/* ── Cztery liczby warte mierzenia (plan §10) ───────────────────────────────
   `events` wystarczał do zapisu, nie do pomiaru. Te cztery metryki mają
   wspólną cechę: każda mówi, CO ZROBIĆ, a nie tylko „ile było".

   Świadomie NIE ma tu raportu wydajności per osoba — jest niżej, jako osobna
   funkcja z osobną trasą i obowiązkiem formalnym (patrz sekcja wydajności).  */

export interface Metrics {
  /** Okno, którego dotyczą liczby. */
  days: number;
  /** Główny wskaźnik jakości UX; cel < 0,3. */
  dotknieciaNaPozycje: number | null;
  /** p95 skan → odpowiedź serwera (ms). Powyżej ~300 ms ludzie skanują dwa razy. */
  p95OdpowiedziMs: number | null;
  /** Regały, których etykiety najczęściej trzeba wpisywać z ręki — do przedruku. */
  etykietyDoPrzedruku: Array<{ code: string; reczne: number; razem: number; udzial: number }>;
  /** Kartoteki bez czytelnego kodu — wpisywane zamiast skanowane. */
  towaryBezCzytelnegoKodu: Array<{ code: string; reczne: number }>;
  /** Ile zdarzeń w oknie (sanity check — zero znaczy „nikt nie pracował"). */
  zdarzen: number;
}

/** Percentyl z posortowanej tablicy; null gdy brak danych. */
function p95(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

export function metrics(days = 7): Metrics {
  const od = OKNO(days);
  const d = db();

  const zdarzen = (
    d.prepare("SELECT COUNT(*) n FROM events WHERE created_at >= datetime('now', ?)").get(od) as {
      n: number;
    }
  ).n;

  // dotknięcia = wejścia ręczne + otwarcia arkuszy decyzji; pozycje = odłożenia
  const licz = (types: string[]): number =>
    (
      d
        .prepare(
          `SELECT COUNT(*) n FROM events
           WHERE created_at >= datetime('now', ?) AND type IN (${types.map(() => "?").join(",")})`
        )
        .get(od, ...types) as { n: number }
    ).n;

  /* pozycje = realna praca (odłożenie w trybie A, potwierdzenie w trybie B,
     zmiana adresu z karty); dotknięcia = wszystko, co wymagało palca zamiast
     skanu. Zdarzenia lokalizacji wchodzą wyłącznie z karty — `bezDubli`,
     ten sam warunek co w raporcie wydajności. */
  const pozycje = (
    d
      .prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE created_at >= datetime('now', ?)
           AND type IN (${PRACA.map(() => "?").join(",")})
           AND ${bezDubli("")}`
      )
      .get(od, ...PRACA) as { n: number }
  ).n;
  const dotkniecia = licz(["manual_entry", "location_mismatch", "problem_raised"]);

  const czasy = (
    d
      .prepare(
        `SELECT json_extract(payload,'$.ms') AS ms FROM events
         WHERE type = 'scan_timing' AND created_at >= datetime('now', ?)`
      )
      .all(od) as Array<{ ms: number | null }>
  )
    .map((r) => r.ms)
    .filter((v): v is number => typeof v === "number");

  /* Udział wejść ręcznych per KOD — z payloadu, bo tam siedzi to, co człowiek
     naprawdę podał. Rozbicie na regały i towary robi kształt kodu, ten sam
     dyskryminator co w klasyfikatorze. */
  const perKod = d
    .prepare(
      `SELECT json_extract(payload,'$.code') AS code,
              json_extract(payload,'$.kind') AS kind,
              SUM(CASE WHEN type='manual_entry' THEN 1 ELSE 0 END) AS reczne,
              COUNT(*) AS razem
       FROM events
       WHERE type IN ('scan','manual_entry') AND created_at >= datetime('now', ?)
       GROUP BY code, kind
       HAVING reczne > 0
       ORDER BY reczne DESC
       LIMIT 20`
    )
    .all(od) as Array<{ code: string | null; kind: string | null; reczne: number; razem: number }>;

  return {
    days,
    dotknieciaNaPozycje: pozycje > 0 ? Number((dotkniecia / pozycje).toFixed(2)) : null,
    p95OdpowiedziMs: p95(czasy),
    etykietyDoPrzedruku: perKod
      .filter((r) => r.kind === "LOC" && r.code)
      .map((r) => ({
        code: r.code!,
        reczne: r.reczne,
        razem: r.razem,
        udzial: Number((r.reczne / r.razem).toFixed(2)),
      })),
    towaryBezCzytelnegoKodu: perKod
      .filter((r) => r.kind !== "LOC" && r.code)
      .map((r) => ({ code: r.code!, reczne: r.reczne })),
    zdarzen,
  };
}

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
              SUM(CASE WHEN e.type IN (${PRACA.map(() => "?").join(",")}) AND ${bezDubli("e.")} THEN 1 ELSE 0 END) AS pozycje,
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
          AND type IN (${PRACA.map(() => "?").join(",")})
          AND ${bezDubli("")}`
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
