import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-przeplyw-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Przepływ kategorii w trybie cienia ──────────────────────────────────────
   Pilnujemy czterech rzeczy. Tabela przepływów jest decyzją właściciela, więc
   test ją przypina. Reguły `propozycje` bronią jedynego działania
   nieodwracalnego, czyli wysyłki bez człowieka. Zapis jest idempotentny,
   a odczyt dla karty nic nie pisze. Werdykty agenta pilnuje
   `przeplyw-werdykt.test.ts`, tu służą tylko pomiarowi. */

let db: typeof import("../db/db.js").db;
let P: typeof import("./przeplyw-kategorii.js") & typeof import("./przeplyw-werdykt.js");
let poprawKlasyfikacje: typeof import("./copilot-klasyfikacja.js").poprawKlasyfikacje;
let ocenSzkic: typeof import("./copilot-szkic.js").ocenSzkic;
let konto = 0;
let biuro = 0;
const Ola = () => ({ id: biuro, name: "Ola" });

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ poprawKlasyfikacje } = await import("./copilot-klasyfikacja.js"));
  ({ ocenSzkic } = await import("./copilot-szkic.js"));
  P = { ...await import("./przeplyw-kategorii.js"), ...await import("./przeplyw-werdykt.js") };
});

beforeEach(() => {
  const d = db();
  for (const t of ["propozycja_przeplywu", "zadanie_terenowe", "szkic_copilota", "decyzja_klasyfikacji",
    "conversation_event", "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','p')")
    .run().lastInsertRowid);
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('o','Ola','biuro')").run().lastInsertRowid);
});

/** Decyzja, która przechodzi bramkę wysyłki. Każdy test psuje jedno pole. */
const DOBRA = {
  kategoria: "ORDER_STATUS", akcja: "GET_SHIPMENT", status: "SUCCESS", zrodlo: "MODEL",
  pewnosc: "wysoka", wymagaCzlowieka: false, brakDanychZamowienia: false, brakDanychProduktu: false,
};
const rodzaje = (l: Array<{ rodzaj: string }>) => l.map((p) => p.rodzaj);

test("tabela przepływów jest decyzją właściciela — przypięta co do kategorii", () => {
  const gdzie = (f: (p: import("./przeplyw-kategorii.js").Przeplyw) => boolean) =>
    Object.entries(P.PRZEPLYWY).filter(([, p]) => f(p)).map(([k]) => k).sort();
  assert.deepEqual(gdzie((p) => p.wysylka),
    ["ORDER_STATUS", "PRODUCT_AVAILABILITY", "PRODUCT_QUESTION", "RETURN"]);
  assert.deepEqual(gdzie((p) => p.krok !== null), ["MISSING_PRODUCT", "WRONG_PRODUCT"]);
  assert.deepEqual(gdzie((p) => p.pilne),
    ["CANCEL_ORDER", "COMPLAINT", "DELIVERY_DAMAGED", "DELIVERY_LOST", "MISSING_PRODUCT", "WRONG_PRODUCT"]);
  /* Wysyłka i pilność się wykluczają: pilne potrzebuje człowieka, więc
     odpowiedź bez człowieka byłaby sprzecznością w jednej kategorii. */
  assert.deepEqual(gdzie((p) => p.wysylka && (p.pilne || p.krok !== null)), []);
});

test("kategoria spoza słownika, „nic do zrobienia”, zastępcze i awaria — żadnej propozycji", () => {
  assert.deepEqual(P.propozycje({ ...DOBRA, kategoria: "dobor" }, { zastrzezen: 0 }), []);
  assert.deepEqual(P.propozycje({ ...DOBRA, kategoria: "toString" }, { zastrzezen: 0 }), []);
  assert.deepEqual(P.propozycje({ ...DOBRA, akcja: "NO_ACTION" }, { zastrzezen: 0 }), []);
  assert.deepEqual(P.propozycje({ ...DOBRA, kategoria: "COMPLAINT", zrodlo: "FALLBACK" }, null), []);
  assert.deepEqual(P.propozycje({ ...DOBRA, kategoria: "COMPLAINT", status: "FAILED" }, null), []);
});

test("wysyłka stoi na najwęższej bramce — każdy warunek osobno ją zamyka", () => {
  assert.deepEqual(rodzaje(P.propozycje(DOBRA, { zastrzezen: 0 })), ["wyslij"]);
  const zamyka: Array<[string, Parameters<typeof P.propozycje>]> = [
    ["przegląd", [{ ...DOBRA, status: "NEEDS_REVIEW" }, { zastrzezen: 0 }]],
    ["średnia pewność", [{ ...DOBRA, pewnosc: "srednia" }, { zastrzezen: 0 }]],
    ["brak pewności", [{ ...DOBRA, pewnosc: null }, { zastrzezen: 0 }]],
    ["wymaga człowieka", [{ ...DOBRA, wymagaCzlowieka: true }, { zastrzezen: 0 }]],
    ["brak danych zamówienia", [{ ...DOBRA, brakDanychZamowienia: true }, { zastrzezen: 0 }]],
    ["brak danych produktu", [{ ...DOBRA, brakDanychProduktu: true }, { zastrzezen: 0 }]],
    ["brak szkicu", [DOBRA, null]],
    ["zastrzeżenie w szkicu", [DOBRA, { zastrzezen: 1 }]],
    ["kategoria bez wysyłki", [{ ...DOBRA, kategoria: "INVOICE" }, { zastrzezen: 0 }]],
  ];
  for (const [powod, argumenty] of zamyka) {
    assert.deepEqual(P.propozycje(...argumenty), [], `${powod} nie zamknął wysyłki`);
  }
  /* Mapowanie Allegro to fakt ze struktury wątku, nie zgadywanie modelu,
     więc zastępuje pewność. */
  assert.deepEqual(rodzaje(P.propozycje({ ...DOBRA, zrodlo: "ALLEGRO_MAPPING", pewnosc: null },
    { zastrzezen: 0 })), ["wyslij"]);
});

