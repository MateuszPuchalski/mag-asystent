/* ── Ostatni ruch człowieka (@wydanie) ───────────────────────────────────────
   Aktualizacja automatyczna zatrzymuje serwer na minutę lub dwie, więc czeka,
   aż nikt nie pracuje. „Ruch" to ZAPIS z sesją, nie dowolne żądanie: panel
   zostawiony otwarty na biurku odpytuje kolejki całą noc i przy liczeniu
   odczytów okno nocne nie otworzyłoby się nigdy. Ktoś, kto o trzeciej
   naprawdę pracuje — skanuje, rozkłada, odpisuje — zapisuje.

   Moduł bez importów, bo woła go `context.ts`, a tam każdy import serwisu
   grozi cyklem (patrz leniwy import `auth` w tym samym pliku). */

let ostatni: number | null = null;

export function odnotujRuch(teraz: number = Date.now()): void {
  ostatni = teraz;
}

/** Epoka ms ostatniego zapisu z sesją; `null` = od startu nikt nic nie zapisał. */
export const ostatniRuch = (): number | null => ostatni;

/** Tylko do testów. */
export function _wyczyscRuch(): void {
  ostatni = null;
}
