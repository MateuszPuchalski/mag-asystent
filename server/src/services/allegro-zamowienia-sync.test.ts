import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { brakujaceZamowienia, uzupelnijZamowienia } from "./allegro-zamowienia-sync.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { zostalyWrazliwe } from "./allegro-oczyszczanie.js";

/* Kształt zamówienia wzięty ze schematów `CheckoutForm`, `OfferReference`
   i `CheckoutFormDeliveryReference` w `docs/allegro/swagger.yaml`. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

/* Konto kanału, które `stanowisko()` zakłada jako pierwsze i jedyne.
   `brakujaceZamowienia` bierze je PARAMETREM od 0.249.1: pamięć negatywu
   musi odsiewać tym samym kluczem, którym zapisuje. */
const KONTO = 1;

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  /* Konto kanału musi być TO SAMO, co rozwiąże `kontoKanalu` w przebiegu —
     inaczej zamówienie wyląduje na drugim koncie i złączenie ze zwrotem nie
     trafi. W produkcji oba synchronizatory dostają ten sam `clientId`, więc
     zgadzają się z definicji; w teście wymuszamy to `accountId`. */
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

function zwrot(d: Db, ext: string, orderId: string | null, utworzono = "2026-08-30T08:00:00Z") {
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,created_at,synced_at)
    VALUES (1,?,?,?,?)`).run(ext, orderId, utworzono, utworzono);
}

const zamowienie = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: "READY_FOR_PROCESSING", updatedAt: "2026-08-29T10:00:00Z",
  buyer: { id: "b-1", login: "client:44300444", email: "jan@example.com",
    firstName: "Jan", lastName: "Kowalski", phoneNumber: "600100200",
    address: { street: "Polna 7", city: "Poznań" } },
  delivery: { method: { name: "Kurier InPost" }, cost: { amount: "14.99", currency: "PLN" },
    address: { firstName: "Jan", lastName: "Kowalski", street: "Polna 7" } },
  summary: { totalToPay: { amount: "194.97", currency: "PLN" } },
  lineItems: [
    { id: "li-1", quantity: 2, price: { amount: "89.99", currency: "PLN" },
      boughtAt: "2026-08-20T11:00:00Z",
      offer: { id: "111", name: "Sekator NAC", external: { id: "SEK-NAC-46" } } },
    { id: "li-2", quantity: 1, price: { amount: "14.99", currency: "PLN" },
      boughtAt: "2026-08-19T11:00:00Z",
      offer: { id: "222", name: "Zraszacz", external: null } },
  ],
  ...extra,
});

test("dociągamy tylko zamówienia, do których prowadzi zwrot", () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  zwrot(d, "z2", "ord-2");
  zwrot(d, "z3", null);
  zwrot(d, "z4", "");
  assert.deepEqual(brakujaceZamowienia(d, KONTO, 10).sort(), ["ord-1", "ord-2"],
    "zwrot bez numeru zamówienia nie generuje żądania");
});

test("to samo zamówienie przy dwóch zwrotach pobiera się raz", () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  zwrot(d, "z2", "ord-1");
  assert.deepEqual(brakujaceZamowienia(d, KONTO, 10), ["ord-1"]);
});

/* Numer zamówienia prowadzi tu także z WIADOMOŚCI (0.166.0, gałąź
   `relatesTo.order`). Bez tego rozmowa pokazywałaby goły numer na zawsze —
   ticker nie miałby powodu, żeby po treść sięgnąć. */
function wiadomosc(d: Db, ext: string, orderId: string | null, sentAt = "2026-08-30T09:00:00Z") {
  d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,updated_at)
    VALUES (1,?,?)`).run(`w-${ext}`, sentAt);
  const rozmowa = Number((d.prepare("SELECT id FROM conversation WHERE external_conversation_id=?")
    .get(`w-${ext}`) as { id: number }).id);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,
    body,related_order_id,sent_at) VALUES (?,1,?,'incoming','Kiedy wysyłka?',?,?)`)
    .run(rozmowa, ext, orderId, sentAt);
}

test("zamówienie wskazane w wiadomości klienta też idzie do pobrania", () => {
  const d = stanowisko();
  wiadomosc(d, "m1", "ord-7");
  wiadomosc(d, "m2", null);
  zwrot(d, "z1", "ord-1");
  assert.deepEqual(brakujaceZamowienia(d, KONTO, 10).sort(), ["ord-1", "ord-7"],
    "wiadomość bez numeru zamówienia nie generuje żądania");
});

test("zamówienie z wiadomości, które już mamy, nie wraca na listę", () => {
  const d = stanowisko();
  wiadomosc(d, "m1", "ord-7");
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (1,'ord-7','2026-09-01T09:00:00Z')`).run();
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,'111','Sekator NAC','SEK-NAC-46',1,8999,'PLN')`).run();
  assert.deepEqual(brakujaceZamowienia(d, KONTO, 10, new Date("2026-09-01T10:00:00Z")), []);
});

test("bezpiecznik ogranicza liczbę żądań w jednym przebiegu", async () => {
  /* Świeża baza ma po pierwszej synchronizacji dziewięćdziesiąt dni zwrotów.
     Tyle żądań w jednym ciągu z jednego adresu to sygnatura, po której
     Allegro odcina konto. */
  const d = stanowisko();
  for (let i = 0; i < 50; i++) zwrot(d, `z${i}`, `ord-${i}`);
  let wywolan = 0;
  await uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k", naPrzebieg: 20,
    query: async (u) => { wywolan++; return zamowienie(u.split("/").pop()!); },
  });
  assert.equal(wywolan, 20);
  const ile = d.prepare("SELECT COUNT(*) c FROM zamowienie_klienta").get() as { c: number };
  assert.equal(ile.c, 20);
});

test("zamówienie niesie koszt dostawy, sumę, SKU i wszystkie pozycje", async () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  await uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k", query: async () => zamowienie("ord-1"),
  });
  const z = d.prepare("SELECT * FROM zamowienie_klienta").get() as Record<string, unknown>;
  assert.equal(z.dostawa_grosze, 1499, "koszt dostawy to składnik, którego brakowało w 0.150.0");
  assert.equal(z.dostawa_metoda, "Kurier InPost");
  assert.equal(z.suma_grosze, 19497);
  assert.equal(z.kupujacy_login, "client:44300444", "login wolno trzymać");
  assert.equal(z.kupiono_at, "2026-08-19T11:00:00Z", "najwcześniejsza data zakupu z pozycji");

  const poz = d.prepare("SELECT * FROM zamowienie_klienta_pozycja ORDER BY id").all() as Array<Record<string, unknown>>;
  assert.equal(poz.length, 2, "pokazujemy CAŁE zamówienie, nie tylko zwracane pozycje");
  assert.equal(poz[0].sku, "SEK-NAC-46", "SKU to cały mostek do kartoteki");
  assert.equal(poz[0].cena_grosze, 8999);
  assert.equal(poz[1].sku, null, "brak SKU zostaje brakiem, nie pustym napisem");
});

test("adres, e-mail i telefon kupującego nie wchodzą ani do modelu, ani do lądowiska", async () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  await uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k", query: async () => zamowienie("ord-1"),
  });
  const model = JSON.stringify(d.prepare("SELECT * FROM zamowienie_klienta").get());
  const ladowisko = (d.prepare("SELECT surowe_json FROM allegro_zamowienie").get() as { surowe_json: string }).surowe_json;
  for (const tajne of ["jan@example.com", "Polna 7", "600100200", "Kowalski"]) {
    assert.equal(model.includes(tajne), false, `„${tajne}" nie wchodzi do modelu pracy`);
    assert.equal(ladowisko.includes(tajne), false, `„${tajne}" nie wchodzi do lądowiska`);
  }
  assert.equal(zostalyWrazliwe(ladowisko), false);
  assert.equal(ladowisko.includes("SEK-NAC-46"), true, "SKU zostaje — to nie dana osobowa");
});

