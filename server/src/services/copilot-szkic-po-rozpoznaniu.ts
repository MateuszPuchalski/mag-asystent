import type { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { db as defaultDb } from "../db/db.js";
import { logEvent } from "./events.js";
import { subiekt as domyslnySubiekt } from "../context.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import {
  BladKluczaCopilota, BladLimituCopilota, BladPrzeciazeniaCopilota,
} from "../adapters/copilot.js";
import { nadawcaSzkicuAnthropic } from "../adapters/copilot.anthropic.js";
import { ulozSzkic, type NadawcaSzkicu } from "./copilot-szkic.js";
import { AUTOMAT, zuzyteWGodzinie } from "./copilot-auto-szkic.js";
import { CEL_KLASYFIKACJI } from "./copilot-klasyfikacja.js";
import { TAKSONOMIA_WERSJA } from "./klasyfikacja-slownik.js";

/* ── Szkic zaraz po rozpoznaniu (23 września 2026) ───────────────────────────
   Właściciel: „ułóż odpowiedź automatycznie po klasyfikacji, gotową do
   zatwierdzenia przez agenta". Do tej wersji po „Rozpoznaj" agent klikał
   jeszcze „Ułóż odpowiedź" i czekał — a rozpoznanie niosło już wszystko,
   czego szkic potrzebuje: kategorię, następny krok i od 0.474.0 wzorzec.

   TRZY WEJŚCIA, JEDNA FUNKCJA: przycisk „Rozpoznaj", takt rozpoznania
   i poprawka kategorii przez agenta. Poprawka tworzy NOWĄ decyzję, więc
   szkic napisany pod starą kategorię jest nieświeży i układa się od nowa —
   `szkic_copilota.decyzja_id` mówi, pod którą decyzję powstał.

   SZKIC CZEKA NA AGENTA. Nic nie idzie do klienta: karta szkicu stoi
   z oceną pustą, agent ją wstawia (E), poprawia i wysyła. To jest to
   „gotowe do zatwierdzenia". Wysyłki bez człowieka w kodzie nie ma.

   KOSZT TRZYMA TEN SAM SUFIT co szkic z taktu (`autoNaGodzine`), liczony
   z księgi wywołań razem z błędami. Rozpoznanie, które nie każe nic robić
   (`NO_ACTION`), i rozpoznanie zastępcze (awaria) szkicu nie uruchamiają —
   ta sama reguła, co w takcie szkiców. */

/**
 * Które z podanych rozmów czekają na szkic pod BIEŻĄCE rozpoznanie: ostatnia
 * wiadomość klienta ma aktywną decyzję, która każe coś zrobić, a szkicu nie ma
 * albo powstał pod inną wiadomość lub inną decyzję.
 */
export function czekajaNaSzkic(database: DatabaseSync, rozmowyId: number[]): number[] {
  if (rozmowyId.length === 0) return [];
  return (database.prepare(`
    SELECT c.id AS rozmowa
      FROM conversation c
      JOIN message m ON m.id = ${CEL_KLASYFIKACJI}
      JOIN decyzja_klasyfikacji k ON k.message_id = m.id AND k.aktywna = 1
       AND k.taksonomia_wersja = '${TAKSONOMIA_WERSJA}'
      LEFT JOIN szkic_copilota s ON s.conversation_id = c.id
     WHERE c.id IN (${rozmowyId.map(() => "?").join(",")})
       AND k.akcja <> 'NO_ACTION' AND k.zrodlo <> 'FALLBACK' AND k.status <> 'FAILED'
       AND (s.conversation_id IS NULL OR IFNULL(s.message_id, -1) <> m.id
            OR IFNULL(s.decyzja_id, -1) <> k.id)
     ORDER BY m.sent_at, m.id`).all(...rozmowyId) as Array<{ rozmowa: number }>)
    .map((r) => Number(r.rozmowa));
}

export interface SzkicPoRozpoznaniuDeps {
  database?: DatabaseSync;
  nadaj?: NadawcaSzkicu;
  subiekt?: SubiektAdapter;
  naGodzine?: number;
  now?: () => Date;
}

export interface WynikSzkicuPoRozpoznaniu {
  ulozonych: number;
  bledow: number;
  /** Zdanie dla dziennika, gdy przebieg stanął. `null` = doszedł do końca. */
  przerwane: string | null;
}

/**
 * Układa szkice dla rozmów świeżo rozpoznanych. Błąd przy JEDNEJ rozmowie
 * nie zatrzymuje reszty; limit, brak klucza i przeciążenie — zatrzymują,
 * jak w takcie szkiców.
 */
export async function szkicujPoRozpoznaniu(
  rozmowyId: number[], deps: SzkicPoRozpoznaniuDeps = {},
): Promise<WynikSzkicuPoRozpoznaniu> {
  const database = deps.database ?? defaultDb();
  const czekaja = czekajaNaSzkic(database, rozmowyId);
  if (czekaja.length === 0) return { ulozonych: 0, bledow: 0, przerwane: null };

  const budzet = Math.max(0, (deps.naGodzine ?? config.copilot.autoNaGodzine) - zuzyteWGodzinie(database));
  if (budzet === 0) {
    logEvent("copilot_szkic_po_rozpoznaniu", AUTOMAT.name, null,
      { ulozonych: 0, czekalo: czekaja.length, przerwane: "sufit godzinowy" }, null, database);
    return { ulozonych: 0, bledow: 0, przerwane: "sufit godzinowy wyczerpany" };
  }

  const nadaj = deps.nadaj ?? nadawcaSzkicuAnthropic;
  const subiekt = deps.subiekt ?? domyslnySubiekt;
  const now = deps.now ?? (() => new Date());
  let ulozonych = 0; let bledow = 0; let przerwane: string | null = null;
  for (const rozmowa of czekaja.slice(0, budzet)) {
    try {
      await ulozSzkic(rozmowa, AUTOMAT, nadaj, subiekt, now());
      ulozonych++;
    } catch (e) {
      if (e instanceof BladLimituCopilota || e instanceof BladKluczaCopilota
        || e instanceof BladPrzeciazeniaCopilota) {
        przerwane = e instanceof Error ? e.message : String(e);
        break;
      }
      bledow++;
    }
  }
  logEvent("copilot_szkic_po_rozpoznaniu", AUTOMAT.name, null,
    { ulozonych, bledow, przerwane, czekalo: czekaja.length }, null, database);
  return { ulozonych, bledow, przerwane };
}

/* ── W tle, po kolei ─────────────────────────────────────────────────────────
   Trasa „Rozpoznaj" odpowiada od razu: szkic trwa kilka sekund na rozmowę,
   a partia ma do dwudziestu rozmów. Panel dostaje szkic zdarzeniem rozmowy,
   tym samym, którym przychodzi szkic z kliknięcia.

   JEDEN ŁAŃCUCH NA PROCES, nie równoległe wywołania. Dwa kliknięcia
   „Rozpoznaj" jedno po drugim nie mają prawa ułożyć dwóch szkiców tej samej
   rozmowy naraz — drugi przebieg zastaje szkic świeży i nic nie płaci. */
let lancuch: Promise<unknown> = Promise.resolve();

export function zlecSzkicPoRozpoznaniu(
  rozmowyId: number[], deps: SzkicPoRozpoznaniuDeps = {},
): Promise<WynikSzkicuPoRozpoznaniu | null> {
  const praca = lancuch.then(() => szkicujPoRozpoznaniu(rozmowyId, deps))
    .catch((e: unknown) => {
      console.warn(`[szkic-po-rozpoznaniu] ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
  lancuch = praca;
  return praca;
}
