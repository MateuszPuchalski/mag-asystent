import { config } from "../config.js";
import { makeSferaAdapter } from "../adapters/index.js";
import { bezMigracji, brakujacaTabela } from "../db/db.js";
import { zamelduj } from "../services/process-state.js";
import { czekaNaDokument, oznaczBlad, pickTask, przetworzZadanie } from "./kolejka.js";

/* ── Worker NIE migruje schematu (0.177.1) ───────────────────────────────────
   MUSI stać przed pierwszym dotknięciem bazy, a pierwsze jest `zamelduj()`
   niżej — ono woła `db()` przez `process-state.ts`. Wywołane za późno rzuca
   wyjątkiem, zamiast po cichu nie zadziałać.

   Powód pełny opisuje `db/db.ts` przy `bezMigracji`. Skrótem: 2 września
   wyjątek w migracji położył API i workera naraz, bo migrowały obaj. */
bezMigracji();

/**
 * Worker Sfery (spec §9). Jeden proces, pętla poll, przetwarzanie sekwencyjne
 * (COM Sfery nie jest thread-safe). Retry 3× z backoffem; po wyczerpaniu status
 * 'error'. Dokument w buforze → 'waiting_for_doc' i ponawianie.
 * DEV: zapis realizuje DevSferaAdapter (mutacja sgt_*).
 *
 * Ten plik to WYŁĄCZNIE pętla i sklejenie: sama logika kolejki siedzi w
 * `kolejka.ts`, żeby dała się przetestować bez uruchamiania workera.
 */
const sfera = makeSferaAdapter();

/* Ostatnio zameldowany brak tabeli. Trzymamy go, żeby pisać do dziennika przy
   ZMIANIE stanu, a nie co takt: przy `pollMs` rzędu sekundy druga droga
   zapełniłaby log kopiami jednego zdania. Tę cenę repo już raz zapłaciło —
   „każdy obieg dopisuje kolejną kopię komunikatu" (DEPLOY §7). */
let brakowalo: string | null = null;

/**
 * Czy schemat jest gotowy do pracy.
 *
 * Worker CZEKA, zamiast paść. Proces, który pada, NSSM podnosi z powrotem —
 * a to jest pętla restartów z wyboru, czyli dokładnie ten stan, z którego to
 * wydanie wychodzi. Czekanie kosztuje stojącą kolejkę zapisów; pętla kosztuje
 * dziennik i mylący objaw.
 */
function schematGotowy(): boolean {
  const brak = brakujacaTabela();
  if (brak) {
    if (brakowalo !== brak) {
      console.warn(
        `[worker] czekam — w bazie nie ma tabeli ${brak}. Schemat zakłada serwer ` +
        "API (wertis-api); worker podejmie pracę sam, gdy tabela się pojawi.");
      brakowalo = brak;
    }
    return false;
  }
  if (brakowalo !== null) {
    console.log(`[worker] schemat gotowy (było: brak ${brakowalo}) — wracam do pracy.`);
    brakowalo = null;
  }
  return true;
}

let busy = false;
function tick() {
  if (busy) return;
  const task = pickTask();
  if (!task) return;

  // Czekanie na wyjście dokumentu z bufora NIE zajmuje slotu — następny tick
  // ma wziąć inne zadanie, zamiast stać przy tym jednym.
  if (czekaNaDokument(task)) return;

  busy = true;
  // błąd przed samym zapisem (np. zepsuty payload) też musi oznaczyć zadanie
  void przetworzZadanie(task, sfera)
    .catch((e) => oznaczBlad(task, e instanceof Error ? e.message : String(e)))
    .finally(() => {
      busy = false;
    });
}

/* Meldunek trybu przy starcie i w pętli. Bez tego jedynym śladem po tym, w
   jakim trybie pracuje worker, była ta linia w logu — a rozjazd z API nie miał
   żadnego objawu poza brakiem zmian w Subiekcie. Teraz widzi go /api/health. */
if (schematGotowy()) zamelduj("worker");

console.log(`[worker] start · poll ${config.worker.pollMs}ms · simErrors=${config.worker.simErrors} · SGT_MODE=${config.sgtMode} · zapis=${config.sferaMode}`);
setInterval(() => {
  /* Brama PRZED meldunkiem: `process_state` jest jedną z tabel, których może
     nie być, a meldunek na nieistniejącej tabeli wywróciłby proces — czyli
     wróciłby dokładnie ten restart, którego unikamy. */
  if (!schematGotowy()) return;
  zamelduj("worker");
  tick();
}, config.worker.pollMs);
