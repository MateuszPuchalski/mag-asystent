import type { EnvFileResult } from "../env-file.js";
import { KLUCZE, NAZWY_GRUP, type Grupa, type Kto, type Program } from "../konfiguracja-rejestr.js";

/* ── Stan konfiguracji do panelu (0.488.0) ───────────────────────────────────
   Odpowiedź na pytanie „na czym ten serwer faktycznie chodzi" bez pulpitu
   zdalnego. Dotąd znała ją tylko maszyna z Subiektem: plik `wertis.env`,
   zmienne środowiskowe usług NSSM i wartości domyślne w kodzie, każde w innym
   miejscu.

   Źródło każdej wartości idzie obok niej, bo to ono tłumaczy niespodzianki.
   Wartość przykryta zmienną środowiskową usługi była już raz przyczyną
   wdrożenia, które przeszło kreator i wylądowało na demówce (`env-file.ts`).

   SEKRETY NIE WYCHODZĄ. Dla klucza `tajny` odpowiedź niesie wyłącznie to, czy
   jest ustawiony. Trasa jest za rolą admina, ale odpowiedź HTTP bywa
   logowana i kopiowana do zgłoszeń, a hasło nie ma tam czego szukać.      */

export type Zrodlo = "plik" | "przykryte" | "srodowisko" | "domyslna";

export interface WierszKonfiguracji {
  klucz: string;
  grupa: Grupa;
  kto: Kto;
  opis: string;
  czyta: readonly Program[];
  tajny: boolean;
  /**
   * - `plik` — z `wertis.env`;
   * - `przykryte` — w pliku stoi co innego, ale wygrała zmienna środowiskowa;
   * - `srodowisko` — tylko zmienna środowiskowa, pliku to nie dotyczy;
   * - `domyslna` — nigdzie nie ustawione, działa wartość z kodu.
   */
  zrodlo: Zrodlo;
  /** `null` dla sekretu i dla wartości domyślnej. */
  wartosc: string | null;
}

export interface StanKonfiguracji {
  plik: string | null;
  grupy: Record<Grupa, string>;
  wiersze: WierszKonfiguracji[];
  /** Klucze z pliku, których nie czyta żaden program — zwykle literówki. */
  nieznane: string[];
}

export function stanKonfiguracji(
  env: EnvFileResult,
  srodowisko: NodeJS.ProcessEnv = process.env,
): StanKonfiguracji {
  const wPliku = new Set(env.applied);
  const przykryte = new Set(env.overridden);
  const wiersze = KLUCZE.map((k): WierszKonfiguracji => {
    const zrodlo: Zrodlo = przykryte.has(k.klucz) ? "przykryte"
      : wPliku.has(k.klucz) ? "plik"
      : srodowisko[k.klucz] !== undefined ? "srodowisko"
      : "domyslna";
    const surowa = zrodlo === "domyslna" ? null : srodowisko[k.klucz] ?? null;
    return {
      klucz: k.klucz,
      grupa: k.grupa,
      kto: k.kto,
      opis: k.opis,
      czyta: k.czyta ?? ["serwer"],
      tajny: k.tajny === true,
      zrodlo,
      wartosc: k.tajny ? null : surowa,
    };
  });
  const znane = new Set(KLUCZE.map((k) => k.klucz));
  const nieznane = [...env.applied, ...env.overridden].filter((k) => !znane.has(k)).sort();
  return { plik: env.path, grupy: NAZWY_GRUP, wiersze, nieznane };
}
