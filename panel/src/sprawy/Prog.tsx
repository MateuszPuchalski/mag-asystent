import { dzien } from "../ui";
import { sprawSlowo } from "./Moje";
import type { ProgKolejki } from "../api/typy";

/* ── Próg daty nad kolejką spraw ─────────────────────────────────────────────
   POWSTAŁO Z DWÓCH ZDAŃ WŁAŚCICIELA: „w kolejce pojawiają mi się stare
   reklamacje" i „pokaż tylko reklamacje od 1 lipca 2026".

   Przyczyna była nasza w całości. Pełny przelot listy dołożony w 0.273.0
   zapisuje CAŁE archiwum konta, a zapytanie kolejki nie miało ani filtra
   statusu, ani okna czasowego, ani limitu — do przeglądarki jechała zawartość
   całej tabeli. Porządek dołożył drugą połowę: `decyzja_do ASC` stawia termin
   sprzed pół roku NAD dzisiejszym, więc archiwum lądowało nie gdziekolwiek,
   tylko na samej górze.

   PRÓG DATY JEST NARZĘDZIEM TĘPYM i ten pasek jest za to zapłatą. Próg nie
   pyta, czy sprawa jest skończona — pyta, kiedy wpłynęła. Dlatego mówi wprost,
   ile schował, i dlatego osobno liczy sprawy, które nadal mają żywy obowiązek.
   Zniknięcie z kolejki musi mieć widoczne uzasadnienie: ta sama reguła, którą
   zwroty kupiły w 0.339.0.

   DATĘ PROGU RYSUJEMY W STREFIE PRZEGLĄDARKI, jak każdy inny znacznik czasu
   w panelu. Wartość wdrożeniowa to północ czasu lokalnego zapisana w UTC
   (`2026-06-30T22:00:00Z`), więc w Warszawie pasek mówi „1 lipca" — a na
   maszynie chodzącej w UTC powiedziałby „30 czerwca". Biuro siedzi w Polsce
   i cały panel liczy czas tak samo; osobna reguła TYLKO dla tej jednej daty
   byłaby drugim zegarem w aplikacji, która ma jeden.                        */

/**
 * Pasek progu — co kolejka pokazuje i czego nie.
 *
 * MILCZY, GDY NIE MA CO POWIEDZIEĆ: bez progu albo przy zerze ukrytych pasek
 * ze zdaniem „starszych: 0" byłby samym szumem. Odzywa się dopiero wtedy, gdy
 * naprawdę coś chowa.
 */
export function PasekProgu({ prog, onPrzelacz }: {
  prog: ProgKolejki;
  onPrzelacz: (zdejmij: boolean) => void;
}) {
  if (!prog.od) return null;
  if (!prog.zdjety && prog.ukrytych <= 0) return null;

  /* CZERWIEŃ WYŁĄCZNIE PRZY ŻYWYM OBOWIĄZKU. Zwykle ta liczba jest zerem, bo
     próg stoi kwartał wstecz — ale dzień, w którym nie jest, jest dokładnie
     tym dniem, dla którego ją liczymy. Czerwony pasek przy zwykłym archiwum
     nauczyłby biuro go nie czytać, a wtedy nie zadziałałby wtedy, gdy trzeba. */
  const pilne = prog.ukrytychZTerminem > 0;
  const klasa = pilne
    ? "border-red-200 bg-red-50 text-red-900"
    : "border-slate-200 bg-slate-50 text-slate-600";

  return <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1
    rounded-lg border px-3 py-2 text-xs ${klasa}`}>
    {prog.zdjety
      ? <span>Pokazuję <b>wszystkie</b> sprawy, także sprzed {dzien(prog.od)}.</span>
      : <span>Kolejka pokazuje sprawy od <b>{dzien(prog.od)}</b>.
        Starszych: <b className="tabular-nums">{prog.ukrytych}</b>.</span>}
    {pilne && !prog.zdjety && <span>
      <b>Uwaga: {sprawSlowo(prog.ukrytychZTerminem)} sprzed progu ma jeszcze
        termin decyzji.</b> Próg chowa wtedy pracę, a nie archiwum.
    </span>}
    <button type="button" onClick={() => onPrzelacz(!prog.zdjety)}
      className="ml-auto py-1 font-semibold underline">
      {prog.zdjety ? "wróć do progu" : "pokaż starsze"}
    </button>
  </div>;
}
