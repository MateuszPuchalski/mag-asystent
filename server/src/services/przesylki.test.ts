import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Przesyłki ostatnich zamówień ────────────────────────────────────────────
   Sedno: heurystyka rozpoznaje pytanie o wysyłkę bez fałszywek na „nadal",
   a złożenie danych ogranicza strzały (śledzenie tylko najnowszego
   zamówienia). Nieznany kupujący i brak loginu dają uczciwą pustkę.         */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-przes-")), "t.db");
process.env.SGT_MODE = "seeded";

let PR: typeof import("./przesylki.js");
let zresetujAdapterAllegro: typeof import("../adapters/allegro.js").zresetujAdapterAllegro;

before(async () => {
  ({ zresetujAdapterAllegro } = await import("../adapters/allegro.js"));
  PR = await import("./przesylki.js");
});

beforeEach(() => zresetujAdapterAllegro());

test("heurystyka: pytania o wysyłkę TAK, dobór części i słowo nadal NIE", () => {
  for (const tak of [
    "Kiedy dojdzie moja przesyłka?",
    "gdzie jest paczka",
    "Wysłali już Państwo zamówienie?",
    "czy dotarła płatność i kiedy kurier",
    "jaki jest status zamówienia",
    "będzie w paczkomacie?",
  ]) {
    assert.equal(PR.czyPytaOWysylke(tak), true, tak);
  }
  for (const nie of [
    "Czy ta cewka pasuje do T375?",
    "nadal nie działa po wymianie świecy",
    "jaka jest średnica wewnętrzna tej tulei",
    "proszę o fakturę na firmę",
  ]) {
    assert.equal(PR.czyPytaOWysylke(nie), false, nie);
  }
});

test("przesyłki kupującego: najnowsze naprzód, śledzenie tylko najnowszego", async () => {
  /* Login zamaskowany, jak w prawdziwych pytaniach z wątków. */
  const dane = await PR.przesylkiKupujacego("client:44300101");
  assert.equal(dane.zamowienia.length, 2);
  const [najnowsze, starsze] = dane.zamowienia;
  assert.equal(najnowsze.wysylka, "SENT");
  assert.equal(najnowsze.wysylkaOpis, "Wysłane");
  assert.equal(najnowsze.przesylki[0].waybill, "DEVSHIP0101");
  assert.match(najnowsze.przesylki[0].ostatnieZdarzenie!.opis!, /doręczeniu/);
  /* Starsze zamówienie ma paczkę, ale BEZ zdarzeń — śledzenie robimy tylko
     dla najnowszego, bo każde zdarzenie to osobny strzał HTTP. */
  assert.equal(starsze.wysylkaOpis, "Doręczone / odebrane");
  assert.equal(starsze.przesylki[0].ostatnieZdarzenie, null);
});

test("kod spoza słownika idzie surowo; nieznany login i null dają pustkę", async () => {
  const dane = await PR.przesylkiKupujacego("client:44300104");
  assert.equal(dane.zamowienia[0].wysylkaOpis, "W przygotowaniu");
  assert.deepEqual(dane.zamowienia[0].przesylki, [], "jeszcze nie nadane = stan, nie błąd");

  assert.deepEqual((await PR.przesylkiKupujacego("client:99999999")).zamowienia, []);
  assert.deepEqual((await PR.przesylkiKupujacego(null)).zamowienia, []);
});

test("blok kontekstu: linia zamówienia niesie status, kuriera i ostatnie zdarzenie", async () => {
  const dane = await PR.przesylkiKupujacego("client:44300101");
  const blok = PR.blokPrzesylek(dane).join("\n");
  assert.match(blok, /PRZESYŁKI OSTATNICH ZAMÓWIEŃ KLIENTA/);
  assert.match(blok, /wysyłka: Wysłane/);
  assert.match(blok, /InPost, nr DEVSHIP0101/);
  assert.match(blok, /NIE obiecuj terminu/);

  const pusto = PR.blokPrzesylek({ login: "ktos", zamowienia: [] }).join("\n");
  assert.match(pusto, /nie ma zamówień/);
  assert.match(pusto, /NIE zgaduj/);
});
