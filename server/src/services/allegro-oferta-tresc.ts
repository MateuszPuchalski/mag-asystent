import { config } from "../config.js";
import { db as defaultDb, type Db } from "../db/db.js";
import { urlOferty, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { odkodujEncje } from "../tekst.js";

/* ── Treść oferty dla Copilota (0.253.0) ─────────────────────────────────────
   Właściciel: „często oferta ma w sobie opis, do jakich wersji pasuje, wymiary
   z oferty, dane techniczne". Copilot znał do 0.252.0 wyłącznie TYTUŁ oferty —
   `offer_snapshot.nazwa` — i odpowiadał bez wiedzy, którą sprzedawca sam
   zapisał kilka lat temu, klikając „wystaw".

   DLACZEGO OSOBNY PRZEBIEG, A NIE `allegro-oferty-sync.ts`. Tamten bierze
   tytuł, cenę, SKU i zdjęcie z `GET /sale/offers`, gdzie `offer.id` jest
   TABLICĄ — dwadzieścia ofert kosztuje jedno żądanie. Opisu tamta odpowiedź
   nie niesie. Opis, parametry i lista zgodności stoją wyłącznie w
   `GET /sale/product-offers/{offerId}` (`SaleProductOfferResponseV1`
   w `docs/allegro/swagger.yaml`), czyli jedno żądanie NA OFERTĘ.

   Dwudziestokrotność ceny rozstrzyga o kształcie: tego się nie synchronizuje
   hurtem. Dociągamy LENIWIE i tylko dla oferty, pod którą agent właśnie układa
   odpowiedź — czyli najwyżej raz na kliknięcie „Ułóż odpowiedź", i to raz na
   tydzień na ofertę. Konto z tysiącem ofert nie zapłaci tu ani jednego
   żądania za ofertę, o którą nikt nie zapytał.

   `/sale/product-offers/{id}/parts` NIE jest tańszą drogą: schemat dopuszcza
   w `include` wyłącznie `stock` i `price`.                                   */

/**
 * Jak długo treść oferty jest świeża — TYDZIEŃ, nie doba jak przy cenie.
 *
 * Powód jest po stronie danych, nie oszczędności: cenę sprzedawca poprawia co
 * kilka dni, a opis pisze raz i wraca do niego przy zmianie asortymentu.
 * Doba kosztowałaby siedem razy więcej żądań za tę samą treść.
 */
const SWIEZOSC_MS = 7 * 86_400_000;

/**
 * Sufit długości opisu w bazie.
 *
 * Specyfikacja dopuszcza 40 000 bajtów na sekcję opisu, a takich sekcji bywa
 * kilka. Do faktów Copilota i tak idzie dużo mniej (patrz `copilot-szkic.ts`),
 * ale przycięcie robimy JUŻ PRZY ZAPISIE: kolumna, która potrafi urosnąć do
 * setek kilobajtów na ofertę, obciąża każdy odczyt snapshotu, także ten, który
 * chce samego tytułu.
 */
const LIMIT_OPISU = 8000;

/* ── Kształt odpowiedzi, czytany ze SCHEMATU, nie z przykładu ───────────────
   `description.sections[].items[]` jest listą wariantów rozróżnianych polem
   `type`: `TEXT` niesie `content` (HTML), `IMAGE` niesie `url`. Obrazu nie
   czytamy — to nie jest miejsce na rozpoznawanie tekstu ze zdjęcia.

   `compatibilityList` ma dwie odmiany (`MANUAL`, `PRODUCT_BASED`) i OBIE
   oddają `items[].text`. Pozycja typu `ID` niesie sam identyfikator bez
   tekstu — dla człowieka nie znaczy nic, więc wypada.                       */
type PozycjaOpisu = { type?: string; content?: string; url?: string };
type Parametr = { name?: string; values?: string[] };
type OdpowiedzOferty = {
  description?: { sections?: Array<{ items?: PozycjaOpisu[] }> } | null;
  parameters?: Parametr[];
  compatibilityList?: { items?: Array<{ text?: string }> } | null;
};

/** Parametr oferty w naszym kształcie: nazwa pola i to, co sprzedawca wpisał. */
export type ParametrOferty = { nazwa: string; wartosci: string[] };

/** Treść jednej oferty po rozbiorze — dokładnie to, co ląduje w snapshocie. */
export interface TrescOferty {
  opis: string;
  parametry: ParametrOferty[];
  pasujeDo: string[];
}

/**
 * HTML opisu na tekst dla człowieka.
 *
 * Opis jedzie HTML-em — schemat podaje wprost `content: "<p>Example text</p>"`.
 * Model dostałby więc znaczniki zamiast zdań, a agent zobaczyłby je w oknie
 * „skąd to wiem". Rozbiór jest CELOWO ubogi: łamania linii tam, gdzie HTML je
 * miał, myślnik przed pozycją listy, reszta znaczników znika.
 *
 * Encje schodzą `odkodujEncje` — tą samą tablicą, którą 0.250.0 poszerzył
 * o alfabety sąsiadów. Opis oferty na rynkach czeskim i węgierskim ma je
 * dokładnie tak samo jak wiadomość od klienta.
 */
export function naTekst(html: string): string {
  const zTagami = html
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|ul|ol|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*\/?\s*td[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return odkodujEncje(zTagami)
    /* Twarda spacja (U+00A0) wygląda jak spacja i nią NIE jest: „148 mm"
       z opisu nie zrównałoby się z „148 mm" z kartoteki. Zapisujemy ją
       jawnym kodem, bo w źródle jest nie do odróżnienia od zwykłej. */
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Rozbiór odpowiedzi Allegro na to, co trzymamy. Czysta funkcja — testowalna bez sieci. */
export function zbierzTresc(body: OdpowiedzOferty | null): TrescOferty {
  const kawalki: string[] = [];
  for (const sekcja of body?.description?.sections ?? []) {
    for (const poz of sekcja.items ?? []) {
      if (poz.type !== "TEXT" || typeof poz.content !== "string") continue;
      const tekst = naTekst(poz.content);
      if (tekst) kawalki.push(tekst);
    }
  }
  const opis = kawalki.join("\n\n").slice(0, LIMIT_OPISU);

  const parametry: ParametrOferty[] = [];
  for (const p of body?.parameters ?? []) {
    const nazwa = (p.name ?? "").trim();
    const wartosci = (p.values ?? []).map((v) => odkodujEncje(String(v)).trim()).filter(Boolean);
    /* Parametr bez wartości to pole, którego sprzedawca nie wypełnił —
       w faktach byłby szumem udającym daną. */
    if (nazwa && wartosci.length) parametry.push({ nazwa, wartosci });
  }

  const pasujeDo = (body?.compatibilityList?.items ?? [])
    .map((i) => (typeof i?.text === "string" ? odkodujEncje(i.text).trim() : ""))
    .filter(Boolean);

  return { opis, parametry, pasujeDo };
}

export interface TrescOfertyDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  now?: () => Date;
  apiUrl?: string;
}

/**
 * Czy trzeba iść do Allegro po treść tej oferty.
 *
 * Dwa powody i ani jednego więcej: nigdy nie pytaliśmy (`tresc_synced_at`
 * NULL) albo pytanie zestarzało się o tydzień. Pusty opis przy wypełnionym
 * `tresc_synced_at` znaczy „pytaliśmy, sprzedawca opisu nie napisał" — to samo
 * rozróżnienie, które `primary_image_url` kupiło blizną w 0.214.0. Bez niego
 * oferta bez opisu kosztowałaby żądanie przy KAŻDYM szkicu.
 */
export function trzebaTresci(
  database: Db, konto: number, ofertaId: string, teraz = new Date(),
): boolean {
  const w = database.prepare(`SELECT tresc_synced_at AS kiedy FROM offer_snapshot
      WHERE channel_account_id=? AND external_id=?`).get(konto, ofertaId) as
    { kiedy: string | null } | undefined;
  /* Brak snapshotu to nie jest powód do żądania: numer oferty bez wiersza
     znaczy, że `allegro-oferty-sync` jeszcze go nie dociągnął, a my nie mamy
     gdzie zapisać odpowiedzi. Treść dojdzie przy następnym szkicu. */
  if (!w) return false;
  if (!w.kiedy) return true;
  return Date.parse(w.kiedy) < teraz.getTime() - SWIEZOSC_MS;
}

/**
 * Dociąga treść oferty i zapisuje ją w snapshocie. Zwraca `true`, gdy poszła
 * do sieci — po to, żeby dziennik mówił prawdę o koszcie.
 *
 * ZAPIS, więc NIE WOLNO wołać tego z odczytu ekranu (§ „zero zapisu przy
 * patrzeniu"). Miejsce jest jedno: `ulozSzkic`, czyli ścieżka na KLIKNIĘCIE
 * agenta, gdzie zapis i tak już jest.
 *
 * Odmowa Allegro nie wywraca szkicu. Szkic bez opisu jest wart dokładnie tyle,
 * ile był wart do 0.252.0 — a to jest wartość dodatnia. Wyjątkiem jest limit:
 * ten przerywa, bo kolejne żądanie pogłębiłoby przerwę.
 */
export async function dociagnijTresc(
  konto: number, ofertaId: string, deps: TrescOfertyDeps = {},
): Promise<boolean> {
  const database = deps.database ?? defaultDb();
  const now = deps.now ?? (() => new Date());
  const teraz = now();
  if (!trzebaTresci(database, konto, ofertaId, teraz)) return false;

  const query = deps.query ?? zapytajAllegro;
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  let tresc: TrescOferty;
  try {
    tresc = zbierzTresc((await query(urlOferty(apiUrl, ofertaId))) as OdpowiedzOferty | null);
  } catch (e) {
    if (e instanceof BladLimituAllegro) throw e;
    console.warn(`[allegro-oferta-tresc] ${ofertaId}: ${e instanceof Error ? e.message : e}`);
    return false;
  }

  database.prepare(`UPDATE offer_snapshot
      SET opis=?, parametry_json=?, pasuje_do_json=?, tresc_synced_at=?
    WHERE channel_account_id=? AND external_id=?`)
    .run(tresc.opis, JSON.stringify(tresc.parametry), JSON.stringify(tresc.pasujeDo),
      teraz.toISOString(), konto, ofertaId);
  return true;
}
