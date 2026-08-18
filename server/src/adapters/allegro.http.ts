import { config } from "../config.js";
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
   `Accept: application/vnd.allegro.public.v1+json` + Bearer z serwisu tokena.

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

export class HttpAllegroAdapter implements AllegroAdapter {
  private async zapytaj(url: string): Promise<unknown | null> {
    const bearer = await wazneBearer();
    let odp: Response;
    try {
      odp = await fetch(url, {
        headers: {
          accept: "application/vnd.allegro.public.v1+json",
          authorization: `Bearer ${bearer}`,
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
    return odp.json();
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
