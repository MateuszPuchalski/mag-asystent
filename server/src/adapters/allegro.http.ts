import { config } from "../config.js";
import { BladLimituAllegro, BladOdpowiedziAllegro, allegroUserAgent, retryAfterMs } from "./allegro.js";
import { wazneBearer } from "../services/allegro-token.js";

/* ── Allegro — połączenie HTTP ───────────────────────────────────────────────
   Globalny `fetch` (Node ≥22.5), zero zależności. Nagłówki wg dokumentacji:
   Accept + Bearer z serwisu tokena. WERSJA ZASOBU SIEDZI W NAGŁÓWKU `Accept`
   i NIE jest jedna dla całego API: zasoby stabilne biorą `public.v1`, zasoby
   w becie (m.in. zwroty klienckie) — `beta.v1`. Zły nagłówek to 406
   NotAcceptableException, a nie pusty wynik, więc `zapytajAllegro` próbuje
   obu i zapamiętuje działający dla danej rodziny końcówek.

   DO 0.137.2 STAŁA TU CAŁA OBSŁUGA KLIENTA: klasa `HttpAllegroAdapter`
   i komplet funkcji `mapuj*`, które przerabiały JSON Allegro na nasze typy.
   Odeszły razem z rejestrami, bo to one były usterką: kształt, który
   odwzorowywały, wymyśliliśmy w testach i nigdy nie sprawdziliśmy na żywym
   koncie. Nowe mapowanie ma powstać dopiero po raporcie sondy
   (`npm run sonda` → `docs/allegro-ksztalt.md`), pole po polu.

   Zostaje samo połączenie: budowa URL-i dziewięciu rodzin końcówek, negocjacja
   nagłówka `Accept` i jedno wyjście do sieci. Z tego korzysta dziś sonda,
   a jutro nowa obsługa klienta.                                             */

const TIMEOUT_MS = 10_000;

/**
 * Strona ostatnich zamówień — zejście dla ZAMASKOWANEGO rozmówcy
 * (`client:NNN`): lista wątków nie daje loginu, więc zamówienia filtrujemy
 * po stronie klienta po `buyer.id` (ten sam wzorzec co `watekKupujacego`).
 */
export function urlOstatnichZamowien(apiUrl: string, odKiedyIso: string, offset: number): string {
  return (
    `${apiUrl}/order/checkout-forms?updatedAt.gte=${encodeURIComponent(odKiedyIso)}` +
    `&limit=100&offset=${Math.max(0, Math.trunc(offset))}&sort=-updatedAt`
  );
}

/**
 * URL strony listy zwrotów klienckich. `createdAt.gte` odcina to, co już
 * znamy, a paginacja idzie setkami — jedna strona pokrywa tydzień zwrotów
 * nawet w szczycie.
 *
 * `from` to KURSOR, nie offset: dokumentacja opisuje go jako „identyfikator
 * ostatnio widzianego zwrotu", a odpowiedź niesie zwroty utworzone po nim.
 * Kursor jest odporny na wstawkę w środku strony, a offset nie — przy
 * stronicowaniu offsetem nowy zwrot przesuwa całą resztę o jeden i jeden
 * rekord wypada bez śladu. To jest blizna 0.127.0 („rejestr widział pierwszą
 * setkę dyskusji i gubił resztę po cichu") załatwiona u źródła.
 */
export function urlListyZwrotow(
  apiUrl: string,
  odKiedy: string | null,
  offset: number,
  odKursora: string | null = null,
  waybill: string | null = null
): string {
  const filtr = odKiedy ? `&createdAt.gte=${encodeURIComponent(odKiedy)}` : "";
  const kursor = odKursora ? `&from=${encodeURIComponent(odKursora)}` : "";
  /* Filtr po numerze listu przewozowego (0.163.0). Allegro ma go gotowego —
     `parcels.waybill` w `getCustomerReturns` — a my używamy go dokładnie raz:
     gdy skan etykiety nie trafił w nic, co już mamy u siebie. Pytamy wtedy
     o TEN JEDEN numer, nie o stronę zwrotów.

     `transportingWaybill` osobnym filtrem nie idzie: Allegro nie łączy filtrów
     alternatywą, a dwa żądania przy jednym skanie to dwa razy więcej limitu
     wydanego na przypadek, który w tej firmie jest rzadki. */
  const list = waybill ? `&parcels.waybill=${encodeURIComponent(waybill)}` : "";
  return (
    `${apiUrl}/order/customer-returns?limit=100&offset=${Math.max(0, Math.trunc(offset))}` +
    `${filtr}${kursor}${list}`
  );
}

