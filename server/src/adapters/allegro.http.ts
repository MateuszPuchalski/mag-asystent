import { config } from "../config.js";
import { allegroUserAgent } from "./allegro.js";
import { wazneBearer } from "../services/allegro-token.js";
import type {
  AllegroAdapter,
  PaczkaZwrotu,
  PozycjaZwrotuAllegro,
  ZamowienieAllegro,
  ZwrotAllegro,
} from "./allegro.js";

/* ── Allegro — implementacja HTTP ────────────────────────────────────────────
   Globalny `fetch` (Node ≥22.5), zero zależności. Nagłówki wg dokumentacji:
   Accept + Bearer z serwisu tokena. WERSJA ZASOBU SIEDZI W NAGŁÓWKU `Accept`
   i NIE jest jedna dla całego API: zasoby stabilne biorą `public.v1`, zasoby
   w becie (m.in. zwroty klienckie) — `beta.v1`. Zły nagłówek to 406
   NotAcceptableException, a nie pusty wynik, więc `zapytaj` próbuje obu
   i zapamiętuje działający dla danej rodziny końcówek.

   Budowa URL-i i mapowanie JSON→typy są CZYSTYMI funkcjami eksportowanymi
   osobno — to jedyna logika tego pliku i jedyne, co da się przetestować bez
   sieci. Granicą testów jest adapter (jak przy Sferze): tras nie testuje się
   przez mockowanie fetch, tylko na adapterze dev.

   Kształt pola powodu zwrotu w `items[]` jest [WERYFIKUJ] na sandboxie —
   mapowanie niżej przyjmuje obie znane postacie (obiekt reason/userComment
   i płaski string) i dla nieznanej zwraca uczciwe NULL-e zamiast wyjątku:
   zwrot bez powodu na ekranie jest lepszy niż skan kończący się błędem 500. */

const TIMEOUT_MS = 10_000;

/** URL listy zwrotów filtrowanej jednym z pól paczki. */
export function urlZwrotow(
  apiUrl: string,
  pole: "parcels.waybill" | "parcels.transportingWaybill",
  waybill: string
): string {
  return `${apiUrl}/order/customer-returns?${encodeURIComponent(pole)}=${encodeURIComponent(waybill)}&limit=20`;
}

export function urlZwrotu(apiUrl: string, id: string): string {
  return `${apiUrl}/order/customer-returns/${encodeURIComponent(id)}`;
}

export function urlZamowienia(apiUrl: string, orderId: string): string {
  return `${apiUrl}/order/checkout-forms/${encodeURIComponent(orderId)}`;
}

