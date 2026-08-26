import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  granicaSzukania,
  mapujPowod,
  mapujWiadomosci,
  mapujZamowienie,
  mapujZwrot,
  normalizujRef,
  pasujeRozmowca,
  poNajstarszej,
  rodzinaKoncowki,
  urlZamowienia,
  urlWatkow,
  urlDyskusji,
  mapujDyskusje,
  urlWiadomosci,
  urlZwrotow,
  urlZwrotu,
  urlOfert,
  urlOferty,
  urlWyslijWiadomosc,
  urlOznaczPrzeczytany,
  urlWiadomosciDyskusji,
  urlZalacznikaDyskusji,
  mapujWiadomosciDyskusji,
  urlZamowienKupujacego,
  urlPrzesylekZamowienia,
  urlSledzenia,
  mapujZamowienieKupujacego,
  mapujPrzesylki,
  mapujSledzenie,
  mapujWatki,
  mapujOferty,
  mapujOferte,
  urlOfertyPoId,
  scopeDlaUrl,
} from "./allegro.http.js";
import { allegroUserAgent } from "./allegro.js";
import { config } from "../config.js";
import {
  czyOdswiezyc,
  czyStronaBlokady,
  interwalParowania,
  problemUserAgenta,
} from "../services/allegro-token.js";

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
  // dyskusje (`/sale/issues`, beta) i wątki mają WŁASNE rodziny — beta jednej
  // nie przestawia wersji drugiej
  assert.equal(rodzinaKoncowki(urlDyskusji("https://api.allegro.pl", 0)), "issues");
  assert.equal(rodzinaKoncowki(urlWatkow("https://api.allegro.pl", 0)), "threads");
  assert.equal(rodzinaKoncowki("https://api.allegro.pl/me"), "inne");
});

test("dyskusje: mapowanie defensywne — typ, klient i temat z różnych gniazd", () => {
  const lista = mapujDyskusje({
    issues: [
      {
        id: "i-1", type: "CLAIM", status: "NEW", subject: "Pęknięta obudowa",
        buyer: { login: "ewa" }, order: { id: "o-9" }, createdAt: "2026-08-19T10:00:00Z",
      },
      { id: "i-2", name: "Pytanie o śrubę" }, // szczątkowy kształt — NULL-e, nie wyjątek
    ],
  });
  assert.equal(lista[0].typ, "CLAIM");
  assert.equal(lista[0].kupujacyLogin, "ewa");
  assert.equal(lista[0].orderId, "o-9");
  assert.equal(lista[1].temat, "Pytanie o śrubę");
  assert.equal(lista[1].status, null);
  assert.deepEqual(mapujDyskusje({}), [], "brak listy = pusta odpowiedź, nie błąd");
});

test("rozmowa dyskusji: URL-e, rodzina i scope — pisownia się nie rozjeżdża", () => {
  assert.equal(
    urlWiadomosciDyskusji("https://api.allegro.pl", "i 1/x"),
    "https://api.allegro.pl/sale/disputes/i%201%2Fx/messages",
    "id sprawy jest enkodowane — śmieciowy znak nie rozetnie ścieżki"
  );
  assert.equal(
    urlZalacznikaDyskusji("https://api.allegro.pl"),
    "https://api.allegro.pl/sale/dispute-attachments"
  );
  /* Własna rodzina Accept: beta dyskusji nie przestawia wersji issues. */
  assert.equal(rodzinaKoncowki(urlWiadomosciDyskusji("https://api.allegro.pl", "1")), "disputes");
  /* 403 ma wskazać właściwe uprawnienie — bez tych gałęzi podpowiadałby
     orders:read, czyli prowadził naprawę w złą stronę. */
  assert.equal(scopeDlaUrl("https://api.allegro.pl/sale/disputes/1/messages"), "allegro:api:disputes");
  assert.equal(scopeDlaUrl("https://api.allegro.pl/sale/dispute-attachments"), "allegro:api:disputes");
});