/**
 * Jedno zamówienie (`/order/checkout-forms/{id}`).
 *
 * Zwrot niesie sam numer zamówienia, a decyzja potrzebuje jego treści: co
 * jeszcze klient kupił, ile kosztowała dostawa i — to najważniejsze — jaki
 * SKU ma sprzedana oferta. `checkoutForm.lineItems[].offer.external.id`
 * (schemat `OfferReference` w `docs/allegro/swagger.yaml`) to identyfikator
 * oferty w systemie sprzedawcy, czyli u tej firmy symbol z Subiekta.
 *
 * Jedno wywołanie na ZAMÓWIENIE, nie na ofertę. `/sale/product-offers/{id}`
 * dałoby ten sam SKU po jednym strzale na pozycję i nie dałoby ani kosztu
 * dostawy, ani pozycji, których klient nie zwraca.
 */
export function urlZamowienia(apiUrl: string, id: string): string {
  return `${apiUrl}/order/checkout-forms/${encodeURIComponent(id)}`;
}

/**
 * Jedna oferta (`/sale/product-offers/{id}`) — po zdjęcia.
 *
 * Wchodzi dopiero tam, gdzie SKU nie trafił w kartotekę, bo kosztuje
 * wywołanie na ofertę. `/sale/product-offers/{id}/parts` NIE jest tańszym
 * zamiennikiem: schemat dopuszcza w `include` wyłącznie `stock` i `price`,
 * więc zdjęć tamtędy nie ma.
 */
export function urlOferty(apiUrl: string, offerId: string): string {
  return `${apiUrl}/sale/product-offers/${encodeURIComponent(offerId)}`;
}

/**
 * Oferty SPRZEDAWCY po numerach (`/sale/offers?offer.id=…`) — po tytuł, cenę
 * i SKU. Parametr `offer.id` jest w specyfikacji TABLICĄ, więc dwadzieścia
 * ofert kosztuje jedno żądanie, a nie dwadzieścia.
 *
 * To nie jest to samo, co `urlOferty` obok: tamta końcówka oddaje JEDNĄ ofertę
 * ze zdjęciami i kosztuje wywołanie na sztukę. Tytuł do rozmowy bierzemy stąd,
 * bo pytań pod ofertami przychodzi kilka naraz i każde niesie inny numer.
 *
 * `limit` ustawiamy na długość listy, nie na domyślne dwadzieścia: gdy kiedyś
 * podniesiemy partię, cicha domyślna dwudziestka obcięłaby odpowiedź w połowie
 * i część ofert zostałaby bez tytułu bez jednego słowa w logu.
 */
export function urlOfertSprzedawcy(apiUrl: string, ids: readonly string[]): string {
  const filtr = ids.map((id) => `offer.id=${encodeURIComponent(id)}`).join("&");
  return `${apiUrl}/sale/offers?${filtr}&limit=${Math.max(1, ids.length)}`;
}

/**
 * Historia statusów przesyłki u przewoźnika (0.187.0).
 *
 * `GET /order/carriers/{carrierId}/tracking?waybill=…`. To JEDYNE miejsce
 * w całym API, które podaje CZAS doręczenia: obiekt zwrotu go nie ma, a jego
 * `parcels[]` niesie tylko datę nadania. Do 0.186.0 panel twierdził wprost,
 * że „Allegro nie podaje daty doręczenia do nas" — nieprawda wzięta ze zbyt
 * wąskiego czytania jednego schematu.
 *
 * Dwadzieścia numerów na żądanie, bo tyle dopuszcza `maxItems` w specyfikacji.
 * Limit jest tu regułą poprawności, nie oszczędnością: dłuższa lista wraca
 * błędem 400, więc partię tnie WOŁAJĄCY, a nie ten builder.
 */
