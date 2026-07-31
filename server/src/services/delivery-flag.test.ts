import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { flagFor, flagKeyFromSgt, flagLabel, OBCA_FLAGA, widokFlagi } from "./delivery-flag.js";
import { freshLock, isFresh, lockedByOther, LOCK_TTL_MS } from "./locks.js";

/* Reguła flagi jest jedynym miejscem, w którym żyje wiedza o tym, jak firma
   opisuje stan sprawdzenia faktury. Testujemy ją bez bazy i bez zegara —
   `flagFor` przyjmuje gotowe wejścia właśnie po to.                          */

const base = { exists: true, status: "open", someoneWorking: false, qtyMismatch: false };

test("dostawa nietknięta nie ma flagi — aplikacja nie ma nic do powiedzenia", () => {
  assert.equal(flagFor({ ...base, exists: false }), null);
});

test("ktoś pracuje teraz → w trakcie sprawdzania", () => {
  assert.equal(flagFor({ ...base, someoneWorking: true }), "in_progress");
});

test("otwarta, nikt nie pracuje → zapisany postęp", () => {
  assert.equal(flagFor(base), "paused");
});

test("domknięta bez rozbieżności → sprawdzone", () => {
  assert.equal(flagFor({ ...base, status: "done" }), "done");
});

test("domknięta z rozbieżnością ilościową → sprawdzone z błędami", () => {
  assert.equal(
    flagFor({ ...base, status: "done", qtyMismatch: true }),
    "done_with_errors"
  );
});

test("po domknięciu lock już nie wpływa na flagę", () => {
  // ktoś może mieć otwarty ekran, ale faktura jest sprawdzona
  assert.equal(
    flagFor({ ...base, status: "done", someoneWorking: true }),
    "done"
  );
});

test("rozwiązanie rozbieżności zdejmuje „z błędami”", () => {
  const zBledami = flagFor({ ...base, status: "done", qtyMismatch: true });
  const poRozwiazaniu = flagFor({ ...base, status: "done", qtyMismatch: false });
  assert.notEqual(zBledami, poRozwiazaniu);
  assert.equal(poRozwiazaniu, "done");
});

test("etykieta jest oddzielona od klucza — przemianowanie flagi nie rusza domeny", () => {
  // klucz to stała domeny; label to nazwa z Subiekta, konfigurowalna
  assert.equal(flagLabel("done"), config.docFlag.done.label);
  assert.equal(flagLabel(null), null);
});

/* ── Flaga postawiona przez BIURO — druga strona tej samej faktury ───────────
   Reguła pierwszeństwa jest czysta (`widokFlagi`), więc testujemy ją bez bazy.
   Konfigurację mapowania podstawiamy na czas jednego testu: w CI zmiennych
   `DOC_FLAG_*_SGT` nie ma, a to właśnie ich obecność odróżnia produkcję.      */

/** Podstaw `flg_Id` pod klucz stanu na czas jednego sprawdzenia. */
function zWartosciaSgt(key: string, sgt: string, fn: () => void): void {
  const stara = config.docFlag[key].sgt;
  config.docFlag[key].sgt = sgt;
  try {
    fn();
  } finally {
    config.docFlag[key].sgt = stara;
  }
}

test("wartość z Subiekta wraca na klucz stanu", () => {
  zWartosciaSgt("done", "3", () => {
    assert.equal(flagKeyFromSgt("3"), "done");
    // spacje wokół wartości bierze się z CONVERT-a, nie z decyzji człowieka
    assert.equal(flagKeyFromSgt(" 3 "), "done");
  });
});

test("flaga spoza naszych czterech nie udaje stanu aplikacji", () => {
  zWartosciaSgt("done", "3", () => {
    assert.equal(flagKeyFromSgt("9"), null);
  });
  assert.equal(flagKeyFromSgt(null), null);
  assert.equal(flagKeyFromSgt(""), null);
});

test("faktura sprawdzona w Subiekcie ma pastylkę, choć nikt jej tu nie otwierał", () => {
  // to jest ten błąd: dokument bez wpisu w `delivery` wyglądał jak nietknięty
  zWartosciaSgt("done", "3", () => {
    const w = widokFlagi(null, "3", null, false);
    assert.equal(w.key, "done");
    assert.equal(w.label, config.docFlag.done.label);
  });
});

test("obca flaga biura pokazuje się z nazwą ze słownika, bez koloru stanu", () => {
  const w = widokFlagi(null, "9", "Do wyjaśnienia", false);
  assert.equal(w.key, null, "obcej flagi nie wolno pomalować na „sprawdzone”");
  assert.equal(w.label, "Do wyjaśnienia");
});

test("obca flaga bez słownika mówi tylko tyle, ile wiadomo", () => {
  assert.equal(widokFlagi(null, "9", null, false).label, OBCA_FLAGA);
});

test("gdy aplikacja prowadzi dokument, jej stan wyprzedza Subiekta", () => {
  // między policzeniem flagi a zapisem stoi kolejka — czekanie na Subiekta
  // cofałoby pastylkę przy każdym skanie
  zWartosciaSgt("paused", "2", () => {
    assert.equal(widokFlagi("in_progress", "2", null, true).key, "in_progress");
  });
});

test("po nadpisaniu przez biuro wygrywa Subiekt, a nie nasze wyliczenie", () => {
  const w = widokFlagi("done", "9", "Do wyjaśnienia", false);
  assert.equal(w.label, "Do wyjaśnienia");
});

test("brak flagi po obu stronach = brak pastylki", () => {
  assert.deepEqual(widokFlagi(null, null, null, false), { key: null, label: null });
  assert.deepEqual(widokFlagi(null, "  ", null, true), { key: null, label: null });
});

/* ── TTL: przejście „w trakcie" → „zapisany postęp" dzieje się przez czas ──── */

test("świeżość znacznika wygasa dokładnie na TTL", () => {
  const now = Date.parse("2026-07-25T12:00:00.000Z");
  const swiezy = new Date(now - LOCK_TTL_MS + 1000).toISOString();
  const wygasly = new Date(now - LOCK_TTL_MS - 1000).toISOString();
  assert.equal(isFresh(swiezy, now), true);
  assert.equal(isFresh(wygasly, now), false);
  assert.equal(isFresh(null, now), false);
  assert.equal(isFresh("to nie jest data", now), false);
});

test("wygasły lock oddaje pozycję do puli", () => {
  const now = Date.parse("2026-07-25T12:00:00.000Z");
  const wygasly = new Date(now - LOCK_TTL_MS - 1).toISOString();
  assert.equal(freshLock("anna", wygasly, now), null);
  assert.equal(freshLock("anna", new Date(now - 1000).toISOString(), now), "anna");
});

test("własny lock nigdy nie blokuje", () => {
  const teraz = new Date().toISOString();
  assert.equal(lockedByOther("anna", teraz, "anna"), null);
  assert.equal(lockedByOther("anna", teraz, "piotr"), "anna");
  assert.equal(lockedByOther(null, null, "piotr"), null);
});
