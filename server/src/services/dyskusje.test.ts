import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Dyskusje Allegro — rejestr pracy biura ──────────────────────────────────
   Sedno: synchronizacja jest upsertem, który odświeża pola Allegro i NIE TYKA
   naszej pracy (status, prowadzący, notatka); sprawa zamknięta w panelu
   schodzi z worklisty automatem; CLAIM dostaje termin ustawowy liczony tą
   samą arytmetyką co reklamacje ze zwrotów.                                  */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dysk-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let D: typeof import("./dyskusje.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./dyskusje.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dyskusja", "zwrot_pozycja", "zwrot", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

const dniTemu = (n: number) => new Date(Date.now() - n * 86_400_000 - 1000).toISOString();

function zwrotDlaZamowienia(orderId: string, waybill: string): number {
  const w = db()
    .prepare(
      `INSERT INTO zwrot(allegro_order_id, waybill, status, utworzono_at, utworzono_przez)
       VALUES (?, ?, 'nowy', ?, 'Test')`
    )
    .run(orderId, waybill, dniTemu(0));
  return Number(w.lastInsertRowid);
}

test("sync: nowe sprawy wchodzą jako `nowa`, zamknięta w panelu schodzi automatem", async () => {
  const wynik = await D.synchronizujDyskusje("Biuro");
  /* Adapter dev daje trzy sprawy; trzecia ma status CLOSED i ma zostać
     zamknięta w tym samym przebiegu, podpisana przez `allegro`. */
  assert.equal(wynik.nowych, 3);
  assert.equal(wynik.zamknietychPrzezAllegro, 1);
  assert.equal(wynik.przejrzanych, 3);

  const worklista = D.listaDyskusji();
  assert.equal(worklista.length, 2, "CLOSED nie jest robotą do zrobienia");
  assert.ok(worklista.every((y) => y.status === "nowa"));

  const wszystkie = D.listaDyskusji({ status: "wszystkie" });
  const zamknieta = wszystkie.find((y) => y.statusAllegro === "CLOSED")!;
  assert.equal(zamknieta.status, "zamknieta");
  assert.equal(zamknieta.zamknietoPrzez, "allegro");
});

test("sync jest upsertem: pola Allegro się odświeżają, nasza praca zostaje", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji()[0];
  D.zmienStatusDyskusji(sprawa.id, "w_toku", "Ala");
  D.zapiszNotatkeDyskusji(sprawa.id, "czekamy na zdjęcia od klienta", "Ala");

  const drugi = await D.synchronizujDyskusje("Biuro");
  assert.equal(drugi.nowych, 0, "te same sprawy nie wchodzą drugi raz");

  const po = D.szczegolDyskusji(sprawa.id);
  assert.equal(po.status, "w_toku", "status naszej pracy przeżywa sync");
  assert.equal(po.prowadzi, "Ala");
  assert.equal(po.notatka, "czekamy na zdjęcia od klienta");
});

test("wiązanie ze zwrotem po numerze zamówienia — także spóźnione", async () => {
  /* Zwrot zeskanowany PRZED pierwszym pobraniem dyskusji. */
  const zwrotId = zwrotDlaZamowienia("dev-ord-1", "DEVWB0001");
  await D.synchronizujDyskusje("Biuro");
  const zWczesniejszym = D.listaDyskusji().find((y) => y.orderId === "dev-ord-1")!;
  assert.equal(zWczesniejszym.zwrotId, zwrotId);

  /* Druga sprawa nie ma jeszcze zwrotu; paczka przyjeżdża PO dyskusji
     i wiązanie ma dołożyć następny przebieg, nie ręka człowieka. */
  const bezZwrotu = D.listaDyskusji().find((y) => y.orderId === "dev-ord-2")!;
  assert.equal(bezZwrotu.zwrotId, null);
  const pozniejszy = zwrotDlaZamowienia("dev-ord-2", "DEVWB0002");
  await D.synchronizujDyskusje("Biuro");
  assert.equal(D.szczegolDyskusji(bezZwrotu.id).zwrotId, pozniejszy);
});

test("CLAIM ma termin ustawowy, DISCUSSION nie ma zegara; CLAIM idzie na górę", async () => {
  await D.synchronizujDyskusje("Biuro");
  const lista = D.listaDyskusji();
  const claim = lista.find((y) => y.typ === "CLAIM")!;
  const rozmowa = lista.find((y) => y.typ === "DISCUSSION")!;
  assert.ok(claim.termin !== null && claim.dniDoTerminu !== null);
  /* Adapter dev stempluje „dzień temu" bez sekundy zapasu, więc na szybkim
     runnerze odczyt potrafi wypaść w TEJ SAMEJ milisekundzie (wtedy floor
     daje 13, nie 12) — ta sama pułapka co w reklamacje.test.ts. */
  assert.ok(
    claim.dniDoTerminu === 12 || claim.dniDoTerminu === 13,
    `dzień temu + 14 dni ustawowych ≈ 12–13 dni zapasu, było ${claim.dniDoTerminu}`
  );
  assert.equal(rozmowa.termin, null);
  assert.equal(lista[0].typ, "CLAIM", "sprawa z zegarem stoi przed rozmową");
});

test("statusy: guardy 404/409, zamknięcie stempluje, licznik się zgadza", async () => {
  await D.synchronizujDyskusje("Biuro");
  const przed = D.licznikDyskusji();
  assert.equal(przed.nowe, 2);
  assert.equal(przed.wToku, 0);

  const sprawa = D.listaDyskusji()[0];
  D.zmienStatusDyskusji(sprawa.id, "w_toku", "Ola");
  const wToku = D.szczegolDyskusji(sprawa.id);
  assert.equal(wToku.prowadzi, "Ola", "wzięcie sprawy stempluje prowadzącego");

  const zamknieta = D.zmienStatusDyskusji(sprawa.id, "zamknieta", "Ola");
  assert.equal(zamknieta.zamknietoPrzez, "Ola");
  assert.throws(() => D.zmienStatusDyskusji(sprawa.id, "zamknieta", "Ola"), /już w statusie/);
  assert.throws(() => D.zmienStatusDyskusji(999999, "w_toku", "Ola"), /Nie ma takiej/);
  assert.throws(() => D.zmienStatusDyskusji(sprawa.id, "dziwny", "Ola"), /Nieznany status/);

  const po = D.licznikDyskusji();
  assert.equal(po.nowe, 1);
  assert.equal(po.wToku, 0);
});

test("notatka bierze sprawę na piszącego; pusta zdejmuje treść, nie właściciela", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji()[0];
  D.zapiszNotatkeDyskusji(sprawa.id, "ustalone: dosyłamy śrubę", "Ewa");
  const po = D.szczegolDyskusji(sprawa.id);
  assert.equal(po.notatka, "ustalone: dosyłamy śrubę");
  assert.equal(po.prowadzi, "Ewa");
  D.zapiszNotatkeDyskusji(sprawa.id, "   ", "Jan");
  const pusta = D.szczegolDyskusji(sprawa.id);
  assert.equal(pusta.notatka, null);
  assert.equal(pusta.prowadzi, "Jan", "ostatni pracujący podmienia nazwisko — znacznik, nie zamek");
});
