import { config } from "../config.js";
import { makeSferaAdapter } from "../adapters/index.js";
import { zamelduj } from "../services/process-state.js";
import { czekaNaDokument, oznaczBlad, pickTask, przetworzZadanie } from "./kolejka.js";

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
zamelduj("worker");

console.log(`[worker] start · poll ${config.worker.pollMs}ms · simErrors=${config.worker.simErrors} · SGT_MODE=${config.sgtMode} · zapis=${config.sferaMode}`);
setInterval(() => {
  zamelduj("worker");
  tick();
}, config.worker.pollMs);