test("jedno nieosiągalne zamówienie nie zabiera kontekstu pozostałym", async () => {
  /* Zamówienie sprzed lat bywa nieosiągalne. Jedno 404 nie ma prawa
     zostawić dziewiętnastu zwrotów bez zamówienia. */
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  zwrot(d, "z2", "ord-2");
  const ile = await uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k",
    query: async (u) => {
      if (u.endsWith("ord-1")) throw new BladOdpowiedziAllegro("nie ma", 404);
      return zamowienie("ord-2");
    },
  });
  assert.equal(ile, 1);
  const z = d.prepare("SELECT external_id FROM zamowienie_klienta").all() as Array<{ external_id: string }>;
  assert.deepEqual(z.map((r) => r.external_id), ["ord-2"]);
});

test("limit z Allegro przerywa przebieg od razu", async () => {
  /* Inaczej niż 404: dalsze żądania po 429 tylko pogłębiłyby przerwę. */
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  zwrot(d, "z2", "ord-2");
  let wywolan = 0;
  await assert.rejects(() => uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k",
    query: async () => { wywolan++; throw new BladLimituAllegro("limit", 900_000); },
  }));
  assert.equal(wywolan, 1, "po 429 nie pytamy o kolejne");
});

test("drugi przebieg nie ma czego pobierać", async () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  const opts = { database: d, apiUrl: "https://api", accountId: "k", query: async () => zamowienie("ord-1") };
  assert.equal(await uzupelnijZamowienia(opts), 1);
  assert.equal(await uzupelnijZamowienia(opts), 0, "ticker milczy, gdy nie ma pracy");
  const ile = d.prepare("SELECT COUNT(*) c FROM zamowienie_klienta_pozycja").get() as { c: number };
  assert.equal(ile.c, 2, "pozycje nie duplikują się przy ponownym zapisie");
});


