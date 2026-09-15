/* ── Korekta wchodzi do read-modelu dopiero przy DRUGIM imporcie (0.350.1) ──
   Blizna z produkcji, 15 września 2026. Worker Sfery zapisywał ZW do
   PA 745/MAG/09/2026; Subiekt nadał numer ZW 463/MAG/09/2026, wpisał
   dokument i ODMÓWIŁ zapisu, wycofując transakcję. Import czyta
   `dok__Dokument` z `WITH (NOLOCK)` — trafił dokładnie w tę chwilę, zobaczył
   niezatwierdzony wiersz, a `zwiazKorekte` przypiął zwrotowi numer dokumentu,
   którego w Subiekcie nigdy nie było. Biuro szukało go na próżno.

   `NOLOCK` zostaje: w dzienniku wdrożenia stoi zakleszczenie z Subiektem
   pracującym na tych samych tabelach, a sprzedaż i dostawy mogą widzieć
   brudny odczyt bez szkody. Korekta NIE MOŻE — jej numer zamyka zwrot
   i wypuszcza MM. Dlatego dopiero drugi import z rzędu, który ją widzi,
   wpuszcza ją do `sgt_faktura`. Wycofany zapis znika przed drugim odczytem,
   a prawdziwa korekta traci jedną rundę importu, czyli około minuty.

   PIERWSZY IMPORT PO WDROŻENIU wpuszcza wszystko: tabela widzianych jest
   wtedy pusta, a zatrzymanie każdej korekty na rundę kosztowałoby rundę
   wiązania bez żadnego zysku — trafienie w cudzy zapis właśnie w tej minucie
   jest mniej prawdopodobne niż cała reszta dnia.                          */

export interface DokumentSprzedazy {
  dok_Id: number;
  dok_Typ: number;
}

export function dojrzaleKorekty<T extends DokumentSprzedazy>(
  faktury: readonly T[],
  typyKorekt: ReadonlySet<number>,
  widziane: ReadonlySet<number>,
): { doZapisu: T[]; korekty: number[] } {
  const jestKorekta = (f: T) => typyKorekt.has(Number(f.dok_Typ));
  const korekty = faktury.filter(jestKorekta).map((f) => Number(f.dok_Id));
  const pierwszyImport = widziane.size === 0;
  const doZapisu = faktury.filter(
    (f) => !jestKorekta(f) || pierwszyImport || widziane.has(Number(f.dok_Id)));
  return { doZapisu, korekty };
}
