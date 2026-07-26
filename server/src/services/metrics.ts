import { db } from "../db/db.js";

/* ── Cztery liczby warte mierzenia (plan §10) ───────────────────────────────
   `events` wystarczał do zapisu, nie do pomiaru. Te cztery metryki mają
   wspólną cechę: każda mówi, CO ZROBIĆ, a nie tylko „ile było".

   Świadomie NIE ma tu raportu wydajności per osoba. Telemetria per pracownik
   to monitoring pracowniczy w rozumieniu Kodeksu pracy (art. 22² i nast.)
   i wymaga zapisu w regulaminie oraz uprzedzenia ludzi PRZED uruchomieniem.
   Techniczny audyt „kto zmienił lokalizację" to co innego i zostaje.          */

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

const OKNO = (days: number) => `-${Math.max(1, Math.min(365, Math.trunc(days)))} days`;

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

  // pozycje = realna praca (odłożenie w trybie A, potwierdzenie w trybie B,
  // zmiana adresu z karty); dotknięcia = wszystko, co wymagało palca zamiast skanu
  const pozycje = licz(["putaway_line_done", "putaway_confirm", "location_set", "location_removed"]);
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
