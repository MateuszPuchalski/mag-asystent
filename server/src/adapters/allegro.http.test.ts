import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapujPowod,
  mapujWiadomosci,
  mapujZamowienie,
  mapujZwrot,
  rodzinaKoncowki,
  urlZamowienia,
  urlWatkow,
  urlWiadomosci,
  urlZwrotow,
  urlZwrotu,
} from "./allegro.http.js";
import { allegroUserAgent } from "./allegro.js";
import { config } from "../config.js";
import { czyOdswiezyc } from "../services/allegro-token.js";

/* ── Allegro HTTP — czyste funkcje ───────────────────────────────────────────
   Granicą testów jest adapter (jak przy Sferze): tras nie testuje się przez
   mockowanie fetch, tylko na adapterze dev. Tu zostaje jedyna logika tego
   pliku — budowa URL-i i mapowanie JSON→typy na fixturach o kształcie
   z dokumentacji API.                                                        */

test("waybill w URL-u jest kodowany — & i spacja nie rozcinają zapytania", () => {
  const url = urlZwrotow("https://api.allegro.pl", "parcels.waybill", "AB 12&x=1");
  assert.match(url, /parcels\.waybill=AB%2012%26x%3D1/);
  assert.match(url, /^https:\/\/api\.allegro\.pl\/order\/customer-returns\?/);
});

test("mapowanie zwrotu: pola z dokumentacji trafiają na swoje miejsca", () => {
  const z = mapujZwrot({
    id: "ret-1",
    orderId: "ord-1",
    referenceNumber: "REF-77",
    status: "CREATED",
    createdAt: "2026-08-10T10:00:00Z",
    buyer: { login: "jan", email: "j@x.pl" },
    items: [
      { offerId: "of-9", name: "Piła", quantity: 2, reason: { name: "Uszkodzony", userComment: "pęknięta" } },
    ],
    parcels: [{ waybill: "W1", transportingWaybill: "T1", carrierId: "ALLEGRO", transportingCarrierId: "DPD" }],
  });
  assert.equal(z.id, "ret-1");
  assert.equal(z.referencja, "REF-77");
  assert.equal(z.kupujacyLogin, "jan");
  assert.deepEqual(z.pozycje[0], {
    offerId: "of-9", nazwa: "Piła", externalId: null, ilosc: 2,
    powod: "Uszkodzony", powodOpis: "pęknięta",
  });
  // etykieta u drzwi = przewoźnik DORĘCZAJĄCY, więc on wygrywa w polu przewoznik
  assert.deepEqual(z.paczki[0], { waybill: "W1", transportingWaybill: "T1", przewoznik: "DPD" });
});

test("nieznany kształt powodu daje NULL-e, nie wyjątek", () => {
  // zwrot bez powodu na ekranie jest lepszy niż skan skończony błędem 500
  assert.deepEqual(mapujPowod({ reason: 42 }), { powod: null, opis: null });
  assert.deepEqual(mapujPowod({}), { powod: null, opis: null });
  assert.deepEqual(mapujPowod({ reason: "Rezygnacja" }), { powod: "Rezygnacja", opis: null });
});

test("puste/uszkodzone JSON-y zwrotu nie wywracają mapowania", () => {
  const z = mapujZwrot({});
  assert.equal(z.id, "");
  assert.deepEqual(z.pozycje, []);
  assert.deepEqual(z.paczki, []);
});

test("zamówienie niesie sygnaturę sprzedawcy (offer.external.id)", () => {
  const zam = mapujZamowienie({
    id: "ord-1",
    buyer: { login: "jan" },
    lineItems: [{ offer: { id: "of-9", name: "Piła", external: { id: "SYM-123" } }, quantity: 1 }],
  });
  assert.equal(zam.pozycje[0].externalId, "SYM-123");
  assert.equal(zam.pozycje[0].offerId, "of-9");
});

