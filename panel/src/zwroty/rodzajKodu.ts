/* ── Etykieta czy towar: rozpoznanie skanu (0.468.0) ─────────────────────────
   Zgłoszenie właściciela: „zakładka zwrotów powinna cały czas nasłuchiwać
   skanu etykiety zwrotowej oraz odróżniać ją od skanu EAN-u produktu".
   Do tego wydania każdy skan szedł do szukania zwrotu, a EAN towaru kończył
   się zdaniem „Nie znam kodu" — choć operator miał produkt w ręku i chciał go
   włożyć do pudła.

   KSZTAŁT PLUS CYFRA KONTROLNA, a nie sama długość. EAN-8, UPC-A (12),
   EAN-13 i GTIN-14 to same cyfry z cyfrą kontrolną GS1. Etykiety przewoźników
   bywają cyfrowe (InPost ma 24 znaki, GLS 12), więc długość sama by się
   myliła. Cyfra kontrolna odsiewa dziewięć z dziesięciu takich zbiegów.

   To jest TYLKO PODEJRZENIE. Ostatnie słowo ma kartoteka: kod w kształcie
   EAN-u, którego kartoteka nie zna, wraca do szukania zwrotu (`Zwroty.tsx`).
   Numer GLS, który przypadkiem przejdzie cyfrę kontrolną, nie zgubi się więc
   w koszyku.                                                                */

/** Czy kod ma kształt EAN-8, UPC-A, EAN-13 albo GTIN-14 z poprawną cyfrą kontrolną. */
export function wygladaNaEan(kod: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(kod)) return false;
  const cyfry = [...kod].map(Number);
  const kontrolna = cyfry.pop() as number;
  /* GS1 liczy wagi OD PRAWEJ: cyfra tuż przed kontrolną waży 3, następna 1.
     Liczenie od lewej dawałoby dobry wynik tylko dla długości parzystych. */
  let suma = 0;
  cyfry.reverse().forEach((c, i) => { suma += c * (i % 2 === 0 ? 3 : 1); });
  return (10 - (suma % 10)) % 10 === kontrolna;
}
