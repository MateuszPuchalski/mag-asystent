import { test } from "node:test";
import assert from "node:assert/strict";
import { USUNIETE, oczyscSurowy, zostalyWrazliwe } from "./allegro-oczyszczanie.js";

/* ── Strażnik polityki danych ────────────────────────────────────────────────
   Do 0.151.0 lądowisko zwrotów trzymało IBAN kupującego i telefon nadawcy,
   choć polityka danych mówiła „nie pobieramy". Te testy są tym, co zamienia
   zdanie w dokumencie na własność kodu.                                     */

/* Kształty z `docs/allegro/swagger.yaml`: CustomerReturnRefundBankAccount,
   CustomerReturnParcelSender, CheckoutForm.buyer, CheckoutFormDeliveryReference. */
const ZWROT = {
  id: "zw-1",
  createdAt: "2026-08-30T08:00:00Z",
  refund: {
    bankAccount: {
      owner: "Jan Kowalski", accountNumber: "61109010140000071219812874",
      iban: "PL61109010140000071219812874", swift: "WBKPPLPP",
      address: { street: "Polna 7", city: "Poznań", postCode: "61-001" },
    },
  },
  parcels: [{ createdAt: "2026-08-31T09:00:00Z", waybill: "PX1", carrierId: "INPOST",
    sender: { phoneNumber: "600100200" } }],
  items: [{ offerId: "111", name: "Sekator", quantity: 1,
    price: { amount: "49.99", currency: "PLN" } }],
};

const ZAMOWIENIE = {
  id: "ord-1",
  status: "READY_FOR_PROCESSING",
  messageToSeller: "Proszę o fakturę na Jan Kowalski, Polna 7",
  buyer: {
    id: "b-1", login: "client:44300444", email: "jan@example.com",
    firstName: "Jan", lastName: "Kowalski", companyName: "Kowalski sp. z o.o.",
    personalIdentity: "80010112345", phoneNumber: "600100200",
    address: { street: "Polna 7", city: "Poznań", postCode: "61-001" },
  },
  delivery: {
    method: { id: "m-1", name: "Kurier InPost" },
    cost: { amount: "14.99", currency: "PLN" },
    address: { firstName: "Jan", lastName: "Kowalski", street: "Polna 7", city: "Poznań" },
  },
  lineItems: [{ id: "li-1", quantity: 2, price: { amount: "89.99", currency: "PLN" },
    offer: { id: "111", name: "Sekator NAC", external: { id: "SEK-NAC-46" } } }],
  summary: { totalToPay: { amount: "194.97", currency: "PLN" } },
};

const tekst = (v: unknown) => JSON.stringify(v);

test("konto bankowe i telefon nadawcy znikają ze zwrotu", () => {
  const czysty = oczyscSurowy(ZWROT);
  const s = tekst(czysty);
  for (const tajne of ["PL61109010140000071219812874", "Jan Kowalski", "WBKPPLPP",
    "600100200", "Polna 7"]) {
    assert.equal(s.includes(tajne), false, `„${tajne}" nie ma prawa wejść do bazy`);
  }
});

test("adres, e-mail i PESEL znikają z zamówienia", () => {
  const s = tekst(oczyscSurowy(ZAMOWIENIE));
  for (const tajne of ["jan@example.com", "80010112345", "Kowalski", "Polna 7",
    "600100200", "Proszę o fakturę"]) {
    assert.equal(s.includes(tajne), false, `„${tajne}" nie ma prawa wejść do bazy`);
  }
});

