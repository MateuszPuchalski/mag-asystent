import type { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { db as defaultDb } from "../db/db.js";
import { logEvent } from "./events.js";
import { nadawcaAnthropic } from "../adapters/copilot.anthropic.js";
import {
  CEL_KLASYFIKACJI, sklasyfikujRozmowy, type Autor, type NadawcaKlasyfikacji,
} from "./copilot-klasyfikacja.js";
import { TAKSONOMIA_WERSJA } from "./klasyfikacja-slownik.js";

/**
 * Rozpoznanie KAŻDEJ nowej wiadomości klienta (22 września 2026).
 *
 * ── SKĄD TO WYDANIE ─────────────────────────────────────────────────────────
 * Specyfikacja z 20 września: każda wiadomość klienta przechodzi przez
 * rozpoznanie, zanim zobaczy ją człowiek. Właściciel wybrał to zamiast
 * przycisku nad kolejką. Do tej wersji rozpoznawało się tylko to, co agent
 * kliknął — więc w pomiarze były wyłącznie rozmowy, które ktoś uznał za warte
 * pieniędzy, a próbka do trafności była skrzywiona już przy wyborze.
 *
 * ── CO BIERZE ───────────────────────────────────────────────────────────────
 * Rozmowy, których OSTATNIA wiadomość klienta nie ma aktywnej decyzji
 * w bieżącym słowniku, z okna `klasyfikacjaOknoDni`. Najstarsze pierwsze —
 * ten sam kompromis co przy szkicu z taktu: agent pracuje kolejkę od
 * najdłużej czekającego, więc tam rozpoznanie ma stanąć najpierw.
 *
 * Wiadomość z decyzją FAILED NIE wraca. Awaria, która nie była stanem
 * dostawcy (odmowa, ucięcie), powtórzyłaby się co przebieg na koszt firmy.
 * Ponowić może człowiek przyciskiem nad kolejką.
 *
 * ── DWA HAMULCE, bo nikt nie klika ──────────────────────────────────────────
 * Na przebieg i na godzinę, a godzina liczy się z KSIĘGI razem z błędami:
 * restart usługi zerowałby licznik w pamięci, a rachunek u dostawcy nie.
 *
 * Nie wysyła niczego do klienta i nie zmienia statusu rozmowy.
 */
export const AUTOMAT_KLASYFIKACJI: Autor = { id: null, name: "automat" };

export interface AutoKlasyfikacjaDeps {
  database?: DatabaseSync;
  nadaj?: NadawcaKlasyfikacji;
  naPrzebieg?: number;
  naGodzine?: number;
  oknoDni?: number;
  now?: () => Date;
}

export interface WynikAutoKlasyfikacji {
  sklasyfikowanych: number;
  bledow: number;
  przerwane: string | null;
  budzet: number;
}

/*
 * Rozmowy czekające na rozpoznanie. Wiadomość-cel bierze się z tego samego
 * fragmentu co kolejka i partia (`CEL_KLASYFIKACJI`) — trzecia kopia tej
 * reguły byłaby trzecią okazją do rozmowy klasyfikowanej w kółko.
 *
 * Wiadomość bez treści i bez załącznika pomijamy już tutaj: partia i tak by
 * ją pominęła, a zajmowałaby miejsce w limicie przebiegu.
 */
const CZEKAJACE = `
  SELECT c.id AS rozmowa
    FROM conversation c
    JOIN message m ON m.id = ${CEL_KLASYFIKACJI}
   WHERE m.sent_at >= ?
     AND (TRIM(COALESCE(m.body,'')) <> ''
          OR EXISTS (SELECT 1 FROM message_attachment a WHERE a.message_id = m.id))
     AND NOT EXISTS (SELECT 1 FROM decyzja_klasyfikacji k
                      WHERE k.message_id = m.id AND k.aktywna = 1
                        AND k.taksonomia_wersja = '${TAKSONOMIA_WERSJA}')
   ORDER BY m.sent_at, m.id
   LIMIT ?`;

/** Ile wywołań klasyfikacji poszło w ostatniej godzinie — z księgi, razem z błędami. */
function zuzyteWGodzinie(database: DatabaseSync, teraz: Date): number {
  return Number((database.prepare(
    `SELECT count(*) n FROM copilot_wywolanie WHERE zadanie='klasyfikacja' AND at >= ?`)
    .get(new Date(teraz.getTime() - 3_600_000).toISOString()) as { n: number }).n);
}

/**
 * Jeden przebieg taktu. Wołany WYŁĄCZNIE z `main()` — `buildApp()` nie ma
 * prawa strzelać do dostawcy modelu.
 */
export async function sklasyfikujNowe(deps: AutoKlasyfikacjaDeps = {}): Promise<WynikAutoKlasyfikacji> {
  const database = deps.database ?? defaultDb();
  const naPrzebieg = deps.naPrzebieg ?? config.copilot.autoKlasyfikacjaNaPrzebieg;
  const naGodzine = deps.naGodzine ?? config.copilot.autoKlasyfikacjaNaGodzine;
  const oknoDni = deps.oknoDni ?? config.copilot.klasyfikacjaOknoDni;
  const teraz = (deps.now ?? (() => new Date()))();

  const budzet = Math.max(0, naGodzine - zuzyteWGodzinie(database, teraz));
  const ile = Math.min(naPrzebieg, budzet);
  if (ile === 0) {
    /* Sufit wyczerpany. Cisza byłaby gorsza od wpisu: rachunek rośnie, a nikt
       nie wie, że takt stoi. */
    logEvent("copilot_auto_klasyfikacja_sufit", AUTOMAT_KLASYFIKACJI.name, null,
      { naGodzine, zuzyte: naGodzine - budzet }, null, database);
    return { sklasyfikowanych: 0, bledow: 0, przerwane: "sufit godzinowy wyczerpany", budzet };
  }

  const od = new Date(teraz.getTime() - oknoDni * 86_400_000).toISOString();
  const rozmowy = (database.prepare(CZEKAJACE).all(od, ile) as Array<{ rozmowa: number }>)
    .map((r) => Number(r.rozmowa));
  if (rozmowy.length === 0) return { sklasyfikowanych: 0, bledow: 0, przerwane: null, budzet };

  const w = await sklasyfikujRozmowy(database, rozmowy, AUTOMAT_KLASYFIKACJI,
    deps.nadaj ?? nadawcaAnthropic, teraz);

  /* Zdarzenie zbiorcze na przebieg: pojedyncze decyzje zapisuje już serwis. */
  logEvent("copilot_auto_klasyfikacja", AUTOMAT_KLASYFIKACJI.name, null,
    { sklasyfikowanych: w.sklasyfikowane, bledow: w.bledy.length,
      pominietych: w.pominiete.length, przerwane: w.przerwane, budzet }, null, database);
  return { sklasyfikowanych: w.sklasyfikowane, bledow: w.bledy.length, przerwane: w.przerwane, budzet };
}