test("pilne bez warunku pewności, krok tylko przy rozpoznaniu bez przeglądu", () => {
  const zla = { ...DOBRA, kategoria: "WRONG_PRODUCT", pewnosc: "niska", status: "NEEDS_REVIEW" };
  assert.deepEqual(rodzaje(P.propozycje(zla, null)), ["pilne"]);
  const k = P.propozycje({ ...zla, status: "SUCCESS" }, null);
  assert.deepEqual(rodzaje(k), ["krok", "pilne"]);
  assert.match(String(k[0]!.instrukcja), /inny towar/);
});

/** Rozmowa z pytaniem klienta i aktywną decyzją. Zwraca rozmowę, wiadomość i decyzję. */
function rozpoznana(kategoria: string, o: { pewnosc?: string; temat?: string } = {}) {
  const d = db();
  const r = Number(d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject)
    VALUES (?,?,?)`).run(konto, `w-${Math.random()}`, o.temat ?? "Kupujący 7").lastInsertRowid);
  const m = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,?,'incoming','Gdzie paczka?',?)`)
    .run(r, konto, `m-${Math.random()}`, new Date().toISOString()).lastInsertRowid);
  const k = Number(d.prepare(`INSERT INTO decyzja_klasyfikacji(conversation_id,message_id,wersja,aktywna,zrodlo,
    status,kategoria,akcja,wymaga_czlowieka,brak_danych_zamowienia,brak_danych_produktu,pewnosc,
    taksonomia_wersja,polityka_wersja,at,przez)
    VALUES (?,?,1,1,'MODEL','SUCCESS',?,'GET_ORDER',0,0,0,?,'v2','p1',?,'automat')`)
    .run(r, m, kategoria, o.pewnosc ?? "wysoka", new Date().toISOString()).lastInsertRowid);
  return { r, m, k };
}

function szkic(r: number, m: number, decyzja: number, zastrzezenia: string[] = []) {
  db().prepare(`INSERT INTO szkic_copilota(conversation_id,tresc,zastrzezenia,message_id,model,at,przez,decyzja_id)
    VALUES (?,?,?,?,'atrapa',?,'automat',?)
    ON CONFLICT(conversation_id) DO UPDATE SET decyzja_id=excluded.decyzja_id,
      zastrzezenia=excluded.zastrzezenia, message_id=excluded.message_id`)
    .run(r, "Paczka jest w drodze.", JSON.stringify(zastrzezenia), m, new Date().toISOString(), decyzja);
}

const zdarzen = (typ: string) =>
  Number((db().prepare("SELECT count(*) n FROM events WHERE type=?").get(typ) as { n: number }).n);

test("zapis jest idempotentny: drugi przebieg nic nie dubluje i nie pisze do dziennika", () => {
  const a = rozpoznana("ORDER_STATUS");
  szkic(a.r, a.m, a.k);
  const b = rozpoznana("WRONG_PRODUCT");
  assert.equal(P.zapiszPropozycje(db(), [a.r, b.r]), 3);
  assert.equal(zdarzen("przeplyw_propozycje"), 1, "jeden wpis zbiorczy na przebieg");
  assert.equal(P.zapiszPropozycje(db(), [a.r, b.r]), 0);
  assert.equal(zdarzen("przeplyw_propozycje"), 1);
  const w = db().prepare("SELECT przeplyw_wersja, message_id, decyzja_id FROM propozycja_przeplywu WHERE conversation_id=?")
    .get(a.r) as { przeplyw_wersja: string; message_id: number; decyzja_id: number };
  assert.equal(w.przeplyw_wersja, P.PRZEPLYW_WERSJA);
  assert.equal(w.message_id, a.m);
  assert.equal(w.decyzja_id, a.k);
});

test("szkic spod innej decyzji nie daje „wyslij”; świeży szkic dopisuje je drugim przebiegiem", () => {
  const a = rozpoznana("ORDER_STATUS");
  szkic(a.r, a.m, a.k + 1000);
  assert.equal(P.zapiszPropozycje(db(), [a.r]), 0);
  szkic(a.r, a.m, a.k, ["Brak numeru listu w faktach"]);
  assert.equal(P.zapiszPropozycje(db(), [a.r]), 0, "zastrzeżenie odcina wysyłkę");
  szkic(a.r, a.m, a.k);
  assert.equal(P.zapiszPropozycje(db(), [a.r]), 1);
});

