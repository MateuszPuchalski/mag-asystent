import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { flagFor } from "./delivery-flag.js";
import { freshLock, isFresh, lockedByOther, LOCK_TTL_MS } from "./locks.js";

/* Reguła flagi jest jedynym miejscem, w którym żyje wiedza o tym, jak firma
   opisuje stan sprawdzenia faktury. Testujemy ją bez bazy i bez zegara —
   `flagFor` przyjmuje gotowe wejścia właśnie po to.                          */

const base = { exists: true, status: "open", someoneWorking: false, qtyMismatch: false };

test("dostawa nietknięta nie ma flagi — aplikacja nie ma nic do powiedzenia", () => {
  assert.equal(flagFor({ ...base, exists: false }), null);
});

test("ktoś pracuje teraz → w trakcie sprawdzania", () => {
  assert.equal(flagFor({ ...base, someoneWorking: true }), config.docFlag.inProgress);
});

test("otwarta, nikt nie pracuje → zapisany postęp", () => {
  assert.equal(flagFor(base), config.docFlag.paused);
});

test("domknięta bez rozbieżności → sprawdzone", () => {
  assert.equal(flagFor({ ...base, status: "done" }), config.docFlag.done);
});

test("domknięta z rozbieżnością ilościową → sprawdzone z błędami", () => {
  assert.equal(
    flagFor({ ...base, status: "done", qtyMismatch: true }),
    config.docFlag.doneWithErrors
  );
});

test("po domknięciu lock już nie wpływa na flagę", () => {
  // ktoś może mieć otwarty ekran, ale faktura jest sprawdzona
  assert.equal(
    flagFor({ ...base, status: "done", someoneWorking: true }),
    config.docFlag.done
  );
});

test("rozwiązanie rozbieżności zdejmuje „z błędami”", () => {
  const zBledami = flagFor({ ...base, status: "done", qtyMismatch: true });
  const poRozwiazaniu = flagFor({ ...base, status: "done", qtyMismatch: false });
  assert.notEqual(zBledami, poRozwiazaniu);
  assert.equal(poRozwiazaniu, config.docFlag.done);
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