test("rozmowa dyskusji: mapowanie defensywne, brak roli liczy się jako NASZE", () => {
  const lista = mapujWiadomosciDyskusji({
    messages: [
      {
        id: "m-1", text: "Brakuje śruby", createdAt: "2026-08-20T10:00:00Z",
        author: { login: "jan", role: "BUYER" },
        attachment: { fileName: "foto.jpg", url: "https://x/foto" },
      },
      { id: "m-2", text: "Dosyłamy", author: { role: "SELLER" } },
      /* Bez roli: pomyłka „nasze" tylko chowa cudze zdanie; pomyłka w drugą
         stronę kazałaby odpowiadać na własne — ten sam kierunek co przy
         wątkach Centrum wiadomości. */
      { id: "m-3", text: "Kto to pisał?" },
    ],
  });
  assert.equal(lista[0].odNas, false);
  assert.equal(lista[0].autorLogin, "jan");
  assert.deepEqual(lista[0].zalacznik, { nazwa: "foto.jpg", url: "https://x/foto" });
  assert.equal(lista[1].odNas, true);
  assert.equal(lista[2].odNas, true);
  assert.equal(lista[2].autorRola, null);
  assert.deepEqual(mapujWiadomosciDyskusji({}), [], "brak listy = pusto, nie wyjątek");
  assert.deepEqual(mapujWiadomosciDyskusji(null), [], "null = pusto, nie wyjątek");
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

test("wiadomości: strona rozmowy z roli autora", () => {
  const w = mapujWiadomosci(
    {
      messages: [
        { id: "m1", author: { login: "klient", role: "BUYER" }, text: "Odsyłam", createdAt: "2026-08-19T10:00:00Z", attachments: [{}] },
        { id: "m2", author: { login: "wertis", role: "SELLER" }, text: "Przyjęliśmy" },
      ],
    },
    "klient"
  );
  assert.equal(w[0].odKupujacego, true);
  assert.equal(w[0].zalacznikow, 1);
  assert.equal(w[1].odKupujacego, false);
  // pusty wątek nie wywraca mapowania
  assert.deepEqual(mapujWiadomosci({}, null), []);
});

test("wiadomości BEZ roli autora: stronę rozmowy rozstrzyga login rozmówcy", () => {
  /* USTERKA 0.102.1, i to jest test, którego wtedy zabrakło.

     Test wyżej nazywał się do tej wersji „…brak roli → login rozmówcy" i tej
     ścieżki NIE WYKONYWAŁ: obie wiadomości miały `role`, a jedyne wywołanie
     bez roli to pusty obiekt, który wraca pustą listą. Nazwa obiecywała
     pokrycie, którego nie było.

     Kosztowało to całą zakładkę: oba wywołania `mapujWiadomosci` przekazywały
     `mojLogin: null`, więc gałąź po loginie była martwym kodem. Na koncie,
     na którym Allegro nie podaje `author.role`, KAŻDA wiadomość liczyła się
     jako nasza, `ostatniaSeriaKupujacego` zwracało `null` dla każdego wątku
     i nie importowało się nic — przy sześćdziesięciu przejrzanych rozmowach,
     bez jednego błędu.

     Adapter dev tego nie łapie z natury: trzyma gotowe `WiadomoscAllegro`
     i przez to mapowanie nie przechodzi. Ta funkcja pracuje WYŁĄCZNIE na
     prawdziwym Allegro, więc test jednostkowy jest jej jedynym strażnikiem. */
  const bezRol = {
    messages: [
      { id: "m1", author: { login: "klient_jan" }, text: "Czy pasuje do MS 170?" },
      { id: "m2", author: { login: "wertis" }, text: "Tak, pasuje." },
      { id: "m3", author: { login: "klient_jan" }, text: "To poproszę." },
    ],
  };

  const zLoginem = mapujWiadomosci(bezRol, "klient_jan");
  assert.equal(zLoginem[0].odKupujacego, true, "rozmówca to kupujący");
  assert.equal(zLoginem[1].odKupujacego, false, "my to nie rozmówca");
  assert.equal(zLoginem[2].odKupujacego, true);

  /* Bez loginu rozmówcy zostaje bezpieczny domyślny wybór: „my". Pomyłka w tę
     stronę chowa pytanie i widać ją w liczniku przejrzanych rozmów; w drugą
     kazałaby biuru odpisywać na własne zdania. */
  const bezNiczego = mapujWiadomosci(bezRol, null);
  assert.deepEqual(
    bezNiczego.map((w) => w.odKupujacego),
    [false, false, false],
    "bez roli I bez loginu wszystko zostaje po naszej stronie"
  );

  /* Rola ma pierwszeństwo nad loginem — gdy Allegro ją poda, login nie ma nic
     do rzeczy, także wtedy, gdy przekazaliśmy zły. */
  const zRola = mapujWiadomosci(
    { messages: [{ id: "m1", author: { login: "klient_jan", role: "SELLER" }, text: "x" }] },
    "klient_jan"
  );
  assert.equal(zRola[0].odKupujacego, false, "rola bije login");
});

test("żadne wywołanie mapowania wiadomości nie gubi rozmówcy", () => {
  /* Test jednostkowy wyżej pilnuje SAMEJ funkcji i przechodził przez całą
     usterkę 0.102.1 — bo usterka siedziała w WYWOŁANIACH: oba przekazywały
     `null` zamiast rozmówcy, więc gałąź po loginie była martwa.

     Funkcji tej nie da się złapać testem integracyjnym: adapter dev trzyma
     gotowe `WiadomoscAllegro` i przez mapowanie nie przechodzi, a klient HTTP
     nie ma tu atrapy `fetch`. Zostaje sprawdzenie ŹRÓDŁA — ten sam zabieg, co
     przy delegacji przycisków w `routes/biuro.test.ts`, i z tego samego
     powodu: pomyłka nie wywraca niczego głośno, tylko cicho gasi zakładkę. */
  const zrodlo = fs.readFileSync(
    path.resolve(import.meta.dirname, "./allegro.http.ts"),
    "utf8"
  );
  const wywolania = [...zrodlo.matchAll(/mapujWiadomosci\(([^)]*)\)/g)]
    .map((m) => m[1].trim())
    /* Deklaracja funkcji łapie się tym samym wzorcem — odsiewamy ją po typie. */
    .filter((a) => !a.includes("unknown"));
  assert.ok(wywolania.length >= 2, "oba wywołania stoją w tym pliku");
  for (const argumenty of wywolania) {
    assert.doesNotMatch(
      argumenty,
      /,\s*null\s*$/,
      `mapujWiadomosci(${argumenty}) gubi rozmówcę — bez niego wątek bez ról ` +
        "autora w całości liczy się jako nasz i pytanie nigdy nie wejdzie"
    );
  }
});

test("URL wątków trzyma limit Allegro i nie przyjmuje ujemnego offsetu", () => {
  assert.equal(urlWatkow("https://api.allegro.pl", 0), "https://api.allegro.pl/messaging/threads?limit=20&offset=0");
  assert.match(urlWatkow("https://api.allegro.pl", -5), /offset=0$/);
  assert.equal(
    urlWiadomosci("https://api.allegro.pl", "a/b"),
    "https://api.allegro.pl/messaging/threads/a%2Fb/messages"
  );
});

test("rozmówca wątku: zamaskowany login trafia w identyfikator kupującego", () => {
  /* Lista wątków podaje `client:44300444`, a zamówienie — login. Szukanie po
     samym loginie nie trafiało NIGDY i to była przyczyna „braku
     korespondencji" przy zwrotach, w których rozmowa istniała. */
  assert.equal(normalizujRef("client:44300444"), "44300444");
  assert.equal(normalizujRef("  Jan_Wraca "), "jan_wraca");
  assert.equal(normalizujRef(""), null);
  assert.equal(normalizujRef(42), null);

  const kto = { login: "jan_wraca", id: "44300444" };
  assert.equal(pasujeRozmowca({ login: "client:44300444" }, kto), true);
  assert.equal(pasujeRozmowca({ login: "JAN_WRACA" }, kto), true);
  assert.equal(pasujeRozmowca({ id: "44300444" }, kto), true);
  assert.equal(pasujeRozmowca({ login: "client:99999999" }, kto), false);
  // zwrot bez kupującego nie ma prawa „pasować" do pierwszego lepszego wątku
  assert.equal(pasujeRozmowca({ login: "client:1" }, { login: null, id: null }), false);
});

test("granica szukania: miesiąc przed zwrotem, śmieci w dacie znoszą granicę", () => {
  const zwrot = "2026-08-19T10:00:00Z";
  const granica = granicaSzukania(zwrot);
  assert.equal(new Date(granica).toISOString().slice(0, 10), "2026-07-20");
  // rozmowa z dnia zwrotu jest w zasięgu, sprzed pół roku — już nie
  assert.equal(poNajstarszej(zwrot, granica), false);
  assert.equal(poNajstarszej("2026-02-01T00:00:00Z", granica), true);
  // bez daty zwrotu szukanie ogranicza wyłącznie twardy limit stron
  assert.equal(Number.isNaN(granicaSzukania(null)), true);
  assert.equal(Number.isNaN(granicaSzukania("nie-data")), true);
  assert.equal(poNajstarszej("2020-01-01T00:00:00Z", granicaSzukania(null)), false);
  assert.equal(poNajstarszej(null, granica), false);
});

test("mapowanie niesie identyfikator kupującego — klucz do wątku wiadomości", () => {
  assert.equal(mapujZwrot({ buyer: { login: "jan", id: "44300444" } }).kupujacyId, "44300444");
  assert.equal(mapujZwrot({ buyer: { login: "jan" } }).kupujacyId, null);
  assert.equal(mapujZamowienie({ buyer: { id: "44300444" } }).kupujacyId, "44300444");
});

/* ── Pytania klientów (0.80.0) ─────────────────────────────────────────────── */

test("URL ofert: fraza kodowana, filtr aktywnych publikacji zawsze obecny", () => {
  const url = urlOfert("https://api.allegro.pl", "cewka & zapłon", 20);
  assert.match(url, /name=cewka%20%26%20zap%C5%82on/);
  assert.match(url, /publication\.status=ACTIVE/);
  assert.match(url, /offset=20/);
  /* Ujemny offset to błąd wołającego, nie powód na 400 z Allegro. */
  assert.match(urlOfert("https://api.allegro.pl", "x", -5), /offset=0/);
});

test("adres aukcji zależy od środowiska — sandbox ma własną domenę", () => {
  assert.equal(urlOferty("123", false), "https://allegro.pl/oferta/123");
  assert.match(urlOferty("123", true), /allegrosandbox\.pl\/oferta\/123$/);
});

test("URL wysyłki i odhaczenia wątku kodują identyfikator", () => {
  assert.equal(
    urlWyslijWiadomosc("https://api.allegro.pl", "a/b"),
    "https://api.allegro.pl/messaging/threads/a%2Fb/messages"
  );
  assert.equal(
    urlOznaczPrzeczytany("https://api.allegro.pl", "a b"),
    "https://api.allegro.pl/messaging/threads/a%20b"
  );
});

test("mapowanie wątków: pełny JSON trafia na swoje miejsca", () => {
  const [w] = mapujWatki({
    threads: [
      {
        id: "t-1",
        interlocutor: { login: "client:44300444" },
        lastMessageDateTime: "2026-08-20T10:00:00Z",
        read: false,
        offer: { id: "of-9", name: "Cewka zapłonowa" },
      },
    ],
  });
  assert.equal(w.threadId, "t-1");
  assert.equal(w.interlokutor, "client:44300444");
  assert.equal(w.ostatniaWiadomoscAt, "2026-08-20T10:00:00Z");
  assert.equal(w.przeczytany, false);
  assert.equal(w.ofertaId, "of-9");
  assert.equal(w.ofertaTytul, "Cewka zapłonowa");
});

test("mapowanie wątków: brak pól daje NULL-e, nie wyjątek", () => {
  const [w] = mapujWatki({ threads: [{ id: "t-2" }] });
  assert.equal(w.threadId, "t-2");
  assert.equal(w.interlokutor, null);
  assert.equal(w.ofertaId, null);
  assert.equal(w.ofertaTytul, null);
  /* `read` nieobecne to „nie wiem", a nie „nieprzeczytany" — inaczej panel
     twierdziłby coś, czego API nie powiedziało. */
  assert.equal(w.przeczytany, null);
  assert.deepEqual(mapujWatki({}), []);
  assert.deepEqual(mapujWatki(null), []);
});

test("mapowanie ofert: cena z walutą, sygnatura i stan; oferta bez id wypada", () => {
  const oferty = mapujOferty(
    {
      offers: [
        {
          id: "of-1",
          name: "Cewka zapłonowa NAC T375",
          sellingMode: { price: { amount: "39.90", currency: "PLN" } },
          external: { id: "W80-2005" },
          stock: { available: 7 },
        },
        { name: "Oferta bez identyfikatora" },
      ],
    },
    false
  );
  assert.equal(oferty.length, 1);
  assert.equal(oferty[0].cena, "39.90 PLN");
  assert.equal(oferty[0].externalId, "W80-2005");
  assert.equal(oferty[0].dostepnych, 7);
  assert.equal(oferty[0].url, "https://allegro.pl/oferta/of-1");
});

test("mapowanie ofert: śmieci dają pustą listę, nie wyjątek", () => {
  assert.deepEqual(mapujOferty({ offers: "nie tablica" }, false), []);
  assert.deepEqual(mapujOferty(null, false), []);
  const [o] = mapujOferty({ offers: [{ id: "x" }] }, false);
  assert.equal(o.cena, null);
  assert.equal(o.externalId, null);
  assert.equal(o.dostepnych, null);
});

test("komunikat 403 wskazuje uprawnienie właściwe dla końcówki", () => {
  /* Rozjazd scope'ów jest pierwszą awarią wdrożenia — zdanie ma prowadzić
     do naprawy, a nie mówić o zamówieniach przy wysyłce wiadomości. */
  assert.equal(scopeDlaUrl("https://api.allegro.pl/messaging/threads/1/messages"), "allegro:api:messaging");
  assert.equal(scopeDlaUrl("https://api.allegro.pl/sale/offers?name=x"), "allegro:api:sale:offers:read");
  assert.equal(scopeDlaUrl("https://api.allegro.pl/sale/issues"), "allegro:api:disputes");
  assert.equal(scopeDlaUrl("https://api.allegro.pl/order/customer-returns"), "allegro:api:orders:read");
});

test("rodzina końcówki obejmuje nowe ścieżki — nauka Accept ich nie miesza", () => {
  assert.equal(rodzinaKoncowki(urlOfert("https://api.allegro.pl", "x")), "offers");
  assert.equal(rodzinaKoncowki(urlWyslijWiadomosc("https://api.allegro.pl", "t")), "threads");
});

test("przesyłki: URL-e kodowane, rodzina carriers osobno, scope orders:read", () => {
  assert.equal(
    urlZamowienKupujacego("https://api.allegro.pl", "jan wraca", 3),
    "https://api.allegro.pl/order/checkout-forms?buyer.login=jan%20wraca&limit=3&sort=-updatedAt"
  );
  assert.equal(
    urlPrzesylekZamowienia("https://api.allegro.pl", "ord/1"),
    "https://api.allegro.pl/order/checkout-forms/ord%2F1/shipments"
  );
  assert.equal(
    urlSledzenia("https://api.allegro.pl", "INPOST", "WB 1&x"),
    "https://api.allegro.pl/order/carriers/INPOST/tracking?waybill=WB%201%26x"
  );
  /* Własna rodzina Accept — beta jednej końcówki nie przestawia drugiej. */
  assert.equal(rodzinaKoncowki(urlSledzenia("https://api.allegro.pl", "INPOST", "X")), "carriers");
  /* Śledzenie ma chodzić na już sparowanym orders:read — dopóki sandbox nie
     powie inaczej, 403 ma wskazywać właśnie ten scope. */
  assert.equal(
    scopeDlaUrl("https://api.allegro.pl/order/carriers/INPOST/tracking?waybill=X"),
    "allegro:api:orders:read"
  );
});

test("zamówienie kupującego: mapowanie defensywne i ZERO adresu w wyniku", () => {
  const z = mapujZamowienieKupujacego({
    id: "ord-9", boughtAt: "2026-08-24T10:00:00Z", status: "READY_FOR_PROCESSING",
    fulfillment: { status: "SENT" },
    delivery: {
      method: { id: "m1", name: "Kurier DPD" }, smart: true,
      time: { from: "2026-08-26T08:00:00Z", to: "2026-08-27T16:00:00Z" },
      /* Dane osobowe — mapper ma je ZOSTAWIĆ w JSON-ie, nie przenieść dalej. */
      address: { street: "Polna 1", city: "Poznań", zipCode: "60-001" },
      pickupPoint: { id: "PP1", name: "Paczkomat POZ01" },
    },
    lineItems: [{ offer: { id: "of-1", name: "Cewka", external: { id: "W32-0001" } }, quantity: 2 }],
  });
  assert.equal(z.wysylka, "SENT");
  assert.equal(z.dostawaMetoda, "Kurier DPD");
  assert.equal(z.smart, true);
  assert.equal(z.dostawaOd, "2026-08-26T08:00:00Z");
  assert.equal(z.pozycje[0].externalId, "W32-0001");
  /* Asercja prywatności: żadne pole wyniku nie niesie adresu ani punktu. */
  assert.ok(!JSON.stringify(z).includes("Polna"), "adres nie przechodzi przez mapper");
  assert.ok(!JSON.stringify(z).includes("Paczkomat POZ01"), "punkt odbioru nie przechodzi");

  const pusty = mapujZamowienieKupujacego({});
  assert.equal(pusty.wysylka, null);
  assert.equal(pusty.smart, false);
  assert.deepEqual(pusty.pozycje, []);
});

test("przesyłki i śledzenie: oba kształty, śmieci dają pustkę, nie wyjątek", () => {
  const p = mapujPrzesylki({
    shipments: [{ waybill: "WB1", carrierId: "INPOST", carrierName: "InPost", createdAt: "2026-08-24T10:00:00Z" }],
  });
  assert.equal(p[0].przewoznikId, "INPOST");
  assert.deepEqual(mapujPrzesylki({}), []);

  const plaski = mapujSledzenie({ statuses: [{ status: "SENT", description: "Nadana", occurredAt: "2026-08-24T11:00:00Z" }] });
  assert.equal(plaski[0].kod, "SENT");
  const zagniezdzony = mapujSledzenie({
    carriers: [{ trackingDetails: { statuses: [{ code: "OUT", description: "W doręczeniu", date: "2026-08-26T08:00:00Z" }] } }],
  });
  assert.equal(zagniezdzony[0].kod, "OUT");
  assert.equal(zagniezdzony[0].at, "2026-08-26T08:00:00Z");
  assert.deepEqual(mapujSledzenie(null), []);
  assert.deepEqual(mapujSledzenie({ carriers: "śmieć" }), []);
});

/* ── Rytm parowania i anti-bot Allegro (0.106.0) ────────────────────────────
   Endpointy OAuth stoją na apeksie `allegro.pl`, za tym samym edge'em co
   sklep. Odpytywanie stanu parowania jest więc jedynym ruchem aplikacji,
   który widzi anti-bot — i to on wygenerował blokadę adresu IP.            */

test("parowanie: odstęp ma podłogę 5 s i rośnie z czasem czekania", () => {
  // Allegro może podać `interval: 1` — my i tak nie schodzimy poniżej 5 s
  assert.equal(interwalParowania(0, 1000), 5000);
  assert.equal(interwalParowania(0, 5000), 5000);
  // baza większa od podłogi zostaje bazą
  assert.equal(interwalParowania(0, 8000), 8000);
  /* Człowiek potwierdza kod w kilkanaście sekund. Cisza po minucie i po
     trzech znaczy, że odszedł od komputera — pytanie co pięć sekund przez
     kolejne pół godziny niczego nie przyspiesza, a buduje ślad maszyny. */
  assert.equal(interwalParowania(61_000, 5000), 10_000);
  assert.equal(interwalParowania(181_000, 5000), 20_000);
  // `slow_down` z Allegro (baza + 5 s) kumuluje się z naszym zwalnianiem
  assert.equal(interwalParowania(181_000, 25_000), 25_000);
});

test("strona blokady rozpoznana, zanim JSON.parse wywali się na HTML-u", () => {
  const html = "<!doctype html><html><body>Zostałeś zablokowany.</body></html>";
  assert.equal(czyStronaBlokady("text/html; charset=utf-8", html), true);
  assert.equal(czyStronaBlokady(null, html), true, "bez nagłówka rozstrzyga kształt treści");
  assert.equal(czyStronaBlokady("application/json", '{"error":"authorization_pending"}'), false);
  assert.equal(czyStronaBlokady(null, '{"access_token":"x"}'), false);
  // puste ciało to nie blokada — tak odpowiada część endpointów auth
  assert.equal(czyStronaBlokady(null, "   "), false);
});

test("brak ALLEGRO_USER_AGENT to zdanie w /api/health, nie cisza", () => {
  /* Allegro ostrzega przy rejestracji aplikacji, że brak własnego nagłówka
     grozi zablokowaniem klucza. Do 0.106.0 aplikacja nie mówiła o tym nic —
     objawem był dopiero blok, czyli moment, w którym jest już za późno. */
  const bylUA = config.allegro.userAgent;
  const bylTryb = config.allegro.mode;
  try {
    (config.allegro as { mode: string }).mode = "http";
    (config.allegro as { userAgent: string }).userAgent = "";
    assert.match(problemUserAgenta() ?? "", /ALLEGRO_USER_AGENT/);
    (config.allegro as { userAgent: string }).userAgent = "Wygenerowany/1.0 (abc123)";
    assert.equal(problemUserAgenta(), null);
    // w trybie dev nikt do Allegro nie dzwoni — zdanie byłoby szumem
    (config.allegro as { mode: string }).mode = "dev";
    (config.allegro as { userAgent: string }).userAgent = "";
    assert.equal(problemUserAgenta(), null);
  } finally {
    (config.allegro as { userAgent: string }).userAgent = bylUA;
    (config.allegro as { mode: string }).mode = bylTryb;
  }
});

test("rozmowa wraca od najstarszej, niezależnie od kolejności z API (0.107.0)", () => {
  /* Skarga z panelu: „kolejność wiadomości w czacie jest odwrócona".
     Centrum wiadomości potrafi oddać wątek od najnowszej, a my braliśmy
     listę tak, jak przyszła. Poza wyglądem psuło to synchronizację pytań:
     za „ostatnią wiadomość klienta" robiła się ta sprzed tygodni. */
  const w = mapujWiadomosci(
    {
      messages: [
        { id: "nowa", author: { role: "BUYER" }, text: "trzecia", createdAt: "2026-08-20T12:00:00Z" },
        { id: "stara", author: { role: "BUYER" }, text: "pierwsza", createdAt: "2026-08-18T09:00:00Z" },
        { id: "srodek", author: { role: "SELLER" }, text: "druga", createdAt: "2026-08-19T09:00:00Z" },
      ],
    },
    null
  );
  assert.deepEqual(w.map((m) => m.id), ["stara", "srodek", "nowa"]);

  /* Wiadomość bez daty nie ma jak trafić w oś czasu — ląduje na końcu,
     w kolejności z API, zamiast udawać najstarszą. */
  const zBrakiem = mapujWiadomosciDyskusji({
    messages: [
      { id: "bez-daty", author: { role: "BUYER" }, text: "?" },
      { id: "z-data", author: { role: "BUYER" }, text: "!", createdAt: "2026-08-19T09:00:00Z" },
    ],
  });
  assert.deepEqual(zBrakiem.map((m) => m.id), ["z-data", "bez-daty"]);
});

test("wiadomość niesie aukcję, o którą pyta klient (0.107.0)", () => {
  /* Kupujący klika PYTANIE przy konkretnej ofercie i Allegro wpina ją
     w `relatedObject` TEJ wiadomości — wątek zna tylko pierwszą sprawę,
     jaką klient kiedykolwiek zgłosił. Bez tego pola biuro odpowiadało
     o cudzym towarze, a szkic AI szukał symbolu nie tej aukcji. */
  const w = mapujWiadomosci(
    {
      messages: [
        { id: "m1", author: { role: "BUYER" }, text: "Pasuje do Stihl?", relatedObject: { type: "OFFER", id: "1122" } },
        { id: "m2", author: { role: "BUYER" }, text: "A ta?", offer: { id: "3344" } },
        { id: "m3", author: { role: "BUYER" }, text: "Reklamacja", relatedObject: { type: "ORDER", id: "zam-9" } },
      ],
    },
    null
  );
  assert.equal(w[0].ofertaId, "1122", "relatedObject typu OFFER to aukcja pytania");
  assert.equal(w[1].ofertaId, "3344", "starszy kształt `offer.id` też czytamy");
  assert.equal(w[2].ofertaId, null, "powiązanie z zamówieniem to nie oferta");
});

test("oferta po id: link, cena i symbol z naszego magazynu (0.107.0)", () => {
  assert.equal(
    urlOfertyPoId("https://api.allegro.pl", "11 22/33"),
    "https://api.allegro.pl/sale/offers/11%2022%2F33"
  );
  const o = mapujOferte(
    {
      id: "1122",
      name: "Nóż kosiarki 51 cm",
      sellingMode: { price: { amount: "89.00", currency: "PLN" } },
      external: { id: "NK-51" },
      stock: { available: 7 },
    },
    false
  );
  assert.equal(o?.externalId, "NK-51", "symbol z Subiekta prowadzi do towaru");
  assert.equal(o?.cena, "89.00 PLN");
  assert.equal(o?.dostepnych, 7);
  assert.match(o?.url ?? "", /1122/);
  /* Oferta zdjęta ze sprzedaży wraca bez id — wtedy NULL, nie pusta karta. */
  assert.equal(mapujOferte({}, false), null);
  assert.equal(mapujOferte(null, false), null);
});
