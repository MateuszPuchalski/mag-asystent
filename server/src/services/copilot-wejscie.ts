import type { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import type { TrescBezpieczna } from "./copilot-maskowanie.js";
import type { FaktyBezpieczne } from "./copilot-szkic.js";
import type { ZdjecieZBramki } from "./copilot-zdjecia.js";
import type { WynikWywolania } from "./copilot-narzedzia.js";

/* ── Wejście Copilota: zestaw testowy na 90 dni ──────────────────────────────
   Decyzja właściciela: szkic i dopytanie zostawiają DOKŁADNIE to, co poszło
   do dostawcy modelu, i surową odpowiedź przed sitami. Z tego powstanie zestaw
   do porównania instrukcji i modeli przed wydaniem. Księga mówi, ile wywołanie
   kosztowało i czy wyszło, ale tej samej sprawy drugi raz z niej nie puścisz.

   ZAMKI W TYPACH, jak u nadawcy, ale tylko na trzech polach. `watek`
   i `szkicWejscie` muszą być `TrescBezpieczna`, `fakty` muszą być
   `FaktyBezpieczne`: surowego tekstu kompilator tam nie wpuści.
   `wyjscie`, `historia` i `pytanie` przyjmą WSZYSTKO. Że `wyjscie` niesie
   odpowiedź sprzed odmaskowania, pilnuje test „dopytanie zapisuje
   ZAMASKOWANE pole” w `copilot-wejscie.test.ts`. Pytanie agenta idzie do
   dostawcy bez maskowania z zasady (powód w `copilot-pytania`), więc stoi
   tu tak, jak poszło.

   Zdjęcia w kolumnie `zdjecia` bez bajtów i bez nazw plików. Nazwa bywa
   daną osobową, a bajty to piksele, których nie zamaskujemy. Nazwy zostają
   jednak w `fakty`, w spisie zdjęć, bo fakty są wierną kopią żądania.
   Kolumna `zdjecia` nie dokłada drugiej kopii nazw.

   ZAPIS NIE WYWRACA SZKICU. Wejście jest pomiarem, nie pracą agenta: błąd
   zapisu ląduje w logu, a szkic i księga idą dalej.                        */

/**
 * Ile dni trzymamy wejście (decyzja właściciela). Zestaw testowy potrzebuje
 * świeżych spraw, a wątek klienta nie ma leżeć dłużej, niż trzeba.
 */
export const DNI_WEJSCIA = 90;

/** Ślad zdjęcia w wejściu: bez bajtów i bez nazwy pliku. */
export interface ZdjecieWejscia {
  numer: string;
  /** Załącznik rozmowy; `null` przy zdjęciu, które agent dołączył do pytania. */
  zalacznikId: number | null;
  typ: string;
  bajtow: number;
}

export interface WpisWejscia {
  /** Wiersz księgi tego samego wywołania. */
  wywolanieId: number | null;
  conversationId: number | null;
  messageId?: number | null;
  zadanie: string;
  zrodlo?: string | null;
  wersjaInstrukcji?: string | null;
  /** Pusty albo brak, gdy nic nie odpowiedziało. */
  model?: string | null;
  at: Date;
  watek: TrescBezpieczna;
  fakty: FaktyBezpieczne;
  zdjecia: readonly ZdjecieZBramki[];
  wynikiNarzedzi?: readonly WynikWywolania[] | null;
  /** Dopytanie: pytanie agenta, jak poszło do dostawcy. Bez zamka w typie. */
  pytanie?: string | null;
  /** Dopytanie: tekst pola po maskowaniu. Tylko ta wersja ma tu wstęp. */
  szkicWejscie?: TrescBezpieczna | null;
  /** Dopytanie: historia wymian wysłana modelowi. Bez zamka w typie. */
  historia?: unknown;
  /**
   * Surowa odpowiedź przed sitami i przed odmaskowaniem; brak przy błędzie
   * dostawcy. Bez zamka w typie: pilnuje go test dopytania, nie kompilator.
   */
  wyjscie?: unknown;
  /** `ok` albo kod sita; brak, gdy sita nie miały czego sprawdzać. */
  wynikSit?: string | null;
}

/** Ślad zdjęć do zapisu. Osobno, bo to jedyne miejsce, które wycina bajty i nazwy. */
export function zdjeciaWejscia(zdjecia: readonly ZdjecieZBramki[]): ZdjecieWejscia[] {
  return zdjecia.map((z) => ({
    numer: z.numer,
    zalacznikId: z.zrodlo === "zalacznik" ? z.zalacznikId : null,
    typ: z.typ,
    bajtow: z.bajtow,
  }));
}

/**
 * Zapis wejścia. Oddaje `id` albo `null`, gdy przełącznik jest wyłączony albo
 * zapis padł. Nie rzuca: wołający stoi w transakcji szkicu, a porażka pomiaru
 * nie ma prawa cofnąć szkicu ani księgi.
 */
export function zapiszWejscie(database: DatabaseSync, w: WpisWejscia): number | null {
  if (!config.copilot.zapisWejscia) return null;
  const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
  try {
    return Number(database.prepare(`INSERT INTO copilot_wejscie
      (wywolanie_id,conversation_id,message_id,zadanie,zrodlo,wersja_instrukcji,model,at,
       watek,fakty,zdjecia,wyniki_narzedzi,pytanie,szkic_wejscie,historia,wyjscie,wynik_sit)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(w.wywolanieId, w.conversationId, w.messageId ?? null, w.zadanie, w.zrodlo ?? null,
        w.wersjaInstrukcji ?? null, w.model || null, w.at.toISOString(),
        String(w.watek), String(w.fakty), JSON.stringify(zdjeciaWejscia(w.zdjecia)),
        JSON.stringify(w.wynikiNarzedzi ?? []), w.pytanie ?? null,
        w.szkicWejscie == null ? null : String(w.szkicWejscie),
        json(w.historia), json(w.wyjscie), w.wynikSit ?? null).lastInsertRowid);
  } catch (e) {
    /* Sam komunikat SQLite, bez treści wiersza: log nie ma retencji. */
    console.warn(`[copilot-wejscie] zapis nieudany: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Retencja: kasuje wejścia starsze niż `dni`. Indeksowany DELETE po `at`.
 * Wpis w dzienniku tylko wtedy, gdy coś zniknęło, bo co godzinę „zero” to szum.
 * Chodzi niezależnie od `COPILOT_ZAPIS_WEJSCIA`: wyłączony zapis nie ma
 * zatrzymać kasowania tego, co już leży.
 */
export function sprzatnijWejscia(database: DatabaseSync, teraz: Date, dni = DNI_WEJSCIA): number {
  const granica = new Date(teraz.getTime() - dni * 24 * 60 * 60_000).toISOString();
  const usunietych = Number(database.prepare("DELETE FROM copilot_wejscie WHERE at < ?").run(granica).changes);
  if (usunietych > 0) {
    logEvent("copilot_wejscie_retencja", "system", null, { usunietych, granica }, null, database);
  }
  return usunietych;
}
