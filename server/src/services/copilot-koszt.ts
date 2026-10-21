/* ── Cennik i pomiar kosztu Copilota (etap F) ────────────────────────────────

   CENNIK STOI W KODZIE, A W BAZIE STOJĄ TOKENY. Kwota zapisana przy wierszu
   jest kłamstwem od dnia, w którym dostawca zmieni ceny; liczba tokenów jest
   faktem na zawsze. Przeliczamy przy odczycie, więc zmiana cennika poprawia
   też historię — i to jest właściwe zachowanie, bo pytanie brzmi „ile to
   kosztuje", a nie „ile zapłaciliśmy w marcu".

   Ceny odczytane 24 czerwca 2026 z cennika Anthropic (dolary za milion
   tokenów). Modele 5.5 i stawki odczytu cache sprawdzone 21 października 2026
   na platform.claude.com/docs/en/about-claude/pricing.

   Zapis do cache to 1,25 ceny wejścia u każdego modelu, ale tylko dla cache
   pięciominutowego. Copilot stawia `cache_control` bez `ttl`, więc innego nie
   zapisuje; godzinny kosztowałby dwa razy wejście. Odczyt cache NIE jest
   wszędzie taki sam: Opus 5.5 i Sonnet 5.5 czytają za 0,05 ceny wejścia,
   reszta za 0,1. Stąd stawka odczytu w cenniku tam, gdzie odbiega od reguły. */

/** Dolary za MILION tokenów. Klucz to dokładny identyfikator modelu, tak jak
    zwraca go API w polu `model` — bez przyrostków, bo Copilot woła aliasy. */
const CENNIK: Record<string, { wej: number; wyj: number; cacheOdczyt?: number }> = {
  "claude-opus-5-5": { wej: 4, wyj: 20, cacheOdczyt: 0.2 },
  "claude-opus-5": { wej: 5, wyj: 25 },
  "claude-sonnet-5-5": { wej: 2, wyj: 10, cacheOdczyt: 0.1 },
  "claude-sonnet-5": { wej: 2, wyj: 10 },
  /* Haiku 5.5 ma drugi cennik dla promptu ponad 100 tysięcy tokenów (pięć razy
     drożej), liczony per wywołanie. Tu stoi tylko pierwszy, bo pomiar sumuje
     tokeny wielu wywołań jednego modelu przed przeliczeniem i próg
     zadziałałby na sumie. Prompty Copilota są o rząd wielkości krótsze. */
  "claude-haiku-5-5": { wej: 0.1, wyj: 0.5 },
  "claude-haiku-4-5": { wej: 1, wyj: 5 },
  /* Jev (TypeSafe), odczyt z docs.typesafe.ai/models 3 października 2026:
     0,042 dolara za milion tokenów wejścia, wyjście darmowe. Bez wpisu Jev
     liczyłby się stawką najdroższego modelu, ponad sto razy za drogo. */
  "jev-1.13.0": { wej: 0.042, wyj: 0 },
};

/* Model spoza cennika nie ma prawa policzyć się jako darmowy — zero na ekranie
   kosztów wygląda jak „nic nie wydaliśmy", a znaczy „nie wiem". Bierzemy więc
   stawkę najdroższego znanego modelu i mówimy o tym wprost w polu `znanyModel`. */
const NAJDROZSZY = { wej: 5, wyj: 25 };

/* Reguła dla modeli bez własnej stawki odczytu w cenniku, także nieznanych.
   Dla nieznanego to stawka najdroższa, więc koszt nie wychodzi zaniżony. */
const MNOZNIK_CACHE_ODCZYT = 0.1;
const MNOZNIK_CACHE_ZAPIS = 1.25;

/* Wyszukiwanie w sieci (0.507.0): 10 dolarów za tysiąc zapytań, NIEZALEŻNIE
   od modelu — stąd stała obok cennika, a nie pole w nim. Pobranie strony
   (`web_fetch`) osobnej opłaty nie ma; płaci się za jej tokeny. */
const USD_ZA_WYSZUKIWANIE = 0.01;

export interface Tokeny {
  wej: number;
  wyj: number;
  cacheZapis: number;
  cacheOdczyt: number;
  /** Zapytania do wyszukiwarki. Brak = zero; płatne od sztuki, nie od tokenu. */
  wyszukiwania?: number;
}

/** Koszt jednego wywołania w dolarach. */
export function kosztUsd(model: string, t: Tokeny): number {
  const c: { wej: number; wyj: number; cacheOdczyt?: number } = CENNIK[model] ?? NAJDROZSZY;
  const odczyt = c.cacheOdczyt ?? c.wej * MNOZNIK_CACHE_ODCZYT;
  const usd =
    (t.wej * c.wej +
      t.cacheZapis * c.wej * MNOZNIK_CACHE_ZAPIS +
      t.cacheOdczyt * odczyt +
      t.wyj * c.wyj) /
    1_000_000
    + (t.wyszukiwania ?? 0) * USD_ZA_WYSZUKIWANIE;
  /* Zaokrąglenie do centa byłoby tu zerem przy każdym pojedynczym wywołaniu
     (jedna klasyfikacja to ułamek centa), więc trzymamy sześć miejsc. */
  return Number(usd.toFixed(6));
}

export const znanyModel = (model: string): boolean => model in CENNIK;
