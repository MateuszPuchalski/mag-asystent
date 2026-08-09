import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Wiersz „PRZESYŁKA / koszt transportu" nie jest towarem ──────────────────
   Na fakturze zakupu bywa pozycja, której nie da się dotknąć ani położyć na
   półce. Reguła ma jeden warunek, który łatwo przegapić: licznik pozycji PRZED
   otwarciem dostawy i liczba linii PO otwarciu muszą się zgadzać. Odsiew tylko
   po jednej stronie daje dokument, który przy wejściu w ekran „gubi pozycję" —
   i tak właśnie zostałby zgłoszony.                                           */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-uslug-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");
let subiekt: typeof import("../context.js").subiekt;

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
  ({ subiekt } = await import("../context.js"));
});

const DOK = 900;
const TOWAR = 11;
const PRZESYLKA = 12;

/** Data sprzed N dni — lista dostaw ma okno 14-dniowe. */
const wczoraj = () => new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

beforeEach(() => {
  const d = db();
  d.prepare("DELETE FROM delivery_line").run();
  d.prepare("DELETE FROM delivery").run();
  d.prepare("DELETE FROM sgt_pozycja").run();
  d.prepare("DELETE FROM sgt_dokument").run();
  d.prepare("DELETE FROM sgt_towar").run();

  d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, lokalizacja) VALUES (?,?,?,?)"
  ).run(TOWAR, "LS51-139", "Gaźnik kompletny", "A01-02-03");
  // symbol z ogonkiem — tak jak stoi w kartotece klienta
  d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, lokalizacja) VALUES (?,?,?,?)"
  ).run(PRZESYLKA, "PRZESYŁKA", "koszt transportu", "");

  d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,'FZ','FZ 900/MAG/08/2026',?,1,'Dostawca sp. z o.o.',0)`
  ).run(DOK, wczoraj());
  const poz = db().prepare(
    "INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)"
  );
  poz.run(DOK, TOWAR, 4);
  poz.run(DOK, PRZESYLKA, 1);
});

test("pozycja usługowa nie wchodzi do snapshotu dostawy", () => {
  const id = D.openDelivery(DOK, "tester");
  const widok = D.getDelivery(id)!;
  assert.deepEqual(
    widok.lines.map((l) => l.sym),
    ["LS51-139"]
  );
});

test("licznik pozycji przed otwarciem zgadza się z liczbą linii po otwarciu", () => {
  /* TEN warunek jest sednem. Gdyby odsiew był tylko w snapshocie, dokument
     pokazywałby „2 pozycje", a po wejściu „1 z 1" — liczba zmieniająca się od
     samego otwarcia ekranu wygląda jak zgubiona pozycja. */
  const przed = subiekt.countPositionsByDoc().get(DOK) ?? 0;
  const id = D.openDelivery(DOK, "tester");
  assert.equal(przed, D.getDelivery(id)!.lines.length);
  assert.equal(przed, 1);
});

test("dostawa z samą przesyłką jest od razu kompletna", () => {
  // celowa i zamierzona cena tej reguły: nie ma czego rozkładać, więc lista
  // pozycji jest pusta zamiast wisieć z jedną niezałatwioną linią
  db().prepare("DELETE FROM sgt_pozycja WHERE tw_id = ?").run(TOWAR);
  const id = D.openDelivery(DOK, "tester");
  assert.equal(D.getDelivery(id)!.lines.length, 0);
});

test("wznowienie sprząta przesyłkę z dostawy otwartej starszą wersją", () => {
  /* Snapshot jest snapshotem, ale ten wiersz jest tam skutkiem naszego
     niedopatrzenia. Bez sprzątania zostałby na zawsze: dostawa raz otwarta
     nigdy nie wraca do gałęzi snapshotującej, a jedynej niemożliwej do
     odłożenia pozycji nie da się domknąć. */
  const id = D.openDelivery(DOK, "tester");
  db()
    .prepare(
      `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok)
       VALUES (?,?,?,?,?)`
    )
    .run(id, PRZESYLKA, "PRZESYŁKA", "koszt transportu", 1);

  assert.equal(D.openDelivery(DOK, "tester"), id);
  assert.deepEqual(
    D.getDelivery(id)!.lines.map((l) => l.sym),
    ["LS51-139"]
  );
});

test("sprzątanie NIE rusza linii, na której ktoś już coś zrobił", () => {
  // ślad ludzkiej decyzji — skasowanie go byłoby zacieraniem historii,
  // a nie sprzątaniem po nas
  const id = D.openDelivery(DOK, "tester");
  db()
    .prepare(
      `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, status)
       VALUES (?,?,?,?,?, 'problem')`
    )
    .run(id, PRZESYLKA, "PRZESYŁKA", "koszt transportu", 1);

  D.openDelivery(DOK, "tester");
  assert.equal(D.getDelivery(id)!.lines.length, 2);
});