export const TRACKING_NA_ZADANIE = 20;

export function urlTrackingu(
  apiUrl: string, carrierId: string, waybille: readonly string[],
): string {
  if (waybille.length > TRACKING_NA_ZADANIE) {
    throw new Error(
      `Tracking przyjmuje najwyżej ${TRACKING_NA_ZADANIE} numerów, dostał ${waybille.length}.`);
  }
  const filtr = waybille.map((w) => `waybill=${encodeURIComponent(w)}`).join("&");
  return `${apiUrl}/order/carriers/${encodeURIComponent(carrierId)}/tracking?${filtr}`;
}

/**
 * Szczegół jednego zwrotu (`/order/customer-returns/{id}`, Accept beta.v1).
 *
 * Lista oddaje już komplet pól zwrotu, więc ta końcówka NIE jest potrzebna
 * do synchronizacji — stoi tu dla sondy i dla ręcznego sprawdzenia jednego
 * zwrotu, gdy lista i panel mówią co innego.
 */
export function urlZwrotu(apiUrl: string, id: string): string {
  return `${apiUrl}/order/customer-returns/${encodeURIComponent(id)}`;
}

/**
 * Roszczenia o zwrot prowizji (`/order/refund-claims`). Osobny byt od zwrotu
 * pieniędzy kupującemu: tamten oddaje kasę klientowi, ten odzyskuje prowizję
 * od Allegro. Panel pokazuje oba, bo zwrot bez odzyskanej prowizji kosztuje
 * dwa razy.
 */
export function urlRoszczenProwizji(apiUrl: string, offset: number): string {
  return `${apiUrl}/order/refund-claims?limit=100&offset=${Math.max(0, Math.trunc(offset))}`;
}

/**
 * Jeden wniosek o rabat (`/order/refund-claims/{claimId}`).
 *
 * Używane WYŁĄCZNIE do anulowania (`DELETE`). Specyfikacja pisze przy nim
 * „this cannot be undone" — anulowania nie da się cofnąć, ale sam wniosek
 * anulować można, i to dlatego złożenie dostaje w panelu cofnięcie zamiast
 * dialogu potwierdzenia (§25a.5).
 */
export function urlWnioskuORabat(apiUrl: string, claimId: string): string {
  return `${apiUrl}/order/refund-claims/${encodeURIComponent(claimId)}`;
}

/** URL listy dyskusji i reklamacji (`/sale/issues`, Accept beta.v1). */
export function urlDyskusji(apiUrl: string, offset: number): string {
  return `${apiUrl}/sale/issues?limit=100&offset=${Math.max(0, Math.trunc(offset))}`;
}

/**
 * Opinie o sprzedawcy (0.135.0). `/sale/user-ratings` przyjmuje `offset`
 * i `limit`; filtra daty NIE dokumentuje, więc granicę tniemy po naszej
 * stronie ([WERYFIKUJ] na żywym koncie razem z kształtem pól).
 */
export function urlOpinii(apiUrl: string, offset: number): string {
  return `${apiUrl}/sale/user-ratings?limit=100&offset=${Math.max(0, Math.trunc(offset))}`;
}

/**
 * Rozmowa w sprawie posprzedażowej (`/sale/issues/{issueId}/chat`).
 *
 * DO 0.155.0 STAŁ TU ADRES, KTÓREGO ALLEGRO NIE MA. Kod pukał do
 * `/sale/disputes/{id}/messages`, a w całej specyfikacji nie ma ani jednej
 * ścieżki `/sale/disputes` — sonda oddała przy tej końcówce zero rekordów,
 * choć `chat.messagesCount` na tych samych sprawach był większy od zera.
 *
 * Komentarz obok prosił o sprawdzenie, „czy id spraw i dyskusji dzielą
 * przestrzeń". Dzielą: specyfikacja opisuje `issueId` jako „Dispute or claim
 * identifier". Zgadnięte było co innego — sam adres.
 */
