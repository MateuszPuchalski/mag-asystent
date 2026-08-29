import { config } from "../config.js";
import { BladLimituAllegro, allegroUserAgent, retryAfterMs } from "./allegro.js";
import { wazneBearer } from "../services/allegro-token.js";
import { odkodujEncje } from "../tekst.js";
import type {
  AllegroAdapter,
  DyskusjaAllegro,
  KupujacyRef,
  OfertaAllegro,
  PaczkaZwrotu,
  PozycjaZwrotuAllegro,
  PrzesylkaZamowienia,
  SzukanieWatku,
  WatekNaglowek,
  WiadomoscAllegro,
  WiadomoscDyskusji,
  ZamowienieAllegro,
  ZamowienieKupujacego,
  ZdarzenieSledzenia,
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

/**
 * Twardy limit stron listy wątków (20 wątków na stronę — maksimum Allegro).
 *
 * Normalnie przeszukiwanie kończy DATA: schodzimy do rozmów starszych niż
 * zwrot i przestajemy. Ten limit jest bezpiecznikiem na konto z ogromną
 * korespondencją, żeby jedno kliknięcie nie ciągnęło tysiąca stron.
 */
const STRON_WATKOW = 50;

/**
 * Ile dni przed zwrotem jeszcze nas interesuje rozmowa.
 *
 * Klient pisze zwykle PRZED odesłaniem paczki — o wadzie, o wymianie, o
 * zgodzie na zwrot. Miesiąc zapasu obejmuje typową historię takiej sprawy,
 * a nie każe schodzić przez lata rozmów konta.
 */
const DNI_WSTECZ = 30;

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

/* ── Przesyłki ostatnich zamówień (0.105.0) ──────────────────────────────────
   Trzy końcówki rodziny /order/ — wszystkie na scope `allegro:api:orders:read`
   ([WERYFIKUJ] dotyczy zwłaszcza śledzenia; jeśli sandbox odpowie 403,
   scopeDlaUrl dostanie gałąź dla /order/carriers/).                          */

/** Zamówienia po loginie kupującego. [WERYFIKUJ] parametr `sort`. */
export function urlZamowienKupujacego(apiUrl: string, login: string, limit: number): string {
  return (
    `${apiUrl}/order/checkout-forms?buyer.login=${encodeURIComponent(login)}` +
    `&limit=${Math.max(1, Math.trunc(limit))}&sort=-updatedAt`
  );
}

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

export function urlPrzesylekZamowienia(apiUrl: string, orderId: string): string {
  return `${apiUrl}/order/checkout-forms/${encodeURIComponent(orderId)}/shipments`;
}

export function urlSledzenia(apiUrl: string, przewoznikId: string, waybill: string): string {
  return (
    `${apiUrl}/order/carriers/${encodeURIComponent(przewoznikId)}/tracking` +
    `?waybill=${encodeURIComponent(waybill)}`
  );
}

/**
 * Zamówienie kupującego → typ pod odpowiedź „kiedy dojdzie". CELOWO osobny
 * mapper, nie rozszerzenie `mapujZamowienie`: tamten służy dopasowaniu
 * zwrotów i ma zostać wąski. Ten NIE dotyka `delivery.address` ani
 * `delivery.pickupPoint` — adres nie jest potrzebny do odpowiedzi o statusie,
 * a dane osobowe nie mają czego szukać w kontekście modelu (test tego pilnuje).
 */
export function mapujZamowienieKupujacego(json: unknown): ZamowienieKupujacego {
  const z = (json ?? {}) as Record<string, unknown>;
  const fulfillment = (z.fulfillment ?? {}) as Record<string, unknown>;
  const delivery = (z.delivery ?? {}) as Record<string, unknown>;
  const method = (delivery.method ?? {}) as Record<string, unknown>;
  const time = (delivery.time ?? {}) as Record<string, unknown>;
  const lineItems = Array.isArray(z.lineItems) ? z.lineItems : [];
  return {
    id: tekst(z.id) ?? "",
    kupionoAt: tekst(z.boughtAt) ?? tekst(z.updatedAt),
    status: tekst(z.status),
    wysylka: tekst(fulfillment.status),
    dostawaMetoda: tekst(method.name),
    smart: delivery.smart === true,
    dostawaOd: tekst(time.from),
    dostawaDo: tekst(time.to),
    pozycje: lineItems.map((li) => {
      const l = (li ?? {}) as Record<string, unknown>;
      const offer = (l.offer ?? {}) as Record<string, unknown>;
      const external = (offer.external ?? {}) as Record<string, unknown>;
      return {
        offerId: tekst(offer.id),
        nazwa: tekstLudzki(offer.name) ?? "(bez nazwy)",
        externalId: tekst(external.id),
        ilosc: liczba(l.quantity, 1),
      };
    }),
  };
}

/** Paczki zamówienia z `/shipments`. [WERYFIKUJ] nazwy pól na sandboxie. */
export function mapujPrzesylki(json: unknown): PrzesylkaZamowienia[] {
  const root = (json ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(root.shipments) ? root.shipments : [];
  return lista.map((it) => {
    const s = (it ?? {}) as Record<string, unknown>;
    return {
      waybill: tekst(s.waybill),
      przewoznikId: tekst(s.carrierId),
      przewoznik: tekst(s.carrierName),
      nadanoAt: tekst(s.createdAt),
    };
  });
}

/**
 * Historia śledzenia. Przyjmuje OBA znane kształty (zagnieżdżony
 * `carriers[0].trackingDetails.statuses` i płaski `statuses`) — zasób
 * [WERYFIKUJ], a nieznany kształt daje pustą listę, nie wyjątek.
 */
export function mapujSledzenie(json: unknown): ZdarzenieSledzenia[] {
  const root = (json ?? {}) as Record<string, unknown>;
  let statuses: unknown[] = Array.isArray(root.statuses) ? root.statuses : [];
  if (statuses.length === 0 && Array.isArray(root.carriers)) {
    const pierwszy = (root.carriers[0] ?? {}) as Record<string, unknown>;
    const details = (pierwszy.trackingDetails ?? {}) as Record<string, unknown>;
    if (Array.isArray(details.statuses)) statuses = details.statuses;
  }
  return statuses.map((it) => {
    const s = (it ?? {}) as Record<string, unknown>;
    return {
      kod: tekst(s.status) ?? tekst(s.code),
      opis: tekst(s.description),
      at: tekst(s.occurredAt) ?? tekst(s.date),
    };
  });
}

/**
 * URL strony listy zwrotów dla tickera zapowiedzi. `createdAt.gte` odcina to,
 * co już znamy, a paginacja idzie setkami — jedna strona pokrywa tydzień
 * zwrotów nawet w szczycie.
 */
export function urlListyZwrotow(apiUrl: string, odKiedy: string | null, offset: number): string {
  const filtr = odKiedy ? `&createdAt.gte=${encodeURIComponent(odKiedy)}` : "";
  return `${apiUrl}/order/customer-returns?limit=100&offset=${Math.max(0, Math.trunc(offset))}${filtr}`;
}

/** URL listy dyskusji i reklamacji (`/sale/issues`, Accept beta.v1). */
export function urlDyskusji(apiUrl: string, offset: number): string {
  return `${apiUrl}/sale/issues?limit=100&offset=${Math.max(0, Math.trunc(offset))}`;
}

/**
 * Dyskusja/reklamacja z JSON-a `/sale/issues` → typ domenowy. Zasób jest
 * w becie i nazwy pól bywają zagnieżdżone różnie — każde pole ma listę
 * znanych miejsc, a nieznany kształt daje NULL-e, nie wyjątek.
 */
export function mapujDyskusje(json: unknown): DyskusjaAllegro[] {
  const root = (json ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(root.issues) ? root.issues : [];
  return lista.map((it) => {
    const i = (it ?? {}) as Record<string, unknown>;
    const buyer = (i.buyer ?? {}) as Record<string, unknown>;
    const order = (i.order ?? {}) as Record<string, unknown>;
    return {
      id: tekst(i.id) ?? "",
      typ: tekst(i.type),
      status: tekst(i.status),
      temat: tekstLudzki(i.subject) ?? tekstLudzki(i.title) ?? tekstLudzki(i.name),
      kupujacyLogin: tekst(buyer.login),
      orderId: tekst(order.id) ?? tekst(i.orderId),
      utworzono: tekst(i.createdAt),
    };
  });
}

/**
 * URL-e rozmowy w dyskusji (`/sale/disputes/{id}/messages`) — GET czyta,
 * POST wysyła naszą odpowiedź. Identyfikator sprawy bierzemy z `/sale/issues`
 * przy założeniu wspólnej przestrzeni id — [WERYFIKUJ] na sandboxie; 404
 * degraduje do „rozmowa niedostępna przez API", nie do awarii.
 */
export function urlWiadomosciDyskusji(apiUrl: string, id: string): string {
  return `${apiUrl}/sale/disputes/${encodeURIComponent(id)}/messages`;
}

/** Deklaracja załącznika dyskusji (POST) — krok pierwszy z dwóch. [WERYFIKUJ]. */
export function urlZalacznikaDyskusji(apiUrl: string): string {
  return `${apiUrl}/sale/dispute-attachments`;
}

/**
 * Wiadomości dyskusji z JSON-a → typ domenowy. Zasób w becie — każde pole ma
 * listę znanych miejsc, a nieznany kształt daje NULL-e, nie wyjątek (ten sam
 * kontrakt co `mapujDyskusje`). Brak roli liczy wiadomość jako NASZĄ:
 * pomyłka w tę stronę chowa cudze zdanie, w drugą kazałaby odpowiadać na
 * własne (ten sam kierunek co przy wątkach, allegro.ts).
 */
/**
 * Rozmowa POSORTOWANA od najstarszej.
 *
 * Kolejność zwracana przez API nie jest umową — Centrum wiadomości potrafi
 * oddać wątek od najnowszej. Panel rysował go wtedy odwrotnie (ostatnie
 * zdanie klienta na górze), a synchronizacja pytań brała za „ostatnią
 * wiadomość" tę NAJSTARSZĄ — czyli pytanie sprzed tygodni. Sortujemy
 * u siebie; wiadomość bez daty zostaje na końcu, w kolejności z API.
 */
function odNajstarszej<T extends { at: string | null }>(lista: T[]): T[] {
  return lista
    .map((w, i) => ({ w, i, t: w.at ? Date.parse(w.at) : NaN }))
    .sort((a, b) => {
      const aMa = Number.isFinite(a.t);
      const bMa = Number.isFinite(b.t);
      if (aMa && bMa) return a.t - b.t || a.i - b.i;
      if (aMa) return -1;
      if (bMa) return 1;
      return a.i - b.i;
    })
    .map((x) => x.w);
}

export function mapujWiadomosciDyskusji(json: unknown): WiadomoscDyskusji[] {
  const root = (json ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(root.messages) ? root.messages : [];
  return odNajstarszej(lista.map((it) => {
    const m = (it ?? {}) as Record<string, unknown>;
    const author = (m.author ?? {}) as Record<string, unknown>;
    const zal = (m.attachment ?? null) as Record<string, unknown> | null;
    const rola = tekst(author.role);
    return {
      id: tekst(m.id) ?? "",
      odNas: rola === null ? true : rola === "SELLER",
      autorLogin: tekst(author.login),
      autorRola: rola,
      tresc: tekstLudzki(m.text) ?? tekstLudzki(m.message) ?? "",
      at: tekst(m.createdAt),
      zalacznik: zal
        ? { nazwa: tekstLudzki(zal.fileName) ?? tekstLudzki(zal.name), url: tekst(zal.url) }
        : null,
    };
  }));
}

/** Jedna nasza oferta po id — aukcja podpięta do pytania klienta. */
export function urlOfertyPoId(apiUrl: string, offerId: string): string {
  return `${apiUrl}/sale/offers/${encodeURIComponent(offerId)}`;
}

/**
 * Szczegół oferty → typ domenowy. Osobno od `mapujOferty` (lista wyników
 * szukania), bo zasób pojedynczej oferty ma inny, bogatszy kształt —
 * a interesuje nas z niego dokładnie to samo, co przy szukaniu.
 */
export function mapujOferte(json: unknown, sandbox: boolean): OfertaAllegro | null {
  const o = (json ?? {}) as Record<string, unknown>;
  const id = tekst(o.id);
  if (!id) return null;
  const external = (o.external ?? {}) as Record<string, unknown>;
  const sellingMode = (o.sellingMode ?? {}) as Record<string, unknown>;
  const price = (sellingMode.price ?? {}) as Record<string, unknown>;
  const stock = (o.stock ?? {}) as Record<string, unknown>;
  const kwota = tekst(price.amount);
  const waluta = tekst(price.currency);
  return {
    offerId: id,
    nazwa: tekstLudzki(o.name) ?? "(bez nazwy)",
    cena: kwota ? `${kwota}${waluta ? ` ${waluta}` : ""}` : null,
    externalId: tekst(external.id),
    dostepnych: typeof stock.available === "number" ? stock.available : null,
    url: urlOferty(id, sandbox),
  };
}

/** Lista wątków Centrum wiadomości. Allegro pozwala najwyżej 20 na stronę. */
export function urlWatkow(apiUrl: string, offset: number): string {
  return `${apiUrl}/messaging/threads?limit=20&offset=${Math.max(0, Math.trunc(offset))}`;
}

export function urlWiadomosci(apiUrl: string, threadId: string): string {
  return `${apiUrl}/messaging/threads/${encodeURIComponent(threadId)}/messages`;
}

/** Wysyłka odpowiedzi do wątku (POST). [WERYFIKUJ] kształt ciała na sandboxie. */
export function urlWyslijWiadomosc(apiUrl: string, threadId: string): string {
  return `${apiUrl}/messaging/threads/${encodeURIComponent(threadId)}/messages`;
}

/** Odhaczenie wątku jako przeczytany (PUT). [WERYFIKUJ]. */
export function urlOznaczPrzeczytany(apiUrl: string, threadId: string): string {
  return `${apiUrl}/messaging/threads/${encodeURIComponent(threadId)}`;
}

/**
 * URL szukania w NASZYCH ofertach. Filtr `name` jest podłańcuchowy, a
 * `publication.status=ACTIVE` odcina zakończone aukcje: link do wygaszonej
 * oferty w odpowiedzi dla klienta jest gorszy niż brak linku.
 */
export function urlOfert(apiUrl: string, fraza: string, offset = 0): string {
  return (
    `${apiUrl}/sale/offers?name=${encodeURIComponent(fraza)}` +
    `&publication.status=ACTIVE&limit=20&offset=${Math.max(0, Math.trunc(offset))}`
  );
}

/**
 * Adres aukcji dla klienta. API zwraca sam identyfikator — adres składamy MY,
 * bo to on ląduje w odpowiedzi i musi działać po wklejeniu w przeglądarkę.
 */
export function urlOferty(offerId: string, sandbox: boolean): string {
  const host = sandbox ? "https://allegro.pl.allegrosandbox.pl" : "https://allegro.pl";
  return `${host}/oferta/${encodeURIComponent(offerId)}`;
}

const tekst = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/**
 * Dla pól czytanych przez człowieka: tematy, treści wiadomości, tytuły ofert.
 * Allegro oddaje w nich encje HTML (`zwr&oacute;cić`), a panel escape'uje przy
 * renderowaniu, więc encja szłaby na ekran dosłownie. `tekst()` zostaje osobno
 * dla id, loginów i URL-i — tam `&amp;` w adresie MUSI pozostać sobą.
 */
const tekstLudzki = (v: unknown): string | null => {
  const t = tekst(v);
  return t === null ? null : odkodujEncje(t);
};

const liczba = (v: unknown, def: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : def;

/**
 * Kody powodów zwrotu → zdania po polsku.
 *
 * Allegro zwraca `reason.type` jako KOD (`NOT_AS_DESCRIBED`), a biuro czyta
 * kartę zwrotu w pośpiechu. Słownik pokrywa kody spotkane w praktyce; kod
 * spoza słownika NIE JEST ukrywany — pokazujemy go surowo i dopisujemy tu
 * przy pierwszym wystąpieniu. `NONE` znaczy „klient nie podał powodu" i jest
 * pustką, nie wartością.
 */
export const POWODY_ZWROTU: Record<string, string> = {
  NOT_AS_DESCRIBED: "Niezgodny z opisem",
  DAMAGED: "Uszkodzony",
  DEFECTIVE: "Wadliwy",
  INCOMPLETE: "Niekompletny",
  WRONG_ITEM: "Nie ten towar",
  WRONG_SIZE: "Zły rozmiar",
  BETTER_PRICE: "Lepsza cena gdzie indziej",
  NO_LONGER_NEEDED: "Już niepotrzebny",
  CHANGED_MIND: "Rezygnacja z zakupu",
  ORDERED_BY_MISTAKE: "Zamówiony przez pomyłkę",
  DID_NOT_ARRIVE_ON_TIME: "Nie dotarł na czas",
  OTHER: "Inny powód",
};

/**
 * Powód zwrotu z pozycji — obie znane postacie naraz.
 * Nieznana postać daje NULL-e, nigdy wyjątek.
 */
export function mapujPowod(item: Record<string, unknown>): { powod: string | null; opis: string | null } {
  const r = item.reason;
  if (r && typeof r === "object") {
    const ro = r as Record<string, unknown>;
    const kod = tekst(ro.type) ?? tekst(ro.name);
    /* `NONE` to jawne „bez powodu" — pokazywanie go jako powodu byłoby
       kłamstwem w drugą stronę niż pusta kolumna. */
    const powod = kod && kod !== "NONE" ? (POWODY_ZWROTU[kod] ?? kod) : null;
    return {
      powod,
      opis: tekst(ro.userComment) ?? tekst(item.userComment) ?? null,
    };
  }
  const kod = tekst(r);
  return {
    powod: kod && kod !== "NONE" ? (POWODY_ZWROTU[kod] ?? kod) : null,
    opis: tekst(item.userComment),
  };
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
      nazwa: tekstLudzki(i.name) ?? tekstLudzki(offer.name) ?? "(bez nazwy)",
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
    kupujacyId: tekst(buyer.id),
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
    kupujacyId: tekst(buyer.id),
    kupujacyEmail: tekst(buyer.email),
    pozycje: lineItems.map((li) => {
      const l = (li ?? {}) as Record<string, unknown>;
      const offer = (l.offer ?? {}) as Record<string, unknown>;
      const external = (offer.external ?? {}) as Record<string, unknown>;
      return {
        offerId: tekst(offer.id),
        nazwa: tekstLudzki(offer.name) ?? "(bez nazwy)",
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

/** Wiadomości wątku → typ domenowy. Defensywne na każdym polu. */
/**
 * Wiadomości wątku → typy domenowe.
 *
 * Drugi parametr to login ROZMÓWCY (kupującego) z nagłówka wątku, a nie nasz
 * własny. Do 0.102.1 nazywał się `mojLogin` i porównanie szło odwrotnie —
 * ale naszego loginu ten kod nigdy nie znał, więc oba wywołania przekazywały
 * `null` i gałąź była martwa. Rozmówcę mamy zawsze: jedzie z listą wątków
 * i z samym pytaniem.
 */
export function mapujWiadomosci(json: unknown, rozmowca: string | null): WiadomoscAllegro[] {
  const lista = Array.isArray((json as Record<string, unknown>)?.messages)
    ? ((json as Record<string, unknown>).messages as unknown[])
    : [];
  return odNajstarszej(lista.map((m) => {
    const w = (m ?? {}) as Record<string, unknown>;
    const autor = (w.author ?? {}) as Record<string, unknown>;
    const login = tekst(autor.login);
    /* Aukcja, o którą klient pyta. Allegro podpina ją do WIADOMOŚCI
       (`relatedObject`), nie do nagłówka wątku — a to najmocniejszy trop
       w całym pytaniu: mówi wprost, o który produkt chodzi. */
    const powiazane = (w.relatedObject ?? {}) as Record<string, unknown>;
    const ofertaWiadomosci = (w.offer ?? {}) as Record<string, unknown>;
    const typPowiazania = (tekst(powiazane.type) ?? "").toUpperCase();
    /* Kto pisał: Allegro podaje rolę autora (`BUYER`/`SELLER`), a gdy jej nie
       ma — rozstrzyga login rozmówcy: autor RÓWNY rozmówcy to kupujący.
       Zła strona rozmowy jest gorsza niż brak etykiety, więc przy niepewności
       zostaje `false` (czyli „my"): pomyłka w tę stronę chowa pytanie i widać
       ją w liczniku przejrzanych rozmów, a w drugą kazałaby biuru odpisywać
       na własne zdania. */
    const rola = tekst(autor.role);
    const odKupujacego = rola
      ? rola.toUpperCase() === "BUYER"
      : !!login && !!rozmowca && login === rozmowca;
    return {
      id: tekst(w.id) ?? "",
      odKupujacego,
      autor: login,
      tresc: tekstLudzki(w.text) ?? tekstLudzki(w.content) ?? "",
      at: tekst(w.createdAt),
      zalacznikow: Array.isArray(w.attachments) ? w.attachments.length : 0,
      ofertaId:
        (typPowiazania === "OFFER" ? tekst(powiazane.id) : null) ??
        tekst(ofertaWiadomosci.id),
    };
  }));
}

/**
 * Nagłówki wątków z listy → typy domenowe.
 *
 * Zasób podaje kontekst oferty raz jako `offer`, raz jako `subject` z tytułem
 * i niczym więcej — a bywa, że nie podaje go wcale. Każde pole ma listę
 * znanych miejsc, nieznany kształt daje NULL-e: wątek bez tytułu oferty jest
 * pytaniem, na które da się odpowiedzieć, a wyjątek zatrzymałby całą
 * synchronizację przez jeden dziwny wiersz.
 */
export function mapujWatki(json: unknown): WatekNaglowek[] {
  const root = (json ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(root.threads) ? root.threads : [];
  return lista.map((t) => {
    const w = (t ?? {}) as Record<string, unknown>;
    const rozmowca = (w.interlocutor ?? {}) as Record<string, unknown>;
    const oferta = (w.offer ?? {}) as Record<string, unknown>;
    return {
      threadId: tekst(w.id) ?? "",
      interlokutor: tekst(rozmowca.login) ?? tekst(rozmowca.id),
      ostatniaWiadomoscAt: tekst(w.lastMessageDateTime),
      przeczytany: typeof w.read === "boolean" ? w.read : null,
      ofertaId: tekst(oferta.id) ?? tekst(w.offerId),
      ofertaTytul: tekstLudzki(oferta.name) ?? tekstLudzki(w.subject),
    };
  });
}

/** Cena oferty jako gotowy tekst („39,90 PLN"); null, gdy zasób jej nie niesie. */
export function cenaOferty(sellingMode: unknown): string | null {
  const s = (sellingMode ?? {}) as Record<string, unknown>;
  const p = (s.price ?? {}) as Record<string, unknown>;
  const kwota = tekst(p.amount);
  if (!kwota) return null;
  const waluta = tekst(p.currency);
  return waluta ? `${kwota} ${waluta}` : kwota;
}

/** Nasze oferty z `/sale/offers` → typy domenowe. Defensywne na każdym polu. */
export function mapujOferty(json: unknown, sandbox: boolean): OfertaAllegro[] {
  const root = (json ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(root.offers) ? root.offers : [];
  return lista
    .map((o) => {
      const of = (o ?? {}) as Record<string, unknown>;
      const external = (of.external ?? {}) as Record<string, unknown>;
      const stock = (of.stock ?? {}) as Record<string, unknown>;
      const offerId = tekst(of.id) ?? "";
      return {
        offerId,
        nazwa: tekstLudzki(of.name) ?? "(bez nazwy)",
        cena: cenaOferty(of.sellingMode),
        externalId: tekst(external.id),
        dostepnych: typeof stock.available === "number" ? stock.available : null,
        url: urlOferty(offerId, sandbox),
      };
    })
    /* Oferta bez identyfikatora nie ma linku, a link jest jedynym powodem,
       dla którego w ogóle o nie pytamy. */
    .filter((o) => o.offerId !== "");
}

/**
 * Identyfikator rozmówcy sprowadzony do postaci porównywalnej.
 *
 * Lista wątków MASKUJE kupującego: w `interlocutor.login` siedzi `client:44300444`,
 * a nie login, który zna zamówienie. Odcinamy więc przedrostek przed dwukropkiem
 * i porównujemy bez wielkości liter. Na tym poległa pierwsza wersja szukania:
 * login z zamówienia nigdy nie trafiał w zamaskowany login wątku.
 */
export function normalizujRef(v: unknown): string | null {
  const t = tekst(v);
  if (!t) return null;
  const bezPrzedrostka = t.includes(":") ? t.slice(t.lastIndexOf(":") + 1) : t;
  const czysty = bezPrzedrostka.trim().toLowerCase();
  return czysty === "" ? null : czysty;
}

/**
 * Czy ten wątek jest rozmową z naszym kupującym.
 *
 * Porównujemy KAŻDY identyfikator rozmówcy z KAŻDYM, jaki mamy ze zwrotu —
 * bo Allegro raz podaje login, raz zamaskowane id, i nie ma gwarancji, które
 * z nich zobaczymy w danym wątku.
 */
export function pasujeRozmowca(rozmowca: Record<string, unknown>, kto: KupujacyRef): boolean {
  const jego = [normalizujRef(rozmowca.login), normalizujRef(rozmowca.id)].filter(
    (v): v is string => v !== null
  );
  const nasze = [normalizujRef(kto.login), normalizujRef(kto.id)].filter(
    (v): v is string => v !== null
  );
  return jego.some((j) => nasze.includes(j));
}

/**
 * Dokąd wstecz schodzimy — data zwrotu minus zapas, jako znacznik czasu.
 * Brak lub śmieci w dacie dają `NaN`, co znaczy „bez granicy": wtedy
 * przeszukiwanie zatrzyma dopiero twardy limit stron.
 */
export function granicaSzukania(odKiedy: string | null): number {
  const t = odKiedy ? Date.parse(odKiedy) : NaN;
  return Number.isFinite(t) ? t - DNI_WSTECZ * 86_400_000 : NaN;
}

/** Czy zeszliśmy już poniżej granicy dat (lista jest malejąca po dacie). */
export function poNajstarszej(najstarszaData: string | null, granica: number): boolean {
  if (!Number.isFinite(granica) || !najstarszaData) return false;
  const t = Date.parse(najstarszaData);
  return Number.isFinite(t) && t < granica;
}

/**
 * Które uprawnienie wymienić w komunikacie 403.
 *
 * Rozjazd uprawnień jest PIERWSZĄ awarią każdego wdrożenia — token wydany pod
 * stary zakres nie rozszerzy się sam. Zdanie „dodaj scope X" prowadzi do
 * naprawy; gołe 403 nie prowadzi donikąd, a rodzin końcówek mamy już cztery.
 */
export function scopeDlaUrl(url: string): string {
  if (url.includes("/messaging/")) return "allegro:api:messaging";
  if (url.includes("/sale/offers")) return "allegro:api:sale:offers:read";
  /* Dyskusje: odczyt spraw, rozmowa i załączniki — jedno uprawnienie.
     [WERYFIKUJ] czy obejmuje też ZAPISY; jeśli nie, 403 i tak wskaże scope. */
  if (url.includes("/sale/disputes") || url.includes("/sale/dispute-attachments")) {
    return "allegro:api:disputes";
  }
  if (url.includes("/sale/issues")) return "allegro:api:disputes";
  return "allegro:api:orders:read";
}

export class HttpAllegroAdapter implements AllegroAdapter {
  private async zapytaj(
    url: string,
    /* Do 0.80.0 ten klient tylko CZYTAŁ. Wysyłka odpowiedzi klientowi jest
       pierwszym zapisem — te same nagłówki i ta sama nauka `Accept`, więc
       metoda i ciało doszły jako opcje zamiast drugiej funkcji obok. */
    opcje: { metoda?: "POST" | "PUT"; body?: unknown } = {}
  ): Promise<unknown | null> {
    const bearer = await wazneBearer();
    const rodzina = rodzinaKoncowki(url);
    const znany = dzialajacyAccept.get(rodzina);
    const doProbowania = znany ? [znany] : [...AKCEPTY];

    let ostatnia406 = "";
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
            /* Tylko przy ciele — pusty `content-type` przy GET-cie bywa
               powodem odrzucenia u ostrożnych bramek. */
            ...(opcje.body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: opcje.body === undefined ? undefined : JSON.stringify(opcje.body),
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
          `Brak uprawnienia (403) — aplikacja na developer.allegro.pl musi mieć scope ` +
            `${scopeDlaUrl(url)}. Po dodaniu uprawnienia sparuj konto ponownie: ` +
            "token wydany pod stary zakres sam się nie rozszerzy."
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
        throw new Error(`Allegro odpowiedziało ${odp.status}: ${tresc.slice(0, 300)}`);
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

  async listaZwrotowKlienta(odKiedy: string | null): Promise<ZwrotAllegro[]> {
    /* Twardy limit stron to bezpiecznik na pierwsze uruchomienie bez granicy
       dat — tysiąc zwrotów wystarcza na każdy realny poślizg tickera. */
    const wyniki: ZwrotAllegro[] = [];
    for (let strona = 0; strona < 10; strona++) {
      const json = (await this.zapytaj(
        urlListyZwrotow(config.allegro.apiUrl, odKiedy, strona * 100)
      )) as Record<string, unknown> | null;
      const lista = Array.isArray(json?.customerReturns) ? json.customerReturns : [];
      for (const z of lista) wyniki.push(mapujZwrot(z));
      if (lista.length < 100) break;
    }
    return wyniki;
  }

  async listaDyskusji(): Promise<DyskusjaAllegro[]> {
    /* Do 0.126.0 czytaliśmy JEDNĄ stronę setki i rejestr nie widział nic
       ponad nią — konto z ponad setką spraw gubiło resztę po cichu. Pętla
       jak przy zwrotach: limit 10 stron to bezpiecznik, stop na krótszej
       stronie. Granicy dat nie ma, bo `/sale/issues` nie dokumentuje
       filtra daty — upsert w sync jest idempotentny, więc pełny przegląd
       nie szkodzi. */
    const wyniki: DyskusjaAllegro[] = [];
    for (let strona = 0; strona < 10; strona++) {
      const json = await this.zapytaj(urlDyskusji(config.allegro.apiUrl, strona * 100));
      const lista = json === null ? [] : mapujDyskusje(json);
      wyniki.push(...lista);
      if (lista.length < 100) break;
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

  async watekKupujacego(kto: KupujacyRef, odKiedy: string | null): Promise<SzukanieWatku> {
    /* Allegro nie ma filtru „wątek z tym kupującym": trzeba przejść listę.
       Lista jest posortowana od najświeższej rozmowy, więc schodzimy w dół
       do granicy dat wokół zwrotu i tam przestajemy — a licznik przejrzanych
       wątków wraca na ekran, żeby „brak korespondencji" dało się odróżnić od
       „nie doszedłem tak głęboko". */
    const granica = granicaSzukania(odKiedy);
    let przejrzanych = 0;
    let najstarszaData: string | null = null;

    for (let strona = 0; strona < STRON_WATKOW; strona++) {
      const json = (await this.zapytaj(
        urlWatkow(config.allegro.apiUrl, strona * 20)
      )) as Record<string, unknown> | null;
      const watki = Array.isArray(json?.threads) ? (json.threads as unknown[]) : [];
      if (watki.length === 0) {
        return { watek: null, przejrzanych, najstarszaData, wyczerpano: true };
      }

      for (const t of watki) {
        const w = (t ?? {}) as Record<string, unknown>;
        przejrzanych++;
        const data = tekst(w.lastMessageDateTime);
        if (data) najstarszaData = data;

        const rozmowca = (w.interlocutor ?? {}) as Record<string, unknown>;
        if (!pasujeRozmowca(rozmowca, kto)) continue;
        const threadId = tekst(w.id);
        if (!threadId) continue;

        const wiadomosci = await this.zapytaj(urlWiadomosci(config.allegro.apiUrl, threadId));
        return {
          watek: {
            threadId,
            interlokutor: tekst(rozmowca.login) ?? tekst(rozmowca.id),
            /* Rozmówcę mamy tu pod ręką — i to on rozstrzyga stronę rozmowy,
               gdy Allegro nie poda roli autora. Do 0.102.1 leciało tu `null`
               i cała rozmowa wychodziła „nasza". */
            wiadomosci: mapujWiadomosci(wiadomosci, tekst(rozmowca.login) ?? null),
          },
          przejrzanych,
          najstarszaData,
          wyczerpano: false,
        };
      }

      /* Krótsza strona niż limit znaczy koniec listy — dalej nie ma czego czytać. */
      if (watki.length < 20) {
        return { watek: null, przejrzanych, najstarszaData, wyczerpano: true };
      }
      if (poNajstarszej(najstarszaData, granica)) break;
    }
    return { watek: null, przejrzanych, najstarszaData, wyczerpano: false };
  }

  // ── Pytania klientów (0.80.0) ──────────────────────────────────────────────

  async listaWatkow(odKiedy: string | null, maxStron = 10): Promise<WatekNaglowek[]> {
    /* Lista jest malejąca po dacie ostatniej wiadomości, więc schodzimy do
       `odKiedy` i przestajemy — synchronizacja co pięć minut czyta wtedy
       jedną stronę, a nie całą korespondencję konta. Bez granicy (pierwsze
       uruchomienie) hamuje `maxStron`. */
    const granica = odKiedy ? Date.parse(odKiedy) : NaN;
    const wyniki: WatekNaglowek[] = [];
    for (let strona = 0; strona < Math.max(1, maxStron); strona++) {
      const json = await this.zapytaj(urlWatkow(config.allegro.apiUrl, strona * 20));
      const watki = mapujWatki(json);
      if (watki.length === 0) break;
      for (const w of watki) wyniki.push(w);

      if (watki.length < 20) break;
      const najstarsza = watki[watki.length - 1]?.ostatniaWiadomoscAt ?? null;
      if (Number.isFinite(granica) && najstarsza) {
        const t = Date.parse(najstarsza);
        if (Number.isFinite(t) && t < granica) break;
      }
    }
    return wyniki;
  }

  async wiadomosciWatku(threadId: string, rozmowca?: string | null): Promise<WiadomoscAllegro[]> {
    const json = await this.zapytaj(urlWiadomosci(config.allegro.apiUrl, threadId));
    return json === null ? [] : mapujWiadomosci(json, rozmowca ?? null);
  }

  async wyslijWiadomosc(threadId: string, tekstWiadomosci: string): Promise<void> {
    await this.zapytaj(urlWyslijWiadomosc(config.allegro.apiUrl, threadId), {
      metoda: "POST",
      body: { text: tekstWiadomosci },
    });
  }

  async oznaczPrzeczytany(threadId: string): Promise<void> {
    await this.zapytaj(urlOznaczPrzeczytany(config.allegro.apiUrl, threadId), {
      metoda: "PUT",
      body: { read: true },
    });
  }

  async szukajOfert(fraza: string): Promise<OfertaAllegro[]> {
    /* Jedna strona dwudziestu wystarcza: to kontekst dla modelu i lista
       linków dla człowieka, nie przegląd asortymentu. */
    const json = await this.zapytaj(urlOfert(config.allegro.apiUrl, fraza, 0));
    return json === null ? [] : mapujOferty(json, config.allegro.sandbox);
  }

  async oferta(offerId: string): Promise<OfertaAllegro | null> {
    /* 404 (oferta zakończona albo cudza) to poprawna odpowiedź „nie ma",
       nie awaria — pytanie o starą aukcję ma dalej dostać szkic. */
    const json = await this.zapytaj(urlOfertyPoId(config.allegro.apiUrl, offerId));
    return json === null ? null : mapujOferte(json, config.allegro.sandbox);
  }

  // ── Dyskusje: rozmowa i odpowiedź (0.104.0) ────────────────────────────────

  async wiadomosciDyskusji(allegroId: string): Promise<WiadomoscDyskusji[] | null> {
    /* NULL z 404 zostaje NULL-em, nie pustą listą: „sprawy nie ma pod tym id"
       i „rozmowa jest pusta" to dwa różne zdania na ekranie biura. */
    const json = await this.zapytaj(urlWiadomosciDyskusji(config.allegro.apiUrl, allegroId));
    return json === null ? null : mapujWiadomosciDyskusji(json);
  }

  async wyslijWiadomoscDyskusji(
    allegroId: string,
    tekst: string,
    zalacznikId?: string
  ): Promise<void> {
    /* Kształt ciała [WERYFIKUJ] na sandboxie — `text` + opcjonalne
       `attachment.id`, jak w dokumentacji disputes. */
    const wynik = await this.zapytaj(urlWiadomosciDyskusji(config.allegro.apiUrl, allegroId), {
      metoda: "POST",
      body: { text: tekst, ...(zalacznikId ? { attachment: { id: zalacznikId } } : {}) },
    });
    /* `zapytaj` mapuje 404 na null — przy ODCZYCIE to degradacja, przy
       WYSYŁCE oznaczałoby, że biuro myśli, że odpowiedziało. Mówimy wprost. */
    if (wynik === null) {
      throw new Error(
        "Allegro nie zna tej sprawy pod API dyskusji (404) — odpowiedz w panelu Allegro."
      );
    }
  }

  async dodajZalacznikDyskusji(
    nazwaPliku: string,
    mime: string,
    daneBase64: string
  ): Promise<string> {
    /* Dwustopniowo wg wzorca disputes: najpierw deklaracja (nazwa + rozmiar),
       potem binaria pod wskazany albo wyliczony adres. Pola odpowiedzi
       deklaracji są [WERYFIKUJ] — czytamy defensywnie `id` i `location`. */
    const dane = Buffer.from(daneBase64, "base64");
    const deklaracja = (await this.zapytaj(urlZalacznikaDyskusji(config.allegro.apiUrl), {
      metoda: "POST",
      body: { fileName: nazwaPliku, size: dane.length },
    })) as Record<string, unknown> | null;
    const id =
      typeof deklaracja?.id === "string" && deklaracja.id !== "" ? deklaracja.id : null;
    if (!id) {
      throw new Error(
        "Allegro nie przyjęło deklaracji załącznika — odpowiedź bez identyfikatora."
      );
    }
    const cel =
      typeof deklaracja?.location === "string" && deklaracja.location !== ""
        ? deklaracja.location
        : `${urlZalacznikaDyskusji(config.allegro.apiUrl)}/${encodeURIComponent(id)}`;
    await this.wgrajBinarne(cel, mime, dane);
    return id;
  }

  /**
   * Wgranie surowych binariów — poza `zapytaj`, bo tamto koduje ciało jako
   * JSON i negocjuje `Accept`, a upload pliku potrzebuje dokładnie odwrotnie:
   * `content-type` pliku i żadnej wersji zasobu. [WERYFIKUJ] metodę (PUT)
   * i nagłówki na sandboxie.
   */
  private async wgrajBinarne(url: string, mime: string, dane: Buffer): Promise<void> {
    let odp: Response;
    try {
      odp = await fetch(url, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${await wazneBearer()}`,
          "user-agent": allegroUserAgent(),
          "content-type": mime,
        },
        body: new Uint8Array(dane),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(
        `Wgranie załącznika nie doszło do Allegro — sprawdź internet na serwerze. ` +
          `(${e instanceof Error ? e.message : e})`
      );
    }
    if (odp.status === 429) {
      const poIluMs = retryAfterMs(odp.headers.get("retry-after"), Date.now());
      throw new BladLimituAllegro(
        "Allegro prosi o przerwę (429) przy wgrywaniu załącznika." +
          (poIluMs !== null ? ` Spróbuj za ${Math.ceil(poIluMs / 1000)} s.` : ""),
        poIluMs
      );
    }
    if (!odp.ok) {
      const tresc = await odp.text().catch(() => "");
      throw new Error(`Allegro odrzuciło załącznik (${odp.status}): ${tresc.slice(0, 300)}`);
    }
  }

  // ── Przesyłki ostatnich zamówień (0.105.0) ─────────────────────────────────

  async zamowieniaKupujacego(kto: KupujacyRef, limit = 3): Promise<ZamowienieKupujacego[]> {
    /* Dwie drogi, bo `kupujacy_login` przy pytaniach z wątków to MASKA
       (`client:44300101`), nie login. Prawdziwy login idzie filtrem serwera;
       maska — skanem ostatnich zamówień z porównaniem po `buyer.id`/`login`
       (ten sam wzorzec co `watekKupujacego`, [WERYFIKUJ] czy istnieje filtr
       `buyer.id=` — wtedy skan zniknie). */
    const ref = normalizujRef(kto.login) ?? normalizujRef(kto.id);
    if (!ref) return [];
    const maskowany = (kto.login ?? "").includes(":") || normalizujRef(kto.login) === null;

    if (!maskowany) {
      const json = (await this.zapytaj(
        urlZamowienKupujacego(config.allegro.apiUrl, kto.login!.trim(), limit)
      )) as Record<string, unknown> | null;
      const lista = Array.isArray(json?.checkoutForms) ? json.checkoutForms : [];
      return lista.slice(0, limit).map(mapujZamowienieKupujacego);
    }

    /* Skan: 60 dni wstecz, najwyżej dwie strony — pytanie o przesyłkę dotyczy
       świeżego zamówienia, a pełna historia konta to praca dla nikogo. */
    const odKiedy = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const wyniki: ZamowienieKupujacego[] = [];
    for (let strona = 0; strona < 2 && wyniki.length < limit; strona++) {
      const json = (await this.zapytaj(
        urlOstatnichZamowien(config.allegro.apiUrl, odKiedy, strona * 100)
      )) as Record<string, unknown> | null;
      const lista = Array.isArray(json?.checkoutForms) ? json.checkoutForms : [];
      for (const z of lista) {
        const buyer = ((z ?? {}) as Record<string, unknown>).buyer as
          | Record<string, unknown>
          | undefined;
        if (buyer && pasujeRozmowca(buyer, kto) && wyniki.length < limit) {
          wyniki.push(mapujZamowienieKupujacego(z));
        }
      }
      if (lista.length < 100) break;
    }
    return wyniki;
  }

  async przesylkiZamowienia(orderId: string): Promise<PrzesylkaZamowienia[]> {
    const json = await this.zapytaj(urlPrzesylekZamowienia(config.allegro.apiUrl, orderId));
    return json === null ? [] : mapujPrzesylki(json);
  }

  async sledzeniePrzesylki(przewoznikId: string, waybill: string): Promise<ZdarzenieSledzenia[]> {
    const json = await this.zapytaj(urlSledzenia(config.allegro.apiUrl, przewoznikId, waybill));
    return json === null ? [] : mapujSledzenie(json);
  }
}
