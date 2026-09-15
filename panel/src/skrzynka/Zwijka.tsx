import React from "react";
import type { LucideIcon } from "lucide-react";

/**
 * ZWIJANY BLOK — jedna implementacja dla całej karty Copilota (0.342.0).
 *
 * Zgłoszenie właściciela: „panel jest zbyt zatłoczony, użyj technik, aby
 * zwiększyć obszar roboczy". Na jego zrzucie pod szkicem stały trzy bloki,
 * każdy otwarty, każdy zjadający wysokość niezależnie od tego, czy agent
 * właśnie go potrzebuje.
 *
 * Dekalog ergonomii, punkt 2, obowiązuje panel tak samo jak kolektor:
 * „reszta zostaje wizualnie drugorzędna albo ukryta; szczegóły chowa
 * `Collapsible`, a nie kolejny ekran". Ten plik jest panelowym odpowiednikiem
 * tamtego `Collapsible.kt`.
 *
 * DLACZEGO WSPÓLNY, a nie trzy razy `useState` w trzech plikach: trzy kopie
 * rozjechałyby się przy pierwszej poprawce, a różnica między nimi jest
 * wyłącznie w treści nagłówka. Tak samo jak przy `wTransakcji` — jedna reguła,
 * wielu wołających.
 *
 * STAN LICZY SIĘ RAZ, przy pierwszym renderze. Przeliczanie go przy każdym
 * odświeżeniu zamykałoby blok agentowi pod ręką; rodzic steruje resetem przez
 * `key`, tak jak robi to karta szkicu czasem powstania szkicu.
 */
export function Zwijka(p: {
  tytul: string;
  /** Ikona nagłówka; bez niej blok ma sam tytuł. */
  Ikona?: LucideIcon;
  /** Zdanie obok tytułu — mówi, CO jest w środku, gdy blok jest zamknięty. */
  podpis?: string;
  /** Plakietka wołająca o uwagę, np. „1 do sprawdzenia”. */
  plakietka?: React.ReactNode;
  domyslnieOtwarte?: boolean;
  children: React.ReactNode;
}) {
  const [otwarte, setOtwarte] = React.useState(p.domyslnieOtwarte ?? false);
  const { Ikona } = p;

  return <div className="mt-2 rounded border border-slate-200 bg-white">
    <button
      type="button"
      className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-slate-700"
      aria-expanded={otwarte}
      onClick={() => setOtwarte(!otwarte)}
    >
      {Ikona && <Ikona size={14} aria-hidden="true" />}
      <span className="font-semibold">{p.tytul}</span>
      {p.podpis && <span className="min-w-0 truncate text-slate-500">{p.podpis}</span>}
      {p.plakietka}
      <span className="ml-auto shrink-0 text-slate-500">{otwarte ? "zwiń" : "rozwiń"}</span>
    </button>
    <div className="border-t border-slate-100" hidden={!otwarte}>{p.children}</div>
  </div>;
}
