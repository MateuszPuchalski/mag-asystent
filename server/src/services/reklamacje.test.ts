import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Reklamacje — priorytet wg terminu ustawowego ────────────────────────────
   Sedno: lista sortuje się po DNIACH DO TERMINU, nie po dacie wpływu, a zegar
   startuje od zgłoszenia w Allegro — termin ustawowy nie czeka, aż ktoś u nas
   obejrzy paczkę. Rozpatrzenie jest jednorazowe: klient dostał odpowiedź.    */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-rekl-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let R: typeof import("./reklamacje.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  R = await import("./reklamacje.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["kosz_pozycja", "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot_zapowiedz", "zwrot", "kosz", "sfera_queue"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

const dniTemu = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function zwrotZReklamacja(allegroDniTemu: number | null, waybill: string): number {
  const d = db();
  const z = d
    .prepare(
      `INSERT INTO zwrot(waybill, status, utworzono_allegro, utworzono_at, utworzono_przez)
       VALUES (?, 'oceniony', ?, ?, 'Test')`
    )
    .run(waybill, allegroDniTemu === null ? null : dniTemu(allegroDniTemu), dniTemu(1));
  const zwrotId = Number(z.lastInsertRowid);
  const p = d
    .prepare(
      `INSERT INTO zwrot_pozycja(zwrot_id, nazwa, ilosc, decyzja, decyzja_at, decyzja_przez)
       VALUES (?, 'Uszkodzona piła', 1, 'reklamacja', ?, 'Test')`
    )
    .run(zwrotId, dniTemu(0));
  return Number(p.lastInsertRowid);
}

test("termin: 14 dni od zgłoszenia; śmieci w dacie nie wywracają liczenia", () => {
  const teraz = Date.parse("2026-08-20T12:00:00Z");
  const t = R.terminReklamacji("2026-08-10T12:00:00Z", teraz);
  assert.equal(t.termin.slice(0, 10), "2026-08-24");
  assert.equal(t.dniDoTerminu, 4);
  assert.equal(R.terminReklamacji("2026-08-01T00:00:00Z", teraz).dniDoTerminu < 0, true);
  // uszkodzona data = zegar od „teraz" — pełny termin, nigdy NaN
  assert.equal(R.terminReklamacji("nie-data", teraz).dniDoTerminu, 14);
});

test("lista: najpilniejsze na górze, po terminie oznaczone", () => {
  zwrotZReklamacja(2, "SWIEZA");   // 12 dni zapasu
  zwrotZReklamacja(20, "STARA");   // 6 dni po terminie
  zwrotZReklamacja(12, "PILNA");   // 2 dni zapasu
  const lista = R.listaReklamacji();
  assert.deepEqual(lista.map((r) => r.waybill), ["STARA", "PILNA", "SWIEZA"]);
  assert.equal(lista[0].poTerminie, true);
  assert.equal(lista[1].poTerminie, false);
  // zwrot ręczny bez daty Allegro liczy od przyjęcia skanem (dzień temu:
  // zostało 13 dni minus chwila, a floor mówi uczciwie „12 pełnych dni")
  zwrotZReklamacja(null, "RECZNY");
  assert.equal(R.listaReklamacji().find((r) => r.waybill === "RECZNY")!.dniDoTerminu, 12);
});

test("rozpatrzenie jest jednorazowe i schodzi z listy otwartych", () => {
  const pozycjaId = zwrotZReklamacja(3, "W1");
  R.rozpatrzReklamacje(pozycjaId, "uznana", "zwrot środków + przeprosiny", "Biuro");
  assert.equal(R.listaReklamacji().length, 0);
  const zamkniete = R.listaReklamacji({ rozpatrzone: true });
  assert.equal(zamkniete[0].wynik, "uznana");
  assert.equal(zamkniete[0].reklNotatka, "zwrot środków + przeprosiny");
  assert.throws(() => R.rozpatrzReklamacje(pozycjaId, "odrzucona", null, "Biuro"), /już rozpatrzona/);
  assert.throws(() => R.rozpatrzReklamacje(pozycjaId + 999, "uznana", null, "Biuro"), /nie istnieje/);
  assert.throws(() => R.rozpatrzReklamacje(pozycjaId, "moze", null, "Biuro"), /Nieznany wynik|już rozpatrzona/);
});

test("półka reklamacyjna: zapis, normalizacja, zdjęcie i trwałość po rozpatrzeniu", () => {
  const pozycjaId = zwrotZReklamacja(2, "W-POLKA");
  R.ustawPolke(pozycjaId, " rek-01 ", "Biuro");
  assert.equal(R.listaReklamacji()[0].polka, "REK-01", "trim + upper — skan i wpis się spotykają");
  // pusta wartość = zdjęcie z półki, nie zapis pustki
  R.ustawPolke(pozycjaId, "  ", "Biuro");
  assert.equal(R.listaReklamacji()[0].polka, null);
  R.ustawPolke(pozycjaId, "REK-02", "Biuro");
  // rozpatrzenie NIE czyści półki — historia mówi, skąd towar zszedł
  R.rozpatrzReklamacje(pozycjaId, "odrzucona", null, "Biuro");
  assert.equal(R.listaReklamacji({ rozpatrzone: true })[0].polka, "REK-02");
  assert.throws(() => R.ustawPolke(pozycjaId + 999, "X", "Biuro"), /nie istnieje/);
});

test("raport zlicza proces w jednym miejscu", () => {
  zwrotZReklamacja(20, "PO-TERMINIE");
  const r = R.raportZwrotow();
  assert.equal(r.zwroty.razem30dni, 1);
  assert.equal(r.reklamacje.otwarte, 1);
  assert.equal(r.reklamacje.poTerminie, 1);
  assert.equal(r.kosze.otwarte, 0);
  assert.deepEqual(r.zapowiedzi, { oczekujace: 0, brakujace: 0 }, "bez przebiegu tickera zapowiedzi milczą");
  assert.equal(r.medianaGodzinDoRozliczenia, null, "bez rozliczonych zwrotów mediana uczciwie milczy");
});
