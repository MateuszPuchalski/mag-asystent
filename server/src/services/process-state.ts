import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";

/* ── Meldunek procesu i wykrywanie rozjazdu konfiguracji ─────────────────────
   API i worker to osobne procesy. Gdy worker nie dostanie `SGT_MODE=mssql`,
   dostaje adapter demo: pisze do lokalnego SQLite, oznacza zadanie jako `done`
   i NIE ZGŁASZA BŁĘDU. Na kolektorze zielono, w Subiekcie zero zmian — awaria
   bez jednego objawu, ciągnąca się tygodniami.

   Zalecana w dokumentacji weryfikacja `curl /api/health` nie mogła tego
   wykryć, bo raportowała wyłącznie proces API. Stąd ten meldunek: każdy proces
   zapisuje swój tryb, a `/api/health` je porównuje.                           */

/* 'sfera' melduje się spoza tego kodu: worker Sfery (C#, sfera-worker/) robi
   ten sam UPSERT własnym INSERT-em. Tu ta nazwa istnieje po to, żeby TypeScript
   znał komplet wierszy, które /api/health ma prawo zastać. */
export type NazwaProcesu = "api" | "worker" | "sfera";

/** Po ilu sekundach bez meldunku uznajemy proces za martwy. */
const MARTWY_PO_S = 30;

export function zamelduj(name: NazwaProcesu): void {
  db()
    .prepare(
      `INSERT INTO process_state (name, pid, sgt_mode, sfera_mode, at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         pid = excluded.pid, sgt_mode = excluded.sgt_mode,
         sfera_mode = excluded.sfera_mode, at = excluded.at`,
    )
    .run(name, process.pid, config.sgtMode, config.sferaMode, nowIso());
}

export interface StanWorkera {
  /** null = worker nigdy nie wystartował na tej bazie. */
  widziany: string | null;
  zyje: boolean;
  sgtMode: string | null;
  /** Czy worker pracuje w tym samym trybie co API. */
  zgodny: boolean;
  /** Zdanie dla człowieka; null = wszystko w porządku. */
  problem: string | null;
}

export function stanWorkera(): StanWorkera {
  const row = db()
    .prepare("SELECT pid, sgt_mode, at FROM process_state WHERE name = 'worker'")
    .get() as { pid: number; sgt_mode: string; at: string } | undefined;

  if (!row) {
    return {
      widziany: null,
      zyje: false,
      sgtMode: null,
      zgodny: false,
      problem:
        "Worker nigdy nie wystartował na tej bazie — zadania zapisu do Subiekta nie będą wykonywane.",
    };
  }

  const wiek = (Date.now() - Date.parse(row.at)) / 1000;
  const zyje = Number.isFinite(wiek) && wiek < MARTWY_PO_S;
  const zgodny = row.sgt_mode === config.sgtMode;

  /* Kolejność jest ważna: martwy worker zgłaszamy przed rozjazdem trybu, bo
     przy zatrzymanym procesie tryb i tak nic nie znaczy. */
  let problem: string | null = null;
  if (!zyje) {
    problem = `Worker nie melduje się od ${Math.round(wiek)} s — sprawdź, czy usługa wertis-worker działa.`;
  } else if (!zgodny) {
    problem =
      `ROZJAZD KONFIGURACJI: API pracuje w trybie ${config.sgtMode}, worker w ${row.sgt_mode}. ` +
      "Zapisy trafiają do innego miejsca, niż pokazuje aplikacja — oba procesy muszą czytać ten sam wertis.env.";
  }

  return { widziany: row.at, zyje, sgtMode: row.sgt_mode, zgodny, problem };
}

export interface StanSfery {
  /** null = worker Sfery nigdy nie wystartował na tej bazie. */
  widziany: string | null;
  zyje: boolean;
  sgtMode: string | null;
  /** Zdanie dla człowieka; null = wszystko w porządku. */
  problem: string | null;
}

/** Liczba zadań MM, które czekają na wykonanie — kontekst do zdań o Sferze. */
function mmWTrakcie(): number {
  const r = db()
    .prepare(
      "SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status IN ('pending','waiting_for_doc')"
    )
    .get() as { n: number };
  return r.n;
}

/**
 * Stan workera Sfery (C#, sfera-worker/) — wołane WYŁĄCZNIE przy
 * SFERA_WORKER=1. Bez przełącznika brak tego procesu jest normą (etapy 0-1
 * wdrożenia), a zdanie o nim zamieniłoby każdą istniejącą instalację
 * w czerwoną bez powodu.
 *
 * Zdania doklejają liczbę czekających MM, bo to ona mówi, czy problem jest
 * pilny: martwa usługa przy pustej kolejce może poczekać do rana, ta sama
 * usługa przy dwunastu przesunięciach kontenera — nie.
 */
export function stanSfery(): StanSfery {
  const row = db()
    .prepare("SELECT sgt_mode, at FROM process_state WHERE name = 'sfera'")
    .get() as { sgt_mode: string; at: string } | undefined;

  const mm = mmWTrakcie();
  const czeka = mm > 0 ? ` W kolejce czeka ${mm} zad. MM.` : "";

  if (!row) {
    return {
      widziany: null,
      zyje: false,
      sgtMode: null,
      problem:
        "Worker Sfery nigdy nie wystartował na tej bazie — dokumenty MM nie będą " +
        "tworzone. Sprawdź usługę wertis-sfera (DEPLOY §6, etap 2)." + czeka,
    };
  }

  const wiek = (Date.now() - Date.parse(row.at)) / 1000;
  const zyje = Number.isFinite(wiek) && wiek < MARTWY_PO_S;

  let problem: string | null = null;
  if (!zyje) {
    problem =
      `Worker Sfery nie melduje się od ${Math.round(wiek)} s — sprawdź, ` +
      "czy usługa wertis-sfera działa." + czeka;
  } else if (row.sgt_mode !== config.sgtMode) {
    problem =
      `ROZJAZD KONFIGURACJI: API pracuje w trybie ${config.sgtMode}, worker Sfery ` +
      `w ${row.sgt_mode}. Oba procesy muszą czytać ten sam wertis.env.`;
  }

  return { widziany: row.at, zyje, sgtMode: row.sgt_mode, problem };
}

/**
 * Zadania MM starsze niż godzina, wciąż niewykonane — osłona niezależna od
 * heartbeatu: usługa może się meldować i mimo to nic nie robić (np. każdy
 * pick blokuje guard kolejności po set_location w błędzie). Zdanie mówi też,
 * co zrobić, bo najczęstszą przyczyną jest właśnie lokalizacja czekająca
 * na PONÓW.
 */
export function zaleglosciMm(): string | null {
  /* Próg przez strftime w formacie ISO, NIE datetime(): created_at jest
     zapisywane jako ISO z `T…Z`, a datetime() zwraca spację zamiast T.
     Porównanie leksykalne obu formatów kłamie w obrębie tego samego dnia
     ('T' > ' '), więc próg godzinowy nie łapałby niczego z dzisiaj. */
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM sfera_queue
       WHERE type='mm' AND status IN ('pending','waiting_for_doc')
         AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')`
    )
    .get() as { n: number };
  if (r.n === 0) return null;
  return (
    `${r.n} zad. MM czeka ponad godzinę — worker Sfery ich nie wykonuje. ` +
    "Najczęstsza przyczyna: zapis lokalizacji tego samego towaru w błędzie " +
    "(PONÓW na kolektorze) albo dokument źródłowy w buforze."
  );
}