export function urlWiadomosciDyskusji(apiUrl: string, id: string): string {
  /* `limit` JAWNIE, bo specyfikacja daje przy tej końcówce domyślne 10 — a nie
     100 jak przy listach obok. Bez tego próbka sondy była cicho przycięta
     i nikt by się nie dowiedział, że rozmowa ma dalszy ciąg. */
  return `${apiUrl}/sale/issues/${encodeURIComponent(id)}/chat?limit=100`;
}

/** Lista wątków Centrum wiadomości. Allegro pozwala najwyżej 20 na stronę. */
export function urlWatkow(apiUrl: string, offset: number): string {
  return `${apiUrl}/messaging/threads?limit=20&offset=${Math.max(0, Math.trunc(offset))}`;
}

export function urlWiadomosci(apiUrl: string, threadId: string): string {
  return `${apiUrl}/messaging/threads/${encodeURIComponent(threadId)}/messages`;
}

/**
 * Znacznik „wątek przeczytany" (`PUT /messaging/threads/{id}/read`, 0.195.0).
 *
 * Ciało to `{ read: true }` ze schematu `ThreadReadFlag` — pole jest
 * `required`, a specyfikacja wprost wymienia 422 „missing flag in the request
 * body". Uprawnienie `allegro:api:messaging`, to samo co odczyt i wysyłka,
 * więc nowego scope'u parowanie NIE potrzebuje.
 */
export function urlPrzeczytaniaWatku(apiUrl: string, threadId: string): string {
  return `${apiUrl}/messaging/threads/${encodeURIComponent(threadId)}/read`;
}

/** Deklaracja załącznika przed wgraniem (`POST /messaging/message-attachments`). */
export function urlDeklaracjiZalacznika(apiUrl: string): string {
  return `${apiUrl}/messaging/message-attachments`;
}

/** Wgranie binariów zadeklarowanego załącznika (`PUT .../{attachmentId}`). */
export function urlWgraniaZalacznika(apiUrl: string, attachmentId: string): string {
  return `${apiUrl}/messaging/message-attachments/${encodeURIComponent(attachmentId)}`;
}

/* Wersje zasobu, po kolei. `public.v1` to zasoby stabilne, `beta.v1` — te
   w becie; zły nagłówek daje 406, nie pusty wynik. */
const AKCEPTY = [
  "application/vnd.allegro.public.v1+json",
  "application/vnd.allegro.beta.v1+json",
] as const;

/**
 * Rodzina końcówki — pierwszy segment ścieżki po `/order/`, `/sale/` albo
 * `/messaging/`, np. `customer-returns` czy `issues`. Po niej zapamiętujemy
 * działający nagłówek: jedna beta (dziś `/sale/issues`) nie ma prawa
 * przestawiać wersji wszystkim pozostałym zapytaniom.
 */
export function rodzinaKoncowki(url: string): string {
  const m = /\/(?:order|sale|messaging)\/([^/?]+)/.exec(url);
  return m ? m[1] : "inne";
}

/* Nauczone nagłówki. Cache w pamięci procesu — 406 zdarza się raz, przy
   pierwszym zapytaniu po starcie, a nie przy każdym skanie etykiety. */
const dzialajacyAccept = new Map<string, string>();

/**
 * Uprawnienie (scope) wymagane przez daną końcówkę — do komunikatu 403.
 *
 * Nazwa uprawnienia w treści odmowy jest jedyną rzeczą, od której da się
 * zacząć naprawę; gołe 403 nie prowadzi donikąd, a rodzin końcówek mamy
 * już cztery.
 */
