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
export function zWzorca(
  wzorzec: string, id: string | null | undefined, od?: string | null,
): string | null {
  if (!wzorzec || !id) return null;
  return wzorzec
    .replace("{id}", encodeURIComponent(id))
    /* `{od}` bez wartości zostaje PUSTE, a nie z gołym znacznikiem w adresie:
       lista Centrum Sprzedaży bez dolnej granicy pokazuje własne domyślne
       okno, a `from={od}` wysłane dosłownie byłoby błędem po tamtej stronie. */
    .replace("{od}", od ? encodeURIComponent(od) : "");
}

/**
 * Odnośnik do zwrotu w Centrum Sprzedaży.
 *
 * `utworzono` wyznacza dolną granicę zakresu dat listy — bez niej filtr
 * wyciąłby starszy zwrot i wyszukanie po poprawnym numerze oddałoby pustkę.
 * Bierzemy POCZĄTEK DNIA zgłoszenia, żeby strefa czasowa nie zjadła zwrotu
 * zgłoszonego nad ranem.
 */
export const linkZwrotu = (id: string | null | undefined, utworzono?: string | null) =>
  zWzorca(config.allegro.panelZwrot, id, poczatekDnia(utworzono));

/** `2026-08-20T07:28:12Z` → `2026-08-20T00:00:00.000Z`; `null` przy śmieciu. */
function poczatekDnia(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export const linkZamowienia = (id: string | null | undefined) =>
  zWzorca(config.allegro.panelZamowienie, id);

/* Oferta prowadzi na stronę PUBLICZNĄ, nie do panelu sprzedawcy: agent chce
   zobaczyć to, co widzi klient — zdjęcia, parametry, opis. */
export const linkOferty = (id: string | null | undefined) =>
  zWzorca(config.allegro.panelOferta, id);
