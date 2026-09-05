/* ── Ile sztuk liczymy przy zwrocie (0.212.0) ────────────────────────────────
   `ilosc` niesie DEKLARACJĘ klienta z Allegro i nadpisuje ją synchronizator
   przy każdym takcie. `ilosc_zwrocona` niesie to, co biuro naprawdę znalazło
   w kartonie, i nie rusza jej nic poza biurem.

   OSOBNY PLIK, choć to jedna linia. Regułę czytają dwa moduły — `zwroty.ts`
   (kwota, sygnał rozjazdu) i `kosze-zwrotow.ts` (ilość na dokumencie MM) —
   a te dwa i tak już się importują w jedną stronę. Postawienie jej w którymś
   z nich domknęłoby cykl: przy module ESM wczytanym jako pierwszy wiązanie
   z drugiej strony bywa jeszcze puste. Dwie kopie tej samej decyzji też
   odpadają — rozjazd znaczyłby tu dokument MM na inną liczbę sztuk niż
   wypłata.                                                                  */

/**
 * Ile sztuk LICZYMY: to, co wróciło, a gdy nikt nie liczył — deklaracja.
 *
 * Puste `ilosc_zwrocona` to nie to samo co zero. Zero jest zdaniem „klient
 * zgłosił dwie, nie wróciła żadna"; puste znaczy „nikt jeszcze nie otworzył
 * kartonu" i wtedy jedyną liczbą, jaką mamy, jest deklaracja.
 */
export const iloscLiczona = (p: { ilosc: unknown; ilosc_zwrocona?: unknown }): number =>
  p.ilosc_zwrocona == null ? Number(p.ilosc) : Number(p.ilosc_zwrocona);
