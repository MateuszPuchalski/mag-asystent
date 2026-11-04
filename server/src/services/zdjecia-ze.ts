import { towaryZeZdjeciem, type TowarZeZdjeciem } from "../adapters/zdjecia.sgt.js";
import { calkowita, oczekujace, powodWylaczenia } from "./zdjecia-bez.js";

/* ── Lista kartotek ZE zdjęciem — szukanie niewyraźnych ──────────────────────
   Odczyt i nic więcej, jak lista braków: otwarcie niczego nie zapisuje.
   Panel przechodzi ją stronami, mierzy zdjęcia w przeglądarce i dopiero
   zamiana idzie osobną trasą zapisu. */

export interface PozycjaZeZdjeciem extends TowarZeZdjeciem {
  /** Zdjęcie leży w WERTIS i czeka na Subiekt; tego towaru nie ma co mierzyć. */
  oczekuje: boolean;
}

export interface ListaZeZdjeciem {
  wlaczone: boolean;
  powod?: string;
  razem: number;
  pozycje: PozycjaZeZdjeciem[];
}

type Zrodlo = typeof towaryZeZdjeciem;
let zrodlo: Zrodlo = towaryZeZdjeciem;

/** Wyłącznie dla testów: w CI nie ma bazy Subiekta, a trasa ma się dać sprawdzić. */
export function ustawZrodloZeZdjeciem(fn: Zrodlo | null): void {
  zrodlo = fn ?? towaryZeZdjeciem;
}

/* Domyślnie pełna strona, bo panel zbiera całą listę naraz, zanim zacznie
   mierzyć. Mniejsza strona to tylko więcej zapytań do Subiekta. */
export const LIMIT_ZE_ZDJECIEM = 200;

/**
 * Strona listy. Powód wyłączenia ten sam co w liście braków, bo obie stoją
 * na tych samych kluczach. Wyjątek źródła przechodzi wyżej jako awaria.
 */
export async function listaZeZdjeciem(zapytanie: { limit?: unknown; offset?: unknown }): Promise<ListaZeZdjeciem> {
  const powod = powodWylaczenia();
  if (powod) return { wlaczone: false, powod, razem: 0, pozycje: [] };

  const limit = calkowita(zapytanie.limit, LIMIT_ZE_ZDJECIEM, 1, LIMIT_ZE_ZDJECIEM);
  const offset = calkowita(zapytanie.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const { razem, pozycje } = await zrodlo({ limit, offset });
  const czeka = oczekujace(pozycje.map((p) => p.twId));
  return {
    wlaczone: true,
    razem,
    pozycje: pozycje.map((p) => ({ ...p, oczekuje: czeka.has(p.twId) })),
  };
}
