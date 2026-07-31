import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Faktura sprawdzona w Subiekcie, ale nigdy nieotwarta na kolektorze ───────
   Flaga szła w jedną stronę: aplikacja ją wyliczała i wysyłała, a z Subiekta
   czytała wyłącznie po to, żeby wykryć nadpisanie — i tylko dla dostaw, które
   sama wcześniej oznaczyła.

   Na ekranie wyglądało to tak, że KAŻDA faktura jest niesprawdzona. Dokument
   oznaczony w Subiekcie, ale bez wiersza w `delivery`, nie miał pastylki i stał
   na górze listy pracy razem z nietkniętymi. Magazynier dostawał do rozłożenia
   dostawę, którą ktoś już rozłożył — a to jest ten rodzaj błędu, po którym
   przestaje się ufać całej liście.

   Te testy pilnują obu kierunków naraz: że flaga biura dochodzi na ekran ORAZ
   że nie przykrywa stanu dostawy prowadzonej właśnie na kolektorze.           */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-flaga-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";
// `flg_Id` czterech flag — na produkcji ustala je DEPLOY §6, w teście udajemy je
process.env.DOC_FLAG_IN_PROGRESS_SGT = "1";
process.env.DOC_FLAG_PAUSED_SGT = "2";
process.env.DOC_FLAG_DONE_SGT = "3";
process.env.DOC_FLAG_DONE_ERRORS_SGT = "4";

let db: typeof import("../db/db.js").db;
let config: typeof import("../config.js").config;
let listDocuments: typeof import("./delivery.js").listDocuments;
let openDelivery: typeof import("./delivery.js").openDelivery;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ listDocuments, openDelivery } = await import("./delivery.js"));
});

const TOWAR = 21;
const SPRAWDZONA = 600;
const OBCA = 601;
const NIETKNIETA = 602;

const dzis = () => new Date().toISOString().slice(0, 10);

/** Dokument dostawy w read-modelu, z flagą taką, jaka leży w Subiekcie. */
function dokument(dokId: number, flaga: string | null) {
  db()
    .prepare(
      `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze, flaga)
       VALUES (?, 'FZ', ?, ?, 1, 'Dostawca sp. z o.o.', 0, ?)`
    )
    .run(dokId, `FZ ${dokId}/MAG/07/2026`, dzis(), flaga);
  db()
    .prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc, ob_id) VALUES (?,?,?,?)")
    .run(dokId, TOWAR, 5, dokId * 10);
}

const naLiscie = (dokId: number) => listDocuments().find((d) => d.dokId === dokId)!;

beforeEach(() => {
  const d = db();
  for (const t of [
    "delivery_line", "delivery", "sfera_queue", "sgt_pozycja", "sgt_dokument",
    "sgt_flaga", "sgt_towar",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, opis, lokalizacja)
     VALUES (?, 'SYM-A', 'Towar A', '', 'szt.', '', 'A01-01-01')`
  ).run(TOWAR);
});

test("faktura oznaczona przez biuro jest sprawdzona także na kolektorze", () => {
  dokument(SPRAWDZONA, "3");
  const d = naLiscie(SPRAWDZONA);
  assert.equal(d.flagaKey, "done", "bez wiersza w `delivery` dokument wyglądał jak nietknięty");
  assert.equal(d.flaga, config.docFlag.done.label);
  assert.equal(d.linesTotal, 0, "flaga biura nie udaje postępu, którego tu nie było");
});

test("dokument bez flagi zostaje bez pastylki", () => {
  dokument(NIETKNIETA, null);
  const d = naLiscie(NIETKNIETA);
  assert.equal(d.flagaKey, null);
  assert.equal(d.flaga, null);
});

test("obca flaga firmy dochodzi z nazwą ze słownika Subiekta", () => {
  dokument(OBCA, "9");
  db().prepare("INSERT INTO sgt_flaga(flg_id, nazwa) VALUES (9, 'Do wyjaśnienia')").run();
  const d = naLiscie(OBCA);
  assert.equal(d.flaga, "Do wyjaśnienia");
  assert.equal(d.flagaKey, null, "flagi spoza procesu nie wolno pomalować na „sprawdzone”");
});

test("otwarcie dostawy przejmuje pastylkę — stan aplikacji jest świeższy", () => {
  // Subiekt mówi „sprawdzone", ale ktoś właśnie stanął przy tej palecie.
  // Zapis do Subiekta idzie kolejką, więc czekanie na niego cofałoby pastylkę.
  dokument(SPRAWDZONA, "3");
  openDelivery(SPRAWDZONA, "tester");
  assert.equal(naLiscie(SPRAWDZONA).flagaKey, "in_progress");
});

/** Status dostawy w aplikacji (`open` | `done` | `abandoned`). */
const statusDostawy = (id: number) =>
  (db().prepare("SELECT status FROM delivery WHERE id=?").get(id) as { status: string }).status;

test("własny zapis czekający w kolejce nie udaje nadpisania przez biuro", () => {
  /* Faktura ma flagę biura, więc read-model niesie ją do chwili, w której worker
     wpisze naszą. Wcześniej pierwsze odświeżenie listy w tym oknie porzucało
     dopiero co otwartą dostawę — i jej flaga nie zmieniała się już nigdy. */
  dokument(SPRAWDZONA, "3");
  const id = openDelivery(SPRAWDZONA, "tester");
  listDocuments();
  assert.equal(statusDostawy(id), "open");
});

test("gdy kolejka jest pusta, zmiana w Subiekcie porzuca dostawę", () => {
  dokument(SPRAWDZONA, "3");
  const id = openDelivery(SPRAWDZONA, "tester");
  // worker zrobił swoje: zadanie domknięte, read-model niesie NASZĄ flagę…
  db().prepare("UPDATE sfera_queue SET status='done'").run();
  db().prepare("UPDATE sgt_dokument SET flaga='1' WHERE dok_id=?").run(SPRAWDZONA);
  // …a potem biuro ustawiło na fakturze coś swojego
  db().prepare("UPDATE sgt_dokument SET flaga='9' WHERE dok_id=?").run(SPRAWDZONA);
  listDocuments();
  assert.equal(statusDostawy(id), "abandoned", "decyzja biura wygrywa z aplikacją");
});

test("po nadpisaniu przez biuro wraca flaga z Subiekta", () => {
  // `officeOverride` porzuca dostawę, gdy biuro ruszy flagę poza aplikacją.
  // Decyzja biura wygrywa, więc nasze wyliczenie nie ma prawa jej przykryć.
  dokument(OBCA, "9");
  const id = openDelivery(OBCA, "tester");
  db().prepare("UPDATE delivery SET status='abandoned' WHERE id=?").run(id);
  const d = naLiscie(OBCA);
  assert.equal(d.flagaKey, null);
  assert.equal(d.flaga, "Flaga w Subiekcie", "słownika nie zaimportowano — mówimy tylko tyle, ile wiadomo");
});
