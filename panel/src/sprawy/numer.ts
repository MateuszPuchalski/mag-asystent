/* ── Numer zamówienia w wierszu kolejki ──────────────────────────────────────
   Allegro identyfikuje zamówienie UUID-em (36 znaków). W wierszu kolejki
   obcinał go wielokropek, więc agent czytał prefiks wspólny dla pół listy
   i nie mógł po nim niczego rozpoznać. Osiem pierwszych znaków wystarcza
   jako uchwyt do porównania z panelem Allegro, a pełny numer zostaje
   w podpowiedzi i w szukaniu (szukanie patrzy na pole, nie na napis).

   Numer, który NIE jest UUID-em (stare zamówienia mają same cyfry),
   zostaje w całości: ucięty numer cyfrowy wskazywałby inne zamówienie. */

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]+$/i;

export function krotkiNumerZamowienia(id: string): string {
  return UUID.test(id) ? id.slice(0, 8) : id;
}
