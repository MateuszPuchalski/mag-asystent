/* ── Cennik i pomiar kosztu Copilota (etap F) ────────────────────────────────

   CENNIK STOI W KODZIE, A W BAZIE STOJĄ TOKENY. Kwota zapisana przy wierszu
   jest kłamstwem od dnia, w którym dostawca zmieni ceny; liczba tokenów jest
   faktem na zawsze. Przeliczamy przy odczycie, więc zmiana cennika poprawia
   też historię — i to jest właściwe zachowanie, bo pytanie brzmi „ile to
   kosztuje", a nie „ile zapłaciliśmy w marcu".

   Ceny odczytane 24 czerwca 2026 z cennika Anthropic (dolary za milion
   tokenów). Odczyt cache to około jedna dziesiąta ceny wejścia, zapis do cache
   około 1,25 raza — stąd osobne mnożniki zamiast osobnych stawek.            */

/** Dolary za MILION tokenów. Klucz to dokładny identyfikator modelu. */
const CENNIK: Record<string, { wej: number; wyj: number }> = {
  "claude-opus-5": { wej: 5, wyj: 25 },
  "claude-sonnet-5": { wej: 2, wyj: 10 },
  "claude-haiku-4-5": { wej: 1, wyj: 5 },
};

/* Model spoza cennika nie ma prawa policzyć się jako darmowy — zero na ekranie
   kosztów wygląda jak „nic nie wydaliśmy", a znaczy „nie wiem". Bierzemy więc
   stawkę najdroższego znanego modelu i mówimy o tym wprost w polu `znanyModel`. */
const NAJDROZSZY = { wej: 5, wyj: 25 };

const MNOZNIK_CACHE_ODCZYT = 0.1;
const MNOZNIK_CACHE_ZAPIS = 1.25;

export interface Tokeny {
  wej: number;
  wyj: number;
  cacheZapis: number;
  cacheOdczyt: number;
}

/** Koszt jednego wywołania w dolarach. */
export function kosztUsd(model: string, t: Tokeny): number {
  const c = CENNIK[model] ?? NAJDROZSZY;
  const usd =
    (t.wej * c.wej +
      t.cacheZapis * c.wej * MNOZNIK_CACHE_ZAPIS +
      t.cacheOdczyt * c.wej * MNOZNIK_CACHE_ODCZYT +
      t.wyj * c.wyj) /
    1_000_000;
  /* Zaokrąglenie do centa byłoby tu zerem przy każdym pojedynczym wywołaniu
     (jedna klasyfikacja to ułamek centa), więc trzymamy sześć miejsc. */
  return Number(usd.toFixed(6));
}

export const znanyModel = (model: string): boolean => model in CENNIK;
