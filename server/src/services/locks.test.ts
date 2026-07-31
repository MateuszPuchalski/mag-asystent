import { test } from "node:test";
import assert from "node:assert/strict";
import { freshLock, isFresh, lockedByOther, LOCK_TTL_MS } from "./locks.js";

/* Lock na pozycji wygasa SAM, przez upływ czasu — nie ma zdarzenia „zwolniono".
   Dlatego reguła świeżości jest testowana z podanym zegarem: inaczej test
   sprawdzałby, czy `Date.now()` działa.

   Testy mieszkały wcześniej w `delivery-flag.test.ts`, bo TTL rozstrzygał też
   o fladze faktury. Flagi nie ma, locki zostały — i zostały tam, gdzie należą. */

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
