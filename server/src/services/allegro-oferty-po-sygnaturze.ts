import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlOfertPoSygnaturze, zapytajAllegro } from "../adapters/allegro.http.js";
import { kontoKanalu } from "./kanal-konto.js";
import { zapiszSnapshotOferty, type Oferta } from "./allegro-oferty-sync.js";
import { linkOferty } from "./allegro-linki.js";
import { zwin } from "../tekst.js";

/**
 * Którą z NASZYCH ofert sprzedajemy tę kartotekę (0.270.0).
 *
 * ── SKĄD TO WYDANIE ─────────────────────────────────────────────────────────
 * Właściciel, czytając szkic o presostacie: „model powinien proponować oferty,
 * jeśli jest pewny linki do ofert". Szkic zamiast linku pisał klientowi, żeby
 * poszukał po nazwie albo po kodzie EAN — czyli zadawał mu pracę, którą my
 * mamy zrobioną.
 *
 * Powód nie był w instrukcji modelu. **System nie miał katalogu własnych
 * ofert.** `allegro-oferty-sync.ts` mówi to w nagłówku wprost: „ten przebieg
 * nie chodzi po ofertach konta — dociąga wyłącznie te, na które wskazuje
 * wiadomość". Czyli `offer_snapshot` zna aukcje, pod którymi ktoś napisał,
 * i nic więcej. Odwrotnego wyszukania — „która nasza oferta sprzedaje
 * kartotekę X" — nie było w całym repozytorium, więc model nie dostawał ani
 * jednego adresu i nie mógł go podać.
 *
 * ── DLACZEGO PYTANIE, A NIE KATALOG ─────────────────────────────────────────
 * Alternatywą było przeciągnięcie wszystkich ofert konta do bazy własnym
 * taktem. Odrzucone: katalog trzeba by odświeżać, a nieświeży katalog produkuje
 * linki do aukcji, których już nie ma — czyli dokładnie tę awarię, której ta
 * funkcja ma zapobiec. `external.id` w specyfikacji jest TABLICĄ, więc komplet
 * kandydatów szkicu kosztuje JEDNO żądanie i wraca zawsze aktualny.
 *
 * ── DLACZEGO BŁĄD NIE PRZERYWA SZKICU ───────────────────────────────────────
 * Także limit 429, inaczej niż przy `dociagnijTresc`. Tamta reguła chroni
 * przed pogłębianiem przerwy drugim żądaniem — a to jest OSTATNIE żądanie
 * do Allegro na drodze szkicu, więc nie ma czego chronić. Szkic bez linku
 * jest wart tyle, ile był wart do 0.269.0; szkic, który nie powstał, nie jest
 * wart nic.
 */

/**
 * Ile sygnatur pytamy naraz. Tyle samo, co ofert w `allegro-oferty-sync`,
 * i z tego samego powodu: partia mieści się w jednym żądaniu, a długi ciąg
 * żądań z jednego adresu to sygnatura, po której Allegro odcina konto.
 */
export const SYGNATUR_NA_ZADANIE = 20;

export interface LinkDoOferty {
  /** Sygnatura, o którą pytaliśmy, czyli symbol kartoteki. */
  symbol: string;
  ofertaId: string;
  nazwa: string;
  link: string;
}

export interface LinkiDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  apiUrl?: string;
  accountId?: string;
  now?: () => Date;
}

type Odpowiedz = { offers?: Oferta[] };

/**
 * Mapa `zwin(symbol)` → aktywna oferta. Klucz zwinięty, bo sygnatura wraca
 * z Allegro tak, jak wpisał ją sprzedawca, a symbol kartoteki bywa zapisany
 * inaczej — to ta sama normalizacja, którą `dopasowanie-sku.ts` stosuje
 * w drugą stronę.
 *
 * Pusta mapa przy pustym wejściu i BEZ żądania: szkic bez kandydatów nie ma
 * o co pytać, a puste `external.id` w adresie oddałoby całą listę ofert konta.
 */
export async function ofertyPoSygnaturze(
  symbole: readonly string[], deps: LinkiDeps = {},
): Promise<Map<string, LinkDoOferty>> {
  const out = new Map<string, LinkDoOferty>();
  const widziane = new Set<string>();
  const pytane: string[] = [];
  for (const s of symbole) {
    const czysty = String(s ?? "").trim();
    const klucz = zwin(czysty);
    if (!czysty || !klucz || widziane.has(klucz)) continue;
    widziane.add(klucz);
    pytane.push(czysty);
    if (pytane.length >= SYGNATUR_NA_ZADANIE) break;
  }
  if (pytane.length === 0) return out;

  const query = deps.query ?? ((url: string) => zapytajAllegro(url));
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  let oferty: Oferta[] = [];
  try {
    const odp = await query(urlOfertPoSygnaturze(apiUrl, pytane)) as Odpowiedz | null;
    oferty = odp?.offers ?? [];
  } catch (e) {
    /* Każdy błąd, z limitem włącznie — patrz nagłówek pliku. */
    console.warn(`[oferty-po-sygnaturze] ${e instanceof Error ? e.message : e}`);
    return out;
  }

  const database = deps.database ?? defaultDb();
  const at = (deps.now ?? (() => new Date()))().toISOString();
  /* Skoro i tak zapytaliśmy, snapshot zapisujemy — to ten sam kształt
     odpowiedzi, którym żywi się `offer_snapshot`, a przy okazji rozmowa pod
     tą ofertą dostaje tytuł bez osobnego żądania. Jeden pisarz na tabelę:
     `zapiszSnapshotOferty`. */
  transaction(database, () => {
    const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
    for (const o of oferty) {
      if (!o.id) continue;
      zapiszSnapshotOferty(database, o, konto, at);
    }
  })();

  for (const o of oferty) {
    const sygnatura = String(o.external?.id ?? "").trim();
    const klucz = zwin(sygnatura);
    const link = linkOferty(o.id);
    /* Bez sygnatury nie wiadomo, do której kartoteki to przypiąć; bez linku
       nie ma czego podać klientowi. Jedno i drugie milczy, zamiast zgadywać. */
    if (!klucz || !link || !o.id) continue;
    /* PIERWSZA wygrywa. Ta sama kartoteka bywa na kilku aukcjach (zestaw,
       inna ilość); wybór „która lepsza" to decyzja handlowa, której ten kod
       nie ma prawa podejmować, a druga oferta w faktach kazałaby modelowi
       wybierać za nas. */
    if (out.has(klucz)) continue;
    out.set(klucz, { symbol: sygnatura, ofertaId: String(o.id), nazwa: String(o.name ?? ""), link });
  }
  return out;
}
