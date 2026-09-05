import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Rekoncyliacja jest ostatnią linią obrony przed cichym błędem transakcyjnym:
   kod się kompiluje, działa, wygląda dobrze i przez trzy tygodnie rozjeżdża
   dane. Jej własny błąd byłby tym samym rodzajem awarii — raportem, który
   milczy — więc każda z czterech kontroli ma tu wiersz.                      */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-rec-")), "t.db");

let db: typeof import("../db/db.js").db;
let reconcile: typeof import("./reconcile.js").reconcile;
let reconcileCsv: typeof import("./reconcile.js").reconcileCsv;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ reconcile, reconcileCsv } = await import("./reconcile.js"));
});

const TW = 1;

function towar(lokalizacja: string) {
  db()
    .prepare(
      `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, lokalizacja)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(tw_id) DO UPDATE SET lokalizacja = excluded.lokalizacja`
    )
    .run(TW, "W32-0203", "Wąż ogrodowy", "5901234567890", "szt", lokalizacja);
}

function zadanie(o: {
  type?: string;
  status: string;
  newValue?: string;
  dni?: number;
  docId?: number | null;
}) {
  const dni = o.dni ?? 0;
  db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, label, detail, tw_id, source_doc_id,
                               created_by, created_at, processed_at, error_msg)
       VALUES (?,?,?,'Lokalizacja · W32-0203','', ?, ?, 'test',
               datetime('now', ?), datetime('now', ?), 'Zapis Sfery nieudany')`
    )
    .run(
      o.type ?? "set_location",
      JSON.stringify({ twId: TW, newValue: o.newValue ?? "" }),
      o.status,
      TW,
      o.docId ?? null,
      `-${dni} days`,
      `-${dni} days`
    );
}

beforeEach(() => {
  db().prepare("DELETE FROM sfera_queue").run();
  db().prepare("DELETE FROM delivery_line").run();
  db().prepare("DELETE FROM delivery").run();
  db().prepare("DELETE FROM zwrot_klienta_pozycja").run();
  db().prepare("DELETE FROM zwrot_klienta").run();
});

/** Zwrot w pracy, zgłoszony `dni` dni temu. Termin ustawowy to czternaście. */
function zwrotZgloszonyPrzed(dni: number, numer: string): void {
  db().prepare(`INSERT INTO channel_account(channel, external_account_id)
    VALUES ('allegro','rekoncyliacja') ON CONFLICT DO NOTHING`).run();
  const konto = Number((db().prepare(
    "SELECT id FROM channel_account WHERE external_account_id='rekoncyliacja'")
    .get() as { id: number }).id);
  db().prepare(`INSERT INTO zwrot_klienta
    (channel_account_id, external_id, reference_number, created_at, synced_at)
    VALUES (?,?,?, datetime('now', ?), datetime('now'))`)
    .run(konto, `zw-${numer}`, numer, `-${dni} days`);
}

/* ── Termin ustawowy (0.210.0) ──────────────────────────────────────────────
   Do tego wydania terminu pilnował WYŁĄCZNIE kolor wiersza w panelu.
   Rekoncyliacja i /api/health nie znały zwrotów wcale, więc czternaście dni
   mijało bez alarmu, jeśli przez tydzień nikt nie otworzył ekranu.         */

test("zwrot po terminie ustawowym trafia do raportu, i to na jego GÓRĘ", () => {
  zwrotZgloszonyPrzed(20, "PO-1");
  const r = reconcile();
  const w = r.rozjazdy.filter((x) => x.rodzaj === "zwrot_po_terminie");
  assert.equal(w.length, 1);
  assert.match(w[0].opis, /PO terminie/);
  assert.match(w[0].opis, /PO-1/);
  /* Skutek prawny czyta się przed operacyjnym — raport czyta się od góry. */
  assert.equal(r.rozjazdy[0].rodzaj, "zwrot_po_terminie");
});

test("doba przed terminem już zgłasza — to ostatni moment, żeby zdążyć", () => {
  zwrotZgloszonyPrzed(13, "BLISKO-1");
  const r = reconcile();
  assert.equal(r.rozjazdy.filter((x) => x.rodzaj === "zwrot_po_terminie").length, 1);
});

test("zwrot z zapasem czasu NIE zgłasza się — raport ma zostać pusty", () => {
  /* Raport przychodzący codziennie przestaje być czytany po tygodniu. */
  zwrotZgloszonyPrzed(3, "SPOKOJ-1");
  assert.equal(reconcile().rozjazdy.filter((x) => x.rodzaj === "zwrot_po_terminie").length, 0);
});

test("zwrot ZAMKNIĘTY nie ma już terminu do pilnowania", () => {
  zwrotZgloszonyPrzed(30, "ZAMK-1");
  db().prepare(`UPDATE zwrot_klienta SET werdykt='przyjety', kwota_grosze=100,
    korekta_numer='KFS 1/2026', zamkniety_at=datetime('now') WHERE reference_number='ZAMK-1'`).run();
  assert.equal(reconcile().rozjazdy.filter((x) => x.rodzaj === "zwrot_po_terminie").length, 0);
});

test("zgodny zapis nie generuje raportu", () => {
  towar("A01-02-03");
  zadanie({ status: "done", newValue: "A01-02-03" });
  const r = reconcile();
  assert.equal(r.rozjazdy.length, 0);
  assert.equal(r.sprawdzono.kartotek, 1);
});

test("Subiekt ma co innego, niż aplikacja zapisała", () => {
  // dokładnie ten cichy błąd, dla którego ta kontrola istnieje
  towar("B02-02-02");
  zadanie({ status: "done", newValue: "A01-02-03" });
  const r = reconcile();
  assert.equal(r.rozjazdy.length, 1);
  assert.equal(r.rozjazdy[0].rodzaj, "lokalizacja");
  assert.match(r.rozjazdy[0].opis, /A01-02-03/);
  assert.match(r.rozjazdy[0].opis, /B02-02-02/);
});

test("kolejność kodów nie jest rozjazdem", () => {
  // pickingową (pierwszą) pilnuje tryb A; tu liczy się zbiór adresów
  towar("B02-02-02 A01-02-03");
  zadanie({ status: "done", newValue: "A01-02-03 B02-02-02" });
  assert.equal(reconcile().rozjazdy.length, 0);
});

test("zadanie w błędzie zgłasza się dopiero po dobie", () => {
  towar("A01-02-03");
  zadanie({ status: "error", newValue: "A01-02-03" });
  assert.equal(reconcile().rozjazdy.length, 0, "świeży błąd widać na pastylce Sfery");

  db().prepare("DELETE FROM sfera_queue").run();
  zadanie({ status: "error", newValue: "A01-02-03", dni: 2 });
  const r = reconcile();
  assert.equal(r.rozjazdy[0].rodzaj, "zadanie_w_bledzie");
  assert.match(r.rozjazdy[0].opis, /Zapis Sfery nieudany/);
});

test("dokument, który nie wyszedł z bufora przez trzy dni", () => {
  towar("A01-02-03");
  zadanie({ type: "mm", status: "waiting_for_doc", dni: 1, docId: 77 });
  assert.equal(reconcile().rozjazdy.length, 0);

  db().prepare("DELETE FROM sfera_queue").run();
  zadanie({ type: "mm", status: "waiting_for_doc", dni: 5, docId: 77 });
  const r = reconcile();
  assert.equal(r.rozjazdy[0].rodzaj, "utknelo_w_buforze");
  assert.match(r.rozjazdy[0].opis, /77/);
});


test("CSV otwiera się w Excelu PL bez kreatora", () => {
  towar("B02-02-02");
  zadanie({ status: "done", newValue: "A01-02-03" });
  const csv = reconcileCsv(reconcile());
  assert.ok(csv.startsWith("﻿"), "BOM");
  assert.match(csv.replace(/^﻿/, "").split("\r\n")[0], /^rodzaj;klucz;opis;od_kiedy$/);
  // cytowanie jest warunkowe (wspólny csv.ts): zwykłe pole idzie bez cudzysłowów
  assert.match(csv, /^lokalizacja;/m);
});