export function scopeDlaUrl(url: string, metoda: string = "GET"): string {
  /* ZAPIS na zamówieniach żąda OSOBNEGO uprawnienia — `orders:write`, nie
     `orders:read`. Do 0.164.0 ta funkcja patrzyła na sam adres, więc odmowa
     przy składaniu wniosku o rabat kazałaby dodać uprawnienie, które konto
     już ma. Dokładnie ta pomyłka kosztowała wydanie przy opiniach (0.155.0):
     zła instrukcja jest gorsza niż jej brak, bo wysyła człowieka po coś,
     co ma, i każe sparować konto ponownie bez skutku. */
  if (metoda !== "GET" && url.includes("/order/")) return "allegro:api:orders:write";
  /* Płatności mają WŁASNE uprawnienie i to jest ta sama lekcja, co przy
     opiniach w 0.155.0: bez tej gałęzi zwrot pieniędzy wpadał w domyślne
     `orders:read`, a odmowa 403 kazałaby dodać uprawnienie, które konto już
     ma. Zwrot pieniędzy żąda `payments:write` — innego niż cokolwiek, co ta
     aplikacja miała do 0.190.0. */
  if (url.includes("/payments/")) {
    return metoda === "GET" ? "allegro:api:payments:read" : "allegro:api:payments:write";
  }
  if (url.includes("/messaging/")) return "allegro:api:messaging";
  /* `product-offers` PRZED `offers`: pierwszy wzorzec zawiera drugi jako
     podciąg tylko przy odwrotnej kolejności sprawdzania, ale oba i tak
     żądają tego samego uprawnienia — kolejność jest tu dla czytelnika. */
  if (url.includes("/sale/product-offers")) return "allegro:api:sale:offers:read";
  if (url.includes("/sale/offers")) return "allegro:api:sale:offers:read";
  /* Dyskusje: odczyt spraw, rozmowa i załączniki — jedno uprawnienie.
     [WERYFIKUJ] czy obejmuje też ZAPISY; jeśli nie, 403 i tak wskaże scope. */
  /* Cała rodzina spraw posprzedażowych — lista, rozmowa i załączniki — stoi
     na jednym uprawnieniu (specyfikacja przy `/sale/issues/{issueId}/chat`). */
  if (url.includes("/sale/issues")) return "allegro:api:disputes";
  /* Opinie mają WŁASNE uprawnienie i to jest poprawka z 0.155.0. Bez tej
     gałęzi adres wpadał w domyślne `orders:read` i odmowa 403 kazała dodać
     uprawnienie, które sonda właśnie z powodzeniem WYKORZYSTAŁA do pobrania
     stu zamówień. Zła instrukcja jest gorsza niż jej brak: wysyła człowieka
     po coś, co już ma, i każe sparować konto ponownie bez skutku. */
  if (url.includes("/sale/user-ratings")) return "allegro:api:ratings";
  return "allegro:api:orders:read";
}

/**
 * Jedno zapytanie do Allegro: token, nauka nagłówka `Accept`, tłumaczenie
 * 401/403/406/429 na zdania po ludzku. Surowy JSON, bez mapowania.
 *
 * Na poziomie MODUŁU, nie w klasie (0.137.2): sonda kształtu (`npm run sonda`)
 * potrzebuje dokładnie tej obsługi błędów, a nie potrzebuje ani jednego
 * mapowania. Drugi klient HTTP obok tego znaczyłby drugie miejsce, w którym
 * trzeba pamiętać o User-Agencie i o wersjach zasobów.
 *
 * Do 0.80.0 ten klient tylko CZYTAŁ. Wysyłka odpowiedzi klientowi jest
 * pierwszym zapisem — te same nagłówki i ta sama nauka `Accept`, więc metoda
 * i ciało doszły jako opcje zamiast drugiej funkcji obok.
 */