test("User-Agent: wygenerowany z env wygrywa, fallback nazywa nas po imieniu", () => {
  /* Allegro grozi blokadą klucza za brak prawidłowego nagłówka — domyślne
     „node" z fetcha nie ma prawa wyjść na zewnątrz. */
  const bylo = config.allegro.userAgent;
  try {
    (config.allegro as { userAgent: string }).userAgent = "";
    assert.match(allegroUserAgent(), /^WERTIS\/\d+\.\d+\.\d+/);
    (config.allegro as { userAgent: string }).userAgent = "Wygenerowany/1.0 (abc123)";
    assert.equal(allegroUserAgent(), "Wygenerowany/1.0 (abc123)");
  } finally {
    (config.allegro as { userAgent: string }).userAgent = bylo;
  }
});

test("odświeżenie tokena: 5 minut zapasu i odporność na śmieci w dacie", () => {
  const teraz = Date.parse("2026-08-18T12:00:00Z");
  assert.equal(czyOdswiezyc("2026-08-18T13:00:00Z", teraz), false);
  assert.equal(czyOdswiezyc("2026-08-18T12:04:00Z", teraz), true); // mniej niż zapas
  assert.equal(czyOdswiezyc("nie-data", teraz), true); // uszkodzony wiersz → odśwież
});

test("rodzina końcówki rozdziela wersje zasobów — beta zwrotów nie zmienia zamówień", () => {
  /* 406 na zwrotach klienckich (zasób w becie) nie ma prawa przestawić
     nagłówka zamówieniom, które chodzą po public.v1. */
  assert.equal(
    rodzinaKoncowki(urlZwrotow("https://api.allegro.pl", "parcels.waybill", "X1")),
    "customer-returns"
  );
  assert.equal(rodzinaKoncowki(urlZwrotu("https://api.allegro.pl", "r-1")), "customer-returns");
  assert.equal(rodzinaKoncowki(urlZamowienia("https://api.allegro.pl", "o-1")), "checkout-forms");
  assert.equal(rodzinaKoncowki("https://api.allegro.pl/me"), "inne");
});

test("powód zwrotu: kod tłumaczony na polski, NONE to brak powodu", () => {
  /* Allegro daje `reason: { type, userComment }` — kod, nie zdanie. Biuro
     czyta kartę w pośpiechu, więc kod znany tłumaczymy, nieznany pokazujemy
     surowo (nigdy nie ukrywamy), a NONE znaczy „klient nie podał powodu". */
  assert.deepEqual(
    mapujPowod({ reason: { type: "NOT_AS_DESCRIBED", userComment: "Niewłaściwy kolor." } }),
    { powod: "Niezgodny z opisem", opis: "Niewłaściwy kolor." }
  );
  assert.deepEqual(mapujPowod({ reason: { type: "NONE", userComment: "" } }), {
    powod: null,
    opis: null,
  });
  assert.equal(mapujPowod({ reason: { type: "KOD_KTOREGO_NIE_ZNAMY" } }).powod, "KOD_KTOREGO_NIE_ZNAMY");
});

test("wiadomości: strona rozmowy z roli autora, brak roli → login rozmówcy", () => {
  const w = mapujWiadomosci(
    {
      messages: [
        { id: "m1", author: { login: "klient", role: "BUYER" }, text: "Odsyłam", createdAt: "2026-08-19T10:00:00Z", attachments: [{}] },
        { id: "m2", author: { login: "wertis", role: "SELLER" }, text: "Przyjęliśmy" },
      ],
    },
    "wertis"
  );
  assert.equal(w[0].odKupujacego, true);
  assert.equal(w[0].zalacznikow, 1);
  assert.equal(w[1].odKupujacego, false);
  // pusty wątek nie wywraca mapowania
  assert.deepEqual(mapujWiadomosci({}, null), []);
});

test("URL wątków trzyma limit Allegro i nie przyjmuje ujemnego offsetu", () => {
  assert.equal(urlWatkow("https://api.allegro.pl", 0), "https://api.allegro.pl/messaging/threads?limit=20&offset=0");
  assert.match(urlWatkow("https://api.allegro.pl", -5), /offset=0$/);
  assert.equal(
    urlWiadomosci("https://api.allegro.pl", "a/b"),
    "https://api.allegro.pl/messaging/threads/a%2Fb/messages"
  );
});