const tekst = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const liczba = (v: unknown, def: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : def;

/**
 * Powód zwrotu z pozycji — obie znane postacie naraz.
 * Nieznana postać daje NULL-e, nigdy wyjątek.
 */
export function mapujPowod(item: Record<string, unknown>): { powod: string | null; opis: string | null } {
  const r = item.reason;
  if (r && typeof r === "object") {
    const ro = r as Record<string, unknown>;
    return {
      powod: tekst(ro.name) ?? tekst(ro.type) ?? null,
      opis: tekst(ro.userComment) ?? tekst(item.userComment) ?? null,
    };
  }
  return { powod: tekst(r), opis: tekst(item.userComment) };
}

/** Zwrot kliencki z JSON-a API → typ domenowy. Defensywne na każdym polu. */
export function mapujZwrot(json: unknown): ZwrotAllegro {
  const z = (json ?? {}) as Record<string, unknown>;
  const buyer = (z.buyer ?? {}) as Record<string, unknown>;
  const items = Array.isArray(z.items) ? z.items : [];
  const parcels = Array.isArray(z.parcels) ? z.parcels : [];

  const pozycje: PozycjaZwrotuAllegro[] = items.map((it) => {
    const i = (it ?? {}) as Record<string, unknown>;
    const offer = (i.offer ?? {}) as Record<string, unknown>;
    const { powod, opis } = mapujPowod(i);
    return {
      offerId: tekst(i.offerId) ?? tekst(offer.id),
      nazwa: tekst(i.name) ?? tekst(offer.name) ?? "(bez nazwy)",
      externalId: null, // zwrot sygnatury NIE niesie — dokleja ją zamówienie
      ilosc: liczba(i.quantity, 1),
      powod,
      powodOpis: opis,
    };
  });

  const paczki: PaczkaZwrotu[] = parcels.map((p) => {
    const pp = (p ?? {}) as Record<string, unknown>;
    return {
      waybill: tekst(pp.waybill),
      transportingWaybill: tekst(pp.transportingWaybill),
      przewoznik: tekst(pp.transportingCarrierId) ?? tekst(pp.carrierId),
    };
  });

  return {
    id: tekst(z.id) ?? "",
    orderId: tekst(z.orderId),
    referencja: tekst(z.referenceNumber),
    status: tekst(z.status),
    utworzono: tekst(z.createdAt),
    kupujacyLogin: tekst(buyer.login),
    kupujacyEmail: tekst(buyer.email),
    pozycje,
    paczki,
    surowe: json,
  };
}

/** Zamówienie (checkout-form) → typ domenowy: tylko to, co potrzebne dopasowaniu. */
export function mapujZamowienie(json: unknown): ZamowienieAllegro {
  const z = (json ?? {}) as Record<string, unknown>;
  const buyer = (z.buyer ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(z.lineItems) ? z.lineItems : [];
  return {
    id: tekst(z.id) ?? "",
    kupujacyLogin: tekst(buyer.login),
    kupujacyEmail: tekst(buyer.email),
    pozycje: lineItems.map((li) => {
      const l = (li ?? {}) as Record<string, unknown>;
      const offer = (l.offer ?? {}) as Record<string, unknown>;
      const external = (offer.external ?? {}) as Record<string, unknown>;
      return {
        offerId: tekst(offer.id),
        nazwa: tekst(offer.name) ?? "(bez nazwy)",
        externalId: tekst(external.id),
        ilosc: liczba(l.quantity, 1),
      };
    }),
  };
}

/**
 * Wersje zasobów w nagłówku `Accept`. Kolejność jest istotna: pytamy najpierw
 * o zasób stabilny, a `beta.v1` jest zapasem dla końcówek, których Allegro
 * jeszcze nie wypromowało (zwroty klienckie w chwili pisania). Odwrotna
 * kolejność kazałaby stabilnym zasobom chodzić bez potrzeby przez betę.
 */
const AKCEPTY = [
  "application/vnd.allegro.public.v1+json",
  "application/vnd.allegro.beta.v1+json",
] as const;

/**
 * Rodzina końcówki — pierwszy segment ścieżki po `/order/`, np.
 * `customer-returns`. Po niej zapamiętujemy działający nagłówek: jedna beta
 * nie ma prawa przestawiać wersji wszystkim pozostałym zapytaniom.
 */
export function rodzinaKoncowki(url: string): string {
  const m = /\/order\/([^/?]+)/.exec(url);
  return m ? m[1] : "inne";
}

/* Nauczone nagłówki. Cache w pamięci procesu — 406 zdarza się raz, przy
   pierwszym zapytaniu po starcie, a nie przy każdym skanie etykiety. */
const dzialajacyAccept = new Map<string, string>();

export class HttpAllegroAdapter implements AllegroAdapter {
  private async zapytaj(url: string): Promise<unknown | null> {
    const bearer = await wazneBearer();
    const rodzina = rodzinaKoncowki(url);
    const znany = dzialajacyAccept.get(rodzina);
    const doProbowania = znany ? [znany] : [...AKCEPTY];

    let ostatnia406 = "";
    for (const accept of doProbowania) {
      let odp: Response;
      try {
        odp = await fetch(url, {
          headers: {
            accept,
            authorization: `Bearer ${bearer}`,
            /* Obowiązkowy wg Allegro — brak prawidłowego User-Agenta grozi
               zablokowaniem klucza API (ekran po rejestracji aplikacji). */
            "user-agent": allegroUserAgent(),
          },
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

      /* 406 = zła WERSJA zasobu, nie zły token ani brak danych. Próbujemy
         kolejnego nagłówka zamiast pokazywać biuru surowy błąd Allegro. */
      if (odp.status === 406) {
        ostatnia406 = await odp.text().catch(() => "");
        dzialajacyAccept.delete(rodzina);
        continue;
      }

      if (odp.status === 404) return null;
      if (odp.status === 401) {
        throw new Error(
          "Allegro odrzuciło token (401) — sparuj konto ponownie: /biuro → ZWROTY → KONTO ALLEGRO."
        );
      }
      if (odp.status === 403) {
        throw new Error(
          "Brak uprawnienia do zwrotów klienckich (403) — aplikacja na developer.allegro.pl " +
            "musi mieć scope allegro:api:orders:read."
        );
      }
      if (!odp.ok) {
        const tresc = await odp.text().catch(() => "");
        throw new Error(`Allegro odpowiedziało ${odp.status}: ${tresc.slice(0, 300)}`);
      }

      dzialajacyAccept.set(rodzina, accept);
      return odp.json();
    }

    /* Żaden ze znanych nagłówków nie przeszedł. Zapamiętany nagłówek mógł się
       zdezaktualizować (Allegro wypromowało zasób), więc kasujemy go wyżej
       i mówimy wprost, czego spróbowaliśmy. */
    throw new Error(
      `Allegro nie akceptuje żadnej znanej wersji zasobu (406) dla ${rodzina}. ` +
        `Próbowano: ${doProbowania.join(", ")}. ${ostatnia406.slice(0, 200)}`
    );
  }

  async szukajZwrotowPoWaybill(waybill: string): Promise<ZwrotAllegro[]> {
    /* Dwa zapytania ŚWIADOMIE, nie jedno z OR (API nie ma OR): etykieta u drzwi
       nosi numer przewoźnika doręczającego, a numer nadania zna Allegro.
       Deduplikacja po id, bo paczka z tym samym numerem w obu polach wróci
       z obu zapytań. */
    const wyniki: ZwrotAllegro[] = [];
    for (const pole of ["parcels.waybill", "parcels.transportingWaybill"] as const) {
      const json = (await this.zapytaj(urlZwrotow(config.allegro.apiUrl, pole, waybill))) as
        | Record<string, unknown>
        | null;
      const lista = Array.isArray(json?.customerReturns) ? json.customerReturns : [];
      for (const z of lista) {
        const zm = mapujZwrot(z);
        if (!wyniki.some((w) => w.id === zm.id)) wyniki.push(zm);
      }
    }
    return wyniki;
  }

  async zwrot(id: string): Promise<ZwrotAllegro | null> {
    const json = await this.zapytaj(urlZwrotu(config.allegro.apiUrl, id));
    return json === null ? null : mapujZwrot(json);
  }

  async zamowienie(orderId: string): Promise<ZamowienieAllegro | null> {
    const json = await this.zapytaj(urlZamowienia(config.allegro.apiUrl, orderId));
    return json === null ? null : mapujZamowienie(json);
  }
}