test("zamówienie bez ani jednego SKU wraca do pobrania — po dobie", () => {
  /* Do 0.153.1 warunkiem było wyłącznie „nie ma takiego wiersza", więc jedna
     zła synchronizacja zamieniała się w trwały stan: po naprawieniu mapowania
     zamówienie i tak nie było odpytywane NIGDY. */
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (1,'ord-1','2026-08-30T10:00:00Z')`).run();
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,'111','Sekator',NULL,1,8999,'PLN')`).run();

  assert.deepEqual(brakujaceZamowienia(d, KONTO, 10, new Date("2026-09-01T10:00:00Z")), ["ord-1"],
    "puste SKU po dobie kwalifikuje do ponownego pobrania");
  assert.deepEqual(brakujaceZamowienia(d, KONTO, 10, new Date("2026-08-30T12:00:00Z")), [],
    "ale nie w kółko co dziesięć minut");
});

test("zamówienie z choćby jednym SKU zostaje w spokoju", () => {
  /* Sprzedawca, który opisał część oferty, nie ma być odpytywany codziennie
     o resztę — to jest jego decyzja, nie nasza awaria. */
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (1,'ord-1','2026-08-01T10:00:00Z')`).run();
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,'111','Sekator','SEK-46',1,8999,'PLN')`).run();
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,'222','Zraszacz',NULL,1,3490,'PLN')`).run();
  assert.deepEqual(brakujaceZamowienia(d, KONTO, 10, new Date("2026-09-01T10:00:00Z")), []);
});

test("SKU z samych spacji liczy się jak brak", () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (1,'ord-1','2026-08-01T10:00:00Z')`).run();
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja
    (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
    VALUES (1,'111','Sekator','   ',1,8999,'PLN')`).run();
  assert.deepEqual(brakujaceZamowienia(d, KONTO, 10, new Date("2026-09-01T10:00:00Z")), ["ord-1"]);
});

/* ── Pamięć negatywu (0.249.1) ───────────────────────────────────────────────
   Portal deweloperski Allegro pokazał 432 wywołania `GET /order/checkout-forms/{id}`
   zakończone 404 w krótkim czasie. Numer, którego Allegro nie zna, nie
   dostawał wiersza w `zamowienie_klienta` NIGDY, więc `k.id IS NULL` było
   prawdą na zawsze i ten sam zbiór ≤20 numerów wracał w każdym przebiegu.  */

const brak404 = async () => { throw new BladOdpowiedziAllegro("nie ma", 404); };

function liczneBraki(d: Db) {
  return (d.prepare("SELECT COUNT(*) c FROM zamowienie_klienta_brak").get() as { c: number }).c;
}

test("po 404 numer nie wraca w kolejnym przebiegu", async () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  let wywolan = 0;
  const opts = {
    database: d, apiUrl: "https://api", accountId: "k",
    query: async () => { wywolan++; return brak404(); },
  };
  await uzupelnijZamowienia(opts);
  assert.equal(wywolan, 1);
  await uzupelnijZamowienia(opts);
  assert.equal(wywolan, 1, "drugi przebieg NIE pyta ponownie — to jest cała ta poprawka");
  assert.equal(liczneBraki(d), 1);
});

test("po okresie negatywu numer wraca — raz, i tylko raz", async () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  let wywolan = 0;
  const przebieg = (kiedy: string) => uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k", now: () => new Date(kiedy),
    query: async () => { wywolan++; return brak404(); },
  });

  await przebieg("2026-09-01T10:00:00Z");
  assert.equal(wywolan, 1);
  await przebieg("2026-09-07T10:00:00Z");
  assert.equal(wywolan, 1, "przed upływem tygodnia numer milczy");

  await przebieg("2026-09-09T10:00:00Z");
  assert.equal(wywolan, 2, "po tygodniu dostaje JEDNĄ ponowną próbę");
  await przebieg("2026-09-09T10:10:00Z");
  assert.equal(wywolan, 2, "i zaraz po niej znowu milczy");

  const b = d.prepare("SELECT * FROM zamowienie_klienta_brak").get() as Record<string, unknown>;
  assert.equal(b.prob, 2, "druga próba podbija licznik");
  /* Odstęp rośnie z liczbą prób: druga próba odsuwa pytanie o czternaście dni,
     nie o siedem. Numer sprzed lat nie wróci, a my mamy o nim nie pamiętać
     częściej, niż to komukolwiek do czegoś służy. */
  assert.equal(b.ponow_po_at, "2026-09-23T10:00:00.000Z");
});

test("500 nie tworzy negatywu — to nie jest „nie ma”, tylko „nie wiadomo”", async () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  let wywolan = 0;
  const opts = {
    database: d, apiUrl: "https://api", accountId: "k",
    query: async () => { wywolan++; throw new BladOdpowiedziAllegro("padło", 500); },
  };
  await uzupelnijZamowienia(opts);
  await uzupelnijZamowienia(opts);
  assert.equal(liczneBraki(d), 0, "awaria Allegro nie ma prawa zabrać zamówienia na tydzień");
  assert.equal(wywolan, 2, "numer wraca do kolejki jak dotąd");
});

test("timeout nie tworzy negatywu", async () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  let wywolan = 0;
  const opts = {
    database: d, apiUrl: "https://api", accountId: "k",
    query: async () => { wywolan++; throw new Error("Brak połączenia z Allegro"); },
  };
  await uzupelnijZamowienia(opts);
  await uzupelnijZamowienia(opts);
  assert.equal(liczneBraki(d), 0, "minuta bez internetu to nie jest brak zamówienia");
  assert.equal(wywolan, 2);
});

test("429 po 404 NIE gubi zapamiętanego braku", async () => {
  /* Pętla, którą ta zmiana zamyka, sama tworzy warunki do 429: 404 podbijają
     ruch, ruch wywołuje limit. Gdyby limit kasował pamięć braków, poprawka
     nie działałaby dokładnie w tym przypadku, dla którego powstała. */
  const d = stanowisko();
  zwrot(d, "z1", "ord-1", "2026-08-30T09:00:00Z");
  zwrot(d, "z2", "ord-2", "2026-08-30T08:00:00Z");
  await assert.rejects(() => uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k",
    query: async (u) => {
      if (u.endsWith("ord-1")) throw new BladOdpowiedziAllegro("nie ma", 404);
      throw new BladLimituAllegro("limit", 900_000);
    },
  }));
  const b = d.prepare("SELECT external_id FROM zamowienie_klienta_brak").all() as Array<{ external_id: string }>;
  assert.deepEqual(b.map((r) => r.external_id), ["ord-1"],
    "negatyw sprzed limitu zostaje zapisany, mimo że przebieg się wywrócił");
});

test("pobrane zamówienie kasuje swój negatyw", async () => {
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  const opts = { database: d, apiUrl: "https://api", accountId: "k" };
  await uzupelnijZamowienia({ ...opts, query: brak404, now: () => new Date("2026-09-01T10:00:00Z") });
  assert.equal(liczneBraki(d), 1);
  await uzupelnijZamowienia({
    ...opts, now: () => new Date("2026-09-09T10:00:00Z"), query: async () => zamowienie("ord-1"),
  });
  assert.equal(liczneBraki(d), 0, "numer, który się pobrał, przestał być brakiem");
});

test("ręczne dociągnięcie omija pamięć negatywu", async () => {
  /* Przycisk „dociągnij zamówienia" istnieje po to, żeby ktoś patrzący na
     produkcję rozstrzygnął, czy problem jest w danych, czy w kodzie. Taki,
     który przez tydzień cicho oddaje `pobrano: 0`, nie rozstrzyga niczego. */
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  let wywolan = 0;
  const query = async () => { wywolan++; return brak404(); };
  await uzupelnijZamowienia({ database: d, apiUrl: "https://api", accountId: "k", query });
  assert.equal(wywolan, 1);
  await uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k", query, ignorujBrak: true,
  });
  assert.equal(wywolan, 2, "ręczne kliknięcie pyta mimo zapamiętanego braku");
});

test("zapamiętany brak zostawia ślad w events", async () => {
  /* 432 wywołania nie zostawiły w bazie ANI JEDNEGO śladu i właśnie dlatego
     awarię widać było wyłącznie w portalu Allegro. Jedno zdarzenie na
     przebieg, nie jedno na numer. */
  const d = stanowisko();
  zwrot(d, "z1", "ord-1");
  zwrot(d, "z2", "ord-2");
  await uzupelnijZamowienia({
    database: d, apiUrl: "https://api", accountId: "k", query: brak404,
  });
  const zd = d.prepare("SELECT payload FROM events WHERE type='allegro_zamowienie_brak'")
    .all() as Array<{ payload: string }>;
  assert.equal(zd.length, 1, "jeden wiersz na przebieg");
  assert.equal((JSON.parse(zd[0].payload) as { ile: number }).ile, 2);
});