export async function zapytajAllegro(
  url: string,
  opcje: {
    metoda?: "POST" | "PUT" | "DELETE";
    body?: unknown;
    /**
     * Ciało BINARNE — plik, nie JSON (0.195.0). `PUT /messaging/message-attachments/{id}`
     * jako jedyny nasz zapis nie przyjmuje wersji zasobu w `content-type`:
     * specyfikacja wymienia przy nim `image/png`, `image/jpeg`, `image/gif`,
     * `image/bmp`, `image/tiff` i `application/pdf`, i nic poza tym. Wersję
     * zasobu negocjujemy dalej w `accept`, bo ODPOWIEDŹ jest zwykłym JSON-em.
     */
    plik?: { dane: Uint8Array; typ: string };
  } = {}
): Promise<unknown | null> {
  const bearer = await wazneBearer();
  const rodzina = rodzinaKoncowki(url);
  const znany = dzialajacyAccept.get(rodzina);
  const doProbowania = znany ? [znany] : [...AKCEPTY];

  /* Treść ostatniej odmowy wersji — 406 przy odczycie, 415 przy zapisie. */
  let ostatniaOdmowaWersji = "";
  for (const accept of doProbowania) {
    let odp: Response;
    try {
      odp = await fetch(url, {
        method: opcje.metoda ?? "GET",
        headers: {
          accept,
          authorization: `Bearer ${bearer}`,
          /* Obowiązkowy wg Allegro — brak prawidłowego User-Agenta grozi
             zablokowaniem klucza API (ekran po rejestracji aplikacji). */
          "user-agent": allegroUserAgent(),
          /* CIAŁO IDZIE TĄ SAMĄ WERSJĄ ZASOBU, którą negocjujemy w `accept`
             (0.173.0). Do 0.172.0 stało tu `application/json` — typ, którego
             specyfikacja NIE WYMIENIA przy żadnym z naszych dwóch zapisów:
             `POST /messaging/threads/{id}/messages` deklaruje wyłącznie
             `application/vnd.allegro.public.v1+json` i `…beta.v1+json`,
             a `POST /order/refund-claims` — tylko pierwszy z nich.

             To jest dokładnie ta klasa zgadnięcia, która kosztowała ten
             projekt trzy wydania przy mapowaniu odczytu: kształt wzięty
             z pamięci zamiast z pliku. Odpowiedzią na niezadeklarowany typ
             treści jest 415, czyli odmowa BEZ objawu w panelu poza „nie
             udało się wysłać". */
          ...(opcje.plik ? { "content-type": opcje.plik.typ }
            : opcje.body === undefined ? {} : { "content-type": accept }),
        },
        body: opcje.plik ? opcje.plik.dane
          : opcje.body === undefined ? undefined : JSON.stringify(opcje.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      /* Timeout i DNS to najczęstsze awarie — komunikat ma mówić, CO sprawdzić,
         bo „fetch failed" na ekranie biura nie prowadzi donikąd. */
      throw new Error(
        `Brak połączenia z Allegro (${config.allegro.apiUrl}) — sprawdź internet ` +
          `na serwerze. (${e instanceof Error ? e.message : e})`
      );
    }

    /* 406 = zła WERSJA zasobu w `accept`, 415 = w `content-type`. Jedno i
       drugie znaczy „nie ta wersja", więc obie odpowiedzi prowadzą do próby
       z następnym nagłówkiem — a nie do surowego błędu na ekranie biura.

       WYJĄTEK: ciało binarne (0.195.0). Tam `content-type` NIE jest wersją
       zasobu, tylko typem pliku, więc 415 znaczy „Allegro nie przyjmuje
       takiego pliku" i powtórzenie z innym `accept` nic nie zmieni — poleci
       drugi raz i skończy się komunikatem o wersji zasobu, czyli zdaniem
       nieprawdziwym. Odmowa typu pliku ma dojść do agenta taka, jaka jest. */
    if (odp.status === 406 || (odp.status === 415 && !opcje.plik)) {
      ostatniaOdmowaWersji = await odp.text().catch(() => "");
      dzialajacyAccept.delete(rodzina);
      continue;
    }

    if (odp.status === 404) return null;
    if (odp.status === 401) {
      throw new BladOdpowiedziAllegro(
        "Allegro odrzuciło token (401) — sparuj konto ponownie: " +
          "/biuro → STAN SYSTEMU → KONTO ALLEGRO.",
        401
      );
    }
    if (odp.status === 403) {
      throw new BladOdpowiedziAllegro(
        `Brak uprawnienia (403) — aplikacja na developer.allegro.pl musi mieć scope ` +
          `${scopeDlaUrl(url, opcje.metoda ?? "GET")}. Po dodaniu uprawnienia ` +
          `sparuj konto ponownie: ` +
          "token wydany pod stary zakres sam się nie rozszerzy.",
        403
      );
    }
    if (odp.status === 429) {
      /* Limit zapytań. Bez ponowienia — ale z klasą, po której takt
         tickerów wie, ile odczekać, a człowiek dostaje zdanie, nie kod. */
      const poIluMs = retryAfterMs(odp.headers.get("retry-after"), Date.now());
      throw new BladLimituAllegro(
        "Allegro prosi o przerwę (429) — za dużo zapytań w krótkim czasie." +
          (poIluMs !== null ? ` Spróbuj za ${Math.ceil(poIluMs / 1000)} s.` : ""),
        poIluMs
      );
    }
    if (!odp.ok) {
      const tresc = await odp.text().catch(() => "");
      throw new BladOdpowiedziAllegro(
        `Allegro odpowiedziało ${odp.status}: ${tresc.slice(0, 300)}`, odp.status);
    }

    dzialajacyAccept.set(rodzina, accept);
    /* 204 i puste ciało to poprawna odpowiedź na PUT/POST — `json()` na
       pustce rzuca, a odhaczenie wątku niczego nie zwraca. */
    if (odp.status === 204) return null;
    const surowa = await odp.text();
    if (surowa.trim() === "") return null;
    try {
      return JSON.parse(surowa);
    } catch {
      return null;
    }
  }

  /* Żaden ze znanych nagłówków nie przeszedł. Zapamiętany nagłówek mógł się
     zdezaktualizować (Allegro wypromowało zasób), więc kasujemy go wyżej
     i mówimy wprost, czego spróbowaliśmy. */
  throw new Error(
    `Allegro nie akceptuje żadnej znanej wersji zasobu (406/415) dla ${rodzina}. ` +
      `Próbowano: ${doProbowania.join(", ")}. ${ostatniaOdmowaWersji.slice(0, 200)}`
  );
}

/**
 * Pobranie załącznika wiadomości — jedyne wyjście do Allegro po BAJTY (0.155.0).
 *
 * Osobno od `zapytajAllegro`, bo tamta funkcja negocjuje `Accept` wersją zasobu
 * i parsuje JSON. Tutaj obie te rzeczy są niepotrzebne, a jedna z nich szkodzi:
 * plik nie ma wersji zasobu i nie jest JSON-em.
 *
 * Adres bierzemy z odpowiedzi Allegro (`attachments[].url`), więc sprawdzamy,
 * czy prowadzi do Allegro — nasz serwer nie ma się stać bramką do dowolnego
 * miejsca w internecie, kiedy odpowiedź kiedyś zmieni kształt albo ktoś dopisze
 * wiersz do bazy ręcznie.
 */
const HOSTY_ZALACZNIKOW = ["allegro.pl", "allegro.pl.allegrosandbox.pl"];

export async function pobierzZalacznik(url: string): Promise<ArrayBuffer> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Adres załącznika nie jest poprawnym URL-em: ${url.slice(0, 80)}`);
  }
  if (!HOSTY_ZALACZNIKOW.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new Error(`Adres załącznika prowadzi poza Allegro (${host}) — pobranie wstrzymane.`);
  }

  const bearer = await wazneBearer();
  let odp: Response;
  try {
    odp = await fetch(url, {
      headers: { authorization: `Bearer ${bearer}`, "user-agent": allegroUserAgent() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(
      `Nie udało się pobrać załącznika z Allegro — sprawdź internet na serwerze. ` +
        `(${e instanceof Error ? e.message : e})`
    );
  }
  if (!odp.ok) {
    throw new BladOdpowiedziAllegro(
      `Allegro nie oddało załącznika (${odp.status}).`, odp.status);
  }
  return odp.arrayBuffer();
}

/**
 * Złożenie wniosku o rabat transakcyjny — PIERWSZY ZAPIS na zamówieniach.
 *
 * Ciało jest dosłownie takie, jak `RefundClaimRequest` w specyfikacji:
 * pozycja zamówienia i ilość, nic więcej. `lineItemId` to identyfikator
 * POZYCJI ZAMÓWIENIA (`lineItems[].id`), nie oferty — szuka go
 * `services/rabaty.ts` i tylko stamtąd ma prawo tu trafić.
 *
 * Uprawnienie to `allegro:api:orders:write`, inne niż przy odczycie; pilnuje
 * tego `scopeDlaUrl` z metodą, żeby odmowa 403 nazwała właściwe.
 */
/**
 * Zwrot pieniędzy kupującemu — `POST /payments/refunds` (0.190.0).
 *
 * Ciało układa `services/zwrot-pieniedzy.ts`; tutaj jest samo wyjście do
 * sieci. Cztery pola stoją w `required` schematu `InitializeRefund`:
 * `payment`, `order`, `commandId` i `reason` — i wszystkie cztery muszą tu
 * dojechać, bo braku żadnego z nich nie da się nadrobić po stronie Allegro.
 *
 * `commandId` NIE POWSTAJE TUTAJ. Gdyby powstawał, każde ponowienie po
 * zerwanej sieci dostawałoby nowy identyfikator, czyli drugi przelew zamiast
 * powtórzenia tego samego. Identyfikator żyje przy zwrocie w bazie.
 *
 * Uprawnienie: `allegro:api:payments:write` — inne niż `orders:write` przy
 * rabacie i inne niż wszystko, co ta aplikacja miała wcześniej.
 */
export async function zwrocPlatnosc(
  apiUrl: string, ciało: Record<string, unknown>,
): Promise<{ id?: string; status?: string } | null> {
  return await zapytajAllegro(`${apiUrl}/payments/refunds`, {
    metoda: "POST", body: ciało,
  }) as { id?: string; status?: string } | null;
}

/**
 * Odmowa zwrotu pieniędzy — `POST /order/customer-returns/{id}/rejection`.
 *
 * NAZWA MÓWI O ODMOWIE ZWROTU PIENIĘDZY, nie o odrzuceniu samego zwrotu, i
 * panel nazywa to tak samo. Kupujący dalej ma zwrot; my odmawiamy wypłaty
 * i podajemy powód.
 *
 * Końcówka jest w specyfikacji oznaczona `[BETA]` i deklaruje WYŁĄCZNIE
 * `application/vnd.allegro.beta.v1+json` — inaczej niż zwrot pieniędzy, który
 * bierze `public.v1`. Nagłówek negocjuje `zapytajAllegro`, więc nie ma tu
 * wpisanej wersji: ta sama nauka `Accept` obsługuje obie rodziny.
 */
export async function odmowZwrotuPieniedzy(
  apiUrl: string, zwrotId: string, kod: string, powod: string | null,
): Promise<unknown | null> {
  return await zapytajAllegro(
    `${apiUrl}/order/customer-returns/${encodeURIComponent(zwrotId)}/rejection`,
    { metoda: "POST", body: { rejection: powod ? { code: kod, reason: powod } : { code: kod } } },
  );
}

export async function zglosRabat(
  apiUrl: string, lineItemId: string, ilosc: number,
): Promise<{ id?: string } | null> {
  return await zapytajAllegro(`${apiUrl}/order/refund-claims`, {
    metoda: "POST",
    body: { lineItem: { id: lineItemId }, quantity: Math.max(1, Math.round(ilosc)) },
  }) as { id?: string } | null;
}