test("karta widzi tylko bieżącą decyzję, w kolejności wyślij, krok, pilne — i nic nie zapisuje", () => {
  const a = rozpoznana("WRONG_PRODUCT");
  P.zapiszPropozycje(db(), [a.r]);
  const przed = Number((db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n);
  assert.deepEqual(rodzaje(P.propozycjeRozmowy(db(), a.r)), ["krok", "pilne"]);
  assert.equal(Number((db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n), przed);

  /* Poprawka kategorii to nowa decyzja: stare propozycje zostają w pomiarze,
     ale karta ich nie pokazuje, bo dotyczą innego rozpoznania. */
  poprawKlasyfikacje(db(), a.r, "INVOICE", null, Ola());
  assert.deepEqual(P.propozycjeRozmowy(db(), a.r), []);
  assert.equal(Number((db().prepare("SELECT count(*) n FROM propozycja_przeplywu").get() as { n: number }).n), 2);
});

test("odrzucony szkic to sprzeciw wobec „wyslij”, zapisany przy ocenie", () => {
  const a = rozpoznana("RETURN");
  szkic(a.r, a.m, a.k);
  P.zapiszPropozycje(db(), [a.r]);
  ocenSzkic(a.r, "odrzucony", Ola());
  const [p] = P.propozycjeRozmowy(db(), a.r);
  assert.equal(p!.werdykt, "sprzeciw");
  assert.equal(p!.werdyktZrodlo, "wysylka");
});

test("pomiar liczy per kategoria i rodzaj, tylko bieżącą wersję przepływów", () => {
  const a = rozpoznana("WRONG_PRODUCT");
  const b = rozpoznana("WRONG_PRODUCT");
  const c = rozpoznana("ORDER_STATUS");
  szkic(c.r, c.m, c.k);
  P.zapiszPropozycje(db(), [a.r, b.r, c.r]);
  const pilneA = P.propozycjeRozmowy(db(), a.r).find((p) => p.rodzaj === "pilne")!;
  const pilneB = P.propozycjeRozmowy(db(), b.r).find((p) => p.rodzaj === "pilne")!;
  P.werdyktPropozycji(db(), a.r, pilneA.id, "zgoda", Ola());
  P.werdyktPropozycji(db(), b.r, pilneB.id, "sprzeciw", Ola());
  /* Wiersz starej wersji tabeli nie wchodzi do pomiaru. */
  db().prepare("UPDATE propozycja_przeplywu SET przeplyw_wersja='w0' WHERE conversation_id=? AND rodzaj='krok'")
    .run(b.r);

  /* Wysyłka automatu liczy się osobno: werdykt da agent dopiero przy przeglądzie. */
  db().prepare("UPDATE propozycja_przeplywu SET wykonana_at=? WHERE conversation_id=? AND rodzaj='wyslij'")
    .run(new Date().toISOString(), c.r);

  assert.deepEqual(P.pomiarPrzeplywu(db()), [
    { kategoria: "ORDER_STATUS", rodzaj: "wyslij", propozycji: 1, zgod: 0, sprzeciwow: 0, bezWerdyktu: 1,
      wyslanychNaZywo: 1 },
    { kategoria: "WRONG_PRODUCT", rodzaj: "krok", propozycji: 1, zgod: 0, sprzeciwow: 0, bezWerdyktu: 1,
      wyslanychNaZywo: 0 },
    { kategoria: "WRONG_PRODUCT", rodzaj: "pilne", propozycji: 2, zgod: 1, sprzeciwow: 1, bezWerdyktu: 0,
      wyslanychNaZywo: 0 },
  ]);
});

test("karta pokazuje wysyłkę automatu także po dopisku klienta, ale nie starszą niż tydzień", () => {
  const a = rozpoznana("ORDER_STATUS");
  szkic(a.r, a.m, a.k);
  P.zapiszPropozycje(db(), [a.r]);
  const teraz = new Date("2026-10-06T10:00:00.000Z");
  db().prepare("UPDATE propozycja_przeplywu SET wykonana_at=? WHERE conversation_id=?")
    .run("2026-10-06T09:00:00.000Z", a.r);
  /* Poprawka kategorii robi nową decyzję, jak dopisek klienta po wysyłce. */
  poprawKlasyfikacje(db(), a.r, "INVOICE", null, Ola());
  const [p] = P.propozycjeRozmowy(db(), a.r, teraz);
  assert.equal(p?.rodzaj, "wyslij");
  assert.equal(p?.wykonanaAt, "2026-10-06T09:00:00.000Z");
  assert.equal(p?.wykonanieBlad, null);

  db().prepare("UPDATE propozycja_przeplywu SET wykonana_at=? WHERE conversation_id=?")
    .run("2026-09-28T09:00:00.000Z", a.r);
  assert.deepEqual(P.propozycjeRozmowy(db(), a.r, teraz), []);
});