test("wartość znika, ale KLUCZ zostaje — lądowisko ma dalej nieść kształt", () => {
  /* Kasowanie gałęzi zabrałoby lądowisku to, po co istnieje: wiedzę, że pole
     w ogóle przyszło. Bez tego rozjazd kształtu wyglądałby jak brak pola. */
  const czysty = oczyscSurowy(ZWROT) as Record<string, any>;
  assert.equal("bankAccount" in czysty.refund, true, "klucz ma zostać");
  assert.equal(czysty.refund.bankAccount, USUNIETE);
  assert.equal(czysty.parcels[0].sender, USUNIETE);
  /* Numer listu zostaje, choć `ksztalt.ts` odsiewa go z raportu sondy. Obie
     oceny są prawdziwe o różnych miejscach — raport wchodzi do repo, lądowisko
     jest prywatną kopią w bazie biura. Od 0.163.0 to lądowisko jest JEDYNYM
     miejscem, gdzie skan etykiety znajduje zwrot po numerze listu. */
  assert.equal(czysty.parcels[0].waybill, "PX1", "list przewozowy zostaje w prywatnej kopii");
});

test("wszystko, co rozstrzyga zwrot, przechodzi bez zmian", () => {
  const z = oczyscSurowy(ZWROT) as Record<string, any>;
  assert.equal(z.id, "zw-1");
  assert.equal(z.parcels[0].createdAt, "2026-08-31T09:00:00Z", "fakt powrotu paczki zostaje");
  assert.deepEqual(z.items[0].price, { amount: "49.99", currency: "PLN" });

  const o = oczyscSurowy(ZAMOWIENIE) as Record<string, any>;
  assert.equal(o.lineItems[0].offer.external.id, "SEK-NAC-46", "SKU to cały mostek do kartoteki");
  assert.deepEqual(o.delivery.cost, { amount: "14.99", currency: "PLN" }, "koszt dostawy zostaje");
  assert.equal(o.delivery.method.name, "Kurier InPost", "nazwa metody to nie nazwisko");
  assert.deepEqual(o.summary.totalToPay, { amount: "194.97", currency: "PLN" });
});

test("login i identyfikator kupującego zostają — polityka dopuszcza je wprost", () => {
  /* Bez loginu nie da się powiązać zwrotu z rozmową, a polityka danych
     skrzynki wymienia go jako jedyną dopuszczoną daną osobową. */
  const o = oczyscSurowy(ZAMOWIENIE) as Record<string, any>;
  assert.equal(o.buyer.login, "client:44300444");
  assert.equal(o.buyer.id, "b-1");
  assert.equal(o.buyer.email, USUNIETE);
});

test("wejścia nie mutujemy — model pracy mapuje się z oryginału", () => {
  /* Gdyby funkcja czyściła w miejscu, mapowanie dostałoby znacznik zamiast
     daty paczki i zwrot straciłby dowód powrotu towaru. */
  const kopia = JSON.parse(JSON.stringify(ZWROT));
  oczyscSurowy(kopia);
  assert.equal(kopia.refund.bankAccount.iban, "PL61109010140000071219812874");
});

test("czyszczenie sięga w głąb tablic i zagnieżdżeń", () => {
  const glebokie = { a: [{ b: [{ c: { email: "x@y.pl", ok: 1 } }] }] };
  const w = oczyscSurowy(glebokie) as any;
  assert.equal(w.a[0].b[0].c.email, USUNIETE);
  assert.equal(w.a[0].b[0].c.ok, 1);
});

test("`null` w polu wrażliwym też dostaje znacznik", () => {
  /* Inaczej „pole przyszło puste" i „pole wycięliśmy" wyglądałyby tak samo. */
  const w = oczyscSurowy({ buyer: { address: null } }) as any;
  assert.equal(w.buyer.address, USUNIETE);
});

test("wykrywacz mówi, czy w zapisanym JSON-ie coś zostało", () => {
  assert.equal(zostalyWrazliwe(tekst(ZWROT)), true, "surowy zwrot ma dane wrażliwe");
  assert.equal(zostalyWrazliwe(tekst(oczyscSurowy(ZWROT))), false);
  assert.equal(zostalyWrazliwe(tekst(oczyscSurowy(ZAMOWIENIE))), false);
  assert.equal(zostalyWrazliwe("to nie jest json"), false, "śmieć nie ma być alarmem");
});
