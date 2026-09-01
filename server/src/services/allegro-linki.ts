import { config } from "../config.js";

/* ── Odnośniki do panelu sprzedawcy Allegro (0.152.0) ────────────────────────
   Zwrot rozstrzyga się w WERTIS, ale bywa moment, w którym trzeba wejść do
   Allegro: sprawdzić korespondencję, dopiąć coś, czego API nie oddaje.
   Wtedy operator nie ma szukać zamówienia po numerze — ma kliknąć.

   Adresy panelu to strony UI, więc nie opisuje ich ani `swagger.yaml`, ani
   żadna inna specyfikacja. Wzorce stoją w konfiguracji i noszą `[WERYFIKUJ]`
   w `docs/allegro-ksztalt.md`; gdy Allegro je przestawi, poprawia się wpisem
   w `wertis.env`, nie wydaniem.

   Host bierze się z `ALLEGRO_SANDBOX` razem z wzorcem — link do produkcji
   z instancji sandboksowej pokazywałby cudze dane.                          */

/**
 * Adres z wzorca. `null` znaczy „nie ma czego linkować" i ekran ma wtedy
 * pokazać sam tekst, a nie odnośnik prowadzący donikąd.
 *
 * Identyfikator kodujemy: numery zwrotów bywają postaci `4R50/2026`, a ukośnik
 * w ścieżce zrobiłby z jednego segmentu dwa.
 */
export function zWzorca(wzorzec: string, id: string | null | undefined): string | null {
  if (!wzorzec || !id) return null;
  return wzorzec.replace("{id}", encodeURIComponent(id));
}

export const linkZwrotu = (id: string | null | undefined) =>
  zWzorca(config.allegro.panelZwrot, id);

export const linkZamowienia = (id: string | null | undefined) =>
  zWzorca(config.allegro.panelZamowienie, id);
